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
});
