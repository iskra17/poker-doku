/**
 * D-BE 생성 템플릿 2종 — 블러프·스틸 손익분기(필요 폴드율).
 *
 * 공식은 하나: **필요 폴드율 = 벳 ÷ (벳 + 팟)**. `potChips`는 벳을 넣기 **전** 중앙 총액이다
 * (D-ODDS의 "상대 벳 포함 팟"과 반대 방향이므로 상황 카드 note에 못박는다 — 2막 Ch4 개념 카드와 같은 표기).
 * 상황은 언제나 "상대가 체크했고 내 핸드는 아무것도 없다(미스 드로우)" — 밸류가 아니라 순수 블러프라는 걸
 * 카드로 보여 준다. 정답이 x.5%로 떨어지는 조합은 반올림 정답이 둘이라 넣지 않는다.
 */
import { evaluateHand } from '@/lib/poker/evaluator';
import { handRankOrder } from '@/lib/poker/learning';
import { pickOne, shuffleWith } from '@/lib/poker/seeded-rng';
import type { Card, Suit } from '@/lib/poker/types';
import type { DrillSituation } from '../types';
import type { DrillFacts, GeneratedDrillDefinition } from './kit';
import {
  STACK_BB,
  SUITS,
  TABLE_SIZE,
  cardOf,
  characterName,
  formatBoard,
  makeChoice,
  makeSeatLayout,
  makeVillain,
  pickSupportCharacters,
  round1,
  scaleChips,
  valueRange,
} from './kit';

/** (벳 전 팟, 벳) — bb=20 기준. 필요 폴드율이 정수(또는 .3/.7)로 떨어지는 조합만. */
const BE_PAIRS: readonly (readonly [number, number])[] = [
  [100, 50], [100, 100], [200, 100], [300, 100], [150, 50], [100, 25], [100, 75],
  [200, 150], [120, 40], [90, 30], [240, 60], [150, 150], [160, 80], [180, 60],
];

/** 4지선다 오답 풀 — 업계에서 외우는 눈금. */
const PCT_POOL: readonly number[] = [20, 25, 33, 40, 50, 60];
const PCT_GAP = 4;

interface BreakevenSpot {
  situation: DrillSituation;
  villainName: string;
  potChips: number;
  betChips: number;
  /** 필요 폴드율 % (반올림 전) */
  pct: number;
}

/**
 * 미스 플러시 드로우 — 홀카드 두 장은 같은 수트, 보드에는 그 수트가 정확히 두 장(플러시 실패),
 * 홀카드 랭크는 보드와 겹치지 않아 페어도 없다. 스트레이트가 우연히 완성되면 리롤.
 */
function buildMissedDraw(rng: () => number): { hero: Card[]; board: Card[] } | null {
  const suit: Suit = pickOne(rng, SUITS);
  const others = SUITS.filter(candidate => candidate !== suit);
  const ranks = shuffleWith(rng, valueRange(2, 14));
  const heroRanks = ranks.slice(0, 2);
  const boardRanks = ranks.slice(2, 7);
  const hero = heroRanks.map(value => cardOf(value, suit));
  const board: Card[] = [
    cardOf(boardRanks[0], suit),
    cardOf(boardRanks[1], suit),
    cardOf(boardRanks[2], others[0]),
    cardOf(boardRanks[3], others[1]),
    cardOf(boardRanks[4], others[2]),
  ];
  const order = handRankOrder(evaluateHand(hero, board).rank);
  if (order >= handRankOrder('straight')) return null;
  return { hero, board: shuffleWith(rng, board) };
}

function buildSpot(rng: () => number, bigBlind: number): BreakevenSpot | null {
  const [basePot, baseBet] = pickOne(rng, BE_PAIRS);
  const potChips = scaleChips(basePot, bigBlind);
  const betChips = scaleChips(baseBet, bigBlind);
  if (potChips <= 0 || betChips <= 0) return null;
  const pct = (betChips / (betChips + potChips)) * 100;
  if (Math.abs(pct - Math.round(pct)) > 0.49) return null;

  const cards = buildMissedDraw(rng);
  if (!cards) return null;

  const layout = makeSeatLayout(rng);
  const seats = shuffleWith(rng, valueRange(0, TABLE_SIZE - 1)).slice(0, 2);
  const [villainId] = pickSupportCharacters(rng, 1);
  const villainName = characterName(villainId);
  const stackChips = STACK_BB * bigBlind;

  return {
    villainName,
    potChips,
    betChips,
    pct,
    situation: {
      hero: cards.hero,
      board: cards.board,
      potChips,
      toCallChips: 0,
      bigBlind,
      heroStackChips: stackChips,
      heroPosition: layout.positions[seats[0]],
      street: 'river',
      villains: [makeVillain(layout, seats[1], villainId, { stackChips })],
      note: `리버, ${villainName}가 체크했어요. 내 플러시 드로우는 빗나갔고, 팟 ${potChips}은 아직 아무 벳도 없는 금액이에요.`,
    },
  };
}

function facts(spot: BreakevenSpot, correct: number): DrillFacts {
  return {
    potChips: spot.potChips,
    betChips: spot.betChips,
    potAfterBet: spot.potChips + spot.betChips,
    breakeven: correct,
    exactPct: round1(spot.pct),
    villainName: spot.villainName,
    board: formatBoard(spot.situation.board),
  };
}

const foldPct: GeneratedDrillDefinition = {
  template: {
    id: 'breakeven-fold-pct',
    category: 'breakeven',
    title: '블러프 손익분기',
    difficulty: 2,
    hints: ['필요 폴드율 = 벳 ÷ (벳 + 팟)이에요. 팟 {potChips}은 벳을 넣기 전 금액이고요.'],
    source: { kind: 'generated', params: {} },
  },
  build: ({ rng, bigBlind }) => {
    const spot = buildSpot(rng, bigBlind);
    if (!spot) return null;
    const correct = Math.round(spot.pct);
    return {
      situation: spot.situation,
      question: `팟 ${spot.potChips}에 ${spot.betChips}을 블러프로 벳하려고 해요. ${spot.villainName}가 최소 몇 % 폴드해야 본전일까요?`,
      answerSpec: { kind: 'numeric', correct, tolerance: 2, unit: '%', min: 0, max: 100 },
      facts: facts(spot, correct),
    };
  },
};

const foldPctChoice: GeneratedDrillDefinition = {
  template: {
    id: 'breakeven-choice',
    category: 'breakeven',
    title: '폴드율 몇 %면 본전?',
    difficulty: 1,
    hints: ['벳하면 중앙은 {potAfterBet}이 돼요. 그중 내 벳 {betChips}이 차지하는 비율이 답이에요.'],
    source: { kind: 'generated', params: {} },
  },
  build: ({ rng, bigBlind }) => {
    const spot = buildSpot(rng, bigBlind);
    if (!spot) return null;
    const correct = Math.round(spot.pct);
    const distractors = PCT_POOL.filter(value => Math.abs(value - correct) >= PCT_GAP).map(value => `${value}%`);
    const choice = makeChoice(rng, `${correct}%`, distractors, 4);
    if (!choice) return null;
    return {
      situation: spot.situation,
      question: `팟 ${spot.potChips}에 ${spot.betChips}을 블러프로 벳해요. 본전이 되는 상대 폴드율에 가장 가까운 값은?`,
      answerSpec: { kind: 'multiple-choice', options: choice.options, correctIndex: choice.correctIndex },
      facts: facts(spot, correct),
    };
  },
};

export const BREAKEVEN_TEMPLATES: readonly GeneratedDrillDefinition[] = [foldPct, foldPctChoice];
