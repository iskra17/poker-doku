import { ARENA_CONFIG_V1, ARENA_TIERS } from './config';
import type { ArenaTier, WeeklyMoves, WeeklyStanding } from './types';

export function pointsForPlace(place: number): number {
  if (!Number.isInteger(place) || place < 1 || place > ARENA_CONFIG_V1.seats) {
    throw new Error('ARENA_PLACE_INVALID');
  }
  return ARENA_CONFIG_V1.pointsByPlace[place - 1];
}

export function tierForPlacementTotal(total: number): ArenaTier {
  const maximum = ARENA_CONFIG_V1.pointsByPlace[0]
    * ARENA_CONFIG_V1.placementMatches;
  if (!Number.isSafeInteger(total) || total < 0 || total > maximum) {
    throw new Error('ARENA_PLACEMENT_TOTAL_INVALID');
  }
  if (total < 175) return 'bronze';
  if (total < 325) return 'silver';
  return 'gold';
}

export function compareWeeklyStandings(
  left: WeeklyStanding,
  right: WeeklyStanding,
): number {
  assertStanding(left);
  assertStanding(right);

  if (left.points !== right.points) return right.points - left.points;

  if (left.scoreReachedAt !== right.scoreReachedAt) {
    return left.scoreReachedAt - right.scoreReachedAt;
  }

  const secondaryDescending: Array<[number, number]> = [
    [left.wins, right.wins],
    [left.top3, right.top3],
  ];
  for (const [leftValue, rightValue] of secondaryDescending) {
    if (leftValue !== rightValue) return rightValue - leftValue;
  }

  const averageOrder = compareAveragePlace(left, right);
  if (averageOrder !== 0) return averageOrder;

  return compareCodeUnits(left.profileId, right.profileId);
}

export function rankWeeklyStandings(
  standings: readonly WeeklyStanding[],
): WeeklyStanding[] {
  const profileIds = new Set<string>();
  for (const row of standings) {
    assertStanding(row);
    if (profileIds.has(row.profileId)) {
      throw new Error('ARENA_STANDING_PROFILE_DUPLICATE');
    }
    profileIds.add(row.profileId);
  }
  return [...standings].sort(compareWeeklyStandings);
}

export function selectWeeklyMoves(
  tier: ArenaTier,
  standings: readonly WeeklyStanding[],
): WeeklyMoves {
  assertTier(tier);
  const ranked = rankWeeklyStandings(standings);
  if (ranked.length === 0) return freezeMoves([], []);

  const eligibleForPromotion = tier === 'master'
    ? []
    : ranked.filter(row =>
      row.matches >= ARENA_CONFIG_V1.promotionGamesRequired,
    );
  const promotionCount = ranked.length < 5
    ? Math.min(1, eligibleForPromotion.length)
    : Math.min(moveCount(ranked.length), eligibleForPromotion.length);
  const promoted = eligibleForPromotion
    .slice(0, promotionCount)
    .map(row => row.profileId);

  if (tier === 'bronze' || ranked.length < 5) {
    return freezeMoves(promoted, []);
  }

  const promotedSet = new Set(promoted);
  const demoted = [...ranked]
    .reverse()
    .filter(row => !promotedSet.has(row.profileId))
    .slice(0, moveCount(ranked.length))
    .map(row => row.profileId);
  return freezeMoves(promoted, demoted);
}

export function softResetTier(tier: ArenaTier): ArenaTier {
  assertTier(tier);
  const index = ARENA_TIERS.indexOf(tier);
  return ARENA_TIERS[Math.max(0, index - 1)];
}

export function softResetMmr(oldMmr: number): number {
  if (!Number.isSafeInteger(oldMmr)) throw new Error('ARENA_MMR_INVALID');
  const numerator = BigInt(oldMmr) + BigInt(ARENA_CONFIG_V1.initialMmr);
  const rounded = numerator >= 0
    ? (numerator + BigInt(1)) / BigInt(2)
    : numerator / BigInt(2);
  const result = Number(rounded);
  if (!Number.isSafeInteger(result)) throw new Error('ARENA_MMR_INVALID');
  return result;
}

function moveCount(groupSize: number): number {
  return Math.max(1, Math.floor(groupSize * ARENA_CONFIG_V1.weeklyMoveRate));
}

function freezeMoves(
  promotedProfileIds: string[],
  demotedProfileIds: string[],
): WeeklyMoves {
  return Object.freeze({
    promotedProfileIds: Object.freeze(promotedProfileIds),
    demotedProfileIds: Object.freeze(demotedProfileIds),
  });
}

function assertStanding(row: WeeklyStanding): void {
  if (
    !row
    || typeof row.profileId !== 'string'
    || row.profileId.length === 0
    || !isNonnegativeSafeInteger(row.points)
    || !isNonnegativeSafeInteger(row.wins)
    || !isNonnegativeSafeInteger(row.top3)
    || !isNonnegativeSafeInteger(row.placeSum)
    || !isNonnegativeSafeInteger(row.matches)
    || !isNonnegativeSafeInteger(row.scoreReachedAt)
    || row.wins > row.top3
    || row.top3 > row.matches
    || (row.matches === 0 && row.placeSum !== 0)
    || (row.matches > 0 && (
      row.placeSum < row.matches
      || row.placeSum > ARENA_CONFIG_V1.seats * row.matches
    ))
  ) {
    throw new Error('ARENA_STANDING_INVALID');
  }
}

function assertTier(tier: ArenaTier): void {
  if (!ARENA_TIERS.includes(tier)) throw new Error('ARENA_TIER_INVALID');
}

function isNonnegativeSafeInteger(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0;
}

function compareCodeUnits(left: string, right: string): number {
  if (left === right) return 0;
  return left < right ? -1 : 1;
}

function compareAveragePlace(
  left: WeeklyStanding,
  right: WeeklyStanding,
): number {
  if (left.matches === 0 || right.matches === 0) {
    if (left.matches === right.matches) return 0;
    return left.matches === 0 ? 1 : -1;
  }
  const leftProduct = BigInt(left.placeSum) * BigInt(right.matches);
  const rightProduct = BigInt(right.placeSum) * BigInt(left.matches);
  if (leftProduct === rightProduct) return 0;
  return leftProduct < rightProduct ? -1 : 1;
}
