import { describe, expect, it } from 'vitest';
import {
  milliBBToBB,
  nearbySlice,
  netMilliBB,
  rankScores,
  weeklyDojoWeekEndsAt,
  weeklyDojoWeekKey,
} from './rules';

/**
 * 주간 도장 순수 규칙 회귀 — 주 경계 · 정수 점수 환산 · 공동 순위(먼저 시작한 사람이 이기지
 * 않는다) · 내 주변 구간.
 */

const KST = (iso: string): number => Date.parse(iso);

describe('weekly dojo rules', () => {
  it('groups a KST week Monday..Sunday and ends at the next KST Monday', () => {
    const monday = KST('2026-09-07T00:00:00+09:00');
    const sunday = KST('2026-09-13T23:59:59+09:00');
    const nextMonday = KST('2026-09-14T00:00:00+09:00');

    expect(weeklyDojoWeekKey(monday)).toBe(weeklyDojoWeekKey(sunday));
    expect(weeklyDojoWeekKey(nextMonday)).not.toBe(weeklyDojoWeekKey(monday));
    expect(weeklyDojoWeekEndsAt(monday)).toBe(nextMonday);
    expect(weeklyDojoWeekEndsAt(sunday)).toBe(nextMonday);
    // 월요일 0시 정각은 새 주의 시작이므로 그 주의 끝은 일주일 뒤다
    expect(weeklyDojoWeekEndsAt(nextMonday)).toBe(KST('2026-09-21T00:00:00+09:00'));
  });

  it('converts committed stacks to exact integer milli-BB in both directions', () => {
    // 2,000칩 시작 · BB 20 → 1칩 = 0.05BB = 50 milli-BB
    expect(netMilliBB(2_000, 2_000, 20)).toBe(0);
    expect(netMilliBB(2_037, 2_000, 20)).toBe(1_850);
    expect(netMilliBB(0, 2_000, 20)).toBe(-100_000);
    expect(milliBBToBB(1_850)).toBe(1.9);
    expect(milliBBToBB(-100_000)).toBe(-100);
    expect(() => netMilliBB(-1, 2_000, 20)).toThrow('WEEKLY_DOJO_SCORE_INVALID');
    expect(() => netMilliBB(2_000, 2_000, 0)).toThrow('WEEKLY_DOJO_SCORE_INVALID');
  });

  it('gives equal sums a shared rank and skips the next place', () => {
    const ranked = rankScores([
      { profileId: 'later', scoreMilliBB: 5_000 },
      { profileId: 'best', scoreMilliBB: 12_000 },
      { profileId: 'earlier', scoreMilliBB: 5_000 },
      { profileId: 'last', scoreMilliBB: -3_000 },
    ]);

    expect(ranked.map(item => [item.entry.profileId, item.rank])).toEqual([
      ['best', 1],
      ['earlier', 2],
      ['later', 2],
      ['last', 4],
    ]);
  });

  it('keeps the tie order independent of input order', () => {
    const forward = rankScores([
      { profileId: 'a', scoreMilliBB: 100 },
      { profileId: 'b', scoreMilliBB: 100 },
    ]);
    const reversed = rankScores([
      { profileId: 'b', scoreMilliBB: 100 },
      { profileId: 'a', scoreMilliBB: 100 },
    ]);

    expect(forward).toEqual(reversed);
    expect(forward.every(item => item.rank === 1)).toBe(true);
  });

  it('slices a fixed-size neighbourhood and clamps at both ends', () => {
    const rows = [1, 2, 3, 4, 5, 6, 7];

    expect(nearbySlice(rows, 3, 2)).toEqual([2, 3, 4, 5, 6]);
    expect(nearbySlice(rows, 0, 2)).toEqual([1, 2, 3, 4, 5]);
    expect(nearbySlice(rows, 6, 2)).toEqual([3, 4, 5, 6, 7]);
    expect(nearbySlice([1, 2], 0, 2)).toEqual([1, 2]);
    // 순위표에 없는 사람은 주변 구간도 없다 (미완주는 공식 순위가 아니다)
    expect(nearbySlice(rows, -1, 2)).toEqual([]);
  });
});
