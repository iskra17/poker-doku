import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { TournamentConfigSnapshotV2 } from '@/lib/tournament/tournament-config';
import { openPokerDatabase, type PokerDatabase } from './persistence/database';
import {
  TournamentInstanceRepository,
  TournamentPersistenceError,
  computeTournamentPayoutFreezeChecksum,
  computeTournamentSettlementFingerprint,
  type CreateInstanceCommand,
  type CreateTemplateCommand,
  type TournamentPayoutFreezePlan,
} from './tournament-instance-repository';

const NOW = Date.now() - 10_000;
const HOUR_MS = 60 * 60_000;
const DAY_MS = 24 * HOUR_MS;

function config(
  economy: 'freeroll' | 'wallet' = 'wallet',
): TournamentConfigSnapshotV2 {
  return {
    version: 2,
    name: economy === 'freeroll' ? '주말 프리롤' : '주말 메인',
    economy: economy === 'freeroll'
      ? { mode: 'freeroll', promotionAccountId: 'global' }
      : { mode: 'wallet', productVersion: 1, buyIn: 1_500, fee: 150 },
    tableSize: 6,
    field: { minEntrants: 8, maxEntrants: 24, botFillToMinimum: false },
    turnTimeSeconds: 15,
    structure: {
      sourcePresetId: 'standard',
      startingStack: 1_500,
      segments: [
        {
          kind: 'level',
          durationMs: 480_000,
          smallBlind: 10,
          bigBlind: 20,
          bigBlindAnte: 0,
        },
      ],
    },
    prizePool: economy === 'freeroll'
      ? { kind: 'promotion-funded', totalPrize: 100_000 }
      : { kind: 'entry-pool' },
    payout: {
      tableVersion: 2,
      presetId: 'standard',
      paidFieldPercent: 15,
    },
    lateRegistration: {
      enabled: true,
      durationLevels: 2,
      minStartingStackBb: 20,
    },
  };
}

function templateCommand(
  overrides: Partial<CreateTemplateCommand> = {},
): CreateTemplateCommand {
  return {
    id: 'template-main',
    idempotencyKey: 'template-request-1',
    name: '주말 메인',
    enabled: true,
    timezone: 'Asia/Seoul',
    recurrence: { kind: 'weekly', weekday: 6, hour: 20, minute: 0 },
    firstStartsAt: NOW + HOUR_MS,
    recurrenceEndsAt: NOW + 7 * DAY_MS,
    visibleLeadMs: 86_400_000,
    registrationLeadMs: 20 * 60_000,
    config: config(),
    createdBy: { kind: 'backoffice-admin', profileId: 'admin-1' },
    now: NOW,
    ...overrides,
  };
}

function instanceCommand(
  id: string,
  overrides: Partial<CreateInstanceCommand> = {},
): CreateInstanceCommand {
  return {
    id,
    templateId: null,
    templateRevision: null,
    idempotencyKey: `instance-request-${id}`,
    occurrenceKey: id,
    schedule: {
      visibleAt: NOW + 60_000,
      registrationOpensAt: NOW + 2_400_000,
      startsAt: NOW + 3_600_000,
      manualStartExpiresAt: null,
    },
    config: config(),
    createdBy: { kind: 'backoffice-admin', profileId: 'admin-1' },
    now: NOW,
    ...overrides,
  };
}

function recurringInstanceCommand(
  id: string,
  templateId: string,
  templateRevision: number,
  startsAt: number,
  overrides: Partial<CreateInstanceCommand> = {},
): CreateInstanceCommand {
  return instanceCommand(id, {
    templateId,
    templateRevision,
    idempotencyKey:
      `template:${templateId}:r${templateRevision}:${startsAt}`,
    occurrenceKey: String(startsAt),
    schedule: {
      visibleAt: startsAt - 86_400_000,
      registrationOpensAt: startsAt - 20 * 60_000,
      startsAt,
      manualStartExpiresAt: null,
    },
    ...overrides,
  });
}

describe('TournamentInstanceRepository', () => {
  let database: PokerDatabase;
  let repository: TournamentInstanceRepository;

  beforeEach(() => {
    database = openPokerDatabase(':memory:');
    repository = new TournamentInstanceRepository(database);
  });

  afterEach(() => database.close());

  it('creates one idempotent standalone or recurring instance', () => {
    const template = repository.createTemplate(templateCommand());
    expect(repository.createTemplate(templateCommand())).toEqual(template);
    expect(template).toMatchObject({
      firstStartsAt: NOW + HOUR_MS,
      recurrenceEndsAt: NOW + 7 * DAY_MS,
    });

    const standalone = instanceCommand('standalone');
    expect(repository.createInstance(standalone)).toEqual(
      repository.createInstance(standalone),
    );

    const recurring = instanceCommand('weekly-1', {
      templateId: template.id,
      templateRevision: template.revision,
      idempotencyKey: `template:template-main:r1:${NOW + 3_600_000}`,
      occurrenceKey: String(NOW + 3_600_000),
      schedule: {
        visibleAt: NOW + 3_600_000 - 86_400_000,
        registrationOpensAt: NOW + 3_600_000 - 20 * 60_000,
        startsAt: NOW + 3_600_000,
        manualStartExpiresAt: null,
      },
    });
    expect(repository.createInstance(recurring)).toEqual(
      repository.createInstance(recurring),
    );

    expect(database.db.prepare(`
      SELECT COUNT(*) AS count FROM tournament_instance
    `).get()).toEqual({ count: 2 });

    expect(() => repository.createInstance({
      ...standalone,
      schedule: { ...standalone.schedule, startsAt: NOW + 7_200_000 },
    })).toThrowError(TournamentPersistenceError);
  });

  it('derives recurring identity and immutable config from the current template', () => {
    const original = repository.createTemplate(templateCommand());
    repository.patchTemplateIfRevision(original.id, 1, {
      name: '새 메인',
      config: { ...config(), name: '새 메인' },
      updatedAt: NOW + 1,
    });
    const startsAt = NOW + 7_200_000;
    const canonical = instanceCommand('recurring-v2', {
      templateId: original.id,
      templateRevision: 2,
      idempotencyKey: `template:${original.id}:r2:${startsAt}`,
      occurrenceKey: String(startsAt),
      schedule: {
        visibleAt: startsAt - 86_400_000,
        registrationOpensAt: startsAt - 20 * 60_000,
        startsAt,
        manualStartExpiresAt: null,
      },
      config: { ...config(), name: '새 메인' },
    });
    expect(repository.createInstance(canonical)).toMatchObject({
      id: 'recurring-v2',
      templateRevision: 2,
      occurrenceKey: String(startsAt),
      config: { name: '새 메인' },
    });

    for (const invalid of [
      { ...canonical, id: 'stale', templateRevision: 1 },
      { ...canonical, id: 'wrong-key', occurrenceKey: 'arbitrary' },
      { ...canonical, id: 'wrong-idem', idempotencyKey: 'arbitrary' },
      { ...canonical, id: 'stale-config', config: config() },
    ]) {
      expect(() => repository.createInstance(invalid)).toThrowError(
        TournamentPersistenceError,
      );
    }
    expect(() => repository.createInstance({
      ...canonical,
      id: 'duplicate-same-time',
    })).toThrowError(TournamentPersistenceError);
  });

  it('patches a template only at the expected revision', () => {
    repository.createTemplate(templateCommand());

    const updated = repository.patchTemplateIfRevision('template-main', 1, {
      name: '토요일 메인',
      enabled: false,
      config: { ...config(), name: '토요일 메인' },
      updatedAt: NOW + 1,
    });
    expect(updated).toMatchObject({
      status: 'updated',
      record: {
        revision: 2,
        name: '토요일 메인',
        enabled: false,
        firstStartsAt: NOW + HOUR_MS,
        recurrenceEndsAt: NOW + 7 * DAY_MS,
      },
    });

    expect(repository.patchTemplateIfRevision('template-main', 1, {
      enabled: true,
      updatedAt: NOW + 2,
    })).toEqual({ status: 'revision-conflict', actualRevision: 2 });

    expect(repository.patchTemplateIfRevision('missing', 1, {
      enabled: false,
      updatedAt: NOW,
    })).toEqual({ status: 'not-found' });
  });

  it('rejects an enabled persisted template without recurrence boundaries', () => {
    database.db.prepare(`
      INSERT INTO tournament_template (
        id, revision, idempotency_key, name, enabled, timezone,
        recurrence_json, visible_lead_ms, registration_lead_ms,
        config_version, config_json, created_by_kind,
        created_by_profile_id, created_at, updated_at,
        first_starts_at, recurrence_ends_at
      ) VALUES (
        ?, 1, ?, ?, 1, 'Asia/Seoul', ?, ?, ?, 2, ?, ?, NULL, ?, ?, NULL, NULL
      )
    `).run(
      'corrupt-active-template',
      'corrupt-active-template-key',
      '손상 템플릿',
      JSON.stringify({ kind: 'hourly', minute: 0 }),
      HOUR_MS,
      20 * 60_000,
      JSON.stringify(config()),
      'legacy-import',
      NOW,
      NOW,
    );

    expect(() => repository.withTemplateRevisionLease(
      'corrupt-active-template',
      1,
      template => template,
    )).toThrowError(TournamentPersistenceError);
  });

  it('replaces hidden old-revision occurrences but preserves visible occupancy', () => {
    const template = repository.createTemplate(templateCommand());
    repository.createInstance(recurringInstanceCommand(
      'hidden-old',
      template.id,
      1,
      NOW + 3_600_000,
    ));
    repository.createInstance(recurringInstanceCommand(
      'visible-old',
      template.id,
      1,
      NOW + 7_200_000,
    ));
    database.db.prepare(`
      UPDATE tournament_instance
      SET status = 'scheduled-visible', updated_at = ?
      WHERE id = 'visible-old'
    `).run(NOW + 1);

    repository.patchTemplateIfRevision(template.id, 1, {
      name: '새 메인',
      updatedAt: NOW + 2,
    });
    const result = repository.replaceHiddenTemplateOccurrences(
      template.id,
      1,
      [
        recurringInstanceCommand(
          'hidden-new',
          template.id,
          2,
          NOW + 3_600_000,
          {
          now: NOW + 2,
          },
        ),
        recurringInstanceCommand(
          'visible-new',
          template.id,
          2,
          NOW + 7_200_000,
          {
          now: NOW + 2,
          },
        ),
      ],
      NOW + 2,
    );

    expect(result).toEqual({
      supersededIds: ['hidden-old'],
      createdIds: ['hidden-new'],
      preservedIds: ['visible-old'],
    });
    expect(repository.getInstance('hidden-old')).toMatchObject({
      status: 'cancelled',
      statusReason: 'template-superseded',
    });
    expect(repository.getInstance('visible-old')).toMatchObject({
      status: 'scheduled-visible',
      templateRevision: 1,
    });
  });

  it('claims exactly one concurrent start expiry cancel or close owner', () => {
    repository.createInstance(instanceCommand('start'));
    database.db.prepare(`
      UPDATE tournament_instance
      SET status = 'registering',
          registration_state = 'open-prestart',
          updated_at = ?
      WHERE id = 'start'
    `).run(NOW + 1);

    expect(repository.claimStart('start', 'worker-a', NOW + 30_000)).toMatchObject({
      status: 'claimed',
      ownerId: 'worker-a',
      startAttempt: 1,
      source: {
        status: 'registering',
        registrationState: 'open-prestart',
        statusReason: null,
        nextRetryAt: null,
      },
    });
    expect(repository.claimStart('start', 'worker-b', NOW + 30_000)).toMatchObject({
      status: 'not-claimable',
    });

    repository.createInstance(instanceCommand('closing'));
    database.db.prepare(`
      UPDATE tournament_instance
      SET status = 'registering',
          registration_state = 'open-prestart',
          updated_at = ?
      WHERE id = 'closing'
    `).run(NOW + 1);
    database.db.prepare(`
      UPDATE tournament_instance
      SET status = 'starting',
          registration_state = 'locked-for-start',
          start_attempt = 1,
          start_owner_id = 'starter',
          start_lease_until = ?,
          updated_at = ?
      WHERE id = 'closing'
    `).run(NOW + 30_000, NOW + 2);
    database.db.prepare(`
      UPDATE tournament_instance
      SET status = 'running',
          registration_state = 'open-late',
          initial_entrants = 8,
          initial_bot_entrants = 0,
          committed_entrants = 8,
          start_owner_id = NULL,
          start_lease_until = NULL,
          actual_started_at = ?,
          updated_at = ?
      WHERE id = 'closing'
    `).run(NOW + 3, NOW + 3);

    expect(repository.claimRegistrationClose(
      'closing',
      'closer-a',
      'time',
    )).toMatchObject({
      status: 'claimed',
      ownerToken: 'closer-a',
      generation: 1,
    });
    expect(repository.claimRegistrationClose(
      'closing',
      'closer-b',
      'full',
    )).toMatchObject({
      status: 'not-claimable',
      ownerToken: 'closer-a',
      generation: 1,
    });

    repository.createInstance(instanceCommand('expiry'));
    expect(repository.claimDirectCancellation(
      'expiry',
      'missed-start',
      'expiry-worker',
      NOW + 4,
    )).toMatchObject({ status: 'claimed' });
    expect(repository.claimDirectCancellation(
      'expiry',
      'missed-start',
      'other-worker',
      NOW + 5,
    )).toMatchObject({ status: 'not-claimable' });
  });

  it('moves financial liability to refund-pending before terminal cancellation', () => {
    repository.createInstance(instanceCommand('wallet-liability'));
    seedProfileAndWalletEntry(database, 'wallet-liability');

    expect(repository.claimRefundPending(
      'wallet-liability',
      'operator-cancel',
      'cancel-a',
    )).toMatchObject({
      status: 'claimed',
      instance: { status: 'refund-pending', registrationState: 'closed' },
    });
    expect(repository.claimRefundPending(
      'wallet-liability',
      'operator-cancel',
      'cancel-b',
    )).toMatchObject({ status: 'not-claimable' });
    expect(() => repository.finishCancellation(
      'wallet-liability',
      999,
      NOW + 10,
    )).toThrowError(TournamentPersistenceError);

    database.db.prepare(`
      UPDATE sng_entries
      SET status = 'refunded', updated_at = ?
      WHERE tournament_id = 'wallet-liability'
    `).run(NOW + 11);
    expect(repository.finishCancellation(
      'wallet-liability',
      1,
      NOW + 12,
    )).toMatchObject({ status: 'cancelled' });
  });

  it('claims a running open-late cancellation through the close generation', () => {
    repository.createInstance(instanceCommand('running-liability'));
    seedProfileAndWalletEntry(database, 'running-liability');
    makeRunningOpenLate(database, 'running-liability');

    expect(repository.claimRefundPending(
      'running-liability',
      'operator-cancel',
      'cancel-running',
    )).toMatchObject({
      status: 'claimed',
      instance: {
        status: 'refund-pending',
        registrationState: 'closed',
        registrationCloseReason: 'tournament-cancelled',
        registrationGeneration: 1,
      },
    });
  });

  it('preserves wallet enrollment ownership until the void transaction refunds it', () => {
    repository.createInstance(instanceCommand('late-refund'));
    seedProfileAndWalletEntry(database, 'late-refund');
    makeRunningOpenLate(database, 'late-refund');
    database.db.prepare(`
      UPDATE tournament_instance
      SET pending_late_entrants = 1
      WHERE id = 'late-refund'
    `).run();
    database.db.prepare(`
      INSERT INTO tournament_registration (
        instance_id, profile_id, public_player_json, status, ever_seated,
        registration_attempt, economy_entry_attempt, registered_at, updated_at
      ) VALUES (
        'late-refund', 'profile-a',
        '{"id":"player-a","name":"A","avatar":"sakura"}',
        'late-pending', 0, 1, 1, ?, ?
      )
    `).run(NOW, NOW);
    database.db.prepare(`
      INSERT INTO tournament_registration_attempt (
        instance_id, profile_id, registration_attempt, request_id,
        economy_entry_attempt, status, close_generation, close_owner_token,
        close_reason, created_at, updated_at
      ) VALUES (
        'late-refund', 'profile-a', 1, 'late-request', 1, 'late-pending',
        NULL, NULL, NULL, ?, ?
      )
    `).run(NOW, NOW);

    const claim = repository.claimRefundPending(
      'late-refund',
      'operator-cancel',
      'late-cancel',
    );
    expect(claim).toMatchObject({
      status: 'claimed',
      claimGeneration: 1,
      instance: { pendingLateEntrants: 0 },
    });
    expect(database.db.prepare(`
      SELECT status FROM tournament_registration
      WHERE instance_id = 'late-refund'
    `).get()).toEqual({ status: 'late-pending' });
    expect(database.db.prepare(`
      SELECT status FROM tournament_registration_attempt
      WHERE instance_id = 'late-refund'
    `).get()).toEqual({ status: 'late-pending' });
    expect(database.db.prepare(`
      SELECT COUNT(*) AS count FROM tournament_registration
      WHERE profile_id = 'profile-a'
        AND status IN ('registered', 'seat-claimed', 'late-pending', 'seated')
    `).get()).toEqual({ count: 1 });
  });

  it('cancels freeroll active and finished enrollment without refunding it', () => {
    repository.createInstance(instanceCommand('freeroll-refund', {
      config: config('freeroll'),
    }));
    fundFreeroll(database, 'freeroll-refund', 100_000);
    makeRunningOpenLate(database, 'freeroll-refund');
    database.db.prepare(`
      UPDATE tournament_instance
      SET pending_late_entrants = 1
      WHERE id = 'freeroll-refund'
    `).run();
    for (const [profileId, status] of [
      ['profile-active', 'late-pending'],
      ['profile-finished', 'registered'],
    ] as const) {
      database.db.prepare(`
        INSERT INTO tournament_registration (
          instance_id, profile_id, public_player_json, status, ever_seated,
          registration_attempt, economy_entry_attempt, registered_at, updated_at
        ) VALUES (
          'freeroll-refund', ?, ?, ?, 0, 1, NULL, ?, ?
        )
      `).run(
        profileId,
        JSON.stringify({ id: profileId, name: profileId, avatar: 'sakura' }),
        status,
        NOW,
        NOW,
      );
      database.db.prepare(`
        INSERT INTO tournament_registration_attempt (
          instance_id, profile_id, registration_attempt, request_id,
          economy_entry_attempt, status, close_generation, close_owner_token,
          close_reason, created_at, updated_at
        ) VALUES (
          'freeroll-refund', ?, 1, ?, NULL, ?, NULL, NULL, NULL, ?, ?
        )
      `).run(profileId, `request-${profileId}`, status, NOW, NOW);
    }
    for (const status of ['seat-claimed', 'seated', 'finished'] as const) {
      database.db.prepare(`
        UPDATE tournament_registration
        SET status = ?,
            ever_seated = CASE WHEN ? IN ('seated', 'finished') THEN 1
                               ELSE ever_seated END,
            updated_at = ?
        WHERE instance_id = 'freeroll-refund'
          AND profile_id = 'profile-finished'
      `).run(status, status, NOW + 1);
    }

    expect(repository.claimRefundPending(
      'freeroll-refund',
      'operator-cancel',
      'freeroll-cancel',
    )).toMatchObject({
      status: 'claimed',
      instance: { pendingLateEntrants: 0 },
    });
    expect(database.db.prepare(`
      SELECT profile_id, status
      FROM tournament_registration
      WHERE instance_id = 'freeroll-refund'
      ORDER BY profile_id
    `).all()).toEqual([
      { profile_id: 'profile-active', status: 'cancelled' },
      { profile_id: 'profile-finished', status: 'cancelled' },
    ]);
    expect(database.db.prepare(`
      SELECT DISTINCT status
      FROM tournament_registration_attempt
      WHERE instance_id = 'freeroll-refund'
    `).all()).toEqual([{ status: 'cancelled' }]);
  });

  it('atomically cancels registration attempts on direct cancellation', () => {
    repository.createInstance(instanceCommand('direct-release'));
    seedProfileAndWalletEntry(database, 'direct-release');
    database.db.prepare(`
      UPDATE tournament_instance
      SET status = 'registering',
          registration_state = 'open-prestart',
          updated_at = ?
      WHERE id = 'direct-release'
    `).run(NOW + 1);
    database.db.prepare(`
      INSERT INTO tournament_registration (
        instance_id, profile_id, public_player_json, status, ever_seated,
        registration_attempt, economy_entry_attempt, registered_at, updated_at
      ) VALUES (
        'direct-release', 'profile-a',
        '{"id":"direct","name":"Direct","avatar":"sakura"}',
        'registered', 0, 1, 1, ?, ?
      )
    `).run(NOW, NOW);
    database.db.prepare(`
      INSERT INTO tournament_registration_attempt (
        instance_id, profile_id, registration_attempt, request_id,
        economy_entry_attempt, status, close_generation, close_owner_token,
        close_reason, created_at, updated_at
      ) VALUES (
        'direct-release', 'profile-a', 1, 'direct-request',
        1, 'registered', NULL, NULL, NULL, ?, ?
      )
    `).run(NOW, NOW);
    database.db.prepare(`
      UPDATE sng_entries
      SET status = 'refunded', updated_at = ?
      WHERE tournament_id = 'direct-release'
    `).run(NOW + 1);

    expect(repository.claimDirectCancellation(
      'direct-release',
      'operator-cancel',
      'direct-owner',
      NOW + 2,
    )).toMatchObject({
      status: 'claimed',
      instance: { status: 'cancelled' },
    });
    expect(database.db.prepare(`
      SELECT registration.status AS registration_status,
             attempt.status AS attempt_status
      FROM tournament_registration registration
      JOIN tournament_registration_attempt attempt
        ON attempt.instance_id = registration.instance_id
       AND attempt.profile_id = registration.profile_id
      WHERE registration.instance_id = 'direct-release'
    `).get()).toEqual({
      registration_status: 'cancelled',
      attempt_status: 'cancelled',
    });
  });

  it('blocks payout-pending cancellation and refund transitions', () => {
    repository.createInstance(instanceCommand('payout'));
    makeRunningClosed(database, 'payout');

    const plan = payoutPlan('payout', [
        {
          place: 1,
          playerId: 'player-a',
          participantType: 'human',
          profileId: 'profile-a',
          registrationAttempt: 1,
          displayName: 'A',
          prize: 1_000,
          disposition: 'wallet-credit',
        },
      ], 1_000);
    const result = repository.claimPayoutPending('payout', plan);
    expect(result).toMatchObject({
      status: 'claimed',
      instance: { status: 'payout-pending' },
    });
    expect(repository.claimPayoutPending('payout', plan)).toMatchObject({
      status: 'already-pending',
      instance: { status: 'payout-pending' },
    });

    expect(repository.claimRefundPending(
      'payout',
      'operator-cancel',
      'cancel-a',
    )).toMatchObject({ status: 'not-claimable' });
    expect(repository.claimDirectCancellation(
      'payout',
      'operator-cancel',
      'cancel-a',
      NOW + 21,
    )).toMatchObject({ status: 'not-claimable' });
  });

  it('binds a freeroll prize escrow to the immutable payout plan', () => {
    repository.createInstance(instanceCommand('freeroll-payout', {
      config: config('freeroll'),
    }));
    fundFreeroll(database, 'freeroll-payout', 100_000);
    makeFreerollRunningClosed(database, 'freeroll-payout');

    const plan = payoutPlan('freeroll-payout', [
        {
          place: 1,
          playerId: 'bot-a',
          participantType: 'bot',
          profileId: null,
          registrationAttempt: null,
          displayName: '미야코',
          prize: 100_000,
          disposition: 'promotion-return',
        },
      ], 100_000);
    expect(repository.claimPayoutPending('freeroll-payout', plan)).toMatchObject({
      status: 'claimed',
      instance: { status: 'payout-pending' },
    });
    expect(database.db.prepare(`
      SELECT settlement_fingerprint AS fingerprint
      FROM tournament_prize_escrow
      WHERE instance_id = 'freeroll-payout'
    `).get()).toEqual({ fingerprint: plan.fingerprint });
  });

  it('rejects a settlement checksum or fingerprint that differs from the freeze', () => {
    repository.createInstance(instanceCommand('payout-mismatch'));
    makeRunningClosed(database, 'payout-mismatch');
    const valid = payoutPlan('payout-mismatch', [
      {
        place: 1,
        playerId: 'player-a',
        participantType: 'human',
        profileId: 'profile-a',
        registrationAttempt: 1,
        displayName: 'A',
        prize: 1_000,
        disposition: 'wallet-credit',
      },
    ], 1_000);
    expect(() => repository.claimPayoutPending('payout-mismatch', {
      ...valid,
      checksum: 'wrong-checksum',
    })).toThrowError(TournamentPersistenceError);
    expect(() => repository.claimPayoutPending('payout-mismatch', {
      ...valid,
      fingerprint: 'wrong-fingerprint',
    })).toThrowError(TournamentPersistenceError);
    expect(database.db.prepare(`
      SELECT COUNT(*) AS count FROM tournament_settlement
      WHERE instance_id = 'payout-mismatch'
    `).get()).toEqual({ count: 0 });
  });

  it('never exposes hidden or unfunded freerolls publicly and warns admins', () => {
    repository.createInstance(instanceCommand('hidden-wallet'));
    repository.createInstance(instanceCommand('hidden-freeroll', {
      config: config('freeroll'),
    }));
    expect(repository.listPublicProjections(undefined, NOW + 1)).toEqual([]);

    database.db.prepare(`
      UPDATE tournament_instance
      SET status = 'scheduled-visible', updated_at = ?
      WHERE id = 'hidden-wallet'
    `).run(NOW + 1);
    expect(repository.listPublicProjections(undefined, NOW + 2).map(row => row.id))
      .toEqual(['hidden-wallet']);

    fundFreeroll(database, 'hidden-freeroll', 100_000);
    database.db.prepare(`
      UPDATE tournament_instance
      SET status = 'scheduled-visible', updated_at = ?
      WHERE id = 'hidden-freeroll'
    `).run(NOW + 2);
    expect(repository.listPublicProjections(undefined, NOW + 3).map(row => row.id))
      .toEqual(['hidden-freeroll', 'hidden-wallet']);

  });

  it('caps each recurring template at five public rows and keeps my engaged overflow', () => {
    const template = repository.createTemplate(templateCommand({
      recurrence: { kind: 'hourly', minute: 0 },
      recurrenceEndsAt: NOW + 2 * DAY_MS,
    }));
    const recurringIds = Array.from({ length: 6 }, (_, index) => {
      const id = `public-recurring-${index + 1}`;
      repository.createInstance(recurringInstanceCommand(
        id,
        template.id,
        template.revision,
        NOW + (index + 1) * HOUR_MS,
      ));
      return id;
    });
    for (const id of ['public-standalone-1', 'public-standalone-2']) {
      repository.createInstance(instanceCommand(id, {
        schedule: {
          visibleAt: NOW,
          registrationOpensAt: NOW + 3 * DAY_MS - 20 * 60_000,
          startsAt: NOW + 3 * DAY_MS,
          manualStartExpiresAt: null,
        },
      }));
    }
    database.db.prepare(`
      UPDATE tournament_instance
      SET status = 'scheduled-visible', updated_at = ?
    `).run(NOW + 1);
    seedProfileAndWalletEntry(database, recurringIds[5]!);
    database.db.prepare(`
      UPDATE tournament_instance
      SET status = 'registering',
          registration_state = 'open-prestart',
          updated_at = ?
      WHERE id = ?
    `).run(NOW + 2, recurringIds[5]);
    database.db.prepare(`
      INSERT INTO tournament_registration (
        instance_id, profile_id, public_player_json, status, ever_seated,
        registration_attempt, economy_entry_attempt, registered_at, updated_at
      ) VALUES (?, 'profile-a', ?, 'registered', 0, 1, 1, ?, ?)
    `).run(
      recurringIds[5],
      JSON.stringify({
        id: 'player-viewer',
        name: 'Viewer',
        avatar: 'sakura',
      }),
      NOW,
      NOW,
    );
    database.db.prepare(`
      INSERT INTO tournament_registration_attempt (
        instance_id, profile_id, registration_attempt, request_id,
        economy_entry_attempt, status, close_generation, close_owner_token,
        close_reason, created_at, updated_at
      ) VALUES (
        ?, 'profile-a', 1, 'public-overflow-registration', 1, 'registered',
        NULL, NULL, NULL, ?, ?
      )
    `).run(recurringIds[5], NOW, NOW);

    const anonymous = repository.listPublicProjections(undefined, NOW + 2);
    expect(anonymous.filter(row => row.id.startsWith('public-recurring-')))
      .toHaveLength(5);
    expect(anonymous.filter(row => row.id.startsWith('public-standalone-')))
      .toHaveLength(2);

    const personalized = repository.listPublicProjections(
      'profile-a',
      NOW + 2,
    );
    expect(personalized.filter(row => row.id.startsWith('public-recurring-')))
      .toHaveLength(6);
    expect(personalized.find(row => row.id === recurringIds[5]))
      .toMatchObject({ myRegistrationStatus: 'registered' });
  });

  it('requires exact freeroll funding and returns the canonical detail projection', () => {
    repository.createInstance(instanceCommand('detail-freeroll', {
      config: config('freeroll'),
    }));
    fundFreeroll(database, 'detail-freeroll', 99_999);
    database.db.prepare(`
      UPDATE tournament_instance
      SET status = 'scheduled-visible', updated_at = ?
      WHERE id = 'detail-freeroll'
    `).run(NOW + 2);

    expect(repository.getPublicProjection(
      'detail-freeroll',
      undefined,
      NOW + 3,
    )).toBeNull();
    expect(repository.getAdminProjection(
      'detail-freeroll',
      NOW + 3,
    )?.invariantWarnings).toContain('PROMOTION_ESCROW_AMOUNT_MISMATCH');

    repository.createInstance(instanceCommand('detail-funded', {
      config: config('freeroll'),
    }));
    fundFreeroll(database, 'detail-funded', 100_000, 'detail-funded-seed');
    database.db.prepare(`
      UPDATE tournament_instance
      SET status = 'scheduled-visible', updated_at = ?
      WHERE id = 'detail-funded'
    `).run(NOW + 3);
    const detail = repository.getPublicProjection(
      'detail-funded',
      undefined,
      NOW + 4,
    );
    expect(detail).toMatchObject({
      serverNow: NOW + 4,
      summary: {
        id: 'detail-funded',
        lifecycle: 'upcoming',
        economyMode: 'freeroll',
        registrationState: 'not-open',
        canRegister: false,
        mySeat: null,
        schedule: {
          scheduledStartsAt: NOW + 3_600_000,
        },
        structure: {
          sourcePresetId: 'standard',
          startingStack: 1_500,
        },
        payout: {
          totalPrize: 100_000,
          fundingStatus: 'promotion-reserved',
        },
        hostId: '',
      },
      entrants: [],
      standings: [],
    });
  });

  it('treats terminal enrollment as not registered and permits a clean new attempt', () => {
    repository.createInstance(instanceCommand('terminal-registration'));
    seedProfileAndWalletEntry(database, 'terminal-registration');
    database.db.prepare(`
      UPDATE tournament_instance
      SET status = 'registering',
          registration_state = 'open-prestart',
          updated_at = ?
      WHERE id = 'terminal-registration'
    `).run(NOW + 1);
    database.db.prepare(`
      INSERT INTO tournament_registration (
        instance_id, profile_id, public_player_json, status, ever_seated,
        registration_attempt, economy_entry_attempt, registered_at, updated_at
      ) VALUES (
        'terminal-registration', 'profile-a',
        '{"id":"player-a","name":"A","avatar":"sakura"}',
        'registered', 0, 1, 1, ?, ?
      )
    `).run(NOW, NOW);
    database.db.prepare(`
      INSERT INTO tournament_registration_attempt (
        instance_id, profile_id, registration_attempt, request_id,
        economy_entry_attempt, status, close_generation, close_owner_token,
        close_reason, created_at, updated_at
      ) VALUES (
        'terminal-registration', 'profile-a', 1, 'terminal-request',
        1, 'registered', NULL, NULL, NULL, ?, ?
      )
    `).run(NOW, NOW);
    database.db.prepare(`
      UPDATE tournament_registration
      SET status = 'cancelled', updated_at = ?
      WHERE instance_id = 'terminal-registration'
        AND profile_id = 'profile-a'
    `).run(NOW + 2);
    database.db.prepare(`
      UPDATE sng_entries
      SET status = 'refunded', updated_at = ?
      WHERE tournament_id = 'terminal-registration'
    `).run(NOW + 2);

    expect(repository.getPublicProjection(
      'terminal-registration',
      'profile-a',
      NOW + 2_500_000,
    )?.summary).toMatchObject({
      registered: false,
      myRegistrationStatus: 'cancelled',
      canRegister: true,
      hostId: '',
    });
  });

  it('returns canonical public summaries without raw persistence status', () => {
    repository.createInstance(instanceCommand('canonical-list'));
    database.db.prepare(`
      UPDATE tournament_instance
      SET status = 'scheduled-visible', updated_at = ?
      WHERE id = 'canonical-list'
    `).run(NOW + 1);

    const [summary] = repository.listPublicProjections(undefined, NOW + 2);
    expect(summary).toMatchObject({
      id: 'canonical-list',
      lifecycle: 'upcoming',
      economyMode: 'wallet',
      registrationState: 'not-open',
      mySeat: null,
      hostId: '',
    });
    expect(summary).not.toHaveProperty('status');
    expect(summary).not.toHaveProperty('funding');
  });

  it('enforces template lead and wallet registration window bounds', () => {
    expect(() => repository.createTemplate(templateCommand({
      visibleLeadMs: 31 * 86_400_000,
    }))).toThrowError(TournamentPersistenceError);
    expect(() => repository.createTemplate(templateCommand({
      visibleLeadMs: 60_000,
      registrationLeadMs: 120_000,
    }))).toThrowError(TournamentPersistenceError);
    expect(() => repository.createTemplate(templateCommand({
      registrationLeadMs: 20 * 60_000 + 1,
    }))).toThrowError(TournamentPersistenceError);

    expect(() => repository.createInstance(instanceCommand('wallet-long-auto', {
      schedule: {
        visibleAt: NOW,
        registrationOpensAt: NOW,
        startsAt: NOW + 20 * 60_000 + 1,
        manualStartExpiresAt: null,
      },
    }))).toThrowError(TournamentPersistenceError);
    expect(() => repository.createInstance(instanceCommand('wallet-long-manual', {
      schedule: {
        visibleAt: NOW,
        registrationOpensAt: NOW,
        startsAt: null,
        manualStartExpiresAt: NOW + 20 * 60_000 + 1,
      },
    }))).toThrowError(TournamentPersistenceError);
    expect(() => repository.createInstance(instanceCommand('freeroll-long-manual', {
      config: config('freeroll'),
      schedule: {
        visibleAt: NOW,
        registrationOpensAt: NOW,
        startsAt: null,
        manualStartExpiresAt: NOW + 6 * 60 * 60_000 + 1,
      },
    }))).toThrowError(TournamentPersistenceError);
  });

  it('rejects malformed persisted JSON instead of returning a partial record', () => {
    repository.createInstance(instanceCommand('corrupt'));
    database.db.exec(`
      DROP TRIGGER protect_tournament_instance_identity;
      UPDATE tournament_instance SET config_json = '{"version":2}';
    `);

    expect(() => repository.getInstance('corrupt')).toThrowError(
      TournamentPersistenceError,
    );
  });
});

function seedProfileAndWalletEntry(
  database: PokerDatabase,
  instanceId: string,
): void {
  database.db.prepare(`
    INSERT INTO profiles (
      id, credential_hash, credential_lookup, recovery_hash, recovery_lookup,
      alias, avatar_id, adult_confirmed_at, created_at, updated_at
    ) VALUES (
      'profile-a', 'credential-hash:a', 'credential-lookup:a',
      'recovery-hash:a', 'recovery-lookup:a', 'A', 'sakura', 1, ?, ?
    )
  `).run(NOW, NOW);
  database.db.prepare(`
    INSERT INTO sng_entries (
      id, tournament_id, room_id, profile_id, buy_in, fee, status,
      place, prize, start_attempt, entry_attempt, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, 'reserved', NULL, 0, 0, 1, ?, ?)
  `).run(
    `entry-${instanceId}`,
    instanceId,
    instanceId,
    'profile-a',
    1_500,
    150,
    NOW,
    NOW,
  );
}

function makeRunningClosed(database: PokerDatabase, instanceId: string): void {
  seedProfileAndWalletEntry(database, instanceId);
  database.db.prepare(`
    UPDATE tournament_instance
    SET status = 'registering',
        registration_state = 'open-prestart',
        updated_at = ?
    WHERE id = ?
  `).run(NOW + 1, instanceId);
  database.db.prepare(`
    INSERT INTO tournament_registration (
      instance_id, profile_id, public_player_json, status, ever_seated,
      registration_attempt, economy_entry_attempt, registered_at, updated_at
    ) VALUES (?, 'profile-a', '{"id":"player-a"}', 'registered', 0, 1, 1, ?, ?)
  `).run(instanceId, NOW, NOW);
  database.db.prepare(`
    INSERT INTO tournament_registration_attempt (
      instance_id, profile_id, registration_attempt, request_id,
      economy_entry_attempt, status, close_generation, close_owner_token,
      close_reason, created_at, updated_at
    ) VALUES (?, 'profile-a', 1, 'request-a', 1, 'registered',
      NULL, NULL, NULL, ?, ?)
  `).run(instanceId, NOW, NOW);
  database.db.prepare(`
    UPDATE tournament_registration
    SET status = 'seat-claimed', updated_at = ?
    WHERE instance_id = ? AND profile_id = 'profile-a'
  `).run(NOW + 2, instanceId);
  database.db.prepare(`
    UPDATE tournament_registration
    SET status = 'seated', ever_seated = 1, updated_at = ?
    WHERE instance_id = ? AND profile_id = 'profile-a'
  `).run(NOW + 3, instanceId);
  database.db.prepare(`
    UPDATE tournament_instance
    SET status = 'starting',
        registration_state = 'locked-for-start',
        start_attempt = 1,
        start_owner_id = 'starter',
        start_lease_until = ?,
        updated_at = ?
    WHERE id = ?
  `).run(NOW + 30_000, NOW + 4, instanceId);
  database.db.prepare(`
    UPDATE tournament_instance
    SET status = 'running',
        registration_state = 'closed',
        registration_close_reason = 'late-reg-disabled',
        registration_generation = 1,
        initial_entrants = 1,
        initial_bot_entrants = 0,
        committed_entrants = 1,
        final_entrants = 1,
        payout_freeze_version = 1,
        payout_freeze_json = '{"version":1}',
        start_owner_id = NULL,
        start_lease_until = NULL,
        actual_started_at = ?,
        updated_at = ?
    WHERE id = ?
  `).run(NOW + 5, NOW + 5, instanceId);
}

function makeFreerollRunningClosed(
  database: PokerDatabase,
  instanceId: string,
): void {
  database.db.prepare(`
    UPDATE tournament_instance
    SET status = 'registering',
        registration_state = 'open-prestart',
        updated_at = ?
    WHERE id = ?
  `).run(NOW + 1, instanceId);
  database.db.prepare(`
    UPDATE tournament_instance
    SET status = 'starting',
        registration_state = 'locked-for-start',
        start_attempt = 1,
        start_owner_id = 'starter',
        start_lease_until = ?,
        updated_at = ?
    WHERE id = ?
  `).run(NOW + 30_000, NOW + 2, instanceId);
  database.db.prepare(`
    UPDATE tournament_instance
    SET status = 'running',
        registration_state = 'closed',
        registration_close_reason = 'late-reg-disabled',
        registration_generation = 1,
        initial_entrants = 1,
        initial_bot_entrants = 1,
        committed_entrants = 1,
        final_entrants = 1,
        payout_freeze_version = 1,
        payout_freeze_json = '{"version":1}',
        start_owner_id = NULL,
        start_lease_until = NULL,
        actual_started_at = ?,
        updated_at = ?
    WHERE id = ?
  `).run(NOW + 3, NOW + 3, instanceId);
}

function makeRunningOpenLate(database: PokerDatabase, instanceId: string): void {
  database.db.prepare(`
    UPDATE tournament_instance
    SET status = 'registering',
        registration_state = 'open-prestart',
        updated_at = ?
    WHERE id = ?
  `).run(NOW + 1, instanceId);
  database.db.prepare(`
    UPDATE tournament_instance
    SET status = 'starting',
        registration_state = 'locked-for-start',
        start_attempt = 1,
        start_owner_id = 'starter',
        start_lease_until = ?,
        updated_at = ?
    WHERE id = ?
  `).run(NOW + 30_000, NOW + 2, instanceId);
  database.db.prepare(`
    UPDATE tournament_instance
    SET status = 'running',
        registration_state = 'open-late',
        initial_entrants = 8,
        initial_bot_entrants = 0,
        committed_entrants = 8,
        start_owner_id = NULL,
        start_lease_until = NULL,
        actual_started_at = ?,
        updated_at = ?
    WHERE id = ?
  `).run(NOW + 3, NOW + 3, instanceId);
}

function fundFreeroll(
  database: PokerDatabase,
  instanceId: string,
  amount: number,
  seedKey = 'fund-seed',
): void {
  database.db.prepare(`
    INSERT INTO promotion_fund_ledger (
      id, account_id, kind, delta, balance_after, instance_id,
      actor_kind, actor_id, reason, idempotency_key, created_at
    ) VALUES (
      ?, 'global', 'admin-adjustment', ?, ?, NULL,
      'backoffice-admin', 'admin-1', 'test promotion seed',
      ?, ?
    )
  `).run(seedKey, amount, amount, `${seedKey}-request`, NOW);
  database.db.prepare(`
    INSERT INTO promotion_fund_ledger (
      id, account_id, kind, delta, balance_after, instance_id,
      actor_kind, actor_id, reason, idempotency_key, created_at
    ) VALUES (
      ?, 'global', 'freeroll-prize-reserve', ?, 0, ?,
      'system', 'scheduler', 'reserve tournament prize',
      ?, ?
    )
  `).run(
    `reserve-${instanceId}`,
    -amount,
    instanceId,
    `reserve-request-${instanceId}`,
    NOW + 1,
  );
  database.db.prepare(`
    INSERT INTO tournament_prize_escrow (
      instance_id, account_id, amount, status, human_paid, bot_returned,
      settlement_fingerprint, reserved_at, settled_at, refunded_at, updated_at
    ) VALUES (?, 'global', ?, 'reserved', 0, 0, NULL, ?, NULL, NULL, ?)
  `).run(instanceId, amount, NOW + 1, NOW + 1);
}

function payoutPlan(
  instanceId: string,
  results: TournamentPayoutFreezePlan['results'],
  prizePool: number,
): TournamentPayoutFreezePlan {
  const checksum = computeTournamentPayoutFreezeChecksum({ version: 1 });
  const fingerprint = computeTournamentSettlementFingerprint({
    instanceId,
    configVersion: 2,
    payoutFreezeVersion: 1,
    payoutFreezeChecksum: checksum,
    prizePool,
    results,
  });
  return {
    version: 1,
    checksum,
    prizePool,
    fingerprint,
    results,
    now: NOW + 20,
  };
}
