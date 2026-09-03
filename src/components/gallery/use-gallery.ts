'use client';

import { useMemo } from 'react';
import { buildGallery, summarizeGallery, type GalleryEntry, type GallerySectionSummary } from '@/lib/gallery/catalog';
import { newEntries } from '@/lib/gallery/seen';
import { useGallerySeen } from '@/lib/gallery/use-gallery-seen';
import { useOperatorMode } from '@/lib/store/operator-store';
import { useProgressionStore } from '@/lib/store/progression-store';
import { useStoryStore } from '@/lib/store/story-store';

export interface GalleryState {
  profileId: string | null;
  entries: GalleryEntry[];
  summary: GallerySectionSummary[];
  seen: ReadonlySet<string>;
  newIds: Set<string>;
  /** 실제 해금 id(운영자 미리보기 제외) — 본 것 표시·NEW 기준선은 이것만 쓴다 */
  unlockedIds: string[];
  /** 운영자 모드 미리보기(전 항목 해금 표시) 중인가 */
  preview: boolean;
}

/** 기록실 파생 상태 — 스냅샷·스토리 진행도·본 항목 집합에서 항목/NEW를 계산한다(헤더 배지·허브 카드·모달 공용) */
export function useGallery(): GalleryState {
  const profileId = useProgressionStore(state => state.profileId);
  const snapshot = useProgressionStore(state => state.snapshot);
  const progress = useStoryStore(state => state.progress);
  const seen = useGallerySeen(profileId);
  const preview = useOperatorMode();
  return useMemo(() => {
    const real = buildGallery({ snapshot, progress });
    const entries = preview ? buildGallery({ snapshot, progress, unlockAll: true }) : real;
    return {
      profileId,
      entries,
      summary: summarizeGallery(entries),
      seen,
      newIds: new Set(newEntries(real, seen).map(entry => entry.id)),
      unlockedIds: real.filter(entry => entry.unlocked).map(entry => entry.id),
      preview,
    };
  }, [profileId, snapshot, progress, seen, preview]);
}
