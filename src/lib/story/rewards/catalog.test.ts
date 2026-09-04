import { STORY_CURRICULUM } from '../curriculum';
import { describe, expect, it } from 'vitest';
import { STORY_CHAPTERS } from '../chapters';
import { EMPTY_NOTE_FLAG, PERFECT_SET_FLAG } from '../unlocks';
import { STORY_HEROINE_IDS } from '../types';
import {
  STORY_REWARD_CATALOG,
  getStoryRewardDefinition,
  isStoryRewardEntitled,
  listStoryRewardPreview,
  listStoryRewardsDue,
  nextStoryRewards,
  pickStoryCutscene,
  storyRewardRequirement,
  toStoryRewardItemView,
  type StoryRewardState,
} from './catalog';

function state(overrides: Partial<StoryRewardState> = {}): StoryRewardState {
  return { curriculum: STORY_CURRICULUM, completed: new Set(), bestGrade: new Map(), flags: {}, chapters: STORY_CHAPTERS, ...overrides };
}

describe('story reward catalog', () => {
  it('ids are unique, well-formed, and every trigger points at a registered chapter / heroine / flag', () => {
    const ids = new Set<string>();
    const chapterIds = new Set(STORY_CHAPTERS.map(chapter => chapter.id));
    const heroines = new Set<string>(STORY_HEROINE_IDS);
    for (const item of STORY_REWARD_CATALOG) {
      expect(ids.has(item.id)).toBe(false);
      ids.add(item.id);
      expect(item.id).toMatch(/^[A-Za-z0-9_-]{1,128}$/);
      expect(item.gameplayModifiers).toEqual([]);
      const trigger = item.trigger;
      if (trigger.kind === 'chapter-first-clear' || trigger.kind === 'chapter-grade') expect(chapterIds.has(trigger.chapterId)).toBe(true);
      if (trigger.kind === 'flag') expect([PERFECT_SET_FLAG, EMPTY_NOTE_FLAG]).toContain(trigger.key);
      if (item.characterId) expect(heroines.has(item.characterId)).toBe(true);
      // kind별 필드 조합 — DB CHECK와 같은 규칙
      switch (item.kind) {
        case 'chips':
          expect(item.chipAmount).toBeGreaterThan(0);
          expect(item.equipSlot).toBeNull();
          break;
        case 'outfit':
          expect(item.characterId).toBeDefined();
          expect(item.outfitId).toBeDefined();
          expect(item.equipSlot).toBe('outfit');
          break;
        case 'cg':
          expect(item.art).toMatch(/^\/assets\/story\/cg\/[a-z0-9-]+\.webp$/);
          expect(item.cutscene).toBeDefined();
          expect(item.equipSlot).toBeNull();
          break;
        case 'title':
        case 'card-back':
        case 'felt':
          expect(item.equipSlot).toBe(item.kind);
          expect(item.chipAmount).toBeUndefined();
          break;
        case 'throwable':
          expect(item.id.startsWith('throwable-')).toBe(true);
          expect(item.equipSlot).toBeNull();
          break;
      }
    }
    expect(getStoryRewardDefinition('story-title-white-belt')?.name).toBe('백띠 수련생');
    expect(getStoryRewardDefinition('nope')).toBeUndefined();
  });

  it('entitlement derives only from durable state: first clear, best grade S, act completion, flags', () => {
    const whiteBelt = getStoryRewardDefinition('story-title-white-belt')!;
    const crest = getStoryRewardDefinition('story-cardback-dojo-crest')!;
    const felt = getStoryRewardDefinition('story-felt-yellow-belt')!;
    const perfect = getStoryRewardDefinition('story-title-perfect')!;
    expect(isStoryRewardEntitled(whiteBelt, state())).toBe(false);
    expect(isStoryRewardEntitled(whiteBelt, state({ completed: new Set(['act1-ch01']) }))).toBe(true);
    expect(isStoryRewardEntitled(crest, state({ completed: new Set(['act1-ch01']), bestGrade: new Map([['act1-ch01', 'A']]) }))).toBe(false);
    expect(isStoryRewardEntitled(crest, state({ completed: new Set(['act1-ch01']), bestGrade: new Map([['act1-ch01', 'S']]) }))).toBe(true);
    expect(isStoryRewardEntitled(felt, state({ completed: new Set(['act1-ch01', 'act1-ch02']) }))).toBe(false);
    expect(isStoryRewardEntitled(felt, state({ completed: new Set(['act1-ch01', 'act1-ch02', 'act1-ch03']) }))).toBe(true);
    expect(isStoryRewardEntitled(perfect, state({ flags: { [PERFECT_SET_FLAG]: '1' } }))).toBe(true);
    expect(isStoryRewardEntitled(perfect, state({ flags: { [PERFECT_SET_FLAG]: '0' } }))).toBe(false);
  });

  it('listStoryRewardsDue returns entitled-but-ungranted items only (reconcile input)', () => {
    const done = state({ completed: new Set(['act1-ch01']), bestGrade: new Map([['act1-ch01', 'S']]) });
    const due = listStoryRewardsDue(done, new Set(['story-title-white-belt']));
    expect(due.map(item => item.id)).toEqual([
      'story-chips-act1-ch01-first', 'story-cg-act1-belt-white', 'story-cardback-dojo-crest', 'story-chips-act1-ch01-s',
    ]);
    expect(listStoryRewardsDue(state(), new Set())).toEqual([]);
  });

  it('requirement copy, previews, next rewards and cutscene priority', () => {
    expect(storyRewardRequirement(getStoryRewardDefinition('story-outfit-hana-lab')!, STORY_CHAPTERS)).toBe('숫자는 거짓말을 안 해요 S등급');
    expect(storyRewardRequirement(getStoryRewardDefinition('story-felt-yellow-belt')!, STORY_CHAPTERS)).toBe('1막 · 입문 완주 (노란띠)');
    expect(storyRewardRequirement(getStoryRewardDefinition('story-title-perfect')!, STORY_CHAPTERS)).toBe('드릴 세트 퍼펙트');

    const preview = listStoryRewardPreview(STORY_CHAPTERS, new Set(['story-title-white-belt']));
    expect(preview).toHaveLength(STORY_REWARD_CATALOG.length);
    expect(preview.find(item => item.id === 'story-title-white-belt')).toMatchObject({ granted: true, requirement: '도장의 문 첫 완주' });
    expect(preview.find(item => item.id === 'story-outfit-sakura-dojo')).toMatchObject({ granted: false, kind: 'outfit', characterId: 'sakura', outfitId: 'dojo' });

    // Ch2 결산: 아직 못 받은 Ch2 보상 + 1막 완주 보상, 칩 제외, 최대 3
    const next = nextStoryRewards(STORY_CHAPTERS, new Set(['story-outfit-sakura-dojo', 'throwable-bouquet']), 'act1-ch02');
    expect(next.map(item => item.id)).toEqual(['story-cg-act1-sakura-garden', 'story-felt-yellow-belt', 'story-cg-act1-belt-yellow']);
    expect(next.every(item => !item.granted && item.kind !== 'chips')).toBe(true);

    const items = ['story-cg-act1-belt-yellow', 'story-cardback-yellow-belt', 'story-cg-act1-draco-boss'].map(id => toStoryRewardItemView(getStoryRewardDefinition(id)!));
    expect(pickStoryCutscene(items)).toMatchObject({ id: 'story-cg-act1-draco-boss', kind: 'boss-win', characterId: 'hana', art: '/assets/story/cg/act1-draco-boss.webp' });
    expect(pickStoryCutscene([toStoryRewardItemView(getStoryRewardDefinition('story-title-perfect')!)])).toBeNull();
  });

  it('cutscene captions and names follow the 원어 terminology rule', () => {
    const banned = /접[다는어었을]|여는 손|손을|판을|판이/;
    for (const item of STORY_REWARD_CATALOG) {
      expect(item.name).not.toMatch(banned);
      expect(item.description).not.toMatch(banned);
      if (item.cutscene) expect(item.cutscene.caption).not.toMatch(banned);
    }
  });
});
