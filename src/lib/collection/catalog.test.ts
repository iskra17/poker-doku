import { describe, expect, it } from 'vitest';
import {
  AFFINITY_REWARD_LEVELS,
  COLLECTION_CATALOG,
  DOJO_REWARD_LEVELS,
  getArenaSeasonRewardItems,
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

  it('uses the exact approved affinity dialogue-pack names', () => {
    expect(CHARACTERS.map(characterId => (
      getAffinityRewardItems(characterId, 1, 5)[0]?.name
    ))).toEqual([
      '사쿠라 대사 꾸러미',
      '아라 대사 꾸러미',
      '하나 대사 꾸러미',
      '클로이 대사 꾸러미',
      '비비안 대사 꾸러미',
      '엘레나 대사 꾸러미',
    ]);
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

  it('builds every immutable season-scoped Arena cosmetic with stable ids', () => {
    const seasonId = 'arena-v1-12';
    const rewards = getArenaSeasonRewardItems(seasonId);

    expect(rewards.map(reward => [
      reward.source.rewardKey,
      reward.kind,
      reward.equipSlot,
    ])).toEqual([
      ['participation-emblem', 'emblem', null],
      ['gold-frame', 'frame', 'frame'],
      ['diamond-featured-skin', 'skin', 'skin'],
      ['master-cutin', 'cutin', 'cutin'],
      ['top100-chroma', 'skin', 'skin'],
      ['top100-title', 'title', 'title'],
      ...Array.from({ length: 10 }, (_, index) => [
        `rank-${index + 1}-title`,
        'title',
        'title',
      ]),
      ['champion-trophy', 'trophy', null],
      ['champion-aura', 'aura', null],
    ]);
    expect(rewards).toHaveLength(18);
    expect(new Set(rewards.map(reward => reward.id)).size).toBe(18);
    expect(rewards.every(reward =>
      reward.id.startsWith(`${seasonId}-`)
      && reward.source.kind === 'arena-season'
      && reward.source.seasonId === seasonId
      && reward.stackable === false
      && reward.gameplayModifiers.length === 0
      && Object.isFrozen(reward)
      && Object.isFrozen(reward.source)
      && Object.isFrozen(reward.gameplayModifiers)
      && getCollectionItemDefinition(reward.id) === reward,
    )).toBe(true);
    expect(rewards.find(reward =>
      reward.source.rewardKey === 'top100-title',
    )?.name).toContain('TOP 100');
    expect(rewards.filter(reward =>
      reward.source.rewardKey.startsWith('rank-'),
    ).map(reward => reward.name)).toEqual(
      Array.from({ length: 10 }, (_, index) => `시즌 ${index + 1}위`),
    );
  });

  it('keeps Arena reward ids disjoint by season and rejects malformed ids', () => {
    const first = getArenaSeasonRewardItems('arena-v1-1');
    const second = getArenaSeasonRewardItems('arena-v1-2');
    expect(first).toBe(getArenaSeasonRewardItems('arena-v1-1'));
    expect(new Set([
      ...first.map(reward => reward.id),
      ...second.map(reward => reward.id),
    ]).size).toBe(first.length + second.length);
    for (const invalid of ['', 'season-1', 'arena-v1--1', 'arena-v1-01']) {
      expect(() => getArenaSeasonRewardItems(invalid))
        .toThrowError('ARENA_SEASON_CATALOG_INVALID');
    }
    expect(getCollectionItemDefinition('arena-v1-1-rank-11-title')).toBeNull();
  });
});
