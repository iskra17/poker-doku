'use client';

import { getStoryRewardDefinition } from '@/lib/story/rewards/catalog';
import { useProgressionStore } from '@/lib/store/progression-store';

/**
 * 장착 의상 id — 히로인 6명만(그 외·미장착·미로그인은 null). 로비·스토리 화면 전용:
 * 테이블 좌석·말풍선·컷인은 이 훅을 쓰지 않아 기본 의상으로 남는다(명시 규칙, 2026-09-03).
 * 스냅샷의 `cosmetics.outfits[characterId]`는 **보상 아이템 id**이고, 아트 매니페스트 키(outfitId)는 카탈로그가 안다.
 */
export function useOutfitId(characterId: string | null | undefined): string | null {
  return useProgressionStore(state => {
    if (!characterId) return null;
    const itemId = state.snapshot?.cosmetics?.outfits?.[characterId as keyof typeof state.snapshot.cosmetics.outfits];
    if (!itemId) return null;
    return getStoryRewardDefinition(itemId)?.outfitId ?? null;
  });
}
