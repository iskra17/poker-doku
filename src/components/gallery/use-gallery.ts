'use client';

import { useMemo } from 'react';
import { buildGallery, type GalleryEntry, type GallerySectionSummary } from '@/lib/gallery/catalog';
import { useGallerySeen } from '@/lib/gallery/use-gallery-seen';
import { selectGalleryView } from '@/lib/gallery/view';
import { useOperatorMode } from '@/lib/store/operator-store';
import { useProgressionStore } from '@/lib/store/progression-store';
import { useSettingsStore } from '@/lib/store/settings-store';
import { useStoryStore } from '@/lib/store/story-store';

export interface GalleryState {
  profileId: string | null;
  entries: GalleryEntry[];
  summary: GallerySectionSummary[];
  seen: ReadonlySet<string>;
  newIds: Set<string>;
  /** 실제 해금 id 중 **지금 보이는 것**(운영자 미리보기 제외) — [모두 확인]이 쓴다 */
  unlockedIds: string[];
  /**
   * 실제 해금 id 전체 — 표시 설정으로 숨긴 보너스 CG도 포함한다.
   * NEW 기준선(`ensureBaseline`)은 필터와 무관해야 설정을 껐다 켜도 기준이 흔들리지 않는다.
   */
  baselineIds: string[];
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
  // 보너스 CG 표시 — 목록·집계·NEW를 함께 거른다(지급·해금 상태는 그대로)
  const showBonusCg = useSettingsStore(state => state.showBonusCg);
  return useMemo(() => ({
    profileId,
    ...selectGalleryView({
      real: buildGallery({ snapshot, progress }),
      previewEntries: preview ? buildGallery({ snapshot, progress, unlockAll: true }) : null,
      seen,
      showBonusCg,
    }),
    seen,
    preview,
  }), [profileId, snapshot, progress, seen, preview, showBonusCg]);
}
