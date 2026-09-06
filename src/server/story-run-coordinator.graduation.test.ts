import { describe, expect, it } from 'vitest';
import { generateDrill } from '@/lib/story/drills/generator';
import type { DrillAnswer } from '@/lib/story/drills/types';
import { curriculumFor, makeChapter, makeScene, makeTable } from '@/lib/story/test-fixtures';
import type { Chapter, Scene, StoryTeacherId } from '@/lib/story/types';
import { BLACK_BELT_FLAG } from '@/lib/story/unlocks';
import { GRADUATION_CHAMPION_FLAG } from '@/lib/story/rewards/catalog';
import type { StoryRunView } from '@/lib/story/views';
import type { LiveEnterInput, LiveStepSummary, StoryLiveEvents } from './story-live-adapter';
import {
  StoryRunCoordinator,
  type StoryAttemptInput,
  type StoryChapterCompleteAtomicInput,
  type StoryGraduationReceipt,
  type StoryLiveAdapterPort,
  type StoryProgressRecord,
  type StoryRepositoryPort,
  type StoryReviewNoteRecord,
  type StoryRewardPort,
} from './story-run-coordinator';

/**
 * Ch12 졸업 모드 회귀 — 순위 통과·선저장·원자 결산·모드별 보상.
 *
 * 계약:
 *  ① 통과는 **엔진이 확정한 순위**만 본다. 순위 없이 끝나면 완료 기록도 보상도 없다.
 *  ② 순위 영수증은 **에필로그 전에** 한 번 고정·저장되고 실패하면 'persist' hold로 재시도한다.
 *  ③ 검은띠는 4막 전체 완주 ∧ ITM 플래그 — 플래그만으로 오르지 않는다.
 *  ④ '졸업 대결만 재도전'은 완료 횟수·XP·인연을 늘리지 않고 영수증만 남긴다.
 */

const PROFILE = 'grad-hero';
const NOW = Date.UTC(2026, 8, 6, 3, 0, 0);
const TOURNAMENT = { id: 'graduation-sng-v1', sngStructureId: 'graduation' } as const;

function epilogue(id: string, requiresFlags: Record<string, string>): Chapter['steps'][number] {
  const scene: Scene = { ...makeScene(id), requiresFlags };
  return { kind: 'scene', id, graduation: 'epilogue', scene };
}

function graduationChapter(): Chapter {
  return {
    id: 'act4-ch12',
    act: 4,
    order: 3,
    title: '졸업 시험',
    subtitle: '실제 6인 Sit & Go',
    teacher: 'miyako',
    belt: 'black',
    requires: [],
    examDisabled: true,
    graduation: true,
    estimatedMinutes: 35,
    steps: [
      { kind: 'scene', id: 'ch12-intro', scene: makeScene('ch12-intro') },
      {
        kind: 'drill-set',
        id: 'ch12-drills',
        title: '졸업 문제',
        teacher: 'miyako',
        drills: [{ templateId: 'sng-stack-bb', seedPolicy: 'fixed', fixedSeed: 11 }],
        hintPenalty: 0.5,
      },
      {
        kind: 'sparring',
        id: 'ch12-graduation',
        tag: '대결',
        table: { ...makeTable({ turnTimeSec: 30, botThinkScale: 0.5 }), tournament: TOURNAMENT },
        maxHands: 400,
        objectives: { primary: [], bonus: [] },
        interrupts: [],
      },
      epilogue('ch12-ep-out', { 'graduation:outcome': 'out' }),
      epilogue('ch12-ep-itm', { 'graduation:outcome': 'itm' }),
      epilogue('ch12-ep-champion', { 'graduation:outcome': 'champion' }),
      epilogue('ch12-ep-sakura', { partner: 'sakura' }),
      epilogue('ch12-ep-ara', { partner: 'ara' }),
      { kind: 'result', id: 'ch12-result' },
    ],
    rewards: {
      first: { dojoXpMilli: 500_000, affinity: [{ target: 'all', milli: 30_000 }], badgeId: 'story-title-graduate' },
      replay: { dojoXpMilli: 50_000 },
      gradeBonusMilli: { A: 50_000, S: 120_000 },
    },
  };
}

function chapterSet(): Chapter[] {
  return [
    makeChapter({ id: 'act1-ch01', act: 1, order: 1 }),
    makeChapter({ id: 'act2-ch04', act: 2, order: 1 }),
    makeChapter({ id: 'act3-ch07', act: 3, order: 1 }),
    makeChapter({ id: 'act4-ch10', act: 4, order: 1 }),
    makeChapter({ id: 'act4-ch11', act: 4, order: 2 }),
    graduationChapter(),
  ];
}

class FakeRepository implements StoryRepositoryPort {
  rows: StoryProgressRecord[] = [];
  flags: Record<string, string> = {};
  attempts: StoryAttemptInput[] = [];
  completions: string[] = [];

  listProgress(): StoryProgressRecord[] {
    return this.rows.map(row => ({ ...row }));
  }

  recordAttemptStart(_profileId: string, chapterId: string, now: number): void {
    const row = this.rows.find(candidate => candidate.chapterId === chapterId);
    if (row) row.attempts += 1;
    else this.rows.push({ chapterId, attempts: 1, completions: 0, bestGrade: null, firstCompletedAt: null, lastPlayedAt: now });
  }

  recordCompletion(_profileId: string, chapterId: string, grade: 'S' | 'A' | 'B', now: number): void {
    this.completions.push(chapterId);
    const row = this.rows.find(candidate => candidate.chapterId === chapterId);
    if (row) {
      row.completions += 1;
      row.bestGrade = row.bestGrade ?? grade;
      row.firstCompletedAt = row.firstCompletedAt ?? now;
    } else {
      this.rows.push({ chapterId, attempts: 1, completions: 1, bestGrade: grade, firstCompletedAt: now, lastPlayedAt: now });
    }
  }

  markCompleted(chapterId: string): void {
    this.recordCompletion(PROFILE, chapterId, 'B', NOW);
  }

  getFlags(): Record<string, string> {
    return { ...this.flags };
  }

  setFlags(_profileId: string, flags: Record<string, string>): void {
    this.flags = { ...this.flags, ...flags };
  }

  getDrillStats() {
    return { total: this.attempts.length, correct: this.attempts.filter(a => a.correct).length, byCategory: {} };
  }

  insertAttempt(input: StoryAttemptInput): void {
    this.attempts.push(input);
  }

  markWrong(): void {}
  markCorrect(): 'none' { return 'none'; }
  listDue(): StoryReviewNoteRecord[] { return []; }
  listAll(): StoryReviewNoteRecord[] { return []; }
  countNotes(): number { return 0; }
  countAttemptsBetween(): number { return 0; }
}

class FakeRewards implements StoryRewardPort {
  atomic: StoryChapterCompleteAtomicInput[] = [];
  receipts: StoryGraduationReceipt[] = [];
  reconciles = 0;
  /** 다음 호출에서 던질 오류 — 저장 실패 복구 시나리오 */
  failGraduation = 0;
  failAtomic = 0;
  failReconcile = 0;
  /** 실제 영속을 흉내내는 완료 이벤트 집합 (run 단위 멱등) */
  private events = new Set<string>();

  constructor(private readonly repository: FakeRepository) {}

  completeChapter(): { duplicate: boolean } {
    throw new Error('atomic port must be used');
  }

  completeDaily() {
    return { duplicate: false };
  }

  recordGraduation(profileId: string, receipt: StoryGraduationReceipt) {
    if (this.failGraduation > 0) {
      this.failGraduation -= 1;
      throw new Error('graduation persistence failed');
    }
    const existing = this.receipts.find(candidate => candidate.runId === receipt.runId);
    if (existing) {
      if (existing.place !== receipt.place) throw new Error('STORY_GRADUATION_CONFLICT');
      return { status: 'duplicate' as const };
    }
    this.receipts.push(receipt);
    if (receipt.place <= 3) this.repository.setFlags(profileId, { [BLACK_BELT_FLAG]: '1' });
    if (receipt.place === 1) this.repository.setFlags(profileId, { [GRADUATION_CHAMPION_FLAG]: '1' });
    return { status: 'recorded' as const };
  }

  completeChapterAtomic(input: StoryChapterCompleteAtomicInput) {
    if (this.failAtomic > 0) {
      this.failAtomic -= 1;
      throw new Error('completion transaction failed');
    }
    this.atomic.push(input);
    const key = input.firstClear
      ? `first:${input.chapterId}`
      : `run:${input.chapterId}:${input.runId}`;
    if (this.events.has(key)) return { duplicate: true };
    this.events.add(key);
    this.repository.recordCompletion(input.profileId, input.chapterId, input.grade, input.completedAt);
    this.repository.setFlags(input.profileId, input.flags);
    if (input.graduation) this.recordGraduation(input.profileId, input.graduation);
    return { duplicate: false, affinityTransitions: [] };
  }

  reconcile() {
    if (this.failReconcile > 0) {
      this.failReconcile -= 1;
      throw new Error('reconcile failed');
    }
    this.reconciles += 1;
    return { granted: [], chips: 0 };
  }

  preview() {
    return [];
  }
}

interface FakeLiveState { profileId: string; runId: string; stepIndex: number }

function makeFakeAdapter() {
  let events: StoryLiveEvents | null = null;
  const enters: LiveEnterInput[] = [];
  let state: FakeLiveState | null = null;
  const adapter: StoryLiveAdapterPort = {
    answerQuiz: () => ({ ok: false, code: 'action-rejected', message: 'no quiz' }),
    hasSession: () => state !== null,
    bindEvents: bound => { events = bound; },
    enter: input => {
      enters.push(input);
      state = { profileId: input.profileId, runId: input.runId, stepIndex: input.stepIndex };
      return 'entered';
    },
    resume: () => ({ ok: true }),
    abandon: () => { state = null; return true; },
    forceFinish: () => 'no-session',
    phase: () => (state ? 'live-play' : null),
    view: () => (state
      ? {
        roomId: `room-${state.stepIndex}`, tag: '대결', hold: false, holdReason: null, interruptId: null,
        objectives: [], handsPlayed: 12, maxHands: 400, minHands: null, lastReview: null,
        botThoughts: [], pendingQuiz: null,
      }
      : null),
  };
  return {
    adapter,
    enters,
    finish: (place: number | null, source: 'play' | 'operator-skip' = 'play') => {
      const finished = state!;
      state = null;
      const summary: LiveStepSummary = {
        outcome: place === null ? 'abandoned' : 'done',
        tag: '대결',
        objectives: [],
        primaryObjectivesMet: null,
        liveScore: null,
        handsPlayed: 18,
        netBB: 0,
        ...(place === null ? {} : { tournament: { place, entrants: 6, source } }),
      };
      events?.onStepFinished(finished.profileId, finished.runId, summary);
    },
  };
}

function setup(partner: 'sakura' | 'ara' = 'sakura') {
  const chapters = chapterSet();
  const repository = new FakeRepository();
  const rewards = new FakeRewards(repository);
  const emitted: StoryRunView[] = [];
  const live = makeFakeAdapter();
  let counter = 0;
  const coordinator = new StoryRunCoordinator({
    repository,
    rewards,
    chapters,
    curriculum: curriculumFor(chapters),
    now: () => NOW,
    emit: (_profileId, view) => emitted.push(view),
    partnerOf: () => partner,
    runIdFactory: () => `run-${++counter}`,
  });
  coordinator.setLiveAdapter(live.adapter);
  return { chapters, repository, rewards, coordinator, emitted, live, latest: () => emitted.at(-1)! };
}

/** 씬 → 드릴 정답 → 스파링 진입까지 (full 모드) */
function playToSparring(ctx: ReturnType<typeof setup>): void {
  const started = ctx.coordinator.start(PROFILE, 'act4-ch12');
  expect(started.ok).toBe(true);
  // intro 씬
  expect(ctx.latest().stepKind).toBe('scene');
  ctx.coordinator.advance(PROFILE, { runId: ctx.latest().runId, expectedStepIndex: ctx.latest().stepIndex, target: 'next' });
  // 드릴 1문
  const drillView = ctx.latest();
  expect(drillView.stepKind).toBe('drill-set');
  const answer = correctAnswer(drillView.drill!.instance.templateId, drillView.drill!.instance.seed, drillView.context.teacherId);
  ctx.coordinator.drill(PROFILE, {
    runId: drillView.runId, setId: drillView.drill!.setId, index: drillView.drill!.index,
    action: 'answer', answer, elapsedMs: 1_000,
  });
  ctx.coordinator.advance(PROFILE, { runId: drillView.runId, expectedStepIndex: drillView.stepIndex, target: 'next' });
  expect(ctx.latest().stepKind).toBe('sparring');
}

function correctAnswer(templateId: string, seed: number, teacher: StoryTeacherId): DrillAnswer {
  const spec = generateDrill(templateId, seed, { teacher }).answerSpec;
  switch (spec.kind) {
    case 'multiple-choice': return { kind: 'multiple-choice', index: spec.correctIndex };
    case 'numeric': return { kind: 'numeric', value: spec.correct };
    case 'action-pick': return { kind: 'action-pick', action: spec.correct[0], sizingBB: spec.sizingBB?.min };
    case 'card-pick': return { kind: 'card-pick', cards: spec.correct };
    case 'multi-select': return { kind: 'multi-select', indices: spec.correctIndices };
  }
}

/** 에필로그 씬을 끝까지 넘기고 결산을 확정한다 */
function finishRun(ctx: ReturnType<typeof setup>): { epilogueIds: string[] } {
  const epilogueIds: string[] = [];
  for (let guard = 0; guard < 12; guard += 1) {
    const view = ctx.latest();
    if (view.phase === 'ended') break;
    if (view.stepKind === 'scene') {
      epilogueIds.push(ctx.chapters.find(c => c.id === 'act4-ch12')!.steps[view.stepIndex].id);
    }
    const advanced = ctx.coordinator.advance(PROFILE, { runId: view.runId, expectedStepIndex: view.stepIndex, target: 'next' });
    if (!advanced.ok) break;
  }
  return { epilogueIds };
}

describe('Ch12 졸업 런', () => {
  it('full 첫 완주는 순위 영수증을 에필로그 전에 저장하고 완료·XP를 한 번에 커밋한다', () => {
    const ctx = setup();
    playToSparring(ctx);
    ctx.live.finish(2);

    // 에필로그 진입 시점에 이미 영수증이 저장돼 있다
    expect(ctx.rewards.receipts).toEqual([
      { runId: 'run-1', place: 2, entrants: 6, mode: 'full', source: 'play', finishedAt: NOW },
    ]);
    expect(ctx.rewards.atomic).toHaveLength(0);
    expect(ctx.repository.flags[BLACK_BELT_FLAG]).toBe('1');

    finishRun(ctx);
    const result = ctx.latest().result!;
    expect(result.passed).toBe(true);
    expect(result.graduation).toEqual({
      place: 2, entrants: 6, itm: true, champion: false, blackBelt: false, mode: 'full',
    });
    expect(ctx.rewards.atomic).toHaveLength(1);
    expect(ctx.rewards.atomic[0]).toMatchObject({ firstClear: true, dojoXpMilli: 500_000 + 120_000 });
    expect(ctx.rewards.atomic[0].graduation).toMatchObject({ runId: 'run-1', place: 2 });
    expect(ctx.repository.completions).toEqual(['act4-ch12']);
    expect(result.rewards.affinity.length).toBeGreaterThan(0);
  });

  it('4~6위도 통과하지만 검은띠 자격은 없다', () => {
    const ctx = setup();
    playToSparring(ctx);
    ctx.live.finish(5);
    finishRun(ctx);
    const result = ctx.latest().result!;
    expect(result.passed).toBe(true);
    expect(result.graduation).toMatchObject({ place: 5, itm: false, champion: false, blackBelt: false });
    expect(ctx.repository.flags[BLACK_BELT_FLAG]).toBeUndefined();
    expect(result.beltAwarded).toBeNull();
  });

  it('ITM이어도 4막을 다 마치지 않았으면 띠가 오르지 않는다', () => {
    const ctx = setup();
    for (const id of ['act1-ch01', 'act2-ch04', 'act3-ch07']) ctx.repository.markCompleted(id);
    playToSparring(ctx);
    ctx.live.finish(1);
    finishRun(ctx);
    const result = ctx.latest().result!;
    expect(result.graduation).toMatchObject({ champion: true, blackBelt: false });
    expect(result.beltAwarded).toBeNull();
  });

  it('4막을 모두 마치고 ITM이면 검은띠로 승급한다', () => {
    const ctx = setup();
    for (const id of ['act1-ch01', 'act2-ch04', 'act3-ch07', 'act4-ch10', 'act4-ch11']) ctx.repository.markCompleted(id);
    playToSparring(ctx);
    ctx.live.finish(3);
    finishRun(ctx);
    const result = ctx.latest().result!;
    expect(result.graduation).toMatchObject({ place: 3, itm: true, blackBelt: true });
    expect(result.beltAwarded).toBe('black');
  });

  it('순위 없이 끝나면 완료 기록도 보상도 없다', () => {
    const ctx = setup();
    playToSparring(ctx);
    ctx.live.finish(null);
    const view = ctx.latest();
    expect(view.phase).toBe('ended');
    expect(view.result!.passed).toBe(false);
    expect(view.result!.graduation).toBeUndefined();
    expect(ctx.repository.completions).toEqual([]);
    expect(ctx.rewards.receipts).toEqual([]);
    expect(ctx.rewards.atomic).toEqual([]);
  });

  it('영수증 저장 실패는 persist hold로 잡고 [다시 시도]가 같은 값으로 재커밋한다', () => {
    const ctx = setup();
    playToSparring(ctx);
    ctx.rewards.failGraduation = 1;
    ctx.live.finish(1);

    const held = ctx.latest();
    expect(held.phase).toBe('live-hold');
    expect(held.live).toMatchObject({ hold: true, holdReason: 'persist', roomId: null });
    expect(held.live!.tournament).toMatchObject({ heroPlace: 1, entrants: 6 });
    expect(ctx.rewards.receipts).toEqual([]);

    const retried = ctx.coordinator.advance(PROFILE, { runId: held.runId, expectedStepIndex: held.stepIndex, target: 'resume' });
    expect(retried.ok).toBe(true);
    expect(ctx.rewards.receipts).toEqual([
      { runId: 'run-1', place: 1, entrants: 6, mode: 'full', source: 'play', finishedAt: NOW },
    ]);
    expect(ctx.latest().stepKind).toBe('scene');
  });

  it('결산 트랜잭션 실패는 결과를 만들지 않고, 재시도는 완료 1회·XP 1회로 끝난다', () => {
    const ctx = setup();
    playToSparring(ctx);
    ctx.live.finish(2);
    // 에필로그를 모두 넘겨 결산 스텝까지
    for (let guard = 0; guard < 12 && ctx.latest().stepKind === 'scene'; guard += 1) {
      const view = ctx.latest();
      ctx.coordinator.advance(PROFILE, { runId: view.runId, expectedStepIndex: view.stepIndex, target: 'next' });
    }
    const resultStep = ctx.latest();
    expect(resultStep.stepKind).toBe('result');

    ctx.rewards.failAtomic = 1;
    const failed = ctx.coordinator.advance(PROFILE, { runId: resultStep.runId, expectedStepIndex: resultStep.stepIndex, target: 'next' });
    expect(failed).toMatchObject({ ok: false, code: 'server-error' });
    expect(ctx.latest().result).toBeNull();
    expect(ctx.repository.completions).toEqual([]);

    const retried = ctx.coordinator.advance(PROFILE, { runId: resultStep.runId, expectedStepIndex: resultStep.stepIndex, target: 'next' });
    expect(retried.ok).toBe(true);
    expect(ctx.repository.completions).toEqual(['act4-ch12']);
    expect(ctx.rewards.atomic).toHaveLength(1);
    expect(ctx.latest().result!.passed).toBe(true);
  });

  it('커밋 뒤 reconcile 실패도 재시도에서 완료·XP를 다시 늘리지 않는다', () => {
    const ctx = setup();
    playToSparring(ctx);
    ctx.live.finish(2);
    for (let guard = 0; guard < 12 && ctx.latest().stepKind === 'scene'; guard += 1) {
      const view = ctx.latest();
      ctx.coordinator.advance(PROFILE, { runId: view.runId, expectedStepIndex: view.stepIndex, target: 'next' });
    }
    const resultStep = ctx.latest();
    ctx.rewards.failReconcile = 1;
    expect(ctx.coordinator.advance(PROFILE, { runId: resultStep.runId, expectedStepIndex: resultStep.stepIndex, target: 'next' }))
      .toMatchObject({ ok: false, code: 'server-error' });
    expect(ctx.repository.completions).toEqual(['act4-ch12']);

    expect(ctx.coordinator.advance(PROFILE, { runId: resultStep.runId, expectedStepIndex: resultStep.stepIndex, target: 'next' }).ok).toBe(true);
    // 완료·XP 이벤트는 한 번뿐 (재시도는 duplicate 경로)
    expect(ctx.repository.completions).toEqual(['act4-ch12']);
    expect(ctx.rewards.atomic).toHaveLength(2);
    expect(ctx.latest().result!.rewards.dojoXpMilli).toBe(0);
  });

  it('에필로그는 순위 결과와 파트너로 분기한다', () => {
    const ctx = setup('ara');
    playToSparring(ctx);
    ctx.live.finish(1);
    const { epilogueIds } = finishRun(ctx);
    expect(epilogueIds).toEqual(['ch12-ep-champion', 'ch12-ep-ara']);
  });

  it('4위 밖 결과는 out 에필로그로 간다', () => {
    const ctx = setup();
    playToSparring(ctx);
    ctx.live.finish(6);
    const { epilogueIds } = finishRun(ctx);
    expect(epilogueIds).toEqual(['ch12-ep-out', 'ch12-ep-sakura']);
  });
});

describe('졸업 대결만 재도전', () => {
  function completeOnce(ctx: ReturnType<typeof setup>, place = 4): void {
    playToSparring(ctx);
    ctx.live.finish(place);
    finishRun(ctx);
    ctx.coordinator.abandon(PROFILE, ctx.latest().runId);
  }

  it('완주 전에는 열리지 않고, 실력 확인도 거절한다', () => {
    const ctx = setup();
    expect(ctx.coordinator.start(PROFILE, 'act4-ch12', 'graduation'))
      .toMatchObject({ ok: false, code: 'story-locked' });
    expect(ctx.coordinator.start(PROFILE, 'act4-ch12', 'exam'))
      .toMatchObject({ ok: false, code: 'action-rejected' });
  });

  it('진행 중인 테이블 세션이 있으면 거절한다', () => {
    const ctx = setup();
    completeOnce(ctx);
    // 어댑터 세션이 남아 있는 상태를 흉내낸다
    ctx.live.adapter.enter({
      profileId: PROFILE, runId: 'ghost', chapterId: 'act4-ch12', chapterTitle: '졸업 시험',
      stepIndex: 2, step: ctx.chapters.find(c => c.id === 'act4-ch12')!.steps[2] as never, partnerId: 'sakura',
    });
    expect(ctx.coordinator.start(PROFILE, 'act4-ch12', 'graduation'))
      .toMatchObject({ ok: false, code: 'story-busy' });
  });

  it('드릴·수업을 건너뛰고 순위 영수증만 남긴다 (완료 횟수·XP·인연 불변)', () => {
    const ctx = setup();
    completeOnce(ctx);
    const completionsBefore = ctx.repository.rows.find(row => row.chapterId === 'act4-ch12')!.completions;
    const atomicBefore = ctx.rewards.atomic.length;

    const started = ctx.coordinator.start(PROFILE, 'act4-ch12', 'graduation');
    expect(started.ok).toBe(true);
    // 첫 진입이 곧 토너먼트 스파링 (씬·드릴 스킵)
    expect(ctx.latest().stepKind).toBe('sparring');
    expect(ctx.latest().drill).toBeNull();
    ctx.live.finish(1);
    finishRun(ctx);

    const result = ctx.latest().result!;
    expect(result.graduation).toMatchObject({ place: 1, champion: true, mode: 'graduation' });
    expect(result.rewards.dojoXpMilli).toBe(0);
    expect(result.rewards.affinity).toEqual([]);
    expect(result.rewards.chips).toBe(0);
    expect(ctx.rewards.atomic).toHaveLength(atomicBefore);
    expect(ctx.repository.rows.find(row => row.chapterId === 'act4-ch12')!.completions).toBe(completionsBefore);
    expect(ctx.rewards.receipts.map(item => item.mode)).toEqual(['full', 'graduation']);
    expect(ctx.repository.flags[GRADUATION_CHAMPION_FLAG]).toBe('1');
  });

  it('운영자 스킵 출처는 영수증 source로 남고 모드는 실제 런 모드다', () => {
    const ctx = setup();
    completeOnce(ctx);
    ctx.coordinator.start(PROFILE, 'act4-ch12', 'graduation');
    ctx.live.finish(1, 'operator-skip');
    expect(ctx.rewards.receipts.at(-1)).toMatchObject({ mode: 'graduation', source: 'operator-skip' });
  });
});

describe('기존 챕터는 씬 분기의 영향을 받지 않는다', () => {
  it('requiresFlags가 없는 씬은 언제나 진입한다', () => {
    const ctx = setup();
    const started = ctx.coordinator.start(PROFILE, 'act1-ch01');
    expect(started.ok).toBe(true);
    expect(ctx.latest()).toMatchObject({ stepIndex: 0, stepKind: 'scene', phase: 'scene' });
  });
});
