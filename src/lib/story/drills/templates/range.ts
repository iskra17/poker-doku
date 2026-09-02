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
  drawCards,
  makeSeatLayout,
  makeVillain,
  pickSupportCharacters,
  preflopSeatOrder,
  round1,
  seatOfPosition,
} from './kit';

/** 언오픈 팟 오픈 레이즈 임계 (상위 %) — 기획 A7 ③. */
export const OPEN_THRESHOLDS: Readonly<Record<string, number>> = Object.freeze({
  UTG: 15,
  HJ: 18,
  CO: 25,
  BTN: 35,
  SB: 25,
});

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

export const RANGE_TEMPLATES: readonly GeneratedDrillDefinition[] = [openDecision, percentile];
