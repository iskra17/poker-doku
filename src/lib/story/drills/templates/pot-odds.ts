/**
 * D-ODDS 생성 템플릿 2종 — 필요 승률(숫자)과 비율 4지선다.
 *
 * **팟 정의 고정** (기획 A4): `potChips`는 상대의 벳까지 포함한 **지금 중앙의 총액**이다.
 * 필요 승률 = 콜 ÷ (팟 + 콜). "팟 150 + 벳 50 = 200 → 20%"로 읽히는 표기는 금지 —
 * 상황 카드 note와 해설 모두 "팟 150에는 벳 50이 포함" 이라고 못박는다.
 */
import { computePotOdds } from '@/lib/poker/learning';
import { pickOne, shuffleWith } from '@/lib/poker/seeded-rng';
import type { Street } from '@/lib/poker/types';
import type { DrillSituation } from '../types';
import type { DrillFacts, GeneratedDrillDefinition } from './kit';
import {
  STACK_BB,
  STREET_KO,
  TABLE_SIZE,
  characterName,
  drawCards,
  formatBoard,
  formatRatio,
  makeChoice,
  makeSeatLayout,
  makeVillain,
  pickSupportCharacters,
  round1,
  scaleChips,
  valueRange,
} from './kit';

/**
 * (팟 총액, 콜 금액) — bb=20 기준의 "깔끔한" 수치. 다른 블라인드는 비례 환산한다.
 * 필요 승률이 정확히 x.5%가 되는 조합은 반올림 정답이 모호해지므로 넣지 않는다.
 */
const POT_PAIRS: readonly (readonly [number, number])[] = [
  [100, 50], [150, 50], [200, 50], [250, 50], [300, 50],
  [200, 100], [300, 100], [400, 100], [500, 100], [150, 100], [100, 100],
  [90, 30], [120, 40], [160, 40], [240, 60], [180, 60], [210, 70], [140, 70],
];

/** 비율 4지선다의 오답 풀 (업계에서 흔히 외우는 눈금). */
const RATIO_POOL: readonly number[] = [20, 25, 33, 40, 50];
/** 오답이 정답과 이만큼은 떨어져 있어야 "가장 가까운 값"이 유일해진다. */
const RATIO_GAP = 4;

interface OddsSpot {
  situation: DrillSituation;
  villainName: string;
  potChips: number;
  toCallChips: number;
  villainBet: number;
  pct: number;
  ratio: number;
  street: Street;
}

function buildOddsSpot(rng: () => number, bigBlind: number): OddsSpot | null {
  const [basePot, baseCall] = pickOne(rng, POT_PAIRS);
  const potChips = scaleChips(basePot, bigBlind);
  const toCallChips = scaleChips(baseCall, bigBlind);
  if (toCallChips <= 0 || toCallChips >= potChips) return null;

  const odds = computePotOdds(toCallChips, potChips);
  // 정답이 정확히 x.5%면 반올림 정답이 둘이 된다 — 리롤.
  if (Math.abs(odds.pct - Math.round(odds.pct)) > 0.49) return null;

  const street: Street = pickOne(rng, ['flop', 'turn'] as const);
  const cards = drawCards(rng, street === 'flop' ? 5 : 6);
  const hero = cards.slice(0, 2);
  const board = cards.slice(2);

  const layout = makeSeatLayout(rng);
  const seats = shuffleWith(rng, valueRange(0, TABLE_SIZE - 1)).slice(0, 2);
  const [villainId] = pickSupportCharacters(rng, 1);
  const villainName = characterName(villainId);
  const stackChips = STACK_BB * bigBlind;

  return {
    villainName,
    potChips,
    toCallChips,
    villainBet: toCallChips,
    pct: odds.pct,
    ratio: odds.ratio,
    street,
    situation: {
      hero,
      board,
      potChips,
      toCallChips,
      bigBlind,
      heroStackChips: stackChips,
      heroPosition: layout.positions[seats[0]],
      street,
      villains: [makeVillain(layout, seats[1], villainId, { stackChips })],
      note: `팟 ${potChips}에는 ${villainName}의 벳 ${toCallChips}이 이미 포함돼 있어요.`,
    },
  };
}

function oddsFacts(spot: OddsSpot, correct: number): DrillFacts {
  return {
    potChips: spot.potChips,
    toCallChips: spot.toCallChips,
    villainBet: spot.villainBet,
    potAfterCall: spot.potChips + spot.toCallChips,
    requiredEquity: correct,
    exactPct: round1(spot.pct),
    ratio: formatRatio(spot.ratio),
    villainName: spot.villainName,
    street: STREET_KO[spot.street],
    board: formatBoard(spot.situation.board),
  };
}

const requiredEquity: GeneratedDrillDefinition = {
  template: {
    id: 'odds-required-equity',
    category: 'pot-odds',
    title: '콜에 필요한 승률',
    difficulty: 1,
    hints: [
      '필요 승률 = 콜 ÷ (팟 + 콜)이에요. 팟 {potChips}에는 상대의 벳 {villainBet}이 이미 들어 있고요.',
    ],
    source: { kind: 'generated', params: {} },
  },
  build: ({ rng, bigBlind }) => {
    const spot = buildOddsSpot(rng, bigBlind);
    if (!spot) return null;
    const correct = Math.round(spot.pct);
    return {
      situation: spot.situation,
      question: `${spot.villainName}가 ${spot.toCallChips}을 벳했어요. 콜하려면 최소 몇 %의 승률이 필요할까요?`,
      answerSpec: { kind: 'numeric', correct, tolerance: 2, unit: '%', min: 0, max: 100 },
      facts: oddsFacts(spot, correct),
    };
  },
};

const ratioChoice: GeneratedDrillDefinition = {
  template: {
    id: 'odds-ratio-choice',
    category: 'pot-odds',
    title: '필요 승률 고르기',
    difficulty: 1,
    hints: [
      '콜하면 팟이 {potAfterCall}이 돼요. 그중 내 콜 {toCallChips}이 차지하는 비율이 답이에요.',
    ],
    source: { kind: 'generated', params: {} },
  },
  build: ({ rng, bigBlind }) => {
    const spot = buildOddsSpot(rng, bigBlind);
    if (!spot) return null;
    const correct = Math.round(spot.pct);

    const distractors = RATIO_POOL.filter(value => Math.abs(value - correct) >= RATIO_GAP).map(
      value => `${value}%`,
    );
    const choice = makeChoice(rng, `${correct}%`, distractors, 4);
    if (!choice) return null;

    return {
      situation: spot.situation,
      question: `${spot.villainName}가 ${spot.toCallChips}을 벳했어요. 콜에 필요한 승률과 가장 가까운 값은 무엇일까요?`,
      answerSpec: { kind: 'multiple-choice', options: choice.options, correctIndex: choice.correctIndex },
      facts: oddsFacts(spot, correct),
    };
  },
};

export const POT_ODDS_TEMPLATES: readonly GeneratedDrillDefinition[] = [requiredEquity, ratioChoice];
