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

const KST_OFFSET_MS = 9 * 60 * 60 * 1_000;

const KST_DATE_FORMATTER = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Seoul',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

export const ECONOMY_RULES = {
  startingChips: 10_000,
  dailyGrant: 1_000,
  rescueThreshold: 800,
  rescueTarget: 2_000,
  rescueDailyLimit: 3,
  rescueCooldownMs: 4 * 60 * 60 * 1_000,
  casualSngBuyIn: CASUAL_SNG_BUY_IN,
  casualSngFee: CASUAL_SNG_ENTRY_FEE,
} as const;

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
    if (snapshot.rescueClaimsToday > ECONOMY_RULES.rescueDailyLimit) {
      throw new EconomyDomainError('ECONOMY_PERSISTENCE_INVALID');
    }
    const remainingToday = ECONOMY_RULES.rescueDailyLimit
      - snapshot.rescueClaimsToday;
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
