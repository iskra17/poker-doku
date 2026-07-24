import {
  EconomyDomainError,
  assertValidEconomyTimestamp,
  type EconomyErrorCode,
  type CashEscrow,
  type CashHandDelta,
  type CashHandStack,
  type EconomyRepository,
  type EconomyResult,
  type SngEntry,
  type SngResult,
} from './economy-repository';
import type { EconomyStatus, PublicProfile } from '@/lib/profile/types';
import {
  CASUAL_SNG_BUY_IN,
  CASUAL_SNG_ENTRY_FEE,
} from '@/lib/economy/casual-sng';
import {
  MTT_WALLET_BUY_IN,
  MTT_WALLET_ENTRY_FEE,
} from '@/lib/economy/mtt-entry';
import { cfg } from './game-config/live';
import type { PayoutPresetId } from '@/lib/poker/payout-table';

const KST_OFFSET_MS = 9 * 60 * 60 * 1_000;

const KST_DATE_FORMATTER = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Seoul',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

export interface EconomyRules {
  readonly startingChips: number;
  readonly dailyGrant: number;
  readonly rescueThreshold: number;
  readonly rescueTarget: number;
  readonly rescueDailyLimit: number;
  readonly rescueCooldownMs: number;
  readonly casualSngBuyIn: number;
  readonly casualSngFee: number;
}

/**
 * 경제 규칙 — 런타임 게임 설정(game-config)을 매 접근마다 읽는 live getter 객체.
 * 기본값의 정의처는 game-config/registry.ts (백오피스에서 무배포 조정 가능).
 * 소비처는 기존처럼 `ECONOMY_RULES.x`로 읽으면 항상 현재 유효값을 본다.
 * casualSng 계열은 클라이언트 번들(sng-entry 등)이 같은 상수를 import하므로
 * 서버만 바꾸면 화면과 어긋난다 — 클라 동기화 채널이 생기기 전까지 리터럴 유지.
 */
export const ECONOMY_RULES: EconomyRules = {
  get startingChips() { return cfg('economy.startingChips'); },
  get dailyGrant() { return cfg('economy.dailyGrant'); },
  get rescueThreshold() { return cfg('economy.rescueThreshold'); },
  get rescueTarget() { return cfg('economy.rescueTarget'); },
  get rescueDailyLimit() { return cfg('economy.rescueDailyLimit'); },
  get rescueCooldownMs() { return cfg('economy.rescueCooldownMs'); },
  casualSngBuyIn: CASUAL_SNG_BUY_IN,
  casualSngFee: CASUAL_SNG_ENTRY_FEE,
};

interface KstDateParts {
  year: number;
  month: number;
  day: number;
}

function getKstDateParts(
  at: number,
  errorCode: EconomyErrorCode = 'ECONOMY_TIME_INVALID',
): KstDateParts {
  assertValidEconomyTimestamp(at, errorCode);
  const values: Partial<Record<'year' | 'month' | 'day', number>> = {};
  for (const part of KST_DATE_FORMATTER.formatToParts(new Date(at))) {
    if (part.type === 'year' || part.type === 'month' || part.type === 'day') {
      values[part.type] = Number(part.value);
    }
  }
  const { year, month, day } = values;
  if (year === undefined || month === undefined || day === undefined) {
    throw new EconomyDomainError(errorCode);
  }
  if (
    !Number.isSafeInteger(year)
    || year < 1
    || year > 9_999
    || !Number.isSafeInteger(month)
    || month < 1
    || month > 12
    || !Number.isSafeInteger(day)
    || day < 1
    || day > 31
  ) {
    throw new EconomyDomainError(errorCode);
  }
  return { year, month, day };
}

export function getKstDateKey(at: number): string {
  const { year, month, day } = getKstDateParts(at);
  return [year, month, day]
    .map((value, index) => index === 0
      ? value.toString().padStart(4, '0')
      : value.toString().padStart(2, '0'))
    .join('-');
}

export function getNextKstMidnight(at: number): number {
  const { year, month, day } = getKstDateParts(at);
  const nextMidnight = Date.UTC(year, month - 1, day + 1) - KST_OFFSET_MS;
  getKstDateParts(nextMidnight, 'ECONOMY_DERIVED_VALUE_INVALID');
  return nextMidnight;
}

export { EconomyDomainError };

export interface EconomyStatusResult {
  profile: PublicProfile;
  economy: EconomyStatus;
}

export class EconomyService {
  constructor(
    private readonly repository: EconomyRepository,
    private readonly clock: () => number = Date.now,
  ) {}

  getStatus(profileId: string, at = this.clock()): EconomyStatusResult {
    const claimDate = getKstDateKey(at);
    const nextMidnight = getNextKstMidnight(at);
    const snapshot = this.repository.getStatusSnapshot(profileId, claimDate);
    // 한도 초과분은 0으로 클램프 — 핫 컨피그로 일일 한도를 낮추면 이미 수령한
    // 횟수가 새 한도를 넘는 상태가 정상적으로 존재한다 (수령분 회수 없음)
    const remainingToday = Math.max(
      0,
      ECONOMY_RULES.rescueDailyLimit - snapshot.rescueClaimsToday,
    );
    const cooldownAvailableAt = snapshot.latestRescueAt === null
      ? at
      : snapshot.latestRescueAt + ECONOMY_RULES.rescueCooldownMs;
    assertValidEconomyTimestamp(
      cooldownAvailableAt,
      'ECONOMY_DERIVED_VALUE_INVALID',
    );

    let rescue: EconomyStatus['rescue'];
    if (snapshot.hasActiveEscrow) {
      rescue = {
        eligible: false,
        grantAmount: 0,
        remainingToday,
        availableAt: null,
        reason: 'active-escrow',
      };
    } else if (snapshot.profile.wallet.balance >= ECONOMY_RULES.rescueThreshold) {
      rescue = {
        eligible: false,
        grantAmount: 0,
        remainingToday,
        availableAt: null,
        reason: 'balance-threshold',
      };
    } else if (remainingToday === 0) {
      const availableAt = Math.max(nextMidnight, cooldownAvailableAt);
      assertValidEconomyTimestamp(
        availableAt,
        'ECONOMY_DERIVED_VALUE_INVALID',
      );
      rescue = {
        eligible: false,
        grantAmount: 0,
        remainingToday,
        availableAt,
        reason: 'daily-limit',
      };
    } else if (cooldownAvailableAt > at) {
      rescue = {
        eligible: false,
        grantAmount: 0,
        remainingToday,
        availableAt: cooldownAvailableAt,
        reason: 'cooldown',
      };
    } else {
      const grantAmount = ECONOMY_RULES.rescueTarget
        - snapshot.profile.wallet.balance;
      if (!Number.isSafeInteger(grantAmount) || grantAmount <= 0) {
        throw new EconomyDomainError('ECONOMY_DERIVED_VALUE_INVALID');
      }
      rescue = {
        eligible: true,
        grantAmount,
        remainingToday,
        availableAt: at,
        reason: null,
      };
    }

    return {
      profile: snapshot.profile,
      economy: {
        hasActiveSeat: snapshot.hasActiveEscrow,
        daily: {
          claimed: snapshot.dailyClaimed,
          grantAmount: ECONOMY_RULES.dailyGrant,
          availableAt: snapshot.dailyClaimed ? nextMidnight : at,
        },
        rescue,
      },
    };
  }

  claimDaily(profileId: string, at = this.clock()): EconomyResult {
    return this.repository.claimDaily(
      profileId,
      getKstDateKey(at),
      ECONOMY_RULES.dailyGrant,
      getNextKstMidnight(at),
      at,
    );
  }

  claimRescue(profileId: string, at = this.clock()): EconomyResult {
    return this.repository.claimRescue(
      profileId,
      getKstDateKey(at),
      {
        threshold: ECONOMY_RULES.rescueThreshold,
        target: ECONOMY_RULES.rescueTarget,
        dailyLimit: ECONOMY_RULES.rescueDailyLimit,
        cooldownMs: ECONOMY_RULES.rescueCooldownMs,
      },
      getNextKstMidnight(at),
      at,
    );
  }

  reserveSngEntry(
    profileId: string,
    roomId: string,
    buyIn: number = ECONOMY_RULES.casualSngBuyIn,
    fee: number = ECONOMY_RULES.casualSngFee,
    at = this.clock(),
  ): SngEntry {
    return this.repository.reserveSngEntry(profileId, roomId, buyIn, fee, at);
  }

  hasActiveSngEntry(profileId: string, roomId: string): boolean {
    return this.repository.hasActiveSngEntry(profileId, roomId);
  }

  cancelSngEntry(
    profileId: string,
    roomId: string,
    at = this.clock(),
  ): SngEntry | null {
    return this.repository.cancelSngEntry(profileId, roomId, at);
  }

  cancelWaitingSngRoom(roomId: string, at = this.clock()): number {
    return this.repository.cancelWaitingSngRoom(roomId, at);
  }

  startSngTournament(
    roomId: string,
    profileIds: readonly string[],
    buyIn: number = ECONOMY_RULES.casualSngBuyIn,
    fee: number = ECONOMY_RULES.casualSngFee,
    at = this.clock(),
  ): string {
    return this.repository.startSngTournament(
      roomId,
      profileIds,
      buyIn,
      fee,
      at,
    );
  }

  revertSngTournamentStart(
    roomId: string,
    profileIds: readonly string[],
    buyIn: number = ECONOMY_RULES.casualSngBuyIn,
    fee: number = ECONOMY_RULES.casualSngFee,
    at = this.clock(),
  ): boolean {
    return this.repository.revertSngTournamentStart(
      roomId,
      profileIds,
      buyIn,
      fee,
      at,
    );
  }

  settleSngTournament(
    roomId: string,
    results: readonly SngResult[],
    buyIn: number = ECONOMY_RULES.casualSngBuyIn,
    fee: number = ECONOMY_RULES.casualSngFee,
    at = this.clock(),
  ): string {
    return this.repository.settleSngTournament(
      roomId,
      results,
      buyIn,
      fee,
      at,
    );
  }

  recoverIncompleteSngEntries(at = this.clock()): number {
    return this.repository.recoverIncompleteSngEntries(at);
  }

  // --- wallet MTT (토너 단위 에스크로 — 키는 토너먼트 ID) ---

  reserveMttEntry(
    profileId: string,
    tournamentId: string,
    maxEntrants: number,
    buyIn: number = MTT_WALLET_BUY_IN,
    fee: number = MTT_WALLET_ENTRY_FEE,
    at = this.clock(),
  ): SngEntry {
    return this.repository.reserveMttEntry(
      profileId,
      tournamentId,
      buyIn,
      fee,
      maxEntrants,
      at,
    );
  }

  /** 등록 취소/노쇼 환불 — MTT 키(sng_entries.room_id=토너먼트 ID) 기준 reserved 환불 */
  cancelMttEntry(
    profileId: string,
    tournamentId: string,
    at = this.clock(),
  ): SngEntry | null {
    return this.repository.cancelSngEntry(profileId, tournamentId, at);
  }

  startMttTournament(
    tournamentId: string,
    profileIds: readonly string[],
    buyIn: number = MTT_WALLET_BUY_IN,
    fee: number = MTT_WALLET_ENTRY_FEE,
    at = this.clock(),
  ): string {
    return this.repository.startMttTournament(
      tournamentId,
      profileIds,
      buyIn,
      fee,
      at,
    );
  }

  settleMttTournament(
    tournamentId: string,
    results: readonly SngResult[],
    payoutPreset: PayoutPresetId = 'standard',
    buyIn: number = MTT_WALLET_BUY_IN,
    fee: number = MTT_WALLET_ENTRY_FEE,
    at = this.clock(),
  ): string {
    return this.repository.settleMttTournament(
      tournamentId,
      results,
      buyIn,
      fee,
      at,
      payoutPreset,
    );
  }

  voidMttTournament(tournamentId: string, at = this.clock()): number {
    return this.repository.voidMttTournament(tournamentId, at);
  }

  openCashEscrow(
    profileId: string,
    roomId: string,
    buyIn: number,
    at = this.clock(),
  ): CashEscrow {
    return this.repository.openCashEscrow(profileId, roomId, buyIn, at);
  }

  rebuyCashEscrow(
    profileId: string,
    roomId: string,
    buyIn: number,
    at = this.clock(),
  ): CashEscrow {
    return this.repository.rebuyCashEscrow(profileId, roomId, buyIn, at);
  }

  cancelCashEscrow(
    profileId: string,
    roomId: string,
    at = this.clock(),
  ): CashEscrow | null {
    return this.repository.closeCashEscrow(
      profileId,
      roomId,
      'CASH_JOIN_REFUND',
      at,
    );
  }

  settleCashExit(
    profileId: string,
    roomId: string,
    at = this.clock(),
  ): CashEscrow | null {
    return this.repository.closeCashEscrow(
      profileId,
      roomId,
      'CASH_CASHOUT',
      at,
    );
  }

  settleCashRoom(roomId: string, at = this.clock()): number {
    return this.repository.closeCashEscrowsByRoom(roomId, at);
  }

  hasActiveCashEscrows(roomId: string): boolean {
    return this.repository.hasActiveCashEscrows(roomId);
  }

  hasActiveCashEscrow(profileId: string, roomId: string): boolean {
    return this.repository.hasActiveCashEscrow(profileId, roomId);
  }

  checkpointCashHand(
    roomId: string,
    handNumber: number,
    stacks: readonly CashHandStack[],
    at = this.clock(),
  ): void {
    this.repository.checkpointCashHand(roomId, handNumber, stacks, at);
  }

  cancelPreparedCashHand(
    roomId: string,
    handNumber: number,
    at = this.clock(),
  ): boolean {
    return this.repository.cancelPreparedCashHand(roomId, handNumber, at);
  }

  settleCashHand(
    roomId: string,
    handNumber: number,
    humans: readonly CashHandDelta[],
    botDelta: number,
    rake: number,
    at = this.clock(),
  ): void {
    this.repository.settleCashHand(
      roomId,
      handNumber,
      humans,
      botDelta,
      rake,
      at,
    );
  }

  recoverActiveCashEscrows(at = this.clock()): number {
    return this.repository.recoverActiveCashEscrows(at);
  }
}
