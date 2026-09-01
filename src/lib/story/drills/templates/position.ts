/**
 * D-POS 생성 템플릿 — 포지션 2종.
 *
 * - `pos-name`         : 버튼 위치를 주고 내 자리 이름 맞히기
 * - `pos-first-to-act` : 스트리트별 첫 액션 자리 (전원 참여 가정)
 *
 * 주의: `pos-name`은 포지션 라벨 자체가 정답이므로 상황 카드의 `heroPosition`과
 * 빌런 `position`을 전부 '?'로 감춘다 (버튼 위치는 `note`로만 준다).
 */
import { pickOne, randomInt } from '@/lib/poker/seeded-rng';
import type { Street } from '@/lib/poker/types';
import type { DrillVillain } from '../types';
import type { GeneratedDrillDefinition } from './kit';
import {
  STACK_BB,
  STREET_KO,
  TABLE_SIZE,
  drawCards,
  formatBoard,
  makeChoice,
  makeSeatLayout,
  makeVillain,
  pickSupportCharacters,
  postflopSeatOrder,
  preflopSeatOrder,
  seatLabels,
} from './kit';

const HIDDEN = '?';

const posName: GeneratedDrillDefinition = {
  template: {
    id: 'pos-name',
    category: 'position',
    title: '이 자리 이름은?',
    difficulty: 1,
    hints: ['딜러 버튼({dealerSeatNo}번 자리) 다음이 SB, 그 다음이 BB예요. 거기서 한 바퀴 세어 보세요.'],
    source: { kind: 'generated', params: {} },
  },
  build: ({ rng, bigBlind }) => {
    const layout = makeSeatLayout(rng);
    const heroSeat = randomInt(rng, TABLE_SIZE);
    const position = layout.positions[heroSeat];

    const choice = makeChoice(rng, position, seatLabels(), 4);
    if (!choice) return null;

    const hero = drawCards(rng, 2);
    const ids = pickSupportCharacters(rng, TABLE_SIZE - 1);
    const stackChips = STACK_BB * bigBlind;
    const smallBlind = Math.round(bigBlind / 2);

    const villains: DrillVillain[] = [];
    let idIndex = 0;
    for (let seat = 0; seat < TABLE_SIZE; seat++) {
      if (seat === heroSeat) continue;
      villains.push(makeVillain(layout, seat, ids[idIndex++], { stackChips, positionOverride: HIDDEN }));
    }

    const order = preflopSeatOrder(layout);
    const seatsAfter = TABLE_SIZE - 1 - order.indexOf(heroSeat);
    const toCallChips = position === 'BB' ? 0 : position === 'SB' ? bigBlind - smallBlind : bigBlind;

    return {
      situation: {
        hero,
        board: [],
        potChips: smallBlind + bigBlind,
        toCallChips,
        bigBlind,
        heroStackChips: stackChips,
        heroPosition: HIDDEN,
        street: 'preflop',
        villains,
        note: `딜러 버튼은 ${layout.dealerSeat + 1}번 자리, 내 자리는 ${heroSeat + 1}번 자리예요.`,
      },
      question: '지금 내가 앉은 자리의 포지션 이름은 무엇일까요?',
      answerSpec: { kind: 'multiple-choice', options: choice.options, correctIndex: choice.correctIndex },
      facts: {
        position,
        dealerSeatNo: layout.dealerSeat + 1,
        heroSeatNo: heroSeat + 1,
        offset: (heroSeat - layout.dealerSeat + TABLE_SIZE) % TABLE_SIZE,
        seatsAfter,
      },
    };
  },
};

const firstToAct: GeneratedDrillDefinition = {
  template: {
    id: 'pos-first-to-act',
    category: 'position',
    title: '누가 먼저 액션하나요?',
    difficulty: 1,
    hints: ['프리플랍은 블라인드를 낸 두 자리 다음부터, 플랍부터는 버튼 왼쪽부터 시작해요.'],
    source: { kind: 'generated', params: {} },
  },
  build: ({ rng, bigBlind }) => {
    const layout = makeSeatLayout(rng);
    const street: Street = pickOne(rng, ['preflop', 'flop'] as const);
    const cards = drawCards(rng, 5);
    const hero = cards.slice(0, 2);
    const board = street === 'flop' ? cards.slice(2, 5) : [];

    const order = street === 'preflop' ? preflopSeatOrder(layout) : postflopSeatOrder(layout);
    const firstSeat = order[0];
    const correct = layout.positions[firstSeat];

    const choice = makeChoice(rng, correct, seatLabels(), 3);
    if (!choice) return null;

    const heroSeat = randomInt(rng, TABLE_SIZE);
    const ids = pickSupportCharacters(rng, TABLE_SIZE - 1);
    const stackChips = STACK_BB * bigBlind;
    const smallBlind = Math.round(bigBlind / 2);

    const villains: DrillVillain[] = [];
    let idIndex = 0;
    for (let seat = 0; seat < TABLE_SIZE; seat++) {
      if (seat === heroSeat) continue;
      villains.push(makeVillain(layout, seat, ids[idIndex++], { stackChips }));
    }

    const streetKo = STREET_KO[street];
    return {
      situation: {
        hero,
        board,
        potChips: street === 'preflop' ? smallBlind + bigBlind : 6 * bigBlind,
        toCallChips: 0,
        bigBlind,
        heroStackChips: stackChips,
        heroPosition: layout.positions[heroSeat],
        street,
        villains,
        note: '여섯 명이 모두 핸드에 남아 있어요.',
      },
      question: `여섯 명 전원이 참여한 상태예요. ${streetKo}에서 가장 먼저 액션하는 자리는 어디일까요?`,
      answerSpec: { kind: 'multiple-choice', options: choice.options, correctIndex: choice.correctIndex },
      facts: {
        street: streetKo,
        first: correct,
        board: formatBoard(board),
        dealerSeatNo: layout.dealerSeat + 1,
      },
    };
  },
};

export const POSITION_TEMPLATES: readonly GeneratedDrillDefinition[] = [posName, firstToAct];
