import { describe, expect, it } from 'vitest';
import {
  isStreakFragmentSourceSummary,
  parseProgressionRewardSummary,
} from './reward-summary';

describe('progression reward summary validation', () => {
  it('fails closed when a summary property accessor throws', () => {
    const summary = {
      eventId: 'event-a',
      dojoXpMilli: 0,
      dojoLevelsGained: [],
      characterId: 'sakura',
      affinityMilli: 0,
      affinityLevelsGained: [],
      missionCompletions: [],
      grantedItemIds: [],
    };
    Object.defineProperty(summary, 'eventId', {
      enumerable: true,
      get: () => {
        throw new Error('hostile accessor');
      },
    });

    expect(parseProgressionRewardSummary(summary, 'event-a', 1)).toBeNull();
  });

  it.each([
    ['dojo XP', { dojoXpMilli: Number.MAX_SAFE_INTEGER + 1 }],
    ['affinity XP', { affinityMilli: Number.MAX_SAFE_INTEGER + 1 }],
    ['streak counters', {
      streak: {
        previousStreak: 9_007_199_254_740_994,
        currentStreak: 9_007_199_254_740_995,
        restPassUsed: false,
      },
    }],
  ])('rejects an unsafe %s integer claim', (_label, override) => {
    const summary = { ...fragmentSourceSummary(), ...override };

    expect(parseProgressionRewardSummary(summary, 'event-a', 1)).toBeNull();
    expect(isStreakFragmentSourceSummary(summary, 'event-a', 1)).toBe(false);
  });

  it('accepts inclusive max-safe reward and streak integers', () => {
    const summary = {
      ...fragmentSourceSummary(),
      dojoXpMilli: Number.MAX_SAFE_INTEGER,
      affinityMilli: Number.MAX_SAFE_INTEGER,
      streak: {
        previousStreak: 9_007_199_254_740_987,
        currentStreak: 9_007_199_254_740_988,
        restPassUsed: false,
      },
    };

    expect(parseProgressionRewardSummary(summary, 'event-a', 1)).toEqual(summary);
    expect(isStreakFragmentSourceSummary(summary, 'event-a', 1)).toBe(true);
  });

  it('rejects a mission missing its reward after duplicate keys are parsed', () => {
    const raw = JSON.stringify(fragmentSourceSummary()).replace(
      '"missionCompletions":[]',
      '"missionCompletions":[{' +
        '"missionId":"COMPLETE_ONE_SNG","slot":0,"slot":0}]',
    );
    const summary = JSON.parse(raw) as unknown;

    expect(parseProgressionRewardSummary(summary, 'event-a', 1)).toBeNull();
    expect(isStreakFragmentSourceSummary(summary, 'event-a', 1)).toBe(false);
  });
});

function fragmentSourceSummary() {
  return {
    eventId: 'event-a',
    dojoXpMilli: 30_000,
    dojoLevelsGained: [],
    characterId: 'sakura',
    affinityMilli: 8_000,
    affinityLevelsGained: [],
    missionCompletions: [],
    streak: {
      previousStreak: 6,
      currentStreak: 7,
      restPassUsed: false,
    },
    grantedItemIds: ['streak-fragment'],
  };
}
