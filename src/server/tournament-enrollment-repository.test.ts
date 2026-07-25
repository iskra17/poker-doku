import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type {
  TournamentConfigSnapshotV2,
} from '@/lib/tournament/tournament-config';
import { EconomyRepository } from './economy-repository';
import type { PokerDatabase } from './persistence/database';
import { openPokerDatabase } from './persistence/database';
import {
  TournamentEnrollmentError,
  TournamentEnrollmentRepository,
} from './tournament-enrollment-repository';
import { TournamentInstanceRepository } from './tournament-instance-repository';

const NOW = 1_800_000_000_000;

let database: PokerDatabase;
let economy: EconomyRepository;
let enrollment: TournamentEnrollmentRepository;
let instances: TournamentInstanceRepository;

beforeEach(() => {
  database = openPokerDatabase(':memory:');
  economy = new EconomyRepository(database);
  enrollment = new TournamentEnrollmentRepository(database, economy, () => NOW);
  instances = new TournamentInstanceRepository(database, () => NOW);
});

afterEach(() => {
  database.close();
});

describe('TournamentEnrollmentRepository', () => {
  it('registers a prestart wallet debit and registration atomically', () => {
    createOpenInstance('wallet-prestart', walletConfig({ buyIn: 777, fee: 33 }));
    seedProfile('wallet-player', 2_000);

    const result = enrollment.registerPreStart({
      tournamentId: 'wallet-prestart',
      profileId: 'wallet-player',
      requestId: 'wallet-request-1',
      publicPlayer: player('wallet-player'),
      at: NOW,
    });

    expect(result).toMatchObject({
      status: 'reserved',
      key: {
        profileId: 'wallet-player',
        economyMode: 'wallet',
        requestId: 'wallet-request-1',
        registrationAttempt: 1,
        economyEntryAttempt: 1,
      },
    });
    expect(balanceOf('wallet-player')).toBe(1_190);
    expect(database.db.prepare(`
      SELECT status, registration_attempt, economy_entry_attempt
      FROM tournament_registration
      WHERE instance_id = 'wallet-prestart' AND profile_id = 'wallet-player'
    `).get()).toEqual({
      status: 'registered',
      registration_attempt: 1,
      economy_entry_attempt: 1,
    });
    expect(database.db.prepare(`
      SELECT buy_in, fee, status, entry_attempt
      FROM sng_entries
      WHERE tournament_id = 'wallet-prestart' AND profile_id = 'wallet-player'
    `).get()).toEqual({
      buy_in: 777,
      fee: 33,
      status: 'reserved',
      entry_attempt: 1,
    });
  });

  it('registers a freeroll without a debit but with the same cap claim', () => {
    createOpenInstance('freeroll-prestart', freerollConfig());
    seedProfile('freeroll-player', 2_000);

    const result = enrollment.registerPreStart({
      tournamentId: 'freeroll-prestart',
      profileId: 'freeroll-player',
      requestId: 'freeroll-request-1',
      publicPlayer: player('freeroll-player'),
      at: NOW,
    });

    expect(result).toMatchObject({
      status: 'reserved',
      key: {
        economyMode: 'freeroll',
        registrationAttempt: 1,
      },
    });
    expect(balanceOf('freeroll-player')).toBe(2_000);
    expect(database.db.prepare(`
      SELECT economy_entry_attempt, status
      FROM tournament_registration
      WHERE instance_id = 'freeroll-prestart'
        AND profile_id = 'freeroll-player'
    `).get()).toEqual({
      economy_entry_attempt: null,
      status: 'registered',
    });
    expect(database.db.prepare(`
      SELECT COUNT(*) AS count FROM sng_entries
      WHERE tournament_id = 'freeroll-prestart'
    `).get()).toEqual({ count: 0 });
  });

  it('replays one request id without another attempt debit or cap claim', () => {
    createOpenInstance('replay-prestart', walletConfig());
    seedProfile('replay-player', 5_000);
    const input = {
      tournamentId: 'replay-prestart',
      profileId: 'replay-player',
      requestId: 'replay-request-1',
      publicPlayer: player('replay-player'),
      at: NOW,
    } as const;

    const first = enrollment.registerPreStart(input);
    const second = enrollment.registerPreStart(input);

    expect(second).toEqual(first);
    expect(balanceOf('replay-player')).toBe(5_000 - 1_650);
    expect(database.db.prepare(`
      SELECT COUNT(*) AS count FROM tournament_registration_attempt
      WHERE instance_id = 'replay-prestart' AND profile_id = 'replay-player'
    `).get()).toEqual({ count: 1 });
    expect(database.db.prepare(`
      SELECT COUNT(*) AS count FROM sng_entries
      WHERE tournament_id = 'replay-prestart' AND profile_id = 'replay-player'
    `).get()).toEqual({ count: 1 });
  });

  it('permits attempt two only after attempt one is terminal', () => {
    createOpenInstance('attempt-prestart', walletConfig());
    seedProfile('attempt-player', 5_000);
    const first = enrollment.registerPreStart({
      tournamentId: 'attempt-prestart',
      profileId: 'attempt-player',
      requestId: 'attempt-request-1',
      publicPlayer: player('attempt-player'),
      at: NOW,
    });
    expect(() => enrollment.registerPreStart({
      tournamentId: 'attempt-prestart',
      profileId: 'attempt-player',
      requestId: 'attempt-request-2',
      publicPlayer: player('attempt-player'),
      at: NOW + 1,
    })).toThrowError(TournamentEnrollmentError);

    const firstKey = expectWalletKey(first);
    database.transaction(() => {
      economy.refundMttEntryInTransaction(
        firstKey.entryId,
        firstKey.economyEntryAttempt,
        'SNG_ENTRY_REFUND',
        NOW + 2,
      );
      database.db.prepare(`
        UPDATE tournament_registration
        SET status = 'refunded', updated_at = ?
        WHERE instance_id = 'attempt-prestart'
          AND profile_id = 'attempt-player'
      `).run(NOW + 2);
    });
    const second = enrollment.registerPreStart({
      tournamentId: 'attempt-prestart',
      profileId: 'attempt-player',
      requestId: 'attempt-request-2',
      publicPlayer: player('attempt-player'),
      at: NOW + 3,
    });

    expect(second).toMatchObject({
      status: 'reserved',
      key: {
        registrationAttempt: 2,
        economyEntryAttempt: 2,
      },
    });
    expect(database.db.prepare(`
      SELECT COUNT(*) AS count FROM tournament_registration_attempt
      WHERE instance_id = 'attempt-prestart' AND profile_id = 'attempt-player'
    `).get()).toEqual({ count: 2 });
  });

  it('rejects stale late commit release and economy refund attempts', () => {
    createRunningOpenLate('late-attempts');
    seedProfile('late-player', 5_000);
    const first = enrollment.reserveLateMttEntry(
      'late-player',
      'late-attempts',
      'late-request-1',
      'close-owner-1',
    );
    expect(first.status).toBe('reserved');
    const firstKey = expectWalletKey(first);
    expect(enrollment.releaseLateMttEntry(
      'late-attempts',
      firstKey,
      null,
    )).toMatchObject({ status: 'released' });
    const second = enrollment.reserveLateMttEntry(
      'late-player',
      'late-attempts',
      'late-request-2',
      'close-owner-2',
    );
    const secondKey = expectWalletKey(second);

    expect(() => enrollment.commitLateMttBatch(
      'late-attempts',
      [firstKey],
    )).toThrowError(TournamentEnrollmentError);
    expect(() => enrollment.releaseLateMttEntry(
      'late-attempts',
      firstKey,
      null,
    )).toThrowError(TournamentEnrollmentError);
    expect(() => database.transaction(() => economy.refundMttEntryInTransaction(
      secondKey.entryId,
      firstKey.economyEntryAttempt,
      'SNG_ENTRY_REFUND',
      NOW + 10,
    ))).toThrow();
    expect(database.db.prepare(`
      SELECT status, registration_attempt, economy_entry_attempt
      FROM tournament_registration
      WHERE instance_id = 'late-attempts' AND profile_id = 'late-player'
    `).get()).toEqual({
      status: 'late-pending',
      registration_attempt: 2,
      economy_entry_attempt: 2,
    });
  });

  it('claims and rolls back a starting roster without wallet side effects', () => {
    createOpenInstance('starting-roster', walletConfig());
    for (const id of ['checked-in', 'no-show']) {
      seedProfile(id, 5_000);
      enrollment.registerPreStart({
        tournamentId: 'starting-roster',
        profileId: id,
        requestId: `${id}-request`,
        publicPlayer: player(id),
        at: NOW,
      });
    }
    database.db.prepare(`
      UPDATE tournament_instance
      SET status = 'starting', registration_state = 'locked-for-start',
          start_attempt = 1, start_owner_id = 'starter',
          start_lease_until = ?, updated_at = ?
      WHERE id = 'starting-roster'
    `).run(NOW + 30_000, NOW + 1);

    const claim = enrollment.claimStartingRoster({
      tournamentId: 'starting-roster',
      ownerId: 'starter',
      startAttempt: 1,
      checkedInProfileIds: ['checked-in'],
      at: NOW + 2,
    });
    expect(claim.entries.map(entry => entry.profileId)).toEqual(['checked-in']);
    expect(database.db.prepare(`
      SELECT status FROM tournament_registration
      WHERE instance_id = 'starting-roster' AND profile_id = 'checked-in'
    `).get()).toEqual({ status: 'seat-claimed' });
    expect(database.db.prepare(`
      SELECT status FROM tournament_registration
      WHERE instance_id = 'starting-roster' AND profile_id = 'no-show'
    `).get()).toEqual({ status: 'refunded' });
    const checkedBalance = balanceOf('checked-in');

    enrollment.rollbackStartClaim({
      tournamentId: 'starting-roster',
      ownerId: 'starter',
      startAttempt: 1,
      at: NOW + 3,
    });
    expect(database.db.prepare(`
      SELECT status FROM tournament_registration
      WHERE instance_id = 'starting-roster' AND profile_id = 'checked-in'
    `).get()).toEqual({ status: 'registered' });
    expect(balanceOf('checked-in')).toBe(checkedBalance);
  });
});

function createOpenInstance(
  id: string,
  config: TournamentConfigSnapshotV2,
): void {
  instances.createInstance({
    id,
    templateId: null,
    templateRevision: null,
    idempotencyKey: `instance:${id}`,
    occurrenceKey: id,
    schedule: {
      visibleAt: NOW - 10_000,
      registrationOpensAt: NOW - 5_000,
      startsAt: NOW + 300_000,
      manualStartExpiresAt: null,
    },
    config,
    createdBy: { kind: 'system', profileId: null },
    now: NOW - 20_000,
  });
  if (config.economy.mode === 'freeroll') {
    fundFreeroll(id, config.prizePool.kind === 'promotion-funded'
      ? config.prizePool.totalPrize
      : 0);
  }
  database.db.prepare(`
    UPDATE tournament_instance
    SET status = 'registering', registration_state = 'open-prestart',
        updated_at = ?
    WHERE id = ?
  `).run(NOW - 1, id);
}

function createRunningOpenLate(id: string): void {
  createOpenInstance(id, walletConfig({
    maxEntrants: 4,
    lateRegistration: true,
  }));
  database.db.exec(`
    UPDATE tournament_instance
    SET status = 'starting', registration_state = 'locked-for-start',
        start_attempt = 1, start_owner_id = 'starter',
        start_lease_until = ${NOW + 30_000}, updated_at = ${NOW}
    WHERE id = '${id}';
    UPDATE tournament_instance
    SET status = 'running', registration_state = 'open-late',
        initial_entrants = 2, initial_bot_entrants = 0,
        committed_entrants = 2, actual_started_at = ${NOW},
        start_owner_id = NULL, start_lease_until = NULL,
        updated_at = ${NOW}
    WHERE id = '${id}';
  `);
}

function walletConfig(
  overrides: {
    buyIn?: number;
    fee?: number;
    maxEntrants?: number;
    lateRegistration?: boolean;
  } = {},
): TournamentConfigSnapshotV2 {
  return {
    ...baseConfig(),
    economy: {
      mode: 'wallet',
      productVersion: 7,
      buyIn: overrides.buyIn ?? 1_500,
      fee: overrides.fee ?? 150,
    },
    field: {
      minEntrants: 2,
      maxEntrants: overrides.maxEntrants ?? 6,
      botFillToMinimum: false,
    },
    prizePool: { kind: 'entry-pool' },
    lateRegistration: overrides.lateRegistration
      ? { enabled: true, durationLevels: 2, minStartingStackBb: 20 }
      : { enabled: false, durationLevels: 0, minStartingStackBb: 20 },
  };
}

function freerollConfig(): TournamentConfigSnapshotV2 {
  return {
    ...baseConfig(),
    economy: { mode: 'freeroll', promotionAccountId: 'global' },
    field: { minEntrants: 2, maxEntrants: 6, botFillToMinimum: true },
    prizePool: { kind: 'promotion-funded', totalPrize: 10_000 },
  };
}

function baseConfig(): TournamentConfigSnapshotV2 {
  return {
    version: 2,
    name: 'Enrollment Test',
    economy: {
      mode: 'wallet',
      productVersion: 7,
      buyIn: 1_500,
      fee: 150,
    },
    tableSize: 6,
    field: { minEntrants: 2, maxEntrants: 6, botFillToMinimum: false },
    turnTimeSeconds: 15,
    structure: {
      sourcePresetId: 'standard',
      startingStack: 1_500,
      segments: [
        {
          kind: 'level',
          durationMs: 300_000,
          smallBlind: 10,
          bigBlind: 20,
          bigBlindAnte: 0,
        },
      ],
    },
    prizePool: { kind: 'entry-pool' },
    payout: {
      tableVersion: 2,
      presetId: 'standard',
      paidFieldPercent: 15,
    },
    lateRegistration: {
      enabled: false,
      durationLevels: 0,
      minStartingStackBb: 20,
    },
  };
}

function seedProfile(id: string, balance: number): void {
  database.db.prepare(`
    INSERT INTO profiles (
      id, credential_hash, credential_lookup, recovery_hash, recovery_lookup,
      alias, avatar_id, adult_confirmed_at, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, 'sakura', ?, ?, ?)
  `).run(
    id,
    `credential-hash:${id}`,
    `credential-lookup:${id}`,
    `recovery-hash:${id}`,
    `recovery-lookup:${id}`,
    id,
    NOW,
    NOW,
    NOW,
  );
  database.db.prepare(`
    INSERT INTO wallets (profile_id, balance, updated_at) VALUES (?, ?, ?)
  `).run(id, balance, NOW);
}

function balanceOf(id: string): number {
  return (database.db.prepare(`
    SELECT balance FROM wallets WHERE profile_id = ?
  `).get(id) as { balance: number }).balance;
}

function player(id: string): { id: string; name: string; avatar: string } {
  return { id, name: id, avatar: 'sakura' };
}

function fundFreeroll(instanceId: string, amount: number): void {
  database.db.exec(`
    INSERT INTO promotion_fund_ledger (
      id, account_id, kind, delta, balance_after, instance_id,
      actor_kind, actor_id, reason, idempotency_key, created_at
    ) VALUES (
      'seed:${instanceId}', 'global', 'admin-adjustment',
      ${amount}, ${amount}, NULL, 'backoffice-admin', 'admin',
      'seed funds', 'seed-request:${instanceId}', ${NOW - 3}
    );
    INSERT INTO promotion_fund_ledger (
      id, account_id, kind, delta, balance_after, instance_id,
      actor_kind, actor_id, reason, idempotency_key, created_at
    ) VALUES (
      'reserve:${instanceId}', 'global', 'freeroll-prize-reserve',
      -${amount}, 0, '${instanceId}', 'system', 'scheduler',
      'reserve', 'reserve-request:${instanceId}', ${NOW - 2}
    );
    INSERT INTO tournament_prize_escrow (
      instance_id, account_id, amount, status, human_paid, bot_returned,
      settlement_fingerprint, reserved_at, settled_at, refunded_at, updated_at
    ) VALUES (
      '${instanceId}', 'global', ${amount}, 'reserved', 0, 0,
      NULL, ${NOW - 2}, NULL, NULL, ${NOW - 2}
    );
  `);
}

function expectWalletKey(result: {
  status: string;
  key?: unknown;
}): {
  profileId: string;
  economyMode: 'wallet';
  requestId: string;
  registrationAttempt: number;
  economyEntryAttempt: number;
  entryId: string;
} {
  if (
    result.status !== 'reserved'
    || !result.key
    || (result.key as { economyMode?: string }).economyMode !== 'wallet'
  ) {
    throw new Error('expected wallet reservation');
  }
  return result.key as ReturnType<typeof expectWalletKey>;
}
