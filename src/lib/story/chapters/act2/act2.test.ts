/**
 * 2막 3챕터 데이터 회귀 — 스키마(validateChapters)·구조(A6 템플릿)·목표 규약·말투 체크리스트.
 * 1막(`act1.test.ts`)과 같은 관점: "콘텐츠가 계약을 지키는가"만 본다.
 */
import { describe, expect, it } from 'vitest';
import { DRILL_TEMPLATE_IDS } from '../../drills/generator';
import { ACT2_AUTHORED_DRILLS } from '../../drills/templates/authored/act2';
import { OBJECTIVE_KINDS, type Chapter, type Scene, type SceneSayLine, type Step } from '../../types';
import { computeUnlockedChapters, deriveBelt, isActCompleted } from '../../unlocks';
import { STORY_CHAPTERS, validateChapters } from '../index';
import { ACT2_REQUIRES, CH04 } from './ch04-first-strike';
import { CH05 } from './ch05-take-what-is-yours';
import { CH06 } from './ch06-three-bet-temperature';

const ACT2: Chapter[] = [CH04, CH05, CH06];
const ACT1_IDS = ['act1-ch01', 'act1-ch02', 'act1-ch03'];

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
    if (step.kind === 'sparring') for (const interrupt of step.interrupts) lines.push(...sceneSayLines(interrupt.scene));
  }
  if (chapter.failScene) lines.push(...sceneSayLines(chapter.failScene));
  return lines;
}

function linesBySpeaker(chapters: readonly Chapter[], speaker: string): string[] {
  return chapters.flatMap(chapter => chapterSayLines(chapter)).filter(line => line.speaker === speaker).map(line => line.text);
}

function stepOf<K extends Step['kind']>(chapter: Chapter, kind: K): Extract<Step, { kind: K }> {
  const step = chapter.steps.find(candidate => candidate.kind === kind);
  if (!step) throw new Error(`fixture: ${chapter.id} has no ${kind}`);
  return step as Extract<Step, { kind: K }>;
}

function conceptCards(chapter: Chapter): Array<{ title: string; body: string; formula?: string }> {
  return stepOf(chapter, 'lesson').blocks.filter((block): block is Extract<typeof block, { kind: 'concept-card' }> => block.kind === 'concept-card');
}

describe('2막 챕터 데이터', () => {
  it('레지스트리에 등록됐고 스키마 검증(실제 템플릿 id 집합)을 통과한다', () => {
    expect(STORY_CHAPTERS.map(chapter => chapter.id)).toEqual([...ACT1_IDS, 'act2-ch04', 'act2-ch05', 'act2-ch06']);
    expect(validateChapters(STORY_CHAPTERS, { templateIds: DRILL_TEMPLATE_IDS })).toEqual([]);
  });

  it('A6 템플릿 순서(scene → lesson → drill-set → practice-table → sparring → scene → result)를 지킨다', () => {
    for (const chapter of ACT2) {
      expect(chapter.steps.map(step => step.kind)).toEqual(['scene', 'lesson', 'drill-set', 'practice-table', 'sparring', 'scene', 'result']);
      for (const step of chapter.steps) expect(step.id.startsWith(`${chapter.id}:`)).toBe(true);
    }
  });

  it('드릴 7문·프리셋 2핸드, 수기 문항은 시드 고정이고 2막 authored 소스다 (A5-1)', () => {
    const authoredIds = new Set(ACT2_AUTHORED_DRILLS.map(template => template.id));
    for (const chapter of ACT2) {
      const drills = stepOf(chapter, 'drill-set');
      expect(drills.drills, chapter.id).toHaveLength(7);
      expect(stepOf(chapter, 'practice-table').scripts, chapter.id).toHaveLength(2);
      for (const slot of drills.drills) {
        if (authoredIds.has(slot.templateId)) expect(slot.seedPolicy, slot.templateId).toBe('fixed');
        else expect(slot.seedPolicy, slot.templateId).toBe('per-run');
      }
    }
    // 커리큘럼 구성: Ch4 D-BE 2·D-SIZE 2·D-ACT 3 / Ch5 D-TYPE 3·D-SIZE 2·D-ACT 2 / Ch6 D-RANGE 3·D-BE 1·D-ACT 3
    const ids = (chapter: Chapter) => stepOf(chapter, 'drill-set').drills.map(slot => slot.templateId);
    expect(ids(CH04).filter(id => id.startsWith('breakeven-'))).toHaveLength(2);
    expect(ids(CH04).filter(id => id.startsWith('size-'))).toHaveLength(2);
    expect(ids(CH04).filter(id => id.startsWith('act-ch04-'))).toHaveLength(3);
    expect(ids(CH05).filter(id => id.startsWith('type-'))).toHaveLength(3);
    expect(ids(CH05).filter(id => id.startsWith('size-'))).toHaveLength(2);
    expect(ids(CH05).filter(id => id.startsWith('act-ch05-'))).toHaveLength(2);
    expect(ids(CH06).filter(id => id.startsWith('range-'))).toHaveLength(3);
    expect(ids(CH06).filter(id => id.startsWith('breakeven-'))).toHaveLength(1);
    expect(ids(CH06).filter(id => id.startsWith('act-ch06-'))).toHaveLength(3);
  });

  it('2막은 1막 전체 완주 뒤 열리고, 2막 안에서는 비선형이다', () => {
    for (const chapter of ACT2) expect(chapter.requires).toEqual([...ACT2_REQUIRES]);
    expect([...ACT2_REQUIRES]).toEqual(ACT1_IDS);
    const none = computeUnlockedChapters(STORY_CHAPTERS, new Set());
    expect(none.has('act2-ch04')).toBe(false);
    const partial = computeUnlockedChapters(STORY_CHAPTERS, new Set(['act1-ch01', 'act1-ch02']));
    expect(partial.has('act2-ch04')).toBe(false);
    const act1Done = computeUnlockedChapters(STORY_CHAPTERS, new Set(ACT1_IDS));
    expect(['act2-ch04', 'act2-ch05', 'act2-ch06'].every(id => act1Done.has(id))).toBe(true);
    // 띠: 1막 완주 노란, 2막 완주 파란 — 챕터 데이터의 belt 필드와 파생값이 같은 방향
    expect(deriveBelt(STORY_CHAPTERS, new Set(ACT1_IDS), {})).toBe('yellow');
    expect(deriveBelt(STORY_CHAPTERS, new Set([...ACT1_IDS, 'act2-ch04', 'act2-ch05', 'act2-ch06']), {})).toBe('blue');
    expect(isActCompleted(STORY_CHAPTERS, 2, new Set([...ACT1_IDS, 'act2-ch04', 'act2-ch05']))).toBe(false);
    expect([CH04.teacher, CH05.teacher, CH06.teacher]).toEqual(['ara', 'chloe', 'ara']);
    expect([CH04.belt, CH05.belt, CH06.belt]).toEqual(['yellow', 'yellow', 'blue']);
    expect([CH04.order, CH05.order, CH06.order]).toEqual([1, 2, 3]);
  });

  it('보상 수치가 A5-2 표와 같다', () => {
    expect(CH04.rewards.first).toEqual({ dojoXpMilli: 200_000, affinity: [{ target: 'ara', milli: 100_000 }], badgeId: 'story-first-steal' });
    expect(CH05.rewards.first).toEqual({ dojoXpMilli: 200_000, affinity: [{ target: 'chloe', milli: 100_000 }], badgeId: 'story-value-artisan' });
    expect(CH06.rewards.first).toEqual({ dojoXpMilli: 250_000, affinity: [{ target: 'ara', milli: 100_000 }], badgeId: 'story-blue-belt' });
    for (const chapter of [CH04, CH05]) {
      expect(chapter.rewards.replay.dojoXpMilli).toBe(40_000);
      expect(chapter.rewards.gradeBonusMilli).toEqual({ A: 40_000, S: 100_000 });
    }
    expect(CH06.rewards.replay.dojoXpMilli).toBe(50_000);
    expect(CH06.rewards.gradeBonusMilli).toEqual({ A: 50_000, S: 120_000 });
  });

  it('스파링은 미션형 — 결과 목표 없는 primary, 횟수형 1개 이상, 2막 턴 60초·normal', () => {
    const resultKinds = new Set(['net-chips', 'win-hands', 'survive']);
    const kinds = new Set<string>(OBJECTIVE_KINDS);
    for (const chapter of ACT2) {
      const spar = stepOf(chapter, 'sparring');
      expect(spar.minHands).toBeDefined();
      expect(spar.minHands!).toBeLessThanOrEqual(spar.maxHands);
      expect(spar.objectives.primary.length).toBeGreaterThan(0);
      for (const objective of spar.objectives.primary) {
        expect(resultKinds.has(objective.kind), objective.id).toBe(false);
        expect(kinds.has(objective.kind), objective.id).toBe(true);
      }
      expect(spar.objectives.primary.some(objective => objective.kind === 'hands-played')).toBe(false);
      expect(spar.objectives.primary.some(objective => objective.target !== undefined)).toBe(true);
      expect(spar.interrupts.length).toBeGreaterThan(0);
      expect(spar.interrupts.length).toBeLessThanOrEqual(3);
      expect(spar.table.turnTimeSec).toBe(60);
      expect(spar.table.difficulty).toBe('normal');
      expect(stepOf(chapter, 'practice-table').table.turnTimeSec).toBe(60);
    }
    // Ch4·Ch5·Ch6가 각각 새 kind를 실제로 쓴다
    const kindsOf = (chapter: Chapter) => stepOf(chapter, 'sparring').objectives.primary.map(objective => objective.kind);
    expect(kindsOf(CH04)).toEqual(['steal-open', 'cbet-when-aggressor', 'no-limp']);
    expect(kindsOf(CH05)).toEqual(['value-bet-river', 'no-air-river-bet', 'value-bet-sizing']);
    expect(kindsOf(CH06)).toEqual(['premium-3bet', 'fold-vs-3bet-junk', 'no-junk-4bet']);
  });

  it('Ch6는 보스 팽팽 헤즈업 50BB이고 미통과 단축판(failScene)을 가진다', () => {
    const spar = stepOf(CH06, 'sparring');
    expect(spar.table.lineup).toEqual([{ seatIndex: 1, characterId: 'paeng', stackBB: 50, role: 'boss' }]);
    expect(spar.table.heroStackBB).toBe(50);
    expect(spar.maxHands).toBe(15);
    expect(spar.minHands).toBe(8);
    expect(CH06.failScene).toBeDefined();
    expect(sceneSayLines(CH06.failScene!).length).toBeGreaterThan(0);
    expect(CH04.failScene).toBeUndefined();
    expect(CH05.failScene).toBeUndefined();
    // 스파링 상대는 커리큘럼(A5-1) — Ch4 카피·모찌·사쿠라, Ch5 클로이·카피·유즈키
    expect(stepOf(CH04, 'sparring').table.lineup.map(seat => seat.characterId)).toEqual(['kapi', 'mochi', 'sakura', 'partner']);
    expect(stepOf(CH05, 'sparring').table.lineup.map(seat => seat.characterId)).toEqual(['chloe', 'kapi', 'yuzuki', 'partner']);
  });

  it('함께 풀기 블록은 구조화된 상황을 들고, 챕터당 2개다 (2026-09-03 피드백 ①)', () => {
    for (const chapter of ACT2) {
      const guided = stepOf(chapter, 'lesson').blocks.filter(block => block.kind === 'guided');
      expect(guided, chapter.id).toHaveLength(2);
      for (const block of guided) expect(block.situation).toBeDefined();
    }
  });

  it('개념 카드는 4장 이하·2문장 이하, 공식은 챕터당 하나 이하 (A6)', () => {
    for (const chapter of ACT2) {
      const cards = conceptCards(chapter);
      expect(cards.length).toBeGreaterThan(0);
      expect(cards.length).toBeLessThanOrEqual(4);
      for (const card of cards) {
        const sentences = (card.body.match(/[.?]/g) ?? []).length;
        expect(sentences, `${chapter.id} / ${card.title}`).toBeLessThanOrEqual(2);
      }
      expect(cards.filter(card => Boolean(card.formula)).length).toBeLessThanOrEqual(1);
    }
  });

  it('씬 CG는 챕터마다 프롤로그·에필로그 한 장씩 단다', () => {
    for (const chapter of ACT2) {
      const prologue = chapter.steps[0];
      const epilogue = chapter.steps[5];
      if (prologue.kind !== 'scene' || epilogue.kind !== 'scene') throw new Error('fixture');
      expect(sceneSayLines(prologue.scene)[0].cg).toBe(`${chapter.id}-prologue`);
      expect(sceneSayLines(epilogue.scene)[0].cg).toBe(`${chapter.id}-epilogue`);
    }
  });
});

describe('2막 말투 체크리스트', () => {
  it('아라는 반말 츤데레 — 「너」·「흥」, 존댓말 어미 없음', () => {
    const lines = linesBySpeaker(ACT2, 'ara');
    expect(lines.length).toBeGreaterThan(10);
    expect(lines.some(text => text.includes('흥'))).toBe(true);
    expect(lines.some(text => /\b너\b|네가|너도/.test(text))).toBe(true);
    for (const text of lines) expect(/(습니다|세요|예요|에요)[.!?…]?$/.test(text.trim()), text).toBe(false);
  });

  it('클로이는 밝은 스트리머체 — 영어 한 스푼과 「~」', () => {
    const lines = linesBySpeaker(ACT2, 'chloe');
    expect(lines.length).toBeGreaterThan(8);
    expect(lines.some(text => /[A-Za-z]{3,}/.test(text))).toBe(true);
    expect(lines.filter(text => text.includes('~')).length).toBeGreaterThanOrEqual(3);
  });

  it('팽팽은 「…」로 시작하고 콜을 미지근하다고 한다', () => {
    const lines = linesBySpeaker(ACT2, 'paeng');
    expect(lines.length).toBeGreaterThan(2);
    expect(lines.every(text => text.startsWith('…'))).toBe(true);
    expect(lines.some(text => text.includes('미지근'))).toBe(true);
  });

  it('에필로그는 승급·순서를 가정하지 않는다 (승급은 결산 beltAwarded가 알린다)', () => {
    for (const chapter of ACT2) {
      const epilogue = chapter.steps[5];
      if (epilogue.kind !== 'scene') throw new Error('fixture');
      for (const line of sceneSayLines(epilogue.scene)) {
        expect(line.text, `${chapter.id}: ${line.text}`).not.toMatch(/승급|파란띠|2막은 끝/);
      }
    }
  });

  it('닉네임 플레이스홀더가 없고 빈 대사가 없다', () => {
    const placeholder = /\{\s*\w+\s*\}/;
    for (const chapter of ACT2) {
      for (const line of chapterSayLines(chapter)) {
        expect(line.text.trim().length).toBeGreaterThan(0);
        expect(placeholder.test(line.text)).toBe(false);
      }
    }
  });
});
