import { describe, expect, it } from 'vitest';
import { PROGRESSION_CHARACTER_IDS } from '@/lib/progression/types';
import { AFFINITY_REWARD_LEVELS } from '@/lib/collection/catalog';
import {
  BOND_SCENE_LEVELS,
  findNewlyUnlockedScenes,
  getBondSceneArt,
  getBondScenes,
  isBondSceneUnlocked,
} from './bond-scenes';

describe('bond scenes', () => {
  it('covers every progression character with 4 milestone scenes matching reward levels', () => {
    expect([...BOND_SCENE_LEVELS]).toEqual([...AFFINITY_REWARD_LEVELS]);
    for (const characterId of PROGRESSION_CHARACTER_IDS) {
      const scenes = getBondScenes(characterId);
      expect(scenes.map(scene => scene.level), characterId).toEqual([...BOND_SCENE_LEVELS]);
      for (const scene of scenes) {
        expect(scene.title.length, scene.id).toBeGreaterThan(0);
        expect(scene.caption.length, scene.id).toBeGreaterThanOrEqual(5);
        expect(getBondSceneArt(scene)).toBe(
          `/assets/characters/${characterId}/scene-lv${scene.level}.webp`,
        );
      }
    }
  });

  it('unlock check follows affinity level', () => {
    const [first] = getBondScenes('sakura');
    expect(isBondSceneUnlocked(first, 4)).toBe(false);
    expect(isBondSceneUnlocked(first, 5)).toBe(true);
  });

  it('finds newly unlocked scenes across a level jump, in order', () => {
    expect(findNewlyUnlockedScenes('ara', 4, 5).map(s => s.level)).toEqual([5]);
    // 멀티 레벨 점프(미션 몰아치기 등)에도 중간 마일스톤을 놓치지 않는다
    expect(findNewlyUnlockedScenes('ara', 3, 15).map(s => s.level)).toEqual([5, 10, 15]);
    expect(findNewlyUnlockedScenes('ara', 5, 5)).toEqual([]);
    expect(findNewlyUnlockedScenes('unknown', 0, 20)).toEqual([]);
  });
});
