/**
 * StoryRunCoordinator — 스토리 런(챕터 1회 주행)의 서버 상태 머신. **방(RoomManager)과 무관**하다.
 *
 * - runs: profileId당 최대 1개 런(인메모리). 서버 재시작이면 런은 사라지고 허브가
 *   "중단된 챕터 다시 도전"을 보여준다 — attempts·drill_attempts·복습 노트는 즉시 영속이라 유실 없음.
 * - 스텝 진입: scene/lesson은 클라 렌더(데이터는 클라도 가진 STORY_CHAPTERS), drill-set은 드릴 엔진이
 *   (Phase 1.1/1.3), practice-table/sparring은 라이브 어댑터가(Phase 1b) 붙는다. 엔진/어댑터가 주입되지
 *   않은 스텝은 **스킵**된다 — Phase 0.5 스켈레톤은 scene → lesson → result 를 주행할 수 있다.
 * - 모든 명령은 (runId, expectedStepIndex) stale 검사를 통과해야 한다 (`player-action`의
 *   expectedHandNumber 계약과 동형 → 'stale-state').
 * - 성공한 명령마다 `emit(profileId, view)`로 story-update를 보낸다. 뷰의 드릴은 정답 제거 투영만.
 */
import type { RealtimeErrorCode } from '../lib/realtime/protocol';
import { STORY_CHAPTERS } from '../lib/story/chapters';
import type { Chapter, ChapterGrade, ChapterId, Step, StoryHeroineId, StoryTeacherId } from '../lib/story/types';
import { BLACK_BELT_FLAG, computeUnlockedChapters, deriveBelt, isChapterUnlocked, nextChapter } from '../lib/story/unlocks';
import type {
  ChapterResultView,
  StoryAdvanceRequest,
  StoryProgressView,
  StoryRunPhase,
  StoryRunView,
} from '../lib/story/views';

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

/** 코디네이터가 필요로 하는 영속 포트 — StoryRepository가 구현한다 (테스트는 인메모리 fake). */
export interface StoryRepositoryPort {
  listProgress(profileId: string): StoryProgressRecord[];
  recordAttemptStart(profileId: string, chapterId: ChapterId, now: number): void;
  getFlags(profileId: string): Record<string, string>;
  getDrillStats(profileId: string): StoryDrillStatsRecord;
  countNotes(profileId: string): number;
  countAttemptsBetween(profileId: string, fromMs: number, toMsExclusive: number, context?: 'chapter' | 'review' | 'daily' | 'hand-review'): number;
}

export interface StoryRunCoordinatorDeps {
  repository: StoryRepositoryPort;
  emit: (profileId: string, view: StoryRunView) => void;
  /** 선택 파트너(인연) — 없으면 null: 'partner' 참조는 미야코로 대체된다 */
  partnerOf: (profileId: string) => StoryHeroineId | null;
  chapters?: readonly Chapter[];
  now?: () => number;
  runIdFactory?: () => string;
  /** 오늘의 수련 문제 수 (기본 3) */
  dailyTotal?: number;
}

export type CoordinatorResult<T = undefined> =
  | { ok: true; value: T }
  | { ok: false; code: RealtimeErrorCode; message: string };

export interface StoryRun {
  runId: string;
  profileId: string;
  chapter: Chapter;
  stepIndex: number;
  phase: StoryRunPhase;
  partnerId: StoryHeroineId | null;
  choices: Record<string, string>;
  flagsDelta: Record<string, string>;
  result: ChapterResultView | null;
  startedAt: number;
  updatedAt: number;
}

const KST_OFFSET_MS = 9 * 60 * 60_000;
const DAY_MS = 24 * 60 * 60_000;

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

export class StoryRunCoordinator {
  private readonly runs = new Map<string, StoryRun>();
  private readonly chapters: readonly Chapter[];
  private readonly now: () => number;
  private readonly runIdFactory: () => string;
  private readonly dailyTotal: number;

  constructor(private readonly deps: StoryRunCoordinatorDeps) {
    this.chapters = deps.chapters ?? STORY_CHAPTERS;
    this.now = deps.now ?? (() => Date.now());
    this.runIdFactory = deps.runIdFactory ?? defaultRunId;
    this.dailyTotal = deps.dailyTotal ?? 3;
  }

  // ---------------------------------------------------------------------------
  // 조회

  getProgress(profileId: string): StoryProgressView {
    const rows = this.deps.repository.listProgress(profileId);
    const byId = new Map(rows.map(row => [row.chapterId, row]));
    const completed = new Set(rows.filter(row => row.completions > 0).map(row => row.chapterId));
    const unlocked = computeUnlockedChapters(this.chapters, completed);
    const flags = this.deps.repository.getFlags(profileId);
    const day = kstDay(this.now());
    const firstChapter = this.chapters.find(chapter => chapter.act === 1 && chapter.order === 1);
    const dailyAvailable = !!firstChapter && completed.has(firstChapter.id);
    const run = this.runs.get(profileId) ?? null;

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
        teacherId: null,
      },
      activeRun: run ? { runId: run.runId, chapterId: run.chapter.id, stepIndex: run.stepIndex } : null,
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
  // 명령

  start(profileId: string, chapterId: ChapterId): CoordinatorResult<{ runId: string }> {
    if (this.runs.has(profileId)) {
      return { ok: false, code: 'story-busy', message: '진행 중인 챕터가 있어요. 이어서 하거나 포기한 뒤 시작할 수 있어요.' };
    }
    const chapter = this.chapters.find(candidate => candidate.id === chapterId);
    if (!chapter) {
      return { ok: false, code: 'story-locked', message: '없는 챕터예요.' };
    }
    const completed = new Set(
      this.deps.repository.listProgress(profileId).filter(row => row.completions > 0).map(row => row.chapterId),
    );
    if (!isChapterUnlocked(chapter, completed)) {
      return { ok: false, code: 'story-locked', message: '아직 열리지 않은 챕터예요. 이전 챕터를 먼저 끝내 주세요.' };
    }
    const now = this.now();
    this.deps.repository.recordAttemptStart(profileId, chapter.id, now);
    const run: StoryRun = {
      runId: this.runIdFactory(),
      profileId,
      chapter,
      stepIndex: -1,
      phase: 'scene',
      partnerId: this.deps.partnerOf(profileId),
      choices: {},
      flagsDelta: {},
      result: null,
      startedAt: now,
      updatedAt: now,
    };
    this.runs.set(profileId, run);
    this.enterStep(run, 0);
    if (this.runs.has(profileId)) this.deps.emit(profileId, this.buildView(run));
    return { ok: true, value: { runId: run.runId } };
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
      case 'drill-set':
        // Phase 1.3: 세트를 끝내야 넘어간다. 스켈레톤에선 엔진이 없어 여기 머무를 일이 없다.
        return { ok: false, code: 'action-rejected', message: '수련 문제를 모두 풀어야 넘어갈 수 있어요.' };
      case 'practice-table':
      case 'sparring':
        if (request.target !== 'resume') {
          return { ok: false, code: 'action-rejected', message: '테이블 스텝은 핸드가 끝나야 진행돼요.' };
        }
        // Phase 1b: 라이브 어댑터 resume. 스켈레톤에선 진입 자체가 스킵된다.
        return { ok: false, code: 'action-rejected', message: '테이블 스텝은 아직 준비 중이에요.' };
      case 'result':
        // 결산은 런을 닫으므로 최종(ended) 뷰를 명시적으로 보낸다
        this.finishRun(run);
        this.deps.emit(profileId, this.buildView(run));
        return { ok: true, value: undefined };
    }
    if (this.runs.has(profileId)) this.deps.emit(profileId, this.buildView(run));
    return { ok: true, value: undefined };
  }

  abandon(profileId: string, runId: string): CoordinatorResult {
    const run = this.runs.get(profileId);
    if (!run) return { ok: false, code: 'story-no-run', message: '진행 중인 챕터가 없어요.' };
    if (run.runId !== runId) return { ok: false, code: 'stale-state', message: '이미 끝난 챕터 진행이에요.' };
    this.runs.delete(profileId);
    run.phase = 'ended';
    this.deps.emit(profileId, this.buildView(run));
    return { ok: true, value: undefined };
  }

  /** 프로필 폐기·로그아웃 — 런을 조용히 버린다 (emit 없음) */
  clearProfile(profileId: string): void {
    this.runs.delete(profileId);
  }

  // ---------------------------------------------------------------------------
  // 내부

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
    while (cursor < steps.length) {
      const step = steps[cursor];
      run.stepIndex = cursor;
      run.updatedAt = this.now();
      if (step.kind === 'scene') { run.phase = 'scene'; return; }
      if (step.kind === 'lesson') { run.phase = 'lesson'; return; }
      if (step.kind === 'result') { run.phase = 'result'; return; }
      // drill-set / practice-table / sparring: 엔진·어댑터 미주입 → 스킵 (Phase 1.3 / 1b에서 활성)
      cursor += 1;
    }
    run.stepIndex = steps.length - 1;
    run.phase = 'result';
  }

  private finishRun(run: StoryRun): void {
    // Phase 1.3/1.4: gradeChapter + recordStoryChapterComplete + story_progress/flags 영속.
    // 스켈레톤은 통과·B등급·보상 0으로 결산 뷰만 만들고 런을 닫는다.
    const completed = new Set(
      this.deps.repository.listProgress(run.profileId).filter(row => row.completions > 0).map(row => row.chapterId),
    );
    completed.add(run.chapter.id);
    run.result = {
      chapterId: run.chapter.id,
      passed: true,
      grade: 'B',
      drill: { answered: 0, correct: 0, bestStreak: 0, hintsUsed: 0, score: 0 },
      live: null,
      rewards: { firstClear: false, dojoXpMilli: 0, affinity: [], badgeId: null },
      reviewNotesAdded: 0,
      nextChapterId: nextChapter(this.chapters, completed)?.id ?? null,
    };
    run.phase = 'ended';
    run.updatedAt = this.now();
    this.runs.delete(run.profileId);
  }

  private resolveTeacher(run: StoryRun): StoryTeacherId {
    const teacher = run.chapter.teacher;
    if (teacher === 'partner') return run.partnerId ?? 'miyako';
    return teacher;
  }

  private buildView(run: StoryRun): StoryRunView {
    const step: Step = run.chapter.steps[run.stepIndex];
    return {
      runId: run.runId,
      chapterId: run.chapter.id,
      stepIndex: run.stepIndex,
      stepCount: run.chapter.steps.length,
      stepKind: step.kind,
      phase: run.phase,
      context: { partnerId: run.partnerId, teacherId: this.resolveTeacher(run) },
      drill: null,
      live: null,
      result: run.result,
      startedAt: run.startedAt,
      updatedAt: run.updatedAt,
    };
  }
}

export { BLACK_BELT_FLAG };
