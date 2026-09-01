import { describe, expect, it, vi } from 'vitest';
import { hashSeed, mulberry32, pickOne, randomInt, shuffleWith } from './seeded-rng';

describe('mulberry32', () => {
  it('같은 시드는 같은 수열을 낸다 (드릴 재생성의 근거)', () => {
    const a = mulberry32(12345);
    const b = mulberry32(12345);
    const seqA = Array.from({ length: 20 }, () => a());
    const seqB = Array.from({ length: 20 }, () => b());
    expect(seqA).toEqual(seqB);
  });

  it('다른 시드는 다른 수열을 낸다', () => {
    const a = Array.from({ length: 20 }, mulberry32(1));
    const b = Array.from({ length: 20 }, mulberry32(2));
    expect(a).not.toEqual(b);
  });

  it('독립된 인스턴스는 서로의 상태를 공유하지 않는다', () => {
    const a = mulberry32(7);
    const b = mulberry32(7);
    a();
    a();
    expect(b()).toBe(mulberry32(7)());
  });

  it('[0, 1) 범위를 지킨다', () => {
    const rng = mulberry32(0xdeadbeef);
    for (let i = 0; i < 5000; i++) {
      const v = rng();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it('대략 균등하다 (10구간 각 7~13%)', () => {
    const rng = mulberry32(99);
    const buckets = new Array(10).fill(0);
    const n = 20000;
    for (let i = 0; i < n; i++) buckets[Math.floor(rng() * 10)]++;
    for (const count of buckets) {
      expect(count / n).toBeGreaterThan(0.07);
      expect(count / n).toBeLessThan(0.13);
    }
  });
});

describe('hashSeed', () => {
  it('결정론적이고 uint32 범위를 낸다', () => {
    const seed = hashSeed('run-1', 'set-a', 3);
    expect(seed).toBe(hashSeed('run-1', 'set-a', 3));
    expect(Number.isInteger(seed)).toBe(true);
    expect(seed).toBeGreaterThanOrEqual(0);
    expect(seed).toBeLessThan(2 ** 32);
  });

  it('파트 경계를 구분한다 — 이어붙이기 충돌이 없다', () => {
    expect(hashSeed('ab', 'c')).not.toBe(hashSeed('a', 'bc'));
    expect(hashSeed('abc')).not.toBe(hashSeed('ab', 'c'));
  });

  it('인덱스가 1 달라지면 시드가 달라진다 (드릴 문항별 분기)', () => {
    const seeds = new Set<number>();
    for (let i = 0; i < 64; i++) seeds.add(hashSeed('run-1', 'set-a', i));
    expect(seeds.size).toBe(64);
  });

  it('파트 순서를 구분한다', () => {
    expect(hashSeed('a', 'b')).not.toBe(hashSeed('b', 'a'));
  });

  it('인자가 없으면 FNV-1a 오프셋 베이시스를 낸다', () => {
    expect(hashSeed()).toBe(0x811c9dc5);
  });

  it('mulberry32와 조합해도 결정론이다', () => {
    const draw = () => {
      const rng = mulberry32(hashSeed('run-42', 'D-ODDS', 2));
      return [rng(), rng(), rng()];
    };
    expect(draw()).toEqual(draw());
  });
});

describe('randomInt', () => {
  it('[0, maxExclusive) 정수를 낸다', () => {
    const rng = mulberry32(5);
    const seen = new Set<number>();
    for (let i = 0; i < 2000; i++) {
      const v = randomInt(rng, 6);
      expect(Number.isInteger(v)).toBe(true);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(6);
      seen.add(v);
    }
    expect(seen.size).toBe(6); // 6면 전부 나온다
  });

  it('bound 1은 항상 0', () => {
    expect(randomInt(mulberry32(1), 1)).toBe(0);
  });

  it('rng가 계약을 어기고 1을 돌려줘도 범위를 벗어나지 않는다', () => {
    expect(randomInt(() => 1, 10)).toBe(9);
    expect(randomInt(() => 0.999999999, 10)).toBe(9);
  });

  it('잘못된 bound는 throw', () => {
    const rng = mulberry32(1);
    expect(() => randomInt(rng, 0)).toThrow();
    expect(() => randomInt(rng, -3)).toThrow();
    expect(() => randomInt(rng, 2.5)).toThrow();
  });
});

describe('pickOne', () => {
  it('목록 안에서 고르고, 같은 시드면 같은 선택', () => {
    const items = ['a', 'b', 'c', 'd'];
    const first = pickOne(mulberry32(3), items);
    expect(items).toContain(first);
    expect(pickOne(mulberry32(3), items)).toBe(first);
  });

  it('빈 목록은 throw', () => {
    expect(() => pickOne(mulberry32(1), [])).toThrow();
  });
});

describe('shuffleWith', () => {
  it('원본을 건드리지 않고 복사본을 돌려준다', () => {
    const items = [1, 2, 3, 4, 5, 6, 7, 8];
    const snapshot = [...items];
    const shuffled = shuffleWith(mulberry32(11), items);
    expect(items).toEqual(snapshot);
    expect(shuffled).not.toBe(items);
    expect([...shuffled].sort((a, b) => a - b)).toEqual(snapshot);
  });

  it('같은 시드면 같은 순열, 다른 시드면 다른 순열', () => {
    const items = Array.from({ length: 20 }, (_, i) => i);
    expect(shuffleWith(mulberry32(4), items)).toEqual(shuffleWith(mulberry32(4), items));
    expect(shuffleWith(mulberry32(4), items)).not.toEqual(shuffleWith(mulberry32(5), items));
  });

  it('실제로 섞는다 (항등 순열이 아니다)', () => {
    const items = Array.from({ length: 30 }, (_, i) => i);
    expect(shuffleWith(mulberry32(1), items)).not.toEqual(items);
  });

  it('빈 배열/1개 배열도 안전하다', () => {
    expect(shuffleWith(mulberry32(1), [])).toEqual([]);
    expect(shuffleWith(mulberry32(1), ['x'])).toEqual(['x']);
  });
});

describe('CSPRNG 경계', () => {
  it('Math.random을 쓰지 않는다 — 시드 RNG만으로 동작한다', () => {
    const spy = vi.spyOn(Math, 'random');
    try {
      const rng = mulberry32(hashSeed('run', 'set', 1));
      randomInt(rng, 52);
      pickOne(rng, [1, 2, 3]);
      shuffleWith(rng, [1, 2, 3, 4, 5]);
      for (let i = 0; i < 100; i++) rng();
      expect(spy).not.toHaveBeenCalled();
    } finally {
      spy.mockRestore();
    }
  });
});
