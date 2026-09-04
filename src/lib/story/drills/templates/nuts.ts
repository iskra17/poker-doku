import { evaluateHand, HAND_RANK_KO } from '@/lib/poker/evaluator';
import { findNuts, unseenCards } from '@/lib/poker/learning';
import { pickOne, shuffleWith } from '@/lib/poker/seeded-rng';
import type { Card } from '@/lib/poker/types';
import { permuteKnownCards } from './combos';
import { formatBoard, type GeneratedDrillDefinition } from './kit';
/** 최고값을 만드는 실제 홀카드가 여럿이면 단일 선택 문제로 내지 않는다. */
export function uniqueNutsChoices(board: Card[], hero: readonly Card[], rng: () => number) {
  const nuts = findNuts(board, hero);
  if (nuts.holeCards.length !== 1)
    return null;
  const hole = nuts.holeCards[0];
  const deck = shuffleWith(rng, unseenCards([...board, ...hero]));
  const distractors: Card[][] = [];
  for (let index = 0; index + 1 < deck.length && distractors.length < 3; index += 2) {
    const candidate = [deck[index], deck[index + 1]];
    if (evaluateHand(candidate, board).value < nuts.hand.value)
      distractors.push(candidate);
  }
  if (distractors.length !== 3)
    return null;
  const candidates = shuffleWith(rng, [hole, ...distractors]);
  return { hole, rank: nuts.hand.rank, value: nuts.hand.value, candidates, options: candidates.map(formatBoard), correctIndex: candidates.indexOf(hole), combos: deck.length * (deck.length - 1) / 2 };
}
const BOARDS = ['2h 5h 9h Kc 7d', '3s 7s Js 2c 9d', 'Qh Qc 8d 4s 2c', '9h 9c 6d 3s 2c', '4d 8d Qd 2s 6c'] as const;
const BLOCKED = [
  { board: '2h 5h 9h Kc 7d', hero: 'Ah Qs' },
  { board: '3s 7s Js 2c 9d', hero: 'As Ks' },
  { board: 'Ks Kh As Ah 2d', hero: 'Kc Ac' },
  { board: 'Qh Qc 8d 4s 2c', hero: 'As Kd' },
  { board: '4d 8d Qd 2s 6c', hero: 'Ad Kd' },
] as const;
function definition(id: string, blocked: boolean): GeneratedDrillDefinition {
  return {
    template: { id, category: 'hand-ranking', title: blocked ? '블로커 이후의 넛츠' : '넛츠를 만드는 두 장', difficulty: 3,
      hints: ['보드와 내 카드를 제외한 상대의 두 장 조합을 비교해요. 족보 이름이 같아도 가장 높은 카드까지 같아야 동점이에요.'], source: { kind: 'generated', params: {} } },
    build: ({ rng, bigBlind }) => {
      const example = blocked ? pickOne(rng, BLOCKED) : { board: pickOne(rng, BOARDS), hero: '' };
      const { hero, board } = permuteKnownCards(rng, example.hero, example.board);
      const choice = uniqueNutsChoices(board, hero, rng);
      if (!choice)
        return null;
      return {
        situation: { hero, board, bigBlind, potChips: 0, toCallChips: 0, heroStackChips: 100 * bigBlind, heroPosition: 'BTN', street: 'river', villains: [], note: blocked ? '공개된 내 카드 두 장은 상대가 가질 수 없어요. 현재 보드에서 가능한 상대의 최고 홀카드를 물어요.' : '현재 보드에서 가능한 최고 홀카드 두 장을 물어요. 보기에 나온 조합은 실제 상대의 공개 카드가 아니에요.' },
        question: '알려진 카드를 제외하면, 현재 보드에서 상대의 넛츠를 만드는 두 장은 무엇일까요?',
        answerSpec: { kind: 'multiple-choice', options: choice.options, correctIndex: choice.correctIndex },
        facts: { hero: formatBoard(hero), board: formatBoard(board), nuts: formatBoard(choice.hole), hand: HAND_RANK_KO[choice.rank], combos: choice.combos },
      };
    },
  };
}
export const NUTS_TEMPLATES: readonly GeneratedDrillDefinition[] = [definition('nuts-unique-combo', false), definition('nuts-blocked-combo', true)];
