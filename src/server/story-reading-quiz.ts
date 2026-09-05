import { randomUUID } from 'node:crypto';
import type { buildReadingQuestion } from '../lib/story/reading-policy';
import type { HandReadQuizView, ReadingQuizView, StoryQuizReceipt } from '../lib/story/views';
type Draft=NonNullable<ReturnType<typeof buildReadingQuestion>>;
interface Entry {key:string;draft:Draft;question:HandReadQuizView;status:'pending'|'answered'|'invalidated';selected:number|null}
export class StoryReadingQuiz {
 private entries:Entry[]=[];
 private current:Entry|null=null;
 private seen=new Set<string>();
 constructor(private id:()=>string=randomUUID){}
 get held(){return this.current!==null;}
 get key(){return this.current?.key??null;}
 issue(key:string,draft:Draft,seatIndex:number,now:number):boolean {
  if(this.current||this.entries.length>=2||this.seen.has(key))return false;
  this.seen.add(key);
  const entry:Entry={key,draft,status:'pending',selected:null,question:{quizId:this.id(),seatIndex,number:this.entries.length+1,required:2,prompt:draft.prompt,options:[...draft.options],expiresAt:now+30000,sampledAt:now,remainingMs:30000,situation:structuredClone(draft.situation)}};
  this.entries.push(entry);this.current=entry;return true;
 }
 wasSeen(key:string){return this.seen.has(key);}
 pending(now:number):HandReadQuizView|null {
  const entry=this.current;if(!entry||entry.status!=='pending')return null;
  return {...entry.question,sampledAt:now,remainingMs:Math.max(0,entry.question.expiresAt-now)};
 }
 answer(quizId:string,option:number|null,now:number):StoryQuizReceipt|null {
  const entry=this.entries.find(e=>e.question.quizId===quizId);
  if(!entry||entry.status==='invalidated'||(option!==null&&(!Number.isInteger(option)||option<0||option>=2)))return null;
  if(entry.status==='pending'){entry.selected=now>=entry.question.expiresAt?null:option;entry.status='answered';}
  return {quizId,accepted:true};
 }
 invalidate(){if(this.current?.status==='pending')this.current.status='invalidated';this.current=null;}
 release(){this.current=null;}
 counts(){const answered=this.entries.filter(e=>e.status==='answered');return {issued:this.entries.length,answered:answered.length,correct:answered.filter(e=>e.selected===e.draft.correctIndex).length,invalidated:this.entries.filter(e=>e.status==='invalidated').length};}
 view():ReadingQuizView|undefined {
  const entry=this.current;if(!entry)return undefined;
  const counts=this.counts();return {phase:entry.status==='pending'?'question':'feedback',answered:counts.answered,correct:counts.correct,invalidated:counts.invalidated,
   feedback:entry.status==='answered'?{quizId:entry.question.quizId,selected:entry.selected,correctIndex:entry.draft.correctIndex,explanation:entry.draft.explanation}:null};
 }
}
