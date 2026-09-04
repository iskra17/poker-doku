import { parseCards } from '@/lib/poker/card-notation';
import { pickOne, shuffleWith } from '@/lib/poker/seeded-rng';
import type { Card } from '@/lib/poker/types';
import { countRangeFacts } from '../range-facts';
import { SUITS, formatBoard, type GeneratedDrillDefinition } from './kit';
/** 무늬만 치환해 콤보 구조를 보존하면서 복습 seed마다 다른 카드를 보여 준다. */
export function permuteKnownCards(rng: () => number, heroText: string, boardText: string): {
  hero: Card[];
  board: Card[];
} {
  const suits = shuffleWith(rng, SUITS);
  const transform = (text: string) => parseCards(text).map(card => ({ ...card, suit: suits[SUITS.indexOf(card.suit)] }));
  return { hero: transform(heroText), board: transform(boardText) };
}
const ONE_BLOCKER = [
  { range: 'AA', hero: 'As 2h', board: 'Kd 9c 4s' },
  { range: 'AKs', hero: 'As 2h', board: 'Qd 9c 4s' },
  { range: 'AKo', hero: 'Kh 2s', board: 'Qd 9c 4s' },
  { range: 'QQ', hero: 'Qs 2h', board: 'Kd 9c 4s' },
  { range: 'QJs', hero: 'Jh 2s', board: 'Ad 9c 4s' },
  { range: 'KQo', hero: 'Qs 2h', board: 'Ad 9c 4s' },
] as const;
const PAIRED = [
  { range: 'AA, AK', hero: 'As Kh', board: 'Ac Ad 7s' },
  { range: 'KK, KQ', hero: 'Ks Qh', board: 'Kd Kc 8s' },
  { range: 'QQ, QJs', hero: 'Qs Jh', board: 'Qd Qc 4s' },
  { range: 'JJ, AJs, AJo', hero: 'Js Ah', board: 'Jd Jc 6s' },
] as const;
function definition(id: string, mode: 'base' | 'blocker' | 'paired'): GeneratedDrillDefinition {
  return {
    template: { id, category: 'combos', title: mode === 'base' ? '기본 콤보 세기' : mode === 'blocker' ? '블로커를 뺀 콤보' : '페어 보드의 남은 콤보', difficulty: mode === 'paired' ? 3 : 2,
      hints: ['포켓 페어는 6, 수딧은 4, 오프수트는 12콤보에서 시작해요. 내 카드와 보드의 같은 카드를 포함한 조합은 빼요.'], source: { kind: 'generated', params: {} } },
    build: ({ rng, bigBlind }) => {
      const example = mode === 'base' ? { range: pickOne(rng, ['AA', 'KK', 'QQ', 'JJ', 'AKs', 'AQs', 'KQs', 'AKo', 'AQo', 'KQo']), hero: '', board: '' } : pickOne<{
        range: string;
        hero: string;
        board: string;
      }>(rng, mode === 'paired' ? PAIRED : ONE_BLOCKER);
      const { hero, board } = permuteKnownCards(rng, example.hero, example.board);
      const result = countRangeFacts(example.range, hero, board);
      return {
        situation: { hero, board, bigBlind, potChips: 0, toCallChips: 0, heroStackChips: 100 * bigBlind, heroPosition: 'BTN', street: board.length ? 'flop' : 'preflop', villains: [], note: '콤보 계산 연습이에요. 공개된 내 카드와 보드만 제외하고, 중복 레인지 표기는 한 번만 세요.' },
        question: `레인지 ${example.range}에서 가능한 상대 홀카드 조합은 몇 콤보일까요?`,
        answerSpec: { kind: 'numeric', correct: result.remaining, tolerance: 0, unit: 'combos', min: 0, max: 1326 },
        facts: { range: example.range, hero: formatBoard(hero), board: formatBoard(board), total: result.total, removed: result.removed, remaining: result.remaining },
      };
    },
  };
}
export const COMBO_TEMPLATES: readonly GeneratedDrillDefinition[] = [definition('combo-count', 'base'), definition('combo-blockers', 'blocker'), definition('combo-paired-board', 'paired')];
