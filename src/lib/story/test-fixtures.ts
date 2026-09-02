/**
 * 스토리 도메인 테스트 픽스처 — 유효한 최소 챕터를 만들고 일부만 덮어쓴다.
 * (테스트 전용. 런타임 코드에서 import 금지.)
 */
import type { Chapter, LiveTableSpec, Scene, Step } from './types';

export function makeScene(id: string, text = '안녕하세요, 수련생님♪'): Scene {
  return { id, lines: [{ kind: 'say', speaker: 'miyako', text, expression: 'happy' }] };
}

export function makeTable(overrides: Partial<LiveTableSpec> = {}): LiveTableSpec {
  return {
    blinds: { small: 10, big: 20 },
    heroSeat: 0,
    heroStackBB: 100,
    lineup: [
      { seatIndex: 1, characterId: 'partner', stackBB: 100, role: 'partner' },
      { seatIndex: 2, characterId: 'kapi', stackBB: 100, role: 'neighbor' },
      { seatIndex: 3, characterId: 'choco', stackBB: 100, role: 'neighbor' },
    ],
    difficulty: 'easy',
    turnTimeSec: 90,
    botThinkScale: 0.6,
    hints: 1,
    ...overrides,
  };
}

export function makeSteps(chapterId: string): Step[] {
  return [
    { kind: 'scene', id: `${chapterId}:prologue`, scene: makeScene(`${chapterId}:prologue`) },
    {
      kind: 'lesson',
      id: `${chapterId}:lesson`,
      title: '핸드 랭킹',
      blocks: [
        { kind: 'concept-card', title: '족보', body: '높은 순서대로 외워요.' },
        {
          kind: 'guided',
          teacher: 'miyako',
          intro: '같이 풀어 볼까요?',
          situation: {
            hero: [{ rank: 'A', suit: 'hearts' }, { rank: 'K', suit: 'hearts' }],
            board: [{ rank: 'Q', suit: 'hearts' }, { rank: '7', suit: 'hearts' }, { rank: '2', suit: 'clubs' }],
            potChips: 60,
            toCallChips: 0,
            bigBlind: 20,
            heroStackChips: 2_000,
            heroPosition: 'BTN',
            street: 'flop',
            villains: [],
          },
          stages: [{
            prompt: '하트가 몇 장 남았죠?',
            answer: { kind: 'numeric', correct: 9, tolerance: 0, unit: 'outs', min: 0, max: 21 },
            onCorrect: '정답이에요♪',
            onWrong: '다시 세어 볼까요?',
          }],
        },
      ],
    },
    {
      kind: 'drill-set',
      id: `${chapterId}:drills`,
      title: '수련 문제',
      teacher: 'miyako',
      drills: [
        { templateId: 'rank-who-wins', seedPolicy: 'per-run' },
        { templateId: 'pos-name', seedPolicy: 'fixed', fixedSeed: 7 },
      ],
      hintPenalty: 0.5,
    },
    {
      kind: 'practice-table',
      id: `${chapterId}:practice`,
      tag: '연습',
      table: makeTable(),
      scripts: [{ hero: 'As Ks', board: 'Ah Kd 7c', villains: { 2: 'Qh Qd' } }],
    },
    {
      kind: 'sparring',
      id: `${chapterId}:spar`,
      tag: '대결',
      table: makeTable(),
      maxHands: 10,
      objectives: {
        primary: [{ id: 'played', kind: 'hands-played', label: '10핸드 완주', target: 10 }],
        bonus: [{ id: 'survive', kind: 'survive', label: '파산 없음' }],
      },
      interrupts: [{ id: 'first', trigger: { kind: 'first-my-turn' }, scene: makeScene(`${chapterId}:int1`) }],
    },
    { kind: 'result', id: `${chapterId}:result` },
  ];
}

export function makeChapter(overrides: Partial<Chapter> = {}): Chapter {
  const id = overrides.id ?? 'act1-ch01';
  return {
    id,
    act: 1,
    order: 1,
    title: '도장의 문',
    subtitle: '룰과 핸드 랭킹',
    teacher: 'miyako',
    belt: 'white',
    requires: [],
    steps: makeSteps(id),
    rewards: {
      first: { dojoXpMilli: 100_000, affinity: [{ target: 'partner', milli: 30_000 }], badgeId: 'white-belt' },
      replay: { dojoXpMilli: 20_000 },
      gradeBonusMilli: { A: 20_000, S: 50_000 },
    },
    estimatedMinutes: 12,
    ...overrides,
  };
}

/** act1-ch01 → ch02 → ch03 (1막) + act2-ch04 (2막) 사슬 */
export function makeChapterChain(): Chapter[] {
  return [
    makeChapter({ id: 'act1-ch01', act: 1, order: 1 }),
    makeChapter({ id: 'act1-ch02', act: 1, order: 2, requires: ['act1-ch01'], teacher: 'sakura' }),
    makeChapter({ id: 'act1-ch03', act: 1, order: 3, requires: ['act1-ch02'], teacher: 'hana', belt: 'yellow' }),
    makeChapter({ id: 'act2-ch04', act: 2, order: 1, requires: ['act1-ch03'], teacher: 'ara' }),
  ];
}
