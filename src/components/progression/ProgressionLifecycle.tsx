'use client';

import { useEffect } from 'react';
import { useGameStore } from '@/lib/store/game-store';
import {
  useProfileStore,
  type ProfilePhase,
} from '@/lib/store/profile-store';
import { useProgressionStore } from '@/lib/store/progression-store';

export function progressionProfileIdentity(
  phase: ProfilePhase,
  profileId: string | null,
): string | null {
  return phase === 'ready' ? profileId : null;
}

export default function ProgressionLifecycle() {
  const phase = useProfileStore(state => state.phase);
  const profileId = useProfileStore(state => state.profile?.id ?? null);
  const socket = useGameStore(state => state.socket);
  const identity = progressionProfileIdentity(phase, profileId);

  useEffect(() => {
    const progression = useProgressionStore.getState();
    if (!identity) {
      progression.reset();
      return;
    }

    progression.setProfileIdentity(identity);
    void progression.load().then(outcome => {
      if (outcome === 'unauthorized') {
        void useProfileStore.getState().bootstrap();
      }
    });

    return () => {
      if (useProgressionStore.getState().profileId === identity) {
        useProgressionStore.getState().reset();
      }
    };
  }, [identity]);

  useEffect(() => {
    if (!socket) return;
    return useProgressionStore.getState().bindSocket(socket);
  }, [socket]);

  return null;
}
