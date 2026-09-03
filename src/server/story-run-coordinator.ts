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
import { chapterPassed, examPassed, firstClearRewards, gradeChapter, isPerfectSet, replayRewards, scoreDrillSet, type DrillSlotOutcome } from '../lib/story/grading';
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
import { BLACK_BELT_FLAG, EMPTY_NOTE_FLAG, PERFECT_SET_FLAG, computeUnlockedChapters, deriveBelt, isChapterUnlocked, nextChapter } from '../lib/story/unlocks';
import { findNewlyUnlockedScenes, getBondSceneArt } from '../lib/characters/bond-scenes';
import { nextStoryRewards, pickStoryCutscene } from '../lib/story/rewards/catalog';
import type {
  ChapterResultRewards,
  ChapterResultView,
  StoryAdvanceRequest,
  StoryChoiceRequest,
  StoryDrillAck,
  StoryDrillRequest,
  StoryDrillView,
  StoryLiveView,
  StoryProgressView,
  StoryRewardItemView,
  StoryRewardPreview,
  StoryRunPhase,
  StoryRunView,
  StoryRunMode,
  StoryUnlockedSceneView,
} from '../lib/story/views';
import type { LiveCommandResult, LiveEnterInput, LiveStepSummary, StoryLiveEvents } from './story-live-adapter';

/** 라이브 스텝 어댑터 포트 — LiveTableAdapter가 구현 (테스트는 fake) */
export interface StoryLiveAdapterPort {
  enter(input: LiveEnterInput): 'entered' | 'unavailable';
  resume(profileId: string, runId: string): LiveCommandResult;
  /** false = 방을 아직 닫을 수 없음(정산 미해결) — 런을 지우지 말고 재시도 안내 */
  abandon(profileId: string): boolean;
  /**
   * 운영자 스킵 — 라이브 스텝을 "목표 전부 달성"으로 즉시 끝낸다. 'finished'면 방을 해체하고 onStepFinished를
   * **동기** 호출한 뒤다(코디네이터가 그 안에서 다음 스텝으로 옮긴다). 'busy'는 정산 미해결로 방을 닫지 못한 경우.
   */
  forceFinish(profileId: string): 'finished' | 'no-session' | 'busy';
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
  /** 0 = 첫 시도, n = n번째 재출제 (코디네이터는 항상 넘긴다; 리포지토리 기본 0) */
  attempt?: number;
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
  countAttemptsBetween(
    profileId: string,
    fromMs: number,
    toMsExclusive: number,
    context?: StoryAttemptContext,
    options?: { firstAttemptOnly?: boolean },
  ): number;
}

/** 히로인 인연 전후 레벨 (progression-service `StoryAffinityTransition`) — 새 인연 씬 산출 입력 */
export interface StoryAffinityTransitionRecord {
  characterId: StoryHeroineId;
  previousLevel: number;
  nextLevel: number;
}

/**
 * 보상 포트 — ProgressionRuntime(XP·인연) + StoryRewardService(카탈로그 아이템·칩)가 구현
 * (없으면 XP 없이 진행: 테스트·비활성 환경). reconcile/preview/grantDailyChips는 선택 —
 * 없으면 결산 DTO의 items/chips/cutscene/next를 채우지 않아 클라가 폴백한다.
 */
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
  }): { duplicate: boolean; affinityTransitions?: StoryAffinityTransitionRecord[] };
  completeDaily(input: { profileId: string; kstDate: string; teacherId: StoryHeroineId; completedAt: number }): { duplicate: boolean };
  /** durable 상태에서 자격 − 영수증 = 누락분을 지급(칩 포함) — 결산·데일리 종료·진행도 조회에서 호출 */
  reconcile?(profileId: string, now: number): { granted: StoryRewardItemView[]; chips: number };
  /** 카탈로그 전체 미리보기(획득 여부 포함) — 허브 카드 칩·결산 「다음 보상」 */
  preview?(profileId: string): StoryRewardPreview[];
  /** 오늘의 수련 완료 칩 — 날짜당 1회, 이미 지급이면 0 */
  grantDailyChips?(profileId: string, kstDate: string, now: number): number;
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
  /** 세트 끝 재출제 라운드 상한 (기본 1 — 워스트 슬롯×2, 2026-09-03 완화) */
  maxRetries?: number;
  /** 재출제 전에 [다시 풀기]/[넘어가기] 오퍼를 낼지 (기본 true, false면 자동 재출제 — 롤백 스위치) */
  retryOffer?: boolean;
}

/** 소켓 계층이 접속 시 판정한 권한 — operator면 잠긴 챕터 시작·`target:'skip'` 허용 */
export interface StoryCommandOptions {
  operator?: boolean;
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

/**
 * 드릴 세트 상태 — 2패스 모델(2026-09-03).
 * 첫 패스 `queue`는 슬롯 수만큼 고정(오답으로 늘지 않는다). 첫 패스가 끝나고 오답 슬롯이 남으면
 * `stage:'retry-offer'`로 멈춰 클라가 [다시 풀기]/[넘어가기]를 고르고, 재출제는 `retryQueue`(새 seed)로 돈다.
 */
interface DrillSetState {
  setId: string;
  teacher: StoryTeacherId;
  slots: DrillSlot[];
  /** 첫 패스 — 고정 */
  queue: DrillServe[];
  cursor: number;
  /** 현재 재출제 라운드 큐 */
  retryQueue: DrillServe[];
  retryCursor: number;
  /** 시작한 재출제 라운드 수 (0..maxRetries) */
  round: number;
  stage: 'first' | 'retry-offer' | 'retry';
  /** [복습 노트에 넣고 넘어가기]로 재출제를 건너뛰었는가 */
  retrySkipped: boolean;
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
  drillSummary: {
    outcomes: DrillSlotOutcome[]; hintsUsed: number; bestStreak: number; answered: number; correct: number;
    hintPenalty: number; wrongSlots: number;
    /** 세트 수 / 「퍼펙트」 세트 수 / 재출제 건너뜀 여부(하나라도) */
    sets: number; perfectSets: number; retrySkipped: boolean;
  };
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
  return { outcomes: [], hintsUsed: 0, bestStreak: 0, answered: 0, correct: 0, hintPenalty, wrongSlots: 0, sets: 0, perfectSets: 0, retrySkipped: false };
}

export class StoryRunCoordinator {
  private readonly runs = new Map<string, StoryRun>();
  private readonly chapters: readonly Chapter[];
  private readonly now: () => number;
  private readonly runIdFactory: () => string;
  private readonly dailyTotal: number;
  private readonly maxRetries: number;
  private readonly retryOffer: boolean;
  private liveAdapter: StoryLiveAdapterPort | null = null;

  constructor(private readonly deps: StoryRunCoordinatorDeps) {
    this.chapters = deps.chapters ?? STORY_CHAPTERS;
    this.now = deps.now ?? (() => Date.now());
    this.runIdFactory = deps.runIdFactory ?? defaultRunId;
    this.dailyTotal = deps.dailyTotal ?? 3;
    this.maxRetries = deps.maxRetries ?? 1;
    this.retryOffer = deps.retryOffer ?? true;
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
          ? Math.min(this.dailyTotal, this.deps.repository.countAttemptsBetween(profileId, day.fromMs, day.toMsExclusive, 'daily', { firstAttemptOnly: true }))
          : 0,
        total: this.dailyTotal,
        available: dailyAvailable,
        teacherId: dailyTeacher,
      },
      activeRun: run ? { runId: run.runId, chapterId: run.chapter.id, stepIndex: run.stepIndex, mode: run.mode } : null,
      ...(this.deps.rewards?.preview ? { rewards: this.previewRewards(profileId) } : {}),
    };
  }

  /**
   * 보상 미리보기 — 조회 전에 reconcile로 자기 치유(결산 도중 크래시로 누락된 지급을 다음 조회가 메운다).
   * 조회는 절대 실패하지 않아야 하므로 reconcile 오류는 삼키고 미리보기만 돌려준다.
   */
  private previewRewards(profileId: string): StoryRewardPreview[] {
    const rewards = this.deps.rewards;
    if (!rewards?.preview) return [];
    try {
      rewards.reconcile?.(profileId, this.now());
    } catch {
      // 다음 결산·조회에서 재시도 — 진행도 조회가 보상 장애로 막히지 않게 한다
    }
    return rewards.preview(profileId);
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
  start(
    profileId: string,
    chapterId: ChapterId,
    mode: StoryRunMode = 'full',
    options: StoryCommandOptions = {},
  ): CoordinatorResult<{ runId: string }> {
    if (this.runs.has(profileId)) {
      return { ok: false, code: 'story-busy', message: '진행 중인 챕터가 있어요. 이어서 하거나 포기한 뒤 시작할 수 있어요.' };
    }
    const chapter = this.chapters.find(candidate => candidate.id === chapterId);
    if (!chapter) {
      return { ok: false, code: 'story-locked', message: '없는 챕터예요.' };
    }
    const completed = this.completedSet(this.deps.repository.listProgress(profileId));
    // 운영자는 잠긴 챕터도 바로 연다 (QA·검수 경로 — 해금 그래프는 그대로, 권한만 우회)
    if (!options.operator && !isChapterUnlocked(chapter, completed)) {
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
    // 첫 시도만 센다 — 재출제 행이 하루를 소모하지 않게(2026-09-03 버그 수정)
    if (this.deps.repository.countAttemptsBetween(profileId, day.fromMs, day.toMsExclusive, 'daily', { firstAttemptOnly: true }) >= this.dailyTotal) {
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

  advance(profileId: string, request: StoryAdvanceRequest, options: StoryCommandOptions = {}): CoordinatorResult {
    if (request.target === 'skip') {
      if (!options.operator) {
        return { ok: false, code: 'action-rejected', message: '건너뛰기는 운영자만 쓸 수 있어요.' };
      }
      return this.skipStep(profileId, request);
    }
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
        if (drill.stage === 'retry-offer') {
          return { ok: false, code: 'action-rejected', message: '틀린 문제를 다시 풀지, 복습 노트로 보내고 넘어갈지 골라 주세요.' };
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

  /**
   * 운영자 스킵(무적) — 현재 스텝을 "다 한 것"으로 치고 다음 스텝으로. 씬·레슨은 그냥 넘기고, 드릴 세트는 남은/틀린
   * 슬롯을 전부 첫 시도 정답(힌트 없음)으로 채워 세트를 닫으며, 라이브 스텝은 어댑터가 목표 전부 달성으로 방을 해체한다.
   * 결산 스텝이면 결산을 확정한다(보상 지급 포함 — 실제 완주와 같은 경로).
   */
  private skipStep(profileId: string, request: StoryAdvanceRequest): CoordinatorResult {
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
        if (drill) this.forceDrillSet(run, drill);
        else this.enterStep(run, run.stepIndex + 1);
        break;
      }
      case 'practice-table':
      case 'sparring': {
        const forced = this.liveAdapter?.forceFinish(profileId) ?? 'no-session';
        if (forced === 'busy') {
          return { ok: false, code: 'server-error', message: '테이블 정리를 아직 마치지 못했어요. 잠시 후 다시 시도해 주세요.' };
        }
        // 'finished'면 어댑터가 onStepFinished → completeLiveStep으로 이미 다음 스텝에 들어가고 emit까지 끝났다
        if (forced === 'finished') return { ok: true, value: undefined };
        this.enterStep(run, run.stepIndex + 1);
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

  /** 드릴 세트 강제 완료 — 아직 안 푼/틀린 슬롯을 첫 시도 정답으로 채우고 세트를 닫는다(퍼펙트 세트로 집계) */
  private forceDrillSet(run: StoryRun, drill: DrillSetState): void {
    drill.slots.forEach((_, slotIndex) => {
      const existing = drill.outcomes.get(slotIndex);
      if (existing?.firstCorrect && existing.finallyCorrect && !existing.hintUsed) return;
      if (!existing) {
        drill.answered += 1;
        drill.correct += 1;
      } else if (!existing.finallyCorrect) {
        drill.correct += 1;
      }
      drill.outcomes.set(slotIndex, { firstCorrect: true, finallyCorrect: true, hintUsed: false, attempts: existing?.attempts ?? 1 });
    });
    drill.current = null;
    drill.stage = 'first';
    this.finalizeSet(run, drill);
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
  drill(profileId: string, request: StoryDrillRequest): CoordinatorResult<StoryDrillAck> {
    const run = this.runs.get(profileId);
    if (!run) return { ok: false, code: 'story-no-run', message: '진행 중인 챕터가 없어요.' };
    const drill = run.drill;
    if (run.runId !== request.runId || !drill || run.phase !== 'drill' || !drill.current) {
      return { ok: false, code: 'stale-state', message: '지금은 문제를 푸는 단계가 아니에요.' };
    }
    if (drill.setId !== request.setId || this.drillIndex(drill) !== request.index) {
      return { ok: false, code: 'stale-state', message: '화면이 최신 문제가 아니에요. 다시 불러올게요.' };
    }
    const current = drill.current;

    // 재출제 오퍼 응답 — 오퍼 중에만 유효. 'retry'는 오답 슬롯만 새 seed로 재출제 패스, 'skip-retry'는 세트 종료.
    if (request.action === 'retry' || request.action === 'skip-retry') {
      if (drill.stage !== 'retry-offer') {
        return { ok: false, code: 'action-rejected', message: '지금은 재출제를 고르는 단계가 아니에요.' };
      }
      const wrong = this.wrongSlots(drill);
      if (request.action === 'skip-retry') {
        drill.retrySkipped = true;
        this.finalizeSet(run, drill);
        run.updatedAt = this.now();
        if (this.runs.has(profileId)) this.deps.emit(profileId, this.buildView(run));
        return { ok: true, value: { action: 'skip-retry', skipped: wrong.length } };
      }
      this.startRetryRound(drill, wrong);
      run.updatedAt = this.now();
      this.deps.emit(profileId, this.buildView(run));
      return { ok: true, value: { action: 'retry', count: wrong.length } };
    }

    if (request.action === 'hint') {
      if (run.mode === 'exam') return { ok: false, code: 'action-rejected', message: '실력 확인에서는 힌트를 쓸 수 없어요.' };
      if (current.result) return { ok: false, code: 'action-rejected', message: '이미 답을 제출한 문제예요.' };
      const hint = current.instance.hint;
      if (!hint) return { ok: false, code: 'action-rejected', message: '이 문제엔 힌트가 없어요.' };
      if (!current.hintOpened) {
        current.hintOpened = true;
        // 재출제 패스의 힌트는 S 판정(hintsUsed)에 세지 않는다 — 재출제는 이미 0.5점이라 이중 페널티
        if (current.serve.attempt === 0) drill.hintsUsed += 1;
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
      attempt: current.serve.attempt,
      elapsedMs,
      answeredAt: now,
    });
    // 복습 노트(Leitner): 오답은 박스1로, 정답은 승격/졸업 — 재출제 문항(attempt>0)은 노트 갱신 대상에서 제외
    if (current.serve.attempt === 0) {
      if (correct) {
        const outcome = this.deps.repository.markCorrect(profileId, current.serve.templateId, current.serve.seed, now);
        // 「빈 노트」: 노트가 졸업으로 비워지는 순간 플래그 영속 (보상 카탈로그 트리거)
        if (outcome === 'graduated' && this.deps.repository.countNotes(profileId) === 0) {
          this.deps.repository.setFlags(profileId, { [EMPTY_NOTE_FLAG]: '1' }, now);
        }
      } else {
        this.deps.repository.markWrong(profileId, current.serve.templateId, current.serve.seed, now);
      }
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
      // 오답은 큐에 push하지 않는다 — 첫 패스가 끝난 뒤 오퍼/재출제 라운드가 오답 슬롯을 모아 다시 낸다
      drill.streak = 0;
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
      retryQueue: [],
      retryCursor: 0,
      round: 0,
      stage: 'first',
      retrySkipped: false,
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
    this.serveCurrent(drill, queue[0]);
    return true;
  }

  private slotSeed(run: StoryRun, setId: string, slot: DrillSlot, slotIndex: number, kstDate: string): number {
    if (slot.seedPolicy === 'fixed') return slot.fixedSeed ?? 0;
    if (slot.seedPolicy === 'daily') return hashSeed(run.profileId, kstDate, setId, slotIndex);
    return hashSeed(run.runId, setId, slotIndex);
  }

  private serveCurrent(drill: DrillSetState, serve: DrillServe): void {
    const instance = this.regenerate(serve, drill.teacher);
    drill.current = { serve, instance, hintOpened: false, result: null, servedAt: this.now() };
  }

  /**
   * 세트 내 명령 커서(단조 증가, stale 검사 키) — 첫 패스 0..total-1, 오퍼 = total,
   * 재출제 패스 = total + 1 + retryCursor. 오퍼와 재출제 첫 문항이 같은 값을 갖지 않게 1을 띄운다.
   */
  private drillIndex(drill: DrillSetState): number {
    if (drill.stage === 'retry') return drill.queue.length + 1 + drill.retryCursor;
    return drill.cursor;
  }

  /** 답했지만 아직 최종 정답이 아닌 슬롯 (미출제 슬롯은 세지 않는다) */
  private wrongSlots(drill: DrillSetState): number[] {
    return drill.queue
      .map(serve => serve.slotIndex)
      .filter(slotIndex => {
        const outcome = drill.outcomes.get(slotIndex);
        return outcome !== undefined && !outcome.finallyCorrect;
      });
  }

  private serveNext(run: StoryRun, drill: DrillSetState): void {
    if (drill.stage === 'retry') {
      drill.retryCursor += 1;
      if (drill.retryCursor < drill.retryQueue.length) {
        this.serveCurrent(drill, drill.retryQueue[drill.retryCursor]);
        return;
      }
    } else {
      drill.cursor += 1;
      if (drill.cursor < drill.queue.length) {
        this.serveCurrent(drill, drill.queue[drill.cursor]);
        return;
      }
    }
    this.offerOrFinalize(run, drill);
  }

  /** 패스가 끝났다 — 오답이 남고 라운드가 남으면 오퍼(또는 자동 재출제), 아니면 세트 종료 */
  private offerOrFinalize(run: StoryRun, drill: DrillSetState): void {
    const wrong = this.wrongSlots(drill);
    if (wrong.length > 0 && drill.round < this.maxRetries) {
      if (this.retryOffer) {
        drill.stage = 'retry-offer';
        return;
      }
      this.startRetryRound(drill, wrong);
      return;
    }
    this.finalizeSet(run, drill);
  }

  /** 오답 슬롯만 새 seed(같은 템플릿)로 재출제 패스를 연다 */
  private startRetryRound(drill: DrillSetState, wrong: readonly number[]): void {
    drill.round += 1;
    drill.retryQueue = wrong.map(slotIndex => {
      const base = drill.queue.find(serve => serve.slotIndex === slotIndex)!;
      return {
        slotIndex,
        templateId: base.templateId,
        seed: hashSeed(base.seed, 'retry', drill.round),
        attempt: drill.round,
      };
    });
    drill.retryCursor = 0;
    drill.stage = 'retry';
    this.serveCurrent(drill, drill.retryQueue[0]);
  }

  /** 세트 완료 → 요약에 합산하고 다음 스텝으로 */
  private finalizeSet(run: StoryRun, drill: DrillSetState): void {
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
    summary.sets += 1;
    if (isPerfectSet(outcomes)) summary.perfectSets += 1;
    summary.retrySkipped ||= drill.retrySkipped;
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
    const drillResult: ChapterResultView['drill'] = {
      answered: summary.answered,
      correct: summary.correct,
      bestStreak: summary.bestStreak,
      hintsUsed: summary.hintsUsed,
      score: drillScore,
      slots: summary.outcomes.length,
      finalCorrect: summary.outcomes.filter(outcome => outcome.finallyCorrect).length,
      perfect: summary.sets > 0 && summary.perfectSets === summary.sets,
      retrySkipped: summary.retrySkipped,
    };
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
      // 데일리 런은 통과 여부가 없어 플래그를 여기서 바로 영속한다
      if (drillResult.perfect) this.deps.repository.setFlags(run.profileId, { [PERFECT_SET_FLAG]: '1' }, now);
      let affinity: Array<{ characterId: StoryHeroineId; milli: number }> = [];
      let dailyChips = 0;
      // 완료 = 슬롯 3개를 다 풀었는가(재출제 제출은 세지 않는다)
      if (teacherId && summary.outcomes.length >= this.dailyTotal && this.deps.rewards) {
        const outcome = this.deps.rewards.completeDaily({ profileId: run.profileId, kstDate: run.daily!.kstDate, teacherId, completedAt: now });
        if (!outcome.duplicate) {
          affinity = [{ characterId: teacherId, milli: 5_000 }];
          dailyChips = this.deps.rewards.grantDailyChips?.(run.profileId, run.daily!.kstDate, now) ?? 0;
        }
      }
      // 「퍼펙트」·「빈 노트」 칭호는 플래그에서 파생되므로 데일리 완료 여부와 무관하게 reconcile
      const extra = this.reconcileRewards(run.profileId, DAILY_CHAPTER_ID, [], now);
      run.result = {
        chapterId: DAILY_CHAPTER_ID,
        mode: 'full',
        passed: true,
        grade,
        drill: drillResult,
        live: null,
        rewards: {
          firstClear: false,
          dojoXpMilli: 0,
          affinity,
          badgeId: extra?.items.find(item => item.kind === 'title')?.id ?? null,
          ...(extra
            ? { ...extra, chips: extra.chips + dailyChips, next: [] }
            : dailyChips > 0 ? { chips: dailyChips } : {}),
        },
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
      let transitions: StoryAffinityTransitionRecord[] = [];
      let extra: ReturnType<StoryRunCoordinator['reconcileRewards']> = null;
      if (passed) {
        // 「퍼펙트」는 선택지 플래그와 함께 통과 시에만 영속된다(미통과 런의 플래그는 버려지는 기존 규약)
        if (drillResult.perfect) run.flagsDelta[PERFECT_SET_FLAG] = '1';
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
          else transitions = outcome.affinityTransitions ?? [];
          // 카탈로그 보상은 방금 영속된 completions/best_grade/플래그에서 reconcile — XP 트랜잭션과 분리·각자 멱등
          extra = this.reconcileRewards(run.profileId, run.chapter.id, transitions, now);
        }
      }
      const completed = this.completedSet(this.deps.repository.listProgress(run.profileId));
      // 띠는 막 완주에서 파생되므로 순서와 무관하게 "이 완주로 올랐는가"만 본다 — 결산이 승급을 알린다
      const beltAfter = deriveBelt(this.chapters, completed, this.deps.repository.getFlags(run.profileId));
      const levelsOf = new Map(transitions.map(entry => [entry.characterId, entry]));
      run.result = {
        chapterId: run.chapter.id,
        mode: run.mode,
        passed,
        grade,
        drill: drillResult,
        live: liveResult,
        rewards: {
          firstClear,
          dojoXpMilli: grant.dojoXpMilli,
          affinity: grant.affinity.map(entry => {
            const levels = levelsOf.get(entry.characterId);
            return levels ? { ...entry, levelBefore: levels.previousLevel, levelAfter: levels.nextLevel } : entry;
          }),
          // 호환용 badgeId — 서버 보상 라인이 있으면 새 칭호 id, 없으면 챕터 데이터의 badgeId
          badgeId: extra?.items.find(item => item.kind === 'title')?.id ?? grant.badgeId,
          ...(extra ?? {}),
        },
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

  /**
   * 결산 보상 DTO — reconcile(새 아이템·칩) + 컷신(보스 > 띠 > 에필로그 1개) + 인연 전이로 열린 인연 씬 +
   * 이 챕터·막의 미획득 「다음 보상」. 포트에 reconcile이 없으면 null(클라 폴백 — 필드 미정의).
   */
  private reconcileRewards(
    profileId: string,
    chapterId: ChapterId,
    transitions: readonly StoryAffinityTransitionRecord[],
    now: number,
  ): Required<Pick<ChapterResultRewards, 'items' | 'chips' | 'cutscene' | 'unlockedScenes' | 'next'>> | null {
    const rewards = this.deps.rewards;
    if (!rewards?.reconcile) return null;
    const reconciled = rewards.reconcile(profileId, now);
    const unlockedScenes: StoryUnlockedSceneView[] = transitions.flatMap(entry =>
      findNewlyUnlockedScenes(entry.characterId, entry.previousLevel, entry.nextLevel).map(scene => ({
        id: scene.id,
        characterId: scene.characterId,
        level: scene.level,
        title: scene.title,
        caption: scene.caption,
        art: getBondSceneArt(scene),
      })),
    );
    const granted = new Set((rewards.preview?.(profileId) ?? []).filter(item => item.granted).map(item => item.id));
    return {
      items: reconciled.granted,
      chips: reconciled.chips,
      cutscene: pickStoryCutscene(reconciled.granted),
      unlockedScenes,
      next: nextStoryRewards(this.chapters, granted, chapterId),
    };
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
    const wrongQueue = drill.stage === 'retry'
      ? Math.max(0, drill.retryQueue.length - drill.retryCursor - 1)
      : this.wrongSlots(drill).length;
    return {
      setId: drill.setId,
      index: this.drillIndex(drill),
      total: drill.queue.length,
      retry: drill.stage === 'retry' ? { index: drill.retryCursor, total: drill.retryQueue.length } : null,
      retryOffer: drill.stage === 'retry-offer' ? { count: this.wrongSlots(drill).length } : null,
      instance: toPublicDrillInstance(drill.current.instance),
      streak: drill.streak,
      hintsUsed: drill.hintsUsed,
      wrongQueue,
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
