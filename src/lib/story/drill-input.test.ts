import { describe, expect, it } from 'vitest';
import { cards } from '@/lib/poker/test-helpers';
import {
  actionLabel,
  clampNumeric,
  describeCorrectAnswer,
  gradeLocally,
  isAnswerComplete,
  toggleCard,
  toggleIndex,
} from './drill-input';
import type { DrillAnswerSpec } from './drills/types';

describe('drill-input helpers', () => {
  it('isAnswerComplete per kind', () => {
    expect(isAnswerComplete({ kind: 'multiple-choice', options: ['a', 'b'] }, { kind: 'multiple-choice', index: 1 })).toBe(true);
    expect(isAnswerComplete({ kind: 'multiple-choice', options: ['a', 'b'] }, { kind: 'multiple-choice', index: 2 })).toBe(false);
    expect(isAnswerComplete({ kind: 'numeric', unit: '%', min: 0, max: 100 }, { kind: 'numeric', value: Number.NaN })).toBe(false);
    expect(isAnswerComplete({ kind: 'card-pick', candidates: cards('Ah Kh Qh'), pickCount: 2 }, { kind: 'card-pick', cards: cards('Ah') })).toBe(false);
    expect(isAnswerComplete({ kind: 'card-pick', candidates: cards('Ah Kh Qh'), pickCount: 2 }, { kind: 'card-pick', cards: cards('Ah Kh') })).toBe(true);
    expect(isAnswerComplete({ kind: 'multi-select', options: ['a'] }, { kind: 'multi-select', indices: [] })).toBe(false);
    expect(isAnswerComplete({ kind: 'numeric', unit: '%', min: 0, max: 100 }, null)).toBe(false);
    expect(isAnswerComplete({ kind: 'numeric', unit: '%', min: 0, max: 100 }, { kind: 'multiple-choice', index: 0 })).toBe(false);
  });

  it('clampNumeric, toggleCard (pickCount overflow evicts oldest), toggleIndex', () => {
    expect(clampNumeric(150, { min: 0, max: 100 })).toBe(100);
    expect(clampNumeric(Number.NaN, { min: 0, max: 100 })).toBe(0);
    const [ah, kh, qh] = cards('Ah Kh Qh');
    expect(toggleCard([ah], ah, 2)).toEqual([]);
    expect(toggleCard([ah], kh, 2)).toEqual([ah, kh]);
    expect(toggleCard([ah, kh], qh, 2)).toEqual([kh, qh]);
    expect(toggleIndex([2, 0], 1)).toEqual([0, 1, 2]);
    expect(toggleIndex([0, 1], 1)).toEqual([0]);
  });

  it('gradeLocally mirrors the server rules', () => {
    const numeric: DrillAnswerSpec = { kind: 'numeric', correct: 25, tolerance: 2, unit: '%', min: 0, max: 100 };
    expect(gradeLocally(numeric, { kind: 'numeric', value: 27 })).toBe(true);
    expect(gradeLocally(numeric, { kind: 'numeric', value: 27.5 })).toBe(false);
    expect(gradeLocally(numeric, { kind: 'multiple-choice', index: 0 })).toBe(false);
    const pick: DrillAnswerSpec = { kind: 'card-pick', candidates: cards('Ah Kh Qh'), correct: cards('Ah Kh'), pickCount: 2 };
    expect(gradeLocally(pick, { kind: 'card-pick', cards: cards('Kh Ah') })).toBe(true);
    expect(gradeLocally(pick, { kind: 'card-pick', cards: cards('Kh Qh') })).toBe(false);
    const action: DrillAnswerSpec = { kind: 'action-pick', options: ['fold', 'raise'], correct: ['raise'], sizingBB: { min: 2, max: 3 } };
    expect(gradeLocally(action, { kind: 'action-pick', action: 'raise', sizingBB: 2.5 })).toBe(true);
    expect(gradeLocally(action, { kind: 'action-pick', action: 'raise', sizingBB: 5 })).toBe(false);
    expect(gradeLocally(action, { kind: 'action-pick', action: 'raise' })).toBe(false);
    expect(gradeLocally({ ...action, correct: ['fold'] }, { kind: 'action-pick', action: 'fold' })).toBe(true);
    const multi: DrillAnswerSpec = { kind: 'multi-select', options: ['a', 'b', 'c'], correctIndices: [0, 2] };
    expect(gradeLocally(multi, { kind: 'multi-select', indices: [2, 0] })).toBe(true);
    expect(gradeLocally(multi, { kind: 'multi-select', indices: [0] })).toBe(false);
  });

  it('describeCorrectAnswer and actionLabel', () => {
    expect(describeCorrectAnswer({ kind: 'numeric', correct: 6, tolerance: 0, unit: 'combos', min: 0, max: 1326 })).toBe('6콤보');
    expect(describeCorrectAnswer({ kind: 'numeric', correct: 25, tolerance: 2, unit: '%', min: 0, max: 100 })).toBe('25% (±2)');
    expect(describeCorrectAnswer({ kind: 'numeric', correct: 9, tolerance: 0, unit: 'outs', min: 0, max: 21 })).toBe('9아우츠');
    expect(describeCorrectAnswer({ kind: 'multiple-choice', options: ['콜', '폴드'], correctIndex: 1 })).toBe('폴드');
    expect(describeCorrectAnswer({ kind: 'card-pick', candidates: [], correct: cards('Ah Kh'), pickCount: 2 })).toBe('Ah Kh');
    expect(describeCorrectAnswer({ kind: 'action-pick', options: ['fold', 'raise'], correct: ['raise'], sizingBB: { min: 2, max: 3 } })).toBe('레이즈 (2~3BB)');
    expect(describeCorrectAnswer({ kind: 'multi-select', options: ['세트', '투페어', '에어'], correctIndices: [0, 1] })).toBe('세트, 투페어');
    expect(actionLabel('all-in')).toBe('올인');
  });
});
