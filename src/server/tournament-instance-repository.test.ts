import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { TournamentConfigSnapshotV2 } from '@/lib/tournament/tournament-config';
import { openPokerDatabase, type PokerDatabase } from './persistence/database';
import {
  TournamentInstanceRepository,
  TournamentPersistenceError,
  type CreateInstanceCommand,
  type CreateTemplateCommand,
} from './tournament-instance-repository';

const NOW = 1_800_000_000_000;

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
    visibleLeadMs: 86_400_000,
    registrationLeadMs: 3_600_000,
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
      registrationOpensAt: NOW + 120_000,
      startsAt: NOW + 3_600_000,
      manualStartExpiresAt: null,
    },
    config: config(),
    createdBy: { kind: 'backoffice-admin', profileId: 'admin-1' },
    now: NOW,
    ...overrides,
  };
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

    const standalone = instanceCommand('standalone');
    expect(repository.createInstance(standalone)).toEqual(
      repository.createInstance(standalone),
    );

    const recurring = instanceCommand('weekly-1', {
      templateId: template.id,
      templateRevision: template.revision,
      idempotencyKey: 'template:template-main:r1:1800003600000',
      occurrenceKey: '1800003600000',
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
      record: { revision: 2, name: '토요일 메인', enabled: false },
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

  it('replaces hidden old-revision occurrences but preserves visible occupancy', () => {
    const template = repository.createTemplate(templateCommand());
    repository.createInstance(instanceCommand('hidden-old', {
      templateId: template.id,
      templateRevision: 1,
      occurrenceKey: '1800003600000',
      idempotencyKey: 'template:template-main:r1:1800003600000',
    }));
    repository.createInstance(instanceCommand('visible-old', {
      templateId: template.id,
      templateRevision: 1,
      occurrenceKey: '1800007200000',
      idempotencyKey: 'template:template-main:r1:1800007200000',
    }));
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
        instanceCommand('hidden-new', {
          templateId: template.id,
          templateRevision: 2,
          occurrenceKey: '1800003600000',
          idempotencyKey: 'template:template-main:r2:1800003600000',
          now: NOW + 2,
        }),
        instanceCommand('visible-new', {
          templateId: template.id,
          templateRevision: 2,
          occurrenceKey: '1800007200000',
          idempotencyKey: 'template:template-main:r2:1800007200000',
          now: NOW + 2,
        }),
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
      'cancel-a',
      NOW + 10,
    )).toThrowError(TournamentPersistenceError);

    database.db.prepare(`
      UPDATE sng_entries
      SET status = 'refunded', updated_at = ?
      WHERE tournament_id = 'wallet-liability'
    `).run(NOW + 11);
    expect(repository.finishCancellation(
      'wallet-liability',
      'cancel-a',
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

  it('blocks payout-pending cancellation and refund transitions', () => {
    repository.createInstance(instanceCommand('payout'));
    makeRunningClosed(database, 'payout');

    const result = repository.claimPayoutPending('payout', {
      version: 1,
      checksum: 'freeze-checksum',
      prizePool: 1_000,
      fingerprint: 'settlement-fingerprint',
      results: [
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
      ],
      now: NOW + 20,
    });
    expect(result).toMatchObject({
      status: 'claimed',
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

    expect(repository.claimPayoutPending('freeroll-payout', {
      version: 1,
      checksum: 'freeroll-freeze',
      prizePool: 100_000,
      fingerprint: 'freeroll-settlement',
      results: [
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
      ],
      now: NOW + 20,
    })).toMatchObject({
      status: 'claimed',
      instance: { status: 'payout-pending' },
    });
    expect(database.db.prepare(`
      SELECT settlement_fingerprint AS fingerprint
      FROM tournament_prize_escrow
      WHERE instance_id = 'freeroll-payout'
    `).get()).toEqual({ fingerprint: 'freeroll-settlement' });
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

    database.db.exec(`
      DROP TRIGGER require_tournament_financial_lifecycle;
      DROP TRIGGER protect_tournament_prize_escrow_update;
      UPDATE tournament_prize_escrow
      SET status = 'refunded', refunded_at = ${NOW + 4}, updated_at = ${NOW + 4}
      WHERE instance_id = 'hidden-freeroll';
    `);
    expect(repository.getPublicProjection(
      'hidden-freeroll',
      undefined,
      NOW + 5,
    )).toBeNull();

    const admin = repository.getAdminProjection('hidden-freeroll', NOW + 5);
    expect(admin).toMatchObject({
      id: 'hidden-freeroll',
      funding: { status: 'refunded', amount: 100_000 },
      registrationGeneration: 0,
    });
    expect(admin?.invariantWarnings).toContain('PUBLIC_FREEROLL_NOT_RESERVED');
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
  `).run(NOW + 3, NOW + 3, instanceId);
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
    UPDATE tournament_registration_attempt
    SET status = 'seat-claimed', updated_at = ?
    WHERE instance_id = ? AND profile_id = 'profile-a'
  `).run(NOW + 1, instanceId);
  database.db.prepare(`
    UPDATE tournament_registration
    SET status = 'seat-claimed', updated_at = ?
    WHERE instance_id = ? AND profile_id = 'profile-a'
  `).run(NOW + 2, instanceId);
  database.db.prepare(`
    UPDATE tournament_registration_attempt
    SET status = 'seated', updated_at = ?
    WHERE instance_id = ? AND profile_id = 'profile-a'
  `).run(NOW + 2, instanceId);
  database.db.prepare(`
    UPDATE tournament_registration
    SET status = 'seated', ever_seated = 1, updated_at = ?
    WHERE instance_id = ? AND profile_id = 'profile-a'
  `).run(NOW + 3, instanceId);
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
): void {
  database.db.prepare(`
    INSERT INTO promotion_fund_ledger (
      id, account_id, kind, delta, balance_after, instance_id,
      actor_kind, actor_id, reason, idempotency_key, created_at
    ) VALUES (
      'fund-seed', 'global', 'admin-adjustment', ?, ?, NULL,
      'backoffice-admin', 'admin-1', 'test promotion seed',
      'fund-seed-request', ?
    )
  `).run(amount, amount, NOW);
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
