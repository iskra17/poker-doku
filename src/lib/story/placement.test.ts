import { describe, expect, it } from 'vitest';
import { getDrillTemplate } from './drills/generator';
import {
  PLACEMENT_TEMPLATE_IDS,
  PLACEMENT_TIER_FLAG,
  decidePlacementTier,
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
    for (const id of PLACEMENT_TEMPLATE_IDS) expect(getDrillTemplate(id), id).toBeTruthy();
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
