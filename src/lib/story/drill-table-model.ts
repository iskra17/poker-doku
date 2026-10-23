/**
 * 수련 문제 테이블 모델 — `DrillSituation`(공개 사양) → 6-max 타원 테이블의 좌석 배치. 순수 함수만 둔다.
 *
 * 좌표계: 표시 슬롯 0~5는 `table-layout.ts`의 `SEATS` 순서(0 하단 중앙=히어로, 시계 방향 증가).
 * 실제 좌석 번호도 시계 방향으로 증가하므로 `slot = (seat - heroSeat) mod 6`이다 (`toDisplayIndex`와 같은 회전).
 *
 * 배치 우선순위:
 *  1. 공개 필드 `heroSeatIndex`/`dealerSeatIndex`(포지션 템플릿) — 빌런은 자기 `seatIndex`에 앉는다.
 *  2. 포지션 라벨(`positionLabels(6)` = BTN·SB·BB·UTG·HJ·CO, 딜러 기준 시계 방향 오프셋)에서 상대 위치를 역산.
 *  3. 라벨도 없으면(수기·함께 풀기) 빌런을 보기 좋은 슬롯에 순서대로 앉힌다.
 *
 * 정답 누출 금지: 이 모듈의 `buildDrillTableModel`은 상황에 이미 있는 정보만 배치한다. 포지션이 '?'인 문항은
 * '?' 그대로 두고, SB/BB 배지도 라벨이 명시된 경우에만 붙인다. 판단 재생용 계산(`planDrillDemo` 등)은
 * 서버 채점 결과(`DrillResult`)를 받은 뒤에만 호출한다 — 호출부 계약.
 */
import { evaluateHand, HAND_RANK_KO } from '@/lib/poker/evaluator';
import { positionLabels } from '@/lib/poker/hand-history';
import type { ActionType, Card, Street } from '@/lib/poker/types';
import { getCharacterById } from '@/lib/characters';
import { describeCorrectAnswer } from './drill-input';
import type { DrillAnswerSpec, DrillCategory, DrillSituation } from './drills/types';

export const DRILL_TABLE_SIZE = 6;
const LABELS: readonly string[] = positionLabels(DRILL_TABLE_SIZE);
const HIDDEN = '?';

/** 빌런 수별 보기 좋은 슬롯(시계 방향 순서) — 라벨이 없는 상황용 */
const SPREAD: Readonly<Record<number, readonly number[]>> = {
  0: [],
  1: [3],
  2: [2, 4],
  3: [2, 3, 4],
  4: [1, 2, 4, 5],
  5: [1, 2, 3, 4, 5],
};
/** 충돌로 밀려난 빌런을 앉힐 빈 슬롯 선호 순서 */
const FREE_SLOT_PREFERENCE: readonly number[] = [3, 2, 4, 1, 5];

export interface DrillTableSeat {
  /** 표시 슬롯 (0 = 하단 중앙 히어로) */
  slot: number;
  /** 실제 좌석 번호(0~5) — 배치가 공개 필드로 확정됐을 때만 */
  seatIndex: number | null;
  occupant: 'hero' | 'villain' | 'empty';
  characterId: string | null;
  name: string;
  /** 포지션 라벨 — '?'면 문제가 감춘 것, null이면 정보 없음 */
  position: string | null;
  stackChips: number | null;
  /** 앞면으로 보이는 카드 (히어로 카드 / 공개된 상대 카드) */
  holeCards: Card[];
  /** 뒷면 카드 두 장을 그린다 (핸드에 남은 미공개 상대) */
  cardBacks: boolean;
  rangeTag?: string;
  range?: string;
}

export interface DrillTableModel {
  seats: DrillTableSeat[];
  heroSlot: 0;
  dealerSlot: number | null;
  sbSlot: number | null;
  bbSlot: number | null;
  board: Card[];
  pot: number;
  toCall: number;
  bigBlind: number;
  street: Street;
  /** 좌석 번호 표시 — 배치가 공개 필드로 확정된 경우(포지션 문제)만 의미가 있다 */
  showSeatNumbers: boolean;
  positionsHidden: boolean;
}

const mod6 = (value: number) => ((value % DRILL_TABLE_SIZE) + DRILL_TABLE_SIZE) % DRILL_TABLE_SIZE;
const validSeat = (value: unknown): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value >= 0 && value < DRILL_TABLE_SIZE;

/** 6-max 라벨의 딜러 기준 오프셋 (헤즈업 'BTN/SB'는 0). 모르는 라벨·'?'는 null */
export function labelOffset(label: string | null | undefined): number | null {
  if (!label) return null;
  if (label === 'BTN/SB') return 0;
  const index = LABELS.indexOf(label);
  return index >= 0 ? index : null;
}

function cleanLabel(label: string | undefined): string | null {
  if (label === undefined) return null;
  const trimmed = label.trim();
  return trimmed === '' ? null : trimmed;
}

function characterLabel(characterId: string): string {
  return getCharacterById(characterId)?.name ?? characterId;
}

function emptySeat(slot: number): DrillTableSeat {
  return { slot, seatIndex: null, occupant: 'empty', characterId: null, name: '', position: null, stackChips: null, holeCards: [], cardBacks: false };
}

export function buildDrillTableModel(situation: DrillSituation, options: { heroAvatarId?: string | null } = {}): DrillTableModel {
  const seats: DrillTableSeat[] = Array.from({ length: DRILL_TABLE_SIZE }, (_, slot) => emptySeat(slot));
  const heroLabel = cleanLabel(situation.heroPosition);
  const villains = [...situation.villains].sort((a, b) => a.seatIndex - b.seatIndex);
  const villainSlots = new Map<number, number>(); // villain index(정렬 후) → slot
  const taken = new Set<number>([0]);
  let dealerSlot: number | null = null;
  let explicit = false;
  let heroSeat: number | null = null;

  const place = (index: number, slot: number) => {
    villainSlots.set(index, slot);
    taken.add(slot);
  };

  const headsUpLabels = heroLabel === 'BTN/SB' || villains.some(v => v.position === 'BTN/SB');

  if (validSeat(situation.heroSeatIndex)) {
    // 1. 공개 좌석 번호
    explicit = true;
    heroSeat = situation.heroSeatIndex;
    villains.forEach((villain, index) => {
      if (!validSeat(villain.seatIndex)) return;
      const slot = mod6(villain.seatIndex - situation.heroSeatIndex!);
      if (!taken.has(slot)) place(index, slot);
    });
    if (validSeat(situation.dealerSeatIndex)) dealerSlot = mod6(situation.dealerSeatIndex - situation.heroSeatIndex);
  } else if (!headsUpLabels && labelOffset(heroLabel) !== null) {
    // 2. 라벨 역산 — 히어로 오프셋 h, 빌런 오프셋 o → slot (o - h)
    const h = labelOffset(heroLabel)!;
    villains.forEach((villain, index) => {
      const o = labelOffset(villain.position);
      if (o === null) return;
      const slot = mod6(o - h);
      if (!taken.has(slot)) place(index, slot);
    });
    dealerSlot = mod6(-h);
  }

  // 3. 남은 빌런 — 라벨 없는 상황은 보기 좋은 분산 슬롯, 일부만 밀려났으면 빈 슬롯 선호 순서
  const unplaced = villains.map((_, index) => index).filter(index => !villainSlots.has(index));
  if (unplaced.length > 0) {
    const spread = villainSlots.size === 0 ? SPREAD[Math.min(unplaced.length, 5)] ?? [] : [];
    const pool = [...spread, ...FREE_SLOT_PREFERENCE].filter((slot, i, arr) => arr.indexOf(slot) === i);
    for (const index of unplaced) {
      const slot = pool.find(candidate => !taken.has(candidate));
      if (slot === undefined) break; // 5명 초과는 그릴 자리가 없다
      place(index, slot);
    }
  }

  // 헤즈업·폴백 딜러: BTN(또는 BTN/SB) 라벨을 가진 자리
  if (dealerSlot === null) {
    if (heroLabel === 'BTN' || heroLabel === 'BTN/SB') dealerSlot = 0;
    else {
      const index = villains.findIndex(v => v.position === 'BTN' || v.position === 'BTN/SB');
      if (index >= 0 && villainSlots.has(index)) dealerSlot = villainSlots.get(index)!;
    }
  }

  seats[0] = {
    slot: 0,
    seatIndex: explicit ? heroSeat : null,
    occupant: 'hero',
    characterId: options.heroAvatarId ?? null,
    name: '나',
    position: heroLabel,
    stackChips: situation.heroStackChips,
    holeCards: situation.hero.map(card => ({ ...card })),
    cardBacks: false,
  };
  villains.forEach((villain, index) => {
    const slot = villainSlots.get(index);
    if (slot === undefined) return;
    const seat: DrillTableSeat = {
      slot,
      seatIndex: explicit && heroSeat !== null ? mod6(heroSeat + slot) : null,
      occupant: 'villain',
      characterId: villain.characterId,
      name: characterLabel(villain.characterId),
      position: cleanLabel(villain.position),
      stackChips: villain.stackChips,
      holeCards: villain.holeCards ? villain.holeCards.map(card => ({ ...card })) : [],
      cardBacks: !villain.holeCards || villain.holeCards.length === 0,
    };
    if (villain.rangeTag) seat.rangeTag = villain.rangeTag;
    if (villain.range) seat.range = villain.range;
    seats[slot] = seat;
  });
  if (explicit && heroSeat !== null) {
    for (const seat of seats) if (seat.occupant === 'empty') seat.seatIndex = mod6(heroSeat + seat.slot);
  }

  // SB/BB 배지 — 라벨이 명시된 자리만 (감춘 문제에서 위치로 정답을 흘리지 않는다)
  const slotOfLabel = (label: string): number | null => {
    const seat = seats.find(s => s.occupant !== 'empty' && s.position === label);
    return seat ? seat.slot : null;
  };
  const sbSlot = slotOfLabel('SB');
  const bbSlot = slotOfLabel('BB');
  const positionsHidden = heroLabel === HIDDEN || villains.some(v => v.position === HIDDEN);

  return {
    seats,
    heroSlot: 0,
    dealerSlot,
    sbSlot: sbSlot !== null && sbSlot !== dealerSlot ? sbSlot : null,
    bbSlot: bbSlot !== null && bbSlot !== dealerSlot ? bbSlot : null,
    board: situation.board.map(card => ({ ...card })),
    pot: Math.max(0, situation.potChips),
    toCall: Math.max(0, situation.toCallChips),
    bigBlind: situation.bigBlind,
    street: situation.street,
    showSeatNumbers: explicit,
    positionsHidden,
  };
}

// ---------------------------------------------------------------------------
// 판단 재생 — 채점 결과를 받은 뒤에만 호출한다

export interface SlotLabel {
  slot: number;
  label: string;
}

/** 딜러 슬롯부터 시계 방향으로 BTN → SB → BB → UTG → HJ → CO */
export function positionSequence(dealerSlot: number): SlotLabel[] {
  return LABELS.map((label, offset) => ({ slot: mod6(dealerSlot + offset), label }));
}

/**
 * 액션 순서 — 프리플랍은 UTG부터(BB 마지막), 플랍 이후는 SB부터(BTN 마지막).
 * `occupied`를 주면 빈 자리를 건너뛴다.
 */
export function actionOrder(dealerSlot: number, street: Street, occupied?: readonly boolean[]): SlotLabel[] {
  const offsets = street === 'preflop' ? [3, 4, 5, 0, 1, 2] : [1, 2, 3, 4, 5, 0];
  return offsets
    .map(offset => ({ slot: mod6(dealerSlot + offset), label: LABELS[offset] }))
    .filter(entry => !occupied || occupied[entry.slot]);
}

export interface ShowdownEntry {
  slot: number;
  rankName: string;
  value: number;
  /** 최고 5장 */
  cards: Card[];
}

export interface ShowdownResult {
  entries: ShowdownEntry[];
  winnerSlots: number[];
}

/** 앞면 홀카드 2장이 있는 자리마다 최고 5장을 계산한다 (보드 3장 이상). 계산할 자리가 없으면 null */
export function computeShowdown(model: DrillTableModel): ShowdownResult | null {
  if (model.board.length < 3) return null;
  const entries: ShowdownEntry[] = [];
  for (const seat of model.seats) {
    if (seat.occupant === 'empty' || seat.holeCards.length !== 2) continue;
    const hand = evaluateHand(seat.holeCards, model.board);
    entries.push({ slot: seat.slot, rankName: HAND_RANK_KO[hand.rank], value: hand.value, cards: hand.cards });
  }
  if (entries.length === 0) return null;
  const best = Math.max(...entries.map(entry => entry.value));
  return { entries, winnerSlots: entries.filter(entry => entry.value === best).map(entry => entry.slot) };
}

export type DemoAction = ActionType | 'bet';

const ACTION_PREFIXES: readonly [RegExp, DemoAction][] = [
  [/^폴드/, 'fold'],
  [/^체크/, 'check'],
  [/^콜/, 'call'],
  [/^올인/, 'all-in'],
  [/^(오픈 레이즈|레이즈|[34]벳)/, 'raise'],
  [/^(벳|[⅓½¾⅔] 팟)/, 'bet'],
];

/** 정답 보기 문구 → 테이블에서 실연할 액션. 액션이 아닌 보기면 null */
export function parseDemoAction(text: string): { action: DemoAction; label: string } | null {
  const trimmed = text.trim();
  for (const [pattern, action] of ACTION_PREFIXES) {
    if (pattern.test(trimmed)) {
      const label = trimmed.split(/\s+—\s+|\s+-\s+|\s*\(/)[0].trim();
      return { action, label };
    }
  }
  return null;
}

const ACTION_LABEL: Readonly<Record<ActionType, string>> = {
  fold: '폴드', check: '체크', call: '콜', raise: '레이즈', 'all-in': '올인',
};

export type DrillDemo =
  | { kind: 'showdown'; showdown: ShowdownResult }
  | { kind: 'position-walk'; sequence: SlotLabel[]; heroLabel: string }
  | { kind: 'action-order'; order: SlotLabel[] }
  | { kind: 'act'; action: DemoAction; label: string; chips: number | null }
  | { kind: 'answer'; label: string };

export interface DrillDemoContext {
  category?: DrillCategory;
  templateId?: string;
}

const SHOWDOWN_EXCLUDED = /^(nuts-|rank-nuts$)/;

/**
 * 판단 재생 계획 — 서버가 내려 준 `correctAnswer`(채점 뒤 공개)와 공개 상황만으로 만든다.
 * 카테고리별 실연을 고르고, 맞는 연출이 없으면 정답 라벨 말풍선(`answer`)으로 폴백한다.
 */
export function planDrillDemo(model: DrillTableModel, correctAnswer: DrillAnswerSpec, context: DrillDemoContext = {}): DrillDemo {
  const answerLabel = describeCorrectAnswer(correctAnswer);
  const fallback: DrillDemo = { kind: 'answer', label: answerLabel };
  const { category, templateId = '' } = context;

  if (category === 'hand-ranking' && !SHOWDOWN_EXCLUDED.test(templateId)) {
    const showdown = computeShowdown(model);
    if (showdown && model.board.length === 5) return { kind: 'showdown', showdown };
    return fallback;
  }

  if (category === 'position' && model.dealerSlot !== null) {
    if (templateId === 'pos-first-to-act') {
      const occupied = model.seats.map(seat => seat.occupant !== 'empty');
      return { kind: 'action-order', order: actionOrder(model.dealerSlot, model.street, occupied) };
    }
    const sequence = positionSequence(model.dealerSlot);
    const heroLabel = sequence.find(entry => entry.slot === 0)?.label ?? answerLabel;
    return { kind: 'position-walk', sequence, heroLabel };
  }

  let parsed: { action: DemoAction; label: string } | null = null;
  if (correctAnswer.kind === 'action-pick' && correctAnswer.correct.length > 0) {
    const action = correctAnswer.correct[0];
    parsed = { action, label: ACTION_LABEL[action] };
  } else if (correctAnswer.kind === 'multiple-choice' && category !== 'position' && category !== 'hand-ranking') {
    parsed = parseDemoAction(correctAnswer.options[correctAnswer.correctIndex] ?? '');
  }
  if (parsed) {
    return { kind: 'act', action: parsed.action, label: parsed.label, chips: demoChips(model, parsed.action, parsed.label) };
  }
  return fallback;
}

/** 실연 칩 금액 — 콜은 콜 금액, ⅓/½/¾ 팟 벳은 팟 비율. 알 수 없으면 null(칩만 그린다) */
function demoChips(model: DrillTableModel, action: DemoAction, label: string): number | null {
  if (action === 'call') return model.toCall > 0 ? model.toCall : null;
  if (action === 'all-in') return model.seats[0].stackChips;
  const fraction: Record<string, number> = { '⅓': 1 / 3, '½': 1 / 2, '⅔': 2 / 3, '¾': 3 / 4 };
  const match = /^([⅓½¾⅔]) 팟/.exec(label);
  if (match && model.pot > 0) return Math.round(model.pot * fraction[match[1]]);
  return null;
}
