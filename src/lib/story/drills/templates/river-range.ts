import { parseCards } from '@/lib/poker/card-notation';
import { pickOne } from '@/lib/poker/seeded-rng';
import { buildReadingQuestion, readingRangeFor } from '../../reading-policy';
import type { GeneratedDrillDefinition } from './kit';
export const RIVER_RANGE_TEMPLATES: readonly GeneratedDrillDefinition[] = [{
 template:{id:'call-river-range',category:'call-decision',title:'리버 · 가정한 레인지에 콜할까?',difficulty:3,hints:['콜 / (현재 팟 + 콜)과 알려진 카드를 뺀 레인지의 승률을 비교해요.'],source:{kind:'generated',params:{}}},
 build:({rng,bigBlind})=>{
  const [hole,runout]=pickOne(rng,[['Kh Qs','Kc 9d 7s 4h 2c'],['Ah Ad','As Kd 7c 4h 2s'],['9h 8s','Kc 9d 7s 4h 2c'],['Qh Jh','Qs Td 7c 4h 2s']] as const);
  const hero=parseCards(hole),board=parseCards(runout);const personality=pickOne(rng,['gumi','choco']);
  const call=pickOne(rng,[2,4,6])*bigBlind;const pot=pickOne(rng,[2,3,4])*call;
  const range=readingRangeFor(personality,call/(pot-call));
  const draft=buildReadingQuestion({hero,board,potChips:pot,toCallChips:call,heroStackChips:100*bigBlind,range,opponentName:personality==='gumi'?'구미':'초코',opponents:1,hasAllIn:false,hasSidePot:false});
  if(!draft)return null;
  return {situation:{hero,board,potChips:pot,toCallChips:call,bigBlind,heroStackChips:100*bigBlind,heroPosition:'BTN',street:'river',villains:[{seatIndex:1,characterId:personality,position:'BB',stackChips:100*bigBlind,range}],note:draft.situation.assumption},question:draft.prompt,answerSpec:{kind:'multiple-choice',options:draft.options,correctIndex:draft.correctIndex},facts:{calculation:draft.explanation,range,combos:draft.combos,equity:draft.equity,requiredEquity:draft.requiredEquity}};
 },
}];
