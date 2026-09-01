/**
 * D-RANK 생성 템플릿 — 족보 읽기 3종.
 *
 * - `rank-who-wins`  : 홀카드 전부 공개, 승자 맞히기 (타이면 리롤 — 정답 유일성)
 * - `rank-best-hand` : 내 최고 족보 이름 맞히기
 * - `rank-nuts`      : 리버 보드의 넛츠 족보 (Ch9 선행 구현)
 */
import { HAND_RANK_KO, evaluateHand } from '@/lib/poker/evaluator';
import { findNuts, handRankOrder } from '@/lib/poker/learning';
import { pickOne, shuffleWith } from '@/lib/poker/seeded-rng';
import type { HandRank } from '@/lib/poker/types';
import type { GeneratedDrillDefinition } from './kit';
import {
  STACK_BB,
  characterName,
  drawCards,
  formatBoard,
  makeChoice,
  makeSeatLayout,
  makeVillain,
  pickSupportCharacters,
} from './kit';

const ALL_RANKS: readonly HandRank[] = [
  'high-card', 'one-pair', 'two-pair', 'three-of-a-kind', 'straight',
  'flush', 'full-house', 'four-of-a-kind', 'straight-flush', 'royal-flush',
];

/** 인접 랭크 우선(순서값 차이 오름차순)으로 정렬한 오답 후보 한국어명. */
function adjacentRankNames(correct: HandRank): string[] {
  const target = handRankOrder(correct);
  return ALL_RANKS
    .filter(rank => rank !== correct)
    .sort((a, b) => Math.abs(handRankOrder(a) - target) - Math.abs(handRankOrder(b) - target))
    .map(rank => HAND_RANK_KO[rank]);
}

const whoWins: GeneratedDrillDefinition = {
  template: {
    id: 'rank-who-wins',
    category: 'hand-ranking',
    title: '누가 이기나요?',
    difficulty: 1,
    hints: ['각자 홀카드 2장 + 보드 5장에서 가장 좋은 다섯 장을 만들어 비교해요. 보드는 {board}예요.'],
    source: { kind: 'generated', params: {} },
  },
  build: ({ rng, bigBlind }) => {
    const cards = drawCards(rng, 11);
    const hero = cards.slice(0, 2);
    const villainHands = [cards.slice(2, 4), cards.slice(4, 6)];
    const board = cards.slice(6, 11);

    const hands = [evaluateHand(hero, board), ...villainHands.map(hole => evaluateHand(hole, board))];
    const best = Math.max(...hands.map(hand => hand.value));
    // 정답 유일성 — 동점(칩 스플릿)이면 "누가 이기나요"의 답이 하나가 아니다.
    if (hands.filter(hand => hand.value === best).length !== 1) return null;
    const winnerIndex = hands.findIndex(hand => hand.value === best);

    const layout = makeSeatLayout(rng);
    const seats = shuffleWith(rng, [0, 1, 2, 3, 4, 5]).slice(0, 3);
    const ids = pickSupportCharacters(rng, 2);
    const names = ids.map(characterName);
    const stackChips = STACK_BB * bigBlind;

    const options = ['나', names[0], names[1]];
    return {
      situation: {
        hero,
        board,
        potChips: pickOne(rng, [8, 10, 12, 16]) * bigBlind,
        toCallChips: 0,
        bigBlind,
        heroStackChips: stackChips,
        heroPosition: layout.positions[seats[0]],
        street: 'river',
        villains: [
          makeVillain(layout, seats[1], ids[0], { stackChips, holeCards: villainHands[0] }),
          makeVillain(layout, seats[2], ids[1], { stackChips, holeCards: villainHands[1] }),
        ],
        note: '세 명 모두 카드를 공개했어요.',
      },
      question: '쇼다운이에요. 이 팟은 누가 가져갈까요?',
      answerSpec: { kind: 'multiple-choice', options, correctIndex: winnerIndex },
      facts: {
        board: formatBoard(board),
        winner: options[winnerIndex],
        heroHand: HAND_RANK_KO[hands[0].rank],
        villain1Name: names[0],
        villain1Hand: HAND_RANK_KO[hands[1].rank],
        villain2Name: names[1],
        villain2Hand: HAND_RANK_KO[hands[2].rank],
      },
    };
  },
};

const bestHand: GeneratedDrillDefinition = {
  template: {
    id: 'rank-best-hand',
    category: 'hand-ranking',
    title: '내 최고 족보는?',
    difficulty: 1,
    hints: ['홀카드 2장과 보드 5장, 총 일곱 장에서 가장 좋은 다섯 장만 골라 보세요.'],
    source: { kind: 'generated', params: {} },
  },
  build: ({ rng, bigBlind }) => {
    const cards = drawCards(rng, 7);
    const hero = cards.slice(0, 2);
    const board = cards.slice(2, 7);
    const evaluated = evaluateHand(hero, board);
    const correct = HAND_RANK_KO[evaluated.rank];

    const choice = makeChoice(rng, correct, adjacentRankNames(evaluated.rank), 4);
    if (!choice) return null;

    const layout = makeSeatLayout(rng);
    const seats = shuffleWith(rng, [0, 1, 2, 3, 4, 5]).slice(0, 2);
    const [villainId] = pickSupportCharacters(rng, 1);
    const stackChips = STACK_BB * bigBlind;

    return {
      situation: {
        hero,
        board,
        potChips: pickOne(rng, [6, 8, 10, 14]) * bigBlind,
        toCallChips: 0,
        bigBlind,
        heroStackChips: stackChips,
        heroPosition: layout.positions[seats[0]],
        street: 'river',
        villains: [makeVillain(layout, seats[1], villainId, { stackChips })],
      },
      question: '보드가 다 깔렸어요. 내 최고 족보는 무엇일까요?',
      answerSpec: { kind: 'multiple-choice', options: choice.options, correctIndex: choice.correctIndex },
      facts: { hand: correct, hero: formatBoard(hero), board: formatBoard(board) },
    };
  },
};

const nuts: GeneratedDrillDefinition = {
  template: {
    id: 'rank-nuts',
    category: 'hand-ranking',
    title: '이 보드의 넛츠는?',
    difficulty: 2,
    hints: ['보드에 페어가 있으면 풀하우스·포카드가, 같은 무늬가 세 장이면 플러시가 가능해요.'],
    source: { kind: 'generated', params: {} },
  },
  build: ({ rng, bigBlind }) => {
    // 내 카드를 보여 주면 "내 넛츠"와 헷갈린다 — 보드만 놓고 묻는다.
    const board = drawCards(rng, 5);
    const result = findNuts(board);
    const correct = HAND_RANK_KO[result.hand.rank];

    const choice = makeChoice(rng, correct, adjacentRankNames(result.hand.rank), 4);
    if (!choice) return null;

    const layout = makeSeatLayout(rng);
    const seats = shuffleWith(rng, [0, 1, 2, 3, 4, 5]).slice(0, 2);
    const [villainId] = pickSupportCharacters(rng, 1);
    const stackChips = STACK_BB * bigBlind;

    return {
      situation: {
        hero: [],
        board,
        potChips: pickOne(rng, [10, 14, 18, 24]) * bigBlind,
        toCallChips: 0,
        bigBlind,
        heroStackChips: stackChips,
        heroPosition: layout.positions[seats[0]],
        street: 'river',
        villains: [makeVillain(layout, seats[1], villainId, { stackChips })],
        note: '내 카드와 상관없이, 이 보드에서 나올 수 있는 최강 조합을 물어요.',
      },
      question: '이 보드의 넛츠(가장 강한 조합)는 무엇일까요?',
      answerSpec: { kind: 'multiple-choice', options: choice.options, correctIndex: choice.correctIndex },
      facts: { nuts: correct, board: formatBoard(board), combos: 1081 },
    };
  },
};

export const HAND_RANKING_TEMPLATES: readonly GeneratedDrillDefinition[] = [whoWins, bestHand, nuts];
