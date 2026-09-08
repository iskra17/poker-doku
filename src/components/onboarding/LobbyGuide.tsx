'use client';

import { useProfileStore } from '@/lib/store/profile-store';
import { useGameStore } from '@/lib/store/game-store';
import { useStoryStore } from '@/lib/store/story-store';
import { setBeginnerGuideDismissed, useBeginnerGuideDismissed } from '@/lib/story/beginner-guide';
import ContextGuide from './ContextGuide';

export default function LobbyGuide() {
  const profileId = useProfileStore(state => state.profile?.id ?? null);
  const dismissed = useBeginnerGuideDismissed(profileId);
  const connected = useGameStore(state => state.connected);
  const roomId = useGameStore(state => state.currentRoomId);
  const preserved = useGameStore(state => state.rooms.some(room => !!room.mySeat));
  const run = useStoryStore(state => state.run);
  const progress = useStoryStore(state => state.progress);
  const pending = useStoryStore(state => state.pending);
  if (!profileId || dismissed || !connected || roomId || preserved || run || pending || !progress
    || progress.chapters.some(chapter => chapter.completions > 0)) return null;
  return <ContextGuide target={'[data-tour="lobby-start"]'} onDismiss={() => setBeginnerGuideDismissed(profileId, true)}>
    첫 수련을 눌러 두 문제부터 시작해요.
  </ContextGuide>;
}
