/**
 * 「수련 스토리 모드」 공유 타입 — 챕터 데이터(수기 TS), 서버 코디네이터, 클라 허브/스테이지가 공유한다.
 * 기획: docs/spec-story-mode-2026-09.md (Part B2).
 *
 * 원칙:
 * - 히로인 루트는 인연 DB CHECK와 같은 6명(PROGRESSION_CHARACTER_IDS). 조연 10명은 스파링 상대로만 등장한다.
 * - 라이브 스텝(practice-table / sparring)은 코디네이터에 라이브 어댑터가 없으면 스킵된다(Phase 1 출시 가능).
 * - 통과 = 드릴 세트 완료 + primary 행동 목표. 결과 조건(스택 등)은 bonus에만 둔다(A5-2 통과 규약).
 */
import type { Expression } from '@/lib/assets/character-art';
import type { MusicMood } from '@/lib/sound/music-library';
import type { RoomDifficulty } from '@/lib/poker/types';
import { PROGRESSION_CHARACTER_IDS, type ProgressionCharacterId } from '@/lib/progression/types';
import type { DrillAnswerSpec, DrillSituation } from './drills/types';

// ---------------------------------------------------------------------------
// 인물

export const STORY_HEROINE_IDS = PROGRESSION_CHARACTER_IDS;
export type StoryHeroineId = ProgressionCharacterId;
const HEROINE_SET: ReadonlySet<string> = new Set(STORY_HEROINE_IDS);
export function isStoryHeroineId(value: unknown): value is StoryHeroineId {
  return typeof value === 'string' && HEROINE_SET.has(value);
}

/** 출제·해설자: 히로인 6명 + 진행자 미야코. 'partner'는 런타임에 선택 파트너로 해석된다. */
export type StoryTeacherId = StoryHeroineId | 'miyako';
export type StoryTeacherRef = StoryTeacherId | 'partner';
export function isStoryTeacherRef(value: unknown): value is StoryTeacherRef {
  return value === 'miyako' || value === 'partner' || isStoryHeroineId(value);
}

/** 씬 화자: 캐릭터 id(히로인·미야코·조연) | 'partner' | 'player' | 'narrator' */
export type SceneSpeaker = string;

// ---------------------------------------------------------------------------
// 띠 · 막

export const STORY_BELTS = ['white', 'yellow', 'blue', 'brown', 'black'] as const;
export type StoryBelt = typeof STORY_BELTS[number];
export type StoryAct = 1 | 2 | 3 | 4;
/** 'act1-ch01' 형식 */
export type ChapterId = string;
export type ChapterGrade = 'S' | 'A' | 'B';

// ---------------------------------------------------------------------------
// 씬(VN)

/** 씬 라인 BGM — music-library의 mood. 'story'는 story-calm의 옛 이름(호환) */
export type StoryMusic = MusicMood | 'story';

/** 씬 라인 `effect: 'sfx:<name>'`에 허용하는 합성 효과음 (effects.ts SoundName의 부분집합) */
export const SCENE_SFX = ['reward', 'unlock', 'level-up', 'combo', 'all-in', 'win', 'big-win', 'flip'] as const;
export type SceneSfx = typeof SCENE_SFX[number];
/** 라인 연출 — 흔들림/플래시/줌은 reduced-motion에서 생략, sfx만 유지 */
export type SceneEffect = 'shake' | 'flash' | 'zoom' | `sfx:${SceneSfx}`;

export function isSceneEffect(value: unknown): value is SceneEffect {
  if (typeof value !== 'string') return false;
  if (value === 'shake' || value === 'flash' || value === 'zoom') return true;
  return value.startsWith('sfx:') && (SCENE_SFX as readonly string[]).includes(value.slice('sfx:'.length));
}

export interface SceneSayLine {
  kind: 'say';
  speaker: SceneSpeaker;
  text: string;
  expression?: Expression;
  /** 배경 id (character-art 매니페스트 외 스토리 배경 — 없으면 로비 배경 폴백) */
  bg?: string;
  music?: StoryMusic;
  /**
   * 풀스크린 씬 CG id(`assets/story-cgs.ts`) — bg와 달리 **이 라인에서만** 보이고 다음 라인에서 스프라이트로 돌아간다.
   * 아트 미배치 id는 무시(스프라이트 폴백) — 코드는 아트를 기다리지 않는다.
   */
  cg?: string;
  /** 라인 진입 시 1회 연출 */
  effect?: SceneEffect;
}

export interface SceneChoiceOption {
  id: string;
  text: string;
  /** 선택 시 저장되는 플래그 (추가만, 리셋 없음) */
  setFlags?: Record<string, string>;
  /** 선택 직후 재생되는 반응 대사 */
  reply?: SceneSayLine[];
}

export interface SceneChoice {
  id: string;
  prompt?: string;
  options: SceneChoiceOption[];
}

export type SceneLine = SceneSayLine | { kind: 'choice'; choice: SceneChoice };

export interface Scene {
  id: string;
  lines: SceneLine[];
  /** 모든 플래그가 일치할 때만 재생 (에필로그 변주 등) */
  requiresFlags?: Record<string, string>;
}

// ---------------------------------------------------------------------------
// 레슨(개념 카드 · 함께 풀기)

export interface GuidedStage {
  prompt: string;
  answer: DrillAnswerSpec;
  onCorrect: string;
  onWrong: string;
  /** 이 단계에서만 덮어쓰는 상황(예: 홀카드 공개·상대 벳 뒤 팟/콜) — 블록 `situation` 위에 병합 */
  situation?: Partial<DrillSituation>;
}

export type LessonBlock =
  | { kind: 'text'; speaker: SceneSpeaker; text: string }
  | { kind: 'concept-card'; title: string; body: string; formula?: string }
  | {
    kind: 'guided';
    teacher: StoryTeacherRef;
    intro: string;
    /**
     * 구조화된 상황(보드·내 카드·팟·콜·상대) — `GuidedBlock`이 단계·피드백과 무관하게 카드로 상시 렌더한다.
     * 문장(intro/prompt)에만 보드를 적으면 다음 단계에서 사라진다(2026-09-03 피드백 ①). `chapters/helpers.ts guidedSituation`.
     */
    situation: DrillSituation;
    stages: GuidedStage[];
  };

// ---------------------------------------------------------------------------
// 드릴 세트

export type DrillSeedPolicy = 'fixed' | 'per-run' | 'daily';

export interface DrillSlot {
  templateId: string;
  seedPolicy: DrillSeedPolicy;
  fixedSeed?: number;
}

// ---------------------------------------------------------------------------
// 라이브 스텝 (Phase 1b)

export type HintLevel = 0 | 1 | 2 | 3 | 4;

export interface LineupSeat {
  seatIndex: number;
  /** 캐릭터 id 또는 'partner'(선택 파트너) */
  characterId: string;
  stackBB: number;
  role?: 'teacher' | 'boss' | 'partner' | 'neighbor';
}

export interface MasqueradePolicy {
  id: 'masquerade-v1';
  seats: number[];
  observeHands: 12;
  revealedMinHands: 2;
  revealedMaxHands: 10;
}
export interface LiveTableSpec {
  masquerade?: MasqueradePolicy;
  blinds: { small: number; big: number };
  heroSeat: number;
  heroStackBB: number;
  lineup: LineupSeat[];
  difficulty: RoomDifficulty;
  turnTimeSec: number;
  /** 봇 사고 지연 배율 (1 = 기본, 0.5 = 두 배 빠름) */
  botThinkScale: number;
  hints: HintLevel;
}

/** 'As Kd' 표기. villains 키는 좌석 index. 미지정 카드는 CSPRNG. */
export interface DealScript {
  hero: string;
  villains?: Record<number, string>;
  board?: string;
}

export const OBJECTIVE_KINDS = [
  'hands-played',
  'win-hands',
  'net-chips',
  'fold-preflop-junk',
  'no-junk-entry',
  'cbet-when-aggressor',
  'correct-pot-odds-call',
  'value-bet-river',
  'survive',
  'quiz-accuracy',
  'opponent-response',
  // 2026-09-03 미션형 목표 — "N핸드 채우기" 대신 행동 한 번을 채우면 끝나는 종류
  'reach-showdown',
  'fold-hands',
  'open-raise',
  // 2막 (2026-09-03) — 스틸·c벳·밸류·3벳 대면. 전부 "기회 중 실행" 또는 위반 상한형(objectives.ts 참조)
  'no-limp',
  'steal-open',
  'no-air-river-bet',
  'value-bet-sizing',
  'premium-3bet',
  'fold-vs-3bet-junk',
  'no-junk-4bet',
] as const;
export type ObjectiveKind = typeof OBJECTIVE_KINDS[number];

/**
 * 행동 목표. 비율형은 항상 "기회 중 실행"(minRatio) — 기회 0이면 판정에서 제외한다.
 * 카드 분포에 좌우되는 절대 비율(VPIP 등)은 두지 않는다(A5-2 목표 규약).
 */
export interface Objective {
  id: string;
  kind: ObjectiveKind;
  label: string;
  /** 횟수 목표 (≥ target). 비율형 kind에선 실행 횟수 — 기회가 0이면 판정 불가(null)로 빠진다 */
  target?: number;
  /** 허용 상한 (≤ maxCount) — 상한형 kind는 횟수, 비율형 kind에선 위반(기회 − 실행) 횟수 */
  maxCount?: number;
  /** 기회 중 실행 비율 (0~1) */
  minRatio?: number;
  params?: Record<string, number | string>;
}

export type InterruptTrigger =
  | { kind: 'hand-index'; index: number }
  | { kind: 'first-my-turn' }
  | { kind: 'first-showdown' }
  | { kind: 'halfway' };

export interface Interrupt {
  id: string;
  trigger: InterruptTrigger;
  scene: Scene;
}

// ---------------------------------------------------------------------------
// 스텝

export type Step =
  | { kind: 'scene'; id: string; scene: Scene }
  | { kind: 'lesson'; id: string; title: string; blocks: LessonBlock[] }
  | {
      kind: 'drill-set';
      id: string;
      title: string;
      teacher: StoryTeacherRef;
      drills: DrillSlot[];
      // (2026-09-03) `passRule.minCorrect`는 삭제 — 어디서도 통과·지급에 쓰이지 않던 죽은 데이터였다.
      // 드릴 품질은 등급(S/A/B)·「퍼펙트」 플래그·실력 확인 0.85 게이트로만 표현한다.
      /** 힌트 사용 문항의 점수 배율 (기본 0.5) */
      hintPenalty: number;
    }
  | {
      kind: 'practice-table';
      id: string;
      tag: '연습';
      table: LiveTableSpec;
      scripts: DealScript[];
      perHandPrompt?: string;
    }
  | {
      kind: 'sparring';
      id: string;
      tag: '대결';
      table: LiveTableSpec;
      maxHands: number;
      /**
       * 미션형 조기 종료 — primary 목표가 **전부** 달성(판정 불가 없음)되면 이 핸드 수부터 스텝을 끝낸다.
       * 없으면 maxHands까지 돈다. 기본은 "목표를 채우면 끝"이지 "N핸드 채우기"가 아니다(2026-09-03 피드백 ③).
       */
      minHands?: number;
      objectives: { primary: Objective[]; bonus: Objective[] };
      interrupts: Interrupt[];
    }
  | { kind: 'result'; id: string };

export type StepKind = Step['kind'];
export const LIVE_STEP_KINDS: ReadonlySet<StepKind> = new Set<StepKind>(['practice-table', 'sparring']);

// ---------------------------------------------------------------------------
// 보상 · 챕터

export interface AffinityGrant {
  /** 히로인 id | 'partner'(선택 파트너) | 'all'(6명 전원) */
  target: StoryHeroineId | 'partner' | 'all';
  milli: number;
}

export interface ChapterRewards {
  first: { dojoXpMilli: number; affinity: AffinityGrant[]; badgeId?: string; unlockIds?: string[] };
  replay: { dojoXpMilli: number };
  /** 등급별 가산 도장 XP(밀리) — 배수가 아니라 고정액 (A9) */
  gradeBonusMilli: Partial<Record<ChapterGrade, number>>;
}

export interface Chapter {
  id: ChapterId;
  act: StoryAct;
  /** 막 안 순서 (1부터) */
  order: number;
  title: string;
  subtitle: string;
  /** 담당 교사 */
  teacher: StoryTeacherRef;
  /** 통과 시 도달하는 띠 (막 마지막 챕터만 승급, 나머지는 현재 띠 유지) */
  belt: StoryBelt;
  requires: ChapterId[];
  steps: Step[];
  failScene?: Scene;
  rewards: ChapterRewards;
  estimatedMinutes: number;
}

export function chapterIdOf(act: StoryAct, order: number): ChapterId {
  return `act${act}-ch${String(order).padStart(2, '0')}`;
}
