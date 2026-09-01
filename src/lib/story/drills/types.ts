/**
 * 드릴(수련 문제) 도메인 타입 — 서버(생성·채점)와 클라(렌더·입력)가 공유한다.
 *
 * 계약:
 * - `DrillInstance`는 정답·해설을 포함한 서버 원본. 클라이언트에는 `DrillInstancePublic`만 나간다
 *   (`toPublicDrillInstance` — drills/public.ts). 정답 판정은 항상 서버가 같은 seed로 재생성해 수행한다.
 * - 카테고리 문자열은 DB `drill_attempts.category`에 그대로 저장되므로 길이 32 이내를 유지한다.
 */
import type { ActionType, Card, Street } from '@/lib/poker/types';
import type { StoryTeacherId } from '../types';

export const DRILL_CATEGORIES = [
  'pot-odds',        // D-ODDS
  'outs',            // D-OUTS
  'equity',          // D-EQ
  'combos',          // D-COMBO
  'hand-ranking',    // D-RANK
  'position',        // D-POS
  'range',           // D-RANGE
  'call-decision',   // D-CALL
  'breakeven',       // D-BE
  'mdf',             // D-MDF
  'opponent-type',   // D-TYPE
  'sizing',          // D-SIZE
  'action-judgment', // D-ACT
  'hand-reading',    // D-READ
  'sng-math',        // D-SNG
] as const;
export type DrillCategory = typeof DRILL_CATEGORIES[number];

export const DRILL_CATEGORY_SET: ReadonlySet<string> = new Set(DRILL_CATEGORIES);
export function isDrillCategory(value: unknown): value is DrillCategory {
  return typeof value === 'string' && DRILL_CATEGORY_SET.has(value);
}

export type DrillNumericUnit = '%' | 'x' | 'combos' | 'outs' | 'chips' | 'bb';

/** 서버 원본 정답 사양 — 클라이언트로 보내지 않는다. */
export type DrillAnswerSpec =
  | { kind: 'multiple-choice'; options: string[]; correctIndex: number }
  | { kind: 'numeric'; correct: number; tolerance: number; unit: DrillNumericUnit; min: number; max: number }
  | { kind: 'card-pick'; candidates: Card[]; correct: Card[]; pickCount: number }
  | { kind: 'action-pick'; options: ActionType[]; correct: ActionType[]; sizingBB?: { min: number; max: number } }
  | { kind: 'multi-select'; options: string[]; correctIndices: number[] };

export type DrillAnswerKind = DrillAnswerSpec['kind'];

/** 클라이언트에 노출되는 사양 — 정답 필드가 구조적으로 존재하지 않는다. */
export type DrillAnswerSpecPublic =
  | { kind: 'multiple-choice'; options: string[] }
  | { kind: 'numeric'; unit: DrillNumericUnit; min: number; max: number }
  | { kind: 'card-pick'; candidates: Card[]; pickCount: number }
  | { kind: 'action-pick'; options: ActionType[]; sizingBB?: { min: number; max: number } }
  | { kind: 'multi-select'; options: string[] };

/** 클라이언트가 제출하는 답 — 소켓 파서가 kind별로 정규화한다. */
export type DrillAnswer =
  | { kind: 'multiple-choice'; index: number }
  | { kind: 'numeric'; value: number }
  | { kind: 'card-pick'; cards: Card[] }
  | { kind: 'action-pick'; action: ActionType; sizingBB?: number }
  | { kind: 'multi-select'; indices: number[] };

export interface DrillVillain {
  seatIndex: number;
  /** 캐릭터 id (조연 포함) — 상황 카드의 아바타·유형 배지용 */
  characterId: string;
  position: string;
  /** '스테이션' 같은 유형 라벨 (D-TYPE 등) */
  rangeTag?: string;
  /** 'QQ+, AK' 표기 — 콤보/리딩 문항 */
  range?: string;
  stackChips: number;
  /** 알려진 홀카드 (아우츠 문항 등) — 미공개면 생략 */
  holeCards?: Card[];
}

export interface DrillSituation {
  hero: Card[];
  board: Card[];
  /** 상대 벳까지 포함한 현재 중앙 총액 (A4 D-ODDS 팟 정의) */
  potChips: number;
  /** 히어로가 콜하려면 내야 하는 금액 (0이면 체크 가능) */
  toCallChips: number;
  bigBlind: number;
  heroStackChips: number;
  heroPosition: string;
  street: Street;
  villains: DrillVillain[];
  /** 상황 카드 하단 한 줄 설명 (선택) */
  note?: string;
}

export type DrillDifficulty = 1 | 2 | 3;

export type DrillTemplateSource =
  | { kind: 'generated'; params: Record<string, number | string | boolean> }
  | { kind: 'authored'; instance: Omit<DrillInstance, 'templateId' | 'seed'> };

export interface DrillTemplate {
  id: string;
  category: DrillCategory;
  title: string;
  difficulty: DrillDifficulty;
  /** 문항당 힌트는 1회만 노출되지만 데이터는 순서대로 여러 개 둘 수 있다(첫 항목 사용) */
  hints: string[];
  source: DrillTemplateSource;
}

export interface DrillExplanation {
  /** 히로인 말투로 완성된 해설 본문 */
  text: string;
  speaker: StoryTeacherId;
  /** 해설에 쓰인 수치 — 클라이언트 facts 표 렌더용 */
  facts: Record<string, number | string>;
}

export interface DrillInstance {
  templateId: string;
  seed: number;
  category: DrillCategory;
  situation: DrillSituation;
  question: string;
  answerSpec: DrillAnswerSpec;
  hint: string | null;
  explanation: DrillExplanation;
}

export interface DrillInstancePublic {
  templateId: string;
  seed: number;
  category: DrillCategory;
  situation: DrillSituation;
  question: string;
  answerSpec: DrillAnswerSpecPublic;
  /** 힌트는 요청(useHint) 전엔 노출하지 않는다 — 힌트 존재 여부만 */
  hasHint: boolean;
}

/** 채점 결과 — 서버 ack 및 story-update의 lastDrillResult */
export interface DrillResult {
  templateId: string;
  seed: number;
  correct: boolean;
  /** 정답 공개용 사양(채점 뒤에만 내려간다) */
  correctAnswer: DrillAnswerSpec;
  explanation: DrillExplanation;
  hintsUsed: number;
  streak: number;
  elapsedMs: number;
}
