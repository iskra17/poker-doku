'use client';

import { useEffect } from 'react';
import { useGameStore } from '@/lib/store/game-store';
import { useProfileStore } from '@/lib/store/profile-store';
import { useArenaStore } from '@/lib/store/arena-store';

export default function ArenaLifecycle() {
  const ready = useProfileStore(state => state.phase === 'ready');
  const profileId = useProfileStore(state => state.profile?.id ?? null);
  const socket = useGameStore(state => state.socket);
  const identity = ready ? profileId : null;

  useEffect(() => {
    if (!identity) {
      useArenaStore.getState().reset();
      return;
    }
    void useArenaStore.getState().load();
  }, [identity]);

  useEffect(() => {
    if (!socket) return;
    return useArenaStore.getState().bindSocket(socket);
  }, [socket]);

  return null;
}
