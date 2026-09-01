/**
 * D-OUTS 생성 템플릿 + **드로우 스팟 생성기**(equity/call-decision 템플릿이 재사용).
 *
 * 랜덤 딜을 필터링하면 "드로우 vs 메이드" 조건이 좀처럼 안 걸려 리롤 상한(32)을 넘긴다.
 * 그래서 상황을 **구성**한 뒤 `countOutsVsHand`로 **검증**한다 —
 * 구성한 아우츠 수와 실제 열거값이 다르면(콤보 드로우가 섞였거나 보드가 페어라 풀하우스가
 * 끼는 등) 그 시드는 버린다. 정답 숫자는 언제나 열거 결과이지 구성 의도가 아니다.
 */
import { evaluateHand } from '@/lib/poker/evaluator';
import { countOutsVsHand, exactDrawPct } from '@/lib/poker/learning';
import { pickOne, shuffleWith } from '@/lib/poker/seeded-rng';
import type { Card, Suit } from '@/lib/poker/types';
import type { DrillSituation } from '../types';
import type { GeneratedDrillDefinition } from './kit';
import {
  STACK_BB,
  STREET_KO,
  SUITS,
  cardOf,
  cardValue,
  characterName,
  formatBoard,
  makeSeatLayout,
  makeVillain,
  numParam,
  pickCardWhere,
  pickSupportCharacters,
  round1,
  TABLE_SIZE,
  valueRange,
} from './kit';

export type DrawKind = 'flush' | 'oesd' | 'gutshot';
export type MadeKind = 'top-pair' | 'overpair' | 'two-pair';

interface DrawBase {
  hero: Card[];
  villain: Card[];
  board: Card[];
  drawName: string;
  villainHandName: string;
  /** 열거로 나와야 하는 아우츠 수 — 다르면 구성이 의도와 어긋난 것이라 버린다. */
  expectedOuts: readonly number[];
  allowTurn: (card: Card) => boolean;
}

export interface DrawSpot {
  hero: Card[];
  villain: Card[];
  board: Card[];
  street: 'flop' | 'turn';
  cardsToCome: 1 | 2;
  drawName: string;
  villainHandName: string;
  /** `countOutsVsHand` 열거 결과 (타이는 세지 않는다) */
  outs: number;
  /** 히어로 시점의 미확인 카드 수 = 52 − 내 2장 − 보드 (플랍 47 · 턴 46). */
  unseen: number;
}

function valuesOf(cards: readonly Card[]): Set<number> {
  return new Set(cards.map(cardValue));
}

// ---------------------------------------------------------------------------
// 플러시 드로우 구성

function buildFlushDraw(rng: () => number): DrawBase | null {
  const suit: Suit = pickOne(rng, SUITS);
  const others = shuffleWith(rng, SUITS.filter(s => s !== suit));
  const made: MadeKind = pickOne(rng, ['top-pair', 'overpair', 'two-pair'] as const);
  // 오버페어를 만들려면 보드 최상위 위에 자리가 남아야 한다.
  const highValue = made === 'overpair' ? pickOne(rng, [9, 10, 11, 12]) : pickOne(rng, [12, 13, 14]);

  const pool = shuffleWith(rng, valueRange(2, highValue - 1));
  if (pool.length < 5) return null;
  const [h1, h2, b2, b3, kicker] = pool;

  // 히어로는 보드 최상위보다 낮은 수트 2장 — 페어를 맞춰도 상대 페어를 못 넘는다.
  const hero = [cardOf(h1, suit), cardOf(h2, suit)];
  const board = [cardOf(highValue, others[0]), cardOf(b2, suit), cardOf(b3, suit)];

  let villain: Card[];
  let villainHandName: string;
  let expectedOuts: number[];
  let villainTopValue: number;
  if (made === 'top-pair') {
    villain = [cardOf(highValue, others[1]), cardOf(kicker, others[2])];
    villainHandName = '탑페어';
    expectedOuts = [9];
    villainTopValue = highValue;
  } else if (made === 'overpair') {
    const pairValues = valueRange(highValue + 1, 14);
    if (pairValues.length === 0) return null;
    const pairValue = pickOne(rng, pairValues);
    villain = [cardOf(pairValue, others[0]), cardOf(pairValue, others[1])];
    villainHandName = '오버페어';
    expectedOuts = [9];
    villainTopValue = pairValue;
  } else {
    villain = [cardOf(highValue, others[1]), cardOf(b2, others[2])];
    villainHandName = '투페어';
    // 최상위 랭크의 같은 무늬 카드는 상대에게 풀하우스를 주므로 아우츠에서 빠진다.
    expectedOuts = [8];
    villainTopValue = highValue;
  }

  const used = valuesOf([...hero, ...board, ...villain]);
  return {
    hero,
    villain,
    board,
    drawName: '플러시 드로우',
    villainHandName,
    expectedOuts,
    allowTurn: card =>
      card.suit !== suit && !used.has(cardValue(card)) && cardValue(card) < villainTopValue,
  };
}

// ---------------------------------------------------------------------------
// 스트레이트 드로우 구성 (연속 랭크 창을 히어로 2 / 보드 2로 나눈다)

function buildStraightDraw(rng: () => number, kind: 'oesd' | 'gutshot'): DrawBase | null {
  const made: MadeKind = pickOne(rng, ['top-pair', 'overpair'] as const);
  const suits = shuffleWith(rng, SUITS);

  let windowValues: number[];
  let outValues: number[];
  let deadValues: number[];
  if (kind === 'oesd') {
    const low = made === 'overpair' ? pickOne(rng, valueRange(5, 9)) : pickOne(rng, valueRange(3, 8));
    windowValues = valueRange(low, low + 3);
    outValues = [low - 1, low + 4];
    deadValues = valueRange(low - 2, low + 5);
  } else {
    const low = made === 'overpair' ? pickOne(rng, valueRange(4, 9)) : pickOne(rng, valueRange(2, 8));
    const missing = low + pickOne(rng, [1, 2, 3]);
    windowValues = valueRange(low, low + 4).filter(value => value !== missing);
    outValues = [missing];
    deadValues = valueRange(low - 1, low + 5);
  }

  const split = shuffleWith(rng, windowValues);
  const heroValues = split.slice(0, 2);
  const boardValues = split.slice(2, 4);
  const windowHigh = Math.max(...windowValues);
  const windowLow = Math.min(...windowValues);

  const extraPool = (made === 'top-pair'
    ? valueRange(windowHigh + 2, 14)
    : valueRange(2, windowLow - 2)
  ).filter(value => !deadValues.includes(value));
  if (extraPool.length === 0) return null;
  const extraValue = pickOne(rng, extraPool);

  const hero = [cardOf(heroValues[0], suits[0]), cardOf(heroValues[1], suits[1])];
  const board = [
    cardOf(boardValues[0], suits[2]),
    cardOf(boardValues[1], suits[3]),
    cardOf(extraValue, suits[0]),
  ];

  let villain: Card[];
  let villainHandName: string;
  let villainTopValue: number;
  if (made === 'top-pair') {
    const kickerPool = valueRange(2, extraValue - 1).filter(
      value => !deadValues.includes(value) && !windowValues.includes(value) && !outValues.includes(value),
    );
    if (kickerPool.length === 0) return null;
    villain = [cardOf(extraValue, suits[1]), cardOf(pickOne(rng, kickerPool), suits[2])];
    villainHandName = '탑페어';
    villainTopValue = extraValue;
  } else {
    const pairPool = valueRange(Math.max(windowHigh, extraValue) + 1, 14).filter(
      value => !outValues.includes(value) && !windowValues.includes(value) && value !== extraValue,
    );
    if (pairPool.length === 0) return null;
    const pairValue = pickOne(rng, pairPool);
    villain = [cardOf(pairValue, suits[0]), cardOf(pairValue, suits[1])];
    villainHandName = '오버페어';
    villainTopValue = pairValue;
  }

  const used = valuesOf([...hero, ...board, ...villain]);
  return {
    hero,
    villain,
    board,
    drawName: kind === 'oesd' ? '오픈엔드 스트레이트 드로우' : '것샷 스트레이트 드로우',
    villainHandName,
    expectedOuts: kind === 'oesd' ? [8] : [4],
    allowTurn: card =>
      !deadValues.includes(cardValue(card)) &&
      !used.has(cardValue(card)) &&
      cardValue(card) < villainTopValue,
  };
}

// ---------------------------------------------------------------------------
// 드로우 스팟

export interface DrawSpotOptions {
  /** 'any'면 시드로 플랍/턴을 고른다 */
  street?: 'flop' | 'turn' | 'any';
  maxOuts?: number;
}

export function buildDrawSpot(rng: () => number, options: DrawSpotOptions = {}): DrawSpot | null {
  const maxOuts = options.maxOuts ?? 9;
  const kind: DrawKind = pickOne(rng, ['flush', 'oesd', 'gutshot'] as const);
  const base = kind === 'flush' ? buildFlushDraw(rng) : buildStraightDraw(rng, kind);
  if (!base) return null;

  const requested = options.street ?? 'flop';
  const street: 'flop' | 'turn' = requested === 'any' ? pickOne(rng, ['flop', 'turn'] as const) : requested;

  let board = base.board;
  if (street === 'turn') {
    const extra = pickCardWhere(rng, [...base.hero, ...base.villain, ...board], base.allowTurn);
    if (!extra) return null;
    board = [...board, extra];
  }

  // 검증 ①: 히어로는 아직 지고 있어야 "드로우"다.
  if (evaluateHand(base.hero, board).value >= evaluateHand(base.villain, board).value) return null;
  // 검증 ②: 열거 아우츠가 구성 의도와 같아야 해설(드로우 이름)이 사실이 된다.
  const outs = countOutsVsHand(base.hero, board, base.villain).outs.length;
  if (!base.expectedOuts.includes(outs)) return null;
  if (outs < 1 || outs > maxOuts) return null;

  return {
    hero: base.hero,
    villain: base.villain,
    board,
    street,
    cardsToCome: street === 'flop' ? 2 : 1,
    drawName: base.drawName,
    villainHandName: base.villainHandName,
    outs,
    unseen: 52 - base.hero.length - board.length,
  };
}

export interface DrawSpotSituation {
  situation: DrillSituation;
  villainName: string;
}

/** 드로우 스팟을 상황 카드로 — 상대 홀카드는 공개(문항이 아우츠를 묻기 때문). */
export function drawSpotSituation(
  rng: () => number,
  spot: DrawSpot,
  bigBlind: number,
  pot: { potChips: number; toCallChips: number; note?: string },
): DrawSpotSituation {
  const layout = makeSeatLayout(rng);
  const seats = shuffleWith(rng, valueRange(0, TABLE_SIZE - 1)).slice(0, 2);
  const [villainId] = pickSupportCharacters(rng, 1);
  const stackChips = STACK_BB * bigBlind;

  return {
    villainName: characterName(villainId),
    situation: {
      hero: spot.hero,
      board: spot.board,
      potChips: pot.potChips,
      toCallChips: pot.toCallChips,
      bigBlind,
      heroStackChips: stackChips,
      heroPosition: layout.positions[seats[0]],
      street: spot.street,
      villains: [
        makeVillain(layout, seats[1], villainId, {
          stackChips,
          holeCards: spot.villain,
          rangeTag: spot.villainHandName,
        }),
      ],
      note: pot.note,
    },
  };
}

// ---------------------------------------------------------------------------
// 템플릿

const outsCount: GeneratedDrillDefinition = {
  template: {
    id: 'outs-count',
    category: 'outs',
    title: '아우츠 세기',
    difficulty: 1,
    hints: ['내가 못 본 카드가 {unseen}장 남았어요. 그중 나를 이기게 만드는 카드만 세어 보세요.'],
    // difficulty 1 = Ch3 규약(아우츠 ≤ 9). 상한을 올리려면 이 값만 바꾼다.
    source: { kind: 'generated', params: { maxOuts: 9 } },
  },
  build: ({ rng, bigBlind, params }) => {
    const spot = buildDrawSpot(rng, { street: 'any', maxOuts: numParam(params, 'maxOuts', 9) });
    if (!spot) return null;

    const potChips = pickOne(rng, [6, 8, 10, 12]) * bigBlind;
    const { situation, villainName } = drawSpotSituation(rng, spot, bigBlind, {
      potChips,
      toCallChips: 0,
    });
    situation.note = `${villainName}의 카드는 공개돼 있어요.`;

    return {
      situation,
      question: `${STREET_KO[spot.street]}이에요. 다음 카드 한 장으로 내가 ${villainName}를 이기게 되는 카드는 몇 장일까요?`,
      answerSpec: { kind: 'numeric', correct: spot.outs, tolerance: 0, unit: 'outs', min: 0, max: 21 },
      facts: {
        outs: spot.outs,
        unseen: spot.unseen,
        pct: round1(exactDrawPct(spot.outs, spot.unseen, 1)),
        drawName: spot.drawName,
        villainHand: spot.villainHandName,
        villainName,
        street: STREET_KO[spot.street],
        board: formatBoard(spot.board),
      },
    };
  },
};

export const OUTS_TEMPLATES: readonly GeneratedDrillDefinition[] = [outsCount];
