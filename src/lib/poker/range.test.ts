import { describe, expect, it, vi } from 'vitest';
import { handKey } from '../bot/hand-rankings';
import { formatCard, formatCards } from './card-notation';
import {
  RANGE_ALL_KEYS,
  RangeParseError,
  countCombos,
  handKeyInRange,
  parseRange,
  rangeCombos,
  tryParseRange,
} from './range';
import { cards } from './test-helpers';

const keys = (text: string) => [...parseRange(text)];

describe('RANGE_ALL_KEYS', () => {
  it('169개이고 중복이 없다', () => {
    expect(RANGE_ALL_KEYS.length).toBe(169);
    expect(new Set(RANGE_ALL_KEYS).size).toBe(169);
  });

  it('페어 13 · 수딧 78 · 오프수트 78', () => {
    const pairs = RANGE_ALL_KEYS.filter(k => k.length === 2);
    const suited = RANGE_ALL_KEYS.filter(k => k.endsWith('s'));
    const offsuit = RANGE_ALL_KEYS.filter(k => k.endsWith('o'));
    expect(pairs.length).toBe(13);
    expect(suited.length).toBe(78);
    expect(offsuit.length).toBe(78);
  });

  it('전체 콤보 합이 1326이다 (52C2)', () => {
    expect(countCombos(new Set(RANGE_ALL_KEYS))).toBe(1326);
  });

  it('hand-rankings의 handKey 표기와 호환된다', () => {
    expect(RANGE_ALL_KEYS).toContain(handKey(cards('Ah As')));
    expect(RANGE_ALL_KEYS).toContain(handKey(cards('Ah Kh')));
    expect(RANGE_ALL_KEYS).toContain(handKey(cards('Ah Kd')));
    expect(RANGE_ALL_KEYS).toContain(handKey(cards('Th 9h'))); // 10은 'T'
    expect(handKey(cards('Th 9h'))).toBe('T9s');
  });
});

describe('parseRange', () => {
  it("'QQ+' = QQ, KK, AA", () => {
    expect(keys('QQ+').sort()).toEqual(['AA', 'KK', 'QQ']);
  });

  it("'22+' = 페어 13종", () => {
    expect(parseRange('22+').size).toBe(13);
  });

  it("'22-55' = 22, 33, 44, 55 (순서 무관)", () => {
    expect(keys('22-55').sort()).toEqual(['22', '33', '44', '55']);
    expect(keys('55-22').sort()).toEqual(['22', '33', '44', '55']);
  });

  it("'AK' = AKs + AKo", () => {
    expect(keys('AK').sort()).toEqual(['AKo', 'AKs']);
  });

  it("'T9s' / 'KQo' 단일 키", () => {
    expect(keys('T9s')).toEqual(['T9s']);
    expect(keys('KQo')).toEqual(['KQo']);
  });

  it("'ATs+' = ATs, AJs, AQs, AKs", () => {
    expect(keys('ATs+').sort()).toEqual(['AJs', 'AKs', 'AQs', 'ATs']);
  });

  it("'KTo+' = KTo, KJo, KQo (높은 랭크 바로 아래까지만)", () => {
    expect(keys('KTo+').sort()).toEqual(['KJo', 'KQo', 'KTo']);
  });

  it("'A5s-A2s' = A5s, A4s, A3s, A2s", () => {
    expect(keys('A5s-A2s').sort()).toEqual(['A2s', 'A3s', 'A4s', 'A5s']);
  });

  it("'AK+' 는 AKs+AKo 양쪽을 확장한다", () => {
    expect(keys('AK+').sort()).toEqual(['AKo', 'AKs']);
  });

  it('쉼표·공백 혼합 구분자와 대소문자를 받아들인다', () => {
    const a = parseRange('QQ+, AK, T9s, A5s-A2s');
    const b = parseRange('qq+  ak\tt9s , a5s-a2s');
    expect([...a].sort()).toEqual([...b].sort());
    expect([...a].sort()).toEqual(['A2s', 'A3s', 'A4s', 'A5s', 'AA', 'AKo', 'AKs', 'KK', 'QQ', 'T9s']);
  });

  it('빈 문자열은 빈 레인지', () => {
    expect(parseRange('').size).toBe(0);
    expect(parseRange('   ').size).toBe(0);
  });

  it('중복 토큰은 합집합으로 흡수된다', () => {
    expect(parseRange('QQ+, AA, KK').size).toBe(3);
  });

  it('잘못된 토큰은 RangeParseError', () => {
    const bad = ['XX', 'A', 'AKx', 'AAs', 'AAo', 'QQ-', '-QQ', 'AKss', '1010s', 'A5s-K2s', 'A5s-A2o', '55-AKs'];
    for (const token of bad) {
      expect(() => parseRange(token), token).toThrow(RangeParseError);
    }
  });

  it('여러 토큰 중 하나만 틀려도 throw (조용히 무시하지 않는다)', () => {
    expect(() => parseRange('QQ+, ZZ')).toThrow(RangeParseError);
  });

  it('tryParseRange는 null을 돌려준다', () => {
    expect(tryParseRange('XX')).toBeNull();
    expect(tryParseRange(42)).toBeNull();
    expect(tryParseRange(null)).toBeNull();
    expect(tryParseRange('QQ+')?.size).toBe(3);
  });
});

describe('rangeCombos / countCombos', () => {
  it('페어 6 · 수딧 4 · 오프수트 12', () => {
    expect(countCombos(parseRange('AA'))).toBe(6);
    expect(countCombos(parseRange('AKs'))).toBe(4);
    expect(countCombos(parseRange('AKo'))).toBe(12);
    expect(countCombos(parseRange('AK'))).toBe(16);
  });

  it("'QQ+' = 18콤보, A♠ 블로커가 있으면 15콤보", () => {
    const range = parseRange('QQ+');
    expect(countCombos(range)).toBe(18); // 6×3
    expect(countCombos(range, cards('As'))).toBe(15); // AA가 6 → 3
  });

  it('데드카드가 두 장이면 그만큼 더 빠진다', () => {
    const range = parseRange('QQ+');
    expect(countCombos(range, cards('As Ad'))).toBe(13); // AA 6 → 1
    expect(countCombos(range, cards('As Kd'))).toBe(12); // AA 3 + KK 3 + QQ 6
  });

  it('모든 콤보가 서로 다른 2장이고 키가 레인지 안에 있다', () => {
    const range = parseRange('QQ+, AK, A5s-A2s');
    const combos = rangeCombos(range);
    const seen = new Set<string>();
    for (const combo of combos) {
      expect(combo).toHaveLength(2);
      expect(formatCard(combo[0])).not.toBe(formatCard(combo[1]));
      expect(range.has(handKey(combo))).toBe(true);
      const key = [formatCard(combo[0]), formatCard(combo[1])].sort().join('');
      expect(seen.has(key)).toBe(false);
      seen.add(key);
    }
    expect(combos.length).toBe(18 + 16 + 16);
  });

  it('결정론적 순서 — 같은 입력이면 같은 목록', () => {
    const range = parseRange('QQ+');
    expect(rangeCombos(range).map(formatCards)).toEqual(rangeCombos(range).map(formatCards));
    // RANGE_ALL_KEYS 순(AA → KK → QQ) × 수트 순(s,h,d,c)
    expect(rangeCombos(range).map(formatCards)[0]).toBe('As Ah');
  });

  it('데드카드를 포함한 콤보는 하나도 남지 않는다', () => {
    const combos = rangeCombos(parseRange('AA, AKs'), cards('As Ah'));
    expect(combos.length).toBeGreaterThan(0);
    for (const combo of combos) {
      expect(formatCards(combo)).not.toContain('As');
      expect(formatCards(combo)).not.toContain('Ah');
    }
  });

  it('빈 레인지는 빈 목록', () => {
    expect(rangeCombos(new Set())).toEqual([]);
    expect(countCombos(new Set())).toBe(0);
  });
});

describe('handKeyInRange', () => {
  it('구체 홀카드의 소속을 판정한다', () => {
    const range = parseRange('QQ+, AK');
    expect(handKeyInRange(cards('Ah As'), range)).toBe(true);
    expect(handKeyInRange(cards('Ah Kd'), range)).toBe(true);
    expect(handKeyInRange(cards('Ah Kh'), range)).toBe(true);
    expect(handKeyInRange(cards('Jh Js'), range)).toBe(false);
    expect(handKeyInRange(cards('Ah Qd'), range)).toBe(false);
  });

  it('2장이 아니면 false', () => {
    expect(handKeyInRange(cards('Ah'), parseRange('AA'))).toBe(false);
    expect(handKeyInRange(cards('Ah As Kd'), parseRange('AA'))).toBe(false);
  });
});

describe('CSPRNG 경계', () => {
  it('Math.random을 쓰지 않는다 (레인지 계산은 전부 결정론)', () => {
    const spy = vi.spyOn(Math, 'random');
    try {
      const range = parseRange('QQ+, AK, A5s-A2s');
      rangeCombos(range, cards('As Kd'));
      countCombos(range);
      handKeyInRange(cards('Ah As'), range);
      tryParseRange('22+');
      expect(spy).not.toHaveBeenCalled();
    } finally {
      spy.mockRestore();
    }
  });
});
