/**
 * 기록실 「NEW」 기준선 — 프로필별 로컬 저장(서버 상태 없음).
 *
 * - 키 `poker-doku-gallery-seen:<profileId>`, 값은 본 항목 id의 JSON 배열.
 * - `ensureBaseline`은 키가 **없을 때만** 현재 해금분을 기준선으로 쓴다(첫 스냅샷 시점) — 첫 오픈에 하면
 *   결산 [기록실 보기]로 열었을 때 NEW가 하나도 없다.
 * - 프로필 전환은 키가 달라 자연 격리, storage 예외(사생활 모드 등)는 삼킨다.
 * - 구독은 모듈 이미터(`subscribeGallerySeen`) — 훅은 `use-gallery-seen.ts`.
 */

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export const GALLERY_SEEN_KEY_PREFIX = 'poker-doku-gallery-seen:';

export function gallerySeenKey(profileId: string): string {
  return `${GALLERY_SEEN_KEY_PREFIX}${profileId}`;
}

const listeners = new Set<() => void>();
let version = 0;

function notify(): void {
  version += 1;
  for (const listener of listeners) listener();
}

export function subscribeGallerySeen(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

/** 변경 카운터 — useSyncExternalStore 스냅샷용(값 자체는 readSeen으로) */
export function gallerySeenVersion(): number {
  return version;
}

function defaultStorage(): StorageLike | null {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return null;
    return window.localStorage;
  } catch {
    return null;
  }
}

export function readSeen(profileId: string, storage: StorageLike | null = defaultStorage()): Set<string> {
  if (!storage) return new Set();
  try {
    const raw = storage.getItem(gallerySeenKey(profileId));
    if (!raw) return new Set();
    const parsed: unknown = JSON.parse(raw);
    return new Set(Array.isArray(parsed) ? parsed.filter((value): value is string => typeof value === 'string') : []);
  } catch {
    return new Set();
  }
}

/** 키가 있는가(기준선이 잡혔는가) */
export function hasBaseline(profileId: string, storage: StorageLike | null = defaultStorage()): boolean {
  if (!storage) return false;
  try {
    return storage.getItem(gallerySeenKey(profileId)) !== null;
  } catch {
    return false;
  }
}

function write(profileId: string, seen: Set<string>, storage: StorageLike | null): boolean {
  if (!storage) return false;
  try {
    storage.setItem(gallerySeenKey(profileId), JSON.stringify([...seen]));
    return true;
  } catch {
    return false;
  }
}

/** 첫 기준선 — 키가 없을 때만 현재 해금 id 전부를 "본 것"으로 기록. 기록했으면 true. */
export function ensureBaseline(profileId: string, unlockedIds: Iterable<string>, storage: StorageLike | null = defaultStorage()): boolean {
  if (!profileId || hasBaseline(profileId, storage)) return false;
  const ok = write(profileId, new Set(unlockedIds), storage);
  if (ok) notify();
  return ok;
}

/** 열람 표시 — 새로 추가된 id가 있을 때만 저장·통지 */
export function markSeen(profileId: string, ids: Iterable<string>, storage: StorageLike | null = defaultStorage()): void {
  if (!profileId) return;
  const seen = readSeen(profileId, storage);
  let changed = false;
  for (const id of ids) {
    if (!seen.has(id)) {
      seen.add(id);
      changed = true;
    }
  }
  if (!changed) return;
  if (write(profileId, seen, storage)) notify();
}

/** 해금됐지만 아직 안 본 항목 id */
export function newEntries<T extends { id: string; unlocked: boolean }>(entries: readonly T[], seen: ReadonlySet<string>): T[] {
  return entries.filter(entry => entry.unlocked && !seen.has(entry.id));
}
