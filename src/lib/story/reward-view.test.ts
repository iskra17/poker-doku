import { describe, expect, it } from 'vitest';
import { STORY_CHAPTERS } from './chapters';
import { buildRewardRevealPlan, deriveFallbackRewards, stageAutoAdvanceMs } from './reward-view';
import { getStoryRewardDefinition, toStoryRewardCutscene, toStoryRewardItemView } from './rewards/catalog';
import type { ChapterResultView } from './views';

function result(overrides: Partial<ChapterResultView> = {}): ChapterResultView {
  return {
    chapterId: 'act1-ch01',
    mode: 'full',
    passed: true,
    grade: 'A',
    drill: { answered: 6, correct: 5, bestStreak: 3, hintsUsed: 1, score: 0.8, slots: 6, finalCorrect: 6, perfect: false, retrySkipped: false },
    live: null,
    rewards: { firstClear: true, dojoXpMilli: 100_000, affinity: [{ characterId: 'sakura', milli: 30_000 }], badgeId: null },
    reviewNotesAdded: 1,
    nextChapterId: 'act1-ch02',
    beltAwarded: null,
    ...overrides,
  };
}

describe('reward reveal plan — 보너스 CG 표시 설정', () => {
  const bonusId = 'story-bonus-cg-sakura-casual';
  const bonusCutscene = toStoryRewardCutscene(getStoryRewardDefinition(bonusId)!)!;
  const bonusItem = toStoryRewardItemView(getStoryRewardDefinition(bonusId)!);

  function bonusResult(): ChapterResultView {
    return result({
      rewards: {
        firstClear: true, dojoXpMilli: 0, affinity: [], badgeId: null,
        items: [bonusItem], chips: 0, cutscene: bonusCutscene, unlockedScenes: [], next: [],
      },
    });
  }

  it('기본(표시 켜짐)은 보너스 컷신 단계를 그대로 만든다', () => {
    const plan = buildRewardRevealPlan(bonusResult(), STORY_CHAPTERS);
    expect(plan.cutscene?.id).toBe(bonusId);
    expect(plan.stages).toContain('cutscene');
  });

  it('표시를 끄면 컷신과 그 단계를 함께 뺀다 — 아이템 카드는 남는다', () => {
    const plan = buildRewardRevealPlan(bonusResult(), STORY_CHAPTERS, { showBonusCg: false });
    expect(plan.cutscene).toBeNull();
    expect(plan.stages).not.toContain('cutscene');
    expect(plan.stages).toContain('items');
    expect(plan.items.map(item => item.id)).toEqual([bonusId]);
  });

  it('스토리 CG 컷신은 표시를 꺼도 그대로 나온다', () => {
    const beltId = 'story-cg-act1-belt-white';
    const plan = buildRewardRevealPlan(result({
      rewards: {
        firstClear: true, dojoXpMilli: 0, affinity: [], badgeId: null,
        items: [toStoryRewardItemView(getStoryRewardDefinition(beltId)!)],
        chips: 0, cutscene: toStoryRewardCutscene(getStoryRewardDefinition(beltId)!), unlockedScenes: [], next: [],
      },
    }), STORY_CHAPTERS, { showBonusCg: false });
    expect(plan.cutscene?.id).toBe(beltId);
    expect(plan.stages).toContain('cutscene');
  });
});

describe('reward reveal plan', () => {
  it('졸업 대결만 재도전은 등급 스탬프·드릴 통계 단계를 빼고 순위 카드만 남긴다', () => {
    const plan = buildRewardRevealPlan(result({
      chapterId: 'act4-ch12',
      mode: 'graduation',
      grade: 'B',
      drill: { answered: 0, correct: 0, bestStreak: 0, hintsUsed: 0, score: 0, slots: 0, finalCorrect: 0, perfect: false, retrySkipped: false },
      rewards: { firstClear: false, dojoXpMilli: 0, affinity: [], badgeId: null, items: [], chips: 0, cutscene: null, unlockedScenes: [], next: [] },
      nextChapterId: null,
      graduation: { place: 1, entrants: 6, itm: true, champion: true, blackBelt: true, mode: 'graduation' },
    }), STORY_CHAPTERS);
    expect(plan.graduationOnly).toBe(true);
    expect(plan.stages).toEqual(['done']);
    expect(plan.items).toEqual([]);
    expect(plan.chips).toBe(0);
  });

  it('full 모드 졸업 결산은 기존 단계를 그대로 쓴다', () => {
    const plan = buildRewardRevealPlan(result({
      chapterId: 'act4-ch12',
      graduation: { place: 2, entrants: 6, itm: true, champion: false, blackBelt: false, mode: 'full' },
    }), STORY_CHAPTERS);
    expect(plan.graduationOnly).toBe(false);
    expect(plan.stages.slice(0, 2)).toEqual(['stamp', 'stats']);
  });

  it('uses server rewards verbatim when present and orders stages by presence', () => {
    const plan = buildRewardRevealPlan(result({
      rewards: {
        firstClear: true, dojoXpMilli: 0, affinity: [], badgeId: null,
        items: [{ id: 'story-title-white-belt', kind: 'title', name: '백띠 수련생', description: '' }],
        chips: 500,
        cutscene: { id: 'story-cg-act1-belt-white', kind: 'belt', characterId: 'miyako', title: '백띠 수여', caption: '…', art: '/assets/story/cg/act1-belt-white.webp' },
        unlockedScenes: [],
        next: [],
      },
    }), STORY_CHAPTERS);
    expect(plan.fallback).toBe(false);
    expect(plan.stages).toEqual(['stamp', 'stats', 'items', 'cutscene', 'done']);
    expect(plan.items.map(item => item.id)).toEqual(['story-title-white-belt']);
    expect(plan.chips).toBe(500);
    expect(plan.cutscene?.id).toBe('story-cg-act1-belt-white');
  });

  it('falls back to catalog-derived rewards (first clear, S grade, act completion) when the server line is absent', () => {
    const firstClear = deriveFallbackRewards(result(), STORY_CHAPTERS[0]);
    expect(firstClear.items.map(item => item.id)).toEqual(['story-title-white-belt', 'story-cg-act1-belt-white']);
    expect(firstClear.chips).toBe(500);

    const sGrade = deriveFallbackRewards(result({ grade: 'S' }), STORY_CHAPTERS[0]);
    expect(sGrade.items.map(item => item.id)).toEqual(['story-title-white-belt', 'story-cg-act1-belt-white', 'story-cardback-dojo-crest']);
    expect(sGrade.chips).toBe(800);

    const actDone = deriveFallbackRewards(result({ chapterId: 'act1-ch03', beltAwarded: 'yellow' }), STORY_CHAPTERS[2]);
    expect(actDone.items.map(item => item.id)).toContain('story-felt-yellow-belt');
    expect(actDone.chips).toBe(1_500);

    // 재도전(첫 완주 아님)·미통과·데일리는 카탈로그 파생 없음
    expect(deriveFallbackRewards(result({ rewards: { firstClear: false, dojoXpMilli: 20_000, affinity: [], badgeId: null } }), STORY_CHAPTERS[0]).items).toEqual([]);
    expect(deriveFallbackRewards(result({ passed: false }), STORY_CHAPTERS[0]).items).toEqual([]);
    expect(deriveFallbackRewards(result({ chapterId: 'daily' }), undefined).items).toEqual([]);
  });

  it('fallback plan picks the cutscene (boss > belt > event) and next-reward preview, and marks fallback', () => {
    const plan = buildRewardRevealPlan(result({ chapterId: 'act1-ch03', grade: 'A', beltAwarded: 'yellow' }), STORY_CHAPTERS);
    expect(plan.fallback).toBe(true);
    expect(plan.cutscene?.kind).toBe('boss-win');
    expect(plan.stages).toEqual(['stamp', 'stats', 'items', 'cutscene', 'belt', 'next', 'done']);
    // 다음 보상: Ch3 S 의상만 남는다 (첫 완주·막 완주 보상은 이번에 받음)
    expect(plan.next.map(item => item.id)).toEqual(['story-outfit-hana-lab']);
  });

  it('failed or daily results only show stamp/stats(+next) and never a cutscene', () => {
    const failed = buildRewardRevealPlan(result({ passed: false, grade: 'B', rewards: { firstClear: false, dojoXpMilli: 0, affinity: [], badgeId: null } }), STORY_CHAPTERS);
    expect(failed.items).toEqual([]);
    expect(failed.cutscene).toBeNull();
    expect(failed.stages.slice(0, 2)).toEqual(['stamp', 'stats']);
    expect(failed.stages).not.toContain('cutscene');
    const daily = buildRewardRevealPlan(result({ chapterId: 'daily', rewards: { firstClear: false, dojoXpMilli: 0, affinity: [{ characterId: 'sakura', milli: 5_000 }], badgeId: null } }), STORY_CHAPTERS);
    expect(daily.stages).toEqual(['stamp', 'stats', 'done']);
    expect(daily.next).toEqual([]);
  });

  it('auto-advance timing: tap-only stages return null, items scale with card count', () => {
    const plan = buildRewardRevealPlan(result({ grade: 'S' }), STORY_CHAPTERS);
    expect(stageAutoAdvanceMs('stamp', plan)).toBe(900);
    expect(stageAutoAdvanceMs('cutscene', plan)).toBeNull();
    expect(stageAutoAdvanceMs('next', plan)).toBeNull();
    expect(stageAutoAdvanceMs('done', plan)).toBeNull();
    // 아이템 3 + 칩 1 = 4장 × 420 + 700
    expect(stageAutoAdvanceMs('items', plan)).toBe(4 * 420 + 700);
  });
});
