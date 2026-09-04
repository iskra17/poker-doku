import { expect, it } from 'vitest';
import { cards } from '@/lib/poker/test-helpers';
import { countRangeFacts, readRangeFacts } from './range-facts';
it('counts exact combinations with board and hero blockers and deduplicates tokens', () => {
  expect(countRangeFacts('AA', [], [])).toMatchObject({ total: 6, remaining: 6, removed: 0 });
  expect(countRangeFacts('AKs', [], []).remaining).toBe(4);
  expect(countRangeFacts('AKo', [], []).remaining).toBe(12);
  expect(countRangeFacts('AA, AA', cards('As 2h'), [])).toMatchObject({ total: 6, remaining: 3, removed: 3 });
  expect(countRangeFacts('AK', cards('As Kh'), cards('Ac Kd 2c'))).toMatchObject({ total: 16, remaining: 4, removed: 12 });
  expect(countRangeFacts('AA', cards('As Ah'), cards('Ac Ad 2c')).remaining).toBe(0);
  expect(countRangeFacts('', [], [])).toMatchObject({ total: 0, remaining: 0, removed: 0 });
});
it('rejects contradictory known cards and overlapping or outside assumed ranges', () => {
  expect(() => countRangeFacts('AA', cards('As Kh'), cards('As 2d 3c'))).toThrow();
  const input = { range: 'AA, KK, QJs', valueRange: 'AA, KK', bluffRange: 'QJs', hero: cards('As 2h'), board: cards('Kd 7c 3s') };
  expect(readRangeFacts(input)).toMatchObject({ remaining: 10, valueCombos: 6, bluffCombos: 4, removed: 6 });
  expect(() => readRangeFacts({ ...input, bluffRange: 'AA' })).toThrow();
  expect(() => readRangeFacts({ ...input, valueRange: 'QQ' })).toThrow();
});
