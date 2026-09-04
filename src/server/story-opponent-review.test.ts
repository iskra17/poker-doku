import { expect, it } from 'vitest';
import { cards } from '../lib/poker/test-helpers';
import type { CompletedHandRecord, HandHistoryPlayer } from '../lib/poker/hand-history';
import { reviewOpponentResponses } from './story-opponent-review';
function fixture(): CompletedHandRecord {
 const player = (id:string,seatIndex:number,hole:string):HandHistoryPlayer => ({id,name:id,type:seatIndex===0?'human':'bot',seatIndex,position:'BTN',startingChips:2000,holeCards:cards(hole),totalContributed:150,won:0,profit:-150,revealed:true,finalStatus:'active',handRank:null,handDescription:null});
 return {handNumber:1,smallBlind:10,bigBlind:20,players:[player('hero',0,'Kh Qs'),player('bot',1,'Ah Jd')],board:cards('Kc 9d 7s 4h 2c'),actions:[
 {street:'preflop',playerId:'hero',kind:'raise',amount:100},{street:'preflop',playerId:'bot',kind:'call',amount:100},
 {street:'river',playerId:'bot',kind:'raise',amount:100},{street:'river',playerId:'hero',kind:'call',amount:100},
 ],winners:[],potTotal:400,rake:0,showdown:true};
}
const identities = [{seatIndex:1,personalityId:'gumi'}];
it('uses only hero cards, public action prefix and known type, never opponent cards or outcome',()=>{
 const record=fixture(); const expected=reviewOpponentResponses(record,'hero',identities);
 expect(expected).toHaveLength(1); expect(expected[0].mark).toBe('good');
 record.players[1].holeCards=cards('Ks Kd');record.players[1].won=400;record.players[0].profit=-200;record.winners=[{playerId:'bot',amount:400,handRank:'three-of-a-kind',handDescription:'set',potIndex:0}];
 expect(reviewOpponentResponses(record,'hero',identities)).toEqual(expected);
 record.actions.push({street:'river',playerId:'bot',kind:'all-in',amount:2000});
 expect(reviewOpponentResponses(record,'hero',identities)).toEqual(expected);
});
it('excludes prior all-in/side-pot prices and ignores board-only strength',()=>{
 const record=fixture();record.actions[2].kind='all-in';
 expect(reviewOpponentResponses(record,'hero',identities)).toEqual([]);
 const boardOnly=fixture();boardOnly.board=cards('Kc Kd 8s 8h 2c');boardOnly.players[0].holeCards=cards('Ah Qs');
 expect(reviewOpponentResponses(boardOnly,'hero',identities)).toEqual([]);
});
