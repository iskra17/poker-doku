/**
 * 1막 3챕터 데이터 회귀 — 스키마(validateChapters)·구조(A6 템플릿)·말투 체크리스트.
 *
 * 이 스위트는 "콘텐츠가 계약을 지키는가"만 본다. 드릴 생성기 자체의 정답성은
 * generator.test.ts, 라이브 스텝 동작은 story-live-adapter.test.ts가 맡는다.
 */
import { describe, expect, it } from 'vitest';
import { evaluateHand } from '@/lib/poker/evaluator';
import { ACT1_AUTHORED_DRILLS } from '../../drills/templates/authored/act1';
import { sceneMatchesFlags } from '../../scene-cursor';
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
  return chapter.steps.reduce((count, step) => count + (step.kind === 'drill-set' ? step.drills.length : 0), 0);
}

/** 챕터의 '연습' 스텝 전부의 프리셋 핸드 수 (Ch1은 첫 핸드 1 + 본 연습 2) */
function presetHandCounts(chapter: Chapter): number[] {
  return chapter.steps.flatMap(step => (step.kind === 'practice-table' ? [step.scripts.length] : []));
}

// ---------------------------------------------------------------------------

describe('1막 챕터 데이터', () => {
  it('스키마 검증을 통과한다', () => {
    expect(validateChapters(ACT1, { templateIds: TEMPLATE_IDS })).toEqual([]);
  });

  it('수기 문항 템플릿 id가 유일하고 authored 소스다', () => {
    const ids = ACT1_AUTHORED_DRILLS.map(template => template.id);
    expect(ids).toEqual(['act-ch01-pair-beats-high', 'act-ch02-fold-utg', 'act-ch02-open-btn']);
    expect(new Set(ids).size).toBe(ids.length);
    for (const template of ACT1_AUTHORED_DRILLS) {
      expect(template.source.kind).toBe('authored');
      expect(template.hints.length).toBeGreaterThan(0);
      if (template.source.kind !== 'authored') throw new Error('unreachable');
      expect(template.source.instance.explanation.text.trim().length).toBeGreaterThan(0);
      expect(template.source.instance.explanation.speaker).toBe(template.id.startsWith('act-ch01-') ? 'miyako' : 'sakura');
    }
  });

  it('A6 템플릿 순서를 지킨다', () => {
    for (const chapter of ACT1) {
      // Ch1은 프롤로그 직후 첫 핸드(연습 1핸드) + 짧은 씬, Ch2는 Ch1 선택 회상 씬 3개(플래그 분기)가 앞에 붙는다 (2026-10-19 A1·A2)
      const base = ['scene', 'lesson', 'drill-set', 'practice-table', 'sparring', 'scene', 'result'];
      const expected = chapter.id === 'act1-ch01'
        ? ['scene', 'practice-table', 'scene', 'lesson', 'drill-set', 'scene', 'lesson', 'drill-set', 'practice-table', 'sparring', 'scene', 'result']
        : chapter.id === 'act1-ch02'
          ? ['scene', 'scene', 'scene', ...base]
          : base;
      expect(stepKinds(chapter)).toEqual(expected);
      for (const step of chapter.steps) expect(step.id.startsWith(`${chapter.id}:`)).toBe(true);
    }
  });

  it('드릴 수와 프리셋 핸드 수가 커리큘럼(A5-1)과 같다', () => {
    expect([drillCount(CH01), drillCount(CH02), drillCount(CH03)]).toEqual([6, 7, 8]);
    expect([presetHandCounts(CH01), presetHandCounts(CH02), presetHandCounts(CH03)]).toEqual([[1, 2], [2], [2]]);

    // Ch2의 수기 문항은 시드 고정 — 상황이 매번 같아야 수기 해설이 성립한다.
    const drills = CH02.steps.find(step => step.kind === 'drill-set');
    if (drills?.kind !== 'drill-set') throw new Error('fixture');
    const authored = drills.drills.find(slot => slot.templateId === 'act-ch02-fold-utg');
    expect(authored).toEqual({ templateId: 'act-ch02-fold-utg', seedPolicy: 'fixed', fixedSeed: 0 });
  });

  it('Ch1은 프롤로그 바로 뒤에 결과가 정해진 첫 핸드 1개를 두고, 본 연습은 같은 핸드를 반복하지 않는다 (2026-10-19 A1)', () => {
    expect(CH01.steps.slice(0, 4).map(step => step.id)).toEqual([
      'act1-ch01:prologue', 'act1-ch01:first-hand', 'act1-ch01:first-hand-after', 'act1-ch01:lesson-foundation',
    ]);
    const first = CH01.steps[1];
    const practice = CH01.steps.find(step => step.id === 'act1-ch01:practice');
    if (first.kind !== 'practice-table' || practice?.kind !== 'practice-table') throw new Error('fixture');
    expect(first.scripts).toEqual([{ hero: 'As Ks', board: 'Ah Kd 7c 2d 9s', villains: { 2: 'Qh Qd' } }]);
    // 라인업·블라인드·턴 시간·봇 속도는 본 연습과 같다
    expect(first.table).toEqual(practice.table);
    expect(first.perHandPrompt).toContain('끝까지');
    expect(practice.scripts[0].hero).not.toBe('As Ks');
    expect(practice.scripts[1]).toEqual({ hero: '7d 2c' });

    const after = CH01.steps[2];
    if (after.kind !== 'scene') throw new Error('fixture');
    expect(after.scene.lines.map(line => (line.kind === 'say' ? line.speaker : 'choice'))).toEqual(['partner', 'miyako']);

    // 첫 드릴의 첫 문항은 수기 2인 문항(원페어 vs 하이카드) — 시드 고정
    const drills = CH01.steps.find(step => step.id === 'act1-ch01:drills');
    if (drills?.kind !== 'drill-set') throw new Error('fixture');
    expect(drills.drills[0]).toEqual({ templateId: 'act-ch01-pair-beats-high', seedPolicy: 'fixed', fixedSeed: 0 });
    const easy = ACT1_AUTHORED_DRILLS.find(template => template.id === 'act-ch01-pair-beats-high');
    if (easy?.source.kind !== 'authored') throw new Error('fixture');
    expect(easy.source.instance.situation.villains).toHaveLength(1);
    expect(easy.source.instance.answerSpec).toEqual({ kind: 'multiple-choice', options: ['나', '초코'], correctIndex: 1 });
    // 정답 검산 — 나 A 하이카드 < 초코 9 원페어
    const { hero, board, villains } = easy.source.instance.situation;
    const heroHand = evaluateHand(hero, board);
    const villainHand = evaluateHand(villains[0].holeCards!, board);
    expect([heroHand.rank, villainHand.rank]).toEqual(['high-card', 'one-pair']);
    expect(villainHand.value).toBeGreaterThan(heroHand.value);
  });

  it('Ch2 회상 씬은 Ch1 에필로그 선택값마다 하나씩이고, 플래그가 없으면 셋 다 건너뛴다 (2026-10-19 A2)', () => {
    const epilogue = CH01.steps.find(step => step.id === 'act1-ch01:epilogue');
    if (epilogue?.kind !== 'scene') throw new Error('fixture');
    const choice = epilogue.scene.lines.find(line => line.kind === 'choice');
    if (choice?.kind !== 'choice') throw new Error('fixture');
    const values = choice.choice.options.map(option => option.setFlags?.['choice:act1-ch01:after']);
    expect(values).toEqual(['thanks', 'more', 'quiet']);

    const recalls = CH02.steps.slice(0, 3);
    expect(recalls.map(step => step.id)).toEqual(['act1-ch02:recall-thanks', 'act1-ch02:recall-more', 'act1-ch02:recall-quiet']);
    expect(CH02.steps[3].id).toBe('act1-ch02:prologue');
    const scenes = recalls.map(step => {
      if (step.kind !== 'scene') throw new Error('fixture');
      for (const line of step.scene.lines) expect(line.kind === 'say' && line.speaker).toBe('partner');
      return step.scene;
    });

    // 서버 sceneMatches와 같은 규칙(scene-cursor) — Ch1을 안 했으면 회상 0개, 했으면 정확히 1개
    expect(scenes.filter(scene => sceneMatchesFlags(scene, {}))).toHaveLength(0);
    for (const value of values) {
      const matched = scenes.filter(scene => sceneMatchesFlags(scene, { 'choice:act1-ch01:after': value! }));
      expect(matched.map(scene => scene.id)).toEqual([`act1-ch02:recall-${value}`]);
    }
  });

  it('1막은 비선형(requires 없음)이고 담당·띠가 커리큘럼과 같다 (2026-09-03 피드백 ②)', () => {
    expect(CH01.requires).toEqual([]);
    expect(CH02.requires).toEqual([]);
    expect(CH03.requires).toEqual([]);
    expect([CH01.teacher, CH02.teacher, CH03.teacher]).toEqual(['miyako', 'sakura', 'hana']);
    expect([CH01.belt, CH02.belt, CH03.belt]).toEqual(['white', 'white', 'yellow']);
    expect([CH01.order, CH02.order, CH03.order]).toEqual([1, 2, 3]);
  });

  it('보상 수치가 A5-2 표와 같다', () => {
    expect(CH01.rewards.first).toEqual({
      dojoXpMilli: 100_000,
      affinity: [{ target: 'partner', milli: 50_000 }],
      badgeId: 'story-white-belt',
    });
    expect(CH01.rewards.replay.dojoXpMilli).toBe(20_000);
    expect(CH01.rewards.gradeBonusMilli).toEqual({ A: 20_000, S: 50_000 });

    expect(CH02.rewards.first).toEqual({
      dojoXpMilli: 150_000,
      affinity: [{ target: 'sakura', milli: 100_000 }, { target: 'partner', milli: 20_000 }],
      badgeId: 'story-patience-sprout',
    });
    expect(CH03.rewards.first).toEqual({
      dojoXpMilli: 150_000,
      affinity: [{ target: 'hana', milli: 100_000 }, { target: 'partner', milli: 20_000 }],
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
    expect(ch03Spar.maxHands).toBe(15);
    expect(ch03Spar.minHands).toBe(6);
    expect(ch03Spar.table.lineup.map(seat => seat.characterId)).toEqual(['draco', 'choco']);
  });

  it('스파링은 미션형 — minHands 조기 종료 + 횟수형 primary, "N핸드 채우기" 목표 없음 (2026-09-03 피드백 ③)', () => {
    for (const chapter of ACT1) {
      const spar = chapter.steps.find(step => step.kind === 'sparring');
      if (spar?.kind !== 'sparring') throw new Error('fixture');
      expect(spar.minHands).toBeDefined();
      expect(spar.minHands!).toBeLessThanOrEqual(spar.maxHands);
      expect(spar.objectives.primary.some(objective => objective.kind === 'hands-played')).toBe(false);
      // 상한형만 있으면 첫 핸드에 바로 끝나 버린다 — 채워야 하는 횟수형 primary가 하나 이상
      expect(spar.objectives.primary.some(objective => objective.target !== undefined)).toBe(true);
    }
  });

  it('함께 풀기 블록은 전부 구조화된 상황(보드·내 카드)을 들고, 보드를 말하는 단계는 보드 카드가 있다 (2026-09-03 피드백 ①)', () => {
    const guided = ACT1.flatMap(chapter => chapter.steps
      .filter((step): step is Extract<Step, { kind: 'lesson' }> => step.kind === 'lesson')
      .flatMap(step => step.blocks.filter(block => block.kind === 'guided')));
    expect(guided.length).toBe(5);
    for (const block of guided) {
      expect(block.situation).toBeDefined();
      for (const stage of block.stages) {
        const merged = { ...block.situation, ...stage.situation };
        const mentionsBoard = `${block.intro} ${stage.prompt}`.includes('보드');
        if (mentionsBoard) expect(merged.board.length).toBeGreaterThanOrEqual(3);
      }
    }
    // Ch1: 1단계는 보드만, 2단계에서 K♦3♣ 공개 — 문장 밖 데이터로 보드가 유지된다
    const ch01 = guided[0];
    expect(ch01.situation.board).toHaveLength(5);
    expect(ch01.situation.hero).toHaveLength(0);
    expect(ch01.stages[1].situation?.hero).toHaveLength(2);
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
