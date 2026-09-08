import { getKstWeekKey } from '@/lib/progression/streak';

/**
 * 주간 도장 순수 규칙 — 주 경계·점수 환산·공동 순위.
 *
 * 점수는 정수 **milli-BB**(BB × 1000)로만 비교한다. 부동소수로 합산하면 "정확히 같은 점수"가
 * 표본에 따라 갈려 공동 순위 계약(기획: 먼저 시작한 사람이 이기지 않는다)이 깨진다.
 */

const KST_OFFSET_MS = 9 * 60 * 60 * 1_000;
const MAX_TIMESTAMP = 253_402_300_799_999;

function assertTime(at: number): void {
  if (!Number.isSafeInteger(at) || at < 0 || at > MAX_TIMESTAMP) {
    throw new Error('WEEKLY_DOJO_TIME_INVALID');
  }
}

/** ISO 주 키 (KST 기준) — 진행도 스트릭과 같은 함수를 쓴다 */
export function weeklyDojoWeekKey(at: number): string {
  assertTime(at);
  return getKstWeekKey(at);
}

/** 이번 주가 끝나는 시각 = 다음 KST 월요일 0시 (주 경계는 아레나 시즌과 같은 관행) */
export function weeklyDojoWeekEndsAt(at: number): number {
  assertTime(at);
  const shifted = new Date(at + KST_OFFSET_MS);
  const weekday = shifted.getUTCDay();
  const daysUntilMonday = (8 - weekday) % 7 || 7;
  return Date.UTC(
    shifted.getUTCFullYear(),
    shifted.getUTCMonth(),
    shifted.getUTCDate() + daysUntilMonday,
  ) - KST_OFFSET_MS;
}

/**
 * 확정 스택 → milli-BB 점수. `committedChips`는 **마지막으로 확정된 핸드 경계**의 스택이며,
 * 진행 중 핸드의 중간 칩이 아니다.
 */
export function netMilliBB(
  committedChips: number,
  startingChips: number,
  bigBlind: number,
): number {
  if (
    !Number.isSafeInteger(committedChips)
    || !Number.isSafeInteger(startingChips)
    || !Number.isSafeInteger(bigBlind)
    || committedChips < 0
    || startingChips <= 0
    || bigBlind <= 0
  ) {
    throw new Error('WEEKLY_DOJO_SCORE_INVALID');
  }
  return Math.round(((committedChips - startingChips) * 1_000) / bigBlind);
}

/** 표시용 BB (소수 1자리) — 순위 비교에는 절대 쓰지 않는다 */
export function milliBBToBB(milliBB: number): number {
  if (!Number.isFinite(milliBB)) throw new Error('WEEKLY_DOJO_SCORE_INVALID');
  return Math.round(milliBB / 100) / 10;
}

export interface RankableScore {
  readonly profileId: string;
  readonly scoreMilliBB: number;
}

export interface RankedScore<T extends RankableScore> {
  readonly rank: number;
  readonly entry: T;
}

/**
 * 표준 경쟁 순위(1, 2, 2, 4) — 동점은 공동 순위이고 다음 순위는 건너뛴다.
 * 같은 점수 안의 정렬은 profileId 사전순으로 고정한다(입력 순서·시작 시각에 의존하지 않게).
 */
export function rankScores<T extends RankableScore>(
  entries: readonly T[],
): RankedScore<T>[] {
  const sorted = [...entries].sort((left, right) => (
    right.scoreMilliBB - left.scoreMilliBB
    || (left.profileId < right.profileId ? -1 : left.profileId > right.profileId ? 1 : 0)
  ));
  const ranked: RankedScore<T>[] = [];
  let rank = 0;
  let previous: number | null = null;
  sorted.forEach((entry, index) => {
    if (previous === null || entry.scoreMilliBB !== previous) {
      rank = index + 1;
      previous = entry.scoreMilliBB;
    }
    ranked.push({ rank, entry });
  });
  return ranked;
}

/**
 * 내 주변 순위 구간 — 내가 순위표에 없으면 빈 배열.
 * `radius`만큼 위아래를 자르되 목록 끝에서는 반대쪽으로 밀어 항상 같은 개수를 보여준다.
 */
export function nearbySlice<T>(
  ranked: readonly T[],
  meIndex: number,
  radius: number,
): T[] {
  if (meIndex < 0 || meIndex >= ranked.length) return [];
  const span = radius * 2 + 1;
  if (ranked.length <= span) return [...ranked];
  let start = meIndex - radius;
  if (start < 0) start = 0;
  if (start + span > ranked.length) start = ranked.length - span;
  return ranked.slice(start, start + span);
}
