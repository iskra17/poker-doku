/**
 * 스토리 모드 소켓/HTTP DTO — 서버 코디네이터가 만들고 클라 story-store가 소비한다.
 * 씬·레슨 본문은 클라이언트가 가진 챕터 데이터(STORY_CHAPTERS)에서 stepIndex로 읽으므로 실어 보내지 않는다.
 * 드릴은 서버가 생성한 인스턴스를 `DrillInstancePublic`(정답 제거)으로만 내려보낸다.
 */
import type { ActionType, Street } from '@/lib/poker/types';
import type { DrillAnswer, DrillInstancePublic, DrillResult } from './drills/types';
import type { ChapterGrade, ChapterId, ObjectiveKind, StepKind, StoryBelt, StoryHeroineId, StoryTeacherId } from './types';

export type StoryRunPhase = 'scene' | 'lesson' | 'drill' | 'live-hold' | 'live-play' | 'result' | 'ended';
/**
 * 런 모드 — 'full'은 챕터 전체, 'exam'은 **실력 확인**: 드릴 세트만 풀고(씬·레슨·라이브 스킵, 힌트 없음)
 * `EXAM_PASS_SCORE` 이상이면 완료로 기록한다. 아는 내용을 억지로 플레이하지 않게 하는 우회로(2026-09-03 피드백 ②).
 */
export type StoryRunMode = 'full' | 'exam';
export type StoryHoldReason = 'scene' | 'timeout' | 'room-lost';

export interface StoryDrillView {
  setId: string;
  index: number;
  total: number;
  instance: DrillInstancePublic;
  streak: number;
  hintsUsed: number;
  /** 세트 끝 재출제 대기 중인 문항 수 */
  wrongQueue: number;
  /** 이 문항에서 힌트를 열었으면 본문, 아니면 null */
  hint: string | null;
  lastResult: DrillResult | null;
  answered: number;
  correct: number;
}

export interface ObjectiveProgressView {
  id: string;
  kind: ObjectiveKind;
  label: string;
  primary: boolean;
  progress: number;
  target: number | null;
  /** 아직 판정 불가(기회 0 등)면 null */
  achieved: boolean | null;
}

export type DecisionMark = 'good' | 'hmm' | 'warn';

export interface DecisionVerdict {
  street: Street;
  action: ActionType;
  amount: number;
  mark: DecisionMark;
  reason: string;
  facts: { potOdds?: number; equity?: number; outs?: number };
}

export interface DecisionReview {
  handNumber: number;
  verdicts: DecisionVerdict[];
}

/** 봇 속마음 — 카테고리·대사만, 카드 정보 없음. 스토리 방 유일 휴먼에게만 간다. */
export interface BotThought {
  handNumber: number;
  playerId: string;
  characterId: string;
  street: Street;
  action: ActionType;
  reason: string;
  text: string;
}

export interface HandReadQuizView {
  quizId: string;
  prompt: string;
  options: string[];
  expiresAt: number;
}

export interface StoryLiveView {
  roomId: string | null;
  tag: '연습' | '대결';
  hold: boolean;
  holdReason: StoryHoldReason | null;
  /** holdReason 'scene'일 때 재생할 인터럽트 id (챕터 데이터의 step.interrupts에서 조회) */
  interruptId: string | null;
  objectives: ObjectiveProgressView[];
  handsPlayed: number;
  maxHands: number;
  /** 미션형 조기 종료가 열리는 최소 핸드 수 — null이면 maxHands까지 돈다 */
  minHands: number | null;
  lastReview: DecisionReview | null;
  botThoughts: BotThought[];
  pendingQuiz: HandReadQuizView | null;
}

export interface ChapterResultView {
  chapterId: ChapterId;
  mode: StoryRunMode;
  passed: boolean;
  grade: ChapterGrade;
  drill: { answered: number; correct: number; bestStreak: number; hintsUsed: number; score: number };
  live: { objectives: ObjectiveProgressView[]; handsPlayed: number; netBB: number } | null;
  rewards: {
    firstClear: boolean;
    dojoXpMilli: number;
    affinity: Array<{ characterId: StoryHeroineId; milli: number }>;
    badgeId: string | null;
  };
  reviewNotesAdded: number;
  nextChapterId: ChapterId | null;
  /** 이 완주로 띠가 올랐으면 새 띠 — 결산이 승급 연출을 맡는다(에필로그는 순서를 가정하지 않는다) */
  beltAwarded: StoryBelt | null;
}

export interface StoryRunView {
  runId: string;
  chapterId: ChapterId;
  mode: StoryRunMode;
  stepIndex: number;
  stepCount: number;
  stepKind: StepKind;
  phase: StoryRunPhase;
  /** 런타임에 확정된 인물 — 'partner' 참조 해석 결과 */
  context: { partnerId: StoryHeroineId | null; teacherId: StoryTeacherId };
  drill: StoryDrillView | null;
  live: StoryLiveView | null;
  result: ChapterResultView | null;
  startedAt: number;
  updatedAt: number;
}

export interface StoryChapterProgressView {
  chapterId: ChapterId;
  attempts: number;
  completions: number;
  bestGrade: ChapterGrade | null;
  unlocked: boolean;
}

export interface StoryDailyView {
  /** KST 날짜 'YYYY-MM-DD' */
  date: string;
  done: number;
  total: number;
  /** Ch1 완료 후 개방 */
  available: boolean;
  teacherId: StoryTeacherId | null;
}

export interface StoryProgressView {
  chapters: StoryChapterProgressView[];
  flags: Record<string, string>;
  belt: StoryBelt;
  nextChapterId: ChapterId | null;
  drillStats: { total: number; correct: number; byCategory: Record<string, { total: number; correct: number }> };
  reviewQueue: number;
  daily: StoryDailyView;
  activeRun: { runId: string; chapterId: ChapterId; stepIndex: number; mode: StoryRunMode } | null;
}

// ---------------------------------------------------------------------------
// 클라 → 서버 요청 (socket-payload.ts가 정규화한다)

export interface StartStoryChapterRequest {
  chapterId: ChapterId;
  /** 생략 = 'full' */
  mode?: StoryRunMode;
}

export type StoryAdvanceTarget = 'next' | 'skip' | 'resume';

export interface StoryAdvanceRequest {
  runId: string;
  expectedStepIndex: number;
  target: StoryAdvanceTarget;
}

export interface StoryChoiceRequest {
  runId: string;
  expectedStepIndex: number;
  choiceId: string;
  optionId: string;
}

export type StoryDrillRequest =
  | { runId: string; setId: string; index: number; action: 'answer'; answer: DrillAnswer; elapsedMs: number }
  | { runId: string; setId: string; index: number; action: 'hint' };

export type StoryDrillAck =
  | { action: 'answer'; result: DrillResult }
  | { action: 'hint'; hint: string };

export interface StoryQuizRequest {
  runId: string;
  quizId: string;
  optionIndex: number;
}

export interface AbandonStoryRequest {
  runId: string;
}
