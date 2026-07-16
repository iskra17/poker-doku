import { describe, expect, it } from 'vitest';
import { PROGRESSION_BALANCE_V1 } from './balance';
import {
  advanceStreakDay,
  getKstWeekKey,
  reconcileWeeklyRestPass,
} from './streak';
import { STREAK_FRAGMENT_ITEM } from '@/lib/collection/catalog';

describe('streak progression', () => {
  it('changes the ISO week at KST Monday midnight without DST drift', () => {
    expect(getKstWeekKey(Date.parse('2026-07-19T23:59:59.999+09:00')))
      .toBe('2026-W29');
    expect(getKstWeekKey(Date.parse('2026-07-20T00:00:00.000+09:00')))
      .toBe('2026-W30');
    expect(getKstWeekKey(Date.parse('2027-01-01T12:00:00+09:00')))
      .toBe('2026-W53');
  });

  it('grants a weekly pass once and caps it at one', () => {
    const first = reconcileWeeklyRestPass({
      restPasses: 0,
      lastWeekKey: null,
    }, Date.parse('2026-07-13T00:00:00+09:00'), PROGRESSION_BALANCE_V1);
    expect(first).toEqual({ restPasses: 1, lastWeekKey: '2026-W29' });

    const sameWeek = reconcileWeeklyRestPass(
      first,
      Date.parse('2026-07-19T23:59:59+09:00'),
      PROGRESSION_BALANCE_V1,
    );
    expect(sameWeek).toEqual(first);

    const nextMonday = reconcileWeeklyRestPass(
      sameWeek,
      Date.parse('2026-07-20T00:00:00+09:00'),
      PROGRESSION_BALANCE_V1,
    );
    expect(nextMonday).toEqual({ restPasses: 1, lastWeekKey: '2026-W30' });

    const past = reconcileWeeklyRestPass(
      nextMonday,
      Date.parse('2026-07-06T00:00:00+09:00'),
      PROGRESSION_BALANCE_V1,
    );
    expect(past).toEqual(nextMonday);
  });

  it('advances consecutive days, consumes one pass for one missed day, and resets for two', () => {
    const first = advanceStreakDay({
      currentStreak: 0,
      restPasses: 1,
      lastQualifiedDate: null,
    }, '2026-07-14', PROGRESSION_BALANCE_V1);
    expect(first).toMatchObject({
      currentStreak: 1,
      restPasses: 1,
      lastQualifiedDate: '2026-07-14',
      restPassUsed: false,
      fragmentDue: false,
    });

    const consecutive = advanceStreakDay(first, '2026-07-15', PROGRESSION_BALANCE_V1);
    expect(consecutive).toMatchObject({ currentStreak: 2, restPasses: 1 });

    const oneMissed = advanceStreakDay(
      consecutive,
      '2026-07-17',
      PROGRESSION_BALANCE_V1,
    );
    expect(oneMissed).toMatchObject({
      currentStreak: 3,
      restPasses: 0,
      lastQualifiedDate: '2026-07-17',
      restPassUsed: true,
    });

    const twoMissed = advanceStreakDay(
      oneMissed,
      '2026-07-20',
      PROGRESSION_BALANCE_V1,
    );
    expect(twoMissed).toMatchObject({
      currentStreak: 1,
      restPasses: 0,
      lastQualifiedDate: '2026-07-20',
      restPassUsed: false,
    });
  });

  it('does not regress or duplicate a streak for old qualification dates', () => {
    const current = {
      currentStreak: 8,
      restPasses: 1,
      lastQualifiedDate: '2026-07-17',
    } as const;
    expect(advanceStreakDay(current, '2026-07-17', PROGRESSION_BALANCE_V1))
      .toMatchObject({ ...current, changed: false, fragmentDue: false });
    expect(advanceStreakDay(current, '2026-07-16', PROGRESSION_BALANCE_V1))
      .toMatchObject({ ...current, changed: false, fragmentDue: false });
  });

  it('marks every seventh qualified streak day for a stackable cosmetic fragment', () => {
    expect(advanceStreakDay({
      currentStreak: 6,
      restPasses: 0,
      lastQualifiedDate: '2026-07-16',
    }, '2026-07-17', PROGRESSION_BALANCE_V1).fragmentDue).toBe(true);
    expect(advanceStreakDay({
      currentStreak: 13,
      restPasses: 0,
      lastQualifiedDate: '2026-07-16',
    }, '2026-07-17', PROGRESSION_BALANCE_V1).fragmentDue).toBe(true);
    expect(STREAK_FRAGMENT_ITEM).toMatchObject({
      id: 'streak-fragment',
      stackable: true,
      gameplayModifiers: [],
    });
    expect(Object.isFrozen(STREAK_FRAGMENT_ITEM.gameplayModifiers)).toBe(true);
  });
});
