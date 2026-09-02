'use client';

import { useSyncExternalStore } from 'react';
import { getNowPlaying, subscribeNowPlaying, type NowPlaying } from './music-manager';

const serverSnapshot = (): NowPlaying | null => null;

/** 현재 재생 중인 BGM(mood·트랙·미리듣기 여부) — 로비 헤더 🎵·설정 사운드 탭 */
export function useNowPlaying(): NowPlaying | null {
  return useSyncExternalStore(subscribeNowPlaying, getNowPlaying, serverSnapshot);
}
