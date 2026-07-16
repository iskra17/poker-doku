import { describe, expect, it } from 'vitest';
import {
  AFFINITY_REWARD_LEVELS,
  COLLECTION_CATALOG,
  DOJO_REWARD_LEVELS,
  getAffinityRewardItems,
  getCollectionItemDefinition,
  getDojoRewardItems,
} from './catalog';

const CHARACTERS = ['sakura', 'ara', 'hana', 'chloe', 'vivian', 'elena'] as const;

describe('collection catalog', () => {
  it('contains every approved dojo reward with exact Korean names', () => {
    expect(DOJO_REWARD_LEVELS).toEqual([2, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50]);
    expect(getDojoRewardItems(1, 50).map(item => [item.source.level, item.name]))
      .toEqual([
        [2, '새싹 도전자'],
        [5, '벚꽃'],
        [10, '미야코 응원'],
        [15, '꾸준한 수련생'],
        [20, '청명'],
        [25, '집중선'],
        [30, '도장 상급생'],
        [35, '금빛'],
        [40, '승부의 순간'],
        [45, '백전연마'],
        [50, '도장 사범'],
      ]);
  });

  it.each(CHARACTERS)('contains all four affinity rewards for %s', characterId => {
    const rewards = getAffinityRewardItems(characterId, 1, 20);
    expect(AFFINITY_REWARD_LEVELS).toEqual([5, 10, 15, 20]);
    expect(rewards.map(item => [item.source.level, item.kind, item.equipSlot]))
      .toEqual([
        [5, 'dialogue-pack', null],
        [10, 'aura', null],
        [15, 'cutin', 'cutin'],
        [20, 'skin', 'skin'],
      ]);
    expect(rewards[3]).toMatchObject({
      name: expect.stringMatching(/ 인연 스킨$/),
      renderer: {
        artSource: 'existing-character-art',
        gradientToken: expect.any(String),
        overlay: expect.stringMatching(/^(cherry-blossom|starlight)$/),
      },
    });
  });

  it('uses unique stable ids and no gameplay modifiers', () => {
    expect(COLLECTION_CATALOG).toHaveLength(36);
    expect(new Set(COLLECTION_CATALOG.map(item => item.id)).size)
      .toBe(COLLECTION_CATALOG.length);
    for (const item of COLLECTION_CATALOG) {
      expect(item.gameplayModifiers).toEqual([]);
      expect(Object.isFrozen(item.gameplayModifiers)).toBe(true);
      expect(getCollectionItemDefinition(item.id)).toBe(item);
    }
  });

  it('returns every crossed reward level in ascending order', () => {
    expect(getDojoRewardItems(1, 20).map(item => item.source.level))
      .toEqual([2, 5, 10, 15, 20]);
    expect(getAffinityRewardItems('sakura', 4, 20).map(item => item.source.level))
      .toEqual([5, 10, 15, 20]);
    expect(getAffinityRewardItems('sakura', 20, 20)).toEqual([]);
  });
});
