import { expect, it } from 'vitest';
import { evaluateObjective } from './objectives';
import type { Objective } from './types';
const tally={hands:[]};
const objective:Objective={id:'call',kind:'gumi-river-call',label:'콜',target:2,finalOpportunityCap:true};
it('최종에만 실제 기회로 횟수를 한정하고 0기회는 미측정이다',()=>{
 const extras={readingResponses:{'gumi-river-call':{opportunities:1,correct:1}}};
 expect(evaluateObjective(objective,tally,true,extras).achieved).toBe(false);
 expect(evaluateObjective(objective,tally,true,{...extras,final:true})).toMatchObject({achieved:true,target:1});
 expect(evaluateObjective(objective,tally,true,{final:true}).achieved).toBeNull();
 expect(evaluateObjective({...objective,finalOpportunityCap:false},tally,true,{...extras,final:true}).achieved).toBe(false);
 expect(evaluateObjective({...objective,kind:'honest-river-fold',target:undefined,maxCount:1},tally,true).achieved).toBeNull();
});
it('리딩은 유효 답만 분모로 쓰고 Ch7의 필수4문 계약은 유지한다',()=>{
 const quiz:Objective={id:'q',kind:'quiz-accuracy',label:'리딩',minRatio:0.5};
 expect(evaluateObjective(quiz,tally,true,{quiz:{issued:2,answered:1,correct:1}}).achieved).toBe(true);
 expect(evaluateObjective(quiz,tally,true,{quiz:{issued:2,answered:0,correct:0}}).achieved).toBeNull();
 expect(evaluateObjective({...quiz,params:{required:4}},tally,true,{quiz:{issued:2,answered:2,correct:2,required:4}}).achieved).toBe(false);
});
