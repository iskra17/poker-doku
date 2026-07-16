import { describe, expect, it } from 'vitest';
import {
  BALANCE_BY_VERSION,
  PROGRESSION_BALANCE_V1,
  applyAffinityXp,
  applyDojoXp,
  getBalance,
  milliToUiUnits,
  scaleReward,
} from './balance';

describe('progression balance version 1', () => {
  it('keeps the approved versioned constants together', () => {
    expect(PROGRESSION_BALANCE_V1).toMatchObject({
      version: 1,
      dojoMaxLevel: 50,
      dojoXpPerCompletedHand: 10_000,
      dojoXpPerMission: 100_000,
      affinityMaxLevel: 20,
      affinityPerCompletedHand: 2_000,
      practiceFullRewardHandsPerKstDay: 30,
      practiceReducedRatePermille: 250,
      dailyMissionCount: 3,
      dailyFreeRerolls: 1,
      streakHandsRequired: 10,
      streakSngRequired: 1,
      weeklyRestPassGrant: 1,
      restPassCap: 1,
      streakFragmentEveryDays: 7,
    });
    expect(PROGRESSION_BALANCE_V1.dojoXpPerSngPlace)
      .toEqual([160_000, 100_000, 70_000, 50_000, 40_000, 30_000]);
    expect(PROGRESSION_BALANCE_V1.affinityPerSngPlace)
      .toEqual([30_000, 20_000, 15_000, 12_000, 10_000, 8_000]);
    for (let level = 1; level < 50; level += 1) {
      expect(PROGRESSION_BALANCE_V1.dojoXpForNextLevel(level))
        .toBe((100 + 25 * (level - 1)) * 1_000);
    }
    for (let level = 1; level < 20; level += 1) {
      expect(PROGRESSION_BALANCE_V1.affinityForNextLevel(level))
        .toBe((40 + 15 * (level - 1)) * 1_000);
    }
    expect(BALANCE_BY_VERSION.get(1)).toBe(PROGRESSION_BALANCE_V1);
    expect((BALANCE_BY_VERSION as Map<number, unknown>).set).toBeUndefined();
    expect(Object.isFrozen(BALANCE_BY_VERSION)).toBe(true);
    expect(getBalance(1)).toBe(PROGRESSION_BALANCE_V1);
    expect(() => getBalance(2)).toThrowError(
      'UNKNOWN_PROGRESSION_BALANCE:2',
    );
  });

  it('crosses every dojo threshold and discards overflow at level 50', () => {
    let state = { level: 1, xpMilli: 0 };
    for (let level = 1; level < 50; level += 1) {
      const threshold = PROGRESSION_BALANCE_V1.dojoXpForNextLevel(level);
      state = { level, xpMilli: threshold - 1 };
      expect(applyDojoXp(state, 1)).toEqual({
        level: level + 1,
        xpMilli: 0,
      });
    }

    expect(applyDojoXp({ level: 1, xpMilli: 99_000 }, 1_000))
      .toEqual({ level: 2, xpMilli: 0 });
    expect(applyDojoXp({ level: 49, xpMilli: 1_299_000 }, 10_000))
      .toEqual({ level: 50, xpMilli: 0 });
    expect(applyDojoXp({ level: 50, xpMilli: 0 }, Number.MAX_SAFE_INTEGER))
      .toEqual({ level: 50, xpMilli: 0 });
  });

  it('crosses every affinity threshold and discards overflow at level 20', () => {
    for (let level = 1; level < 20; level += 1) {
      const threshold = PROGRESSION_BALANCE_V1.affinityForNextLevel(level);
      expect(applyAffinityXp({ level, xpMilli: threshold - 1 }, 1))
        .toEqual({ level: level + 1, xpMilli: 0 });
    }

    expect(applyAffinityXp({ level: 20, xpMilli: 0 }, 1_000_000))
      .toEqual({ level: 20, xpMilli: 0 });
  });

  it('supports deterministic multi-level gains', () => {
    expect(applyDojoXp({ level: 1, xpMilli: 0 }, 225_000))
      .toEqual({ level: 3, xpMilli: 0 });
    expect(applyAffinityXp({ level: 1, xpMilli: 0 }, 95_000))
      .toEqual({ level: 3, xpMilli: 0 });
  });

  it('rejects invalid states, rewards, and unsafe accumulation', () => {
    for (const state of [
      { level: 0, xpMilli: 0 },
      { level: 51, xpMilli: 0 },
      { level: 1.5, xpMilli: 0 },
      { level: 1, xpMilli: -1 },
      { level: 1, xpMilli: 100_000 },
      { level: 50, xpMilli: 1 },
    ]) {
      expect(() => applyDojoXp(state, 0)).toThrowError(
        'PROGRESSION_XP_STATE_INVALID',
      );
    }
    for (const reward of [-1, 0.5, Number.NaN, Number.MAX_SAFE_INTEGER + 1]) {
      expect(() => applyDojoXp({ level: 1, xpMilli: 0 }, reward))
        .toThrowError('PROGRESSION_REWARD_INVALID');
    }
    expect(applyDojoXp(
      { level: 49, xpMilli: 1_299_999 },
      Number.MAX_SAFE_INTEGER,
    )).toEqual({ level: 50, xpMilli: 0 });
    expect(applyAffinityXp(
      { level: 19, xpMilli: 309_999 },
      Number.MAX_SAFE_INTEGER,
    )).toEqual({ level: 20, xpMilli: 0 });
    expect(() => applyAffinityXp({ level: 1, xpMilli: 40_000 }, 0))
      .toThrowError('PROGRESSION_XP_STATE_INVALID');
  });

  it('scales exact milli rewards and floors UI-only display units', () => {
    expect(scaleReward(10_000, 250)).toBe(2_500);
    expect(scaleReward(2_000, 250)).toBe(500);
    expect(scaleReward(10_000, 0)).toBe(0);
    expect(scaleReward(10_000, 1_000)).toBe(10_000);
    expect(milliToUiUnits(2_999)).toBe(2);
  });

  it('rejects fractional, negative, out-of-range, and unsafe scaling', () => {
    for (const [reward, rate] of [
      [-1, 250],
      [1.5, 250],
      [10_000, -1],
      [10_000, 1_001],
      [10_000, 1.5],
      [Number.MAX_SAFE_INTEGER + 1, 250],
    ]) {
      expect(() => scaleReward(reward, rate)).toThrow();
    }
    expect(() => scaleReward(1, 250)).toThrowError(
      'PROGRESSION_REWARD_NOT_EXACT',
    );
    expect(() => milliToUiUnits(-1)).toThrowError(
      'PROGRESSION_REWARD_INVALID',
    );
  });
});
