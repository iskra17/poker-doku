/**
 * D-RANGE 생성 템플릿 — 프리플랍 참여 판단 2종.
 *
 * 백분위 단일 소스는 `hand-rankings.ts`의 `handPercentile`(0=최강~1=최약, Chen 콤보 가중).
 * 포지션 임계는 기획 A7 ③ 표와 같은 값을 쓴다 — 리뷰 규칙과 어긋나면 "문제에서 배운 것과
 * 실전 리뷰가 다른" 사고가 난다.
 */
import { handKey, handPercentile } from '@/lib/bot/hand-rankings';
import { pickOne } from '@/lib/poker/seeded-rng';
import type { DrillVillain } from '../types';
import type { GeneratedDrillDefinition } from './kit';
import {
  STACK_BB,
  TABLE_SIZE,
  characterName,
  drawCards,
  makeSeatLayout,
  makeVillain,
  pickSupportCharacters,
  preflopSeatOrder,
  round1,
  seatOfPosition,
} from './kit';

import {
  CALL_VS_THREE_BET_THRESHOLD,
  COLD_CALL_THRESHOLD,
  FOUR_BET_THRESHOLD,
  OPEN_THRESHOLDS,
  THREE_BET_THRESHOLD,
} from '../../open-thresholds';

/** 임계에서 이 폭 안쪽이면 "경계 문항"이라 출제하지 않는다 (A4 D-RANGE 규약). */
const BORDER_MARGIN = 3;

function seatVillains(
  layout: ReturnType<typeof makeSeatLayout>,
  heroSeat: number,
  ids: readonly string[],
  stackChips: number,
): DrillVillain[] {
  const villains: DrillVillain[] = [];
  let idIndex = 0;
  for (let seat = 0; seat < TABLE_SIZE; seat++) {
    if (seat === heroSeat) continue;
    villains.push(makeVillain(layout, seat, ids[idIndex++], { stackChips }));
  }
  return villains;
}

const openDecision: GeneratedDrillDefinition = {
  template: {
    id: 'range-open-decision',
    category: 'range',
    title: '참여? 폴드?',
    difficulty: 1,
    hints: ['{position}에서는 대략 상위 {threshold}% 안쪽만 오픈해요. 뒤에 {seatsAfter}명이 남아 있고요.'],
    source: { kind: 'generated', params: { borderMargin: BORDER_MARGIN } },
  },
  build: ({ rng, bigBlind }) => {
    const position = pickOne(rng, ['UTG', 'HJ', 'CO', 'BTN'] as const);
    const hero = drawCards(rng, 2);
    const pct = handPercentile(hero) * 100;
    const threshold = OPEN_THRESHOLDS[position];
    // 경계 ±3%p는 "정답이 하나"라고 말하기 어렵다 — 리롤.
    if (Math.abs(pct - threshold) <= BORDER_MARGIN) return null;

    const layout = makeSeatLayout(rng);
    const heroSeat = seatOfPosition(layout, position);
    const ids = pickSupportCharacters(rng, TABLE_SIZE - 1);
    const stackChips = STACK_BB * bigBlind;
    const smallBlind = Math.round(bigBlind / 2);
    const seatsAfter = TABLE_SIZE - 1 - preflopSeatOrder(layout).indexOf(heroSeat);

    const open = pct < threshold;
    return {
      situation: {
        hero,
        board: [],
        potChips: smallBlind + bigBlind,
        toCallChips: bigBlind,
        bigBlind,
        heroStackChips: stackChips,
        heroPosition: position,
        street: 'preflop',
        villains: seatVillains(layout, heroSeat, ids, stackChips),
        note: '앞에서 아무도 들어오지 않았어요 (언오픈 팟).',
      },
      question: `${position}이에요. 앞이 전부 폴드했어요. 이 핸드로 오픈 레이즈할까요?`,
      answerSpec: { kind: 'multiple-choice', options: ['오픈 레이즈', '폴드'], correctIndex: open ? 0 : 1 },
      facts: {
        hand: handKey(hero),
        pct: round1(pct),
        threshold,
        position,
        seatsAfter,
        decision: open ? '오픈 레이즈' : '폴드',
      },
    };
  },
};

const percentile: GeneratedDrillDefinition = {
  template: {
    id: 'range-percentile',
    category: 'range',
    title: '상위 몇 %?',
    difficulty: 2,
    hints: ['AA가 0%에 가깝고 72o가 100%에 가까운 눈금이에요. 이 핸드는 {hand}고요.'],
    source: { kind: 'generated', params: {} },
  },
  build: ({ rng, bigBlind }) => {
    const hero = drawCards(rng, 2);
    const pct = handPercentile(hero) * 100;
    const correct = Math.min(100, Math.max(1, Math.round(pct)));

    const layout = makeSeatLayout(rng);
    const position = pickOne(rng, ['UTG', 'HJ', 'CO', 'BTN', 'SB', 'BB'] as const);
    const heroSeat = seatOfPosition(layout, position);
    const ids = pickSupportCharacters(rng, TABLE_SIZE - 1);
    const stackChips = STACK_BB * bigBlind;
    const smallBlind = Math.round(bigBlind / 2);

    return {
      situation: {
        hero,
        board: [],
        potChips: smallBlind + bigBlind,
        toCallChips: position === 'BB' ? 0 : bigBlind,
        bigBlind,
        heroStackChips: stackChips,
        heroPosition: position,
        street: 'preflop',
        villains: seatVillains(layout, heroSeat, ids, stackChips),
      },
      question: '169가지 시작 핸드 중에서, 이 핸드는 상위 몇 %일까요?',
      answerSpec: { kind: 'numeric', correct, tolerance: 10, unit: '%', min: 1, max: 100 },
      facts: { hand: handKey(hero), pct: round1(pct), position },
    };
  },
};

/** 3구간 경계 ±1.5%p는 출제하지 않는다 (정답이 하나라고 말하기 어려운 구간). */
const THREE_WAY_MARGIN = 1.5;

type ThreeWay = 'raise' | 'call' | 'fold';

function threeWay(pct: number, raiseLine: number, callLine: number): ThreeWay | null {
  if (Math.abs(pct - raiseLine) <= THREE_WAY_MARGIN || Math.abs(pct - callLine) <= THREE_WAY_MARGIN) return null;
  if (pct < raiseLine) return 'raise';
  if (pct < callLine) return 'call';
  return 'fold';
}

/** 앞자리 오픈을 맞은 히어로 — 3벳 / 콜 / 폴드 (Ch6). 히어로는 오프너보다 뒤 자리. */
const threeBetDecision: GeneratedDrillDefinition = {
  template: {
    id: 'range-3bet-decision',
    category: 'range',
    title: '3벳? 콜? 폴드?',
    difficulty: 2,
    hints: ['오픈을 맞았을 땐 상위 {threeBet}% 안이면 3벳, {callLine}%까지는 콜, 그 밖은 폴드예요. 이 핸드는 상위 {pct}%고요.'],
    source: { kind: 'generated', params: { threeBet: THREE_BET_THRESHOLD, callLine: COLD_CALL_THRESHOLD } },
  },
  build: ({ rng, bigBlind }) => {
    const hero = drawCards(rng, 2);
    const pct = handPercentile(hero) * 100;
    const decision = threeWay(pct, THREE_BET_THRESHOLD, COLD_CALL_THRESHOLD);
    if (!decision) return null;

    const layout = makeSeatLayout(rng);
    const order = preflopSeatOrder(layout);
    // 오프너는 UTG/HJ/CO 중 하나, 히어로는 그보다 뒤(SB/BB 포함)
    const openerIndex = pickOne(rng, [0, 1, 2]);
    const heroIndex = openerIndex + 1 + Math.floor(rng() * (TABLE_SIZE - 1 - openerIndex));
    const openerSeat = order[openerIndex];
    const heroSeat = order[heroIndex];
    const position = layout.positions[heroSeat];
    const ids = pickSupportCharacters(rng, TABLE_SIZE - 1);
    const stackChips = STACK_BB * bigBlind;
    const openChips = bigBlind * 3;
    const smallBlind = Math.round(bigBlind / 2);
    const villains = seatVillains(layout, heroSeat, ids, stackChips);
    const opener = villains.find(villain => villain.seatIndex === openerSeat);
    if (!opener) return null;
    const openerName = characterName(opener.characterId);
    const heroPosted = position === 'BB' ? bigBlind : position === 'SB' ? smallBlind : 0;
    const label = { raise: '3벳', call: '콜', fold: '폴드' }[decision];

    return {
      situation: {
        hero,
        board: [],
        potChips: smallBlind + bigBlind + openChips,
        toCallChips: openChips - heroPosted,
        bigBlind,
        heroStackChips: stackChips,
        heroPosition: position,
        street: 'preflop',
        villains,
        note: `${openerName}(${opener.position})가 3BB로 오픈 레이즈했어요. 나까지 다른 사람은 모두 폴드.`,
      },
      question: `${openerName}의 오픈을 맞았어요. 이 핸드로 어떻게 할까요?`,
      answerSpec: { kind: 'multiple-choice', options: ['3벳', '콜', '폴드'], correctIndex: ['3벳', '콜', '폴드'].indexOf(label) },
      facts: {
        hand: handKey(hero),
        pct: round1(pct),
        threeBet: THREE_BET_THRESHOLD,
        callLine: COLD_CALL_THRESHOLD,
        position,
        openerName,
        decision: label,
      },
    };
  },
};

/** 내 오픈이 3벳을 맞았다 — 4벳 / 콜 / 폴드 (Ch6 「3벳 대면 3구간」). */
const versusThreeBet: GeneratedDrillDefinition = {
  template: {
    id: 'range-vs-3bet',
    category: 'range',
    title: '3벳을 맞았다',
    difficulty: 2,
    hints: ['내 오픈이 3벳을 맞으면 상위 {fourBet}% 안이면 4벳, {callLine}%까지는 콜, 그 밖은 폴드예요. 이 핸드는 상위 {pct}%고요.'],
    source: { kind: 'generated', params: { fourBet: FOUR_BET_THRESHOLD, callLine: CALL_VS_THREE_BET_THRESHOLD } },
  },
  build: ({ rng, bigBlind }) => {
    const position = pickOne(rng, ['UTG', 'HJ', 'CO', 'BTN'] as const);
    const hero = drawCards(rng, 2);
    const pct = handPercentile(hero) * 100;
    // 오픈 자체가 임계 밖이면 상황이 성립하지 않는다 — 오픈 레인지 안의 핸드만.
    if (pct >= OPEN_THRESHOLDS[position] - BORDER_MARGIN) return null;
    const decision = threeWay(pct, FOUR_BET_THRESHOLD, CALL_VS_THREE_BET_THRESHOLD);
    if (!decision) return null;

    const layout = makeSeatLayout(rng);
    const heroSeat = seatOfPosition(layout, position);
    const order = preflopSeatOrder(layout);
    const heroIndex = order.indexOf(heroSeat);
    const laterSeats = order.slice(heroIndex + 1);
    if (laterSeats.length === 0) return null;
    const raiserSeat = pickOne(rng, laterSeats);
    const ids = pickSupportCharacters(rng, TABLE_SIZE - 1);
    const stackChips = STACK_BB * bigBlind;
    const openChips = bigBlind * 3;
    const threeBetChips = bigBlind * 9;
    const smallBlind = Math.round(bigBlind / 2);
    const villains = seatVillains(layout, heroSeat, ids, stackChips);
    const raiser = villains.find(villain => villain.seatIndex === raiserSeat);
    if (!raiser) return null;
    const raiserName = characterName(raiser.characterId);
    const label = { raise: '4벳', call: '콜', fold: '폴드' }[decision];
    const blindsInPot = raiser.position === 'SB' ? bigBlind : raiser.position === 'BB' ? smallBlind : smallBlind + bigBlind;

    return {
      situation: {
        hero,
        board: [],
        potChips: blindsInPot + openChips + threeBetChips,
        toCallChips: threeBetChips - openChips,
        bigBlind,
        heroStackChips: stackChips - openChips,
        heroPosition: position,
        street: 'preflop',
        villains,
        note: `내가 ${position}에서 3BB로 오픈했는데 ${raiserName}(${raiser.position})가 9BB로 3벳했어요. 나머지는 폴드.`,
      },
      question: `${raiserName}의 3벳을 맞았어요. 이 핸드로 어떻게 할까요?`,
      answerSpec: { kind: 'multiple-choice', options: ['4벳', '콜', '폴드'], correctIndex: ['4벳', '콜', '폴드'].indexOf(label) },
      facts: {
        hand: handKey(hero),
        pct: round1(pct),
        fourBet: FOUR_BET_THRESHOLD,
        callLine: CALL_VS_THREE_BET_THRESHOLD,
        position,
        raiserName,
        decision: label,
      },
    };
  },
};

export const RANGE_TEMPLATES: readonly GeneratedDrillDefinition[] = [openDecision, percentile, threeBetDecision, versusThreeBet];
