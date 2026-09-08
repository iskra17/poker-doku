import type { StoryRunPhase, StoryRunMode } from './views';
import type { Step, StepKind } from './types';

/** Reasons the in-progress full course cannot be changed into a skill check. */
export type ExamTransitionRejection =
  | 'daily'
  | 'not-full'
  | 'completed'
  | 'exam-disabled'
  | 'wrong-phase'
  | 'after-live'
  | 'no-future-drill';

export interface ExamTransitionInput {
  chapterId: string;
  mode: StoryRunMode;
  phase: StoryRunPhase;
  stepKind: StepKind;
  stepIndex: number;
  steps: readonly Step[];
  completed: boolean;
  examDisabled?: boolean;
  /** The server also tracks whether a live adapter has already run a step. */
  liveStepVisited?: boolean;
}

export type ExamTransitionResult =
  | { allowed: true }
  | { allowed: false; reason: ExamTransitionRejection };

function isLiveStep(step: Step): boolean {
  return step.kind === 'practice-table' || step.kind === 'sparring';
}

/**
 * Shared client/server gate for changing the current full chapter run into an exam.
 * The current scene/lesson is retained only as a position marker; enterStep applies
 * the regular exam skip rules to reach the next available drill.
 */
export function canSwitchToExam(input: ExamTransitionInput): ExamTransitionResult {
  if (input.chapterId === 'daily') return { allowed: false, reason: 'daily' };
  if (input.mode !== 'full') return { allowed: false, reason: 'not-full' };
  if (input.completed) return { allowed: false, reason: 'completed' };
  if (input.examDisabled) return { allowed: false, reason: 'exam-disabled' };
  if (input.phase !== 'scene' && input.phase !== 'lesson') return { allowed: false, reason: 'wrong-phase' };

  const current = input.steps[input.stepIndex];
  if (!current || current.kind !== input.stepKind || (current.kind !== 'scene' && current.kind !== 'lesson')) {
    return { allowed: false, reason: 'wrong-phase' };
  }
  if (input.liveStepVisited || input.steps.slice(0, input.stepIndex).some(isLiveStep)) {
    return { allowed: false, reason: 'after-live' };
  }
  if (!input.steps.slice(input.stepIndex + 1).some(step => step.kind === 'drill-set' && step.drills.length > 0)) {
    return { allowed: false, reason: 'no-future-drill' };
  }
  return { allowed: true };
}
