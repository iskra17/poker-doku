'use client';

import { useCallback, useSyncExternalStore } from 'react';

const BEGINNER_GUIDE_PREFIX = 'poker-doku-beginner-guide:';
const listeners = new Set<() => void>();
const fallback = new Map<string, boolean>();

function key(profileId: string): string {
  return `${BEGINNER_GUIDE_PREFIX}${profileId}`;
}

function read(profileId: string | null): boolean {
  if (!profileId || typeof window === 'undefined') return false;
  if (fallback.has(profileId)) return fallback.get(profileId)!;
  try {
    const stored = window.localStorage.getItem(key(profileId));
    return stored === '1';
  } catch {
    return fallback.get(profileId) ?? false;
  }
}

function subscribe(onChange: () => void): () => void {
  listeners.add(onChange);
  const onStorage = (event: StorageEvent) => {
    if (event.key?.startsWith(BEGINNER_GUIDE_PREFIX)) onChange();
  };
  window.addEventListener('storage', onStorage);
  return () => {
    listeners.delete(onChange);
    window.removeEventListener('storage', onStorage);
  };
}

export function useBeginnerGuideDismissed(profileId: string | null): boolean {
  const getSnapshot = useCallback(() => read(profileId), [profileId]);
  return useSyncExternalStore(subscribe, getSnapshot, () => false);
}

export function setBeginnerGuideDismissed(profileId: string, dismissed: boolean): void {
  try {
    if (dismissed) window.localStorage.setItem(key(profileId), '1');
    else window.localStorage.removeItem(key(profileId));
    fallback.delete(profileId);
  } catch {
    fallback.set(profileId, dismissed);
    // localStorage가 없는 환경에서도 현재 화면은 안내를 계속 사용할 수 있다.
  }
  for (const listener of listeners) listener();
}
