import { randomUUID } from 'node:crypto';
import type { PublicProfile } from '@/lib/profile/types';
import type { PokerDatabase } from './persistence/database';

const KST_OFFSET_MS = 9 * 60 * 60 * 1_000;
const CANONICAL_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

export type EconomyErrorCode =
  | 'PROFILE_NOT_FOUND'
  | 'WALLET_DELTA_INVALID'
  | 'WALLET_BALANCE_OVERFLOW'
  | 'INSUFFICIENT_BALANCE'
  | 'IDEMPOTENCY_KEY_CONFLICT'
  | 'DAILY_ALREADY_CLAIMED'
  | 'RESCUE_ACTIVE_ESCROW'
  | 'RESCUE_NOT_ELIGIBLE'
  | 'RESCUE_DAILY_LIMIT'
  | 'RESCUE_COOLDOWN'
  | 'ECONOMY_TIME_INVALID'
  | 'ECONOMY_DATE_INVALID'
  | 'ECONOMY_RULES_INVALID'
  | 'ECONOMY_DERIVED_VALUE_INVALID'
  | 'ECONOMY_PERSISTENCE_INVALID';

export class EconomyDomainError extends Error {
  constructor(
    readonly code: EconomyErrorCode,
    readonly availableAt?: number,
  ) {
    super(code);
    this.name = 'EconomyDomainError';
  }
}

export function assertValidEconomyTimestamp(
  value: number,
  code: EconomyErrorCode = 'ECONOMY_TIME_INVALID',
): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new EconomyDomainError(code);
  }
  const date = new Date(value);
  const utcYear = date.getUTCFullYear();
  const kstValue = value + KST_OFFSET_MS;
  const kstDate = new Date(kstValue);
  const kstYear = kstDate.getUTCFullYear();
  if (
    !Number.isFinite(date.getTime())
    || utcYear < 1
    || utcYear > 9_999
    || !Number.isSafeInteger(kstValue)
    || !Number.isFinite(kstDate.getTime())
    || kstYear < 1
    || kstYear > 9_999
  ) {
    throw new EconomyDomainError(code);
  }
}

function assertCanonicalClaimDate(value: string): void {
  const match = CANONICAL_DATE_PATTERN.exec(value);
  if (!match) throw new EconomyDomainError('ECONOMY_DATE_INVALID');
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const daysInMonth = [
    31,
    leapYear ? 29 : 28,
    31,
    30,
    31,
    30,
    31,
    31,
    30,
    31,
    30,
    31,
  ];
  if (
    year < 1
    || year > 9_999
    || month < 1
    || month > 12
    || day < 1
    || day > daysInMonth[month - 1]
  ) {
    throw new EconomyDomainError('ECONOMY_DATE_INVALID');
  }
}

function assertPositiveSafeInteger(value: number): void {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new EconomyDomainError('ECONOMY_RULES_INVALID');
  }
}

function assertValidRescueRules(rules: RescueClaimRules): void {
  assertPositiveSafeInteger(rules.threshold);
  assertPositiveSafeInteger(rules.target);
  assertPositiveSafeInteger(rules.dailyLimit);
  assertPositiveSafeInteger(rules.cooldownMs);
  if (rules.target <= rules.threshold) {
    throw new EconomyDomainError('ECONOMY_RULES_INVALID');
  }
}

function assertPersistedNonnegativeSafeInteger(value: number): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new EconomyDomainError('ECONOMY_PERSISTENCE_INVALID');
  }
}

function deriveTimestamp(left: number, right: number): number {
  const result = left + right;
  assertValidEconomyTimestamp(result, 'ECONOMY_DERIVED_VALUE_INVALID');
  return result;
}

function assertPositiveDerivedInteger(value: number): void {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new EconomyDomainError('ECONOMY_DERIVED_VALUE_INVALID');
  }
}

export interface EconomyTransaction {
  reason: string;
  delta: number;
}

export interface EconomyResult {
  profile: PublicProfile;
  transaction: EconomyTransaction;
}

export interface RescueClaimRules {
  threshold: number;
  target: number;
  dailyLimit: number;
  cooldownMs: number;
}

interface PublicProfileRow {
  id: string;
  alias: string;
  avatar_id: string;
  balance: number;
  active_escrow: number;
}

interface LedgerOperationRow {
  profile_id: string | null;
  account: string;
  delta: number;
  reason: string;
  ref_id: string | null;
}

export class EconomyRepository {
  constructor(private readonly database: PokerDatabase) {}

  applyWalletDelta(
    profileId: string,
    delta: number,
    reason: string,
    idempotencyKey: string,
    refId?: string,
    at = Date.now(),
  ): EconomyResult {
    this.validateDelta(delta);
    assertValidEconomyTimestamp(at);
    return this.database.transaction(() => this.applyWalletDeltaInTransaction(
      profileId,
      delta,
      reason,
      idempotencyKey,
      refId ?? null,
      at,
    ));
  }

  claimDaily(
    profileId: string,
    claimDate: string,
    amount: number,
    availableAt: number,
    at: number,
  ): EconomyResult {
    assertCanonicalClaimDate(claimDate);
    assertPositiveSafeInteger(amount);
    assertValidEconomyTimestamp(at);
    assertValidEconomyTimestamp(availableAt);
    if (availableAt <= at) {
      throw new EconomyDomainError('ECONOMY_DERIVED_VALUE_INVALID');
    }
    return this.database.transaction(() => {
      this.requirePublicProfile(profileId);
      const existing = this.database.db.prepare(`
        SELECT 1 FROM daily_claims
        WHERE profile_id = ? AND claim_date = ?
      `).get(profileId, claimDate);
      if (existing) {
        throw new EconomyDomainError('DAILY_ALREADY_CLAIMED', availableAt);
      }
      this.database.db.prepare(`
        INSERT INTO daily_claims (profile_id, claim_date, amount, claimed_at)
        VALUES (?, ?, ?, ?)
      `).run(profileId, claimDate, amount, at);
      return this.applyWalletDeltaInTransaction(
        profileId,
        amount,
        'DAILY_GRANT',
        `daily:${profileId}:${claimDate}`,
        null,
        at,
      );
    });
  }

  claimRescue(
    profileId: string,
    claimDate: string,
    rules: RescueClaimRules,
    nextKstMidnight: number,
    at: number,
  ): EconomyResult {
    assertCanonicalClaimDate(claimDate);
    assertValidRescueRules(rules);
    assertValidEconomyTimestamp(at);
    assertValidEconomyTimestamp(nextKstMidnight);
    if (nextKstMidnight <= at) {
      throw new EconomyDomainError('ECONOMY_DERIVED_VALUE_INVALID');
    }
    return this.database.transaction(() => {
      const current = this.requirePublicProfile(profileId);
      const activeEscrow = this.database.db.prepare(`
        SELECT 1 FROM seat_escrows
        WHERE profile_id = ? AND status = 'active'
      `).get(profileId);
      if (activeEscrow) {
        throw new EconomyDomainError('RESCUE_ACTIVE_ESCROW');
      }
      if (current.wallet.balance >= rules.threshold) {
        throw new EconomyDomainError('RESCUE_NOT_ELIGIBLE');
      }

      const today = this.database.db.prepare(`
        SELECT COUNT(*) AS count, COALESCE(MAX(ordinal), 0) AS max_ordinal
        FROM rescue_claims
        WHERE profile_id = ? AND claim_date = ?
      `).get(profileId, claimDate) as { count: number; max_ordinal: number };
      const latest = this.database.db.prepare(`
        SELECT claimed_at
        FROM rescue_claims
        WHERE profile_id = ?
        ORDER BY claimed_at DESC
        LIMIT 1
      `).get(profileId) as { claimed_at: number } | undefined;
      assertPersistedNonnegativeSafeInteger(today.count);
      assertPersistedNonnegativeSafeInteger(today.max_ordinal);
      if (latest) {
        assertValidEconomyTimestamp(
          latest.claimed_at,
          'ECONOMY_PERSISTENCE_INVALID',
        );
      }
      const cooldownAvailableAt = latest === undefined
        ? 0
        : deriveTimestamp(latest.claimed_at, rules.cooldownMs);

      if (today.count >= rules.dailyLimit) {
        const dailyAvailableAt = Math.max(
          nextKstMidnight,
          cooldownAvailableAt,
        );
        assertValidEconomyTimestamp(
          dailyAvailableAt,
          'ECONOMY_DERIVED_VALUE_INVALID',
        );
        throw new EconomyDomainError(
          'RESCUE_DAILY_LIMIT',
          dailyAvailableAt,
        );
      }
      if (latest && at < cooldownAvailableAt) {
        throw new EconomyDomainError('RESCUE_COOLDOWN', cooldownAvailableAt);
      }

      const delta = rules.target - current.wallet.balance;
      assertPositiveDerivedInteger(delta);
      const ordinal = today.max_ordinal + 1;
      assertPositiveDerivedInteger(ordinal);
      this.database.db.prepare(`
        INSERT INTO rescue_claims (
          profile_id, claim_date, ordinal, amount, claimed_at
        ) VALUES (?, ?, ?, ?, ?)
      `).run(profileId, claimDate, ordinal, delta, at);
      return this.applyWalletDeltaInTransaction(
        profileId,
        delta,
        'RESCUE_GRANT',
        `rescue:${profileId}:${claimDate}:${ordinal}`,
        null,
        at,
      );
    });
  }

  private applyWalletDeltaInTransaction(
    profileId: string,
    delta: number,
    reason: string,
    idempotencyKey: string,
    refId: string | null,
    at: number,
  ): EconomyResult {
    const current = this.requirePublicProfile(profileId);
    const existing = this.database.db.prepare(`
      SELECT profile_id, account, delta, reason, ref_id
      FROM chip_ledger
      WHERE idempotency_key = ?
    `).get(idempotencyKey) as LedgerOperationRow | undefined;
    if (existing) {
      if (
        existing.profile_id !== profileId
        || existing.account !== 'wallet'
        || existing.delta !== delta
        || existing.reason !== reason
        || existing.ref_id !== refId
      ) {
        throw new EconomyDomainError('IDEMPOTENCY_KEY_CONFLICT');
      }
      return {
        profile: current,
        transaction: { reason, delta },
      };
    }

    const nextBalance = current.wallet.balance + delta;
    if (!Number.isSafeInteger(nextBalance)) {
      throw new EconomyDomainError('WALLET_BALANCE_OVERFLOW');
    }
    if (nextBalance < 0) {
      throw new EconomyDomainError('INSUFFICIENT_BALANCE');
    }

    this.database.db.prepare(`
      UPDATE wallets SET balance = ?, updated_at = ? WHERE profile_id = ?
    `).run(nextBalance, at, profileId);
    this.database.db.prepare(`
      INSERT INTO chip_ledger (
        id, profile_id, account, delta, reason,
        ref_id, idempotency_key, created_at
      ) VALUES (?, ?, 'wallet', ?, ?, ?, ?, ?)
    `).run(
      randomUUID(),
      profileId,
      delta,
      reason,
      refId,
      idempotencyKey,
      at,
    );

    return {
      profile: this.requirePublicProfile(profileId),
      transaction: { reason, delta },
    };
  }

  private requirePublicProfile(profileId: string): PublicProfile {
    const row = this.database.db.prepare(`
      SELECT
        profiles.id,
        profiles.alias,
        profiles.avatar_id,
        wallets.balance,
        COALESCE((
          SELECT amount
          FROM seat_escrows
          WHERE profile_id = profiles.id AND status = 'active'
        ), 0) AS active_escrow
      FROM profiles
      JOIN wallets ON wallets.profile_id = profiles.id
      WHERE profiles.id = ?
    `).get(profileId) as PublicProfileRow | undefined;
    if (!row) throw new EconomyDomainError('PROFILE_NOT_FOUND');
    if (
      !Number.isSafeInteger(row.balance)
      || !Number.isSafeInteger(row.active_escrow)
    ) {
      throw new EconomyDomainError('WALLET_BALANCE_OVERFLOW');
    }
    return {
      id: row.id,
      alias: row.alias,
      avatarId: row.avatar_id,
      wallet: {
        balance: row.balance,
        activeEscrow: row.active_escrow,
      },
    };
  }

  private validateDelta(delta: number): void {
    if (!Number.isSafeInteger(delta) || delta === 0) {
      throw new EconomyDomainError('WALLET_DELTA_INVALID');
    }
  }
}
