import { expect, it, vi } from 'vitest';
import { formatCard, parseCards } from '@/lib/poker/card-notation';
import { evaluateHand } from '@/lib/poker/evaluator';
import { findNuts } from '@/lib/poker/learning';
import { parseRange, rangeCombos } from '@/lib/poker/range';
import { chapterSkillCategories, DRILL_CATEGORY_LABEL } from '../story-hub-rules';
import { makeChapter } from '../test-fixtures';
import { DRILL_TEMPLATE_IDS, generateDrill, gradeDrill } from './generator';
import { toPublicDrillInstance } from './public';
import type { DrillInstance } from './types';
const IDS = ['combo-count', 'combo-blockers', 'combo-paired-board', 'read-value-combos', 'read-bluff-combos', 'read-removed-combos', 'nuts-unique-combo', 'nuts-blocked-combo'];
it('registers playable Ch8/Ch9 combo, reading and exact nuts templates', () => {
  for (const id of IDS) {
    expect(DRILL_TEMPLATE_IDS.has(id), id).toBe(true);
    expect(generateDrill(id, 7, { teacher: 'elena' }).templateId).toBe(id);
  }
});
function verify(instance: DrillInstance) {
  const { hero, board, villains } = instance.situation;
  const known = [...hero, ...board];
  expect(new Set(known.map(formatCard)).size).toBe(known.length);
  expect(villains.every(v => v.holeCards === undefined)).toBe(true);
  const publicJson = JSON.stringify(toPublicDrillInstance(instance));
  expect(publicJson).not.toMatch(/correct|explanation|"facts"|"hint"/i);
  expect(instance.hint).not.toMatch(/\{\w+\}/);
  expect(instance.explanation.text).not.toContain('?');
  const spec = instance.answerSpec;
  if (spec.kind === 'numeric') {
    expect(gradeDrill(instance, { kind: 'numeric', value: spec.correct })).toBe(true);
    expect(gradeDrill(instance, { kind: 'numeric', value: spec.correct + 1 })).toBe(false);
    const f = instance.explanation.facts;
    const remaining = rangeCombos(parseRange(String(f.range)), known).length;
    expect(f.remaining).toBe(remaining);
    if (instance.category === 'combos')
      expect(spec.correct).toBe(remaining);
    else {
      expect(instance.question).toContain('연습 가정');
      expect(instance.situation.note).toContain(String(f.valueRange));
      expect(instance.situation.note).toContain(String(f.bluffRange));
      const value = rangeCombos(parseRange(String(f.valueRange)), known);
      const bluff = rangeCombos(parseRange(String(f.bluffRange)), known);
      expect(f.valueCombos).toBe(value.length);
      expect(f.bluffCombos).toBe(bluff.length);
      expect(f.actionRemoved).toBe(remaining - value.length - bluff.length);
      const field = instance.templateId === 'read-value-combos' ? 'valueCombos' : instance.templateId === 'read-bluff-combos' ? 'bluffCombos' : 'actionRemoved';
      expect(spec.correct).toBe(f[field]);
      const heroValue = evaluateHand(hero, board).value;
      expect(value.every(hole => evaluateHand(hole, board).value > heroValue)).toBe(true);
      expect(bluff.every(hole => evaluateHand(hole, board).value < heroValue)).toBe(true);
    }
  }
  else if (spec.kind === 'multiple-choice') {
    const result = findNuts(board, hero);
    expect(result.holeCards).toHaveLength(1);
    const values = spec.options.map(option => evaluateHand(parseCards(option), board).value);
    expect(values[spec.correctIndex]).toBe(result.hand.value);
    expect(values.filter(v => v === result.hand.value)).toHaveLength(1);
    for (const option of spec.options)
      expect(parseCards(option).every(c => !known.some(k => formatCard(k) === formatCard(c)))).toBe(true);
    expect(gradeDrill(instance, { kind: 'multiple-choice', index: spec.correctIndex })).toBe(true);
    expect(gradeDrill(instance, { kind: 'multiple-choice', index: (spec.correctIndex + 1) % 4 })).toBe(false);
  }
  else
    throw new Error('unexpected input kind');
}
it.each(IDS)('%s: 100 seeds keep the answer, public projection and math consistent', id => {
  const variations = new Set<string>();
  for (let seed = 0; seed < 100; seed++) {
    const instance = generateDrill(id, seed, { teacher: 'elena' });
    verify(instance);
    variations.add(JSON.stringify([instance.situation.hero, instance.situation.board, instance.question]));
  }
  expect(variations.size).toBeGreaterThan(3);
}, 60000);
it('recreates answers deterministically without Math.random and exposes existing statistics labels', () => {
  const spy = vi.spyOn(Math, 'random');
  try {
    for (const id of IDS)
      for (const seed of [0, 31, 99]) {
        const instance = generateDrill(id, seed, { teacher: 'chloe', bigBlind: 40 });
        expect(instance).toEqual(generateDrill(id, seed, { teacher: 'chloe', bigBlind: 40 }));
        expect(instance.situation.bigBlind).toBe(40);
        expect(DRILL_CATEGORY_LABEL[instance.category]).toBeTruthy();
        expect(instance.explanation.text).not.toMatch(/(이에요|예요|어요|아요|해요|돼요|이고요)/);
      }
    expect(spy).not.toHaveBeenCalled();
  }
  finally {
    spy.mockRestore();
  }
  const chapter = makeChapter();
  chapter.steps = [{ kind: 'drill-set', id: 'r3-review', title: '복습', teacher: 'elena', hintPenalty: 0.5, drills: IDS.map(templateId => ({ templateId, seedPolicy: 'per-run' })) }, { kind: 'result', id: 'result' }];
  expect(chapterSkillCategories(chapter)).toEqual(['combos', 'hand-reading', 'hand-ranking']);
});
