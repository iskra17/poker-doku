'use client';

import { useEffect } from 'react';
import { useGameStore } from '@/lib/store/game-store';
import { useProfileStore } from '@/lib/store/profile-store';
import { useStoryStore } from '@/lib/store/story-store';
import { initStorySoundBindings } from '@/lib/sound/story-sound';
import { progressionProfileIdentity } from '@/components/progression/ProgressionLifecycle';

/**
 * 스토리 스토어 수명주기 — 프로필 확정 시 진행 요약(GET /api/story)을 읽고,
 * 소켓이 생기면 story-update를 구독한다 (ProgressionLifecycle과 같은 계약).
 */
export default function StoryLifecycle() {
  const phase = useProfileStore(state => state.phase);
  const profileId = useProfileStore(state => state.profile?.id ?? null);
  const socket = useGameStore(state => state.socket);
  const identity = progressionProfileIdentity(phase, profileId);

  // 드릴 결과 효과음 바인딩 (모듈 싱글턴, 멱등)
  useEffect(() => {
    initStorySoundBindings();
  }, []);

  useEffect(() => {
    const story = useStoryStore.getState();
    if (!identity) {
      story.reset();
      return;
    }
    story.setProfileIdentity(identity);
    void story.load().then(outcome => {
      if (outcome === 'unauthorized') {
        void useProfileStore.getState().bootstrap();
      }
    });
    return () => {
      if (useStoryStore.getState().profileId === identity) {
        useStoryStore.getState().reset();
      }
    };
  }, [identity]);

  useEffect(() => {
    if (!socket) return;
    return useStoryStore.getState().bindSocket(socket);
  }, [socket]);

  return null;
}
