/**
 * 챕터 데이터 집필 헬퍼 — 레슨 「함께 풀기」의 구조화된 상황(`DrillSituation`).
 *
 * 2026-09-03 피드백: 보드가 intro 문장에만 있어 2단계 프롬프트·오답 피드백 때 사라졌다. 이제 guided 블록은
 * 상황을 데이터로 들고 `GuidedBlock`이 `DrillTableView`로 상시 렌더한다 — 문장은 보조, 카드가 주.
 * 카드 표기는 authored 드릴과 같은 'Ks Kh 7d 4c 2s' 문자열(`parseCards`).
 */
import { parseCards } from '@/lib/poker/card-notation';
import type { DrillSituation, DrillVillain } from '../drills/types';

export interface GuidedVillainInput extends Omit<DrillVillain, 'holeCards'> {
  /** 'Qs Qd' 표기 — 공개된 상대 카드가 있을 때만 */
  holeCards?: string;
}

export interface GuidedSituationInput {
  /** 'Ah Kh' — 없으면 "내 카드" 행을 숨긴다(보드만 읽는 문제) */
  hero?: string;
  /** 'Qh 7h 2c' — 없으면 프리플랍 */
  board?: string;
  street?: DrillSituation['street'];
  potChips?: number;
  toCallChips?: number;
  bigBlind?: number;
  heroStackChips?: number;
  heroPosition?: string;
  villains?: GuidedVillainInput[];
  note?: string;
}

const STREET_BY_BOARD: Record<number, DrillSituation['street']> = { 0: 'preflop', 3: 'flop', 4: 'turn', 5: 'river' };

/** 블록 전체 상황 — 생략 필드는 기본값(BB 20 · 스택 2,000 · 팟/콜 0 · 상대 없음)으로 채운다 */
export function guidedSituation(input: GuidedSituationInput): DrillSituation {
  const board = input.board ? parseCards(input.board) : [];
  const villains = (input.villains ?? []).map(villain => {
    const { holeCards, ...rest } = villain;
    return holeCards ? { ...rest, holeCards: parseCards(holeCards) } : rest;
  });
  return {
    hero: input.hero ? parseCards(input.hero) : [],
    board,
    potChips: input.potChips ?? 0,
    toCallChips: input.toCallChips ?? 0,
    bigBlind: input.bigBlind ?? 20,
    heroStackChips: input.heroStackChips ?? 2_000,
    heroPosition: input.heroPosition ?? 'BB',
    street: input.street ?? STREET_BY_BOARD[board.length] ?? 'flop',
    villains,
    ...(input.note ? { note: input.note } : {}),
  };
}

/** 단계별 오버라이드 — 준 필드만 덮어쓴다(예: 2단계에서 홀카드 공개, 상대 벳 뒤 팟·콜 갱신) */
export function guidedStageSituation(input: GuidedSituationInput): Partial<DrillSituation> {
  const out: Partial<DrillSituation> = {};
  if (input.hero !== undefined) out.hero = parseCards(input.hero);
  if (input.board !== undefined) {
    out.board = parseCards(input.board);
    out.street = input.street ?? STREET_BY_BOARD[out.board.length] ?? 'flop';
  } else if (input.street !== undefined) {
    out.street = input.street;
  }
  if (input.potChips !== undefined) out.potChips = input.potChips;
  if (input.toCallChips !== undefined) out.toCallChips = input.toCallChips;
  if (input.bigBlind !== undefined) out.bigBlind = input.bigBlind;
  if (input.heroStackChips !== undefined) out.heroStackChips = input.heroStackChips;
  if (input.heroPosition !== undefined) out.heroPosition = input.heroPosition;
  if (input.villains !== undefined) out.villains = guidedSituation({ villains: input.villains }).villains;
  if (input.note !== undefined) out.note = input.note;
  return out;
}

/** 단계 병합 — 블록 상황 위에 단계 오버라이드를 얹는다(GuidedBlock 렌더와 검증이 같은 함수를 쓴다) */
export function mergeGuidedSituation(base: DrillSituation, override?: Partial<DrillSituation>): DrillSituation {
  return override ? { ...base, ...override } : base;
}
