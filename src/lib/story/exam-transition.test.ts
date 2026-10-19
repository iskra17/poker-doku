import { describe, expect, it } from 'vitest';
import { getChapter } from './chapters';
import { canSwitchToExam, type ExamTransitionInput } from './exam-transition';
import type { Step } from './types';

const chapter = getChapter('act1-ch01')!;
const scene = chapter.steps.find(step => step.kind === 'scene')!;
const drill = chapter.steps.find(step => step.kind === 'drill-set')!;
const practice = getChapter('act1-ch02')!.steps.find(step => step.kind === 'practice-table')!;
const sparring = getChapter('act1-ch02')!.steps.find(step => step.kind === 'sparring')!;
const input = (steps: Step[], overrides: Partial<ExamTransitionInput> = {}): ExamTransitionInput => ({
  chapterId: chapter.id, mode: 'fast', phase: 'scene', stepKind: 'scene', stepIndex: steps.indexOf(scene),
  steps, completed: false, ...overrides,
});

describe('fast exam transition', () => {
  it('빠른 진행에서도 미래 드릴이 있는 씬에서 실력 확인으로 전환한다', () => {
    expect(canSwitchToExam(input([scene, drill]))).toEqual({ allowed: true });
    expect(canSwitchToExam(input([scene, drill], { mode: 'exam' }))).toEqual({ allowed: false, reason: 'not-full' });
    expect(canSwitchToExam(input([scene, drill], { completed: true }))).toEqual({ allowed: false, reason: 'completed' });
    expect(canSwitchToExam(input([scene, drill], { examDisabled: true }))).toEqual({ allowed: false, reason: 'exam-disabled' });
  });

  it('건너뛴 연습 테이블은 허용하되 실제 라이브 방문·스파링 뒤에는 막는다', () => {
    expect(practice?.kind).toBe('practice-table');
    expect(canSwitchToExam(input([practice, scene, drill]))).toEqual({ allowed: true });
    expect(canSwitchToExam(input([practice, scene, drill], { mode: 'full' }))).toEqual({ allowed: false, reason: 'after-live' });
    expect(canSwitchToExam(input([practice, scene, drill], { liveStepVisited: true }))).toEqual({ allowed: false, reason: 'after-live' });
    expect(canSwitchToExam(input([sparring, scene, drill]))).toEqual({ allowed: false, reason: 'after-live' });
  });
});
