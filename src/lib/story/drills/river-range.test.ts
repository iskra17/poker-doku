import { expect, it } from 'vitest';
import { generateDrill } from './generator';
import { toPublicDrillInstance } from './public';
import { buildReadingQuestion } from '../reading-policy';
it('리버 드릴은 라이브와 같은 공개 레인지 전수 계산을 쓰고 seed에 결정론적이다',()=>{
 for(let seed=0;seed<60;seed++){
  const instance=generateDrill('call-river-range',seed,{teacher:'chloe'});
  expect(generateDrill('call-river-range',seed,{teacher:'chloe'})).toEqual(instance);
  const s=instance.situation;
  const question=buildReadingQuestion({hero:s.hero,board:s.board,potChips:s.potChips,toCallChips:s.toCallChips,heroStackChips:s.heroStackChips,range:s.villains[0].range!,opponentName:'상대',opponents:1,hasAllIn:false,hasSidePot:false})!;
  expect(instance.answerSpec).toMatchObject({correctIndex:question.correctIndex});
  expect(instance.explanation.facts.calculation).toBe(question.explanation);
  expect(JSON.stringify(toPublicDrillInstance(instance))).not.toMatch(/correct|explanation|holeCards/);
 }
});
it('Ch9 액션 문제는 실제 패 추측 대신 명시된 체크레이즈 레인지를 준다',()=>{
 const drill=generateDrill('act-ch09-checkraise-fold',1,{teacher:'elena'});
 expect(drill.situation.note).toContain('가정');
 expect(drill.answerSpec).toMatchObject({correct:['fold']});
});
