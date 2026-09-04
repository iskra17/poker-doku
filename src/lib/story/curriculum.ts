import type { StoryAct } from './types';
export type StoryCurriculum = Readonly<Record<StoryAct, readonly string[]>>;
export const STORY_CURRICULUM: StoryCurriculum = Object.freeze({
  1: ['act1-ch01', 'act1-ch02', 'act1-ch03'],
  2: ['act2-ch04', 'act2-ch05', 'act2-ch06'],
  3: ['act3-ch07', 'act3-ch08', 'act3-ch09'],
  4: ['act4-ch10', 'act4-ch11', 'act4-ch12'],
});
