import {
  getCollectionItemDefinition,
  STREAK_FRAGMENT_ITEM,
} from '@/lib/collection/catalog';
import { getBalance } from './balance';
import { getMissionDefinition } from './missions';
import {
  PROGRESSION_CHARACTER_IDS,
  type MissionCompletion,
  type ProgressionRewardSummary,
} from './types';

const REQUIRED_SUMMARY_KEYS = [
  'eventId',
  'dojoXpMilli',
  'dojoLevelsGained',
  'characterId',
  'affinityMilli',
  'affinityLevelsGained',
  'missionCompletions',
  'grantedItemIds',
] as const;

export function parseProgressionRewardSummary(
  value: unknown,
  expectedEventId: string,
  balanceVersion: number,
): ProgressionRewardSummary | null {
  try {
    return parseProgressionRewardSummaryValue(
      value,
      expectedEventId,
      balanceVersion,
    );
  } catch {
    return null;
  }
}

function parseProgressionRewardSummaryValue(
  value: unknown,
  expectedEventId: string,
  balanceVersion: number,
): ProgressionRewardSummary | null {
  if (
    !hasExactSummaryKeys(value)
    || value.eventId !== expectedEventId
    || !isNonnegativeSafeInteger(value.dojoXpMilli)
    || !isConsecutiveLevelArray(value.dojoLevelsGained, 50)
    || typeof value.characterId !== 'string'
    || !(PROGRESSION_CHARACTER_IDS as readonly string[])
      .includes(value.characterId)
    || !isNonnegativeSafeInteger(value.affinityMilli)
    || !isConsecutiveLevelArray(value.affinityLevelsGained, 20)
    || !isMissionCompletionArray(value.missionCompletions, balanceVersion)
    || !isUniqueCatalogItemIdArray(value.grantedItemIds)
    || (hasOwn(value, 'streak') && !isStreakChange(value.streak))
  ) {
    return null;
  }
  const missionRewardTotal = sumMissionCompletionRewards(
    value.missionCompletions,
  );
  if (
    missionRewardTotal === null
    || value.dojoXpMilli < missionRewardTotal
  ) {
    return null;
  }
  return value as unknown as ProgressionRewardSummary;
}

export function isStreakFragmentSourceSummary(
  value: unknown,
  expectedEventId: string,
  balanceVersion: number,
): boolean {
  const summary = parseProgressionRewardSummary(
    value,
    expectedEventId,
    balanceVersion,
  );
  if (!summary?.streak) return false;
  let fragmentInterval: number;
  try {
    fragmentInterval = getBalance(balanceVersion).streakFragmentEveryDays;
  } catch {
    return false;
  }
  return summary.streak.currentStreak % fragmentInterval === 0
    && summary.grantedItemIds.length === 1
    && summary.grantedItemIds[0] === STREAK_FRAGMENT_ITEM.id;
}

function isNonnegativeSafeInteger(value: unknown): value is number {
  return typeof value === 'number'
    && Number.isSafeInteger(value)
    && value >= 0;
}

function isConsecutiveLevelArray(
  value: unknown,
  maxLevel: number,
): value is number[] {
  return Array.isArray(value) && value.every((level, index) => (
    Number.isSafeInteger(level)
    && level >= 2
    && level <= maxLevel
    && (index === 0 || level === value[index - 1] + 1)
  ));
}

function hasExactSummaryKeys(value: unknown): value is Record<string, unknown> {
  if (!isPlainObject(value)) return false;
  const keys = getOwnStringKeys(value);
  if (!keys) return false;
  const hasStreak = hasOwn(value, 'streak');
  if (keys.length !== REQUIRED_SUMMARY_KEYS.length + (hasStreak ? 1 : 0)) {
    return false;
  }
  return REQUIRED_SUMMARY_KEYS.every(key => hasOwn(value, key))
    && keys.every(key => (
      (REQUIRED_SUMMARY_KEYS as readonly string[]).includes(key)
      || key === 'streak'
    ));
}

function isMissionCompletionArray(
  value: unknown,
  balanceVersion: number,
): value is MissionCompletion[] {
  if (!Array.isArray(value)) return false;
  let expectedReward: number;
  try {
    expectedReward = getBalance(balanceVersion).dojoXpPerMission;
  } catch {
    return false;
  }
  const missionIds = new Set<string>();
  const slots = new Set<number>();
  return value.every(item => {
    if (!hasExactKeys(item, ['missionId', 'slot', 'dojoXpMilli'])) {
      return false;
    }
    const { missionId, slot, dojoXpMilli } = item;
    const definition = typeof missionId === 'string'
      ? getMissionDefinition(missionId)
      : null;
    if (
      !definition
      || missionIds.has(definition.id)
      || typeof slot !== 'number'
      || !Number.isSafeInteger(slot)
      || slot < 0
      || slot > 2
      || slots.has(slot)
      || dojoXpMilli !== expectedReward
    ) {
      return false;
    }
    missionIds.add(definition.id);
    slots.add(slot);
    return true;
  });
}

function sumMissionCompletionRewards(
  completions: readonly MissionCompletion[],
): number | null {
  let total = BigInt(0);
  for (const completion of completions) {
    total += BigInt(completion.dojoXpMilli);
  }
  if (total > BigInt(Number.MAX_SAFE_INTEGER)) return null;
  return Number(total);
}

function isStreakChange(value: unknown): boolean {
  if (!hasExactKeys(value, [
    'previousStreak',
    'currentStreak',
    'restPassUsed',
  ])) {
    return false;
  }
  return isNonnegativeSafeInteger(value.previousStreak)
    && isNonnegativeSafeInteger(value.currentStreak)
    && value.currentStreak >= 1
    && typeof value.restPassUsed === 'boolean'
    && (
      value.currentStreak === 1
      || value.currentStreak === value.previousStreak + 1
    )
    && (
      !value.restPassUsed
      || (
        value.previousStreak > 0
        && value.currentStreak === value.previousStreak + 1
      )
    );
}

function isUniqueCatalogItemIdArray(value: unknown): value is string[] {
  if (!Array.isArray(value)) return false;
  const seen = new Set<string>();
  return value.every(item => {
    if (
      typeof item !== 'string'
      || getCollectionItemDefinition(item) === null
      || seen.has(item)
    ) {
      return false;
    }
    seen.add(item);
    return true;
  });
}

function hasExactKeys(
  value: unknown,
  expected: readonly string[],
): value is Record<string, unknown> {
  if (!isPlainObject(value)) return false;
  const keys = getOwnStringKeys(value);
  return keys !== null
    && keys.length === expected.length
    && expected.every(key => hasOwn(value, key));
}

function getOwnStringKeys(value: object): string[] | null {
  try {
    const keys = Reflect.ownKeys(value);
    return keys.every((key): key is string => typeof key === 'string')
      ? keys
      : null;
  } catch {
    return null;
  }
}

function hasOwn(value: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  try {
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
  } catch {
    return false;
  }
}
