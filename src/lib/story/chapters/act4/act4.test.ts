import { describe, expect, it } from 'vitest';
import { parseCards } from '@/lib/poker/card-notation';
import { computePotOdds, estimateEquity } from '@/lib/poker/learning';
import { parseRange } from '@/lib/poker/range';
import { DRILL_TEMPLATE_IDS, getDrillTemplate } from '../../drills/generator';
import { readRangeFacts } from '../../drills/range-facts';
import { ACT4_RIVER_INPUTS, riverRangeFacts } from '../../drills/templates/authored/act4';
import { round1 } from '../../drills/templates/kit';
import { STORY_CURRICULUM } from '../../curriculum';
import { firstClearRewards } from '../../grading';
import { isStoryRewardEntitled, STORY_REWARD_CATALOG } from '../../rewards/catalog';
import { chapterSkillCategories } from '../../story-hub-rules';
import { deriveBelt } from '../../unlocks';
import { STORY_CHAPTERS, validateChapters } from '../index';
import { CH10 } from './ch10-storm-call';
import { CH11, CH11_REVIEW_POOL } from './ch11-all-round';

const ACT3 = [...STORY_CURRICULUM[3]];

describe('4막 Ch10·Ch11 등록', () => {
  it('레지스트리 전체가 새 드릴·목표·라인업 토큰까지 검증을 통과한다', () => {
    expect(validateChapters(STORY_CHAPTERS, { templateIds: DRILL_TEMPLATE_IDS })).toEqual([]);
    expect(STORY_CHAPTERS.map(chapter => chapter.id)).toEqual(expect.arrayContaining(['act4-ch10', 'act4-ch11']));
    for (const chapter of [CH10, CH11]) {
      expect(chapter.act).toBe(4);
      expect(chapter.belt).toBe('brown');
      expect(chapter.requires).toEqual(ACT3);
      expect(chapter.failScene!.lines.length).toBeGreaterThan(0);
    }
  });

  it('Ch12가 없으므로 4막은 미완주 — 3막 완주 갈색띠에서 멈춘다', () => {
    const completed = new Set([...STORY_CURRICULUM[1], ...STORY_CURRICULUM[2], ...ACT3, 'act4-ch10', 'act4-ch11']);
    expect(deriveBelt(STORY_CHAPTERS, completed, { 'belt:black': '1' }, STORY_CURRICULUM)).toBe('brown');
  });
});

describe('Ch10 폭풍 속의 콜', () => {
  const drills = CH10.steps.find(step => step.kind === 'drill-set');
  const sparrings = CH10.steps.filter(step => step.kind === 'sparring');

  it('드릴 8문항 · 연습 2 · 스파링 2로 구성된다', () => {
    if (drills?.kind !== 'drill-set') throw new Error('fixture');
    expect(drills.drills.map(slot => slot.templateId)).toEqual([
      'breakeven-fold-pct', 'breakeven-choice', 'mdf-defend-pct', 'mdf-vs-call-equity',
      'call-decision', 'call-river-range', 'act-ch10-triple-barrel-call', 'act-ch10-overbet-fold',
    ]);
    for (const slot of drills.drills) expect(getDrillTemplate(slot.templateId)).toBeDefined();
    expect(CH10.steps.filter(step => step.kind === 'practice-table')).toHaveLength(2);
    expect(sparrings).toHaveLength(2);
    expect(chapterSkillCategories(CH10)).toEqual(['breakeven', 'mdf', 'call-decision', 'action-judgment']);
  });

  it('두 스파링 모두 오버벳 리뷰 정책을 쓰고, 미션형 스파링은 횟수형 primary를 갖는다', () => {
    for (const step of sparrings) {
      if (step.kind !== 'sparring') throw new Error('fixture');
      expect(step.table.reviewPolicy).toBe('act4-overbet-v1');
      if (step.minHands === undefined) continue;
      // 미션형(minHands)은 상한형만으로는 절대 끝나지 않는다 — 횟수형 primary가 하나 이상 있어야 한다
      expect(step.objectives.primary.some(objective => objective.target !== undefined)).toBe(true);
    }
  });

  it('첫 스파링은 콜다운 2회(최종 기회 한정)와 에어 리레이즈 0회를 본다', () => {
    const first = sparrings[0];
    if (first?.kind !== 'sparring') throw new Error('fixture');
    expect({ maxHands: first.maxHands, minHands: first.minHands }).toEqual({ maxHands: 12, minHands: 6 });
    expect(first.objectives.primary.map(objective => [objective.kind, objective.target ?? objective.maxCount])).toEqual([
      ['topair-calldown', 2], ['no-air-reraise', 0],
    ]);
    expect(first.objectives.primary[0].finalOpportunityCap).toBe(true);
  });

  it('보스 스파링은 비비안 헤즈업 20핸드 · 오버벳 대응 50%', () => {
    const boss = sparrings[1];
    if (boss?.kind !== 'sparring') throw new Error('fixture');
    expect(boss.table.lineup).toEqual([{ seatIndex: 1, characterId: 'vivian', stackBB: 100, role: 'boss' }]);
    expect({ maxHands: boss.maxHands, minHands: boss.minHands }).toEqual({ maxHands: 20, minHands: undefined });
    expect(boss.objectives.primary.map(objective => objective.kind)).toEqual(['overbet-decision', 'no-air-reraise']);
    expect(boss.objectives.primary[0].minRatio).toBe(0.5);
    expect(boss.objectives.bonus.map(objective => objective.kind)).toEqual(['net-chips']);
  });

  it('첫 완주 보상은 비비안 인연 + 폭풍의 콜 칭호다', () => {
    const grant = firstClearRewards(CH10, 'B', 'sakura');
    expect(grant).toEqual({
      dojoXpMilli: 300_000,
      affinity: [{ characterId: 'vivian', milli: 100_000 }],
      badgeId: 'story-title-storm-caller',
    });
    expect(firstClearRewards(CH10, 'S', null).dojoXpMilli).toBe(420_000);
  });
});

describe('Ch10 수기 문항 — 실측 콤보·에퀴티', () => {
  it.each(ACT4_RIVER_INPUTS.map(input => [input.templateId, input] as const))(
    '%s의 facts는 readRangeFacts·estimateEquity 재계산과 같다',
    (_id, input) => {
      const hero = parseCards(input.hero);
      const board = parseCards(input.board);
      const range = `${input.valueRange}, ${input.bluffRange}`;
      const counted = readRangeFacts({ range, valueRange: input.valueRange, bluffRange: input.bluffRange, hero, board });
      const equity = estimateEquity(hero, board, parseRange(range));
      expect(equity.method).toBe('enumerate'); // 리버 = 결정론 완전 열거
      expect(riverRangeFacts(input)).toEqual({
        valueCombos: counted.valueCombos,
        bluffCombos: counted.bluffCombos,
        combos: counted.valueCombos + counted.bluffCombos,
        equity: round1(equity.equity * 100),
        requiredEquity: round1(computePotOdds(input.toCallChips, input.potChips).pct),
      });
    },
  );

  it('3배럴 콜다운은 필요 승률 25%에 승률이 크게 앞서 콜이 정답이다', () => {
    const facts = riverRangeFacts(ACT4_RIVER_INPUTS[0]);
    expect(facts).toEqual({ valueCombos: 23, bluffCombos: 11, combos: 34, equity: 64.7, requiredEquity: 25 });
    const template = getDrillTemplate('act-ch10-triple-barrel-call')!;
    if (template.source.kind !== 'authored') throw new Error('fixture');
    expect(template.source.instance.answerSpec).toMatchObject({ kind: 'action-pick', correct: ['call'] });
    expect(template.source.instance.explanation.text).toContain('64.7%');
    expect(template.source.instance.explanation.text).toContain('25%');
  });

  it('2배 팟 오버벳은 필요 승률 40%에 원페어 승률이 못 미쳐 폴드가 정답이다', () => {
    const facts = riverRangeFacts(ACT4_RIVER_INPUTS[1]);
    expect(facts).toEqual({ valueCombos: 25, bluffCombos: 12, combos: 37, equity: 32.4, requiredEquity: 40 });
    const template = getDrillTemplate('act-ch10-overbet-fold')!;
    if (template.source.kind !== 'authored') throw new Error('fixture');
    expect(template.source.instance.answerSpec).toMatchObject({ kind: 'action-pick', correct: ['fold'] });
    expect(template.source.instance.explanation.text).toContain('32.4%');
    expect(template.source.instance.explanation.text).toContain('40%');
  });
});

describe('Ch11 종합 수련', () => {
  const drills = CH11.steps.find(step => step.kind === 'drill-set');
  const sparring = CH11.steps.find(step => step.kind === 'sparring');

  it('드릴 8슬롯이 전부 동적 복습이고 풀은 등록된 생성 템플릿뿐이다', () => {
    if (drills?.kind !== 'drill-set') throw new Error('fixture');
    expect(drills.drills).toHaveLength(8);
    expect(drills.drills.every(slot => slot.templateId === '*review')).toBe(true);
    expect(drills.reviewPool).toEqual(CH11_REVIEW_POOL);
    expect(CH11_REVIEW_POOL.length).toBeGreaterThanOrEqual(8);
    expect(new Set(CH11_REVIEW_POOL).size).toBe(CH11_REVIEW_POOL.length);
    for (const templateId of CH11_REVIEW_POOL) {
      expect(getDrillTemplate(templateId)?.source.kind).toBe('generated');
    }
    // 4막 전용(mdf-*·sng-*)은 1~3막 복습 풀에 넣지 않는다
    expect(CH11_REVIEW_POOL.some(id => id.startsWith('mdf-') || id.startsWith('sng-'))).toBe(false);
  });

  it('스파링은 30핸드 고정 · 파트너 + 히로인 채움 4석이다', () => {
    if (sparring?.kind !== 'sparring') throw new Error('fixture');
    expect({ maxHands: sparring.maxHands, minHands: sparring.minHands }).toEqual({ maxHands: 30, minHands: undefined });
    expect(sparring.table.lineup.map(seat => seat.characterId)).toEqual([
      'partner', 'heroine-fill', 'heroine-fill', 'heroine-fill', 'heroine-fill',
    ]);
    expect(sparring.table.lineup[0].seatIndex).toBe(1);
    expect(sparring.objectives.primary.map(objective => [objective.kind, objective.target])).toEqual([['executed-any', 1]]);
  });

  it('체크리스트는 5항목 중 3개 · 항목 id가 전부 다르다', () => {
    if (sparring?.kind !== 'sparring') throw new Error('fixture');
    const checklist = sparring.checklist!;
    expect(checklist.k).toBe(3);
    expect(checklist.items.map(item => item.kind)).toEqual([
      'no-junk-entry', 'no-limp', 'cbet-when-aggressor', 'value-bet-river', 'correct-pot-odds-call',
    ]);
    expect(new Set(checklist.items.map(item => item.id)).size).toBe(5);
    expect(checklist.items.every(item => item.id !== checklist.id)).toBe(true);
  });

  it('파트너가 하나면 인연이 한 줄로 합산되고, 파트너가 없으면 partner 몫은 지급하지 않는다', () => {
    expect(firstClearRewards(CH11, 'B', 'hana').affinity).toEqual([{ characterId: 'hana', milli: 120_000 }]);
    expect(firstClearRewards(CH11, 'B', 'sakura').affinity).toEqual([
      { characterId: 'sakura', milli: 100_000 }, { characterId: 'hana', milli: 20_000 },
    ]);
    expect(firstClearRewards(CH11, 'B', null).affinity).toEqual([{ characterId: 'hana', milli: 20_000 }]);
    expect(firstClearRewards(CH11, 'B', null).badgeId).toBe('story-title-all-rounder');
  });
});

describe('4막 보상 카탈로그 (v37)', () => {
  const state = (completed: string[], bestGrade: Array<[string, 'S' | 'A' | 'B']> = []) => ({
    curriculum: STORY_CURRICULUM,
    completed: new Set(completed),
    bestGrade: new Map(bestGrade),
    flags: {},
    chapters: STORY_CHAPTERS,
  });

  it('Ch10·Ch11 첫 완주와 S등급 보상이 각각 자격을 만든다', () => {
    const ids = ['story-title-storm-caller', 'story-chips-act4-ch10-first', 'story-chips-act4-ch10-s',
      'story-title-all-rounder', 'story-chips-act4-ch11-first', 'story-chips-act4-ch11-s'];
    const items = ids.map(id => STORY_REWARD_CATALOG.find(item => item.id === id)!);
    expect(items.every(Boolean)).toBe(true);

    const none = state([]);
    expect(items.every(item => !isStoryRewardEntitled(item, none))).toBe(true);

    const cleared = state(['act4-ch10', 'act4-ch11']);
    expect(items.filter(item => isStoryRewardEntitled(item, cleared)).map(item => item.id)).toEqual([
      'story-title-storm-caller', 'story-chips-act4-ch10-first',
      'story-title-all-rounder', 'story-chips-act4-ch11-first',
    ]);

    const graded = state(['act4-ch10', 'act4-ch11'], [['act4-ch10', 'S'], ['act4-ch11', 'S']]);
    expect(items.every(item => isStoryRewardEntitled(item, graded))).toBe(true);
  });

  it('4막 완주 보상은 아직 없다 (Ch12는 R4c 범위)', () => {
    expect(STORY_REWARD_CATALOG.some(item => item.trigger.kind === 'act-complete' && item.trigger.act === 4)).toBe(false);
  });
});
