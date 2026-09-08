'use client';

import { useEffect } from 'react';
import { useGameStore } from '@/lib/store/game-store';
import { useProfileStore } from '@/lib/store/profile-store';
import { useWeeklyDojoStore } from '@/lib/store/weekly-dojo-store';

/** Keep the private challenge mirror alive across lobby/table navigation. */
export default function WeeklyDojoLifecycle() {
  const ready = useProfileStore(state => state.phase === 'ready');
  const profileId = useProfileStore(state => state.profile?.id ?? null);
  const socket = useGameStore(state => state.socket);
  const connected = useGameStore(state => state.connected);
  const identity = ready ? profileId : null;

  useEffect(() => {
    const store = useWeeklyDojoStore.getState();
    store.reset();
    if (!identity || !socket) return;
    const unbind = store.bindSocket(socket);
    return () => {
      unbind();
      useWeeklyDojoStore.getState().reset();
    };
  }, [identity, socket]);

  useEffect(() => {
    if (identity && socket && connected) useWeeklyDojoStore.getState().refresh();
  }, [identity, socket, connected]);

  return null;
}
