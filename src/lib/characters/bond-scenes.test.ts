import { describe, expect, it } from 'vitest';
import { PROGRESSION_CHARACTER_IDS } from '@/lib/progression/types';
import { AFFINITY_REWARD_LEVELS } from '@/lib/collection/catalog';
import {
  BOND_SCENE_LEVELS,
  findNewlyUnlockedScenes,
  getBondSceneArt,
  getBondScenes,
  isBondSceneUnlocked,
  nextBondScene,
} from './bond-scenes';

describe('bond scenes', () => {
  it('separates unlock levels from stable asset keys and item reward levels', () => {
    expect([...BOND_SCENE_LEVELS]).toEqual([2, 4, 7, 10]);
    expect([...AFFINITY_REWARD_LEVELS]).toEqual([5, 10, 15, 20]);
    for (const characterId of PROGRESSION_CHARACTER_IDS) {
      const scenes = getBondScenes(characterId);
      expect(scenes.map(scene => scene.unlockLevel), characterId).toEqual([...BOND_SCENE_LEVELS]);
      expect(scenes.map(scene => scene.level), characterId).toEqual([5, 10, 15, 20]);
      for (const scene of scenes) {
        expect(scene.id).toBe(`${characterId}-lv${scene.level}`);
        expect(isBondSceneUnlocked(scene, scene.unlockLevel - 1)).toBe(false);
        expect(isBondSceneUnlocked(scene, scene.unlockLevel)).toBe(true);
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
    expect(isBondSceneUnlocked(first, 1)).toBe(false);
    expect(isBondSceneUnlocked(first, 2)).toBe(true);
  });

  it('finds newly unlocked scenes across a level jump, in order', () => {
    expect(findNewlyUnlockedScenes('ara', 1, 2).map(s => s.level)).toEqual([5]);
    // 멀티 레벨 점프(미션 몰아치기 등)에도 중간 마일스톤을 놓치지 않는다
    expect(findNewlyUnlockedScenes('ara', 2, 7).map(s => s.level)).toEqual([10, 15]);
    expect(findNewlyUnlockedScenes('ara', 1, 20).map(s => s.unlockLevel)).toEqual([2, 4, 7, 10]);
    expect(findNewlyUnlockedScenes('ara', 5, 5)).toEqual([]);
    expect(findNewlyUnlockedScenes('unknown', 0, 20)).toEqual([]);
  });
});

describe('nextBondScene', () => {
  it('첫 씬까지 XP를 milli에서 화면 단위로 환산한다', () => {
    expect(nextBondScene('sakura', 1)).toEqual({ unlockLevel: 2, title: '벚꽃 아래서', xpRemaining: 40 });
    expect(nextBondScene('sakura', 1, 30_000)?.xpRemaining).toBe(10);
    expect(nextBondScene('sakura', 1, 39_500)?.xpRemaining).toBe(1);
  });
  it('이미 해금한 씬은 건너뛰고 중간 레벨의 XP도 더한다', () => {
    expect(nextBondScene('sakura', 2, 10_000)).toEqual({ unlockLevel: 4, title: '료칸의 오후', xpRemaining: 115 });
    expect(nextBondScene('ara', 4)?.xpRemaining).toBe(300);
    expect(nextBondScene('hana', 7)?.xpRemaining).toBe(435);
    expect(nextBondScene('chloe', 9, 150_000)?.xpRemaining).toBe(10);
  });
  it('마지막 씬 이후와 미지원 캐릭터는 예고가 없다', () => {
    expect(nextBondScene('sakura', 10)).toBeNull();
    expect(nextBondScene('sakura', 20)).toBeNull();
    expect(nextBondScene('unknown', 1)).toBeNull();
  });
});
