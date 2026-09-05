import { expect, it } from 'vitest';
import { STORY_CHAPTERS, validateChapters } from '../index';
import { CH08 } from './ch08-curious-call';
import { CH09 } from './ch09-shadows-and-traps';
import { DRILL_TEMPLATE_IDS, getDrillTemplate } from '../../drills/generator';
import { STORY_CURRICULUM } from '../../curriculum';
import { deriveBelt } from '../../unlocks';
it('Ch8/9는 전체 콘텐츠와 새 드릴을 등록하고 3막 세 챕터 완료에만 갈색띠다',()=>{
 expect(validateChapters(STORY_CHAPTERS,{templateIds:DRILL_TEMPLATE_IDS})).toEqual([]);
 for(const chapter of [CH08,CH09]){
  expect(chapter.requires).toEqual([...STORY_CURRICULUM[2]]);
  expect(chapter.steps.filter(s=>s.kind==='practice-table')).toHaveLength(2);
  expect(chapter.failScene!.lines.length).toBeGreaterThan(0);
  const drill=chapter.steps.find(s=>s.kind==='drill-set')!;if(drill.kind!=='drill-set')throw new Error('drill');
  expect(drill.drills).toHaveLength(chapter===CH08?7:8);
  for(const slot of drill.drills)expect(getDrillTemplate(slot.templateId)).toBeDefined();
 }
 const completed=new Set([...STORY_CURRICULUM[1],...STORY_CURRICULUM[2],...STORY_CURRICULUM[3]]);
 expect(deriveBelt(STORY_CHAPTERS,completed,{},STORY_CURRICULUM)).toBe('brown');
 completed.delete('act3-ch07');expect(deriveBelt(STORY_CHAPTERS,completed,{},STORY_CURRICULUM)).not.toBe('brown');
});
