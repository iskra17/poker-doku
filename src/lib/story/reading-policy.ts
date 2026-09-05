import { evaluateHand } from '@/lib/poker/evaluator';
import { formatCard } from '@/lib/poker/card-notation';
import { parseRange, rangeCombos } from '@/lib/poker/range';
import type { Card } from '@/lib/poker/types';
export interface ReadingQuestionInput {
 hero:readonly Card[];board:readonly Card[];potChips:number;toCallChips:number;heroStackChips:number;
 opponents:number;hasAllIn:boolean;hasSidePot:boolean;range:string;opponentName:string;
}
/** 현재 공개된 가정 레인지의 리버 전수 비교. 숨은 홀카드·미래 액션·실제 승패 입력 없음. */
export function buildReadingQuestion(input:ReadingQuestionInput) {
 const {hero,board,potChips,toCallChips}=input;
 if(hero.length!==2||board.length!==5||input.opponents!==1||input.hasAllIn||input.hasSidePot
   ||!Number.isFinite(input.heroStackChips)||!Number.isFinite(potChips)||!Number.isFinite(toCallChips)||potChips<=0||toCallChips<=0||input.heroStackChips<=toCallChips)return null;
 const known=[...hero,...board];if(new Set(known.map(formatCard)).size!==7)return null;
 const combos=rangeCombos(parseRange(input.range),known);if(combos.length<10)return null;
 const value=evaluateHand([...hero],[...board]).value;
 let wins=0,ties=0;
 for(const hole of combos){const other=evaluateHand(hole,[...board]).value;if(value>other)wins++;else if(value===other)ties++;}
 const equity=(wins+ties/2)/combos.length;
 const requiredEquity=toCallChips/(potChips+toCallChips);
 if(Math.abs(equity-requiredEquity)<=0.05)return null;
 const correctIndex=equity>requiredEquity?0:1;
 const assumption=`연습 가정: ${input.opponentName}의 이 리버 벳 레인지는 ${input.range}이며 남은 각 콤보의 빈도는 같아요. 실제 홀카드를 안다는 뜻은 아니에요.`;
 return {equity,requiredEquity,correctIndex,combos:combos.length,wins,ties,
  prompt:`${assumption} 현재 팟 ${potChips}(상대 벳 포함), 콜 ${toCallChips}예요. 이 가정대로라면 콜과 폴드 중 어느 쪽일까요?`,
  options:['콜 쪽이 유리해요','폴드 쪽이 유리해요'],
  explanation:`알려진 카드를 빼면 ${combos.length}콤보예요. 이기는 ${wins}콤보와 동점 ${ties}콤보를 반영한 에퀴티는 ${(equity*100).toFixed(1)}%, 콜 필요 승률은 ${toCallChips} ÷ (${potChips} + ${toCallChips}) = ${(requiredEquity*100).toFixed(1)}%예요. 이 가정에서는 ${correctIndex===0?'콜':'폴드'} 쪽이에요. 상대 레인지 가정이 달라지면 판단도 바뀌어요.`,
  situation:{hero:hero.map(c=>({...c})),board:board.map(c=>({...c})),range:input.range,potChips,toCallChips,assumption},
 };
}
/** 공개된 성향과 벳 크기만으로 선택하는 교육용 가정표. 실제 봇 내부 레인지를 주장하지 않는다. */
export function readingRangeFor(personalityId:string,betToPot:number):string {
 if(personalityId==='gumi'&&betToPot<=0.75)return '22+, A2s+, K9s+, Q9s+, J9s+, T9s, 98s, AQo+, KQo';
 if(personalityId==='choco'||betToPot>0.75)return 'QQ+, AQs+, AKo, KQs';
 return '88+, ATs+, KJs+, QJs, AJo+, KQo';
}
