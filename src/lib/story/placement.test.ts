import { describe, expect, it } from 'vitest';
import { getChapter } from './chapters';
import { generateDrill, getDrillTemplate } from './drills/generator';
import {
  PLACEMENT_CHECK_AFTER_CHAPTER_ID,
  PLACEMENT_CHECK_FLAG,
  PLACEMENT_TEMPLATE_IDS,
  PLACEMENT_TIER_FLAG,
  decidePlacementTier,
  placementCheckFromFlags,
  placementCheckPromotion,
  shouldOfferPlacementCheck,
  tierFromSelfReport,
  defaultRunModeForTier,
  fastModeDrillSlots,
  fastModeTableDifficulty,
  placementTierFromFlags,
  tierShowsBeginnerGuide,
} from './placement';
import type { DrillSlot } from './types';

const slot = (templateId: string): DrillSlot => ({ templateId, seedPolicy: 'per-run' });

describe('placement rules', () => {
  it('배치 템플릿은 모두 등록돼 있고 보기 하나 고르기다', () => {
    expect(PLACEMENT_TEMPLATE_IDS).toHaveLength(4);
    for (const id of PLACEMENT_TEMPLATE_IDS) {
      expect(getDrillTemplate(id), id).toBeTruthy();
      expect(generateDrill(id, 7, { teacher: 'miyako' }).answerSpec.kind, id).toBe('multiple-choice');
    }
  });

  it('4문 체크는 Ch1 뒤에 나오므로 Ch1 드릴 유형을 다시 내지 않는다', () => {
    const ch1 = getChapter(PLACEMENT_CHECK_AFTER_CHAPTER_ID);
    expect(ch1).toBeTruthy();
    const ch1Templates = new Set<string>(ch1!.practicePool ?? []);
    for (const step of ch1!.steps) {
      if (step.kind === 'drill-set') for (const drill of step.drills) ch1Templates.add(drill.templateId);
    }
    expect(ch1Templates.size).toBeGreaterThan(0);
    for (const id of PLACEMENT_TEMPLATE_IDS) expect(ch1Templates.has(id), id).toBe(false);
  });

  it('첫 수련 자기 평가만으로는 숙련(빠른 진행)이 되지 않는다', () => {
    expect(tierFromSelfReport('new')).toBe('beginner');
    expect(tierFromSelfReport('rules')).toBe('novice');
    expect(tierFromSelfReport('regular')).toBe('novice');
  });

  it('4문 체크는 3문 이상일 때만 숙련으로 올린다', () => {
    expect(placementCheckPromotion(4, 4)).toBe('advanced');
    expect(placementCheckPromotion(3, 4)).toBe('advanced');
    expect(placementCheckPromotion(2, 4)).toBeNull();
    expect(placementCheckPromotion(0, 0)).toBeNull();
  });

  it('Ch1 뒤 체크 초대 — pending·미숙련·Ch1 완료일 때만', () => {
    const done = [{ chapterId: PLACEMENT_CHECK_AFTER_CHAPTER_ID, completions: 1 }];
    const notDone = [{ chapterId: PLACEMENT_CHECK_AFTER_CHAPTER_ID, completions: 0 }];
    const flags = (tier: string, check?: string) => ({ [PLACEMENT_TIER_FLAG]: tier, ...(check ? { [PLACEMENT_CHECK_FLAG]: check } : {}) });
    expect(shouldOfferPlacementCheck({ flags: flags('novice', 'pending'), chapters: done })).toBe(true);
    expect(shouldOfferPlacementCheck({ flags: flags('beginner', 'pending'), chapters: done })).toBe(true);
    expect(shouldOfferPlacementCheck({ flags: flags('novice', 'pending'), chapters: notDone })).toBe(false);
    expect(shouldOfferPlacementCheck({ flags: flags('advanced', 'pending'), chapters: done })).toBe(false);
    expect(shouldOfferPlacementCheck({ flags: flags('novice', 'taken'), chapters: done })).toBe(false);
    expect(shouldOfferPlacementCheck({ flags: flags('novice', 'declined'), chapters: done })).toBe(false);
    // 2026-10-24 이전 배치 사용자(check flag 없음)는 초대하지 않는다
    expect(shouldOfferPlacementCheck({ flags: flags('novice'), chapters: done })).toBe(false);
    expect(shouldOfferPlacementCheck(null)).toBe(false);
    expect(placementCheckFromFlags({ [PLACEMENT_CHECK_FLAG]: 'later' })).toBeNull();
  });

  it("'new'는 문제 없이 beginner, 그 밖에는 정답 수로만 정한다", () => {
    expect(decidePlacementTier('new', 4, 4)).toBe('beginner');
    expect(decidePlacementTier('regular', 0, 4)).toBe('beginner');
    expect(decidePlacementTier('regular', 2, 4)).toBe('novice');
    expect(decidePlacementTier('rules', 3, 4)).toBe('advanced');
    expect(decidePlacementTier('rules', 0, 0)).toBe('beginner');
  });

  it('flag 값이 이상하면 배치 전으로 본다', () => {
    expect(placementTierFromFlags({ [PLACEMENT_TIER_FLAG]: 'advanced' })).toBe('advanced');
    expect(placementTierFromFlags({ [PLACEMENT_TIER_FLAG]: 'pro' })).toBeNull();
    expect(placementTierFromFlags(undefined)).toBeNull();
  });

  it('숙련자만 빠른 진행이 기본이고 졸업 챕터는 제외한다', () => {
    expect(defaultRunModeForTier('advanced', {})).toBe('fast');
    expect(defaultRunModeForTier('advanced', { graduation: true })).toBe('full');
    expect(defaultRunModeForTier('novice', {})).toBe('full');
    expect(defaultRunModeForTier(null, {})).toBe('full');
    expect(tierShowsBeginnerGuide(null)).toBe(true);
    expect(tierShowsBeginnerGuide('novice')).toBe(false);
  });

  it('빠른 진행 드릴은 쉬운 슬롯을 덜고 최소 3문·원래 순서·review 슬롯을 지킨다', () => {
    const difficulty: Record<string, number> = { a1: 1, b2: 2, c1: 1, d3: 3, e1: 1 };
    const of = (id: string) => difficulty[id] ?? null;
    expect(fastModeDrillSlots([slot('a1'), slot('b2'), slot('c1'), slot('d3'), slot('e1')], of).map(s => s.templateId))
      .toEqual(['a1', 'b2', 'd3']);
    expect(fastModeDrillSlots([slot('a1'), slot('c1')], of).map(s => s.templateId)).toEqual(['a1', 'c1']);
    expect(fastModeDrillSlots([slot('a1'), slot('*review'), slot('b2'), slot('d3'), slot('c1')], of).map(s => s.templateId))
      .toEqual(['*review', 'b2', 'd3']);
  });

  it('스파링 봇은 한 단계 강해진다', () => {
    expect(fastModeTableDifficulty('easy')).toBe('normal');
    expect(fastModeTableDifficulty('normal')).toBe('hard');
    expect(fastModeTableDifficulty('hard')).toBe('hard');
  });
});
