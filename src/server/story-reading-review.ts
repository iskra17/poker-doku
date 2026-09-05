import type { CompletedHandRecord } from '../lib/poker/hand-history';
import { applyReplayContribution, createReplayContributionState } from '../lib/poker/hand-history-replay';
import { evaluateHand } from '../lib/poker/evaluator';
import { rankValue } from '../lib/poker/deck';
import type { ActionType, Street } from '../lib/poker/types';
import { opponentResponseStrength } from '../lib/story/opponent-response';
import { buildReadingQuestion, readingRangeFor } from '../lib/story/reading-policy';
import type { DecisionVerdict } from '../lib/story/views';
export type ReadingResponseKind = 'gumi-river-call' | 'honest-river-fold' | 'luna-checkraise-fold';
export interface ReadingResponse { kind: ReadingResponseKind; verdict: DecisionVerdict }
/** Only the hero's cards and the public action prefix influence an assessment. */
export function reviewReadingResponses(record: CompletedHandRecord, heroId: string, identities: readonly {seatIndex:number;personalityId:string}[]): ReadingResponse[] {
 const hero=record.players.find(p=>p.id===heroId);
 if(!hero?.holeCards) return [];
 let contribution=createReplayContributionState(); let street:Street='preflop'; let hasAllIn=false;
 const living=new Set(record.players.map(p=>p.id)); const checked=new Set<string>(); const checkRaised=new Set<string>();
 let heroContributed=0; let heroBetAfterCheck=false; const result:ReadingResponse[]=[];
 for(const action of record.actions){
  if(action.street!==street){street=action.street;contribution={...contribution,streetBets:new Map()};checked.clear();checkRaised.clear();heroBetAfterCheck=false;}
  const ownBet=contribution.streetBets.get(heroId)??0;
  const maxBet=Math.max(0,...contribution.streetBets.values());
  const opponents=record.players.filter(p=>p.id!==heroId&&living.has(p.id));
  if(action.playerId===heroId && ['flop','turn','river'].includes(street) && opponents.length===1 && !hasAllIn && maxBet>ownBet && ['fold','call','raise','all-in'].includes(action.kind)){
   const opponent=opponents[0]; const personality=identities.find(i=>i.seatIndex===opponent.seatIndex)?.personalityId;
   const board=record.board.slice(0,street==='flop'?3:street==='turn'?4:5); const call=maxBet-ownBet;
   const stack=hero.startingChips-heroContributed;
   const decision=action.kind as ActionType;
   const strength=street==='river'?opponentResponseStrength(hero.holeCards,board):null;
   const rank=evaluateHand(hero.holeCards,board).rank;
   let kind:ReadingResponseKind|null=null;let correct=false;let reason='';
   const betToPot=contribution.pot>maxBet?maxBet/(contribution.pot-maxBet):Infinity;
   if(stack>call && personality==='gumi' && street==='river' && ownBet===0 && strength?.topPairOrBetter && betToPot>=0.33 && betToPot<=0.75){
    if(!(strength.strongMade && ['raise','all-in'].includes(decision))){kind='gumi-river-call';correct=decision==='call';reason='구미의 ⅓~¾팟 리버 벳에 톱페어+로 콜할 기회예요. 강한 메이드의 밸류 레이즈는 별도 판단해요.';}
   }
   if(stack>call && personality==='choco' && street==='river' && rank==='one-pair'){
    const price=buildReadingQuestion({hero:hero.holeCards,board,potChips:contribution.pot,toCallChips:call,heroStackChips:stack,opponents:1,hasAllIn:false,hasSidePot:false,range:readingRangeFor('choco',betToPot),opponentName:'초코'});
    if(price?.correctIndex===1){kind='honest-river-fold';correct=decision==='fold';reason=price.explanation;}
   }
   if(stack>call && personality==='luna' && checkRaised.has(opponent.id) && rank==='one-pair'){
    const top=Math.max(...board.map(c=>rankValue(c.rank)));
    const topPair=hero.holeCards[0].rank===hero.holeCards[1].rank?rankValue(hero.holeCards[0].rank)>top:hero.holeCards.some(c=>rankValue(c.rank)===top);
    if(!topPair){kind='luna-checkraise-fold';correct=decision==='fold';reason='같은 스트리트에서 루나가 체크한 뒤 내 벳에 레이즈했어요. 톱페어 미만 원페어는 폴드할 기회이며, 강한 메이드는 이 규칙으로 평가하지 않아요.';}
   }
   if(kind) result.push({kind,verdict:{street,action:decision,amount:action.amount,mark:correct?'good':'warn',reason,facts:{}}});
  }
  if(action.kind==='check'&&action.playerId!==heroId) checked.add(action.playerId);
  if(action.playerId===heroId&&action.kind==='raise'&&maxBet===0&&checked.size>0) heroBetAfterCheck=true;
  if(action.playerId!==heroId&&action.kind==='raise'&&checked.has(action.playerId)&&heroBetAfterCheck&&action.amount>ownBet) checkRaised.add(action.playerId);
  if(action.kind==='all-in')hasAllIn=true;
  if(action.kind==='fold')living.delete(action.playerId);
  const next=applyReplayContribution(contribution,action);
  if(action.playerId===heroId)heroContributed+=next.pot-contribution.pot;
  contribution=next;
 }
 return result;
}
