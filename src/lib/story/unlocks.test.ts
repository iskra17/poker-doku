import { STORY_CURRICULUM } from './curriculum';
import { describe, expect, it } from 'vitest';
import { makeChapter, makeChapterChain, curriculumFor } from './test-fixtures';
import {
  BLACK_BELT_FLAG,
  beltRank,
  computeUnlockedChapters,
  deriveBelt,
  isActCompleted,
  isChapterUnlocked,
  nextChapter,
  sortChapters,
} from './unlocks';

const chain = makeChapterChain();
const none: ReadonlySet<string> = new Set();

describe('story unlocks', () => {
  it('unlocks only chapters whose requirements are all completed', () => {
    expect([...computeUnlockedChapters(chain, none)]).toEqual(['act1-ch01']);
    expect([...computeUnlockedChapters(chain, new Set(['act1-ch01']))]).toEqual(['act1-ch01', 'act1-ch02']);
    expect(isChapterUnlocked(chain[3], new Set(['act1-ch01', 'act1-ch02']))).toBe(false);
    expect(isChapterUnlocked(chain[3], new Set(['act1-ch01', 'act1-ch02', 'act1-ch03']))).toBe(true);
  });

  it('requires every prerequisite when a chapter has several', () => {
    const merge = makeChapter({ id: 'act2-ch05', act: 2, order: 2, requires: ['act1-ch03', 'act2-ch04'] });
    const all = [...chain, merge];
    expect(isChapterUnlocked(merge, new Set(['act1-ch01', 'act1-ch02', 'act1-ch03']))).toBe(false);
    expect(computeUnlockedChapters(all, new Set(['act1-ch01', 'act1-ch02', 'act1-ch03', 'act2-ch04'])).has('act2-ch05')).toBe(true);
  });

  it('picks the next chapter by act/order regardless of registry order', () => {
    const shuffled = [chain[3], chain[1], chain[0], chain[2]];
    expect(nextChapter(shuffled, none)?.id).toBe('act1-ch01');
    expect(nextChapter(shuffled, new Set(['act1-ch01']))?.id).toBe('act1-ch02');
    expect(nextChapter(shuffled, new Set(chain.map(c => c.id)))).toBeNull();
    expect(sortChapters(shuffled).map(c => c.id)).toEqual(['act1-ch01', 'act1-ch02', 'act1-ch03', 'act2-ch04']);
  });

  it('derives belts from fully completed acts and the black-belt flag', () => {
    const act1 = new Set(['act1-ch01', 'act1-ch02', 'act1-ch03']);
    expect(deriveBelt(chain, none, {}, curriculumFor(chain))).toBe('white');
    expect(deriveBelt(chain, new Set(['act1-ch01', 'act1-ch02']), {}, curriculumFor(chain))).toBe('white');
    expect(deriveBelt(chain, act1, {}, curriculumFor(chain))).toBe('yellow');
    expect(isActCompleted(chain, 1, act1, curriculumFor(chain))).toBe(true);
    expect(isActCompleted(chain, 3, act1, curriculumFor(chain))).toBe(false); // 3막 데이터 없음 → 미완료

    const all = new Set(chain.map(c => c.id));
    // 2막은 완료했지만 3·4막 데이터가 없으므로 파란띠에서 멈춘다
    expect(deriveBelt(chain, all, {}, curriculumFor(chain))).toBe('blue');

    const fourActs = [
      ...chain,
      makeChapter({ id: 'act3-ch07', act: 3, order: 1, requires: ['act2-ch04'] }),
      makeChapter({ id: 'act4-ch12', act: 4, order: 1, requires: ['act3-ch07'] }),
    ];
    const everything = new Set(fourActs.map(c => c.id));
    expect(deriveBelt(fourActs, everything, {}, curriculumFor(fourActs))).toBe('brown');
    expect(deriveBelt(fourActs, everything, { [BLACK_BELT_FLAG]: '1' }, curriculumFor(fourActs))).toBe('black');
    // 4막을 끝내지 못했으면 플래그가 있어도 검은띠 아님
    expect(deriveBelt(fourActs, new Set([...chain.map(c => c.id), 'act3-ch07']), { [BLACK_BELT_FLAG]: '1' }, curriculumFor(fourActs))).toBe('brown');
    expect(beltRank('black')).toBeGreaterThan(beltRank('brown'));
  });
});

it('a partial third act never grants brown even when the available chapter is completed', () => {
  const chapters = [...makeChapterChain(), makeChapter({ id: 'act2-ch05', act: 2 }), makeChapter({ id: 'act2-ch06', act: 2 }), makeChapter({ id: 'act3-ch07', act: 3 })];
  const completed = new Set(chapters.map(c => c.id));
  expect(isActCompleted(chapters, 3, completed, STORY_CURRICULUM)).toBe(false);
  expect(deriveBelt(chapters, completed, {}, STORY_CURRICULUM)).toBe('blue');
});
