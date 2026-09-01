import { describe, expect, it } from 'vitest';
import {
  CardNotationError,
  findDuplicateCard,
  formatCard,
  formatCards,
  parseCard,
  parseCards,
  sameCard,
  tryParseCard,
  tryParseCards,
} from './card-notation';
import { Deck } from './deck';
import { card, cards } from './test-helpers';

describe('card-notation', () => {
  it('round-trips all 52 cards through formatCard/parseCard', () => {
    const deck = new Deck();
    const all = deck.deal(52);
    expect(all).toHaveLength(52);
    const codes = new Set<string>();
    for (const c of all) {
      const code = formatCard(c);
      codes.add(code);
      expect(parseCard(code)).toEqual(c);
    }
    expect(codes.size).toBe(52);
  });

  it('matches the test-helpers notation (As Th 2c Kd)', () => {
    expect(parseCard('As')).toEqual(card('As'));
    expect(parseCard('Th')).toEqual(card('Th'));
    expect(parseCards('As Th 2c Kd')).toEqual(cards('As Th 2c Kd'));
    expect(formatCard(card('Th'))).toBe('Th');
  });

  it('accepts 10h, lowercase and comma separators', () => {
    expect(parseCard('10h')).toEqual({ rank: '10', suit: 'hearts' });
    expect(parseCard('as')).toEqual({ rank: 'A', suit: 'spades' });
    expect(parseCard(' KD ')).toEqual({ rank: 'K', suit: 'diamonds' });
    expect(parseCards('As,Kd, Qc')).toHaveLength(3);
    expect(parseCards('')).toEqual([]);
  });

  it('rejects malformed codes', () => {
    for (const bad of ['', 'A', 'Ax', '1h', 'AAs', '11h', 'T', 'hA', 'T s']) {
      expect(tryParseCard(bad), bad).toBeNull();
    }
    expect(tryParseCard(null)).toBeNull();
    expect(tryParseCard(12)).toBeNull();
    expect(() => parseCard('Ax')).toThrow(CardNotationError);
    expect(tryParseCards('As Kd Zz')).toBeNull();
    expect(tryParseCards(['As'])).toBeNull();
  });

  it('rejects duplicate cards in a list', () => {
    expect(tryParseCards('As Kd As')).toBeNull();
    expect(() => parseCards('As as')).toThrow(CardNotationError);
    expect(findDuplicateCard(cards('As Kd Qc'))).toBeNull();
    expect(findDuplicateCard(cards('As Kd As'))).toBe('As');
  });

  it('formats lists and compares cards', () => {
    expect(formatCards(cards('As Th 2c'))).toBe('As Th 2c');
    expect(sameCard(card('As'), { rank: 'A', suit: 'spades' })).toBe(true);
    expect(sameCard(card('As'), card('Ah'))).toBe(false);
  });
});
