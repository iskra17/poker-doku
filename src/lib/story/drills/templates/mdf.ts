/**
 * D-MDF 생성 템플릿 3종 — 최소 방어 빈도(MDF)와, 그것과 헷갈리는 두 숫자의 구분.
 *
 * 스팟은 언제나 "리버, 상대가 벳 전 팟 **P**에 **B**를 벳, 내 핸드는 블러프 캐처".
 * 금액 표기 계약(문항·note에 셋 다 적는다):
 * - **P = 벳 전 팟** (D-BE와 같은 방향)
 * - **B = 상대의 벳 = 내 콜 금액** → `situation.toCallChips`
 * - **P + B = 지금 중앙 총액** → `situation.potChips` (D-ODDS 정의)
 *
 * 세 값(`computeMdf`)은 전부 다른 숫자이고, 그 혼동이 이 카테고리의 핵심 오답이다.
 * 그래서 (P,B) 후보는 반올림 오차 ≤0.49(x.5 금지)와 **쌍별 간격 ≥4%p**를 코드로 재검증하고,
 * 못 넘기면 리롤한다 — "가장 가까운 정수 %"가 유일해야 4지선다가 성립한다.
 */
import { evaluateHand } from '@/lib/poker/evaluator';
import { computeMdf } from '@/lib/poker/learning';
import { pickOne, shuffleWith } from '@/lib/poker/seeded-rng';
import type { Card } from '@/lib/poker/types';
import type { DrillSituation } from '../types';
import type { DrillFacts, GeneratedDrillDefinition } from './kit';
import {
  STACK_BB,
  TABLE_SIZE,
  characterName,
  drawCards,
  formatBoard,
  makeChoice,
  makeSeatLayout,
  makeVillain,
  pickSupportCharacters,
  round1,
  scaleChips,
  valueRange,
} from './kit';

/** (벳 전 팟 P, 벳 B) — bb=20 기준. 실제 채택은 아래 `usable()` 재검증을 통과한 조합만. */
const MDF_PAIRS: readonly (readonly [number, number])[] = [
  [100, 50], [200, 100], [100, 75], [300, 100], [150, 50], [100, 200], [100, 300],
  [120, 40], [160, 80], [180, 60], [90, 30], [100, 40], [100, 80],
];

/** 4지선다 오답 눈금 풀 — 업계에서 외우는 값들. */
const PCT_POOL: readonly number[] = [20, 25, 33, 40, 50, 60, 67, 75, 80];
/** 표시 정수끼리 이만큼 떨어져야 "가장 가까운 값"이 유일해진다. */
const PCT_GAP = 4;

interface MdfSpot {
  situation: DrillSituation;
  villainName: string;
  potBeforeBet: number;
  betChips: number;
  potChips: number;
  /** 반올림 전 퍼센트 */
  exact: { mdf: number; callEquity: number; villainBreakeven: number };
  /** 표시용 반올림 정수 */
  shown: { mdf: number; callEquity: number; villainBreakeven: number };
}

/** 반올림이 x.5로 갈리지 않고, 세 값의 표시 정수가 서로 ≥4%p 떨어지는 조합만 쓴다. */
function usable(values: readonly number[]): boolean {
  for (const value of values) {
    if (Math.abs(value - Math.round(value)) > 0.49) return false;
  }
  const shown = values.map(value => Math.round(value));
  for (let i = 0; i < shown.length; i++) {
    for (let j = i + 1; j < shown.length; j++) {
      if (Math.abs(shown[i] - shown[j]) < PCT_GAP) return false;
    }
  }
  return true;
}

/** 블러프 캐처 — 하이카드나 원페어여야 "MDF로 레인지를 지키는" 이야기가 성립한다. */
function isBluffCatcher(hero: readonly Card[], board: readonly Card[]): boolean {
  const rank = evaluateHand([...hero], [...board]).rank;
  return rank === 'high-card' || rank === 'one-pair';
}

function buildSpot(rng: () => number, bigBlind: number): MdfSpot | null {
  const [basePot, baseBet] = pickOne(rng, MDF_PAIRS);
  const potBeforeBet = scaleChips(basePot, bigBlind);
  const betChips = scaleChips(baseBet, bigBlind);
  if (potBeforeBet <= 0 || betChips <= 0) return null;

  const stackChips = STACK_BB * bigBlind;
  // 벳이 스택을 넘으면 "상대가 이만큼 벳했다"는 전제가 깨진다.
  if (betChips > stackChips) return null;

  const exact = computeMdf(potBeforeBet, betChips);
  if (!usable([exact.mdf, exact.callEquity, exact.villainBreakeven])) return null;

  const cards = drawCards(rng, 7);
  const hero = cards.slice(0, 2);
  const board = cards.slice(2);
  if (!isBluffCatcher(hero, board)) return null;

  const layout = makeSeatLayout(rng);
  const seats = shuffleWith(rng, valueRange(0, TABLE_SIZE - 1)).slice(0, 2);
  const [villainId] = pickSupportCharacters(rng, 1);
  const villainName = characterName(villainId);
  const potChips = potBeforeBet + betChips;

  return {
    villainName,
    potBeforeBet,
    betChips,
    potChips,
    exact,
    shown: {
      mdf: Math.round(exact.mdf),
      callEquity: Math.round(exact.callEquity),
      villainBreakeven: Math.round(exact.villainBreakeven),
    },
    situation: {
      hero,
      board,
      potChips,
      toCallChips: betChips,
      bigBlind,
      heroStackChips: stackChips,
      heroPosition: layout.positions[seats[0]],
      street: 'river',
      villains: [makeVillain(layout, seats[1], villainId, { stackChips })],
      note:
        `리버. ${villainName}가 벳 전 팟 ${potBeforeBet}에 ${betChips}을 벳했어요. `
        + `지금 중앙은 ${potBeforeBet} + ${betChips} = ${potChips}이고, 콜 금액은 ${betChips}이에요.`,
    },
  };
}

function facts(spot: MdfSpot): DrillFacts {
  return {
    potBeforeBet: spot.potBeforeBet,
    betChips: spot.betChips,
    potChips: spot.potChips,
    mdf: spot.shown.mdf,
    callEquity: spot.shown.callEquity,
    villainBreakeven: spot.shown.villainBreakeven,
    mdfExact: round1(spot.exact.mdf),
    callEquityExact: round1(spot.exact.callEquity),
    villainBreakevenExact: round1(spot.exact.villainBreakeven),
    villainName: spot.villainName,
    board: formatBoard(spot.situation.board),
    hero: formatBoard(spot.situation.hero),
  };
}

/** 이미 고른 값들과 전부 ≥4%p 떨어진 후보만 순서대로 채운다. 모자라면 null(리롤). */
function pickDistractors(correct: number, candidates: readonly number[], count: number): string[] | null {
  const taken = [correct];
  const out: string[] = [];
  for (const candidate of candidates) {
    if (out.length === count) break;
    if (taken.some(value => Math.abs(value - candidate) < PCT_GAP)) continue;
    taken.push(candidate);
    out.push(`${candidate}%`);
  }
  return out.length === count ? out : null;
}

const defendPct: GeneratedDrillDefinition = {
  template: {
    id: 'mdf-defend-pct',
    category: 'mdf',
    title: '레인지를 지키는 최소 빈도',
    difficulty: 3,
    hints: ['MDF = 벳 전 팟 ÷ (벳 전 팟 + 벳)이에요. {potBeforeBet} ÷ {potChips}을 계산해 보세요.'],
    source: { kind: 'generated', params: {} },
  },
  build: ({ rng, bigBlind }) => {
    const spot = buildSpot(rng, bigBlind);
    if (!spot) return null;
    return {
      situation: spot.situation,
      question:
        `${spot.villainName}가 벳 전 팟 ${spot.potBeforeBet}에 ${spot.betChips}을 벳했어요. `
        + '내 레인지가 최소 몇 % 방어(콜/레이즈)해야 상대의 0에퀴티 블러프가 자동 이익을 못 볼까요?',
      answerSpec: { kind: 'numeric', correct: spot.shown.mdf, tolerance: 2, unit: '%', min: 0, max: 100 },
      facts: facts(spot),
    };
  },
};

const defendChoice: GeneratedDrillDefinition = {
  template: {
    id: 'mdf-choice',
    category: 'mdf',
    title: 'MDF 고르기',
    difficulty: 2,
    hints: ['방어 빈도의 분모는 벳까지 더한 {potChips}이고, 분자는 벳 전 팟 {potBeforeBet}이에요.'],
    source: { kind: 'generated', params: {} },
  },
  build: ({ rng, bigBlind }) => {
    const spot = buildSpot(rng, bigBlind);
    if (!spot) return null;
    const distractors = pickDistractors(
      spot.shown.mdf,
      [spot.shown.callEquity, spot.shown.villainBreakeven, ...PCT_POOL],
      3,
    );
    if (!distractors) return null;
    const choice = makeChoice(rng, `${spot.shown.mdf}%`, distractors, 4);
    if (!choice) return null;
    return {
      situation: spot.situation,
      question:
        `${spot.villainName}가 벳 전 팟 ${spot.potBeforeBet}에 ${spot.betChips}을 벳했어요. `
        + '내 레인지의 최소 방어 빈도(MDF)에 가장 가까운 정수 %는 무엇일까요?',
      answerSpec: { kind: 'multiple-choice', options: choice.options, correctIndex: choice.correctIndex },
      facts: facts(spot),
    };
  },
};

const vsCallEquity: GeneratedDrillDefinition = {
  template: {
    id: 'mdf-vs-call-equity',
    category: 'mdf',
    title: 'MDF와 필요 승률은 다른 숫자',
    difficulty: 3,
    hints: ['MDF의 분모는 {potChips}, 콜 필요 승률의 분모는 {potChips}에 콜 {betChips}을 더한 값이에요.'],
    source: { kind: 'generated', params: {} },
  },
  build: ({ rng, bigBlind }) => {
    const spot = buildSpot(rng, bigBlind);
    if (!spot) return null;
    const { mdf, callEquity, villainBreakeven } = spot.shown;
    const label = (defend: number, equity: number) => `MDF ${defend}% · 필요 승률 ${equity}%`;
    const correct = label(mdf, callEquity);
    const distractors = [label(callEquity, mdf), label(villainBreakeven, callEquity), label(mdf, villainBreakeven)];
    if (new Set([correct, ...distractors]).size !== 4) return null;
    const choice = makeChoice(rng, correct, distractors, 4);
    if (!choice) return null;
    return {
      situation: spot.situation,
      question:
        `${spot.villainName}가 벳 전 팟 ${spot.potBeforeBet}에 ${spot.betChips}을 벳했어요. `
        + 'MDF와 이 핸드로 콜할 때 필요한 승률을 가장 가까운 정수 %로 올바르게 짝지은 것은?',
      answerSpec: { kind: 'multiple-choice', options: choice.options, correctIndex: choice.correctIndex },
      facts: facts(spot),
    };
  },
};

export const MDF_TEMPLATES: readonly GeneratedDrillDefinition[] = [defendPct, defendChoice, vsCallEquity];
