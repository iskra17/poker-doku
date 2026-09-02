/**
 * 프리셋 덱 — 수련 스토리 모드의 '연습'(practice-table) 스텝이 미리 정해진 핸드를
 * 재현하기 위한 **1회성 시나리오 덱**.
 *
 * 계약:
 * - `arm()`은 다음 `reset()` 한 번만 스크립트를 적용하고 스스로 무장을 푼다.
 *   (`startHand()`가 매 핸드 `reset()`을 부르므로, 무장을 남기면 스크립트 핸드가 무한 반복된다.)
 * - 배치 순서는 엔진 `startHand()`의 딜 순서 그대로다 — `getActivePlayers()` 배열 순서
 *   (seatIndex 오름차순, 이번 핸드 딜인되는 좌석만)대로 좌석당 `deal(2)` → 플랍 `deal(3)`
 *   → 턴 `deal(1)` → 리버 `deal(1)`. **번 카드는 없다.**
 *   딜아웃(0칩·자리비움) 좌석이 있으면 카드가 한 칸씩 밀리므로, 호출자(`beforeHand`)가
 *   실제로 딜인될 좌석만 `dealtSeatOrder`에 넣어야 한다.
 * - 지정하지 않은 자리는 `super.reset()`의 CSPRNG 셔플 잔여로 채운다. 스크립트 카드는
 *   잔여에서 제거하므로 덱에 중복이 생기지 않는다 (항상 52장 유니크).
 * - **`Math.random` 금지** (AGENTS.md CSPRNG 규칙) — 무작위성은 전부 `Deck.shuffle()`에서 온다.
 */
import { CardNotationError, findDuplicateCard, formatCard, parseCards } from '../poker/card-notation';
import { Deck } from '../poker/deck';
import type { Card } from '../poker/types';
import type { DealScript } from './types';

/** 표준 덱 크기 — arm 시점 위치 검증용 (실제 크기는 reset 후 `this.cards.length`). */
const DECK_SIZE = 52;
const HOLE_CARDS_PER_SEAT = 2;
const BOARD_MAX = 5;

export class ScenarioDeckError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ScenarioDeckError';
  }
}

export interface ArmedScenario {
  script: DealScript;
  /**
   * 이번 핸드에 카드를 받을 **모든** 좌석의 seatIndex — 엔진 딜 순서와 동일해야 한다
   * (= `getActivePlayers()` 배열 순서: seatIndex 오름차순, status 'active'인 좌석만).
   */
  dealtSeatOrder: readonly number[];
  heroSeat: number;
}

/** 절대 위치(= deal()이 앞에서부터 뽑는 순번) → 고정 카드 */
type FixedLayout = Map<number, Card>;

export class ScenarioDeck extends Deck {
  /**
   * 다음 reset()에 적용할 배치. 부모 생성자가 필드 초기화 **전에** reset()을 부르므로
   * (RiggedDeck 선례) 런타임에는 undefined일 수 있다 — reset()에서 falsy 가드로 처리한다.
   */
  private pending: FixedLayout | null = null;

  /** 다음 reset() 한 번에 적용할 시나리오를 건다. 잘못된 스크립트는 ScenarioDeckError. */
  arm(scenario: ArmedScenario): void {
    this.pending = buildLayout(scenario);
  }

  /** 무장 해제 — 다음 reset()은 평범한 CSPRNG 셔플. */
  disarm(): void {
    this.pending = null;
  }

  isArmed(): boolean {
    return this.pending != null;
  }

  reset(): void {
    super.reset();
    const layout = this.pending;
    if (!layout) return; // 부모 생성자 호출 시점 포함
    this.pending = null; // 1회성 — 다음 핸드는 평범한 셔플
    this.cards = applyLayout(this.cards, layout);
  }
}

/** 스크립트를 절대 위치 배치로 변환하면서 표기·중복·좌석을 전부 검증한다. */
function buildLayout(scenario: ArmedScenario): FixedLayout {
  const { script, dealtSeatOrder, heroSeat } = scenario;

  if (dealtSeatOrder.length === 0) {
    throw new ScenarioDeckError('dealtSeatOrder must not be empty');
  }
  const seenSeats = new Set<number>();
  for (const seat of dealtSeatOrder) {
    if (!Number.isInteger(seat) || seat < 0) {
      throw new ScenarioDeckError(`dealtSeatOrder has an invalid seat: ${String(seat)}`);
    }
    if (seenSeats.has(seat)) {
      throw new ScenarioDeckError(`dealtSeatOrder has a duplicate seat: ${seat}`);
    }
    seenSeats.add(seat);
  }

  const boardBase = dealtSeatOrder.length * HOLE_CARDS_PER_SEAT;
  if (boardBase + BOARD_MAX > DECK_SIZE) {
    throw new ScenarioDeckError(`dealtSeatOrder is too long for a 52-card deck: ${dealtSeatOrder.length}`);
  }

  const heroOrder = dealtSeatOrder.indexOf(heroSeat);
  if (heroOrder < 0) {
    throw new ScenarioDeckError(`hero seat ${heroSeat} is not in dealtSeatOrder`);
  }

  const layout: FixedLayout = new Map();
  const scripted: Card[] = [];

  const hero = parseScriptCards(script.hero, `hero seat ${heroSeat}`);
  if (hero.length !== HOLE_CARDS_PER_SEAT) {
    throw new ScenarioDeckError(`hero seat ${heroSeat} must have exactly 2 cards`);
  }
  place(layout, scripted, heroOrder * HOLE_CARDS_PER_SEAT, hero);

  for (const [seatText, codes] of Object.entries(script.villains ?? {})) {
    const seat = Number(seatText);
    if (seat === heroSeat) {
      throw new ScenarioDeckError(`villain seat ${seatText} collides with the hero seat`);
    }
    const order = dealtSeatOrder.indexOf(seat);
    if (order < 0) {
      throw new ScenarioDeckError(`villain seat ${seatText} is not in dealtSeatOrder`);
    }
    const villain = parseScriptCards(codes, `villain seat ${seatText}`);
    if (villain.length !== HOLE_CARDS_PER_SEAT) {
      throw new ScenarioDeckError(`villain seat ${seatText} must have exactly 2 cards`);
    }
    place(layout, scripted, order * HOLE_CARDS_PER_SEAT, villain);
  }

  if (script.board !== undefined) {
    const board = parseScriptCards(script.board, 'board');
    if (board.length > BOARD_MAX) {
      throw new ScenarioDeckError(`board must be at most ${BOARD_MAX} cards`);
    }
    place(layout, scripted, boardBase, board);
  }

  const duplicate = findDuplicateCard(scripted);
  if (duplicate) {
    throw new ScenarioDeckError(`duplicate card ${duplicate} across the script`);
  }
  return layout;
}

/** parseCards의 CardNotationError를 ScenarioDeckError로 감싼다 (호출부 catch를 한 종류로). */
function parseScriptCards(text: string, at: string): Card[] {
  try {
    return parseCards(text);
  } catch (error) {
    if (error instanceof CardNotationError) {
      throw new ScenarioDeckError(`${at}: ${error.message}`);
    }
    throw error;
  }
}

function place(layout: FixedLayout, scripted: Card[], base: number, cards: readonly Card[]): void {
  cards.forEach((card, offset) => {
    layout.set(base + offset, card);
    scripted.push(card);
  });
}

/**
 * CSPRNG로 섞인 덱에서 스크립트 카드를 빼내고, 지정된 절대 위치에 끼워 넣는다.
 * 나머지 자리는 셔플된 잔여 순서를 그대로 이어 받는다 (추가 난수 없음).
 */
function applyLayout(shuffled: readonly Card[], layout: FixedLayout): Card[] {
  const size = shuffled.length;
  for (const position of layout.keys()) {
    if (position >= size) {
      throw new ScenarioDeckError(`scripted position ${position} exceeds deck size ${size}`);
    }
  }

  const fixedKeys = new Set<string>();
  for (const card of layout.values()) fixedKeys.add(formatCard(card));

  const remainder = shuffled.filter(card => !fixedKeys.has(formatCard(card)));
  if (remainder.length !== size - fixedKeys.size) {
    throw new ScenarioDeckError('scripted cards are not all present in the deck');
  }

  const result: Card[] = new Array<Card>(size);
  let next = 0;
  for (let i = 0; i < size; i++) {
    const fixed = layout.get(i);
    result[i] = fixed ? { ...fixed } : remainder[next++];
  }
  return result;
}
