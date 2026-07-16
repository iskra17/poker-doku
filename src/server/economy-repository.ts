import { createHash, randomUUID } from 'node:crypto';
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
  | 'ECONOMY_PERSISTENCE_INVALID'
  | 'CASH_BUY_IN_INVALID'
  | 'CASH_ESCROW_ACTIVE'
  | 'CASH_ESCROW_NOT_FOUND'
  | 'CASH_ESCROW_MISMATCH'
  | 'CASH_CHECKPOINT_INVALID'
  | 'CASH_CONSERVATION_INVALID'
  | 'CASH_SETTLEMENT_INVALID';

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

export interface CashEscrow {
  id: string;
  profileId: string;
  roomId: string;
  amount: number;
  checkpointAmount: number;
  checkpointHand: number;
}

export interface CashHandStack {
  profileId: string;
  amount: number;
}

export interface CashHandDelta {
  profileId: string;
  startAmount: number;
  endAmount: number;
}

interface CashEscrowRow {
  id: string;
  profile_id: string;
  room_id: string;
  amount: number;
  checkpoint_amount: number;
  checkpoint_hand: number;
}

interface CashHandSettlementRow {
  room_id: string;
  settlement_seq: number;
  engine_hand_number: number;
  start_fingerprint: string;
  settlement_fingerprint: string | null;
  status: 'prepared' | 'settled' | 'voided';
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

  openCashEscrow(
    profileId: string,
    roomId: string,
    buyIn: number,
    at: number,
  ): CashEscrow {
    this.assertCashAmount(buyIn, false, 'CASH_BUY_IN_INVALID');
    assertValidEconomyTimestamp(at);
    return this.database.transaction(() => {
      const existing = this.getActiveCashEscrow(profileId);
      if (existing) {
        if (
          existing.roomId === roomId
          && existing.amount === buyIn
          && existing.checkpointAmount === buyIn
        ) {
          return existing;
        }
        throw new EconomyDomainError('CASH_ESCROW_ACTIVE');
      }

      const current = this.requirePublicProfile(profileId);
      if (current.wallet.balance < buyIn) {
        throw new EconomyDomainError('INSUFFICIENT_BALANCE');
      }
      const escrowId = randomUUID();
      const nextBalance = current.wallet.balance - buyIn;
      this.assertCashAmount(nextBalance, true, 'WALLET_BALANCE_OVERFLOW');
      this.database.db.prepare(`
        UPDATE wallets SET balance = ?, updated_at = ? WHERE profile_id = ?
      `).run(nextBalance, at, profileId);
      this.database.db.prepare(`
        INSERT INTO seat_escrows (
          id, profile_id, room_id, mode, amount, checkpoint_amount,
          checkpoint_hand, status, updated_at
        ) VALUES (?, ?, ?, 'cash', ?, ?, 0, 'active', ?)
      `).run(escrowId, profileId, roomId, buyIn, buyIn, at);
      this.insertLedger({
        profileId,
        account: 'wallet',
        delta: -buyIn,
        reason: 'CASH_BUY_IN',
        refId: roomId,
        idempotencyKey: `cash-open:${escrowId}:wallet`,
        at,
      });
      this.insertLedger({
        profileId,
        account: 'escrow',
        delta: buyIn,
        reason: 'CASH_BUY_IN',
        refId: roomId,
        idempotencyKey: `cash-open:${escrowId}:escrow`,
        at,
      });
      return this.requireActiveCashEscrow(profileId, roomId);
    });
  }

  rebuyCashEscrow(
    profileId: string,
    roomId: string,
    buyIn: number,
    at: number,
  ): CashEscrow {
    this.assertCashAmount(buyIn, false, 'CASH_BUY_IN_INVALID');
    assertValidEconomyTimestamp(at);
    return this.database.transaction(() => {
      const escrow = this.requireActiveCashEscrow(profileId, roomId);
      const prefix = `cash-rebuy:${escrow.id}:${escrow.checkpointHand}`;
      if (escrow.amount === buyIn && escrow.checkpointAmount === buyIn) {
        const walletRow = this.database.db.prepare(`
          SELECT profile_id, account, delta, reason, ref_id
          FROM chip_ledger WHERE idempotency_key = ?
        `).get(`${prefix}:wallet`) as LedgerOperationRow | undefined;
        this.assertMatchingLedger(walletRow, {
          profileId,
          account: 'wallet',
          delta: -buyIn,
          reason: 'CASH_REBUY',
          refId: roomId,
        });
        return escrow;
      }
      if (escrow.amount !== 0 || escrow.checkpointAmount !== 0) {
        throw new EconomyDomainError('CASH_CHECKPOINT_INVALID');
      }

      const profile = this.requirePublicProfile(profileId);
      if (profile.wallet.balance < buyIn) {
        throw new EconomyDomainError('INSUFFICIENT_BALANCE');
      }
      const nextBalance = profile.wallet.balance - buyIn;
      this.database.db.prepare(`
        UPDATE wallets SET balance = ?, updated_at = ? WHERE profile_id = ?
      `).run(nextBalance, at, profileId);
      this.database.db.prepare(`
        UPDATE seat_escrows
        SET amount = ?, checkpoint_amount = ?, updated_at = ?
        WHERE id = ? AND status = 'active'
      `).run(buyIn, buyIn, at, escrow.id);
      this.insertLedger({
        profileId,
        account: 'wallet',
        delta: -buyIn,
        reason: 'CASH_REBUY',
        refId: roomId,
        idempotencyKey: `${prefix}:wallet`,
        at,
      });
      this.insertLedger({
        profileId,
        account: 'escrow',
        delta: buyIn,
        reason: 'CASH_REBUY',
        refId: roomId,
        idempotencyKey: `${prefix}:escrow`,
        at,
      });
      return this.requireActiveCashEscrow(profileId, roomId);
    });
  }

  closeCashEscrow(
    profileId: string,
    roomId: string,
    reason: 'CASH_JOIN_REFUND' | 'CASH_CASHOUT',
    at: number,
  ): CashEscrow | null {
    assertValidEconomyTimestamp(at);
    return this.database.transaction(() => {
      const escrow = this.getActiveCashEscrow(profileId);
      if (!escrow) return null;
      if (escrow.roomId !== roomId) {
        throw new EconomyDomainError('CASH_ESCROW_MISMATCH');
      }
      this.closeEscrowInTransaction(escrow, reason, at);
      return escrow;
    });
  }

  closeCashEscrowsByRoom(roomId: string, at: number): number {
    assertValidEconomyTimestamp(at);
    return this.database.transaction(() => {
      const escrows = this.listActiveCashEscrows(roomId);
      for (const escrow of escrows) {
        this.closeEscrowInTransaction(escrow, 'CASH_CASHOUT', at);
      }
      this.database.db.prepare(`
        UPDATE cash_hand_settlements
        SET status = 'voided', updated_at = ?
        WHERE room_id = ? AND status = 'prepared'
      `).run(at, roomId);
      return escrows.length;
    });
  }

  hasActiveCashEscrows(roomId: string): boolean {
    return !!this.database.db.prepare(`
      SELECT 1 FROM seat_escrows
      WHERE room_id = ? AND mode = 'cash' AND status = 'active'
      LIMIT 1
    `).get(roomId);
  }

  hasActiveCashEscrow(profileId: string, roomId: string): boolean {
    return !!this.database.db.prepare(`
      SELECT 1 FROM seat_escrows
      WHERE profile_id = ? AND room_id = ?
        AND mode = 'cash' AND status = 'active'
      LIMIT 1
    `).get(profileId, roomId);
  }

  checkpointCashHand(
    roomId: string,
    handNumber: number,
    stacks: readonly CashHandStack[],
    at: number,
  ): number {
    this.assertCashHandNumber(handNumber);
    assertValidEconomyTimestamp(at);
    this.assertUniqueProfiles(stacks);
    for (const stack of stacks) {
      this.assertCashAmount(stack.amount, true, 'CASH_CHECKPOINT_INVALID');
    }
    const startFingerprint = this.fingerprintCashHandStart(stacks);
    return this.database.transaction(() => {
      const prepared = this.database.db.prepare(`
        SELECT room_id, settlement_seq, engine_hand_number, start_fingerprint,
               settlement_fingerprint, status
        FROM cash_hand_settlements
        WHERE room_id = ? AND status = 'prepared'
      `).get(roomId) as CashHandSettlementRow | undefined;
      let settlementSeq: number;
      if (prepared) {
        this.assertPersistedSettlementRow(prepared);
        if (
          prepared.engine_hand_number !== handNumber
          || prepared.start_fingerprint !== startFingerprint
        ) {
          throw new EconomyDomainError('CASH_CHECKPOINT_INVALID');
        }
        settlementSeq = prepared.settlement_seq;
      } else {
        const latest = this.database.db.prepare(`
          SELECT COALESCE(MAX(settlement_seq), 0) AS settlement_seq
          FROM cash_hand_settlements WHERE room_id = ?
        `).get(roomId) as { settlement_seq: number };
        if (!Number.isSafeInteger(latest.settlement_seq) || latest.settlement_seq < 0) {
          throw new EconomyDomainError('ECONOMY_PERSISTENCE_INVALID');
        }
        settlementSeq = this.safeAdd(
          latest.settlement_seq,
          1,
          'CASH_CHECKPOINT_INVALID',
        );
        this.database.db.prepare(`
          INSERT INTO cash_hand_settlements (
            room_id, settlement_seq, engine_hand_number, start_fingerprint,
            settlement_fingerprint, status, updated_at
          ) VALUES (?, ?, ?, ?, NULL, 'prepared', ?)
        `).run(roomId, settlementSeq, handNumber, startFingerprint, at);
      }

      for (const stack of stacks) {
        const escrow = this.requireActiveCashEscrow(stack.profileId, roomId);
        if (escrow.amount !== stack.amount) {
          throw new EconomyDomainError('CASH_CHECKPOINT_INVALID');
        }
        this.database.db.prepare(`
          UPDATE seat_escrows
          SET checkpoint_amount = ?, checkpoint_hand = ?, updated_at = ?
          WHERE id = ? AND status = 'active'
        `).run(stack.amount, handNumber, at, escrow.id);
      }
      return settlementSeq;
    });
  }

  cancelPreparedCashHand(
    roomId: string,
    handNumber: number,
    at: number,
  ): boolean {
    this.assertCashHandNumber(handNumber);
    assertValidEconomyTimestamp(at);
    return this.database.transaction(() => {
      const cancelled = this.database.db.prepare(`
        UPDATE cash_hand_settlements
        SET status = 'voided', updated_at = ?
        WHERE room_id = ? AND engine_hand_number = ? AND status = 'prepared'
      `).run(at, roomId, handNumber);
      if (cancelled.changes > 1) {
        throw new EconomyDomainError('ECONOMY_PERSISTENCE_INVALID');
      }
      return cancelled.changes === 1;
    });
  }

  settleCashHand(
    roomId: string,
    handNumber: number,
    humans: readonly CashHandDelta[],
    botDelta: number,
    rake: number,
    at: number,
  ): void {
    this.assertCashHandNumber(handNumber);
    assertValidEconomyTimestamp(at);
    this.assertUniqueProfiles(humans);
    this.assertCashAmount(rake, true, 'CASH_SETTLEMENT_INVALID');
    if (!Number.isSafeInteger(botDelta)) {
      throw new EconomyDomainError('CASH_SETTLEMENT_INVALID');
    }
    let humanDelta = 0;
    for (const human of humans) {
      this.assertCashAmount(human.startAmount, true, 'CASH_SETTLEMENT_INVALID');
      this.assertCashAmount(human.endAmount, true, 'CASH_SETTLEMENT_INVALID');
      humanDelta = this.safeAdd(
        humanDelta,
        human.endAmount - human.startAmount,
        'CASH_SETTLEMENT_INVALID',
      );
    }
    const conserved = this.safeAdd(
      this.safeAdd(humanDelta, botDelta, 'CASH_CONSERVATION_INVALID'),
      rake,
      'CASH_CONSERVATION_INVALID',
    );
    if (conserved !== 0) {
      throw new EconomyDomainError('CASH_CONSERVATION_INVALID');
    }

    const startFingerprint = this.fingerprintCashHandStart(
      humans.map(human => ({
        profileId: human.profileId,
        amount: human.startAmount,
      })),
    );
    const settlementFingerprint = this.fingerprintCashHandSettlement(
      humans,
      botDelta,
      rake,
    );
    this.database.transaction(() => {
      const prepared = this.database.db.prepare(`
        SELECT room_id, settlement_seq, engine_hand_number, start_fingerprint,
               settlement_fingerprint, status
        FROM cash_hand_settlements
        WHERE room_id = ? AND status = 'prepared'
      `).get(roomId) as CashHandSettlementRow | undefined;
      const identity = prepared ?? this.database.db.prepare(`
        SELECT room_id, settlement_seq, engine_hand_number, start_fingerprint,
               settlement_fingerprint, status
        FROM cash_hand_settlements
        WHERE room_id = ? AND status = 'settled' AND engine_hand_number = ?
        ORDER BY settlement_seq DESC
        LIMIT 1
      `).get(roomId, handNumber) as CashHandSettlementRow | undefined;
      if (!identity) throw new EconomyDomainError('CASH_CHECKPOINT_INVALID');
      this.assertPersistedSettlementRow(identity);
      if (
        identity.engine_hand_number !== handNumber
        || identity.start_fingerprint !== startFingerprint
      ) {
        throw new EconomyDomainError(
          identity.status === 'settled'
            ? 'IDEMPOTENCY_KEY_CONFLICT'
            : 'CASH_CHECKPOINT_INVALID',
        );
      }
      if (identity.status === 'settled') {
        if (identity.settlement_fingerprint !== settlementFingerprint) {
          throw new EconomyDomainError('IDEMPOTENCY_KEY_CONFLICT');
        }
        return;
      }

      const prefix = `cash-hand:${roomId}:${identity.settlement_seq}`;

      for (const human of humans) {
        const escrow = this.requireActiveCashEscrow(human.profileId, roomId);
        if (
          escrow.amount !== human.startAmount
          || escrow.checkpointAmount !== human.startAmount
          || escrow.checkpointHand !== handNumber
        ) {
          throw new EconomyDomainError('CASH_CHECKPOINT_INVALID');
        }
        const delta = human.endAmount - human.startAmount;
        this.insertLedger({
          profileId: human.profileId,
          account: 'escrow',
          delta,
          reason: this.deltaReason(
            delta,
            'CASH_HAND_WIN',
            'CASH_HAND_LOSS',
            'CASH_HAND_NEUTRAL',
          ),
          refId: roomId,
          idempotencyKey: `${prefix}:human:${human.profileId}`,
          at,
        });
        this.database.db.prepare(`
          UPDATE seat_escrows
          SET amount = ?, checkpoint_amount = ?, checkpoint_hand = ?, updated_at = ?
          WHERE id = ? AND status = 'active'
        `).run(human.endAmount, human.endAmount, handNumber, at, escrow.id);
      }
      this.insertLedger({
        profileId: null,
        account: 'bot',
        delta: botDelta,
        reason: this.deltaReason(
          botDelta,
          'BOT_NET_WIN',
          'BOT_NET_LOSS',
          'BOT_NET_NEUTRAL',
        ),
        refId: roomId,
        idempotencyKey: `${prefix}:bot`,
        at,
      });
      this.insertLedger({
        profileId: null,
        account: 'burn',
        delta: rake,
        reason: 'RAKE_BURN',
        refId: roomId,
        idempotencyKey: `${prefix}:rake`,
        at,
      });
      const completed = this.database.db.prepare(`
        UPDATE cash_hand_settlements
        SET settlement_fingerprint = ?, status = 'settled', updated_at = ?
        WHERE room_id = ? AND settlement_seq = ? AND status = 'prepared'
      `).run(
        settlementFingerprint,
        at,
        roomId,
        identity.settlement_seq,
      );
      if (completed.changes !== 1) {
        throw new EconomyDomainError('CASH_SETTLEMENT_INVALID');
      }
    });
  }

  recoverActiveCashEscrows(at: number): number {
    assertValidEconomyTimestamp(at);
    return this.database.transaction(() => {
      const escrows = this.listActiveCashEscrows();
      for (const escrow of escrows) {
        this.assertCashAmount(
          escrow.checkpointAmount,
          true,
          'ECONOMY_PERSISTENCE_INVALID',
        );
        this.assertCashHandNumber(escrow.checkpointHand, true);
        const latestIdentity = this.database.db.prepare(`
          SELECT room_id, settlement_seq, engine_hand_number, start_fingerprint,
                 settlement_fingerprint, status
          FROM cash_hand_settlements
          WHERE room_id = ?
          ORDER BY settlement_seq DESC
          LIMIT 1
        `).get(escrow.roomId) as CashHandSettlementRow | undefined;
        if (latestIdentity) this.assertPersistedSettlementRow(latestIdentity);
        const durableCheckpoint = latestIdentity?.settlement_seq ?? 0;
        const voidKey = `void:${escrow.profileId}:${escrow.roomId}`
          + `:${escrow.checkpointHand}:s${durableCheckpoint}:e${escrow.id}`;
        const profile = this.requirePublicProfile(escrow.profileId);
        const nextBalance = this.safeAdd(
          profile.wallet.balance,
          escrow.checkpointAmount,
          'WALLET_BALANCE_OVERFLOW',
        );
        this.database.db.prepare(`
          UPDATE wallets SET balance = ?, updated_at = ? WHERE profile_id = ?
        `).run(nextBalance, at, escrow.profileId);
        this.insertLedger({
          profileId: escrow.profileId,
          account: 'wallet',
          delta: escrow.checkpointAmount,
          reason: 'CASH_VOID_REFUND',
          refId: escrow.roomId,
          idempotencyKey: voidKey,
          at,
        });
        this.insertLedger({
          profileId: escrow.profileId,
          account: 'escrow',
          delta: -escrow.checkpointAmount,
          reason: 'CASH_VOID_REFUND',
          refId: escrow.roomId,
          idempotencyKey: `${voidKey}:escrow`,
          at,
        });
        this.database.db.prepare(`
          UPDATE seat_escrows SET status = 'settled', amount = 0, updated_at = ?
          WHERE id = ? AND status = 'active'
        `).run(at, escrow.id);
        this.database.db.prepare(`
          UPDATE cash_hand_settlements
          SET status = 'voided', updated_at = ?
          WHERE room_id = ? AND status = 'prepared'
        `).run(at, escrow.roomId);
      }
      return escrows.length;
    });
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

  private closeEscrowInTransaction(
    escrow: CashEscrow,
    reason: 'CASH_JOIN_REFUND' | 'CASH_CASHOUT',
    at: number,
  ): void {
    const profile = this.requirePublicProfile(escrow.profileId);
    const nextBalance = this.safeAdd(
      profile.wallet.balance,
      escrow.amount,
      'WALLET_BALANCE_OVERFLOW',
    );
    this.database.db.prepare(`
      UPDATE wallets SET balance = ?, updated_at = ? WHERE profile_id = ?
    `).run(nextBalance, at, escrow.profileId);
    this.insertLedger({
      profileId: escrow.profileId,
      account: 'wallet',
      delta: escrow.amount,
      reason,
      refId: escrow.roomId,
      idempotencyKey: `cash-close:${escrow.id}:wallet`,
      at,
    });
    this.insertLedger({
      profileId: escrow.profileId,
      account: 'escrow',
      delta: -escrow.amount,
      reason,
      refId: escrow.roomId,
      idempotencyKey: `cash-close:${escrow.id}:escrow`,
      at,
    });
    this.database.db.prepare(`
      UPDATE seat_escrows SET status = 'settled', amount = 0, updated_at = ?
      WHERE id = ? AND status = 'active'
    `).run(at, escrow.id);
  }

  private insertLedger(input: {
    profileId: string | null;
    account: 'wallet' | 'escrow' | 'bot' | 'burn';
    delta: number;
    reason: string;
    refId: string | null;
    idempotencyKey: string;
    at: number;
  }): void {
    if (!Number.isSafeInteger(input.delta)) {
      throw new EconomyDomainError('CASH_SETTLEMENT_INVALID');
    }
    this.database.db.prepare(`
      INSERT INTO chip_ledger (
        id, profile_id, account, delta, reason,
        ref_id, idempotency_key, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      randomUUID(),
      input.profileId,
      input.account,
      input.delta,
      input.reason,
      input.refId,
      input.idempotencyKey,
      input.at,
    );
  }

  private assertMatchingLedger(
    existing: LedgerOperationRow | undefined,
    expected: {
      profileId: string | null;
      account: string;
      delta: number;
      reason: string;
      refId: string | null;
    },
  ): void {
    if (
      !existing
      || existing.profile_id !== expected.profileId
      || existing.account !== expected.account
      || existing.delta !== expected.delta
      || existing.reason !== expected.reason
      || existing.ref_id !== expected.refId
    ) {
      throw new EconomyDomainError('IDEMPOTENCY_KEY_CONFLICT');
    }
  }

  private listActiveCashEscrows(roomId?: string): CashEscrow[] {
    const rows = (roomId === undefined
      ? this.database.db.prepare(`
          SELECT id, profile_id, room_id, amount, checkpoint_amount, checkpoint_hand
          FROM seat_escrows
          WHERE mode = 'cash' AND status = 'active'
          ORDER BY profile_id, room_id
        `).all()
      : this.database.db.prepare(`
          SELECT id, profile_id, room_id, amount, checkpoint_amount, checkpoint_hand
          FROM seat_escrows
          WHERE room_id = ? AND mode = 'cash' AND status = 'active'
          ORDER BY profile_id
        `).all(roomId)) as unknown as CashEscrowRow[];
    return rows.map(row => this.toCashEscrow(row));
  }

  private getActiveCashEscrow(profileId: string): CashEscrow | null {
    const row = this.database.db.prepare(`
      SELECT id, profile_id, room_id, amount, checkpoint_amount, checkpoint_hand
      FROM seat_escrows
      WHERE profile_id = ? AND mode = 'cash' AND status = 'active'
    `).get(profileId) as CashEscrowRow | undefined;
    return row ? this.toCashEscrow(row) : null;
  }

  private requireActiveCashEscrow(profileId: string, roomId: string): CashEscrow {
    const escrow = this.getActiveCashEscrow(profileId);
    if (!escrow) throw new EconomyDomainError('CASH_ESCROW_NOT_FOUND');
    if (escrow.roomId !== roomId) {
      throw new EconomyDomainError('CASH_ESCROW_MISMATCH');
    }
    return escrow;
  }

  private toCashEscrow(row: CashEscrowRow): CashEscrow {
    this.assertCashAmount(row.amount, true, 'ECONOMY_PERSISTENCE_INVALID');
    this.assertCashAmount(
      row.checkpoint_amount,
      true,
      'ECONOMY_PERSISTENCE_INVALID',
    );
    this.assertCashHandNumber(row.checkpoint_hand, true);
    return {
      id: row.id,
      profileId: row.profile_id,
      roomId: row.room_id,
      amount: row.amount,
      checkpointAmount: row.checkpoint_amount,
      checkpointHand: row.checkpoint_hand,
    };
  }

  private assertUniqueProfiles(
    rows: readonly { profileId: string }[],
  ): void {
    const ids = new Set<string>();
    for (const row of rows) {
      if (!row.profileId || ids.has(row.profileId)) {
        throw new EconomyDomainError('CASH_SETTLEMENT_INVALID');
      }
      ids.add(row.profileId);
    }
  }

  private assertCashAmount(
    value: number,
    allowZero: boolean,
    code: EconomyErrorCode,
  ): void {
    if (!Number.isSafeInteger(value) || value < 0 || (!allowZero && value === 0)) {
      throw new EconomyDomainError(code);
    }
  }

  private assertCashHandNumber(value: number, allowZero = false): void {
    if (!Number.isSafeInteger(value) || value < (allowZero ? 0 : 1)) {
      throw new EconomyDomainError(
        allowZero ? 'ECONOMY_PERSISTENCE_INVALID' : 'CASH_CHECKPOINT_INVALID',
      );
    }
  }

  private safeAdd(
    left: number,
    right: number,
    code: EconomyErrorCode,
  ): number {
    const value = left + right;
    if (!Number.isSafeInteger(value)) throw new EconomyDomainError(code);
    return value;
  }

  private deltaReason(
    delta: number,
    positive: string,
    negative: string,
    neutral: string,
  ): string {
    return delta > 0 ? positive : delta < 0 ? negative : neutral;
  }

  private fingerprintCashHandStart(
    stacks: readonly CashHandStack[],
  ): string {
    const canonical = [...stacks]
      .sort((left, right) => left.profileId < right.profileId ? -1 : left.profileId > right.profileId ? 1 : 0)
      .map(stack => [stack.profileId, stack.amount] as const);
    return this.sha256Fingerprint({ humans: canonical });
  }

  private fingerprintCashHandSettlement(
    humans: readonly CashHandDelta[],
    botDelta: number,
    rake: number,
  ): string {
    const canonical = [...humans]
      .sort((left, right) => left.profileId < right.profileId ? -1 : left.profileId > right.profileId ? 1 : 0)
      .map(human => [
        human.profileId,
        human.startAmount,
        human.endAmount,
      ] as const);
    return this.sha256Fingerprint({ humans: canonical, botDelta, rake });
  }

  private sha256Fingerprint(value: unknown): string {
    return createHash('sha256')
      .update(JSON.stringify(value), 'utf8')
      .digest('hex');
  }

  private assertPersistedSettlementRow(row: CashHandSettlementRow): void {
    const fingerprintPattern = /^[a-f0-9]{64}$/;
    if (
      !Number.isSafeInteger(row.settlement_seq)
      || row.settlement_seq <= 0
      || !Number.isSafeInteger(row.engine_hand_number)
      || row.engine_hand_number <= 0
      || !fingerprintPattern.test(row.start_fingerprint)
      || (
        row.settlement_fingerprint !== null
        && !fingerprintPattern.test(row.settlement_fingerprint)
      )
      || (row.status === 'prepared' && row.settlement_fingerprint !== null)
      || (row.status === 'settled' && row.settlement_fingerprint === null)
    ) {
      throw new EconomyDomainError('ECONOMY_PERSISTENCE_INVALID');
    }
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
