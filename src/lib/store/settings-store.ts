'use client';

import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface SettingsStore {
  muted: boolean;
  toggleMuted: () => void;
  setMuted: (muted: boolean) => void;
}

export const useSettingsStore = create<SettingsStore>()(
  persist(
    (set) => ({
      muted: false,
      toggleMuted: () => set(s => ({ muted: !s.muted })),
      setMuted: (muted) => set({ muted }),
    }),
    { name: 'poker-doku-settings' },
  ),
);
