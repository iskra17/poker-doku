'use client';

import { useEffect } from 'react';
import { ensureBaseline } from '@/lib/gallery/seen';
import { useGallery } from './use-gallery';
import { useStoryStore } from '@/lib/store/story-store';

/**
 * 기록실 NEW 기준선 — 프로필의 첫 진행 스냅샷(+스토리 진행도) 시점에 현재 해금분을 "본 것"으로 한 번 기록한다.
 * 그 뒤 해금은 NEW로 남아 결산 [기록실 보기]에서 바로 보인다. 렌더 없음.
 */
export default function GallerySeenBaseline() {
  // 기준선은 표시 설정과 무관한 **실제 해금 전체** — 보너스 CG를 숨겨 둔 채 첫 스냅샷을 잡아도 기준이 어긋나지 않는다
  const { profileId, baselineIds } = useGallery();
  const progressStatus = useStoryStore(state => state.progressStatus);
  const ready = progressStatus === 'ready' || progressStatus === 'error';
  useEffect(() => {
    if (!profileId || !ready) return;
    ensureBaseline(profileId, baselineIds);
  }, [profileId, ready, baselineIds]);
  return null;
}
