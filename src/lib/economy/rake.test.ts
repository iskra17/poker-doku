import { describe, expect, it } from 'vitest';
import { allocateRakeAcrossPots, computeCashRake } from './rake';

describe('computeCashRake', () => {
  it('charges five percent after the flop', () => {
    expect(computeCashRake({ totalPot: 1000, bigBlind: 20, flopDealt: true })).toBe(50);
  });

  it('caps rake at five big blinds', () => {
    expect(computeCashRake({ totalPot: 10_000, bigBlind: 20, flopDealt: true })).toBe(100);
  });

  it('does not charge rake before the flop or on an empty pot', () => {
    expect(computeCashRake({ totalPot: 1000, bigBlind: 20, flopDealt: false })).toBe(0);
    expect(computeCashRake({ totalPot: 0, bigBlind: 20, flopDealt: true })).toBe(0);
  });

  it.each([NaN, Infinity, -1, 1.5, Number.MAX_SAFE_INTEGER + 1])(
    'rejects an invalid total pot (%s)',
    totalPot => {
      expect(() => computeCashRake({ totalPot, bigBlind: 20, flopDealt: true }))
        .toThrow('totalPot must be a safe nonnegative integer');
    },
  );

  it.each([NaN, Infinity, -1, 0, 1.5, Number.MAX_SAFE_INTEGER + 1])(
    'rejects an invalid big blind (%s)',
    bigBlind => {
      expect(() => computeCashRake({ totalPot: 1000, bigBlind, flopDealt: true }))
        .toThrow('bigBlind must be a positive safe integer');
    },
  );

  it('returns a safe integer for very large valid chip inputs', () => {
    const rake = computeCashRake({
      totalPot: Number.MAX_SAFE_INTEGER,
      bigBlind: Number.MAX_SAFE_INTEGER,
      flopDealt: true,
    });

    expect(rake).toBe(450_359_962_737_049);
    expect(Number.isSafeInteger(rake)).toBe(true);
  });
});

describe('allocateRakeAcrossPots', () => {
  it('uses exact proportional remainders to allocate leftover chips', () => {
    expect(allocateRakeAcrossPots([301, 199, 100], 30)).toEqual([15, 10, 5]);
  });

  it('breaks equal-remainder ties by lower original pot index', () => {
    expect(allocateRakeAcrossPots([1, 1, 1], 2)).toEqual([1, 1, 0]);
  });

  it('handles zero rake and a single pot', () => {
    expect(allocateRakeAcrossPots([0, 100], 0)).toEqual([0, 0]);
    expect(allocateRakeAcrossPots([100], 5)).toEqual([5]);
    expect(allocateRakeAcrossPots([], 0)).toEqual([]);
  });

  it.each([NaN, Infinity, -1, 1.5, Number.MAX_SAFE_INTEGER + 1])(
    'rejects an invalid pot amount (%s)',
    amount => {
      expect(() => allocateRakeAcrossPots([amount], 0))
        .toThrow('pots[0] must be a safe nonnegative integer');
    },
  );

  it.each([NaN, Infinity, -1, 1.5, Number.MAX_SAFE_INTEGER + 1])(
    'rejects invalid rake (%s)',
    rake => {
      expect(() => allocateRakeAcrossPots([100], rake))
        .toThrow('rake must be a safe nonnegative integer');
    },
  );

  it('rejects rake greater than the gross pot total', () => {
    expect(() => allocateRakeAcrossPots([10, 20], 31))
      .toThrow('rake must not exceed total pot');
  });

  it('keeps every allocation bounded and the sum equal to rake', () => {
    const pots = [Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER, 1];
    const rake = Number.MAX_SAFE_INTEGER;
    const allocations = allocateRakeAcrossPots(pots, rake);

    expect(allocations.reduce((sum, amount) => sum + BigInt(amount), BigInt(0))).toBe(BigInt(rake));
    allocations.forEach((amount, index) => {
      expect(Number.isSafeInteger(amount)).toBe(true);
      expect(amount).toBeGreaterThanOrEqual(0);
      expect(amount).toBeLessThanOrEqual(pots[index]);
    });
  });
});
