/**
 * 1막 3챕터 데이터 회귀 — 스키마(validateChapters)·구조(A6 템플릿)·말투 체크리스트.
 *
 * 이 스위트는 "콘텐츠가 계약을 지키는가"만 본다. 드릴 생성기 자체의 정답성은
 * generator.test.ts, 라이브 스텝 동작은 story-live-adapter.test.ts가 맡는다.
 */
import { describe, expect, it } from 'vitest';
import { ACT1_AUTHORED_DRILLS } from '../../drills/templates/authored/act1';
import type { Chapter, Scene, SceneSayLine, Step } from '../../types';
import { validateChapters } from '../index';
import { CH01 } from './ch01-dojo-gate';
import { CH02 } from './ch02-art-of-waiting';
import { CH03 } from './ch03-numbers-dont-lie';

const ACT1: Chapter[] = [CH01, CH02, CH03];

/** Phase 1.1 생성기가 구현하는 템플릿 id (rank-nuts는 1막 미사용, 존재만 등록) */
const GENERATED_TEMPLATE_IDS = [
  'rank-who-wins',
  'rank-best-hand',
  'pos-name',
  'pos-first-to-act',
  'range-open-decision',
  'range-percentile',
  'outs-count',
  'odds-required-equity',
  'odds-ratio-choice',
  'equity-estimate',
  'call-decision',
  'rank-nuts',
] as const;

const TEMPLATE_IDS = new Set<string>([
  ...GENERATED_TEMPLATE_IDS,
  ...ACT1_AUTHORED_DRILLS.map(template => template.id),
]);

// ---------------------------------------------------------------------------
// 헬퍼 — 챕터가 품은 모든 say 라인 수집 (선택지 reply · 인터럽트 · failScene 포함)

function sceneSayLines(scene: Scene): SceneSayLine[] {
  const lines: SceneSayLine[] = [];
  for (const line of scene.lines) {
    if (line.kind === 'say') lines.push(line);
    else for (const option of line.choice.options) lines.push(...(option.reply ?? []));
  }
  return lines;
}

function chapterSayLines(chapter: Chapter): SceneSayLine[] {
  const lines: SceneSayLine[] = [];
  for (const step of chapter.steps) {
    if (step.kind === 'scene') lines.push(...sceneSayLines(step.scene));
    if (step.kind === 'sparring') {
      for (const interrupt of step.interrupts) lines.push(...sceneSayLines(interrupt.scene));
    }
  }
  if (chapter.failScene) lines.push(...sceneSayLines(chapter.failScene));
  return lines;
}

/** 화자별 대사를 한 덩어리로 — 말투 체크리스트용 */
function linesBySpeaker(chapters: readonly Chapter[], speaker: string): string[] {
  return chapters.flatMap(chapter => chapterSayLines(chapter))
    .filter(line => line.speaker === speaker)
    .map(line => line.text);
}

/** 플레이어가 읽는 모든 문자열 — 닉네임 플레이스홀더 검사 대상 */
function allPlayerFacingText(chapter: Chapter): string[] {
  const texts: string[] = [];
  const pushScene = (scene: Scene) => {
    for (const line of scene.lines) {
      if (line.kind === 'say') texts.push(line.text);
      else {
        if (line.choice.prompt) texts.push(line.choice.prompt);
        for (const option of line.choice.options) {
          texts.push(option.text);
          for (const reply of option.reply ?? []) texts.push(reply.text);
        }
      }
    }
  };
  for (const step of chapter.steps) {
    if (step.kind === 'scene') pushScene(step.scene);
    if (step.kind === 'sparring') for (const interrupt of step.interrupts) pushScene(interrupt.scene);
    if (step.kind === 'lesson') {
      for (const block of step.blocks) {
        if (block.kind === 'text') texts.push(block.text);
        else if (block.kind === 'concept-card') texts.push(block.title, block.body);
        else {
          texts.push(block.intro);
          for (const stage of block.stages) texts.push(stage.prompt, stage.onCorrect, stage.onWrong);
        }
      }
    }
    if (step.kind === 'practice-table' && step.perHandPrompt) texts.push(step.perHandPrompt);
  }
  if (chapter.failScene) pushScene(chapter.failScene);
  return texts;
}

function conceptCards(chapter: Chapter): Array<{ title: string; body: string; formula?: string }> {
  const cards: Array<{ title: string; body: string; formula?: string }> = [];
  for (const step of chapter.steps) {
    if (step.kind !== 'lesson') continue;
    for (const block of step.blocks) if (block.kind === 'concept-card') cards.push(block);
  }
  return cards;
}

function stepKinds(chapter: Chapter): Step['kind'][] {
  return chapter.steps.map(step => step.kind);
}

function drillCount(chapter: Chapter): number {
  const step = chapter.steps.find(candidate => candidate.kind === 'drill-set');
  return step?.kind === 'drill-set' ? step.drills.length : -1;
}

function presetHandCount(chapter: Chapter): number {
  const step = chapter.steps.find(candidate => candidate.kind === 'practice-table');
  return step?.kind === 'practice-table' ? step.scripts.length : -1;
}

// ---------------------------------------------------------------------------

describe('1막 챕터 데이터', () => {
  it('스키마 검증을 통과한다', () => {
    expect(validateChapters(ACT1, { templateIds: TEMPLATE_IDS })).toEqual([]);
  });

  it('수기 문항 템플릿 id가 유일하고 authored 소스다', () => {
    const ids = ACT1_AUTHORED_DRILLS.map(template => template.id);
    expect(ids).toEqual(['act-ch02-fold-utg', 'act-ch02-open-btn']);
    expect(new Set(ids).size).toBe(ids.length);
    for (const template of ACT1_AUTHORED_DRILLS) {
      expect(template.source.kind).toBe('authored');
      expect(template.hints.length).toBeGreaterThan(0);
      if (template.source.kind !== 'authored') throw new Error('unreachable');
      expect(template.source.instance.explanation.text.trim().length).toBeGreaterThan(0);
      expect(template.source.instance.explanation.speaker).toBe('sakura');
    }
  });

  it('A6 템플릿 순서(scene → lesson → drill-set → practice-table → sparring → scene → result)를 지킨다', () => {
    for (const chapter of ACT1) {
      expect(stepKinds(chapter)).toEqual([
        'scene', 'lesson', 'drill-set', 'practice-table', 'sparring', 'scene', 'result',
      ]);
      for (const step of chapter.steps) expect(step.id.startsWith(`${chapter.id}:`)).toBe(true);
    }
  });

  it('드릴 수와 프리셋 핸드 수가 커리큘럼(A5-1)과 같다', () => {
    expect([drillCount(CH01), drillCount(CH02), drillCount(CH03)]).toEqual([6, 7, 8]);
    expect([presetHandCount(CH01), presetHandCount(CH02), presetHandCount(CH03)]).toEqual([2, 2, 2]);

    // Ch2의 수기 문항은 시드 고정 — 상황이 매번 같아야 수기 해설이 성립한다.
    const drills = CH02.steps.find(step => step.kind === 'drill-set');
    if (drills?.kind !== 'drill-set') throw new Error('fixture');
    const authored = drills.drills.find(slot => slot.templateId === 'act-ch02-fold-utg');
    expect(authored).toEqual({ templateId: 'act-ch02-fold-utg', seedPolicy: 'fixed', fixedSeed: 0 });
  });

  it('requires 사슬과 담당·띠가 커리큘럼과 같다', () => {
    expect(CH01.requires).toEqual([]);
    expect(CH02.requires).toEqual(['act1-ch01']);
    expect(CH03.requires).toEqual(['act1-ch02']);
    expect([CH01.teacher, CH02.teacher, CH03.teacher]).toEqual(['miyako', 'sakura', 'hana']);
    expect([CH01.belt, CH02.belt, CH03.belt]).toEqual(['white', 'white', 'yellow']);
    expect([CH01.order, CH02.order, CH03.order]).toEqual([1, 2, 3]);
  });

  it('보상 수치가 A5-2 표와 같다', () => {
    expect(CH01.rewards.first).toEqual({
      dojoXpMilli: 100_000,
      affinity: [{ target: 'partner', milli: 30_000 }],
      badgeId: 'story-white-belt',
    });
    expect(CH01.rewards.replay.dojoXpMilli).toBe(20_000);
    expect(CH01.rewards.gradeBonusMilli).toEqual({ A: 20_000, S: 50_000 });

    expect(CH02.rewards.first).toEqual({
      dojoXpMilli: 150_000,
      affinity: [{ target: 'sakura', milli: 100_000 }],
      badgeId: 'story-patience-sprout',
    });
    expect(CH03.rewards.first).toEqual({
      dojoXpMilli: 150_000,
      affinity: [{ target: 'hana', milli: 100_000 }],
      badgeId: 'story-yellow-belt',
    });
    for (const chapter of [CH02, CH03]) {
      expect(chapter.rewards.replay.dojoXpMilli).toBe(30_000);
      expect(chapter.rewards.gradeBonusMilli).toEqual({ A: 30_000, S: 75_000 });
    }
  });

  it('통과 조건(primary)에는 결과 목표를 두지 않는다 (A5-2 통과 규약)', () => {
    const resultKinds = new Set(['net-chips', 'win-hands', 'survive']);
    for (const chapter of ACT1) {
      const spar = chapter.steps.find(step => step.kind === 'sparring');
      if (spar?.kind !== 'sparring') throw new Error('fixture');
      expect(spar.objectives.primary.length).toBeGreaterThan(0);
      for (const objective of spar.objectives.primary) expect(resultKinds.has(objective.kind)).toBe(false);
      expect(spar.interrupts.length).toBeGreaterThan(0);
      expect(spar.interrupts.length).toBeLessThanOrEqual(3);
    }
    const ch03Spar = CH03.steps.find(step => step.kind === 'sparring');
    if (ch03Spar?.kind !== 'sparring') throw new Error('fixture');
    expect(ch03Spar.maxHands).toBe(12);
    expect(ch03Spar.table.lineup.map(seat => seat.characterId)).toEqual(['draco', 'choco']);
  });

  it('Ch3은 미통과 단축판(failScene)을 가진다', () => {
    expect(CH01.failScene).toBeUndefined();
    expect(CH03.failScene).toBeDefined();
    expect(sceneSayLines(CH03.failScene!).length).toBeGreaterThan(0);
  });
});

describe('1막 말투 체크리스트', () => {
  it('미야코는 「수련생님」이라 부르고 ♪를 쓴다', () => {
    const lines = linesBySpeaker(ACT1, 'miyako');
    expect(lines.length).toBeGreaterThan(0);
    expect(lines.some(text => text.includes('수련생님'))).toBe(true);
    expect(lines.filter(text => text.includes('♪')).length).toBeGreaterThanOrEqual(1);
  });

  it('사쿠라는 「당신」이라 부르고 말을 더듬는다', () => {
    const lines = linesBySpeaker(ACT1, 'sakura');
    expect(lines.length).toBeGreaterThan(0);
    expect(lines.some(text => text.includes('당신'))).toBe(true);
    // 말더듬 = 같은 음절 반복('저, 저는') 또는 말줄임
    const stutter = /[가-힣], [가-힣]/;
    expect(lines.filter(text => stutter.test(text) || text.includes('…')).length).toBeGreaterThanOrEqual(1);
  });

  it('하나는 「당신」이라 부른다', () => {
    const lines = linesBySpeaker(ACT1, 'hana');
    expect(lines.length).toBeGreaterThan(0);
    expect(lines.some(text => text.includes('당신'))).toBe(true);
  });

  it('닉네임 플레이스홀더가 없고 빈 대사가 없다', () => {
    const placeholder = /\{\s*\w+\s*\}/;
    for (const chapter of ACT1) {
      for (const text of allPlayerFacingText(chapter)) {
        expect(text.trim().length).toBeGreaterThan(0);
        expect(placeholder.test(text)).toBe(false);
      }
      for (const line of chapterSayLines(chapter)) expect(line.text.trim().length).toBeGreaterThan(0);
    }
  });

  it('개념 카드는 챕터당 4장 이하이고 본문은 2문장 이하다', () => {
    for (const chapter of ACT1) {
      const cards = conceptCards(chapter);
      expect(cards.length).toBeGreaterThan(0);
      expect(cards.length).toBeLessThanOrEqual(4);
      for (const card of cards) {
        const sentences = (card.body.match(/[.?]/g) ?? []).length;
        expect(sentences, `${chapter.id} / ${card.title}`).toBeLessThanOrEqual(2);
      }
    }
  });

  it('레슨의 공식은 챕터당 하나 이하다 (A6)', () => {
    for (const chapter of ACT1) {
      const formulas = conceptCards(chapter).filter(card => Boolean(card.formula));
      expect(formulas.length).toBeLessThanOrEqual(1);
    }
  });
});
