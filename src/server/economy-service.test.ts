import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { PokerDatabase } from './persistence/database';
import { openPokerDatabase } from './persistence/database';
import {
  EconomyDomainError,
  EconomyRepository,
} from './economy-repository';
import {
  ECONOMY_RULES,
  EconomyService,
  getKstDateKey,
  getNextKstMidnight,
} from './economy-service';

let database: PokerDatabase;
let repository: EconomyRepository;

beforeEach(() => {
  database = openPokerDatabase(':memory:');
  repository = new EconomyRepository(database);
});

afterEach(() => {
  database.close();
});

function seedProfile(profileId = 'profile-1', balance = 1_000): void {
  database.db.prepare(`
    INSERT INTO profiles (
      id, credential_hash, credential_lookup, recovery_hash, recovery_lookup,
      alias, avatar_id, adult_confirmed_at, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, 'sakura', 1, 1, 1)
  `).run(
    profileId,
    `credential-hash:${profileId}`,
    `credential-lookup:${profileId}`,
    `recovery-hash:${profileId}`,
    `recovery-lookup:${profileId}`,
    `alias:${profileId}`,
  );
  database.db.prepare(`
    INSERT INTO wallets (profile_id, balance, updated_at) VALUES (?, ?, 1)
  `).run(profileId, balance);
}

function expectEconomyError(
  work: () => unknown,
  code: string,
): EconomyDomainError {
  try {
    work();
  } catch (error) {
    expect(error).toBeInstanceOf(EconomyDomainError);
    expect((error as EconomyDomainError).code).toBe(code);
    return error as EconomyDomainError;
  }
  throw new Error(`Expected ${code}`);
}

describe('KST economy clock', () => {
  it('changes the claim date exactly at KST midnight', () => {
    expect(getKstDateKey(Date.parse('2026-07-15T14:59:59.999Z')))
      .toBe('2026-07-15');
    expect(getKstDateKey(Date.parse('2026-07-15T15:00:00.000Z')))
      .toBe('2026-07-16');
  });

  it('returns the next KST midnight across leap-day and month rollovers', () => {
    expect(getNextKstMidnight(Date.parse('2028-02-28T14:59:59.999Z')))
      .toBe(Date.parse('2028-02-28T15:00:00.000Z'));
    expect(getNextKstMidnight(Date.parse('2028-02-29T14:59:59.999Z')))
      .toBe(Date.parse('2028-02-29T15:00:00.000Z'));
    expect(getNextKstMidnight(Date.parse('2026-12-31T15:00:00.000Z')))
      .toBe(Date.parse('2027-01-01T15:00:00.000Z'));
  });

  it.each([
    { label: 'fractional', at: 1.5 },
    { label: 'negative', at: -1 },
    { label: 'NaN', at: Number.NaN },
    { label: 'infinite', at: Number.POSITIVE_INFINITY },
    { label: 'outside JavaScript Date', at: 8_640_000_000_000_001 },
    { label: 'outside four-digit years', at: 8_640_000_000_000_000 },
  ])('rejects a $label timestamp before formatting', ({ at }) => {
    expectEconomyError(
      () => getKstDateKey(at),
      'ECONOMY_TIME_INVALID',
    );
    expectEconomyError(
      () => getNextKstMidnight(at),
      'ECONOMY_TIME_INVALID',
    );
  });

  it('rejects a next midnight outside canonical four-digit KST dates', () => {
    const lastSupportedKstDay = Date.parse('9999-12-31T14:59:59.999Z');

    expect(getKstDateKey(lastSupportedKstDay)).toBe('9999-12-31');
    expectEconomyError(
      () => getNextKstMidnight(lastSupportedKstDay),
      'ECONOMY_DERIVED_VALUE_INVALID',
    );
  });
});

describe('EconomyRepository wallet ledger', () => {
  it('applies an idempotent delta exactly once and returns the current safe profile', () => {
    seedProfile();

    const first = repository.applyWalletDelta(
      'profile-1', 250, 'TEST_CREDIT', 'credit:1', 'ref-1', 100,
    );
    repository.applyWalletDelta(
      'profile-1', 100, 'OTHER_CREDIT', 'credit:2', undefined, 101,
    );
    const duplicate = repository.applyWalletDelta(
      'profile-1', 250, 'TEST_CREDIT', 'credit:1', 'ref-1', 102,
    );
    const rows = database.db.prepare(`
      SELECT id, delta, reason, ref_id, idempotency_key
      FROM chip_ledger ORDER BY created_at
    `).all() as Array<Record<string, unknown>>;

    expect(first).toEqual({
      profile: {
        id: 'profile-1',
        alias: 'alias:profile-1',
        avatarId: 'sakura',
        wallet: { balance: 1_250, activeEscrow: 0 },
      },
      transaction: { reason: 'TEST_CREDIT', delta: 250 },
    });
    expect(duplicate.profile.wallet.balance).toBe(1_350);
    expect(duplicate.transaction).toEqual({ reason: 'TEST_CREDIT', delta: 250 });
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      delta: 250,
      reason: 'TEST_CREDIT',
      ref_id: 'ref-1',
      idempotency_key: 'credit:1',
    });
    expect(rows[0].id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  });

  it('rejects a conflicting reuse of an idempotency key without applying it', () => {
    seedProfile();
    repository.applyWalletDelta(
      'profile-1', 250, 'TEST_CREDIT', 'credit:1', 'ref-1', 100,
    );

    expectEconomyError(
      () => repository.applyWalletDelta(
        'profile-1', 251, 'TEST_CREDIT', 'credit:1', 'ref-1', 101,
      ),
      'IDEMPOTENCY_KEY_CONFLICT',
    );

    expect(walletBalance()).toBe(1_250);
    expect(ledgerCount()).toBe(1);
  });

  it('uses stable errors for invalid deltas, missing profiles, overflow, and insufficient balance', () => {
    seedProfile();

    expectEconomyError(
      () => repository.applyWalletDelta('profile-1', 0, 'TEST', 'zero'),
      'WALLET_DELTA_INVALID',
    );
    expectEconomyError(
      () => repository.applyWalletDelta('profile-1', 1.5, 'TEST', 'float'),
      'WALLET_DELTA_INVALID',
    );
    expectEconomyError(
      () => repository.applyWalletDelta('missing', 1, 'TEST', 'missing'),
      'PROFILE_NOT_FOUND',
    );
    expectEconomyError(
      () => repository.applyWalletDelta('profile-1', -1_001, 'TEST', 'debit'),
      'INSUFFICIENT_BALANCE',
    );

    database.db.prepare('UPDATE wallets SET balance = ? WHERE profile_id = ?')
      .run(Number.MAX_SAFE_INTEGER, 'profile-1');
    expectEconomyError(
      () => repository.applyWalletDelta('profile-1', 1, 'TEST', 'overflow'),
      'WALLET_BALANCE_OVERFLOW',
    );
    expect(ledgerCount()).toBe(0);
  });

  it('rolls back the wallet update when ledger insertion fails', () => {
    seedProfile();
    database.db.exec(`
      CREATE TRIGGER reject_test_ledger
      BEFORE INSERT ON chip_ledger
      WHEN NEW.reason = 'FORCE_LEDGER_FAILURE'
      BEGIN
        SELECT RAISE(ABORT, 'forced ledger failure');
      END;
    `);

    expect(() => repository.applyWalletDelta(
      'profile-1', 500, 'FORCE_LEDGER_FAILURE', 'forced-ledger', undefined, 100,
    )).toThrow();
    expect(walletBalance()).toBe(1_000);
    expect(ledgerCount()).toBe(0);
  });

  it.each([
    { label: 'fractional', at: 1.5 },
    { label: 'negative', at: -1 },
    { label: 'NaN', at: Number.NaN },
    { label: 'infinite', at: Number.POSITIVE_INFINITY },
    { label: 'unsupported Date year', at: 8_640_000_000_000_000 },
  ])('rejects a $label ledger timestamp before SQL', ({ at }) => {
    seedProfile();

    expectEconomyError(
      () => repository.applyWalletDelta(
        'profile-1', 100, 'TEST_TIME', `invalid-time:${String(at)}`, undefined, at,
      ),
      'ECONOMY_TIME_INVALID',
    );
    expect(walletBalance()).toBe(1_000);
    expect(ledgerCount()).toBe(0);
  });
});

describe('EconomyRepository grant input boundaries', () => {
  const at = Date.parse('2026-07-15T15:00:00.000Z');
  const availableAt = Date.parse('2026-07-16T15:00:00.000Z');

  it.each([
    {
      label: 'non-canonical date',
      input: { claimDate: '2026-7-16' },
      code: 'ECONOMY_DATE_INVALID',
    },
    {
      label: 'impossible calendar date',
      input: { claimDate: '2026-02-29' },
      code: 'ECONOMY_DATE_INVALID',
    },
    {
      label: 'five-digit year',
      input: { claimDate: '10000-01-01' },
      code: 'ECONOMY_DATE_INVALID',
    },
    {
      label: 'zero amount',
      input: { amount: 0 },
      code: 'ECONOMY_RULES_INVALID',
    },
    {
      label: 'fractional amount',
      input: { amount: 1.5 },
      code: 'ECONOMY_RULES_INVALID',
    },
    {
      label: 'unsafe amount',
      input: { amount: Number.MAX_SAFE_INTEGER + 1 },
      code: 'ECONOMY_RULES_INVALID',
    },
    {
      label: 'negative availability',
      input: { availableAt: -1 },
      code: 'ECONOMY_TIME_INVALID',
    },
    {
      label: 'fractional claim timestamp',
      input: { at: 1.5 },
      code: 'ECONOMY_TIME_INVALID',
    },
    {
      label: 'availability not after claim',
      input: { availableAt: at },
      code: 'ECONOMY_DERIVED_VALUE_INVALID',
    },
  ])('rejects daily $label without mutation', ({ input, code }) => {
    seedProfile();
    const values = {
      claimDate: '2026-07-16',
      amount: 1_000,
      availableAt,
      at,
      ...input,
    };

    expectEconomyError(
      () => repository.claimDaily(
        'profile-1',
        values.claimDate,
        values.amount,
        values.availableAt,
        values.at,
      ),
      code,
    );
    expect(walletBalance()).toBe(1_000);
    expect(dailyClaimCount()).toBe(0);
    expect(ledgerCount()).toBe(0);
  });

  it.each([
    {
      label: 'zero threshold',
      rules: { threshold: 0 },
      code: 'ECONOMY_RULES_INVALID',
    },
    {
      label: 'target at threshold',
      rules: { target: 800 },
      code: 'ECONOMY_RULES_INVALID',
    },
    {
      label: 'fractional target',
      rules: { target: 2_000.5 },
      code: 'ECONOMY_RULES_INVALID',
    },
    {
      label: 'zero daily limit',
      rules: { dailyLimit: 0 },
      code: 'ECONOMY_RULES_INVALID',
    },
    {
      label: 'fractional daily limit',
      rules: { dailyLimit: 1.5 },
      code: 'ECONOMY_RULES_INVALID',
    },
    {
      label: 'zero cooldown',
      rules: { cooldownMs: 0 },
      code: 'ECONOMY_RULES_INVALID',
    },
  ])('rejects rescue $label without mutation', ({ rules, code }) => {
    seedProfile('profile-1', 799);
    const values = {
      threshold: 800,
      target: 2_000,
      dailyLimit: 3,
      cooldownMs: 4 * 60 * 60 * 1_000,
      ...rules,
    };

    expectEconomyError(
      () => repository.claimRescue(
        'profile-1', '2026-07-16', values, availableAt, at,
      ),
      code,
    );
    expect(walletBalance()).toBe(799);
    expect(rescueClaimCount()).toBe(0);
    expect(ledgerCount()).toBe(0);
  });

  it.each([
    {
      label: 'negative claim timestamp',
      nextMidnight: availableAt,
      claimAt: -1,
      code: 'ECONOMY_TIME_INVALID',
    },
    {
      label: 'fractional next midnight',
      nextMidnight: 1.5,
      claimAt: at,
      code: 'ECONOMY_TIME_INVALID',
    },
    {
      label: 'next midnight not after claim',
      nextMidnight: at,
      claimAt: at,
      code: 'ECONOMY_DERIVED_VALUE_INVALID',
    },
  ])('rejects rescue $label without mutation', ({
    nextMidnight,
    claimAt,
    code,
  }) => {
    seedProfile('profile-1', 799);

    expectEconomyError(
      () => repository.claimRescue(
        'profile-1',
        '2026-07-16',
        {
          threshold: 800,
          target: 2_000,
          dailyLimit: 3,
          cooldownMs: 4 * 60 * 60 * 1_000,
        },
        nextMidnight,
        claimAt,
      ),
      code,
    );
    expect(walletBalance()).toBe(799);
    expect(rescueClaimCount()).toBe(0);
    expect(ledgerCount()).toBe(0);
  });
});

describe('EconomyRepository persisted and derived boundaries', () => {
  const at = Date.parse('2026-07-15T15:00:00.000Z');
  const nextMidnight = Date.parse('2026-07-16T15:00:00.000Z');
  const rules = {
    threshold: 800,
    target: 2_000,
    dailyLimit: 3,
    cooldownMs: 4 * 60 * 60 * 1_000,
  };

  it.each([
    { label: 'negative', claimedAt: -1 },
    { label: 'unsupported Date year', claimedAt: 8_640_000_000_000_000 },
    {
      label: 'unsafe cooldown source',
      claimedAt: Number.MAX_SAFE_INTEGER - rules.cooldownMs + 1,
    },
  ])('rejects a $label persisted claimed_at without mutation', ({
    claimedAt,
  }) => {
    seedProfile('profile-1', 799);
    insertRescueClaim('2026-07-15', 1, claimedAt);

    expectEconomyError(
      () => repository.claimRescue(
        'profile-1', '2026-07-16', rules, nextMidnight, at,
      ),
      'ECONOMY_PERSISTENCE_INVALID',
    );
    expect(walletBalance()).toBe(799);
    expect(rescueClaimCount()).toBe(1);
    expect(ledgerCount()).toBe(0);
  });

  it('rejects a cooldown timestamp derived outside supported KST dates', () => {
    seedProfile('profile-1', 799);
    insertRescueClaim(
      '9999-12-31',
      1,
      Date.parse('9999-12-31T14:00:00.000Z'),
    );

    expectEconomyError(
      () => repository.claimRescue(
        'profile-1', '2026-07-16', rules, nextMidnight, at,
      ),
      'ECONOMY_DERIVED_VALUE_INVALID',
    );
    expect(walletBalance()).toBe(799);
    expect(rescueClaimCount()).toBe(1);
    expect(ledgerCount()).toBe(0);
  });

  it('rejects an unsafe next ordinal from a persisted ordinal gap', () => {
    seedProfile('profile-1', 799);
    insertRescueClaim(
      '2026-07-16',
      Number.MAX_SAFE_INTEGER,
      at - rules.cooldownMs,
    );

    expectEconomyError(
      () => repository.claimRescue(
        'profile-1', '2026-07-16', rules, nextMidnight, at,
      ),
      'ECONOMY_DERIVED_VALUE_INVALID',
    );
    expect(walletBalance()).toBe(799);
    expect(rescueClaimCount()).toBe(1);
    expect(ledgerCount()).toBe(0);
  });
});

describe('EconomyService daily grant', () => {
  it('credits exactly once per KST date and reports the next midnight', () => {
    seedProfile('profile-1', ECONOMY_RULES.startingChips);
    const now = Date.parse('2026-07-15T14:59:59.999Z');
    const service = new EconomyService(repository, () => now);

    const granted = service.claimDaily('profile-1');
    const repeated = expectEconomyError(
      () => service.claimDaily('profile-1'),
      'DAILY_ALREADY_CLAIMED',
    );

    expect(granted).toEqual({
      profile: {
        id: 'profile-1',
        alias: 'alias:profile-1',
        avatarId: 'sakura',
        wallet: { balance: 11_000, activeEscrow: 0 },
      },
      transaction: { reason: 'DAILY_GRANT', delta: 1_000 },
    });
    expect(repeated.availableAt)
      .toBe(Date.parse('2026-07-15T15:00:00.000Z'));
    expect(walletBalance()).toBe(11_000);
    expect(dailyClaimCount()).toBe(1);
    expect(database.db.prepare(`
      SELECT idempotency_key FROM chip_ledger WHERE reason = 'DAILY_GRANT'
    `).get()).toEqual({ idempotency_key: 'daily:profile-1:2026-07-15' });
  });

  it('grants the next KST date exactly once without carrying missed dates', () => {
    seedProfile();
    const service = new EconomyService(repository);

    service.claimDaily(
      'profile-1', Date.parse('2026-07-15T14:59:59.999Z'),
    );
    service.claimDaily(
      'profile-1', Date.parse('2026-07-15T15:00:00.000Z'),
    );

    expect(walletBalance()).toBe(3_000);
    expect(dailyClaimCount()).toBe(2);
    expect(ledgerCount()).toBe(2);
  });

  it('allows only one success across repeated synchronous calls', () => {
    seedProfile();
    const service = new EconomyService(
      repository,
      () => Date.parse('2026-07-15T15:00:00.000Z'),
    );
    const outcomes = Array.from({ length: 5 }, () => {
      try {
        service.claimDaily('profile-1');
        return 'success';
      } catch (error) {
        expect(error).toBeInstanceOf(EconomyDomainError);
        return (error as EconomyDomainError).code;
      }
    });

    expect(outcomes.filter(outcome => outcome === 'success')).toHaveLength(1);
    expect(outcomes.filter(outcome => outcome === 'DAILY_ALREADY_CLAIMED'))
      .toHaveLength(4);
    expect(walletBalance()).toBe(2_000);
    expect(dailyClaimCount()).toBe(1);
  });

  it('rolls back the claim when its ledger insertion fails', () => {
    seedProfile();
    database.db.exec(`
      CREATE TRIGGER reject_daily_ledger
      BEFORE INSERT ON chip_ledger
      WHEN NEW.reason = 'DAILY_GRANT'
      BEGIN
        SELECT RAISE(ABORT, 'forced daily ledger failure');
      END;
    `);
    const service = new EconomyService(repository);

    expect(() => service.claimDaily(
      'profile-1', Date.parse('2026-07-15T15:00:00.000Z'),
    )).toThrow();
    expect(walletBalance()).toBe(1_000);
    expect(dailyClaimCount()).toBe(0);
    expect(ledgerCount()).toBe(0);
  });

  it('does not mutate the wallet when claim insertion fails', () => {
    seedProfile();
    database.db.exec(`
      CREATE TRIGGER reject_daily_claim
      BEFORE INSERT ON daily_claims
      BEGIN
        SELECT RAISE(ABORT, 'forced daily claim failure');
      END;
    `);
    const service = new EconomyService(repository);

    expect(() => service.claimDaily(
      'profile-1', Date.parse('2026-07-15T15:00:00.000Z'),
    )).toThrow();
    expect(walletBalance()).toBe(1_000);
    expect(dailyClaimCount()).toBe(0);
    expect(ledgerCount()).toBe(0);
  });
});

describe('EconomyService rescue grant', () => {
  it('qualifies at 799, reaches exactly 2000, and rejects a balance of 800', () => {
    seedProfile('profile-1', 799);
    seedProfile('profile-2', 800);
    const at = Date.parse('2026-07-15T15:00:00.000Z');
    const service = new EconomyService(repository, () => at);

    const granted = service.claimRescue('profile-1');
    expectEconomyError(
      () => service.claimRescue('profile-2'),
      'RESCUE_NOT_ELIGIBLE',
    );

    expect(granted.transaction).toEqual({
      reason: 'RESCUE_GRANT',
      delta: 1_201,
    });
    expect(granted.profile.wallet.balance).toBe(2_000);
    expect(walletBalance('profile-2')).toBe(800);
    expect(rescueClaimCount('profile-1')).toBe(1);
    expect(rescueClaimCount('profile-2')).toBe(0);
  });

  it('blocks any active escrow even when its amount is zero', () => {
    seedProfile('profile-1', 799);
    database.db.prepare(`
      INSERT INTO seat_escrows (
        id, profile_id, room_id, mode, amount,
        checkpoint_amount, checkpoint_hand, status, updated_at
      ) VALUES ('escrow-1', 'profile-1', 'room-1', 'cash', 0, 0, 0, 'active', 1)
    `).run();
    const service = new EconomyService(repository);

    expectEconomyError(
      () => service.claimRescue(
        'profile-1', Date.parse('2026-07-15T15:00:00.000Z'),
      ),
      'RESCUE_ACTIVE_ESCROW',
    );
    expect(walletBalance()).toBe(799);
    expect(rescueClaimCount()).toBe(0);
  });

  it('enforces the cooldown until the exact four-hour boundary', () => {
    seedProfile('profile-1', 799);
    const firstAt = Date.parse('2026-07-15T15:00:00.000Z');
    const service = new EconomyService(repository);
    service.claimRescue('profile-1', firstAt);
    drainWalletTo(799, 'cooldown-drain-1', firstAt + 1);

    const blocked = expectEconomyError(
      () => service.claimRescue(
        'profile-1', firstAt + ECONOMY_RULES.rescueCooldownMs - 1,
      ),
      'RESCUE_COOLDOWN',
    );
    const exact = service.claimRescue(
      'profile-1', firstAt + ECONOMY_RULES.rescueCooldownMs,
    );

    expect(blocked.availableAt)
      .toBe(firstAt + ECONOMY_RULES.rescueCooldownMs);
    expect(Number.isSafeInteger(blocked.availableAt)).toBe(true);
    expect(exact.transaction.delta).toBe(1_201);
    expect(rescueClaimCount()).toBe(2);
  });

  it('keeps the previous-date cooldown across KST midnight', () => {
    seedProfile('profile-1', 799);
    const firstAt = Date.parse('2026-07-15T14:00:00.000Z');
    const service = new EconomyService(repository);
    service.claimRescue('profile-1', firstAt);
    drainWalletTo(799, 'midnight-drain-1', firstAt + 1);

    const blocked = expectEconomyError(
      () => service.claimRescue(
        'profile-1', Date.parse('2026-07-15T15:00:00.000Z'),
      ),
      'RESCUE_COOLDOWN',
    );
    const exact = service.claimRescue(
      'profile-1', firstAt + ECONOMY_RULES.rescueCooldownMs,
    );
    const dates = database.db.prepare(`
      SELECT claim_date FROM rescue_claims ORDER BY claimed_at
    `).all() as Array<{ claim_date: string }>;

    expect(blocked.availableAt)
      .toBe(firstAt + ECONOMY_RULES.rescueCooldownMs);
    expect(exact.profile.wallet.balance).toBe(2_000);
    expect(dates).toEqual([
      { claim_date: '2026-07-15' },
      { claim_date: '2026-07-16' },
    ]);
  });

  it('allows three rescues per KST date and blocks the fourth until next midnight', () => {
    seedProfile('profile-1', 799);
    const start = Date.parse('2026-07-15T15:00:00.000Z');
    const service = new EconomyService(repository);

    for (let ordinal = 1; ordinal <= 3; ordinal += 1) {
      const at = start + (ordinal - 1) * ECONOMY_RULES.rescueCooldownMs;
      service.claimRescue('profile-1', at);
      drainWalletTo(799, `daily-limit-drain-${ordinal}`, at + 1);
    }
    const blockedAt = start + 3 * ECONOMY_RULES.rescueCooldownMs;
    const blocked = expectEconomyError(
      () => service.claimRescue('profile-1', blockedAt),
      'RESCUE_DAILY_LIMIT',
    );
    const claims = database.db.prepare(`
      SELECT ordinal, amount FROM rescue_claims ORDER BY ordinal
    `).all();
    const keys = database.db.prepare(`
      SELECT idempotency_key FROM chip_ledger
      WHERE reason = 'RESCUE_GRANT' ORDER BY created_at
    `).all();

    expect(blocked.availableAt).toBe(start + 24 * 60 * 60 * 1_000);
    expect(claims).toEqual([
      { ordinal: 1, amount: 1_201 },
      { ordinal: 2, amount: 1_201 },
      { ordinal: 3, amount: 1_201 },
    ]);
    expect(keys).toEqual([
      { idempotency_key: 'rescue:profile-1:2026-07-16:1' },
      { idempotency_key: 'rescue:profile-1:2026-07-16:2' },
      { idempotency_key: 'rescue:profile-1:2026-07-16:3' },
    ]);
    expect(rescueClaimCount()).toBe(3);
  });

  it('rolls back the rescue row and wallet when ledger insertion fails', () => {
    seedProfile('profile-1', 799);
    database.db.exec(`
      CREATE TRIGGER reject_rescue_ledger
      BEFORE INSERT ON chip_ledger
      WHEN NEW.reason = 'RESCUE_GRANT'
      BEGIN
        SELECT RAISE(ABORT, 'forced rescue ledger failure');
      END;
    `);
    const service = new EconomyService(repository);

    expect(() => service.claimRescue(
      'profile-1', Date.parse('2026-07-15T15:00:00.000Z'),
    )).toThrow(/forced rescue ledger failure/);
    expect(walletBalance()).toBe(799);
    expect(rescueClaimCount()).toBe(0);
    expect(ledgerCount()).toBe(0);
  });

  it('returns PROFILE_NOT_FOUND without exposing database state', () => {
    const service = new EconomyService(repository);

    const error = expectEconomyError(
      () => service.claimRescue(
        'missing', Date.parse('2026-07-15T15:00:00.000Z'),
      ),
      'PROFILE_NOT_FOUND',
    );

    expect(Object.keys(error).sort()).toEqual(['availableAt', 'code', 'name']);
    expect(error.message).toBe('PROFILE_NOT_FOUND');
  });
});

describe('EconomyService casual wallet Sit & Go', () => {
  const BUY_IN = 1_500;
  const FEE = 150;

  function seedEntrants(balance = 10_000): string[] {
    return Array.from({ length: 6 }, (_, index) => {
      const profileId = `sng-human-${index + 1}`;
      seedProfile(profileId, balance);
      return profileId;
    });
  }

  function ledgerTotals(): Record<string, number> {
    return Object.fromEntries((database.db.prepare(`
      SELECT account, SUM(delta) AS total
      FROM chip_ledger
      WHERE reason LIKE 'SNG_%'
      GROUP BY account
      ORDER BY account
    `).all() as Array<{ account: string; total: number }>).map(row => [
      row.account,
      row.total,
    ]));
  }

  it('reserves six fixed entries, burns only fees at start, and settles 50/30/20 exactly once', () => {
    const entrants = seedEntrants();
    const service = new EconomyService(repository, () => 100);

    for (const profileId of entrants) {
      service.reserveSngEntry(profileId, 'sng-room', BUY_IN, FEE);
    }
    expect(entrants.map(profileId => walletBalance(profileId)))
      .toEqual(Array(6).fill(8_350));
    expect(ledgerTotals()).toEqual({ escrow: 9_900, wallet: -9_900 });

    service.startSngTournament('sng-room', entrants, BUY_IN, FEE);
    expect(ledgerTotals()).toEqual({ burn: 900, escrow: 9_000, wallet: -9_900 });

    const results = entrants.map((profileId, index) => ({
      playerId: profileId,
      place: index + 1,
      prize: [4_500, 2_700, 1_800, 0, 0, 0][index],
    }));
    service.settleSngTournament('sng-room', results, BUY_IN, FEE);
    service.settleSngTournament('sng-room', results, BUY_IN, FEE);

    expect(entrants.map(profileId => walletBalance(profileId))).toEqual([
      12_850, 11_050, 10_150, 8_350, 8_350, 8_350,
    ]);
    expect(ledgerTotals()).toEqual({ burn: 900, escrow: 0, wallet: -900 });
    expect(database.db.prepare(`
      SELECT profile_id, status, place, prize
      FROM sng_entries ORDER BY place
    `).all()).toEqual(results.map(result => ({
      profile_id: result.playerId,
      status: 'settled',
      place: result.place,
      prize: result.prize,
    })));
    expect(database.db.prepare(`
      SELECT idempotency_key FROM chip_ledger
      WHERE reason = 'SNG_PRIZE' ORDER BY profile_id
    `).all()).toHaveLength(3);
    expect(database.db.prepare(`
      SELECT idempotency_key FROM chip_ledger
      WHERE reason = 'SNG_PRIZE'
    `).all()).toEqual(expect.arrayContaining(entrants.slice(0, 3).map(
      profileId => ({
        idempotency_key: expect.stringMatching(
          new RegExp(`^sng-prize:sng-room:${profileId}:`),
        ),
      }),
    )));
  });

  it('rejects insufficient funds and a second active economic seat without partial mutation', () => {
    seedProfile('poor', BUY_IN + FEE - 1);
    seedProfile('cash-player', 10_000);
    const service = new EconomyService(repository, () => 100);
    service.openCashEscrow('cash-player', 'cash-room', 4_000);

    expectEconomyError(
      () => service.reserveSngEntry('poor', 'sng-room', BUY_IN, FEE),
      'INSUFFICIENT_BALANCE',
    );
    expectEconomyError(
      () => service.reserveSngEntry('cash-player', 'sng-room', BUY_IN, FEE),
      'SNG_ACTIVE_SEAT',
    );
    expect(walletBalance('poor')).toBe(BUY_IN + FEE - 1);
    expect(walletBalance('cash-player')).toBe(6_000);
    expect(database.db.prepare('SELECT COUNT(*) AS count FROM sng_entries').get())
      .toEqual({ count: 0 });
  });

  it('refunds a waiting cancellation once and permits a new room incarnation', () => {
    seedProfile('profile-1', 10_000);
    const service = new EconomyService(repository, () => 100);

    const first = service.reserveSngEntry('profile-1', 'reused-room', BUY_IN, FEE);
    service.cancelSngEntry('profile-1', 'reused-room');
    service.cancelSngEntry('profile-1', 'reused-room');
    const second = service.reserveSngEntry('profile-1', 'reused-room', BUY_IN, FEE);

    expect(second.tournamentId).not.toBe(first.tournamentId);
    expect(walletBalance()).toBe(8_350);
    expect(database.db.prepare(`
      SELECT status, COUNT(*) AS count FROM sng_entries GROUP BY status
      ORDER BY status
    `).all()).toEqual([
      { status: 'refunded', count: 1 },
      { status: 'reserved', count: 1 },
    ]);
  });

  it('refunds every waiting entry exactly once when a room is disposed', () => {
    seedProfile('profile-1', 10_000);
    seedProfile('profile-2', 10_000);
    const service = new EconomyService(repository, () => 100);
    service.reserveSngEntry('profile-1', 'disposed-room', BUY_IN, FEE);
    service.reserveSngEntry('profile-2', 'disposed-room', BUY_IN, FEE);

    expect(service.cancelWaitingSngRoom('disposed-room')).toBe(2);
    expect(service.cancelWaitingSngRoom('disposed-room')).toBe(0);
    expect(walletBalance('profile-1')).toBe(10_000);
    expect(walletBalance('profile-2')).toBe(10_000);
  });

  it('rolls back a conflicting or malformed finish without paying anyone', () => {
    const entrants = seedEntrants();
    const service = new EconomyService(repository, () => 100);
    for (const profileId of entrants) {
      service.reserveSngEntry(profileId, 'sng-room', BUY_IN, FEE);
    }
    service.startSngTournament('sng-room', entrants, BUY_IN, FEE);
    const invalid = entrants.map((playerId, index) => ({
      playerId,
      place: index === 5 ? 5 : index + 1,
      prize: [4_500, 2_700, 1_800, 0, 0, 0][index],
    }));

    expectEconomyError(
      () => service.settleSngTournament('sng-room', invalid, BUY_IN, FEE),
      'SNG_SETTLEMENT_INVALID',
    );
    expect(entrants.map(profileId => walletBalance(profileId)))
      .toEqual(Array(6).fill(8_350));
    expect(database.db.prepare(`
      SELECT DISTINCT status FROM sng_entries
    `).all()).toEqual([{ status: 'started' }]);
  });

  it('classifies every non-identical settled retry as a conflict without mutation', () => {
    const entrants = seedEntrants();
    const service = new EconomyService(repository, () => 100);
    for (const profileId of entrants) {
      service.reserveSngEntry(profileId, 'sng-room', BUY_IN, FEE);
    }
    service.startSngTournament('sng-room', entrants, BUY_IN, FEE);
    const results = entrants.map((playerId, index) => ({
      playerId,
      place: index + 1,
      prize: [4_500, 2_700, 1_800, 0, 0, 0][index],
    }));
    service.settleSngTournament('sng-room', results, BUY_IN, FEE);
    const settledWallets = [
      12_850, 11_050, 10_150, 8_350, 8_350, 8_350,
    ];
    const settledRows = database.db.prepare(`
      SELECT profile_id, status, place, prize
      FROM sng_entries ORDER BY profile_id
    `).all();
    const settledLedgerCount = (database.db.prepare(`
      SELECT COUNT(*) AS count FROM chip_ledger
    `).get() as { count: number }).count;

    const duplicatePlayer = results.map(result => ({ ...result }));
    duplicatePlayer[5].playerId = duplicatePlayer[0].playerId;
    const duplicatePlace = results.map(result => ({ ...result }));
    duplicatePlace[5].place = duplicatePlace[4].place;
    const changedPrize = results.map(result => ({ ...result }));
    changedPrize[0].prize += 1;
    const changedPlace = results.map(result => ({ ...result }));
    [changedPlace[0].place, changedPlace[1].place] = [
      changedPlace[1].place,
      changedPlace[0].place,
    ];
    [changedPlace[0].prize, changedPlace[1].prize] = [
      changedPlace[1].prize,
      changedPlace[0].prize,
    ];
    const changedPlayer = results.map(result => ({ ...result }));
    [changedPlayer[0].playerId, changedPlayer[1].playerId] = [
      changedPlayer[1].playerId,
      changedPlayer[0].playerId,
    ];
    const cases = [
      { label: 'omitted result', value: results.slice(0, 5) },
      {
        label: 'extra result',
        value: [...results, { playerId: 'extra-profile', place: 6, prize: 0 }],
      },
      { label: 'duplicate player', value: duplicatePlayer },
      { label: 'duplicate place', value: duplicatePlace },
      { label: 'changed prize', value: changedPrize },
      { label: 'changed place', value: changedPlace },
      { label: 'changed player', value: changedPlayer },
    ];

    for (const retry of cases) {
      const error = expectEconomyError(
        () => service.settleSngTournament(
          'sng-room', retry.value, BUY_IN, FEE,
        ),
        'SNG_SETTLEMENT_CONFLICT',
      );
      expect(error.message, retry.label).toBe('SNG_SETTLEMENT_CONFLICT');
      expect(entrants.map(profileId => walletBalance(profileId)))
        .toEqual(settledWallets);
      expect(database.db.prepare(`
        SELECT profile_id, status, place, prize
        FROM sng_entries ORDER BY profile_id
      `).all()).toEqual(settledRows);
      expect((database.db.prepare(`
        SELECT COUNT(*) AS count FROM chip_ledger
      `).get() as { count: number }).count).toBe(settledLedgerCount);
    }

    expect(() => service.settleSngTournament(
      'sng-room', [...results].reverse(), BUY_IN, FEE,
    )).not.toThrow();
    expect(entrants.map(profileId => walletBalance(profileId)))
      .toEqual(settledWallets);
  });

  it('reverts an unmutated failed start so the exact tournament can retry with a new attempt', () => {
    const entrants = seedEntrants();
    const service = new EconomyService(repository, () => 100);
    for (const profileId of entrants) {
      service.reserveSngEntry(profileId, 'sng-room', BUY_IN, FEE);
    }

    service.startSngTournament('sng-room', entrants, BUY_IN, FEE);
    service.revertSngTournamentStart('sng-room', entrants, BUY_IN, FEE);
    service.startSngTournament('sng-room', entrants, BUY_IN, FEE);

    expect(ledgerTotals()).toEqual({ burn: 900, escrow: 9_000, wallet: -9_900 });
    expect(database.db.prepare(`
      SELECT DISTINCT status, start_attempt FROM sng_entries
    `).all()).toEqual([{ status: 'started', start_attempt: 2 }]);
  });

  it('atomically refunds both reserved and started entries during startup recovery', () => {
    const reserved = seedEntrants();
    const started = Array.from({ length: 6 }, (_, index) => {
      const profileId = `started-human-${index + 1}`;
      seedProfile(profileId, 10_000);
      return profileId;
    });
    const service = new EconomyService(repository, () => 100);
    for (const profileId of reserved) {
      service.reserveSngEntry(profileId, 'reserved-room', BUY_IN, FEE);
    }
    for (const profileId of started) {
      service.reserveSngEntry(profileId, 'started-room', BUY_IN, FEE);
    }
    service.startSngTournament('started-room', started, BUY_IN, FEE);

    expect(service.recoverIncompleteSngEntries()).toBe(12);
    expect(service.recoverIncompleteSngEntries()).toBe(0);
    expect([...reserved, ...started].map(profileId => walletBalance(profileId)))
      .toEqual(Array(12).fill(10_000));
    expect(database.db.prepare(`
      SELECT DISTINCT status FROM sng_entries
    `).all()).toEqual([{ status: 'refunded' }]);
    expect(ledgerTotals()).toEqual({ burn: 0, escrow: 0, wallet: 0 });
  });

  it.each([
    { reason: 'SNG_FEE_BURN', account: 'burn' },
    { reason: 'SNG_ENTRY_RESERVE', account: 'escrow' },
  ])('rolls back every startup refund when a $reason ledger is malformed', ({
    reason,
    account,
  }) => {
    const reserved = seedEntrants();
    const started = Array.from({ length: 6 }, (_, index) => {
      const profileId = `started-human-${index + 1}`;
      seedProfile(profileId, 10_000);
      return profileId;
    });
    const service = new EconomyService(repository, () => 100);
    for (const profileId of reserved) {
      service.reserveSngEntry(profileId, 'reserved-room', BUY_IN, FEE);
    }
    for (const profileId of started) {
      service.reserveSngEntry(profileId, 'started-room', BUY_IN, FEE);
    }
    service.startSngTournament('started-room', started, BUY_IN, FEE);
    database.db.prepare(`
      DELETE FROM chip_ledger
      WHERE idempotency_key = (
        SELECT idempotency_key FROM chip_ledger
        WHERE reason = ? AND account = ?
        LIMIT 1
      )
    `).run(reason, account);

    expectEconomyError(
      () => service.recoverIncompleteSngEntries(),
      'ECONOMY_PERSISTENCE_INVALID',
    );
    expect([...reserved, ...started].map(profileId => walletBalance(profileId)))
      .toEqual(Array(12).fill(8_350));
    expect(database.db.prepare(`
      SELECT status, COUNT(*) AS count FROM sng_entries
      GROUP BY status ORDER BY status
    `).all()).toEqual([
      { status: 'reserved', count: 6 },
      { status: 'started', count: 6 },
    ]);
  });
});

function walletBalance(profileId = 'profile-1'): number {
  return (database.db.prepare(`
    SELECT balance FROM wallets WHERE profile_id = ?
  `).get(profileId) as { balance: number }).balance;
}

function ledgerCount(profileId = 'profile-1'): number {
  return (database.db.prepare(`
    SELECT COUNT(*) AS count FROM chip_ledger WHERE profile_id = ?
  `).get(profileId) as { count: number }).count;
}

function dailyClaimCount(profileId = 'profile-1'): number {
  return (database.db.prepare(`
    SELECT COUNT(*) AS count FROM daily_claims WHERE profile_id = ?
  `).get(profileId) as { count: number }).count;
}

function rescueClaimCount(profileId = 'profile-1'): number {
  return (database.db.prepare(`
    SELECT COUNT(*) AS count FROM rescue_claims WHERE profile_id = ?
  `).get(profileId) as { count: number }).count;
}

function drainWalletTo(balance: number, key: string, at: number): void {
  const current = walletBalance();
  repository.applyWalletDelta(
    'profile-1', balance - current, 'TEST_DRAIN', key, undefined, at,
  );
}

function insertRescueClaim(
  claimDate: string,
  ordinal: number,
  claimedAt: number,
): void {
  database.db.prepare(`
    INSERT INTO rescue_claims (
      profile_id, claim_date, ordinal, amount, claimed_at
    ) VALUES ('profile-1', ?, ?, 1, ?)
  `).run(claimDate, ordinal, claimedAt);
}
