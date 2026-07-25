import { describe, it, expect } from 'vitest';
import { computePayouts, paidPlaces, payoutPercents } from './payout-table';

describe('payout table', () => {
  it('band boundaries follow the ladder', () => {
    expect(paidPlaces(2)).toBe(1);
    expect(paidPlaces(4)).toBe(1);
    expect(paidPlaces(5)).toBe(2);
    expect(paidPlaces(7)).toBe(2);
    expect(paidPlaces(8)).toBe(3);
    expect(paidPlaces(11)).toBe(3);
    expect(paidPlaces(12)).toBe(4);
    expect(paidPlaces(24)).toBe(4);
    expect(paidPlaces(25)).toBe(5);
    expect(paidPlaces(34)).toBe(5);
    expect(paidPlaces(35)).toBe(7);
    expect(paidPlaces(48)).toBe(7);
  });

  it('each band sums to 100%', () => {
    for (const entrants of [2, 5, 8, 12, 25, 35]) {
      const total = payoutPercents(entrants).reduce((s, v) => s + v, 0);
      expect(total).toBeCloseTo(100, 6);
    }
  });

  it('payouts are descending and sum exactly to the pool', () => {
    for (const [pool, entrants] of [
      [480_000, 48],
      [123_457, 35],
      [30_000, 25],
      [9_999, 12],
      [1_501, 8],
      [777, 5],
      [100, 2],
    ] as const) {
      const payouts = computePayouts(pool, entrants);
      expect(payouts.length).toBe(paidPlaces(entrants));
      expect(payouts.reduce((s, v) => s + v, 0)).toBe(pool);
      for (let i = 1; i < payouts.length; i++) {
        expect(payouts[i]).toBeLessThanOrEqual(payouts[i - 1]);
      }
    }
  });

  it('winner takes ~30% at a full 48 field', () => {
    const payouts = computePayouts(480_000, 48);
    expect(payouts[0]).toBeGreaterThanOrEqual(144_000); // 30% + 반올림 잔여
    expect(payouts[0]).toBeLessThan(148_000);
  });

  it('rejects invalid pools', () => {
    expect(() => computePayouts(-1, 10)).toThrow();
    expect(() => computePayouts(1.5, 10)).toThrow();
  });

  it('exposes the approved 8-player structures', () => {
    expect(payoutPercents(8, 'standard')).toEqual([50, 30, 20]);
    expect(payoutPercents(8, 'flat')).toEqual([40, 28, 19, 13]);
    expect(payoutPercents(8, 'top-heavy')).toEqual([65, 35]);
  });

  it.each(['standard', 'flat', 'top-heavy'] as const)(
    '%s stays valid for 2..48 entrants',
    preset => {
    for (let entrants = 2; entrants <= 48; entrants += 1) {
      const percents = payoutPercents(entrants, preset);
      expect(percents.length).toBeLessThanOrEqual(entrants);
      expect(percents.reduce((sum, value) => sum + value, 0)).toBeCloseTo(100, 8);

      const payouts = computePayouts(480_001, entrants, preset);
      expect(payouts).toHaveLength(paidPlaces(entrants, preset));
      expect(payouts.reduce((sum, value) => sum + value, 0)).toBe(480_001);
      for (let index = 1; index < payouts.length; index += 1) {
        expect(payouts[index]).toBeLessThanOrEqual(payouts[index - 1]);
      }
    }
    },
  );

  it('rejects invalid entrant counts', () => {
    expect(() => payoutPercents(1)).toThrow();
    expect(() => payoutPercents(2.5)).toThrow();
  });

  describe('table version 3 small fields', () => {
    it('pays the winner everything at two entrants', () => {
      for (const preset of ['standard', 'flat', 'top-heavy'] as const) {
        expect(payoutPercents(2, preset, 3)).toEqual([100]);
      }
    });

    it('follows the approved three-entrant ladders', () => {
      expect(payoutPercents(3, 'standard', 3)).toEqual([70, 30]);
      expect(payoutPercents(3, 'flat', 3)).toEqual([60, 40]);
      expect(payoutPercents(3, 'top-heavy', 3)).toEqual([100]);
    });

    it('follows the approved four-to-five entrant ladders', () => {
      for (const entrants of [4, 5] as const) {
        expect(payoutPercents(entrants, 'standard', 3)).toEqual([65, 35]);
        expect(payoutPercents(entrants, 'flat', 3)).toEqual([60, 40]);
        expect(payoutPercents(entrants, 'top-heavy', 3)).toEqual([75, 25]);
      }
    });

    it('delegates six or more entrants to the v2 bands', () => {
      for (const preset of ['standard', 'flat', 'top-heavy'] as const) {
        for (let entrants = 6; entrants <= 48; entrants += 1) {
          expect(payoutPercents(entrants, preset, 3))
            .toEqual(payoutPercents(entrants, preset, 2));
        }
      }
    });

    it('keeps every v3 ladder summing to 100 and descending', () => {
      for (const preset of ['standard', 'flat', 'top-heavy'] as const) {
        for (let entrants = 2; entrants <= 48; entrants += 1) {
          const percents = payoutPercents(entrants, preset, 3);
          expect(percents.length).toBeLessThanOrEqual(entrants);
          expect(percents.reduce((sum, value) => sum + value, 0))
            .toBeCloseTo(100, 8);

          const payouts = computePayouts(480_001, entrants, preset, 3);
          expect(payouts).toHaveLength(paidPlaces(entrants, preset, 3));
          expect(payouts.reduce((sum, value) => sum + value, 0)).toBe(480_001);
          for (let index = 1; index < payouts.length; index += 1) {
            expect(payouts[index]).toBeLessThanOrEqual(payouts[index - 1]);
          }
        }
      }
    });
  });

  it('leaves table version 2 output untouched', () => {
    // Existing settlements are frozen against v2 — the small-field ladders
    // must only change for tournaments that opted into v3.
    expect(payoutPercents(2, 'standard', 2)).toEqual([100]);
    expect(payoutPercents(3, 'standard', 2)).toEqual([100]);
    expect(payoutPercents(4, 'standard', 2)).toEqual([100]);
    expect(payoutPercents(5, 'standard', 2)).toEqual([65, 35]);
    expect(payoutPercents(4, 'flat', 2)).toEqual([65, 35]);
    expect(payoutPercents(4, 'top-heavy', 2)).toEqual([100]);
    expect(payoutPercents(4, 'standard')).toEqual([100]);
    expect(paidPlaces(4, 'standard')).toBe(1);
  });

  it('rejects unknown table versions', () => {
    expect(() => payoutPercents(8, 'standard', 1 as never)).toThrow();
    expect(() => payoutPercents(8, 'standard', 4 as never)).toThrow();
    expect(() => computePayouts(1_000, 8, 'standard', 4 as never)).toThrow();
  });
});
