'use client';

import { useMemo } from 'react';
import { buildGallery, summarizeGallery, type GalleryEntry, type GallerySectionSummary } from '@/lib/gallery/catalog';
import { newEntries } from '@/lib/gallery/seen';
import { useGallerySeen } from '@/lib/gallery/use-gallery-seen';
import { useProgressionStore } from '@/lib/store/progression-store';
import { useStoryStore } from '@/lib/store/story-store';

export interface GalleryState {
  profileId: string | null;
  entries: GalleryEntry[];
  summary: GallerySectionSummary[];
  seen: ReadonlySet<string>;
  newIds: Set<string>;
}

/** 기록실 파생 상태 — 스냅샷·스토리 진행도·본 항목 집합에서 항목/NEW를 계산한다(헤더 배지·허브 카드·모달 공용) */
export function useGallery(): GalleryState {
  const profileId = useProgressionStore(state => state.profileId);
  const snapshot = useProgressionStore(state => state.snapshot);
  const progress = useStoryStore(state => state.progress);
  const seen = useGallerySeen(profileId);
  return useMemo(() => {
    const entries = buildGallery({ snapshot, progress });
    return {
      profileId,
      entries,
      summary: summarizeGallery(entries),
      seen,
      newIds: new Set(newEntries(entries, seen).map(entry => entry.id)),
    };
  }, [profileId, snapshot, progress, seen]);
}
