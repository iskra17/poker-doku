import { pickOne } from '@/lib/poker/seeded-rng';
import { readRangeFacts } from '../range-facts';
import { permuteKnownCards } from './combos';
import { formatBoard, type GeneratedDrillDefinition } from './kit';
const EXAMPLES = [
  { hero: 'As Qh', board: 'Kd 7c 3s 9h 2d', range: 'KK, 77, 33, AK, QJ, JT, TT', valueRange: 'KK, 77, 33, AK', bluffRange: 'QJ, JT' },
  { hero: 'Qs Jh', board: 'Qd 9c 4s 2h 2d', range: 'QQ, 99, 44, AQ, JT, T8s, 88', valueRange: 'QQ, 99, 44, AQ', bluffRange: 'JT, T8s' },
  { hero: 'As Jd', board: 'Ac 8d 5s 3h 2c', range: 'AA, 88, 55, AK, AQ, KQ, QJ, 99', valueRange: 'AA, 88, 55, AK, AQ', bluffRange: 'KQ, QJ' },
  { hero: 'Ah Qh', board: 'Td Tc 6s 4h 2d', range: 'TT, 66, AT, KJ, QJ, 88', valueRange: 'TT, 66, AT', bluffRange: 'KJ, QJ' },
] as const;
function definition(id: string, focus: 'valueCombos' | 'bluffCombos' | 'actionRemoved'): GeneratedDrillDefinition {
  const label = focus === 'valueCombos' ? '남은 밸류' : focus === 'bluffCombos' ? '남은 블러프' : '액션 가정으로 제외한';
  return {
    template: { id, category: 'hand-reading', title: `${label} 콤보 읽기`, difficulty: 3,
      hints: ['먼저 내 카드와 보드를 포함한 조합을 빼고, 문제에 명시된 밸류/블러프 부분집합만 남겨요. 실제 상대 홀카드를 맞히는 문제는 아니에요.'], source: { kind: 'generated', params: {} } },
    build: ({ rng, bigBlind }) => {
      const example = pickOne(rng, EXAMPLES);
      const { hero, board } = permuteKnownCards(rng, example.hero, example.board);
      const result = readRangeFacts({ ...example, hero, board });
      const checkRaise = example.board === 'Td Tc 6s 4h 2d';
      const actionName = checkRaise ? '체크레이즈' : '벳';
      const line = checkRaise
        ? `상대 체크 후 내가 팟 ${10 * bigBlind}에 ${5 * bigBlind}를 벳했고 상대가 ${15 * bigBlind}까지 체크레이즈했어요.`
        : `상대가 벳 전 팟 ${10 * bigBlind}에 ${5 * bigBlind}를 벳했어요.`;
      const assumption = `연습 가정: 이 액션 전 레인지는 ${example.range}. 상대는 밸류 ${example.valueRange}와 블러프 ${example.bluffRange}로만 ${actionName}하고 나머지는 ${checkRaise ? '폴드' : '체크'}해요. 각 가능한 콤보의 빈도는 같다고 가정해요.`;
      return {
        situation: { hero, board, bigBlind, potChips: (checkRaise ? 30 : 15) * bigBlind, toCallChips: (checkRaise ? 10 : 5) * bigBlind, heroStackChips: 100 * bigBlind, heroPosition: 'BTN', street: 'river',
          villains: [{ seatIndex: 1, characterId: 'luna', position: 'BB', stackChips: 100 * bigBlind, range: example.range, rangeTag: '연습 가정' }],
          note: `헤즈업 리버예요. ${line} ${assumption}` },
        question: `${assumption} 알려진 카드를 제거한 뒤, 이 ${actionName} 액션을 보고 ${label} 조합은 몇 콤보일까요?`,
        answerSpec: { kind: 'numeric', correct: result[focus], tolerance: 0, unit: 'combos', min: 0, max: 1326 },
        facts: { actionName, otherAction: checkRaise ? '폴드' : '체크', range: example.range, valueRange: example.valueRange, bluffRange: example.bluffRange, hero: formatBoard(hero), board: formatBoard(board),
          total: result.total, removed: result.removed, remaining: result.remaining, valueCombos: result.valueCombos, bluffCombos: result.bluffCombos, actionRemaining: result.actionRemaining, actionRemoved: result.actionRemoved, answer: result[focus], focus: label },
      };
    },
  };
}
export const HAND_READING_TEMPLATES: readonly GeneratedDrillDefinition[] = [definition('read-value-combos', 'valueCombos'), definition('read-bluff-combos', 'bluffCombos'), definition('read-removed-combos', 'actionRemoved')];
