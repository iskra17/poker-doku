import { describe, expect, it } from 'vitest';
import {
  THROWABLES,
  THROWABLE_MAP,
  THROW_COOLDOWN_MS,
  THROW_FLIGHT_MS,
  getThrowableUnlockHint,
  isThrowableUnlocked,
} from './catalog';

describe('throwable catalog', () => {
  it('has unique ids and full THROWABLE_MAP coverage', () => {
    const ids = THROWABLES.map(item => item.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const item of THROWABLES) {
      expect(THROWABLE_MAP[item.id]).toBe(item);
    }
    expect(Object.keys(THROWABLE_MAP)).toHaveLength(THROWABLES.length);
  });

  it('every item has Korean name, emoji, and splat emoji', () => {
    for (const item of THROWABLES) {
      expect(item.name.length, `${item.id} name`).toBeGreaterThan(0);
      expect(item.emoji.length, `${item.id} emoji`).toBeGreaterThan(0);
      expect(item.splatEmoji.length, `${item.id} splatEmoji`).toBeGreaterThan(0);
    }
  });

  it('starter items are unlocked regardless of progression', () => {
    const starters = THROWABLES.filter(item => item.unlock.kind === 'starter');
    expect(starters.length).toBeGreaterThanOrEqual(2); // MVP 기본 제공 계약
    for (const item of starters) {
      expect(isThrowableUnlocked(item.id, { dojoLevel: 1 })).toBe(true);
      expect(getThrowableUnlockHint(item.id, { dojoLevel: 1 })).toBeNull();
    }
  });

  it('coin-shop items require the purchase marker and show the price hint', () => {
    const coinItems = THROWABLES.filter(item => item.unlock.kind === 'coin-shop');
    expect(coinItems.length).toBeGreaterThanOrEqual(4); // 유저 확정: 미션 2종 외 나머지는 코인 구매
    for (const item of coinItems) {
      if (item.unlock.kind !== 'coin-shop') continue;
      const { inventoryItemId, price } = item.unlock;
      expect(price).toBeGreaterThan(0);
      expect(isThrowableUnlocked(item.id, { dojoLevel: 50 })).toBe(false);
      expect(
        isThrowableUnlocked(item.id, { dojoLevel: 1, inventoryItemIds: new Set([inventoryItemId]) }),
      ).toBe(true);
      expect(getThrowableUnlockHint(item.id, { dojoLevel: 50 })).toContain(`${price}`);
    }
  });

  it('mission unlocks are exactly two (유저 확정 기획)', () => {
    expect(THROWABLES.filter(item => item.unlock.kind === 'mission')).toHaveLength(2);
  });

  it('mission items require the inventory marker', () => {
    for (const item of THROWABLES) {
      if (item.unlock.kind !== 'mission') continue;
      const marker = item.unlock.inventoryItemId;
      expect(isThrowableUnlocked(item.id, { dojoLevel: 50 })).toBe(false);
      expect(
        isThrowableUnlocked(item.id, { dojoLevel: 1, inventoryItemIds: new Set([marker]) }),
      ).toBe(true);
      expect(getThrowableUnlockHint(item.id, { dojoLevel: 50 })).toBe(item.unlock.hint);
    }
  });

  it('rejects unknown item ids regardless of context', () => {
    expect(isThrowableUnlocked('nope', { dojoLevel: 50 })).toBe(false);
    expect(THROWABLE_MAP['nope']).toBeUndefined();
    expect(getThrowableUnlockHint('nope', { dojoLevel: 50 })).toBeNull();
  });

  it('exposes sane shared timing constants', () => {
    expect(THROW_COOLDOWN_MS).toBeGreaterThanOrEqual(1_000);
    expect(THROW_FLIGHT_MS).toBeGreaterThan(0);
    expect(THROW_FLIGHT_MS).toBeLessThan(THROW_COOLDOWN_MS);
  });
});
