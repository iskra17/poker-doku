import { createHash } from 'node:crypto';

export type MissionMetric =
  | 'handsAny'
  | 'handsCash'
  | 'handsPractice'
  | 'sngCompleted'
  | 'modesCompleted';

export type ProgressionMode = 'cash' | 'practice' | 'sng';

export interface MissionDefinition {
  readonly id: MissionId;
  readonly metric: MissionMetric;
  readonly target: number;
  readonly label: string;
  readonly description: string;
}

export type MissionId =
  | 'COMPLETE_HANDS_ANY_10'
  | 'COMPLETE_HANDS_CASH_10'
  | 'COMPLETE_HANDS_PRACTICE_10'
  | 'COMPLETE_HANDS_ANY_20'
  | 'COMPLETE_ONE_SNG'
  | 'COMPLETE_TWO_MODES';

/** Immutable daily mission state suitable for a future public snapshot. */
export interface DailyMission {
  readonly profileId: string;
  readonly missionDate: string;
  readonly slot: number;
  readonly missionId: MissionId;
  readonly target: number;
  readonly progress: number;
  readonly balanceVersion: number;
  readonly rerollCount: number;
  readonly assignedAt: number;
  readonly completedAt: number | null;
  readonly rewardedAt: number | null;
}

/** A complete three-slot day plus its distinct completed-mode set. */
export interface DailyMissionDaySnapshot {
  readonly profileId: string;
  readonly missionDate: string;
  readonly balanceVersion: number;
  readonly missions: readonly DailyMission[];
  readonly modes: readonly ProgressionMode[];
}

function mission(
  id: MissionId,
  metric: MissionMetric,
  target: number,
  label: string,
  description: string,
): MissionDefinition {
  return Object.freeze({ id, metric, target, label, description });
}

export const MISSION_CATALOG: readonly MissionDefinition[] = Object.freeze([
  mission(
    'COMPLETE_HANDS_ANY_10',
    'handsAny',
    10,
    '어떤 게임이든 10핸드',
    '포커 게임을 10핸드 끝까지 플레이하세요.',
  ),
  mission(
    'COMPLETE_HANDS_CASH_10',
    'handsCash',
    10,
    '캐시 게임 10핸드',
    '캐시 게임을 10핸드 끝까지 플레이하세요.',
  ),
  mission(
    'COMPLETE_HANDS_PRACTICE_10',
    'handsPractice',
    10,
    '연습 게임 10핸드',
    '연습 게임을 10핸드 끝까지 플레이하세요.',
  ),
  mission(
    'COMPLETE_HANDS_ANY_20',
    'handsAny',
    20,
    '어떤 게임이든 20핸드',
    '포커 게임을 20핸드 끝까지 플레이하세요.',
  ),
  mission(
    'COMPLETE_ONE_SNG',
    'sngCompleted',
    1,
    'Sit & Go 완주',
    'Sit & Go 한 게임을 끝까지 플레이하세요.',
  ),
  mission(
    'COMPLETE_TWO_MODES',
    'modesCompleted',
    2,
    '두 가지 모드 플레이',
    '서로 다른 게임 모드 두 가지를 완료하세요.',
  ),
]);

const CATALOG_BY_ID = new Map(
  MISSION_CATALOG.map(definition => [definition.id, definition]),
);
const PROFILE_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;
const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

export function getMissionDefinition(id: string): MissionDefinition | null {
  return CATALOG_BY_ID.get(id as MissionId) ?? null;
}

export function assignDailyMissions(
  profileId: string,
  kstDate: string,
  balanceVersion: number,
): readonly MissionDefinition[] {
  const seed = assignmentSeed(profileId, kstDate, balanceVersion);
  return Object.freeze(rankCatalog(seed).slice(0, 3));
}

export function selectRerollMission(
  profileId: string,
  kstDate: string,
  balanceVersion: number,
  currentMissionIds: readonly string[],
  discardedMissionId: string,
): MissionDefinition {
  const seed = assignmentSeed(profileId, kstDate, balanceVersion);
  if (
    !Array.isArray(currentMissionIds)
    || currentMissionIds.length !== 3
    || new Set(currentMissionIds).size !== currentMissionIds.length
    || currentMissionIds.some(id => !CATALOG_BY_ID.has(id as MissionId))
    || !CATALOG_BY_ID.has(discardedMissionId as MissionId)
    || !currentMissionIds.includes(discardedMissionId)
  ) {
    throw new Error('MISSION_INPUT_INVALID');
  }
  const excluded = new Set([...currentMissionIds, discardedMissionId]);
  const replacement = rankCatalog(`${seed}:reroll:1`)
    .find(definition => !excluded.has(definition.id));
  if (!replacement) throw new Error('MISSION_REPLACEMENT_UNAVAILABLE');
  return replacement;
}

function assignmentSeed(
  profileId: string,
  kstDate: string,
  balanceVersion: number,
): string {
  if (
    typeof profileId !== 'string'
    || !PROFILE_ID_PATTERN.test(profileId)
    || !isCanonicalDate(kstDate)
    || !Number.isSafeInteger(balanceVersion)
    || balanceVersion <= 0
  ) {
    throw new Error('MISSION_INPUT_INVALID');
  }
  return sha256(`${profileId}:${kstDate}:${balanceVersion}`);
}

function rankCatalog(seed: string): MissionDefinition[] {
  return [...MISSION_CATALOG].sort((left, right) => {
    const leftRank = sha256(`${seed}:${left.id}`);
    const rightRank = sha256(`${seed}:${right.id}`);
    if (leftRank !== rightRank) return leftRank < rightRank ? -1 : 1;
    return left.id < right.id ? -1 : left.id === right.id ? 0 : 1;
  });
}

function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function isCanonicalDate(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const match = DATE_PATTERN.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (year < 1 || year > 9_999 || month < 1 || month > 12) return false;
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return day >= 1 && day <= daysInMonth;
}
