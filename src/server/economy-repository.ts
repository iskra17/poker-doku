import { createHash, randomUUID } from 'node:crypto';
import type { PublicProfile } from '@/lib/profile/types';
import { computePayouts } from '@/lib/poker/payout-table';
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
  | 'CASH_SETTLEMENT_INVALID'
  | 'SNG_ENTRY_INVALID'
  | 'SNG_ACTIVE_SEAT'
  | 'SNG_ENTRY_NOT_FOUND'
  | 'SNG_START_INVALID'
  | 'SNG_SETTLEMENT_INVALID'
  | 'SNG_SETTLEMENT_CONFLICT';

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

export interface EconomyStatusSnapshot {
  profile: PublicProfile;
  dailyClaimed: boolean;
  rescueClaimsToday: number;
  latestRescueAt: number | null;
  hasActiveEscrow: boolean;
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

export type SngEntryStatus = 'reserved' | 'started' | 'settled' | 'refunded';

export interface SngEntry {
  id: string;
  tournamentId: string;
  roomId: string;
  profileId: string;
  buyIn: number;
  fee: number;
  status: SngEntryStatus;
  place: number | null;
  prize: number;
  startAttempt: number;
}

export interface SngResult {
  playerId: string;
  place: number;
  prize: number;
}

interface SngEntryRow {
  id: string;
  tournament_id: string;
  room_id: string;
  profile_id: string;
  buy_in: number;
  fee: number;
  status: SngEntryStatus;
  place: number | null;
  prize: number;
  start_attempt: number;
}

interface ActiveSeatEscrowRow {
  id: string;
  mode: 'cash' | 'sng';
  room_id: string;
  amount: number;
  checkpoint_amount: number;
}

export class EconomyRepository {
  constructor(private readonly database: PokerDatabase) {}

  getStatusSnapshot(
    profileId: string,
    claimDate: string,
  ): EconomyStatusSnapshot {
    assertCanonicalClaimDate(claimDate);
    const profile = this.requirePublicProfile(profileId);
    const daily = this.database.db.prepare(`
      SELECT claimed_at FROM daily_claims
      WHERE profile_id = ? AND claim_date = ?
    `).get(profileId, claimDate) as { claimed_at: number } | undefined;
    const today = this.database.db.prepare(`
      SELECT COUNT(*) AS count
      FROM rescue_claims
      WHERE profile_id = ? AND claim_date = ?
    `).get(profileId, claimDate) as { count: number };
    const latest = this.database.db.prepare(`
      SELECT claimed_at
      FROM rescue_claims
      WHERE profile_id = ?
      ORDER BY claimed_at DESC
      LIMIT 1
    `).get(profileId) as { claimed_at: number } | undefined;
    const activeEscrow = this.database.db.prepare(`
      SELECT 1 FROM seat_escrows
      WHERE profile_id = ? AND status = 'active'
      LIMIT 1
    `).get(profileId);

    if (daily) {
      assertValidEconomyTimestamp(
        daily.claimed_at,
        'ECONOMY_PERSISTENCE_INVALID',
      );
    }
    assertPersistedNonnegativeSafeInteger(today.count);
    if (latest) {
      assertValidEconomyTimestamp(
        latest.claimed_at,
        'ECONOMY_PERSISTENCE_INVALID',
      );
    }
    return {
      profile,
      dailyClaimed: daily !== undefined,
      rescueClaimsToday: today.count,
      latestRescueAt: latest?.claimed_at ?? null,
      hasActiveEscrow: activeEscrow !== undefined,
    };
  }

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

  reserveSngEntry(
    profileId: string,
    roomId: string,
    buyIn: number,
    fee: number,
    at: number,
  ): SngEntry {
    const total = this.assertSngAmounts(buyIn, fee);
    this.assertSngIdentity(profileId, roomId);
    assertValidEconomyTimestamp(at);
    return this.database.transaction(() => {
      const existingEntry = this.getActiveSngEntry(profileId);
      if (existingEntry) {
        if (
          existingEntry.roomId === roomId
          && existingEntry.buyIn === buyIn
          && existingEntry.fee === fee
        ) {
          this.requireMatchingSngSeat(existingEntry, total);
          return existingEntry;
        }
        throw new EconomyDomainError('SNG_ACTIVE_SEAT');
      }
      if (this.getActiveSeatEscrow(profileId)) {
        throw new EconomyDomainError('SNG_ACTIVE_SEAT');
      }

      const roomEntries = this.listActiveSngEntriesByRoom(roomId);
      if (roomEntries.length >= 6) {
        throw new EconomyDomainError('SNG_START_INVALID');
      }
      let tournamentId: string = randomUUID();
      if (roomEntries.length > 0) {
        this.assertSngTournamentRows(roomEntries, buyIn, fee, 'reserved');
        tournamentId = roomEntries[0].tournamentId;
      }
      return this.insertReservedEntry(
        profileId,
        roomId,
        tournamentId,
        buyIn,
        fee,
        total,
        at,
      );
    });
  }

  /** 예약 참가 공통 삽입 — 지갑 차감 + 참가 행 + 좌석 에스크로 + 원장 (SnG/MTT 공용) */
  private insertReservedEntry(
    profileId: string,
    entryKey: string,
    incarnationId: string,
    buyIn: number,
    fee: number,
    total: number,
    at: number,
  ): SngEntry {
    const profile = this.requirePublicProfile(profileId);
    if (profile.wallet.balance < total) {
      throw new EconomyDomainError('INSUFFICIENT_BALANCE');
    }
    const nextBalance = this.safeAdd(
      profile.wallet.balance,
      -total,
      'WALLET_BALANCE_OVERFLOW',
    );
    const entryId = randomUUID();
    this.database.db.prepare(`
      UPDATE wallets SET balance = ?, updated_at = ? WHERE profile_id = ?
    `).run(nextBalance, at, profileId);
    this.database.db.prepare(`
      INSERT INTO sng_entries (
        id, tournament_id, room_id, profile_id, buy_in, fee,
        status, place, prize, start_attempt, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, 'reserved', NULL, 0, 0, ?, ?)
    `).run(
      entryId,
      incarnationId,
      entryKey,
      profileId,
      buyIn,
      fee,
      at,
      at,
    );
    this.database.db.prepare(`
      INSERT INTO seat_escrows (
        id, profile_id, room_id, mode, amount, checkpoint_amount,
        checkpoint_hand, status, updated_at
      ) VALUES (?, ?, ?, 'sng', ?, ?, 0, 'active', ?)
    `).run(entryId, profileId, entryKey, total, total, at);
    this.insertLedger({
      profileId,
      account: 'wallet',
      delta: -total,
      reason: 'SNG_ENTRY_RESERVE',
      refId: entryKey,
      idempotencyKey: `sng-reserve:${entryId}:wallet`,
      at,
    });
    this.insertLedger({
      profileId,
      account: 'escrow',
      delta: total,
      reason: 'SNG_ENTRY_RESERVE',
      refId: entryKey,
      idempotencyKey: `sng-reserve:${entryId}:escrow`,
      at,
    });
    return this.requireSngEntry(entryId);
  }

  hasActiveSngEntry(profileId: string, roomId: string): boolean {
    this.assertSngIdentity(profileId, roomId);
    const entry = this.getActiveSngEntry(profileId);
    if (!entry || entry.roomId !== roomId) return false;
    this.requireMatchingSngSeat(
      entry,
      this.assertSngAmounts(entry.buyIn, entry.fee),
    );
    return true;
  }

  cancelSngEntry(
    profileId: string,
    roomId: string,
    at: number,
  ): SngEntry | null {
    this.assertSngIdentity(profileId, roomId);
    assertValidEconomyTimestamp(at);
    return this.database.transaction(() => {
      const entry = this.getActiveSngEntry(profileId);
      if (!entry) return null;
      if (entry.roomId !== roomId) {
        throw new EconomyDomainError('SNG_ACTIVE_SEAT');
      }
      if (entry.status !== 'reserved') {
        throw new EconomyDomainError('SNG_START_INVALID');
      }
      this.refundSngEntry(entry, 'SNG_ENTRY_REFUND', at);
      return { ...entry, status: 'refunded' as const };
    });
  }

  cancelWaitingSngRoom(roomId: string, at: number): number {
    this.assertSngIdentity('room-disposal', roomId);
    assertValidEconomyTimestamp(at);
    return this.database.transaction(() => {
      const entries = this.listActiveSngEntriesByRoom(roomId);
      if (entries.some(entry => entry.status !== 'reserved')) {
        throw new EconomyDomainError('SNG_START_INVALID');
      }
      for (const entry of entries) {
        this.requireMatchingSngSeat(
          entry,
          this.assertSngAmounts(entry.buyIn, entry.fee),
        );
      }
      for (const entry of entries) {
        this.refundSngEntry(entry, 'SNG_ENTRY_REFUND', at);
      }
      return entries.length;
    });
  }

  startSngTournament(
    roomId: string,
    profileIds: readonly string[],
    buyIn: number,
    fee: number,
    at: number,
  ): string {
    this.assertSngIdentity(profileIds[0] ?? '', roomId);
    this.assertSngEntrants(profileIds);
    const total = this.assertSngAmounts(buyIn, fee);
    assertValidEconomyTimestamp(at);
    return this.database.transaction(() => {
      const entries = this.listActiveSngEntriesByRoom(roomId);
      this.assertExactSngProfiles(entries, profileIds);
      const statuses = new Set(entries.map(entry => entry.status));
      if (statuses.size !== 1) {
        throw new EconomyDomainError('SNG_START_INVALID');
      }
      const status = entries[0]?.status;
      if (status !== 'reserved' && status !== 'started') {
        throw new EconomyDomainError('SNG_START_INVALID');
      }
      this.assertSngTournamentRows(entries, buyIn, fee, status);
      for (const entry of entries) this.requireMatchingSngSeat(entry, total);
      if (status === 'started') {
        for (const entry of entries) this.assertSngStartLedger(entry);
        return entries[0].tournamentId;
      }

      for (const entry of entries) {
        this.burnEntryFee(entry, roomId, buyIn, fee, at);
      }
      return entries[0].tournamentId;
    });
  }

  /** 시작 수수료 소각 + started 전이 공통 처리 (SnG/MTT 공용) */
  private burnEntryFee(
    entry: SngEntry,
    refKey: string,
    buyIn: number,
    fee: number,
    at: number,
  ): void {
    const attempt = this.safeAdd(
      entry.startAttempt,
      1,
      'SNG_START_INVALID',
    );
    this.insertLedger({
      profileId: entry.profileId,
      account: 'escrow',
      delta: -fee,
      reason: 'SNG_FEE_BURN',
      refId: refKey,
      idempotencyKey: `sng-start:${entry.id}:${attempt}:escrow`,
      at,
    });
    this.insertLedger({
      profileId: entry.profileId,
      account: 'burn',
      delta: fee,
      reason: 'SNG_FEE_BURN',
      refId: refKey,
      idempotencyKey: `sng-start:${entry.id}:${attempt}:burn`,
      at,
    });
    this.database.db.prepare(`
      UPDATE sng_entries
      SET status = 'started', start_attempt = ?, updated_at = ?
      WHERE id = ? AND status = 'reserved'
    `).run(attempt, at, entry.id);
    this.database.db.prepare(`
      UPDATE seat_escrows
      SET amount = ?, checkpoint_amount = ?, updated_at = ?
      WHERE id = ? AND mode = 'sng' AND status = 'active'
    `).run(buyIn, buyIn, at, entry.id);
  }

  revertSngTournamentStart(
    roomId: string,
    profileIds: readonly string[],
    buyIn: number,
    fee: number,
    at: number,
  ): boolean {
    this.assertSngIdentity(profileIds[0] ?? '', roomId);
    this.assertSngEntrants(profileIds);
    const total = this.assertSngAmounts(buyIn, fee);
    assertValidEconomyTimestamp(at);
    return this.database.transaction(() => {
      const entries = this.listActiveSngEntriesByRoom(roomId);
      this.assertExactSngProfiles(entries, profileIds);
      if (entries.every(entry => entry.status === 'reserved')) return false;
      this.assertSngTournamentRows(entries, buyIn, fee, 'started');
      for (const entry of entries) {
        this.requireMatchingSngSeat(entry, total);
        this.assertSngStartLedger(entry);
        if (entry.startAttempt <= 0) {
          throw new EconomyDomainError('SNG_START_INVALID');
        }
        this.insertLedger({
          profileId: entry.profileId,
          account: 'escrow',
          delta: fee,
          reason: 'SNG_FEE_REVERT',
          refId: roomId,
          idempotencyKey: `sng-start-revert:${entry.id}:${entry.startAttempt}:escrow`,
          at,
        });
        this.insertLedger({
          profileId: entry.profileId,
          account: 'burn',
          delta: -fee,
          reason: 'SNG_FEE_REVERT',
          refId: roomId,
          idempotencyKey: `sng-start-revert:${entry.id}:${entry.startAttempt}:burn`,
          at,
        });
        this.database.db.prepare(`
          UPDATE sng_entries SET status = 'reserved', updated_at = ?
          WHERE id = ? AND status = 'started'
        `).run(at, entry.id);
        this.database.db.prepare(`
          UPDATE seat_escrows
          SET amount = ?, checkpoint_amount = ?, updated_at = ?
          WHERE id = ? AND mode = 'sng' AND status = 'active'
        `).run(total, total, at, entry.id);
      }
      return true;
    });
  }

  settleSngTournament(
    roomId: string,
    results: readonly SngResult[],
    buyIn: number,
    fee: number,
    at: number,
  ): string {
    this.assertSngIdentity('settlement', roomId);
    this.assertSngAmounts(buyIn, fee);
    assertValidEconomyTimestamp(at);
    return this.database.transaction(() => {
      let entries = this.listActiveSngEntriesByRoom(roomId);
      if (entries.length === 0) {
        entries = this.listLatestSettledSngEntries(roomId);
        this.assertSettledSngDuplicate(entries, results, buyIn, fee);
        return entries[0].tournamentId;
      }
      const expectedPrizes = this.assertSngResults(results, buyIn, fee);
      this.assertExactSngProfiles(
        entries,
        results.map(result => result.playerId),
        'SNG_SETTLEMENT_INVALID',
      );
      this.assertSngTournamentRows(entries, buyIn, fee, 'started');
      const resultByProfile = new Map(results.map(result => [result.playerId, result]));
      let paid = 0;
      for (const entry of entries) {
        this.requireMatchingSngSeat(
          entry,
          this.assertSngAmounts(buyIn, fee),
        );
        this.assertSngStartLedger(entry);
        const result = resultByProfile.get(entry.profileId);
        if (!result) throw new EconomyDomainError('SNG_SETTLEMENT_INVALID');
        if (result.prize > 0) {
          const profile = this.requirePublicProfile(entry.profileId);
          const nextBalance = this.safeAdd(
            profile.wallet.balance,
            result.prize,
            'WALLET_BALANCE_OVERFLOW',
          );
          this.database.db.prepare(`
            UPDATE wallets SET balance = ?, updated_at = ? WHERE profile_id = ?
          `).run(nextBalance, at, entry.profileId);
          this.insertLedger({
            profileId: entry.profileId,
            account: 'wallet',
            delta: result.prize,
            reason: 'SNG_PRIZE',
            refId: roomId,
            idempotencyKey: `sng-prize:${roomId}:${entry.profileId}:${entry.tournamentId}`,
            at,
          });
          paid = this.safeAdd(paid, result.prize, 'SNG_SETTLEMENT_INVALID');
        }
        this.insertLedger({
          profileId: entry.profileId,
          account: 'escrow',
          delta: -buyIn,
          reason: 'SNG_PRIZE_POOL',
          refId: roomId,
          idempotencyKey: `sng-pool:${roomId}:${entry.profileId}:${entry.tournamentId}`,
          at,
        });
        this.database.db.prepare(`
          UPDATE sng_entries
          SET status = 'settled', place = ?, prize = ?, updated_at = ?
          WHERE id = ? AND status = 'started'
        `).run(result.place, result.prize, at, entry.id);
        this.database.db.prepare(`
          UPDATE seat_escrows
          SET status = 'settled', amount = 0, checkpoint_amount = 0, updated_at = ?
          WHERE id = ? AND mode = 'sng' AND status = 'active'
        `).run(at, entry.id);
      }
      const expectedTotal = expectedPrizes.reduce((sum, prize) => (
        this.safeAdd(sum, prize, 'SNG_SETTLEMENT_INVALID')
      ), 0);
      if (paid !== expectedTotal) {
        throw new EconomyDomainError('SNG_SETTLEMENT_INVALID');
      }
      return entries[0].tournamentId;
    });
  }

  // --- wallet MTT 토너 단위 에스크로 (Phase 2 — spec-mtt §4-7) ---
  // sng_entries를 공유하되 room_id 자리에 **토너먼트 ID**를 키로 쓴다 (1토너=N방이라
  // 방 단위 집계가 성립하지 않음). 원장 사유(SNG_*)와 좌석 에스크로(mode 'sng')는 그대로
  // 재사용해 잔액 보존·복구(recoverIncompleteSngEntries)·이중 착석 가드를 공짜로 승계한다.
  // SnG와 다른 곳은 정원(6 고정 → 2~maxEntrants)과 상금표(50/30/20 고정 → payout-table)뿐.

  reserveMttEntry(
    profileId: string,
    tournamentId: string,
    buyIn: number,
    fee: number,
    maxEntrants: number,
    at: number,
  ): SngEntry {
    const total = this.assertSngAmounts(buyIn, fee);
    this.assertSngIdentity(profileId, tournamentId);
    if (
      !Number.isSafeInteger(maxEntrants)
      || maxEntrants < 2
      || maxEntrants > 1000
    ) {
      throw new EconomyDomainError('SNG_ENTRY_INVALID');
    }
    assertValidEconomyTimestamp(at);
    return this.database.transaction(() => {
      const existingEntry = this.getActiveSngEntry(profileId);
      if (existingEntry) {
        if (
          existingEntry.roomId === tournamentId
          && existingEntry.status === 'reserved'
          && existingEntry.buyIn === buyIn
          && existingEntry.fee === fee
        ) {
          this.requireMatchingSngSeat(existingEntry, total);
          return existingEntry;
        }
        throw new EconomyDomainError('SNG_ACTIVE_SEAT');
      }
      if (this.getActiveSeatEscrow(profileId)) {
        throw new EconomyDomainError('SNG_ACTIVE_SEAT');
      }

      const groupEntries = this.listActiveSngEntriesByRoom(tournamentId);
      if (groupEntries.length >= maxEntrants) {
        throw new EconomyDomainError('SNG_START_INVALID');
      }
      let incarnationId: string = randomUUID();
      if (groupEntries.length > 0) {
        this.assertSngTournamentRows(groupEntries, buyIn, fee, 'reserved');
        incarnationId = groupEntries[0].tournamentId;
      }
      return this.insertReservedEntry(
        profileId,
        tournamentId,
        incarnationId,
        buyIn,
        fee,
        total,
        at,
      );
    });
  }

  /** MTT 시작 에스크로 — 체크인 확정 인원의 수수료 소각 + started 전이 (재시도 멱등) */
  startMttTournament(
    tournamentId: string,
    profileIds: readonly string[],
    buyIn: number,
    fee: number,
    at: number,
  ): string {
    this.assertSngIdentity(profileIds[0] ?? '', tournamentId);
    this.assertMttEntrants(profileIds);
    const total = this.assertSngAmounts(buyIn, fee);
    assertValidEconomyTimestamp(at);
    return this.database.transaction(() => {
      const entries = this.listActiveSngEntriesByRoom(tournamentId);
      this.assertExactSngProfiles(entries, profileIds);
      const statuses = new Set(entries.map(entry => entry.status));
      if (statuses.size !== 1) {
        throw new EconomyDomainError('SNG_START_INVALID');
      }
      const status = entries[0]?.status;
      if (status !== 'reserved' && status !== 'started') {
        throw new EconomyDomainError('SNG_START_INVALID');
      }
      this.assertSngTournamentRows(entries, buyIn, fee, status);
      for (const entry of entries) this.requireMatchingSngSeat(entry, total);
      if (status === 'started') {
        for (const entry of entries) this.assertSngStartLedger(entry);
        return entries[0].tournamentId;
      }
      for (const entry of entries) {
        this.burnEntryFee(entry, tournamentId, buyIn, fee, at);
      }
      return entries[0].tournamentId;
    });
  }

  /**
   * MTT 정산 — 전 순위 확정 결과에 payout-table 계단표를 강제하고 상금을 지급한다.
   * 이미 정산된 토너먼트에 같은 결과로 재호출하면 멱등 통과, 다른 결과면 CONFLICT.
   */
  settleMttTournament(
    tournamentId: string,
    results: readonly SngResult[],
    buyIn: number,
    fee: number,
    at: number,
  ): string {
    this.assertSngIdentity('settlement', tournamentId);
    this.assertSngAmounts(buyIn, fee);
    assertValidEconomyTimestamp(at);
    return this.database.transaction(() => {
      let entries = this.listActiveSngEntriesByRoom(tournamentId);
      if (entries.length === 0) {
        entries = this.listLatestSettledSngEntries(tournamentId);
        this.assertSettledMttDuplicate(entries, results, buyIn, fee);
        return entries[0].tournamentId;
      }
      const expectedPrizes = this.assertMttResults(results, buyIn, fee);
      this.assertExactSngProfiles(
        entries,
        results.map(result => result.playerId),
        'SNG_SETTLEMENT_INVALID',
      );
      this.assertSngTournamentRows(entries, buyIn, fee, 'started');
      const resultByProfile = new Map(results.map(result => [result.playerId, result]));
      let paid = 0;
      for (const entry of entries) {
        this.requireMatchingSngSeat(
          entry,
          this.assertSngAmounts(buyIn, fee),
        );
        this.assertSngStartLedger(entry);
        const result = resultByProfile.get(entry.profileId);
        if (!result) throw new EconomyDomainError('SNG_SETTLEMENT_INVALID');
        if (result.prize > 0) {
          const profile = this.requirePublicProfile(entry.profileId);
          const nextBalance = this.safeAdd(
            profile.wallet.balance,
            result.prize,
            'WALLET_BALANCE_OVERFLOW',
          );
          this.database.db.prepare(`
            UPDATE wallets SET balance = ?, updated_at = ? WHERE profile_id = ?
          `).run(nextBalance, at, entry.profileId);
          this.insertLedger({
            profileId: entry.profileId,
            account: 'wallet',
            delta: result.prize,
            reason: 'SNG_PRIZE',
            refId: tournamentId,
            idempotencyKey: `sng-prize:${tournamentId}:${entry.profileId}:${entry.tournamentId}`,
            at,
          });
          paid = this.safeAdd(paid, result.prize, 'SNG_SETTLEMENT_INVALID');
        }
        this.insertLedger({
          profileId: entry.profileId,
          account: 'escrow',
          delta: -buyIn,
          reason: 'SNG_PRIZE_POOL',
          refId: tournamentId,
          idempotencyKey: `sng-pool:${tournamentId}:${entry.profileId}:${entry.tournamentId}`,
          at,
        });
        this.database.db.prepare(`
          UPDATE sng_entries
          SET status = 'settled', place = ?, prize = ?, updated_at = ?
          WHERE id = ? AND status = 'started'
        `).run(result.place, result.prize, at, entry.id);
        this.database.db.prepare(`
          UPDATE seat_escrows
          SET status = 'settled', amount = 0, checkpoint_amount = 0, updated_at = ?
          WHERE id = ? AND mode = 'sng' AND status = 'active'
        `).run(at, entry.id);
      }
      const expectedTotal = expectedPrizes.reduce((sum, prize) => (
        this.safeAdd(sum, prize, 'SNG_SETTLEMENT_INVALID')
      ), 0);
      if (paid !== expectedTotal) {
        throw new EconomyDomainError('SNG_SETTLEMENT_INVALID');
      }
      return entries[0].tournamentId;
    });
  }

  /**
   * MTT 무효화 환불 — 취소(디렉터/인원 미달) 시 활성 참가 전원에게 전액(수수료 포함) 반환.
   * reserved/started 혼재를 허용한다 (등록 중 취소와 진행 중 취소를 한 경로로 처리).
   */
  voidMttTournament(tournamentId: string, at: number): number {
    this.assertSngIdentity('void', tournamentId);
    assertValidEconomyTimestamp(at);
    return this.database.transaction(() => {
      const entries = this.listActiveSngEntriesByRoom(tournamentId);
      for (const entry of entries) {
        const total = this.assertSngAmounts(entry.buyIn, entry.fee);
        this.requireMatchingSngSeat(entry, total);
        if (entry.status === 'started') this.assertSngStartLedger(entry);
      }
      for (const entry of entries) {
        this.refundSngEntry(entry, 'SNG_VOID_REFUND', at);
      }
      return entries.length;
    });
  }

  recoverIncompleteSngEntries(at: number): number {
    assertValidEconomyTimestamp(at);
    return this.database.transaction(() => {
      const entries = this.listAllIncompleteSngEntries();
      for (const entry of entries) {
        const total = this.assertSngAmounts(entry.buyIn, entry.fee);
        this.requireMatchingSngSeat(entry, total);
        if (entry.status === 'started' && entry.startAttempt <= 0) {
          throw new EconomyDomainError('ECONOMY_PERSISTENCE_INVALID');
        }
        if (entry.status === 'started') this.assertSngStartLedger(entry);
      }
      for (const entry of entries) {
        this.refundSngEntry(entry, 'SNG_VOID_REFUND', at);
      }
      return entries.length;
    });
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
      const activeSeat = this.getActiveSeatEscrow(profileId);
      if (activeSeat?.mode === 'sng') {
        throw new EconomyDomainError('CASH_ESCROW_ACTIVE');
      }
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

  private assertSngStartLedger(entry: SngEntry): void {
    if (entry.startAttempt <= 0) {
      throw new EconomyDomainError('ECONOMY_PERSISTENCE_INVALID');
    }
    const expectations = [
      {
        key: `sng-start:${entry.id}:${entry.startAttempt}:escrow`,
        account: 'escrow',
        delta: -entry.fee,
      },
      {
        key: `sng-start:${entry.id}:${entry.startAttempt}:burn`,
        account: 'burn',
        delta: entry.fee,
      },
    ] as const;
    for (const expected of expectations) {
      const row = this.database.db.prepare(`
        SELECT profile_id, account, delta, reason, ref_id
        FROM chip_ledger WHERE idempotency_key = ?
      `).get(expected.key) as LedgerOperationRow | undefined;
      if (
        !row
        || row.profile_id !== entry.profileId
        || row.account !== expected.account
        || row.delta !== expected.delta
        || row.reason !== 'SNG_FEE_BURN'
        || row.ref_id !== entry.roomId
      ) {
        throw new EconomyDomainError('ECONOMY_PERSISTENCE_INVALID');
      }
    }
  }

  private assertSngReserveLedger(entry: SngEntry): void {
    const total = this.assertSngAmounts(entry.buyIn, entry.fee);
    const expectations = [
      {
        key: `sng-reserve:${entry.id}:wallet`,
        account: 'wallet',
        delta: -total,
      },
      {
        key: `sng-reserve:${entry.id}:escrow`,
        account: 'escrow',
        delta: total,
      },
    ] as const;
    for (const expected of expectations) {
      const row = this.database.db.prepare(`
        SELECT profile_id, account, delta, reason, ref_id
        FROM chip_ledger WHERE idempotency_key = ?
      `).get(expected.key) as LedgerOperationRow | undefined;
      if (
        !row
        || row.profile_id !== entry.profileId
        || row.account !== expected.account
        || row.delta !== expected.delta
        || row.reason !== 'SNG_ENTRY_RESERVE'
        || row.ref_id !== entry.roomId
      ) {
        throw new EconomyDomainError('ECONOMY_PERSISTENCE_INVALID');
      }
    }
  }

  private assertSngIdentity(profileId: string, roomId: string): void {
    if (!profileId || !roomId) {
      throw new EconomyDomainError('SNG_ENTRY_INVALID');
    }
  }

  private assertSngAmounts(buyIn: number, fee: number): number {
    if (
      !Number.isSafeInteger(buyIn)
      || buyIn <= 0
      || !Number.isSafeInteger(fee)
      || fee <= 0
    ) {
      throw new EconomyDomainError('SNG_ENTRY_INVALID');
    }
    return this.safeAdd(buyIn, fee, 'SNG_ENTRY_INVALID');
  }

  private assertSngEntrants(profileIds: readonly string[]): void {
    if (
      profileIds.length !== 6
      || new Set(profileIds).size !== 6
      || profileIds.some(profileId => !profileId)
    ) {
      throw new EconomyDomainError('SNG_START_INVALID');
    }
  }

  /** MTT 참가 명단 — 2~1000인 가변 정원, 중복/공백 금지 */
  private assertMttEntrants(profileIds: readonly string[]): void {
    if (
      profileIds.length < 2
      || profileIds.length > 1000
      || new Set(profileIds).size !== profileIds.length
      || profileIds.some(profileId => !profileId)
    ) {
      throw new EconomyDomainError('SNG_START_INVALID');
    }
  }

  /**
   * MTT 결과 검증 — 순위 1..N 완전 열거 + 상금은 payout-table 계단표(합계 보정)와
   * 정확히 일치해야 한다. 상금표의 단일 소스는 lib/poker/payout-table (UI와 동일).
   */
  private assertMttResults(
    results: readonly SngResult[],
    buyIn: number,
    fee: number,
  ): readonly number[] {
    this.assertSngAmounts(buyIn, fee);
    const count = Array.isArray(results) ? results.length : 0;
    if (
      count < 2
      || count > 1000
      || results.some(result => (
        !result
        || typeof result !== 'object'
        || typeof result.playerId !== 'string'
        || !result.playerId
        || !Number.isSafeInteger(result.place)
        || result.place < 1
        || result.place > count
        || !Number.isSafeInteger(result.prize)
        || result.prize < 0
      ))
      || new Set(results.map(result => result.playerId)).size !== count
      || new Set(results.map(result => result.place)).size !== count
    ) {
      throw new EconomyDomainError('SNG_SETTLEMENT_INVALID');
    }
    const pool = this.safeMultiply(buyIn, count, 'SNG_SETTLEMENT_INVALID');
    const ladder = computePayouts(pool, count);
    const prizes = Array.from(
      { length: count },
      (_, index) => ladder[index] ?? 0,
    );
    if (prizes.some(prize => !Number.isSafeInteger(prize) || prize < 0)) {
      throw new EconomyDomainError('SNG_SETTLEMENT_INVALID');
    }
    for (const result of results) {
      if (result.prize !== prizes[result.place - 1]) {
        throw new EconomyDomainError('SNG_SETTLEMENT_INVALID');
      }
    }
    return prizes;
  }

  private assertSngResults(
    results: readonly SngResult[],
    buyIn: number,
    fee: number,
  ): readonly number[] {
    this.assertSngAmounts(buyIn, fee);
    if (
      !Array.isArray(results)
      || results.length !== 6
      || results.some(result => (
        !result
        || typeof result !== 'object'
        || typeof result.playerId !== 'string'
        || !result.playerId
        || !Number.isSafeInteger(result.place)
        || result.place < 1
        || result.place > 6
        || !Number.isSafeInteger(result.prize)
        || result.prize < 0
      ))
      || new Set(results.map(result => result.playerId)).size !== 6
      || new Set(results.map(result => result.place)).size !== 6
    ) {
      throw new EconomyDomainError('SNG_SETTLEMENT_INVALID');
    }
    const pool = this.safeMultiply(buyIn, 6, 'SNG_SETTLEMENT_INVALID');
    if (pool % 10 !== 0) {
      throw new EconomyDomainError('SNG_SETTLEMENT_INVALID');
    }
    const prizes = [
      pool / 2,
      this.safeMultiply(pool, 3, 'SNG_SETTLEMENT_INVALID') / 10,
      pool / 5,
      0,
      0,
      0,
    ];
    if (prizes.some(prize => !Number.isSafeInteger(prize))) {
      throw new EconomyDomainError('SNG_SETTLEMENT_INVALID');
    }
    for (const result of results) {
      if (result.prize !== prizes[result.place - 1]) {
        throw new EconomyDomainError('SNG_SETTLEMENT_INVALID');
      }
    }
    return prizes;
  }

  /**
   * 참가 원장 행과 기대 프로필 집합의 완전 일치 검증.
   * 인원은 profileIds 길이를 따른다(2인 이상) — SnG 경로는 상위에서 6인을 별도 강제
   * (assertSngEntrants/assertSngResults)하고, MTT 경로는 가변 정원을 허용한다.
   */
  private assertExactSngProfiles(
    entries: readonly SngEntry[],
    profileIds: readonly string[],
    code: EconomyErrorCode = 'SNG_START_INVALID',
  ): void {
    const count = profileIds.length;
    if (
      count < 2
      || entries.length !== count
      || new Set(entries.map(entry => entry.profileId)).size !== count
      || new Set(profileIds).size !== count
    ) {
      throw new EconomyDomainError(code);
    }
    const actual = entries.map(entry => entry.profileId).sort();
    const expected = [...profileIds].sort();
    if (actual.some((profileId, index) => profileId !== expected[index])) {
      throw new EconomyDomainError(code);
    }
  }

  private assertSngTournamentRows(
    entries: readonly SngEntry[],
    buyIn: number,
    fee: number,
    status: SngEntryStatus,
  ): void {
    if (entries.length === 0) {
      throw new EconomyDomainError('SNG_START_INVALID');
    }
    const tournamentId = entries[0].tournamentId;
    if (
      !tournamentId
      || entries.some(entry => (
        entry.tournamentId !== tournamentId
        || entry.buyIn !== buyIn
        || entry.fee !== fee
        || entry.status !== status
      ))
    ) {
      throw new EconomyDomainError(
        status === 'settled'
          ? 'SNG_SETTLEMENT_CONFLICT'
          : 'SNG_START_INVALID',
      );
    }
  }

  private getActiveSeatEscrow(profileId: string): ActiveSeatEscrowRow | null {
    const row = this.database.db.prepare(`
      SELECT id, mode, room_id, amount, checkpoint_amount
      FROM seat_escrows
      WHERE profile_id = ? AND status = 'active'
    `).get(profileId) as ActiveSeatEscrowRow | undefined;
    if (!row) return null;
    if (
      !row.id
      || (row.mode !== 'cash' && row.mode !== 'sng')
      || !row.room_id
      || !Number.isSafeInteger(row.amount)
      || row.amount < 0
      || !Number.isSafeInteger(row.checkpoint_amount)
      || row.checkpoint_amount < 0
    ) {
      throw new EconomyDomainError('ECONOMY_PERSISTENCE_INVALID');
    }
    return row;
  }

  private requireMatchingSngSeat(entry: SngEntry, total: number): void {
    const seat = this.getActiveSeatEscrow(entry.profileId);
    const expectedAmount = entry.status === 'started' ? entry.buyIn : total;
    if (
      !seat
      || seat.id !== entry.id
      || seat.mode !== 'sng'
      || seat.room_id !== entry.roomId
      || seat.amount !== expectedAmount
      || seat.checkpoint_amount !== expectedAmount
    ) {
      throw new EconomyDomainError('ECONOMY_PERSISTENCE_INVALID');
    }
    this.assertSngReserveLedger(entry);
  }

  private getActiveSngEntry(profileId: string): SngEntry | null {
    const row = this.database.db.prepare(`
      SELECT id, tournament_id, room_id, profile_id, buy_in, fee,
             status, place, prize, start_attempt
      FROM sng_entries
      WHERE profile_id = ? AND status IN ('reserved', 'started')
    `).get(profileId) as SngEntryRow | undefined;
    return row ? this.toSngEntry(row) : null;
  }

  private listActiveSngEntriesByRoom(roomId: string): SngEntry[] {
    const rows = this.database.db.prepare(`
      SELECT id, tournament_id, room_id, profile_id, buy_in, fee,
             status, place, prize, start_attempt
      FROM sng_entries
      WHERE room_id = ? AND status IN ('reserved', 'started')
      ORDER BY profile_id
    `).all(roomId) as unknown as SngEntryRow[];
    return rows.map(row => this.toSngEntry(row));
  }

  private listAllIncompleteSngEntries(): SngEntry[] {
    const rows = this.database.db.prepare(`
      SELECT id, tournament_id, room_id, profile_id, buy_in, fee,
             status, place, prize, start_attempt
      FROM sng_entries
      WHERE status IN ('reserved', 'started')
      ORDER BY room_id, tournament_id, profile_id
    `).all() as unknown as SngEntryRow[];
    return rows.map(row => this.toSngEntry(row));
  }

  private listLatestSettledSngEntries(roomId: string): SngEntry[] {
    const latest = this.database.db.prepare(`
      SELECT tournament_id
      FROM sng_entries
      WHERE room_id = ? AND status = 'settled'
      ORDER BY updated_at DESC, tournament_id DESC
      LIMIT 1
    `).get(roomId) as { tournament_id: string } | undefined;
    if (!latest) throw new EconomyDomainError('SNG_ENTRY_NOT_FOUND');
    const rows = this.database.db.prepare(`
      SELECT id, tournament_id, room_id, profile_id, buy_in, fee,
             status, place, prize, start_attempt
      FROM sng_entries
      WHERE tournament_id = ?
      ORDER BY profile_id
    `).all(latest.tournament_id) as unknown as SngEntryRow[];
    return rows.map(row => this.toSngEntry(row));
  }

  private requireSngEntry(entryId: string): SngEntry {
    const row = this.database.db.prepare(`
      SELECT id, tournament_id, room_id, profile_id, buy_in, fee,
             status, place, prize, start_attempt
      FROM sng_entries WHERE id = ?
    `).get(entryId) as SngEntryRow | undefined;
    if (!row) throw new EconomyDomainError('SNG_ENTRY_NOT_FOUND');
    return this.toSngEntry(row);
  }

  private toSngEntry(row: SngEntryRow): SngEntry {
    if (
      !row.id
      || !row.tournament_id
      || !row.room_id
      || !row.profile_id
      || !['reserved', 'started', 'settled', 'refunded'].includes(row.status)
      || !Number.isSafeInteger(row.buy_in)
      || row.buy_in <= 0
      || !Number.isSafeInteger(row.fee)
      || row.fee <= 0
      || !Number.isSafeInteger(row.prize)
      || row.prize < 0
      || !Number.isSafeInteger(row.start_attempt)
      || row.start_attempt < 0
      // MTT(토너 단위 참가)는 순위가 6위를 넘는다 — DDL(v26)과 동일 상한
      || (row.place !== null && (
        !Number.isSafeInteger(row.place) || row.place < 1 || row.place > 1000
      ))
      || (
        (row.status === 'reserved' || row.status === 'started' || row.status === 'refunded')
        && (row.place !== null || row.prize !== 0)
      )
      || (row.status === 'settled' && row.place === null)
    ) {
      throw new EconomyDomainError('ECONOMY_PERSISTENCE_INVALID');
    }
    return {
      id: row.id,
      tournamentId: row.tournament_id,
      roomId: row.room_id,
      profileId: row.profile_id,
      buyIn: row.buy_in,
      fee: row.fee,
      status: row.status,
      place: row.place,
      prize: row.prize,
      startAttempt: row.start_attempt,
    };
  }

  private assertSettledSngDuplicate(
    entries: readonly SngEntry[],
    results: readonly SngResult[],
    buyIn: number,
    fee: number,
  ): void {
    let persisted: SngResult[];
    const persistedBuyIn = entries[0]?.buyIn;
    const persistedFee = entries[0]?.fee;
    try {
      if (persistedBuyIn === undefined || persistedFee === undefined) {
        throw new EconomyDomainError('ECONOMY_PERSISTENCE_INVALID');
      }
      this.assertSngAmounts(persistedBuyIn, persistedFee);
      this.assertExactSngProfiles(
        entries,
        entries.map(entry => entry.profileId),
        'ECONOMY_PERSISTENCE_INVALID',
      );
      this.assertSngTournamentRows(
        entries,
        persistedBuyIn,
        persistedFee,
        'settled',
      );
      persisted = entries.map(entry => ({
        playerId: entry.profileId,
        place: entry.place as number,
        prize: entry.prize,
      }));
      this.assertSngResults(persisted, persistedBuyIn, persistedFee);
    } catch (error) {
      if (
        error instanceof EconomyDomainError
        && error.code === 'ECONOMY_PERSISTENCE_INVALID'
      ) {
        throw error;
      }
      throw new EconomyDomainError('ECONOMY_PERSISTENCE_INVALID');
    }

    if (buyIn !== persistedBuyIn || fee !== persistedFee) {
      throw new EconomyDomainError('SNG_SETTLEMENT_CONFLICT');
    }
    try {
      this.assertSngResults(results, buyIn, fee);
    } catch {
      throw new EconomyDomainError('SNG_SETTLEMENT_CONFLICT');
    }
    const canonical = (values: readonly SngResult[]): string => JSON.stringify(
      [...values]
        .sort((left, right) => left.playerId.localeCompare(right.playerId))
        .map(result => [result.playerId, result.place, result.prize]),
    );
    if (canonical(results) !== canonical(persisted)) {
      throw new EconomyDomainError('SNG_SETTLEMENT_CONFLICT');
    }
  }

  /** MTT 정산 재호출 멱등 검증 — SnG 버전의 payout-table(가변 정원) 변형 */
  private assertSettledMttDuplicate(
    entries: readonly SngEntry[],
    results: readonly SngResult[],
    buyIn: number,
    fee: number,
  ): void {
    let persisted: SngResult[];
    const persistedBuyIn = entries[0]?.buyIn;
    const persistedFee = entries[0]?.fee;
    try {
      if (persistedBuyIn === undefined || persistedFee === undefined) {
        throw new EconomyDomainError('ECONOMY_PERSISTENCE_INVALID');
      }
      this.assertSngAmounts(persistedBuyIn, persistedFee);
      this.assertExactSngProfiles(
        entries,
        entries.map(entry => entry.profileId),
        'ECONOMY_PERSISTENCE_INVALID',
      );
      this.assertSngTournamentRows(
        entries,
        persistedBuyIn,
        persistedFee,
        'settled',
      );
      persisted = entries.map(entry => ({
        playerId: entry.profileId,
        place: entry.place as number,
        prize: entry.prize,
      }));
      this.assertMttResults(persisted, persistedBuyIn, persistedFee);
    } catch (error) {
      if (
        error instanceof EconomyDomainError
        && error.code === 'ECONOMY_PERSISTENCE_INVALID'
      ) {
        throw error;
      }
      throw new EconomyDomainError('ECONOMY_PERSISTENCE_INVALID');
    }

    if (buyIn !== persistedBuyIn || fee !== persistedFee) {
      throw new EconomyDomainError('SNG_SETTLEMENT_CONFLICT');
    }
    try {
      this.assertMttResults(results, buyIn, fee);
    } catch {
      throw new EconomyDomainError('SNG_SETTLEMENT_CONFLICT');
    }
    const canonical = (values: readonly SngResult[]): string => JSON.stringify(
      [...values]
        .sort((left, right) => left.playerId.localeCompare(right.playerId))
        .map(result => [result.playerId, result.place, result.prize]),
    );
    if (canonical(results) !== canonical(persisted)) {
      throw new EconomyDomainError('SNG_SETTLEMENT_CONFLICT');
    }
  }

  private refundSngEntry(
    entry: SngEntry,
    reason: 'SNG_ENTRY_REFUND' | 'SNG_VOID_REFUND',
    at: number,
  ): void {
    const total = this.assertSngAmounts(entry.buyIn, entry.fee);
    this.requireMatchingSngSeat(entry, total);
    const profile = this.requirePublicProfile(entry.profileId);
    const nextBalance = this.safeAdd(
      profile.wallet.balance,
      total,
      'WALLET_BALANCE_OVERFLOW',
    );
    const keyPrefix = reason === 'SNG_VOID_REFUND' ? 'sng-void' : 'sng-refund';
    this.database.db.prepare(`
      UPDATE wallets SET balance = ?, updated_at = ? WHERE profile_id = ?
    `).run(nextBalance, at, entry.profileId);
    this.insertLedger({
      profileId: entry.profileId,
      account: 'wallet',
      delta: total,
      reason,
      refId: entry.roomId,
      idempotencyKey: `${keyPrefix}:${entry.id}:wallet`,
      at,
    });
    this.insertLedger({
      profileId: entry.profileId,
      account: 'escrow',
      delta: entry.status === 'started' ? -entry.buyIn : -total,
      reason,
      refId: entry.roomId,
      idempotencyKey: `${keyPrefix}:${entry.id}:escrow`,
      at,
    });
    if (entry.status === 'started') {
      this.insertLedger({
        profileId: entry.profileId,
        account: 'burn',
        delta: -entry.fee,
        reason,
        refId: entry.roomId,
        idempotencyKey: `${keyPrefix}:${entry.id}:burn`,
        at,
      });
    }
    this.database.db.prepare(`
      UPDATE sng_entries
      SET status = 'refunded', place = NULL, prize = 0, updated_at = ?
      WHERE id = ? AND status IN ('reserved', 'started')
    `).run(at, entry.id);
    this.database.db.prepare(`
      UPDATE seat_escrows
      SET status = 'settled', amount = 0, checkpoint_amount = 0, updated_at = ?
      WHERE id = ? AND mode = 'sng' AND status = 'active'
    `).run(at, entry.id);
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

  private safeMultiply(
    left: number,
    right: number,
    code: EconomyErrorCode,
  ): number {
    const value = left * right;
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
