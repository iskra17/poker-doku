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
  type CreateInstanceCommand,
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
