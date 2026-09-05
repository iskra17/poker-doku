import { expect, it } from 'vitest';
import { cards } from '../lib/poker/test-helpers';
import { buildReadingQuestion } from '../lib/story/reading-policy';
import { StoryReadingQuiz } from './story-reading-quiz';
const draft=buildReadingQuestion({hero:cards('Ah Ad'),board:cards('As Kd 7c 4h 2s'),potChips:300,toCallChips:100,heroStackChips:1900,opponents:1,hasAllIn:false,hasSidePot:false,range:'QQ+, AK, KQ, QJ',opponentName:'구미'})!;
it('keeps a snapshot key and deadline, locks duplicate answers and retains answered scores after invalidation',()=>{
 let id=0;const q=new StoryReadingQuiz(()=>`opaque-${++id}`);
 expect(q.issue('room:1:4',draft,1,100)).toBe(true);
 const view=q.pending(200)!;expect(view.expiresAt).toBe(30100);expect(view.remainingMs).toBe(29900);
 expect(q.issue('room:1:4',draft,1,1000)).toBe(false);
 expect(q.answer(view.quizId,0,1000)).toEqual({quizId:view.quizId,accepted:true});
 expect(q.answer(view.quizId,1,2000)).toEqual({quizId:view.quizId,accepted:true});
 expect(q.counts()).toMatchObject({answered:1,correct:1});q.invalidate();expect(q.counts().correct).toBe(1);
 expect(q.issue('room:2:8',draft,1,4000)).toBe(true);q.invalidate();expect(q.counts()).toMatchObject({answered:1,correct:1,invalidated:1});
 expect(q.issue('room:3:1',draft,1,8000)).toBe(false);
});
it('does not leak the answer and counts an unanswered deadline once',()=>{
 const q=new StoryReadingQuiz(()=> 'opaque');q.issue('room:1:1',draft,1,0);
 expect(JSON.stringify(q.pending(1))).not.toMatch(/correct|equity|explanation|wins|ties/);
 q.answer('opaque',0,30000);expect(q.counts()).toMatchObject({answered:1,correct:0});
 expect(q.view()?.feedback?.selected).toBeNull();q.answer('opaque',0,40000);expect(q.counts().answered).toBe(1);
});
