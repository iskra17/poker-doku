'use client';

import { useCallback, useMemo, useSyncExternalStore } from 'react';
import { gallerySeenVersion, readSeen, subscribeGallerySeen } from './seen';

const noopSubscribe = () => () => {};

/**
 * 프로필별 「본 항목」 집합 — 저장소 변경(markSeen/ensureBaseline)마다 다시 읽는다.
 * 서버 렌더에서는 항상 빈 집합(NEW 배지 없음) — 하이드레이션 불일치 방지.
 */
export function useGallerySeen(profileId: string | null): ReadonlySet<string> {
  const subscribe = useCallback((listener: () => void) => (profileId ? subscribeGallerySeen(listener) : noopSubscribe()), [profileId]);
  const version = useSyncExternalStore(subscribe, gallerySeenVersion, () => -1);
  return useMemo(() => (profileId && version >= 0 ? readSeen(profileId) : new Set<string>()), [profileId, version]);
}
