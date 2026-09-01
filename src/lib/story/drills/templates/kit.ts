/**
 * 드릴 생성 템플릿 공용 키트 — 템플릿 모듈과 `generator.ts`가 함께 쓰는 타입·헬퍼.
 *
 * 이 모듈을 따로 둔 이유: `generator.ts`가 템플릿을 import하므로 공용 타입/헬퍼를
 * generator에 두면 순환 참조가 된다. 의존 방향은 항상 **템플릿 → kit → poker 코어**
 * 한 방향만 유지할 것.
 *
 * 무작위는 전부 주입된 시드 RNG(`seeded-rng.ts`)만 쓴다 — `Math.random` 금지.
 * 같은 시드면 같은 문제가 나와야 서버 채점과 클라 렌더가 일치한다.
 */
import { getCharacterById } from '@/lib/characters';
import { formatCards } from '@/lib/poker/card-notation';
import { positionLabels } from '@/lib/poker/hand-history';
import { unseenCards } from '@/lib/poker/learning';
import { pickOne, randomInt, shuffleWith } from '@/lib/poker/seeded-rng';
import type { Card, Rank, Suit } from '@/lib/poker/types';
import type { StoryTeacherId } from '../../types';
import type { DrillAnswerSpec, DrillSituation, DrillTemplate, DrillVillain } from '../types';

// ---------------------------------------------------------------------------
// 빌더 계약

export type DrillFacts = Record<string, number | string>;

/** 템플릿이 만들어 내는 문항 초안 — 해설·힌트는 generator가 facts로 조립한다. */
export interface DrillDraft {
  situation: DrillSituation;
  question: string;
  answerSpec: DrillAnswerSpec;
  /** 해설·힌트에 쓰이는 수치 전부 */
  facts: DrillFacts;
}

export interface DrillBuildContext {
  rng: () => number;
  teacher: StoryTeacherId;
  bigBlind: number;
  params: Readonly<Record<string, number | string | boolean>>;
}

/** 모호한 상황(정답 비유일·경계·아우츠 0 등)이면 `null` — generator가 seed+1로 리롤한다. */
export type DrillBuilder = (ctx: DrillBuildContext) => DrillDraft | null;

export interface GeneratedDrillDefinition {
  template: DrillTemplate;
  build: DrillBuilder;
}

export function numParam(params: DrillBuildContext['params'], key: string, fallback: number): number {
  const value = params[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

// ---------------------------------------------------------------------------
// 조연 캐릭터 (스파링 상대 풀)

/** 드릴 상황 카드에 등장하는 조연 — 히로인 6명은 출제자라 상대로 쓰지 않는다. */
export const SUPPORT_CHARACTER_IDS: readonly string[] = ['kapi', 'choco', 'mochi', 'draco', 'luna', 'gumi'];

export function characterName(id: string): string {
  return getCharacterById(id)?.name ?? id;
}

/** 같은 문항에 중복 없이 조연 n명을 뽑는다. */
export function pickSupportCharacters(rng: () => number, count: number): string[] {
  if (count > SUPPORT_CHARACTER_IDS.length) {
    throw new Error(`pickSupportCharacters: count ${count} exceeds pool ${SUPPORT_CHARACTER_IDS.length}`);
  }
  return shuffleWith(rng, SUPPORT_CHARACTER_IDS).slice(0, count);
}

// ---------------------------------------------------------------------------
// 카드 · 랭크

export const SUITS: readonly Suit[] = ['spades', 'hearts', 'diamonds', 'clubs'];

const RANK_BY_VALUE: Readonly<Record<number, Rank>> = Object.freeze({
  2: '2', 3: '3', 4: '4', 5: '5', 6: '6', 7: '7', 8: '8', 9: '9',
  10: '10', 11: 'J', 12: 'Q', 13: 'K', 14: 'A',
});
const VALUE_BY_RANK: Readonly<Record<Rank, number>> = Object.freeze({
  '2': 2, '3': 3, '4': 4, '5': 5, '6': 6, '7': 7, '8': 8, '9': 9,
  '10': 10, J: 11, Q: 12, K: 13, A: 14,
});

/** 2~14 (A=14) → Card. 범위를 벗어나면 throw (구성 버그를 조용히 넘기지 않는다). */
export function cardOf(value: number, suit: Suit): Card {
  const rank = RANK_BY_VALUE[value];
  if (!rank) throw new Error(`cardOf: invalid rank value ${value}`);
  return { rank, suit };
}

export function rankValue(rank: Rank): number {
  return VALUE_BY_RANK[rank];
}

export function cardValue(card: Card): number {
  return VALUE_BY_RANK[card.rank];
}

/** [from, to] 정수 배열 (from > to면 빈 배열). */
export function valueRange(from: number, to: number): number[] {
  const out: number[] = [];
  for (let v = from; v <= to; v++) out.push(v);
  return out;
}

/** 알려진 카드를 뺀 덱을 시드 셔플해 앞에서 `count`장. 중복 없이 결정론적으로 뽑는다. */
export function drawCards(rng: () => number, count: number, known: readonly Card[] = []): Card[] {
  const deck = shuffleWith(rng, unseenCards(known));
  if (deck.length < count) throw new Error(`drawCards: not enough cards (${deck.length} < ${count})`);
  return deck.slice(0, count);
}

/** 조건에 맞는 남은 카드 하나 (없으면 null — 호출부가 리롤한다). */
export function pickCardWhere(
  rng: () => number,
  known: readonly Card[],
  predicate: (card: Card) => boolean,
): Card | null {
  const pool = unseenCards(known).filter(predicate);
  if (pool.length === 0) return null;
  return pickOne(rng, pool);
}

export function formatBoard(cards: readonly Card[]): string {
  return cards.length === 0 ? '-' : formatCards(cards);
}

// ---------------------------------------------------------------------------
// 좌석 · 포지션 (6-max)

export const TABLE_SIZE = 6;
/** 스택 기준 — 문항은 전부 100BB 딥으로 통일한다. */
export const STACK_BB = 100;

export interface SeatLayout {
  dealerSeat: number;
  /** seatIndex → 포지션 라벨 */
  positions: readonly string[];
}

export function seatLabels(): string[] {
  return positionLabels(TABLE_SIZE);
}

export function makeSeatLayout(rng: () => number): SeatLayout {
  const dealerSeat = randomInt(rng, TABLE_SIZE);
  const labels = seatLabels();
  const positions: string[] = new Array<string>(TABLE_SIZE);
  for (let seat = 0; seat < TABLE_SIZE; seat++) {
    positions[seat] = labels[(seat - dealerSeat + TABLE_SIZE) % TABLE_SIZE];
  }
  return { dealerSeat, positions };
}

/** 포지션 라벨을 가진 좌석 번호. */
export function seatOfPosition(layout: SeatLayout, position: string): number {
  const seat = layout.positions.indexOf(position);
  if (seat < 0) throw new Error(`seatOfPosition: unknown position ${position}`);
  return seat;
}

/** 프리플랍 액션 순서 (UTG 먼저) */
export function preflopSeatOrder(layout: SeatLayout): number[] {
  return [3, 4, 5, 0, 1, 2].map(offset => (layout.dealerSeat + offset) % TABLE_SIZE);
}

/** 포스트플랍 액션 순서 (SB 먼저, 버튼 마지막) */
export function postflopSeatOrder(layout: SeatLayout): number[] {
  return [1, 2, 3, 4, 5, 0].map(offset => (layout.dealerSeat + offset) % TABLE_SIZE);
}

export interface SeatVillainOptions {
  stackChips: number;
  /** 포지션이 곧 정답인 문항(pos-name)에서는 '?'로 덮어써 답을 감춘다 */
  positionOverride?: string;
  holeCards?: Card[];
  rangeTag?: string;
}

export function makeVillain(
  layout: SeatLayout,
  seatIndex: number,
  characterId: string,
  options: SeatVillainOptions,
): DrillVillain {
  const villain: DrillVillain = {
    seatIndex,
    characterId,
    position: options.positionOverride ?? layout.positions[seatIndex],
    stackChips: options.stackChips,
  };
  if (options.rangeTag) villain.rangeTag = options.rangeTag;
  if (options.holeCards) villain.holeCards = options.holeCards.map(card => ({ ...card }));
  return villain;
}

// ---------------------------------------------------------------------------
// 선택지

export interface Choice {
  options: string[];
  correctIndex: number;
}

/**
 * 정답 1 + 오답 `total-1`개를 섞은 선택지. 후보가 모자라면 null(리롤).
 * `distractors`는 우선순위 순으로 주고, 실제 배치 순서는 시드로 섞는다.
 */
export function makeChoice(
  rng: () => number,
  correct: string,
  distractors: readonly string[],
  total: number,
): Choice | null {
  const picked: string[] = [];
  for (const candidate of distractors) {
    if (candidate === correct || picked.includes(candidate)) continue;
    picked.push(candidate);
    if (picked.length === total - 1) break;
  }
  if (picked.length !== total - 1) return null;
  const options = shuffleWith(rng, [correct, ...picked]);
  return { options, correctIndex: options.indexOf(correct) };
}

// ---------------------------------------------------------------------------
// 수치 표기

/** 소수 첫째 자리 반올림 (해설 표기용 — 12.34 → 12.3). */
export function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

/** 팟오즈를 'n:1' 문자열로 (150:50 → '3:1'). */
export function formatRatio(ratio: number): string {
  return `${round1(ratio)}:1`;
}

/** bb=20 기준으로 적은 칩 금액을 실제 BB로 환산. */
export function scaleChips(base: number, bigBlind: number): number {
  return Math.round((base * bigBlind) / 20);
}

export const STREET_KO: Readonly<Record<string, string>> = Object.freeze({
  preflop: '프리플랍',
  flop: '플랍',
  turn: '턴',
  river: '리버',
  showdown: '쇼다운',
});
