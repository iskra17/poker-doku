import { describe, expect, it } from 'vitest';
import { cards } from '@/lib/poker/test-helpers';
import { toPublicAnswerSpec, toPublicDrillInstance } from './public';
import type { DrillAnswerSpec, DrillInstance } from './types';

function makeInstance(answerSpec: DrillAnswerSpec): DrillInstance {
  return {
    templateId: 'odds-basic',
    seed: 42,
    category: 'pot-odds',
    situation: {
      hero: cards('Ah Kh'),
      board: cards('Qh 7h 2c'),
      potChips: 150,
      toCallChips: 50,
      bigBlind: 20,
      heroStackChips: 2000,
      heroPosition: 'BTN',
      street: 'flop',
      villains: [{ seatIndex: 2, characterId: 'draco', position: 'BB', stackChips: 1800, holeCards: cards('As Ad') }],
    },
    question: '콜 필요 승률은?',
    answerSpec,
    hint: '콜 ÷ (팟 + 콜)',
    explanation: { text: '정확해요. 50 ÷ 200 = 25%.', speaker: 'hana', facts: { requiredEquity: 25 } },
  };
}

const SPECS: DrillAnswerSpec[] = [
  { kind: 'multiple-choice', options: ['20%', '25%', '33%'], correctIndex: 1 },
  { kind: 'numeric', correct: 25, tolerance: 2, unit: '%', min: 0, max: 100 },
  { kind: 'card-pick', candidates: cards('Jh Th 9h'), correct: cards('Jh Th'), pickCount: 2 },
  { kind: 'action-pick', options: ['fold', 'call', 'raise'], correct: ['call'], sizingBB: { min: 2, max: 3 } },
  { kind: 'multi-select', options: ['세트', '투페어', '에어'], correctIndices: [0, 1] },
];

describe('toPublicDrillInstance', () => {
  it('never serializes correct answers, explanation or hint text', () => {
    for (const spec of SPECS) {
      const json = JSON.stringify(toPublicDrillInstance(makeInstance(spec)));
      expect(json).not.toMatch(/correct/i);
      expect(json).not.toContain('explanation');
      expect(json).not.toContain('정확해요');
      expect(json).not.toContain('콜 ÷');
      expect(json).not.toContain('"hint"');
    }
  });

  it('keeps the public fields intact', () => {
    const instance = makeInstance(SPECS[1]);
    const view = toPublicDrillInstance(instance);
    expect(view).toEqual({
      templateId: 'odds-basic',
      seed: 42,
      category: 'pot-odds',
      situation: instance.situation,
      question: '콜 필요 승률은?',
      answerSpec: { kind: 'numeric', unit: '%', min: 0, max: 100 },
      hasHint: true,
    });
    expect(toPublicDrillInstance({ ...instance, hint: null }).hasHint).toBe(false);
    expect(toPublicDrillInstance({ ...instance, hint: '' }).hasHint).toBe(false);
  });

  it('copies cards instead of sharing references', () => {
    const instance = makeInstance(SPECS[2]);
    const view = toPublicDrillInstance(instance);
    expect(view.situation.hero).not.toBe(instance.situation.hero);
    expect(view.situation.villains[0].holeCards).not.toBe(instance.situation.villains[0].holeCards);
    const spec = toPublicAnswerSpec(SPECS[2]);
    expect(spec.kind === 'card-pick' && spec.candidates).not.toBe((SPECS[2] as { candidates: unknown }).candidates);
  });

  it('projects each answer kind to its public shape', () => {
    expect(toPublicAnswerSpec(SPECS[0])).toEqual({ kind: 'multiple-choice', options: ['20%', '25%', '33%'] });
    expect(toPublicAnswerSpec(SPECS[3])).toEqual({ kind: 'action-pick', options: ['fold', 'call', 'raise'], sizingBB: { min: 2, max: 3 } });
    expect(toPublicAnswerSpec({ kind: 'action-pick', options: ['fold'], correct: ['fold'] })).toEqual({ kind: 'action-pick', options: ['fold'] });
    expect(toPublicAnswerSpec(SPECS[4])).toEqual({ kind: 'multi-select', options: ['세트', '투페어', '에어'] });
  });
});
