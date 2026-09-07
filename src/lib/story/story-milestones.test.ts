import { describe, expect, it } from 'vitest';
import { FIRST_DRILL_CLEAR_STEP_ID, isFirstDrillClearMilestone } from './story-milestones';

const base = {
  chapterId: 'act1-ch01',
  mode: 'full' as const,
  phase: 'scene' as const,
  stepKind: 'scene' as const,
};

describe('story milestones', () => {
  it('recognizes only the server-confirmed full-mode first drill scene', () => {
    expect(isFirstDrillClearMilestone(base, FIRST_DRILL_CLEAR_STEP_ID)).toBe(true);
    expect(isFirstDrillClearMilestone({ ...base, mode: 'exam' }, FIRST_DRILL_CLEAR_STEP_ID)).toBe(false);
    expect(isFirstDrillClearMilestone({ ...base, phase: 'drill', stepKind: 'drill-set' }, FIRST_DRILL_CLEAR_STEP_ID)).toBe(false);
    expect(isFirstDrillClearMilestone({ ...base, chapterId: 'act1-ch02' }, FIRST_DRILL_CLEAR_STEP_ID)).toBe(false);
    expect(isFirstDrillClearMilestone(base, 'act1-ch01:prologue')).toBe(false);
    expect(isFirstDrillClearMilestone(null, FIRST_DRILL_CLEAR_STEP_ID)).toBe(false);
  });
});
