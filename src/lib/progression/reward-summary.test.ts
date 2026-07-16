import { describe, expect, it } from 'vitest';
import { parseProgressionRewardSummary } from './reward-summary';

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
});
