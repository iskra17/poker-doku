/**
 * StoryRunCoordinator — 스토리 런(챕터 1회 주행·오늘의 수련)의 서버 상태 머신. **방(RoomManager)과 무관**하다.
 *
 * - runs: profileId당 최대 1개 런(인메모리). 서버 재시작이면 런은 사라지고 허브가
 *   "중단된 챕터 다시 도전"을 보여준다 — attempts·drill_attempts·복습 노트는 즉시 영속이라 유실 없음.
 * - 스텝 진입: scene/lesson은 클라 렌더(데이터는 클라도 가진 STORY_CHAPTERS), drill-set은 드릴 생성기가
 *   같은 seed로 인스턴스를 만들고 **채점도 서버가 재생성해서** 한다(클라 DTO엔 정답 없음).
 *   practice-table/sparring은 라이브 어댑터(`setLiveAdapter`, Phase 1b)가 없으면 스킵된다. 어댑터가 있으면
 *   `enter()`로 방을 열고, 스텝 종료는 어댑터가 `onStepFinished`로 알린다(방 해체 후) — 코디네이터는 방을 모른다.
 * - 모든 명령은 (runId, expectedStepIndex) 또는 (setId, index) stale 검사를 통과해야 한다
 *   (`player-action`의 expectedHandNumber 계약과 동형 → 'stale-state').
 * - 성공한 명령마다 `emit(profileId, view)`로 story-update를 보낸다.
 */
import { hashSeed } from '../lib/poker/seeded-rng';
import type { RealtimeErrorCode } from '../lib/realtime/protocol';
import { STORY_CHAPTERS } from '../lib/story/chapters';
import { DrillGenerationError, generateDrill, getDrillTemplate, gradeDrill } from '../lib/story/drills/generator';
import { toPublicDrillInstance } from '../lib/story/drills/public';
import type { DrillInstance, DrillResult } from '../lib/story/drills/types';
import { chapterPassed, examPassed, firstClearRewards, gradeChapter, replayRewards, scoreDrillSet, type DrillSlotOutcome } from '../lib/story/grading';
import type {
  Chapter,
  ChapterGrade,
  ChapterId,
  DrillSlot,
  Step,
  StoryHeroineId,
  StoryTeacherId,
} from '../lib/story/types';
import { LIVE_STEP_KINDS, isStoryHeroineId } from '../lib/story/types';
import { BLACK_BELT_FLAG, computeUnlockedChapters, deriveBelt, isChapterUnlocked, nextChapter } from '../lib/story/unlocks';
import type {
  ChapterResultView,
  StoryAdvanceRequest,
  StoryChoiceRequest,
  StoryDrillRequest,
  StoryDrillView,
  StoryLiveView,
  StoryProgressView,
  StoryRunPhase,
  StoryRunView,
  StoryRunMode,
} from '../lib/story/views';
import type { LiveCommandResult, LiveEnterInput, LiveStepSummary, StoryLiveEvents } from './story-live-adapter';

/** 라이브 스텝 어댑터 포트 — LiveTableAdapter가 구현 (테스트는 fake) */
export interface StoryLiveAdapterPort {
  enter(input: LiveEnterInput): 'entered' | 'unavailable';
  resume(profileId: string, runId: string): LiveCommandResult;
  /** false = 방을 아직 닫을 수 없음(정산 미해결) — 런을 지우지 말고 재시도 안내 */
  abandon(profileId: string): boolean;
  phase(profileId: string): 'live-hold' | 'live-play' | null;
  view(profileId: string): StoryLiveView | null;
  bindEvents(events: StoryLiveEvents): void;
}

// ---------------------------------------------------------------------------
// 포트

export interface StoryProgressRecord {
  chapterId: ChapterId;
  attempts: number;
  completions: number;
  bestGrade: ChapterGrade | null;
  firstCompletedAt: number | null;
  lastPlayedAt: number;
}

export interface StoryDrillStatsRecord {
  total: number;
  correct: number;
  byCategory: Record<string, { total: number; correct: number }>;
}

export type StoryAttemptContext = 'chapter' | 'review' | 'daily' | 'hand-review';

export interface StoryAttemptInput {
  profileId: string;
  templateId: string;
  seed: number;
  category: string;
  context: StoryAttemptContext;
  chapterId?: string | null;
  runId?: string | null;
  correct: boolean;
  hintsUsed?: number;
  elapsedMs: number;
  answeredAt: number;
}

export interface StoryReviewNoteRecord {
  templateId: string;
  seed: number;
  box: 1 | 2 | 3;
  dueAt: number;
}

/** 코디네이터가 필요로 하는 영속 포트 — StoryRepository가 구현한다 (테스트는 인메모리 fake). */
export interface StoryRepositoryPort {
  listProgress(profileId: string): StoryProgressRecord[];
  recordAttemptStart(profileId: string, chapterId: ChapterId, now: number): void;
  recordCompletion(profileId: string, chapterId: ChapterId, grade: ChapterGrade, now: number): unknown;
  getFlags(profileId: string): Record<string, string>;
  setFlags(profileId: string, flags: Record<string, string>, now: number): void;
  getDrillStats(profileId: string): StoryDrillStatsRecord;
  insertAttempt(input: StoryAttemptInput): unknown;
  markWrong(profileId: string, templateId: string, seed: number, now: number): unknown;
  markCorrect(profileId: string, templateId: string, seed: number, now: number): unknown;
  listDue(profileId: string, now: number, limit: number): StoryReviewNoteRecord[];
  countNotes(profileId: string): number;
  countAttemptsBetween(profileId: string, fromMs: number, toMsExclusive: number, context?: StoryAttemptContext): number;
}

/** 보상 포트 — ProgressionRuntime이 구현 (없으면 XP 없이 진행: 테스트·비활성 환경) */
export interface StoryRewardPort {
  completeChapter(input: {
    profileId: string;
    chapterId: ChapterId;
    runId: string;
    firstClear: boolean;
    grade: ChapterGrade;
    dojoXpMilli: number;
    affinity: Array<{ characterId: StoryHeroineId; milli: number }>;
    completedAt: number;
  }): { duplicate: boolean };
  completeDaily(input: { profileId: string; kstDate: string; teacherId: StoryHeroineId; completedAt: number }): { duplicate: boolean };
}

export interface StoryRunCoordinatorDeps {
  repository: StoryRepositoryPort;
  emit: (profileId: string, view: StoryRunView) => void;
  /** 선택 파트너(인연) — 없으면 null: 'partner' 참조는 미야코로 대체된다 */
  partnerOf: (profileId: string) => StoryHeroineId | null;
  rewards?: StoryRewardPort;
  chapters?: readonly Chapter[];
  now?: () => number;
  runIdFactory?: () => string;
  /** 오늘의 수련 문제 수 (기본 3) */
  dailyTotal?: number;
  /** 오답 재출제 상한 (기본 2) */
  maxRetries?: number;
}

export type CoordinatorResult<T = undefined> =
  | { ok: true; value: T }
  | { ok: false; code: RealtimeErrorCode; message: string };

// ---------------------------------------------------------------------------
// 런 상태

interface DrillServe {
  slotIndex: number;
  templateId: string;
  seed: number;
  attempt: number;
}

interface DrillSetState {
  setId: string;
  teacher: StoryTeacherId;
  slots: DrillSlot[];
  queue: DrillServe[];
  cursor: number;
  passRule: { minCorrect: number };
  hintPenalty: number;
  /** 슬롯별 결과(첫 시도·최종) */
  outcomes: Map<number, DrillSlotOutcome & { attempts: number }>;
  streak: number;
  bestStreak: number;
  hintsUsed: number;
  answered: number;
  correct: number;
  current: {
    serve: DrillServe;
    instance: DrillInstance;
    hintOpened: boolean;
    result: DrillResult | null;
    servedAt: number;
  } | null;
  context: StoryAttemptContext;
}

export interface StoryRun {
  runId: string;
  kind: 'chapter' | 'daily';
  /** 'exam' = 실력 확인(드릴 세트 + 결산만, 힌트 없음, EXAM_PASS_SCORE 이상 통과) */
  mode: StoryRunMode;
  profileId: string;
  chapter: Chapter;
  stepIndex: number;
  phase: StoryRunPhase;
  partnerId: StoryHeroineId | null;
  choices: Record<string, string>;
  flagsDelta: Record<string, string>;
  drill: DrillSetState | null;
  /** 챕터 전체 드릴 요약(세트가 여러 개일 수 있음) */
  drillSummary: { outcomes: DrillSlotOutcome[]; hintsUsed: number; bestStreak: number; answered: number; correct: number; hintPenalty: number; wrongSlots: number };
  result: ChapterResultView | null;
  /** 끝난 라이브 스텝 요약(순서대로) — 스파링('대결')만 통과·등급에 반영된다 */
  liveResults: LiveStepSummary[];
  /** 데일리 전용 — 출제 히로인·날짜 */
  daily: { kstDate: string; teacherId: StoryHeroineId | null } | null;
  startedAt: number;
  updatedAt: number;
}

const KST_OFFSET_MS = 9 * 60 * 60_000;
const DAY_MS = 24 * 60 * 60_000;
export const DAILY_CHAPTER_ID = 'daily';

/** KST 기준 날짜 키와 [자정, 다음 자정) 범위 */
export function kstDay(now: number): { date: string; fromMs: number; toMsExclusive: number } {
  const shifted = now + KST_OFFSET_MS;
  const dayStartShifted = Math.floor(shifted / DAY_MS) * DAY_MS;
  return {
    date: new Date(dayStartShifted).toISOString().slice(0, 10),
    fromMs: dayStartShifted - KST_OFFSET_MS,
    toMsExclusive: dayStartShifted - KST_OFFSET_MS + DAY_MS,
  };
}

let runCounter = 0;
function defaultRunId(): string {
  runCounter += 1;
  return `story_${Date.now().toString(36)}_${runCounter.toString(36)}`;
}

function emptySummary(hintPenalty = 0.5): StoryRun['drillSummary'] {
  return { outcomes: [], hintsUsed: 0, bestStreak: 0, answered: 0, correct: 0, hintPenalty, wrongSlots: 0 };
}

export class StoryRunCoordinator {
  private readonly runs = new Map<string, StoryRun>();
  private readonly chapters: readonly Chapter[];
  private readonly now: () => number;
  private readonly runIdFactory: () => string;
  private readonly dailyTotal: number;
  private readonly maxRetries: number;
  private liveAdapter: StoryLiveAdapterPort | null = null;

  constructor(private readonly deps: StoryRunCoordinatorDeps) {
    this.chapters = deps.chapters ?? STORY_CHAPTERS;
    this.now = deps.now ?? (() => Date.now());
    this.runIdFactory = deps.runIdFactory ?? defaultRunId;
    this.dailyTotal = deps.dailyTotal ?? 3;
    this.maxRetries = deps.maxRetries ?? 2;
  }

  /** 라이브 어댑터 연결 (생성 후 바인딩 — 어댑터는 RoomManager를, 코디네이터는 어댑터를 알지만 그 역은 이벤트로만) */
  setLiveAdapter(adapter: StoryLiveAdapterPort): void {
    this.liveAdapter = adapter;
    adapter.bindEvents({
      onStepFinished: (profileId, runId, summary) => this.completeLiveStep(profileId, runId, summary),
      onLiveChanged: profileId => this.refreshLive(profileId),
    });
  }

  // ---------------------------------------------------------------------------
  // 조회

  getProgress(profileId: string): StoryProgressView {
    const rows = this.deps.repository.listProgress(profileId);
    const byId = new Map(rows.map(row => [row.chapterId, row]));
    const completed = this.completedSet(rows);
    const unlocked = computeUnlockedChapters(this.chapters, completed);
    const flags = this.deps.repository.getFlags(profileId);
    const day = kstDay(this.now());
    const dailyAvailable = this.dailyAvailable(completed);
    const run = this.runs.get(profileId) ?? null;
    const dailyTeacher = dailyAvailable ? this.dailyTeacher(profileId, completed, day.date) : null;

    return {
      chapters: this.chapters.map(chapter => {
        const row = byId.get(chapter.id);
        return {
          chapterId: chapter.id,
          attempts: row?.attempts ?? 0,
          completions: row?.completions ?? 0,
          bestGrade: row?.bestGrade ?? null,
          unlocked: unlocked.has(chapter.id),
        };
      }),
      flags,
      belt: deriveBelt(this.chapters, completed, flags),
      nextChapterId: nextChapter(this.chapters, completed)?.id ?? null,
      drillStats: this.deps.repository.getDrillStats(profileId),
      reviewQueue: this.deps.repository.countNotes(profileId),
      daily: {
        date: day.date,
        done: dailyAvailable
          ? Math.min(this.dailyTotal, this.deps.repository.countAttemptsBetween(profileId, day.fromMs, day.toMsExclusive, 'daily'))
          : 0,
        total: this.dailyTotal,
        available: dailyAvailable,
        teacherId: dailyTeacher,
      },
      activeRun: run ? { runId: run.runId, chapterId: run.chapter.id, stepIndex: run.stepIndex, mode: run.mode } : null,
    };
  }

  getActiveRun(profileId: string): StoryRun | null {
    return this.runs.get(profileId) ?? null;
  }

  getView(profileId: string): StoryRunView | null {
    const run = this.runs.get(profileId);
    return run ? this.buildView(run) : null;
  }

  /** 재접속: 진행 중 런이 있으면 현재 뷰를 다시 보내고 true */
  resend(profileId: string): boolean {
    const run = this.runs.get(profileId);
    if (!run) return false;
    this.deps.emit(profileId, this.buildView(run));
    return true;
  }

  stats(): { runs: number } {
    return { runs: this.runs.size };
  }

  // ---------------------------------------------------------------------------
  // 명령: 시작 / 진행 / 선택 / 포기

  /**
   * 챕터 시작. mode 'exam'(실력 확인)은 미완료 챕터에서만 — 드릴 세트가 있어야 하고, 씬·레슨·라이브 스텝은
   * enterStep이 건너뛴다. 이미 완료한 챕터는 [다시](full)로만 재주행한다.
   */
  start(profileId: string, chapterId: ChapterId, mode: StoryRunMode = 'full'): CoordinatorResult<{ runId: string }> {
    if (this.runs.has(profileId)) {
      return { ok: false, code: 'story-busy', message: '진행 중인 챕터가 있어요. 이어서 하거나 포기한 뒤 시작할 수 있어요.' };
    }
    const chapter = this.chapters.find(candidate => candidate.id === chapterId);
    if (!chapter) {
      return { ok: false, code: 'story-locked', message: '없는 챕터예요.' };
    }
    const completed = this.completedSet(this.deps.repository.listProgress(profileId));
    if (!isChapterUnlocked(chapter, completed)) {
      return { ok: false, code: 'story-locked', message: '아직 열리지 않은 챕터예요. 이전 챕터를 먼저 끝내 주세요.' };
    }
    if (mode === 'exam') {
      if (!chapter.steps.some(step => step.kind === 'drill-set')) {
        return { ok: false, code: 'action-rejected', message: '이 챕터엔 실력 확인 문제가 없어요.' };
      }
      if (completed.has(chapter.id)) {
        return { ok: false, code: 'action-rejected', message: '이미 완료한 챕터예요. [다시]로 수업을 들을 수 있어요.' };
      }
    }
    const now = this.now();
    this.deps.repository.recordAttemptStart(profileId, chapter.id, now);
    const run: StoryRun = {
      runId: this.runIdFactory(),
      kind: 'chapter',
      mode,
      profileId,
      chapter,
      stepIndex: -1,
      phase: 'scene',
      partnerId: this.deps.partnerOf(profileId),
      choices: {},
      flagsDelta: {},
      drill: null,
      drillSummary: emptySummary(),
      result: null,
      liveResults: [],
      daily: null,
      startedAt: now,
      updatedAt: now,
    };
    this.runs.set(profileId, run);
    try {
      this.enterStep(run, 0);
    } catch (error) {
      this.runs.delete(profileId);
      this.liveAdapter?.abandon(profileId);
      return { ok: false, code: 'server-error', message: error instanceof Error ? error.message : '챕터를 시작하지 못했어요.' };
    }
    this.deps.emit(profileId, this.buildView(run));
    return { ok: true, value: { runId: run.runId } };
  }

  /** 오늘의 수련 문제 — 챕터 없는 경량 런(드릴 세트 1개 + 결산). 챕터 1개 이상 완료 후(출제 풀 = 완료 챕터의 드릴), 하루 1회 완료. */
  startDaily(profileId: string): CoordinatorResult<{ runId: string }> {
    if (this.runs.has(profileId)) {
      return { ok: false, code: 'story-busy', message: '진행 중인 챕터가 있어요. 먼저 끝내거나 포기해 주세요.' };
    }
    const rows = this.deps.repository.listProgress(profileId);
    const completed = this.completedSet(rows);
    if (!this.dailyAvailable(completed)) {
      return { ok: false, code: 'story-locked', message: '챕터를 하나 끝내면 오늘의 수련 문제가 열려요.' };
    }
    const now = this.now();
    const day = kstDay(now);
    if (this.deps.repository.countAttemptsBetween(profileId, day.fromMs, day.toMsExclusive, 'daily') >= this.dailyTotal) {
      return { ok: false, code: 'action-rejected', message: '오늘의 문제는 모두 풀었어요. 내일 다시 만나요.' };
    }
    const slots = this.buildDailySlots(profileId, completed, day.date, now);
    if (slots.length === 0) {
      return { ok: false, code: 'action-rejected', message: '아직 낼 문제가 없어요.' };
    }
    const teacherId = this.dailyTeacher(profileId, completed, day.date);
    const runId = this.runIdFactory();
    const chapter: Chapter = {
      id: DAILY_CHAPTER_ID,
      act: 1,
      order: 0,
      title: '오늘의 수련 문제',
      subtitle: `${day.date}`,
      teacher: teacherId ?? 'miyako',
      belt: 'white',
      requires: [],
      steps: [
        {
          kind: 'drill-set',
          id: `daily:${day.date}`,
          title: '오늘의 수련 문제',
          teacher: teacherId ?? 'miyako',
          drills: slots.map(slot => ({ templateId: slot.templateId, seedPolicy: 'fixed', fixedSeed: slot.seed })),
          passRule: { minCorrect: 0 },
          hintPenalty: 0.5,
        },
        { kind: 'result', id: `daily:${day.date}:result` },
      ],
      rewards: { first: { dojoXpMilli: 0, affinity: [] }, replay: { dojoXpMilli: 0 }, gradeBonusMilli: {} },
      estimatedMinutes: 2,
    };
    const run: StoryRun = {
      runId,
      kind: 'daily',
      mode: 'full',
      profileId,
      chapter,
      stepIndex: -1,
      phase: 'drill',
      partnerId: this.deps.partnerOf(profileId),
      choices: {},
      flagsDelta: {},
      drill: null,
      drillSummary: emptySummary(),
      result: null,
      liveResults: [],
      daily: { kstDate: day.date, teacherId },
      startedAt: now,
      updatedAt: now,
    };
    this.runs.set(profileId, run);
    try {
      this.enterStep(run, 0);
    } catch (error) {
      this.runs.delete(profileId);
      return { ok: false, code: 'server-error', message: error instanceof Error ? error.message : '문제를 준비하지 못했어요.' };
    }
    this.deps.emit(profileId, this.buildView(run));
    return { ok: true, value: { runId } };
  }

  advance(profileId: string, request: StoryAdvanceRequest): CoordinatorResult {
    const checked = this.checkRun(profileId, request.runId, request.expectedStepIndex);
    if (!checked.ok) return checked;
    const run = checked.value;
    const step = run.chapter.steps[run.stepIndex];
    switch (step.kind) {
      case 'scene':
      case 'lesson':
        this.enterStep(run, run.stepIndex + 1);
        break;
      case 'drill-set': {
        const drill = run.drill;
        if (!drill || !drill.current) {
          return { ok: false, code: 'action-rejected', message: '문제를 준비하는 중이에요.' };
        }
        if (!drill.current.result) {
          return { ok: false, code: 'action-rejected', message: '답을 제출해야 다음 문제로 넘어갈 수 있어요.' };
        }
        this.serveNext(run, drill);
        break;
      }
      case 'practice-table':
      case 'sparring': {
        // 라이브 스텝은 [계속하기]/「이어하기」(resume)만 — 진행·종료는 어댑터가 핸드 경계에서 결정한다
        if (!this.liveAdapter) {
          return { ok: false, code: 'action-rejected', message: '테이블 스텝은 아직 준비 중이에요.' };
        }
        if (request.target !== 'resume') {
          return { ok: false, code: 'action-rejected', message: '테이블 스텝은 [계속하기]로만 이어갈 수 있어요.' };
        }
        const resumed = this.liveAdapter.resume(profileId, run.runId);
        if (!resumed.ok) return resumed;
        run.phase = this.liveAdapter.phase(profileId) ?? 'live-play';
        run.updatedAt = this.now();
        break;
      }
      case 'result':
        this.finishRun(run);
        this.deps.emit(profileId, this.buildView(run));
        return { ok: true, value: undefined };
    }
    if (this.runs.has(profileId)) this.deps.emit(profileId, this.buildView(run));
    return { ok: true, value: undefined };
  }

  /** 선택지 — 정답 없음. 현재 씬에 존재하는 선택지/옵션이어야 하고, 플래그는 결산 때 한꺼번에 영속된다. */
  choose(profileId: string, request: StoryChoiceRequest): CoordinatorResult {
    const checked = this.checkRun(profileId, request.runId, request.expectedStepIndex);
    if (!checked.ok) return checked;
    const run = checked.value;
    const step = run.chapter.steps[run.stepIndex];
    const scene = step.kind === 'scene' ? step.scene : null;
    const choiceLine = scene?.lines.find(line => line.kind === 'choice' && line.choice.id === request.choiceId);
    const choice = choiceLine && choiceLine.kind === 'choice' ? choiceLine.choice : null;
    const option = choice?.options.find(candidate => candidate.id === request.optionId);
    if (!choice || !option) {
      return { ok: false, code: 'action-rejected', message: '이 장면에 없는 선택지예요.' };
    }
    run.choices[choice.id] = option.id;
    Object.assign(run.flagsDelta, option.setFlags ?? {});
    run.updatedAt = this.now();
    return { ok: true, value: undefined };
  }

  /** 드릴 답 제출 / 힌트 — 서버가 같은 seed로 재생성해 채점한다. */
  drill(profileId: string, request: StoryDrillRequest): CoordinatorResult<{ action: 'answer'; result: DrillResult } | { action: 'hint'; hint: string }> {
    const run = this.runs.get(profileId);
    if (!run) return { ok: false, code: 'story-no-run', message: '진행 중인 챕터가 없어요.' };
    const drill = run.drill;
    if (run.runId !== request.runId || !drill || run.phase !== 'drill' || !drill.current) {
      return { ok: false, code: 'stale-state', message: '지금은 문제를 푸는 단계가 아니에요.' };
    }
    if (drill.setId !== request.setId || drill.cursor !== request.index) {
      return { ok: false, code: 'stale-state', message: '화면이 최신 문제가 아니에요. 다시 불러올게요.' };
    }
    const current = drill.current;

    if (request.action === 'hint') {
      if (run.mode === 'exam') return { ok: false, code: 'action-rejected', message: '실력 확인에서는 힌트를 쓸 수 없어요.' };
      if (current.result) return { ok: false, code: 'action-rejected', message: '이미 답을 제출한 문제예요.' };
      const hint = current.instance.hint;
      if (!hint) return { ok: false, code: 'action-rejected', message: '이 문제엔 힌트가 없어요.' };
      if (!current.hintOpened) {
        current.hintOpened = true;
        drill.hintsUsed += 1;
        run.updatedAt = this.now();
        this.deps.emit(profileId, this.buildView(run));
      }
      return { ok: true, value: { action: 'hint', hint } };
    }

    if (current.result) return { ok: false, code: 'action-rejected', message: '이미 답을 제출한 문제예요.' };
    const now = this.now();
    // 권위 판정: 저장된 인스턴스가 아니라 같은 seed로 재생성한 인스턴스와 비교 (클라 DTO엔 정답이 없다)
    const regenerated = this.regenerate(current.serve, drill.teacher);
    const correct = gradeDrill(regenerated, request.answer);
    const hintsUsed = current.hintOpened ? 1 : 0;
    const elapsedMs = Math.max(0, Math.min(request.elapsedMs, now - current.servedAt + 60_000));

    this.deps.repository.insertAttempt({
      profileId,
      templateId: current.serve.templateId,
      seed: current.serve.seed,
      category: regenerated.category,
      context: drill.context,
      chapterId: run.kind === 'chapter' ? run.chapter.id : null,
      runId: run.runId,
      correct,
      hintsUsed,
      elapsedMs,
      answeredAt: now,
    });
    // 복습 노트(Leitner): 오답은 박스1로, 정답은 승격/졸업 — 재출제 문항(attempt>0)은 노트 갱신 대상에서 제외
    if (current.serve.attempt === 0) {
      if (correct) this.deps.repository.markCorrect(profileId, current.serve.templateId, current.serve.seed, now);
      else this.deps.repository.markWrong(profileId, current.serve.templateId, current.serve.seed, now);
    }

    const outcome = drill.outcomes.get(current.serve.slotIndex) ?? { firstCorrect: false, finallyCorrect: false, hintUsed: false, attempts: 0 };
    outcome.attempts += 1;
    if (current.serve.attempt === 0) {
      outcome.firstCorrect = correct;
      outcome.hintUsed = current.hintOpened;
    }
    if (correct) outcome.finallyCorrect = true;
    drill.outcomes.set(current.serve.slotIndex, outcome);
    drill.answered += 1;
    if (correct) {
      drill.correct += 1;
      drill.streak += 1;
      drill.bestStreak = Math.max(drill.bestStreak, drill.streak);
    } else {
      drill.streak = 0;
      if (current.serve.attempt < this.maxRetries) {
        drill.queue.push({
          slotIndex: current.serve.slotIndex,
          templateId: current.serve.templateId,
          seed: hashSeed(current.serve.seed, 'retry', current.serve.attempt + 1),
          attempt: current.serve.attempt + 1,
        });
      }
    }
    const result: DrillResult = {
      templateId: current.serve.templateId,
      seed: current.serve.seed,
      correct,
      correctAnswer: regenerated.answerSpec,
      explanation: regenerated.explanation,
      hintsUsed,
      streak: drill.streak,
      elapsedMs,
    };
    current.result = result;
    run.updatedAt = now;
    this.deps.emit(profileId, this.buildView(run));
    return { ok: true, value: { action: 'answer', result } };
  }

  abandon(profileId: string, runId: string): CoordinatorResult {
    const run = this.runs.get(profileId);
    if (!run) return { ok: false, code: 'story-no-run', message: '진행 중인 챕터가 없어요.' };
    if (run.runId !== runId) return { ok: false, code: 'stale-state', message: '이미 끝난 챕터 진행이에요.' };
    // 라이브 방이 열려 있으면 먼저 해체 (story-end — 소켓 계층이 세션 roomId를 비운다). 해체가 거절되면
    // (정산 미해결 재시도 중) 런을 지우지 않는다 — 소유자 없는 방이 남으면 소켓이 갇힌다
    if (this.liveAdapter && !this.liveAdapter.abandon(profileId)) {
      return { ok: false, code: 'server-error', message: '테이블 정리를 아직 마치지 못했어요. 잠시 후 다시 시도해 주세요.' };
    }
    this.runs.delete(profileId);
    run.phase = 'ended';
    run.result = null;
    this.deps.emit(profileId, this.buildView(run));
    return { ok: true, value: undefined };
  }

  /** 프로필 폐기·로그아웃 — 런을 조용히 버린다 (emit 없음) */
  clearProfile(profileId: string): void {
    this.runs.delete(profileId);
    this.liveAdapter?.abandon(profileId);
  }

  // ---------------------------------------------------------------------------
  // 라이브 어댑터 → 코디네이터 이벤트

  /** 라이브 스텝 종료(방은 이미 해체됨) — 요약을 쌓고 다음 스텝으로 */
  private completeLiveStep(profileId: string, runId: string, summary: LiveStepSummary): void {
    const run = this.runs.get(profileId);
    if (!run || run.runId !== runId) return;
    run.liveResults.push(summary);
    run.updatedAt = this.now();
    this.enterStep(run, run.stepIndex + 1);
    if (this.runs.has(profileId)) this.deps.emit(profileId, this.buildView(run));
  }

  /** hold/재개/목표 진행 등 — 현재 뷰 재전송 */
  private refreshLive(profileId: string): void {
    const run = this.runs.get(profileId);
    if (!run) return;
    const step = run.chapter.steps[run.stepIndex];
    if (!step || !LIVE_STEP_KINDS.has(step.kind)) return;
    run.phase = this.liveAdapter?.phase(profileId) ?? run.phase;
    run.updatedAt = this.now();
    this.deps.emit(profileId, this.buildView(run));
  }

  // ---------------------------------------------------------------------------
  // 내부: 스텝 진입 / 드릴 서빙

  private checkRun(profileId: string, runId: string, expectedStepIndex: number): CoordinatorResult<StoryRun> {
    const run = this.runs.get(profileId);
    if (!run) return { ok: false, code: 'story-no-run', message: '진행 중인 챕터가 없어요.' };
    if (run.runId !== runId || run.stepIndex !== expectedStepIndex) {
      return { ok: false, code: 'stale-state', message: '화면이 최신 상태가 아니에요. 다시 불러올게요.' };
    }
    return { ok: true, value: run };
  }

  /** 스텝 진입 — 엔진/어댑터가 없는 스텝은 다음으로 스킵한다. 마지막(result)에 닿으면 대기. */
  private enterStep(run: StoryRun, index: number): void {
    const steps = run.chapter.steps;
    let cursor = index;
    run.drill = null;
    while (cursor < steps.length) {
      const step = steps[cursor];
      // 실력 확인: 드릴 세트와 결산만 — 씬·레슨·라이브 스텝은 인덱스를 유지한 채 건너뛴다(클라는 stepIndex로 데이터를 찾는다)
      if (run.mode === 'exam' && step.kind !== 'drill-set' && step.kind !== 'result') {
        cursor += 1;
        continue;
      }
      run.stepIndex = cursor;
      run.updatedAt = this.now();
      if (step.kind === 'scene') { run.phase = 'scene'; return; }
      if (step.kind === 'lesson') { run.phase = 'lesson'; return; }
      if (step.kind === 'result') { run.phase = 'result'; return; }
      if (step.kind === 'drill-set') {
        if (this.enterDrillSet(run, step)) return;
        cursor += 1;
        continue;
      }
      // practice-table / sparring: 어댑터가 방을 열면 라이브 단계, 어댑터가 없거나 열지 못하면 스킵
      if (this.liveAdapter && run.kind === 'chapter') {
        const entered = this.liveAdapter.enter({
          profileId: run.profileId,
          runId: run.runId,
          chapterId: run.chapter.id,
          chapterTitle: run.chapter.title,
          stepIndex: cursor,
          step,
          partnerId: run.partnerId,
        });
        if (entered === 'entered') {
          run.phase = this.liveAdapter.phase(run.profileId) ?? 'live-play';
          return;
        }
      }
      cursor += 1;
    }
    run.stepIndex = steps.length - 1;
    run.phase = 'result';
  }

  private enterDrillSet(run: StoryRun, step: Extract<Step, { kind: 'drill-set' }>): boolean {
    const teacher = this.resolveTeacherRef(run, step.teacher);
    const day = kstDay(this.now());
    const queue: DrillServe[] = step.drills.map((slot, slotIndex) => ({
      slotIndex,
      templateId: slot.templateId,
      seed: this.slotSeed(run, step.id, slot, slotIndex, day.date),
      attempt: 0,
    })).filter(serve => getDrillTemplate(serve.templateId) !== undefined);
    if (queue.length === 0) return false;
    const drill: DrillSetState = {
      setId: step.id,
      teacher,
      slots: step.drills,
      queue,
      cursor: 0,
      passRule: step.passRule,
      hintPenalty: step.hintPenalty,
      outcomes: new Map(),
      streak: 0,
      bestStreak: 0,
      hintsUsed: 0,
      answered: 0,
      correct: 0,
      current: null,
      context: run.kind === 'daily' ? 'daily' : 'chapter',
    };
    run.drill = drill;
    run.phase = 'drill';
    this.serveCurrent(drill);
    return true;
  }

  private slotSeed(run: StoryRun, setId: string, slot: DrillSlot, slotIndex: number, kstDate: string): number {
    if (slot.seedPolicy === 'fixed') return slot.fixedSeed ?? 0;
    if (slot.seedPolicy === 'daily') return hashSeed(run.profileId, kstDate, setId, slotIndex);
    return hashSeed(run.runId, setId, slotIndex);
  }

  private serveCurrent(drill: DrillSetState): void {
    const serve = drill.queue[drill.cursor];
    const instance = this.regenerate(serve, drill.teacher);
    drill.current = { serve, instance, hintOpened: false, result: null, servedAt: this.now() };
  }

  private serveNext(run: StoryRun, drill: DrillSetState): void {
    drill.cursor += 1;
    if (drill.cursor < drill.queue.length) {
      this.serveCurrent(drill);
      return;
    }
    // 세트 완료 → 요약에 합산하고 다음 스텝으로
    const outcomes = drill.slots.map((_, slotIndex) => {
      const outcome = drill.outcomes.get(slotIndex);
      return outcome
        ? { firstCorrect: outcome.firstCorrect, finallyCorrect: outcome.finallyCorrect, hintUsed: outcome.hintUsed }
        : { firstCorrect: false, finallyCorrect: false, hintUsed: false };
    });
    const summary = run.drillSummary;
    summary.outcomes.push(...outcomes);
    summary.hintsUsed += drill.hintsUsed;
    summary.bestStreak = Math.max(summary.bestStreak, drill.bestStreak);
    summary.answered += drill.answered;
    summary.correct += drill.correct;
    summary.hintPenalty = drill.hintPenalty;
    summary.wrongSlots += outcomes.filter(outcome => !outcome.firstCorrect).length;
    this.enterStep(run, run.stepIndex + 1);
  }

  private regenerate(serve: DrillServe, teacher: StoryTeacherId): DrillInstance {
    try {
      return generateDrill(serve.templateId, serve.seed, { teacher });
    } catch (error) {
      if (error instanceof DrillGenerationError) {
        // 생성 실패는 seed를 바꿔 한 번 더 — 그래도 실패하면 상위로
        return generateDrill(serve.templateId, hashSeed(serve.seed, 'fallback'), { teacher });
      }
      throw error;
    }
  }

  // ---------------------------------------------------------------------------
  // 내부: 결산 / 데일리

  private finishRun(run: StoryRun): void {
    const now = this.now();
    const summary = run.drillSummary;
    const drillScore = scoreDrillSet(summary.outcomes, summary.hintPenalty);
    // 통과 = 드릴 세트 완료 + 스파링 primary 행동 목표 (결과 조건은 등급·뱃지 전용). '연습'은 판정 무관.
    const sparring = run.liveResults.filter(entry => entry.tag === '대결');
    const primaryObjectivesMet = sparring.length === 0
      ? null
      : !sparring.some(entry => entry.primaryObjectivesMet === false);
    const liveScores = sparring.map(entry => entry.liveScore).filter((score): score is number => score !== null);
    const liveScore = liveScores.length > 0 ? liveScores.reduce((sum, score) => sum + score, 0) / liveScores.length : null;
    const grade = gradeChapter({ drillScore, hintsUsed: summary.hintsUsed, liveScore });
    // 실력 확인은 드릴 점수만으로 판정 — 라이브 스텝이 없어 primary가 null이라 chapterPassed로는 항상 통과해 버린다
    const passed = run.mode === 'exam'
      ? examPassed(drillScore)
      : chapterPassed({ drillCompleted: true, primaryObjectivesMet });
    const liveResult: ChapterResultView['live'] = sparring.length === 0
      ? null
      : {
          objectives: sparring.flatMap(entry => entry.objectives),
          handsPlayed: sparring.reduce((sum, entry) => sum + entry.handsPlayed, 0),
          netBB: Math.round(sparring.reduce((sum, entry) => sum + entry.netBB, 0) * 10) / 10,
        };

    if (run.kind === 'daily') {
      const teacherId = run.daily?.teacherId ?? null;
      let affinity: Array<{ characterId: StoryHeroineId; milli: number }> = [];
      if (teacherId && summary.answered >= this.dailyTotal && this.deps.rewards) {
        const outcome = this.deps.rewards.completeDaily({ profileId: run.profileId, kstDate: run.daily!.kstDate, teacherId, completedAt: now });
        if (!outcome.duplicate) affinity = [{ characterId: teacherId, milli: 5_000 }];
      }
      run.result = {
        chapterId: DAILY_CHAPTER_ID,
        mode: 'full',
        passed: true,
        grade,
        drill: { answered: summary.answered, correct: summary.correct, bestStreak: summary.bestStreak, hintsUsed: summary.hintsUsed, score: drillScore },
        live: null,
        rewards: { firstClear: false, dojoXpMilli: 0, affinity, badgeId: null },
        reviewNotesAdded: summary.wrongSlots,
        nextChapterId: null,
        beltAwarded: null,
      };
    } else {
      const rowsBefore = this.deps.repository.listProgress(run.profileId);
      const before = rowsBefore.find(row => row.chapterId === run.chapter.id);
      const beltBefore = deriveBelt(this.chapters, this.completedSet(rowsBefore), this.deps.repository.getFlags(run.profileId));
      const firstClear = passed && (before?.completions ?? 0) === 0;
      let grant = { dojoXpMilli: 0, affinity: [] as Array<{ characterId: StoryHeroineId; milli: number }>, badgeId: null as string | null };
      if (passed) {
        this.deps.repository.recordCompletion(run.profileId, run.chapter.id, grade, now);
        if (Object.keys(run.flagsDelta).length > 0) this.deps.repository.setFlags(run.profileId, run.flagsDelta, now);
        grant = firstClear ? firstClearRewards(run.chapter, grade, run.partnerId) : replayRewards(run.chapter, grade);
        if (this.deps.rewards) {
          const outcome = this.deps.rewards.completeChapter({
            profileId: run.profileId,
            chapterId: run.chapter.id,
            runId: run.runId,
            firstClear,
            grade,
            dojoXpMilli: grant.dojoXpMilli,
            affinity: grant.affinity,
            completedAt: now,
          });
          if (outcome.duplicate) grant = { dojoXpMilli: 0, affinity: [], badgeId: null };
        }
      }
      const completed = this.completedSet(this.deps.repository.listProgress(run.profileId));
      // 띠는 막 완주에서 파생되므로 순서와 무관하게 "이 완주로 올랐는가"만 본다 — 결산이 승급을 알린다
      const beltAfter = deriveBelt(this.chapters, completed, this.deps.repository.getFlags(run.profileId));
      run.result = {
        chapterId: run.chapter.id,
        mode: run.mode,
        passed,
        grade,
        drill: { answered: summary.answered, correct: summary.correct, bestStreak: summary.bestStreak, hintsUsed: summary.hintsUsed, score: drillScore },
        live: liveResult,
        rewards: { firstClear, dojoXpMilli: grant.dojoXpMilli, affinity: grant.affinity, badgeId: grant.badgeId },
        reviewNotesAdded: summary.wrongSlots,
        nextChapterId: nextChapter(this.chapters, completed)?.id ?? null,
        beltAwarded: beltAfter !== beltBefore ? beltAfter : null,
      };
    }
    run.phase = 'ended';
    run.drill = null;
    run.updatedAt = now;
    this.runs.delete(run.profileId);
  }

  private completedSet(rows: StoryProgressRecord[]): Set<ChapterId> {
    return new Set(rows.filter(row => row.completions > 0).map(row => row.chapterId));
  }

  /** 비선형 허브(2026-09-03): 어느 챕터든 하나 끝내면 열린다 — 출제 풀이 완료 챕터의 드릴이라 자연스럽게 비어 있지 않다 */
  private dailyAvailable(completed: ReadonlySet<ChapterId>): boolean {
    return completed.size > 0;
  }

  /** 완료 챕터의 드릴 슬롯에서 템플릿 풀을 만든다 (생성기에 있는 것만) */
  private dailyPool(completed: ReadonlySet<ChapterId>): Array<{ templateId: string; teacher: Chapter['teacher'] }> {
    const pool: Array<{ templateId: string; teacher: Chapter['teacher'] }> = [];
    const seen = new Set<string>();
    for (const chapter of this.chapters) {
      if (!completed.has(chapter.id)) continue;
      for (const step of chapter.steps) {
        if (step.kind !== 'drill-set') continue;
        for (const slot of step.drills) {
          if (seen.has(slot.templateId) || !getDrillTemplate(slot.templateId)) continue;
          seen.add(slot.templateId);
          pool.push({ templateId: slot.templateId, teacher: chapter.teacher });
        }
      }
    }
    return pool;
  }

  private buildDailySlots(profileId: string, completed: ReadonlySet<ChapterId>, kstDate: string, now: number): Array<{ templateId: string; seed: number }> {
    const slots: Array<{ templateId: string; seed: number }> = [];
    for (const note of this.deps.repository.listDue(profileId, now, this.dailyTotal)) {
      if (!getDrillTemplate(note.templateId)) continue;
      slots.push({ templateId: note.templateId, seed: note.seed });
      if (slots.length >= this.dailyTotal) return slots;
    }
    const pool = this.dailyPool(completed);
    for (let index = 0; slots.length < this.dailyTotal && pool.length > 0 && index < this.dailyTotal * 4; index++) {
      const pick = pool[hashSeed(profileId, kstDate, 'pool', index) % pool.length];
      const seed = hashSeed(profileId, kstDate, 'seed', slots.length);
      if (slots.some(slot => slot.templateId === pick.templateId && slot.seed === seed)) continue;
      slots.push({ templateId: pick.templateId, seed });
    }
    return slots;
  }

  /** 오늘의 출제 히로인 — 풀에 등장한 히로인 담당을 날짜로 로테이션, 없으면 파트너 */
  private dailyTeacher(profileId: string, completed: ReadonlySet<ChapterId>, kstDate: string): StoryHeroineId | null {
    const heroines = [...new Set(this.dailyPool(completed).map(entry => entry.teacher).filter(isStoryHeroineId))];
    if (heroines.length > 0) return heroines[hashSeed(profileId, kstDate, 'teacher') % heroines.length];
    return this.deps.partnerOf(profileId);
  }

  private resolveTeacherRef(run: StoryRun, ref: Chapter['teacher']): StoryTeacherId {
    if (ref === 'partner') return run.partnerId ?? 'miyako';
    return ref;
  }

  private buildDrillView(drill: DrillSetState): StoryDrillView | null {
    if (!drill.current) return null;
    return {
      setId: drill.setId,
      index: drill.cursor,
      total: drill.queue.length,
      instance: toPublicDrillInstance(drill.current.instance),
      streak: drill.streak,
      hintsUsed: drill.hintsUsed,
      wrongQueue: Math.max(0, drill.queue.length - drill.cursor - 1 - drill.queue.slice(drill.cursor + 1).filter(serve => serve.attempt === 0).length),
      hint: drill.current.hintOpened ? drill.current.instance.hint : null,
      lastResult: drill.current.result,
      answered: drill.answered,
      correct: drill.correct,
    };
  }

  private buildView(run: StoryRun): StoryRunView {
    const step: Step = run.chapter.steps[run.stepIndex];
    return {
      runId: run.runId,
      chapterId: run.chapter.id,
      mode: run.mode,
      stepIndex: run.stepIndex,
      stepCount: run.chapter.steps.length,
      stepKind: step.kind,
      phase: run.phase,
      context: { partnerId: run.partnerId, teacherId: this.resolveTeacherRef(run, run.chapter.teacher) },
      drill: run.drill ? this.buildDrillView(run.drill) : null,
      live: LIVE_STEP_KINDS.has(step.kind) && run.phase !== 'ended'
        ? this.liveAdapter?.view(run.profileId) ?? null
        : null,
      result: run.result,
      startedAt: run.startedAt,
      updatedAt: run.updatedAt,
    };
  }
}

export { BLACK_BELT_FLAG };
