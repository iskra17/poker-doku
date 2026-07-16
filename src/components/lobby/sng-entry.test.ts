import { describe, expect, it } from 'vitest';
import { getCasualSngEntryAvailability } from './sng-entry';

describe('casual Sit & Go entry availability', () => {
  it('disables only a known balance below the fixed 1,650 entry cost', () => {
    expect(getCasualSngEntryAvailability(null)).toEqual({
      cost: 1_650,
      insufficient: false,
    });
    expect(getCasualSngEntryAvailability(1_649).insufficient).toBe(true);
    expect(getCasualSngEntryAvailability(1_650).insufficient).toBe(false);
  });

  it('treats malformed public balances as unknown instead of trusting them', () => {
    expect(getCasualSngEntryAvailability(-1).insufficient).toBe(false);
    expect(getCasualSngEntryAvailability(1.5).insufficient).toBe(false);
    expect(getCasualSngEntryAvailability(Number.NaN).insufficient).toBe(false);
  });
});
