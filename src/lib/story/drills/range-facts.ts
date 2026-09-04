import { formatCard } from '@/lib/poker/card-notation';
import { parseRange, rangeCombos } from '@/lib/poker/range';
import type { Card } from '@/lib/poker/types';
/** 공개 보드와 히어로 카드만 제거한다. 상대의 숨은 홀카드는 입력받지 않는다. */
export function countRangeFacts(range: string, hero: readonly Card[], board: readonly Card[]) {
  const known = [...hero, ...board];
  if (new Set(known.map(formatCard)).size !== known.length)
    throw new Error('known cards must be distinct');
  const keys = parseRange(range);
  const total = rangeCombos(keys).length;
  const combos = rangeCombos(keys, known);
  return { total, remaining: combos.length, removed: total - combos.length, combos };
}
export interface ReadingRangeInput {
  range: string;
  valueRange: string;
  bluffRange: string;
  hero: readonly Card[];
  board: readonly Card[];
}
/** 명시된 액션 가정의 부분집합만 남긴다. 가정을 실제 상대의 확정 레인지로 취급하지 않는다. */
export function readRangeFacts(input: ReadingRangeInput) {
  const range = parseRange(input.range);
  const value = parseRange(input.valueRange);
  const bluff = parseRange(input.bluffRange);
  for (const key of [...value, ...bluff])
    if (!range.has(key))
      throw new Error('assumed action range must be within the starting range');
  for (const key of value)
    if (bluff.has(key))
      throw new Error('value and bluff assumptions must not overlap');
  const initial = countRangeFacts(input.range, input.hero, input.board);
  const known = [...input.hero, ...input.board];
  const valueCombos = rangeCombos(value, known).length;
  const bluffCombos = rangeCombos(bluff, known).length;
  const actionRemaining = valueCombos + bluffCombos;
  return { ...initial, valueCombos, bluffCombos, actionRemaining, actionRemoved: initial.remaining - actionRemaining };
}
