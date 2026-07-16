import { randomUUID } from 'node:crypto';
import type { PublicProfile } from '@/lib/profile/types';
import type { PokerDatabase } from './persistence/database';

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
  | 'RESCUE_COOLDOWN';

export class EconomyDomainError extends Error {
  constructor(
    readonly code: EconomyErrorCode,
    readonly availableAt?: number,
  ) {
    super(code);
    this.name = 'EconomyDomainError';
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
    this.validateDelta(amount);
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
        SELECT MAX(claimed_at) AS claimed_at
        FROM rescue_claims
        WHERE profile_id = ?
      `).get(profileId) as { claimed_at: number | null };
      const cooldownAvailableAt = latest.claimed_at === null
        ? 0
        : latest.claimed_at + rules.cooldownMs;

      if (today.count >= rules.dailyLimit) {
        throw new EconomyDomainError(
          'RESCUE_DAILY_LIMIT',
          Math.max(nextKstMidnight, cooldownAvailableAt),
        );
      }
      if (latest.claimed_at !== null && at < cooldownAvailableAt) {
        throw new EconomyDomainError('RESCUE_COOLDOWN', cooldownAvailableAt);
      }

      const delta = rules.target - current.wallet.balance;
      this.validateDelta(delta);
      const ordinal = today.max_ordinal + 1;
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
