/**
 * 스토리 모드 소켓/HTTP DTO — 서버 코디네이터가 만들고 클라 story-store가 소비한다.
 * 씬·레슨 본문은 클라이언트가 가진 챕터 데이터(STORY_CHAPTERS)에서 stepIndex로 읽으므로 실어 보내지 않는다.
 * 드릴은 서버가 생성한 인스턴스를 `DrillInstancePublic`(정답 제거)으로만 내려보낸다.
 */
import type { ActionType, Street } from '@/lib/poker/types';
import type { DrillAnswer, DrillInstancePublic, DrillResult } from './drills/types';
import type { ChapterGrade, ChapterId, ObjectiveKind, StepKind, StoryAct, StoryBelt, StoryHeroineId, StoryTeacherId } from './types';

export type StoryRunPhase = 'failure-scene' | 'scene' | 'lesson' | 'drill' | 'live-hold' | 'live-play' | 'result' | 'ended';
/**
 * 런 모드 — 'full'은 챕터 전체, 'exam'은 **실력 확인**: 드릴 세트만 풀고(씬·레슨·라이브 스킵, 힌트 없음)
 * `EXAM_PASS_SCORE` 이상이면 완료로 기록한다. 아는 내용을 억지로 플레이하지 않게 하는 우회로(2026-09-03 피드백 ②).
 */
export type StoryRunMode = 'full' | 'exam';
export type StoryHoldReason = 'scene' | 'timeout' | 'room-lost';

export interface StoryDrillView {
  setId: string;
  /** 명령 커서 — 세트 안에서 단조 증가(재출제 패스는 total + retry.index). stale 검사 키 */
  index: number;
  /** 첫 패스 슬롯 수 — 세트 동안 불변 (오답으로 늘어나지 않는다, 2026-09-03) */
  total: number;
  /** 재출제 패스 중이면 패스 내 위치, 아니면 null */
  retry: { index: number; total: number } | null;
  /** 첫 패스가 끝나고 오답이 남았을 때의 오퍼 — [다시 풀기 count문] / [복습 노트에 넣고 넘어가기] */
  retryOffer: { count: number } | null;
  instance: DrillInstancePublic;
  streak: number;
  /** 첫 패스 힌트만(S 판정 기준) — 재출제 힌트는 세지 않는다 */
  hintsUsed: number;
  /** 재출제 대기 문항 수 (첫 패스: 지금까지 오답 슬롯 / 재출제 패스: 현재 문항 뒤에 남은 문항) */
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

// ---------------------------------------------------------------------------
// 보상 (2026-09-03 보상 체계 — 정의·자격 판정은 `src/lib/story/rewards/catalog.ts` 단일 소스)

export type StoryRewardKind = 'title' | 'card-back' | 'felt' | 'outfit' | 'cg' | 'throwable' | 'chips';

export type StoryRewardTrigger =
  | { kind: 'chapter-first-clear'; chapterId: ChapterId }
  | { kind: 'chapter-grade'; chapterId: ChapterId; grade: 'S' }
  | { kind: 'act-complete'; act: StoryAct }
  | { kind: 'flag'; key: string; label: string };

export interface StoryRewardItemView {
  id: string;
  kind: StoryRewardKind;
  name: string;
  description: string;
  characterId?: StoryHeroineId;
  /** CG·썸네일 경로 — 없으면 클라가 kind별 SVG 아이콘/의상 아트로 그린다 */
  art?: string;
  /** kind 'outfit'의 의상 id (character-art 매니페스트 키) */
  outfitId?: string;
  chipAmount?: number;
}

/** 허브·결산 「다음 보상」 미리보기 — 조건 문구 + 획득 여부 */
export interface StoryRewardPreview extends StoryRewardItemView {
  trigger: StoryRewardTrigger;
  /** '기다림의 미학 S등급' 같은 조건 문구 */
  requirement: string;
  granted: boolean;
}

export interface StoryRewardCutsceneView {
  /** 보상 아이템 id (CG) */
  id: string;
  kind: 'event-cg' | 'belt' | 'boss-win';
  characterId: StoryHeroineId | 'miyako';
  title: string;
  caption: string;
  art: string;
}

/** 이 결산의 인연 지급으로 새로 열린 인연 씬 (bond-scenes 매니페스트) */
export interface StoryUnlockedSceneView {
  id: string;
  characterId: string;
  level: number;
  title: string;
  caption: string;
  art: string;
}

export interface ChapterResultRewards {
  firstClear: boolean;
  dojoXpMilli: number;
  affinity: Array<{ characterId: StoryHeroineId; milli: number; levelBefore?: number; levelAfter?: number }>;
  /** @deprecated 호환용 — items 중 첫 title id (서버 보상 라인 전엔 챕터 데이터의 badgeId) */
  badgeId: string | null;
  /** 이 결산에서 새로 지급된 아이템(칩 제외) — 서버 보상 라인(v31) 전엔 미정의 → 클라 폴백 */
  items?: StoryRewardItemView[];
  /** 이 결산 칩 합계 */
  chips?: number;
  /** 새 CG 중 우선 1개(보스 > 띠 > 에필로그) — 결산 풀스크린 컷신 */
  cutscene?: StoryRewardCutsceneView | null;
  unlockedScenes?: StoryUnlockedSceneView[];
  /** 이 챕터·현재 막의 미획득 보상 미리보기 ("다음 S에 하나 의상") */
  next?: StoryRewardPreview[];
}

export interface ChapterResultView {
  sparringRetry?: { expiresAt: number } | null;
  chapterId: ChapterId;
  mode: StoryRunMode;
  passed: boolean;
  grade: ChapterGrade;
  drill: {
    answered: number; correct: number; bestStreak: number; hintsUsed: number; score: number;
    /** 출제 슬롯 수 / 최종 정답 슬롯 수 */
    slots: number; finalCorrect: number;
    /** 모든 세트가 첫 패스 무오답·힌트 0 (「퍼펙트」) */
    perfect: boolean;
    /** 재출제를 건너뛰고 복습 노트로 보냈는가 */
    retrySkipped: boolean;
  };
  live: { objectives: ObjectiveProgressView[]; handsPlayed: number; netBB: number } | null;
  rewards: ChapterResultRewards;
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
  /** 스토리 보상 카탈로그 전체의 획득 여부 (허브 카드 칩·갤러리) — 서버 보상 라인 전엔 미정의 */
  rewards?: StoryRewardPreview[];
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
  | { runId: string; setId: string; index: number; action: 'hint' }
  /** 재출제 오퍼 응답 — 오퍼 중(`retryOffer`)에만 유효 */
  | { runId: string; setId: string; index: number; action: 'retry' }
  | { runId: string; setId: string; index: number; action: 'skip-retry' };

export type StoryDrillAck =
  | { action: 'answer'; result: DrillResult }
  | { action: 'hint'; hint: string }
  | { action: 'retry'; count: number }
  | { action: 'skip-retry'; skipped: number };

export interface StoryQuizRequest {
  runId: string;
  quizId: string;
  optionIndex: number;
}

export interface AbandonStoryRequest {
  runId: string;
}
