'use client';

import BondSceneUnlockWatcher from '@/components/characters/BondSceneUnlockWatcher';
import GallerySeenBaseline from '@/components/gallery/GallerySeenBaseline';
import ProgressionSummary from '@/components/table/ProgressionSummary';

/**
 * 로비 보상 레이어 — 방 밖(수련 스토리 스테이지)에서 끝난 챕터의 도장 레벨업 필과 인연 씬 해금을 그린다.
 * `app/page.tsx`에서 `<StoryStage />` **바로 다음**에 마운트해 포털 DOM 순서상 스테이지 위에 놓인다.
 * z 사다리: StoryStage 95 < RewardCutscene·BondSceneModal 96 < ProgressionSummary(lobby) 97.
 * 방 안(GameRoomView)에는 같은 두 컴포넌트가 table variant로 따로 마운트된다.
 */
export default function StoryRewardLayer() {
  return (
    <>
      <ProgressionSummary variant="lobby" />
      <BondSceneUnlockWatcher />
      {/* 기록실 NEW 기준선 — 프로필 첫 스냅샷 시점에 한 번 */}
      <GallerySeenBaseline />
    </>
  );
}
