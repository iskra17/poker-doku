import { expect, it } from 'vitest';
import { cards } from '../lib/poker/test-helpers';
import type { CompletedHandRecord, HandHistoryPlayer } from '../lib/poker/hand-history';
import { reviewReadingResponses } from './story-reading-review';
function fixture(): CompletedHandRecord {
 const player=(id:string,seatIndex:number,hole:string):HandHistoryPlayer=>({id,name:id,type:seatIndex===0?'human':'bot',seatIndex,position:'BTN',startingChips:2000,holeCards:cards(hole),totalContributed:150,won:0,profit:-150,revealed:true,finalStatus:'active',handRank:null,handDescription:null});
 return {handNumber:1,smallBlind:10,bigBlind:20,players:[player('hero',0,'Kh Qs'),player('bot',1,'Ah Jd')],board:cards('Kc 9d 7s 4h 2c'),actions:[
 {street:'preflop',playerId:'hero',kind:'raise',amount:100},{street:'preflop',playerId:'bot',kind:'call',amount:100},
 {street:'river',playerId:'bot',kind:'raise',amount:100},{street:'river',playerId:'hero',kind:'call',amount:100},
 ],winners:[],potTotal:400,rake:0,showdown:true};
}
it('구미 콜 기회를 공개 가격과 히어로 강도로만 평가한다',()=>{
 const record=fixture(); const ids=[{seatIndex:1,personalityId:'gumi'}];
 const expected=reviewReadingResponses(record,'hero',ids);
 expect(expected).toMatchObject([{kind:'gumi-river-call',verdict:{mark:'good'}}]);
 record.players[1].holeCards=cards('Ks Kd');record.winners=[{playerId:'bot',amount:400,handRank:null,handDescription:null,potIndex:0}];
 expect(reviewReadingResponses(record,'hero',ids)).toEqual(expected);
 record.board=cards('Kc Kd 8s 8h 2c');record.players[0].holeCards=cards('Ah Qs');
 expect(reviewReadingResponses(record,'hero',ids)).toEqual([]);
});
it('같은 스트리트의 루나 체크→히어로 벳→루나 레이즈만 약한 원페어 폴드 기회다',()=>{
 const record=fixture();record.players[0].holeCards=cards('9h 8s');
 record.actions.splice(2,2,{street:'river',playerId:'bot',kind:'check',amount:0},{street:'river',playerId:'hero',kind:'raise',amount:100},{street:'river',playerId:'bot',kind:'raise',amount:400},{street:'river',playerId:'hero',kind:'fold',amount:0});
 const ids=[{seatIndex:1,personalityId:'luna'}];
 expect(reviewReadingResponses(record,'hero',ids)).toMatchObject([{kind:'luna-checkraise-fold',verdict:{mark:'good'}}]);
 record.actions[2].street='turn';expect(reviewReadingResponses(record,'hero',ids)).toEqual([]);
 record.actions[2].street='river';record.players[0].holeCards=cards('Kh Ks');
 expect(reviewReadingResponses(record,'hero',ids)).toEqual([]);
});
