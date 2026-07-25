import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { TournamentConfigSnapshotV2 } from '@/lib/tournament/tournament-config';
import { openPokerDatabase, type PokerDatabase } from './persistence/database';
import {
  PromotionFundError,
  PromotionFundRepository,
  type PromotionFundActor,
} from './promotion-fund-repository';
import {
  TournamentInstanceRepository,
  computeTournamentPayoutFreezeChecksum,
  computeTournamentSettlementFingerprint,
  type CreateInstanceCommand,
  type TournamentPayoutFreezePlan,
} from './tournament-instance-repository';

const NOW = Date.now();
const ADMIN: PromotionFundActor = {
  kind: 'backoffice-admin',
  id: 'admin-test',
};
const SYSTEM: PromotionFundActor = {
  kind: 'system',
  id: 'tournament-scheduler',
};

function freerollConfig(totalPrize = 100_000): TournamentConfigSnapshotV2 {
  return {
    version: 2,
    name: '주말 프리롤',
    economy: { mode: 'freeroll', promotionAccountId: 'global' },
    tableSize: 6,
    field: { minEntrants: 8, maxEntrants: 24, botFillToMinimum: true },
    turnTimeSeconds: 15,
    structure: {
      sourcePresetId: 'standard',
      startingStack: 1_500,
      segments: [{
        kind: 'level',
        durationMs: 480_000,
        smallBlind: 10,
        bigBlind: 20,
        bigBlindAnte: 0,
      }],
    },
    prizePool: { kind: 'promotion-funded', totalPrize },
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

describe('PromotionFundRepository', () => {
  let database: PokerDatabase;
  let funds: PromotionFundRepository;
  let instances: TournamentInstanceRepository;

  beforeEach(() => {
    database = openPokerDatabase(':memory:');
    funds = new PromotionFundRepository(database);
    instances = new TournamentInstanceRepository(database, () => NOW);
  });

  afterEach(() => database.close());

  function freerollCommand(
    id: string,
    options: {
      totalPrize?: number;
      visibleAt?: number;
      registrationOpensAt?: number;
    } = {},
  ): CreateInstanceCommand {
    const visibleAt = options.visibleAt ?? NOW;
    return {
      id,
      templateId: null,
      templateRevision: null,
      idempotencyKey: `create-${id}`,
      occurrenceKey: id,
      schedule: {
        visibleAt,
        registrationOpensAt: options.registrationOpensAt ?? visibleAt,
        startsAt: visibleAt + 3_600_000,
        manualStartExpiresAt: null,
      },
      config: freerollConfig(options.totalPrize),
      createdBy: { kind: 'backoffice-admin', profileId: 'admin-test' },
      now: NOW,
    };
  }

  function createFreeroll(
    id: string,
    options: {
      totalPrize?: number;
      visibleAt?: number;
      registrationOpensAt?: number;
    } = {},
  ): void {
    instances.createInstance(freerollCommand(id, options));
  }

  function credit(amount = 500_000, requestId = randomUUID()) {
    return funds.adjustFund({
      requestId,
      delta: amount,
      reason: 'Initial promotion funding',
      actor: ADMIN,
      at: NOW,
    });
  }

  function walletBalance(profileId: string): number {
    return (database.db.prepare(`
      SELECT balance FROM wallets WHERE profile_id = ?
    `).get(profileId) as { balance: number }).balance;
  }

  function prepareFreerollSettlement(
    instanceId: string,
    playerAResultId = 'player-a',
  ): void {
    credit();
    funds.createImmediateFreeroll({
      instance: freerollCommand(instanceId),
      idempotencyKey: randomUUID(),
      actor: ADMIN,
      at: NOW,
    });
    for (const [profileId, playerId] of [
      ['profile-a', 'player-a'],
      ['profile-b', 'player-b'],
    ] as const) {
      database.db.prepare(`
        INSERT INTO profiles (
          id, credential_hash, credential_lookup, recovery_hash, recovery_lookup,
          alias, avatar_id, adult_confirmed_at, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, 'sakura', 1, ?, ?)
      `).run(
        profileId,
        `credential:${profileId}`,
        `lookup:${profileId}`,
        `recovery:${profileId}`,
        `recovery-lookup:${profileId}`,
        profileId,
        NOW,
        NOW,
      );
      database.db.prepare(`
        INSERT INTO wallets (profile_id, balance, updated_at) VALUES (?, 0, ?)
      `).run(profileId, NOW);
      database.db.prepare(`
        INSERT INTO tournament_registration (
          instance_id, profile_id, public_player_json, status, ever_seated,
          registration_attempt, economy_entry_attempt, registered_at, updated_at
        ) VALUES (?, ?, ?, 'registered', 0, 1, NULL, ?, ?)
      `).run(
        instanceId,
        profileId,
        JSON.stringify({ id: playerId }),
        NOW,
        NOW,
      );
      database.db.prepare(`
        INSERT INTO tournament_registration_attempt (
          instance_id, profile_id, registration_attempt, request_id,
          economy_entry_attempt, status, close_generation, close_owner_token,
          close_reason, created_at, updated_at
        ) VALUES (?, ?, 1, ?, NULL, 'registered', NULL, NULL, NULL, ?, ?)
      `).run(instanceId, profileId, `request-${profileId}`, NOW, NOW);
      database.db.prepare(`
        UPDATE tournament_registration
        SET status = 'seat-claimed', updated_at = ?
        WHERE instance_id = ? AND profile_id = ?
      `).run(NOW + 1, instanceId, profileId);
      database.db.prepare(`
        UPDATE tournament_registration
        SET status = 'seated', ever_seated = 1, updated_at = ?
        WHERE instance_id = ? AND profile_id = ?
      `).run(NOW + 2, instanceId, profileId);
    }
    database.db.prepare(`
      UPDATE tournament_instance
      SET status = 'starting',
          registration_state = 'locked-for-start',
          start_attempt = 1,
          start_owner_id = 'starter',
          start_lease_until = ?,
          updated_at = ?
      WHERE id = ?
    `).run(NOW + 60_000, NOW + 3, instanceId);
    const freeze = {
      version: 1,
      finalEntrants: 3,
      prizePool: 100_000,
      payouts: [
        { place: 1, amount: 50_000 },
        { place: 2, amount: 30_000 },
        { place: 3, amount: 20_000 },
      ],
    };
    database.db.prepare(`
      UPDATE tournament_instance
      SET status = 'running',
          registration_state = 'closed',
          registration_close_reason = 'late-reg-disabled',
          registration_generation = 1,
          initial_entrants = 3,
          initial_bot_entrants = 1,
          committed_entrants = 3,
          final_entrants = 3,
          payout_freeze_version = 1,
          payout_freeze_json = ?,
          start_owner_id = NULL,
          start_lease_until = NULL,
          actual_started_at = ?,
          updated_at = ?
      WHERE id = ?
    `).run(JSON.stringify(freeze), NOW + 4, NOW + 4, instanceId);
    const results: TournamentPayoutFreezePlan['results'] = [
      {
        place: 1,
        playerId: 'bot-a',
        participantType: 'bot',
        profileId: null,
        registrationAttempt: null,
        displayName: '미야코',
        prize: 50_000,
        disposition: 'promotion-return',
      },
      {
        place: 2,
        playerId: playerAResultId,
        participantType: 'human',
        profileId: 'profile-a',
        registrationAttempt: 1,
        displayName: 'A',
        prize: 30_000,
        disposition: 'wallet-credit',
      },
      {
        place: 3,
        playerId: 'player-b',
        participantType: 'human',
        profileId: 'profile-b',
        registrationAttempt: 1,
        displayName: 'B',
        prize: 20_000,
        disposition: 'wallet-credit',
      },
    ];
    const checksum = computeTournamentPayoutFreezeChecksum(freeze);
    const plan: TournamentPayoutFreezePlan = {
      version: 1,
      checksum,
      prizePool: 100_000,
      results,
      fingerprint: computeTournamentSettlementFingerprint({
        instanceId,
        configVersion: 2,
        payoutFreezeVersion: 1,
        payoutFreezeChecksum: checksum,
        prizePool: 100_000,
        results,
      }),
      now: NOW + 5,
    };
    expect(instances.claimPayoutPending(instanceId, plan)).toMatchObject({
      status: 'claimed',
      instance: { status: 'payout-pending' },
    });
  }

  it('starts the global promotion account at zero', () => {
    expect(funds.getFundPage({ limit: 10 })).toEqual({
      accountId: 'global',
      availableBalance: 0,
      reservedTotal: 0,
      version: 0,
      updatedAt: 0,
      ledger: [],
      nextCursor: null,
    });
  });

  it('adjusts once per uuid and rejects a different replay', () => {
    const requestId = randomUUID();
    const first = credit(250_000, requestId);
    expect(first).toMatchObject({
      replayed: false,
      account: { availableBalance: 250_000, version: 1 },
      ledger: {
        kind: 'admin-adjustment',
        delta: 250_000,
        balanceAfter: 250_000,
        idempotencyKey: requestId,
      },
    });
    expect(credit(250_000, requestId)).toMatchObject({
      replayed: true,
      ledger: { id: first.ledger.id },
      account: { availableBalance: 250_000, version: 1 },
    });
    expect(() => funds.adjustFund({
      requestId,
      delta: 250_001,
      reason: 'Initial promotion funding',
      actor: ADMIN,
      at: NOW + 1,
    })).toThrowError(PromotionFundError);
    expect(funds.getFundPage({ limit: 10 }).ledger).toHaveLength(1);
  });

  it('rejects a negative available balance and invalid reason', () => {
    expect(() => funds.adjustFund({
      requestId: randomUUID(),
      delta: -1,
      reason: 'Fund debit',
      actor: ADMIN,
      at: NOW,
    })).toThrowError(expect.objectContaining({ code: 'promotion-insufficient' }));
    expect(() => funds.adjustFund({
      requestId: randomUUID(),
      delta: 1,
      reason: 'bad',
      actor: ADMIN,
      at: NOW,
    })).toThrowError(expect.objectContaining({ code: 'invalid-input' }));
  });

  it('reserves an immediate freeroll before exposing it', () => {
    credit();
    const result = funds.createImmediateFreeroll({
      instance: freerollCommand('immediate'),
      idempotencyKey: randomUUID(),
      actor: ADMIN,
      at: NOW,
    });
    expect(result.escrow).toMatchObject({
      instanceId: 'immediate',
      amount: 100_000,
      status: 'reserved',
    });
    expect(result.instance).toMatchObject({
      status: 'registering',
      registrationState: 'open-prestart',
    });
    expect(funds.getFundPage({ limit: 10 })).toMatchObject({
      availableBalance: 400_000,
      reservedTotal: 100_000,
      version: 2,
    });
  });

  it('rolls immediate creation, debit, ledger, and escrow back together', () => {
    credit();
    database.db.exec(`
      CREATE TRIGGER injected_immediate_escrow_failure
      BEFORE INSERT ON tournament_prize_escrow
      BEGIN
        SELECT RAISE(ABORT, 'injected escrow failure');
      END;
    `);

    expect(() => funds.createImmediateFreeroll({
      instance: freerollCommand('atomic-failure'),
      idempotencyKey: randomUUID(),
      actor: ADMIN,
      at: NOW,
    })).toThrowError(expect.objectContaining({ code: 'financial-invariant' }));
    expect(instances.getInstance('atomic-failure')).toBeNull();
    expect(database.db.prepare(`
      SELECT COUNT(*) AS count FROM tournament_prize_escrow
      WHERE instance_id = 'atomic-failure'
    `).get()).toEqual({ count: 0 });
    expect(funds.getFundPage({ limit: 10 })).toMatchObject({
      availableBalance: 500_000,
      version: 1,
      reservedTotal: 0,
      ledger: [expect.objectContaining({ kind: 'admin-adjustment' })],
    });
  });

  it('pays humans and returns bot prizes so totals equal the freeroll escrow', () => {
    prepareFreerollSettlement('settle-freeroll');

    const settled = funds.settleFreerollPayout({
      instanceId: 'settle-freeroll',
      actor: SYSTEM,
      at: NOW + 30,
    });

    expect(settled).toMatchObject({
      status: 'settled',
      amount: 100_000,
      humanPaid: 50_000,
      botReturned: 50_000,
    });
    expect(walletBalance('profile-a')).toBe(30_000);
    expect(walletBalance('profile-b')).toBe(20_000);
    expect(funds.getFundPage({ limit: 10 })).toMatchObject({
      availableBalance: 450_000,
      reservedTotal: 0,
    });
    expect(database.db.prepare(`
      SELECT status FROM tournament_instance WHERE id = 'settle-freeroll'
    `).get()).toEqual({ status: 'completed' });
    expect(database.db.prepare(`
      SELECT status FROM tournament_settlement WHERE instance_id = 'settle-freeroll'
    `).get()).toEqual({ status: 'settled' });
    expect(database.db.prepare(`
      SELECT profile_id, idempotency_key
      FROM chip_ledger
      WHERE ref_id = 'settle-freeroll'
      ORDER BY idempotency_key
    `).all()).toEqual([
      {
        profile_id: 'profile-a',
        idempotency_key: 'mtt-freeroll-prize:settle-freeroll:2',
      },
      {
        profile_id: 'profile-b',
        idempotency_key: 'mtt-freeroll-prize:settle-freeroll:3',
      },
    ]);

    expect(funds.settleFreerollPayout({
      instanceId: 'settle-freeroll',
      actor: SYSTEM,
      at: NOW + 31,
    })).toEqual(settled);
    expect(walletBalance('profile-a')).toBe(30_000);
    expect(walletBalance('profile-b')).toBe(20_000);
  });

  it('keeps a failed freeroll settlement payout-pending for exact-plan recovery', () => {
    prepareFreerollSettlement('settle-failure');
    database.db.exec(`
      CREATE TRIGGER injected_wallet_credit_failure
      BEFORE UPDATE ON wallets
      BEGIN
        SELECT RAISE(ABORT, 'injected wallet failure');
      END;
    `);

    expect(() => funds.settleFreerollPayout({
      instanceId: 'settle-failure',
      actor: SYSTEM,
      at: NOW + 30,
    })).toThrowError(expect.objectContaining({ code: 'financial-invariant' }));
    expect(database.db.prepare(`
      SELECT status FROM tournament_instance WHERE id = 'settle-failure'
    `).get()).toEqual({ status: 'payout-pending' });
    expect(database.db.prepare(`
      SELECT status FROM tournament_settlement WHERE instance_id = 'settle-failure'
    `).get()).toEqual({ status: 'pending' });
    expect(database.db.prepare(`
      SELECT status FROM tournament_prize_escrow WHERE instance_id = 'settle-failure'
    `).get()).toEqual({ status: 'reserved' });
    expect(walletBalance('profile-a')).toBe(0);
    expect(walletBalance('profile-b')).toBe(0);
  });

  it('rejects a human result whose player id is not the registered identity', () => {
    prepareFreerollSettlement('identity-mismatch', 'forged-player');

    expect(() => funds.settleFreerollPayout({
      instanceId: 'identity-mismatch',
      actor: SYSTEM,
      at: NOW + 30,
    })).toThrowError(expect.objectContaining({ code: 'financial-invariant' }));
    expect(database.db.prepare(`
      SELECT status FROM tournament_instance WHERE id = 'identity-mismatch'
    `).get()).toEqual({ status: 'payout-pending' });
    expect(walletBalance('profile-a')).toBe(0);
    expect(walletBalance('profile-b')).toBe(0);
  });

  it('funds one hidden occurrence exactly at visibility', () => {
    credit();
    createFreeroll('future', {
      visibleAt: NOW + 60_000,
      registrationOpensAt: NOW + 120_000,
    });
    const key = randomUUID();
    expect(() => funds.reserveFreerollPrize({
      instanceId: 'future',
      amount: 100_000,
      idempotencyKey: key,
      actor: SYSTEM,
      at: NOW + 59_999,
    })).toThrowError(expect.objectContaining({ code: 'not-visible' }));

    const first = funds.reserveFreerollPrize({
      instanceId: 'future',
      amount: 100_000,
      idempotencyKey: key,
      actor: SYSTEM,
      at: NOW + 60_000,
    });
    expect(first.status).toBe('reserved');
    expect(instances.getInstance('future')).toMatchObject({
      status: 'scheduled-visible',
      registrationState: 'not-open',
    });
    expect(funds.reserveFreerollPrize({
      instanceId: 'future',
      amount: 100_000,
      idempotencyKey: key,
      actor: SYSTEM,
      at: NOW + 60_001,
    })).toEqual(first);
    expect(funds.getFundPage({ limit: 10 }).version).toBe(2);
  });

  it('cancels an unfunded visible occurrence with promotion-insufficient', () => {
    createFreeroll('unfunded');
    expect(() => funds.reserveFreerollPrize({
      instanceId: 'unfunded',
      amount: 100_000,
      idempotencyKey: randomUUID(),
      actor: SYSTEM,
      at: NOW,
    })).toThrowError(expect.objectContaining({ code: 'promotion-insufficient' }));
    expect(instances.getInstance('unfunded')).toMatchObject({
      status: 'cancelled',
      statusReason: 'promotion-insufficient',
      registrationState: 'closed',
    });
  });

  it('refunds a reserved freeroll exactly once', () => {
    credit();
    createFreeroll('refund');
    funds.reserveFreerollPrize({
      instanceId: 'refund',
      amount: 100_000,
      idempotencyKey: randomUUID(),
      actor: ADMIN,
      at: NOW,
    });
    expect(instances.claimRefundPending(
      'refund',
      'operator-cancel',
      'cancel-owner',
    ).status).toBe('claimed');
    const generation = instances.getInstance('refund')!.registrationGeneration;
    const key = randomUUID();
    const first = funds.refundFreerollPrize({
      instanceId: 'refund',
      generation,
      idempotencyKey: key,
      actor: SYSTEM,
      at: NOW + 1,
    });
    expect(first).toMatchObject({ status: 'refunded', refundedAt: NOW + 1 });
    expect(funds.refundFreerollPrize({
      instanceId: 'refund',
      generation,
      idempotencyKey: key,
      actor: SYSTEM,
      at: NOW + 2,
    })).toEqual(first);
    expect(funds.getFundPage({ limit: 10 })).toMatchObject({
      availableBalance: 500_000,
      reservedTotal: 0,
      version: 3,
    });
    expect(instances.getInstance('refund')).toMatchObject({
      status: 'cancelled',
      statusReason: 'operator-cancel',
    });
  });

  it('quarantines a mismatched escrow without crediting its arbitrary amount', () => {
    credit();
    createFreeroll('mismatch');
    funds.reserveFreerollPrize({
      instanceId: 'mismatch',
      amount: 100_000,
      idempotencyKey: randomUUID(),
      actor: ADMIN,
      at: NOW,
    });
    database.db.exec('DROP TRIGGER protect_tournament_prize_escrow_update');
    database.db.prepare(`
      UPDATE tournament_prize_escrow
      SET amount = 90_000
      WHERE instance_id = 'mismatch'
    `).run();
    const versionBefore = funds.getFundPage({ limit: 10 }).version;

    expect(() => funds.refundFreerollPrize({
      instanceId: 'mismatch',
      generation: 0,
      idempotencyKey: randomUUID(),
      actor: SYSTEM,
      at: NOW + 1,
    })).toThrowError(expect.objectContaining({ code: 'financial-invariant' }));
    expect(instances.getInstance('mismatch')).toMatchObject({
      status: 'refund-pending',
      statusReason: 'financial-invariant',
      registrationState: 'closed',
    });
    expect(funds.getFundPage({ limit: 10 })).toMatchObject({
      availableBalance: 400_000,
      reservedTotal: 90_000,
      version: versionBefore,
    });
    expect(database.db.prepare(`
      SELECT COUNT(*) AS count
      FROM promotion_fund_ledger
      WHERE instance_id = 'mismatch'
        AND kind = 'freeroll-prize-refund'
    `).get()).toEqual({ count: 0 });
  });

  it('paginates the immutable ledger with an opaque cursor', () => {
    credit(100, randomUUID());
    funds.adjustFund({
      requestId: randomUUID(),
      delta: 200,
      reason: 'Second promotion credit',
      actor: ADMIN,
      at: NOW + 1,
    });
    funds.adjustFund({
      requestId: randomUUID(),
      delta: 300,
      reason: 'Third promotion credit',
      actor: ADMIN,
      at: NOW + 2,
    });
    const first = funds.getFundPage({ limit: 2 });
    expect(first.ledger.map(row => row.delta)).toEqual([300, 200]);
    expect(first.nextCursor).toEqual(expect.any(String));
    expect(first.nextCursor).not.toContain(first.ledger[1].id);
    const second = funds.getFundPage({
      limit: 2,
      before: first.nextCursor!,
    });
    expect(second.ledger.map(row => row.delta)).toEqual([100]);
    expect(second.nextCursor).toBeNull();
  });

  it('keeps the immutable ledger and prize escrow tamper evident', () => {
    credit();
    createFreeroll('tamper');
    funds.reserveFreerollPrize({
      instanceId: 'tamper',
      amount: 100_000,
      idempotencyKey: randomUUID(),
      actor: ADMIN,
      at: NOW,
    });
    expect(() => database.db.prepare(`
      UPDATE promotion_fund_ledger SET reason = 'tampered'
    `).run()).toThrow();
    expect(() => database.db.prepare(`
      DELETE FROM promotion_fund_ledger
    `).run()).toThrow();
    expect(() => database.db.prepare(`
      UPDATE promotion_fund SET balance = 999999 WHERE account_id = 'global'
    `).run()).toThrow();
    expect(() => database.db.prepare(`
      UPDATE tournament_prize_escrow SET amount = 1
      WHERE instance_id = 'tamper'
    `).run()).toThrow();
    expect(() => database.db.prepare(`
      DELETE FROM tournament_prize_escrow WHERE instance_id = 'tamper'
    `).run()).toThrow();
  });
});
