import type {
  EconomyRepository,
  EconomyResult,
} from './economy-repository';

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
} as const;

interface KstDateParts {
  year: number;
  month: number;
  day: number;
}

function getKstDateParts(at: number): KstDateParts {
  const values: Partial<Record<'year' | 'month' | 'day', number>> = {};
  for (const part of KST_DATE_FORMATTER.formatToParts(new Date(at))) {
    if (part.type === 'year' || part.type === 'month' || part.type === 'day') {
      values[part.type] = Number(part.value);
    }
  }
  const { year, month, day } = values;
  if (year === undefined || month === undefined || day === undefined) {
    throw new Error('KST_DATE_FORMAT_FAILED');
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
  return Date.UTC(year, month - 1, day + 1) - KST_OFFSET_MS;
}

export { EconomyDomainError } from './economy-repository';

export class EconomyService {
  constructor(
    private readonly repository: EconomyRepository,
    private readonly clock: () => number = Date.now,
  ) {}

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
}
