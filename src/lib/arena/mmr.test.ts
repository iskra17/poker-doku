import { describe, expect, it } from 'vitest';
import { calculateMmrDelta } from './mmr';

describe('six-player arena MMR', () => {
  it('uses each of the six placement results against an even field', () => {
    const opponentMmrs = [1_000, 1_000, 1_000, 1_000, 1_000] as const;
    expect([1, 2, 3, 4, 5, 6].map(place => calculateMmrDelta({
      playerMmr: 1_000,
      opponentMmrs,
      place,
      k: 32,
    }))).toEqual([16, 10, 3, -3, -10, -16]);
  });

  it('uses placement K=48 while retaining the final delta cap', () => {
    expect(calculateMmrDelta({
      playerMmr: 1_000,
      opponentMmrs: [1_000, 1_000, 1_000, 1_000, 1_000],
      place: 1,
      k: 48,
    })).toBe(24);
  });

  it('averages the expected Elo score of all five human or snapshotted bot opponents', () => {
    const symmetricField = [600, 800, 1_000, 1_200, 1_400] as const;
    expect(calculateMmrDelta({
      playerMmr: 1_000,
      opponentMmrs: symmetricField,
      place: 1,
      k: 32,
    })).toBe(16);
    expect(calculateMmrDelta({
      playerMmr: 1_000,
      opponentMmrs: symmetricField,
      place: 6,
      k: 32,
    })).toBe(-16);
  });

  it('is symmetric for first and sixth place in an even field', () => {
    const first = calculateMmrDelta({
      playerMmr: 1_000,
      opponentMmrs: [1_000, 1_000, 1_000, 1_000, 1_000],
      place: 1,
      k: 32,
    });
    const sixth = calculateMmrDelta({
      playerMmr: 1_000,
      opponentMmrs: [1_000, 1_000, 1_000, 1_000, 1_000],
      place: 6,
      k: 32,
    });
    expect(first).toBe(-sixth);
  });

  it('clamps extreme gains and losses to plus or minus 32', () => {
    expect(calculateMmrDelta({
      playerMmr: 100,
      opponentMmrs: [3_000, 3_000, 3_000, 3_000, 3_000],
      place: 1,
      k: 1_000,
    })).toBe(32);
    expect(calculateMmrDelta({
      playerMmr: 3_000,
      opponentMmrs: [100, 100, 100, 100, 100],
      place: 6,
      k: 1_000,
    })).toBe(-32);
  });

  it('does not mutate a frozen opponent snapshot', () => {
    const opponents = Object.freeze([900, 950, 1_000, 1_050, 1_100]);
    expect(() => calculateMmrDelta({
      playerMmr: 1_000,
      opponentMmrs: opponents,
      place: 3,
      k: 32,
    })).not.toThrow();
    expect(opponents).toEqual([900, 950, 1_000, 1_050, 1_100]);
  });

  it('requires exactly five opponents and a valid place, K, and safe integer MMRs', () => {
    const valid = {
      playerMmr: 1_000,
      opponentMmrs: [1_000, 1_000, 1_000, 1_000, 1_000],
      place: 1,
      k: 32,
    };
    for (const input of [
      { ...valid, opponentMmrs: [1_000, 1_000, 1_000, 1_000] },
      { ...valid, opponentMmrs: [...valid.opponentMmrs, 1_000] },
      { ...valid, opponentMmrs: [1_000, 1_000, Number.NaN, 1_000, 1_000] },
      { ...valid, playerMmr: Number.MAX_SAFE_INTEGER + 1 },
      { ...valid, place: 0 },
      { ...valid, place: 7 },
      { ...valid, place: 1.5 },
      { ...valid, k: 0 },
      { ...valid, k: 1.5 },
      { ...valid, k: Number.POSITIVE_INFINITY },
    ]) {
      expect(() => calculateMmrDelta(input)).toThrowError('ARENA_MMR_INPUT_INVALID');
    }
  });

  it('rejects a sparse five-slot opponent array', () => {
    const sparseOpponents = new Array<number>(5);
    sparseOpponents[0] = 1_000;
    sparseOpponents[2] = 1_000;
    sparseOpponents[3] = 1_000;
    sparseOpponents[4] = 1_000;

    expect(() => calculateMmrDelta({
      playerMmr: 1_000,
      opponentMmrs: sparseOpponents,
      place: 1,
      k: 32,
    })).toThrowError('ARENA_MMR_INPUT_INVALID');
  });
});
