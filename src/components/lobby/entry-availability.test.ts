import { describe, expect, it } from 'vitest';
import { getRoomEntryAvailability } from './entry-availability';

describe('room entry wallet availability', () => {
  it('blocks wallet cash above a known balance, including rebuy, and allows equality', () => {
    expect(getRoomEntryAvailability({
      mode: 'cash', economyMode: 'wallet', buyIn: 1_001, balance: 1_000,
    }).insufficient).toBe(true);
    expect(getRoomEntryAvailability({
      mode: 'cash', economyMode: 'wallet', buyIn: 1_001, balance: 1_000,
      isRebuy: true,
    }).insufficient).toBe(true);
    expect(getRoomEntryAvailability({
      mode: 'cash', economyMode: 'wallet', buyIn: 1_000, balance: 1_000,
    }).insufficient).toBe(false);
  });

  it('does not apply wallet balance to practice cash', () => {
    expect(getRoomEntryAvailability({
      mode: 'cash', economyMode: 'practice', buyIn: 4_000, balance: 0,
    })).toMatchObject({ walletRequired: false, insufficient: false });
  });

  it('keeps the fixed Sit & Go cost and conservative unknown-balance policy', () => {
    expect(getRoomEntryAvailability({
      mode: 'sng', economyMode: 'wallet', buyIn: 1_500, balance: 1_649,
    })).toMatchObject({ cost: 1_650, walletRequired: true, insufficient: true });
    expect(getRoomEntryAvailability({
      mode: 'sng', economyMode: 'wallet', buyIn: 1_500, balance: 1_650,
    }).insufficient).toBe(false);
    expect(getRoomEntryAvailability({
      mode: 'cash', economyMode: 'wallet', buyIn: 4_000, balance: null,
    }).insufficient).toBe(false);
  });
});
