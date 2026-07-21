import { describe, expect, it } from 'vitest';
import { cardToString, Deck, secureRandomInt } from './deck';

describe('secureRandomInt', () => {
  it('returns integers in [0, maxExclusive)', () => {
    for (let i = 0; i < 2_000; i++) {
      const value = secureRandomInt(52);
      expect(Number.isInteger(value)).toBe(true);
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(52);
    }
  });

  it('covers the full range (no truncated buckets)', () => {
    const seen = new Set<number>();
    for (let i = 0; i < 5_000 && seen.size < 6; i++) {
      seen.add(secureRandomInt(6));
    }
    expect([...seen].sort()).toEqual([0, 1, 2, 3, 4, 5]);
  });

  it('rejects invalid bounds', () => {
    expect(() => secureRandomInt(0)).toThrow();
    expect(() => secureRandomInt(-1)).toThrow();
    expect(() => secureRandomInt(1.5)).toThrow();
    expect(() => secureRandomInt(2 ** 33)).toThrow();
  });
});

describe('Deck', () => {
  it('holds 52 unique cards after reset', () => {
    const deck = new Deck();
    const dealt = deck.deal(52);
    expect(new Set(dealt.map(cardToString)).size).toBe(52);
    expect(deck.remaining()).toBe(0);
  });

  it('shuffles into practically distinct orders', () => {
    // 52!가지 순서라 두 덱이 완전히 같을 확률은 사실상 0 — 셔플이 죽어 있으면 즉시 잡힌다
    const a = new Deck().deal(52).map(cardToString).join(',');
    const b = new Deck().deal(52).map(cardToString).join(',');
    expect(a).not.toBe(b);
  });

  it('deals every suit to the top card across many shuffles', () => {
    const suits = new Set<string>();
    for (let i = 0; i < 200 && suits.size < 4; i++) {
      suits.add(new Deck().deal(1)[0].suit);
    }
    expect(suits.size).toBe(4);
  });

  it('throws when dealing more cards than remain', () => {
    const deck = new Deck();
    deck.deal(50);
    expect(() => deck.deal(3)).toThrow();
  });
});
