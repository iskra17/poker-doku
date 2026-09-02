import { describe, expect, it, vi } from 'vitest';
import {
  ensureBaseline,
  gallerySeenKey,
  hasBaseline,
  markSeen,
  newEntries,
  readSeen,
  subscribeGallerySeen,
  type StorageLike,
} from './seen';

function memoryStorage(): StorageLike & { map: Map<string, string> } {
  const map = new Map<string, string>();
  return {
    map,
    getItem: key => map.get(key) ?? null,
    setItem: (key, value) => { map.set(key, value); },
  };
}

describe('gallery seen 기준선', () => {
  it('기준선은 키가 없을 때 한 번만 기록된다 — 그 뒤 해금은 NEW', () => {
    const storage = memoryStorage();
    expect(hasBaseline('p1', storage)).toBe(false);
    expect(ensureBaseline('p1', ['cg-a', 'bond-1'], storage)).toBe(true);
    expect(readSeen('p1', storage)).toEqual(new Set(['cg-a', 'bond-1']));
    // 두 번째 호출은 덮어쓰지 않는다(새 해금 cg-b는 NEW로 남아야 한다)
    expect(ensureBaseline('p1', ['cg-a', 'bond-1', 'cg-b'], storage)).toBe(false);
    expect(readSeen('p1', storage).has('cg-b')).toBe(false);
  });

  it('markSeen은 새 id만 추가하고 변경이 있을 때만 구독자에게 알린다', () => {
    const storage = memoryStorage();
    ensureBaseline('p1', [], storage);
    const listener = vi.fn();
    const unsubscribe = subscribeGallerySeen(listener);
    markSeen('p1', ['cg-b'], storage);
    markSeen('p1', ['cg-b'], storage);
    expect(readSeen('p1', storage)).toEqual(new Set(['cg-b']));
    expect(listener).toHaveBeenCalledTimes(1);
    unsubscribe();
  });

  it('newEntries는 해금됐고 안 본 항목만 — 잠긴 항목은 NEW가 아니다', () => {
    const entries = [
      { id: 'a', unlocked: true },
      { id: 'b', unlocked: true },
      { id: 'c', unlocked: false },
    ];
    expect(newEntries(entries, new Set(['a'])).map(entry => entry.id)).toEqual(['b']);
  });

  it('프로필마다 키가 달라 서로 격리된다', () => {
    const storage = memoryStorage();
    ensureBaseline('p1', ['x'], storage);
    ensureBaseline('p2', [], storage);
    expect(gallerySeenKey('p1')).not.toBe(gallerySeenKey('p2'));
    expect(readSeen('p1', storage).has('x')).toBe(true);
    expect(readSeen('p2', storage).has('x')).toBe(false);
  });

  it('storage 예외·손상 값은 삼키고 빈 집합으로 다룬다', () => {
    const throwing: StorageLike = {
      getItem: () => { throw new Error('private mode'); },
      setItem: () => { throw new Error('private mode'); },
    };
    expect(readSeen('p1', throwing)).toEqual(new Set());
    expect(ensureBaseline('p1', ['a'], throwing)).toBe(false);
    expect(() => markSeen('p1', ['a'], throwing)).not.toThrow();
    const corrupt = memoryStorage();
    corrupt.map.set(gallerySeenKey('p1'), '{not json');
    expect(readSeen('p1', corrupt)).toEqual(new Set());
    expect(readSeen('p1', null)).toEqual(new Set());
    expect(ensureBaseline('', ['a'], memoryStorage())).toBe(false);
  });
});
