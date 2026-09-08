import { getSceneCg } from '@/lib/assets/story-cgs';
import { STORY_CURRICULUM } from '../curriculum';
import { describe, expect, it } from 'vitest';
import { STORY_CHAPTERS } from '../chapters';
import { EMPTY_NOTE_FLAG, PERFECT_SET_FLAG } from '../unlocks';
import { STORY_HEROINE_IDS } from '../types';
import { hasAwkwardPokerTerminology } from '@/lib/characters/poker-terminology';
import { BONUS_CG_SCENES, bonusCgRewardId } from './bonus-cg';
import {
  STORY_REWARD_CATALOG,
  getStoryRewardDefinition,
  isBonusStoryReward,
  isBonusStoryRewardId,
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
  return {
    curriculum: STORY_CURRICULUM,
    completed: new Set(),
    bestGrade: new Map(),
    flags: {},
    chapters: STORY_CHAPTERS,
    dojoLevel: 0,
    affinityLevels: new Map<string, number>(),
    ...overrides,
  };
}

describe('story reward catalog', () => {
  it('Ch9 보상 CG는 아트 담당이 등록한 실제 씬 경로를 재사용한다', () => {
    expect(getSceneCg('act3-ch09-analysis')?.src).toBe('/assets/story/cg/scene-act3-ch09-analysis-v2.webp');
    expect(getSceneCg('act3-ch09-snow-window')?.src).toBe('/assets/story/cg/scene-act3-ch09-snow-window-v2.webp');
    expect(getStoryRewardDefinition('story-cg-act3-luna-analysis')?.art).toBe(getSceneCg('act3-ch09-analysis')?.src);
    expect(getStoryRewardDefinition('story-cg-act3-elena-snow')?.art).toBe(getSceneCg('act3-ch09-snow-window')?.src);
  });

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
      'story-chips-act1-ch01-first-v2', 'story-chips-act1-ch01-s-v2',
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

  it('보너스 CG 50장은 히로인 인연 / 비히로인 도장 레벨 트리거로 붙는다', () => {
    const bonus = STORY_REWARD_CATALOG.filter(item => isBonusStoryReward(item));
    expect(bonus).toHaveLength(50);
    expect(new Set(bonus.map(item => item.subjectId)).size).toBe(10);
    for (const item of bonus) {
      expect(item.kind).toBe('cg');
      expect(item.equipSlot).toBeNull();
      expect(item.chipAmount).toBeUndefined();
      expect(item.id).toBe(`story-bonus-cg-${item.subjectId}-${item.id.split('-').pop()}`);
      expect(item.art).toBe(`/assets/story/cg/bonus-${item.subjectId}-${item.id.split('-').pop()}.webp`);
      expect(item.cutscene?.kind).toBe('event-cg');
      expect(item.cutscene?.characterId).toBe(item.subjectId);
      // DB character_id CHECK는 히로인 6명만 허용한다 — 비히로인은 비워 둔다
      const heroine = STORY_HEROINE_IDS.includes(item.subjectId as never);
      expect(item.characterId).toBe(heroine ? item.subjectId : undefined);
      expect(item.trigger.kind).toBe(heroine ? 'affinity-level' : 'dojo-level');
    }
    // 장면 순서대로 임계가 오른다
    expect(BONUS_CG_SCENES.map(scene => getStoryRewardDefinition(bonusCgRewardId('sakura', scene))!.trigger))
      .toEqual([4, 8, 12, 16, 20].map(level => ({ kind: 'affinity-level', characterId: 'sakura', level })));
    expect(BONUS_CG_SCENES.map(scene => getStoryRewardDefinition(bonusCgRewardId('lin', scene))!.trigger))
      .toEqual([10, 20, 30, 40, 50].map(level => ({ kind: 'dojo-level', level })));
  });

  it('레벨 트리거 자격은 경계에서 정확히 갈린다 (−1 / 정확 / +1)', () => {
    const sakuraYoga = getStoryRewardDefinition(bonusCgRewardId('sakura', 'yoga'))!; // 인연 Lv.12
    const linGym = getStoryRewardDefinition(bonusCgRewardId('lin', 'gym'))!; // 도장 Lv.40
    const at = (level: number) => state({ affinityLevels: new Map([['sakura', level]]) });
    expect(isStoryRewardEntitled(sakuraYoga, at(11))).toBe(false);
    expect(isStoryRewardEntitled(sakuraYoga, at(12))).toBe(true);
    expect(isStoryRewardEntitled(sakuraYoga, at(13))).toBe(true);
    // 다른 캐릭터 레벨은 영향이 없다
    expect(isStoryRewardEntitled(sakuraYoga, state({ affinityLevels: new Map([['ara', 20]]) }))).toBe(false);
    expect(isStoryRewardEntitled(linGym, state({ dojoLevel: 39 }))).toBe(false);
    expect(isStoryRewardEntitled(linGym, state({ dojoLevel: 40 }))).toBe(true);
    expect(isStoryRewardEntitled(linGym, state({ dojoLevel: 41 }))).toBe(true);
    // 스냅샷 없음 = 레벨 0 → 아무것도 열리지 않는다
    expect(listStoryRewardsDue(state(), new Set()).filter(item => isBonusStoryReward(item))).toEqual([]);
  });

  it('보너스 CG 조건 문구·컷신 순서·「다음 보상」 제외', () => {
    expect(storyRewardRequirement(getStoryRewardDefinition(bonusCgRewardId('hana', 'sing'))!, STORY_CHAPTERS)).toBe('하나 인연 Lv.8');
    expect(storyRewardRequirement(getStoryRewardDefinition(bonusCgRewardId('miyako', 'beach'))!, STORY_CHAPTERS)).toBe('도장 Lv.50');

    // 보너스 컷신은 보스/띠/에필로그 뒤 — 같이 지급돼도 스토리 CG가 먼저 나온다
    const bonusView = toStoryRewardItemView(getStoryRewardDefinition(bonusCgRewardId('ara', 'beach'))!);
    const beltView = toStoryRewardItemView(getStoryRewardDefinition('story-cg-act1-belt-white')!);
    expect(pickStoryCutscene([bonusView, beltView])?.id).toBe('story-cg-act1-belt-white');
    expect(pickStoryCutscene([bonusView])?.id).toBe(bonusCgRewardId('ara', 'beach'));

    // 결산 「다음 보상」은 챕터·막 트리거만 — 레벨 트리거는 절대 섞이지 않는다
    for (const chapter of STORY_CHAPTERS) {
      expect(nextStoryRewards(STORY_CHAPTERS, new Set(), chapter.id, 50).some(item => isBonusStoryRewardId(item.id))).toBe(false);
    }
    expect(isBonusStoryRewardId('story-title-white-belt')).toBe(false);
    expect(isBonusStoryRewardId('nope')).toBe(false);
  });

  it('cutscene captions and names follow the 원어 terminology rule', () => {
    const banned = /접[다는어었을]|여는 손|손을|판을|판이/;
    for (const item of STORY_REWARD_CATALOG) {
      expect(item.name).not.toMatch(banned);
      expect(item.description).not.toMatch(banned);
      if (item.cutscene) expect(item.cutscene.caption).not.toMatch(banned);
      // 공용 검사기(생성 대사·캐시와 같은 규칙)도 함께 통과해야 한다
      expect(hasAwkwardPokerTerminology(`${item.name} ${item.description} ${item.cutscene?.caption ?? ''}`), item.id).toBe(false);
    }
  });
});
