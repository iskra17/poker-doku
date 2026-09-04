import { expect, it } from 'vitest';
import { cards } from '@/lib/poker/test-helpers';
import { findNuts } from '@/lib/poker/learning';
import { evaluateHand } from '@/lib/poker/evaluator';
import { mulberry32 } from '@/lib/poker/seeded-rng';
import { generateDrill } from '../generator';
import { NUTS_TEMPLATES, uniqueNutsChoices } from './nuts';
it('requires a single actual two-card nuts combination and removes known hero cards', () => {
  const board = cards('2h 5h 9h Kc 7d');
  const result = uniqueNutsChoices(board, cards('Ah Qs'), mulberry32(3))!;
  expect(result).not.toBeNull();
  expect(result.rank).toBe('flush');
  expect(result.hole.map(c => c.rank)).toEqual(['K', 'Q']);
  expect(result.options).toHaveLength(4);
  const values = result.candidates.map(hole => evaluateHand(hole, board).value);
  expect(values.filter(v => v === Math.max(...values))).toHaveLength(1);
  const full = findNuts(cards('Ks Kh As Ah 2d'), cards('Kc Ac'));
  expect(full.hand.rank).toBe('full-house');
  expect(full.holeCards.length).toBeGreaterThan(1);
  expect(uniqueNutsChoices(cards('Ks Kh As Ah 2d'), cards('Kc Ac'), mulberry32(4))).toBeNull();
});
it('rerolls board-only nuts and suit-tied straight nuts instead of choosing an arbitrary answer', () => {
  expect(uniqueNutsChoices(cards('Ah Kh Qh Jh Th'), [], mulberry32(1))).toBeNull();
  expect(uniqueNutsChoices(cards('9h 8c 7d 2s 3c'), [], mulberry32(1))).toBeNull();
});
it('uses the existing bounded seed reroll when an exact nuts draft is tied', () => {
  const definition = NUTS_TEMPLATES.find(d => d.template.id === 'nuts-blocked-combo')!;
  const seed = Array.from({ length: 32 }, (_, i) => i).find(seed => definition.build({ rng: mulberry32(seed), teacher: 'elena', bigBlind: 20, params: {} }) === null);
  expect(seed).toBeDefined();
  const instance = generateDrill(definition.template.id, seed!, { teacher: 'elena' });
  expect(instance.seed).toBe(seed);
  expect(instance).toEqual(generateDrill(definition.template.id, seed!, { teacher: 'elena' }));
});
