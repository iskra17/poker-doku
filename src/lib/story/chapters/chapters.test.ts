import { describe, expect, it } from 'vitest';
import { parseCards } from '@/lib/poker/card-notation';
import { makeChapter, makeChapterChain, makeScene, makeTable } from '../test-fixtures';
import type { Chapter, LessonBlock, Scene, SceneSayLine, Step } from '../types';
import { DRILL_TEMPLATE_IDS, GENERATED_DRILL_DEFINITIONS } from '../drills/generator';
import { findRequiresCycle, getChapter, STORY_CHAPTERS, validateChapters } from './index';

const TEMPLATE_IDS = new Set(['rank-who-wins', 'pos-name']);

function sparringOf(chapter: Chapter): Extract<Step, { kind: 'sparring' }> {
  const step = chapter.steps.find(candidate => candidate.kind === 'sparring');
  if (step?.kind !== 'sparring') throw new Error('fixture');
  return step;
}

function drillSetOf(chapter: Chapter): Extract<Step, { kind: 'drill-set' }> {
  const step = chapter.steps.find(candidate => candidate.kind === 'drill-set');
  if (step?.kind !== 'drill-set') throw new Error('fixture');
  return step;
}

function withStep(chapter: Chapter, mutate: (steps: Step[]) => Step[]): Chapter {
  return { ...chapter, steps: mutate([...chapter.steps]) };
}

describe('chapter registry', () => {
  it('registry validates and is sorted by act/order', () => {
    expect(validateChapters(STORY_CHAPTERS)).toEqual([]);
    const keys = STORY_CHAPTERS.map(c => c.act * 100 + c.order);
    expect([...keys].sort((a, b) => a - b)).toEqual(keys);
    for (const chapter of STORY_CHAPTERS) expect(getChapter(chapter.id)).toBe(chapter);
    expect(getChapter('act9-ch99')).toBeUndefined();
  });

  it('accepts the fixture chain', () => {
    expect(validateChapters(makeChapterChain(), { templateIds: TEMPLATE_IDS })).toEqual([]);
  });
});

describe('validateChapters', () => {
  it('reports unknown requires, self-requires and cycles', () => {
    const [a, b] = makeChapterChain();
    const missing = validateChapters([{ ...b, requires: ['act1-ch99'] }]);
    expect(missing.some(e => e.includes('requires unknown chapter act1-ch99'))).toBe(true);

    const self = validateChapters([{ ...a, requires: ['act1-ch01'] }]);
    expect(self.some(e => e.includes('requires itself'))).toBe(true);

    const cyc = [{ ...a, requires: ['act1-ch02'] }, b];
    expect(findRequiresCycle(cyc)).toEqual(['act1-ch01', 'act1-ch02', 'act1-ch01']);
    expect(validateChapters(cyc).some(e => e.startsWith('requires cycle'))).toBe(true);
    expect(findRequiresCycle(makeChapterChain())).toBeNull();
  });

  it('rejects malformed ids, teachers, belts and duplicate orders', () => {
    const errors = validateChapters([
      makeChapter({ id: 'chapter-1', teacher: 'mochi' as never, belt: 'gold' as never }),
      makeChapter({ id: 'act2-ch01', act: 1 }),
      makeChapter({ id: 'act1-ch03', act: 1, order: 1 }),
    ]);
    expect(errors).toEqual(expect.arrayContaining([
      expect.stringContaining('id must match'),
      expect.stringContaining('unknown teacher mochi'),
      expect.stringContaining('unknown belt gold'),
      expect.stringContaining('act 1 does not match id'),
      expect.stringContaining('duplicate order 1 in act 1'),
    ]));
  });

  it('rejects miyako as an affinity target', () => {
    const chapter = makeChapter();
    chapter.rewards = { ...chapter.rewards, first: { ...chapter.rewards.first, affinity: [{ target: 'miyako' as never, milli: 10 }] } };
    expect(validateChapters([chapter]).some(e => e.includes('miyako is not an affinity target'))).toBe(true);
  });

  it('checks scene cg ids and effects on say lines, including choice replies (2026-09-03 피드백 ④)', () => {
    const base = makeChapter();
    const patchScene = (mutate: (scene: Scene) => Scene): Chapter =>
      withStep(base, steps => steps.map(step => (step.kind === 'scene' ? { ...step, scene: mutate(step.scene) } : step)));
    const withLine = (extra: Partial<SceneSayLine>): Chapter =>
      patchScene(scene => ({ ...scene, lines: scene.lines.map(line => (line.kind === 'say' ? { ...line, ...extra } : line)) }));

    expect(validateChapters([withLine({ cg: 'act1-ch01-prologue', effect: 'shake' })])).toEqual([]);
    expect(validateChapters([withLine({ effect: 'sfx:flip' })])).toEqual([]);
    expect(validateChapters([withLine({ cg: 'nope' })]).some(e => e.includes('unknown cg nope'))).toBe(true);
    expect(validateChapters([withLine({ effect: 'explode' as never })]).some(e => e.includes('unknown effect explode'))).toBe(true);
    expect(validateChapters([withLine({ effect: 'sfx:nope' as never })]).some(e => e.includes('unknown effect sfx:nope'))).toBe(true);

    const badReply = patchScene(scene => ({
      ...scene,
      lines: [
        ...scene.lines,
        { kind: 'choice', choice: { id: 'c', options: [
          { id: 'a', text: 'A', reply: [{ kind: 'say', speaker: 'miyako', text: '응', effect: 'zoom' }] },
          { id: 'b', text: 'B', reply: [{ kind: 'say', speaker: 'miyako', text: '응', cg: 'nope' }] },
        ] } },
      ],
    }));
    expect(validateChapters([badReply]).some(e => e.includes('unknown cg nope'))).toBe(true);
  });

  it('checks guided situations: required, no duplicate cards across stages, pot >= call (2026-09-03 피드백 ①)', () => {
    const base = makeChapter();
    const patchGuided = (mutate: (block: Extract<LessonBlock, { kind: 'guided' }>) => LessonBlock): Chapter =>
      withStep(base, steps => steps.map(step => step.kind === 'lesson'
        ? { ...step, blocks: step.blocks.map(block => (block.kind === 'guided' ? mutate(block) : block)) }
        : step));

    expect(validateChapters([base])).toEqual([]);

    const missing = patchGuided(block => ({ ...block, situation: undefined as never }));
    expect(validateChapters([missing]).some(e => e.includes('guided block has no situation'))).toBe(true);

    // 2단계 오버라이드가 보드와 겹치는 홀카드를 주면 병합 결과에서 잡힌다
    const duplicate = patchGuided(block => ({
      ...block,
      stages: [{ ...block.stages[0], situation: { hero: parseCards('Qh 2c') } }],
    }));
    expect(validateChapters([duplicate]).some(e => e.includes('guided stage 0: duplicate card'))).toBe(true);

    const badPot = patchGuided(block => ({ ...block, situation: { ...block.situation, potChips: 50, toCallChips: 120 } }));
    expect(validateChapters([badPot]).some(e => e.includes('potChips >= toCallChips'))).toBe(true);

    const badBoard = patchGuided(block => ({ ...block, situation: { ...block.situation, board: parseCards('Qh 7h') } }));
    expect(validateChapters([badBoard]).some(e => e.includes('board must have 0/3/4/5 cards'))).toBe(true);

    const badVillain = patchGuided(block => ({
      ...block,
      situation: { ...block.situation, villains: [{ seatIndex: 1, characterId: 'nobody', position: 'CO', stackChips: 1_000 }] },
    }));
    expect(validateChapters([badVillain]).some(e => e.includes('unknown villain nobody'))).toBe(true);
  });

  it('checks step structure: unique ids, single trailing result, drill templates', () => {
    const base = makeChapter();
    const dupe = withStep(base, steps => [steps[0], { ...steps[1], id: steps[0].id }, ...steps.slice(2)]);
    expect(validateChapters([dupe]).some(e => e.includes('duplicate step id'))).toBe(true);

    const noResult = withStep(base, steps => steps.filter(s => s.kind !== 'result'));
    expect(validateChapters([noResult]).some(e => e.includes('exactly one result step'))).toBe(true);

    const resultFirst = withStep(base, steps => [steps[steps.length - 1], ...steps.slice(0, -1)]);
    expect(validateChapters([resultFirst]).some(e => e.includes('result step must be last'))).toBe(true);

    const unknownTemplate = validateChapters([base], { templateIds: new Set(['rank-who-wins']) });
    expect(unknownTemplate).toEqual([expect.stringContaining('unknown drill template pos-name')]);
    // templateIds 미지정이면 존재 검사를 건너뛴다
    expect(validateChapters([base])).toEqual([]);
  });

  it('validates deal scripts: card notation, seat membership, duplicates', () => {
    const base = makeChapter();
    const practiceIndex = base.steps.findIndex(s => s.kind === 'practice-table');
    const patch = (scripts: Array<{ hero: string; board?: string; villains?: Record<number, string> }>) =>
      withStep(base, steps => {
        const step = steps[practiceIndex];
        if (step.kind !== 'practice-table') throw new Error('fixture');
        steps[practiceIndex] = { ...step, scripts };
        return steps;
      });

    expect(validateChapters([patch([{ hero: 'As Zz' }])]).some(e => e.includes('hero must be exactly 2 cards'))).toBe(true);
    expect(validateChapters([patch([{ hero: 'As Ks', board: 'Ah Kd' }])]).some(e => e.includes('board must be 3..5 cards'))).toBe(true);
    expect(validateChapters([patch([{ hero: 'As Ks', villains: { 5: 'Qh Qd' } }])]).some(e => e.includes('villain seat 5 is not in the lineup'))).toBe(true);
    expect(validateChapters([patch([{ hero: 'As Ks', villains: { 0: 'Qh Qd' } }])]).some(e => e.includes('villain seat 0 is not in the lineup'))).toBe(true);
    expect(validateChapters([patch([{ hero: 'As Ks', board: 'As 7d 2c' }])]).some(e => e.includes('duplicate card As across script'))).toBe(true);
    expect(validateChapters([patch([{ hero: 'As Ks', board: 'Ah Kd 7c 2c 9s', villains: { 2: 'Qh Qd', 3: 'Jh Jd' } }])])).toEqual([]);
  });

  it('validates live tables: seats, duplicate characters, blinds', () => {
    const base = makeChapter();
    const sparIndex = base.steps.findIndex(s => s.kind === 'sparring');
    const patchTable = (overrides: Parameters<typeof makeTable>[0]) =>
      withStep(base, steps => {
        const step = steps[sparIndex];
        if (step.kind !== 'sparring') throw new Error('fixture');
        steps[sparIndex] = { ...step, table: makeTable(overrides) };
        return steps;
      });

    expect(validateChapters([patchTable({ heroSeat: 1 })]).some(e => e.includes('duplicate seat 1'))).toBe(true);
    expect(validateChapters([patchTable({ blinds: { small: 20, big: 20 } })]).some(e => e.includes('invalid blinds'))).toBe(true);
    expect(validateChapters([patchTable({
      lineup: [
        { seatIndex: 1, characterId: 'kapi', stackBB: 100 },
        { seatIndex: 2, characterId: 'kapi', stackBB: 100 },
      ],
    })]).some(e => e.includes('duplicate character kapi'))).toBe(true);
    expect(validateChapters([patchTable({
      lineup: [1, 2, 3, 4, 5, 6].map(seatIndex => ({ seatIndex, characterId: `c${seatIndex}`, stackBB: 100 })),
    })]).some(e => e.includes('lineup must have 1..5 seats'))).toBe(true);
    expect(validateChapters([patchTable({
      lineup: [{ seatIndex: 1, characterId: 'story-mask', stackBB: 100 }],
    })]).some(e => e.includes('character story-mask is not a playable bot'))).toBe(true);
  });

  it('validates objectives and scenes', () => {
    const base = makeChapter();
    const sparIndex = base.steps.findIndex(s => s.kind === 'sparring');
    const badObjective = withStep(base, steps => {
      const step = steps[sparIndex];
      if (step.kind !== 'sparring') throw new Error('fixture');
      steps[sparIndex] = {
        ...step,
        objectives: {
          primary: [{ id: 'x', kind: 'vpip-range' as never, label: 'VPIP', minRatio: 1.5 }],
          bonus: [],
        },
      };
      return steps;
    });
    const errors = validateChapters([badObjective]);
    expect(errors.some(e => e.includes('unknown objective kind vpip-range'))).toBe(true);
    expect(errors.some(e => e.includes('minRatio must be within (0, 1]'))).toBe(true);

    const badMinHands = withStep(base, steps => {
      const step = steps[sparIndex];
      if (step.kind !== 'sparring') throw new Error('fixture');
      steps[sparIndex] = { ...step, minHands: step.maxHands + 1 };
      return steps;
    });
    expect(validateChapters([badMinHands]).some(e => e.includes('minHands must be an integer within 1..maxHands'))).toBe(true);
    const okMinHands = withStep(base, steps => {
      const step = steps[sparIndex];
      if (step.kind !== 'sparring') throw new Error('fixture');
      steps[sparIndex] = { ...step, minHands: 1 };
      return steps;
    });
    expect(validateChapters([okMinHands])).toEqual([]);

    const emptyScene = withStep(base, steps => [{ kind: 'scene', id: 'empty', scene: { id: 'empty', lines: [] } }, ...steps]);
    expect(validateChapters([emptyScene]).some(e => e.includes('has no lines'))).toBe(true);

    const oneOption = withStep(base, steps => [{
      kind: 'scene',
      id: 'choice',
      scene: { id: 'choice', lines: [{ kind: 'choice', choice: { id: 'q', options: [{ id: 'a', text: '네' }] } }] },
    }, ...steps]);
    expect(validateChapters([oneOption]).some(e => e.includes('needs >= 2 options'))).toBe(true);

    const okScene = makeScene('ok');
    expect(validateChapters([withStep(base, steps => [{ kind: 'scene', id: 'ok', scene: okScene }, ...steps])])).toEqual([]);
  });
});


describe('4막 공유 계약 검증 (체크리스트 · 동적 복습 슬롯 · heroine-fill)', () => {
  const patchSparring = (mutate: (step: Extract<Step, { kind: 'sparring' }>) => Step): Chapter => {
    const base = makeChapter();
    return withStep(base, steps => steps.map(step => (step.kind === 'sparring' ? mutate(sparringOf(base)) : step)));
  };
  const patchDrills = (mutate: (step: Extract<Step, { kind: 'drill-set' }>) => Step): Chapter => {
    const base = makeChapter();
    return withStep(base, steps => steps.map(step => (step.kind === 'drill-set' ? mutate(drillSetOf(base)) : step)));
  };

  it('체크리스트는 부모 id 전역 유일 · k 양의 정수 · 항목 kind 제한을 지킨다', () => {
    const ok = patchSparring(step => ({
      ...step,
      checklist: {
        id: 'list', label: '체크리스트 2/3', k: 2,
        items: [
          { id: 'i1', kind: 'no-limp', label: '림프 없음', maxCount: 0 },
          { id: 'i2', kind: 'cbet-when-aggressor', label: 'c벳', minRatio: 0.5 },
          { id: 'i3', kind: 'correct-pot-odds-call', label: '가격', maxCount: 2 },
        ],
      },
    }));
    expect(validateChapters([ok], { templateIds: TEMPLATE_IDS })).toEqual([]);

    const badK = patchSparring(step => ({ ...step, checklist: { id: 'list', label: 'x', k: 0, items: [{ id: 'i1', kind: 'no-limp', label: 'x', maxCount: 0 }] } }));
    expect(validateChapters([badK]).some(e => e.includes('checklist k must be a positive integer'))).toBe(true);

    const empty = patchSparring(step => ({ ...step, checklist: { id: 'list', label: 'x', k: 1, items: [] } }));
    expect(validateChapters([empty]).some(e => e.includes('checklist has no items'))).toBe(true);

    const nested = patchSparring(step => ({ ...step, checklist: { id: 'list', label: 'x', k: 1, items: [{ id: 'i1', kind: 'executed-any', label: 'x', target: 1 }] } }));
    expect(validateChapters([nested]).some(e => e.includes('is not allowed'))).toBe(true);

    const duplicate = patchSparring(step => ({ ...step, checklist: { id: step.objectives.primary[0].id, label: 'x', k: 1, items: [{ id: 'i1', kind: 'no-limp', label: 'x', maxCount: 0 }] } }));
    expect(validateChapters([duplicate]).some(e => e.includes('duplicate objective id'))).toBe(true);
  });

  it('topair-calldown만 새로 finalOpportunityCap을 쓸 수 있다', () => {
    const capped = patchSparring(step => ({
      ...step,
      objectives: { ...step.objectives, primary: [{ id: 'cd', kind: 'topair-calldown', label: '콜다운', target: 2, finalOpportunityCap: true }] },
    }));
    expect(validateChapters([capped], { templateIds: TEMPLATE_IDS })).toEqual([]);
    const wrong = patchSparring(step => ({
      ...step,
      objectives: { ...step.objectives, primary: [{ id: 'cd', kind: 'no-air-reraise', label: '에어', target: 2, finalOpportunityCap: true }] },
    }));
    expect(validateChapters([wrong]).some(e => e.includes('invalid final opportunity cap'))).toBe(true);
  });

  it('동적 복습 슬롯은 reviewPool과 짝을 이뤄야 하고 sentinel 자체는 레지스트리 검사 대상이 아니다', () => {
    const ok = patchDrills(step => ({
      ...step,
      drills: [...step.drills, { templateId: '*review', seedPolicy: 'per-run' }],
      reviewPool: ['rank-who-wins'],
    }));
    expect(validateChapters([ok], { templateIds: TEMPLATE_IDS })).toEqual([]);

    const noPool = patchDrills(step => ({ ...step, drills: [{ templateId: '*review', seedPolicy: 'per-run' }] }));
    expect(validateChapters([noPool], { templateIds: TEMPLATE_IDS }).some(e => e.includes('review slots require a non-empty reviewPool'))).toBe(true);

    const strayPool = patchDrills(step => ({ ...step, reviewPool: ['rank-who-wins'] }));
    expect(validateChapters([strayPool], { templateIds: TEMPLATE_IDS }).some(e => e.includes("reviewPool requires at least one '*review' slot"))).toBe(true);

    const unknownPool = patchDrills(step => ({
      ...step,
      drills: [{ templateId: '*review', seedPolicy: 'per-run' }],
      reviewPool: ['nope'],
    }));
    expect(validateChapters([unknownPool], { templateIds: TEMPLATE_IDS }).some(e => e.includes('unknown reviewPool template nope'))).toBe(true);
  });

  it('수기 전용 reviewPool은 거절한다 — 런타임이 전부 걸러 세트가 통째로 건너뛰어진다', () => {
    const generatedIds = new Set(GENERATED_DRILL_DEFINITIONS.map(definition => definition.template.id));
    const authoredPool = patchDrills(step => ({
      ...step,
      drills: [{ templateId: '*review', seedPolicy: 'per-run' }],
      reviewPool: ['act-ch10-overbet-fold'],
    }));
    const errors = validateChapters([authoredPool], { templateIds: DRILL_TEMPLATE_IDS, generatedTemplateIds: generatedIds });
    expect(errors.some(e => e.includes('reviewPool template act-ch10-overbet-fold is not a generated template'))).toBe(true);
    // generatedTemplateIds를 주지 않으면 기존처럼 존재 검사만 한다
    expect(validateChapters([authoredPool], { templateIds: DRILL_TEMPLATE_IDS })).toEqual([]);
  });

  it('레지스트리 전체가 생성 템플릿 집합 검사까지 통과한다', () => {
    expect(validateChapters(STORY_CHAPTERS, {
      templateIds: DRILL_TEMPLATE_IDS,
      generatedTemplateIds: new Set(GENERATED_DRILL_DEFINITIONS.map(definition => definition.template.id)),
    })).toEqual([]);
  });

  it("'heroine-fill'은 스파링에서만 허용하고 반복 토큰은 중복 캐릭터가 아니다", () => {
    const ok = patchSparring(step => ({
      ...step,
      table: makeTable({
        lineup: [
          { seatIndex: 1, characterId: 'partner', stackBB: 100, role: 'partner' },
          { seatIndex: 2, characterId: 'heroine-fill', stackBB: 100 },
          { seatIndex: 3, characterId: 'heroine-fill', stackBB: 100 },
        ],
      }),
    }));
    expect(validateChapters([ok], { templateIds: TEMPLATE_IDS })).toEqual([]);

    const inPractice = withStep(makeChapter(), steps => steps.map(step => (step.kind === 'practice-table'
      ? { ...step, table: makeTable({ lineup: [{ seatIndex: 2, characterId: 'heroine-fill', stackBB: 100 }] }), scripts: [{ hero: 'As Ks', board: 'Ah Kd 7c' }] }
      : step)));
    expect(validateChapters([inPractice], { templateIds: TEMPLATE_IDS }).some(e => e.includes("'heroine-fill' seats are allowed in sparring only"))).toBe(true);
  });

  it('reviewPolicy는 알려진 값만 받는다', () => {
    const ok = patchSparring(step => ({ ...step, table: makeTable({ reviewPolicy: 'act4-overbet-v1' }) }));
    expect(validateChapters([ok], { templateIds: TEMPLATE_IDS })).toEqual([]);
    const bad = patchSparring(step => ({ ...step, table: makeTable({ reviewPolicy: 'nope' as never }) }));
    expect(validateChapters([bad]).some(e => e.includes('invalid review policy'))).toBe(true);
  });
});
