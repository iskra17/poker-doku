'use client';

import { getStoryRewardDefinition } from '@/lib/story/rewards/catalog';
import { useOperatorMode, useOperatorStore } from '@/lib/store/operator-store';
import { useProgressionStore } from '@/lib/store/progression-store';

/**
 * 히로인의 현재 의상 id(카탈로그 `outfitId`) — 스냅샷 `cosmetics.outfits`(서버 장착)에서 읽는다.
 * 운영자 모드에선 `outfitPreview`(로컬 미리보기)가 우선 — 미보유 의상을 로비·스토리 화면에 입혀 볼 때.
 * 좌석·말풍선·컷인·딜러 코너는 이 훅을 쓰지 않는다(기본 의상 고정).
 */
export function useOutfitId(characterId: string | null | undefined): string | null {
  const preview = useOperatorMode();
  const previewItemId = useOperatorStore(state => (characterId ? state.outfitPreview[characterId] ?? null : null));
  const equipped = useProgressionStore(state => {
    if (!characterId) return null;
    return state.snapshot?.cosmetics?.outfits?.[characterId as keyof typeof state.snapshot.cosmetics.outfits] ?? null;
  });
  const itemId = preview && previewItemId ? previewItemId : equipped;
  if (!itemId) return null;
  return getStoryRewardDefinition(itemId)?.outfitId ?? null;
}
