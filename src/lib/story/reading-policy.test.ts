import { expect, it } from 'vitest';
import { cards } from '@/lib/poker/test-helpers';
import { parseRange, rangeCombos } from '@/lib/poker/range';
import { evaluateHand } from '@/lib/poker/evaluator';
import { buildReadingQuestion } from './reading-policy';
const input={hero:cards('Ah Ad'),board:cards('As Kd 7c 4h 2s'),potChips:300,toCallChips:100,heroStackChips:1900,opponents:1,hasAllIn:false,hasSidePot:false,range:'QQ+, AK, KQ, QJ',opponentName:'구미'};
it('derives a unique answer exclusively from the displayed assumption and public price',()=>{
 const result=buildReadingQuestion(input)!;expect(result).not.toBeNull();
 const hero=evaluateHand(input.hero,input.board).value;
 const values=rangeCombos(parseRange(input.range),[...input.hero,...input.board]).map(hole=>evaluateHand(hole,input.board).value);
 const equity=values.reduce((sum,value)=>sum+(hero>value?1:hero===value?0.5:0),0)/values.length;
 expect(result.equity).toBe(equity);expect(result.requiredEquity).toBe(0.25);
 expect(result.correctIndex).toBe(equity>0.25?0:1);expect(result.prompt).toContain(input.range);
});
it('does not issue ambiguous, short-stack, side-pot, multiway or sparse-range questions',()=>{
 expect(buildReadingQuestion({...input,range:'AA'})).toBeNull();
 expect(buildReadingQuestion({...input,opponents:2})).toBeNull();
 expect(buildReadingQuestion({...input,hasAllIn:true})).toBeNull();
 expect(buildReadingQuestion({...input,hasSidePot:true})).toBeNull();
 expect(buildReadingQuestion({...input,heroStackChips:99})).toBeNull();
 expect(buildReadingQuestion({...input,board:input.board.slice(0,4)})).toBeNull();
});

it('5%p 경계와 비정상 스택은 출제하지 않는다',()=>{
 const base=buildReadingQuestion({...input,hero:cards('Kh Qs'),board:cards('Kc 9d 7s 4h 2c')})!;
 const threshold=base.equity;
 const price=100*threshold/(1-threshold);
 expect(buildReadingQuestion({...input,hero:cards('Kh Qs'),board:cards('Kc 9d 7s 4h 2c'),potChips:100,toCallChips:price})).toBeNull();
 expect(buildReadingQuestion({...input,heroStackChips:NaN})).toBeNull();
});
