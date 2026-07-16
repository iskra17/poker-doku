'use client';

import { create, type StoreApi, type UseBoundStore } from 'zustand';
import type { PokerClientSocket } from '@/lib/realtime/protocol';
import type { DailyMissionDaySnapshot } from '@/lib/progression/missions';
import type {
  ProgressionCharacterId,
  ProgressionEquipmentSlot,
  ProgressionRewardSummary,
  ProgressionSnapshot,
  ProgressionView,
} from '@/lib/progression/types';

type LoadOutcome = 'ready' | 'unauthorized' | 'error';
type ProgressionAction = 'loading' | 'reroll' | 'character' | 'equipment' | null;

interface Dependencies {
  fetch: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
}

export interface ProgressionStoreState {
  snapshot: ProgressionSnapshot | null;
  missions: DailyMissionDaySnapshot | null;
  status: 'idle' | 'loading' | 'ready' | 'error';
  action: ProgressionAction;
  error: string | null;
  authExpired: boolean;
  activeReward: ProgressionRewardSummary | null;
  rewardQueue: ProgressionRewardSummary[];
  load(): Promise<LoadOutcome>;
  rerollMission(slot: number): Promise<LoadOutcome>;
  selectCharacter(characterId: ProgressionCharacterId): Promise<LoadOutcome>;
  setEquipment(slot: ProgressionEquipmentSlot, itemId: string | null): Promise<LoadOutcome>;
  receiveSnapshot(snapshot: ProgressionSnapshot): void;
  enqueueReward(summary: ProgressionRewardSummary): void;
  consumeReward(eventId: string): void;
  bindSocket(socket: PokerClientSocket): () => void;
  reset(): void;
  clearError(): void;
}

export type ProgressionStore = UseBoundStore<StoreApi<ProgressionStoreState>>;

const DEFAULT_ERROR = '성장 정보를 불러오지 못했어요. 잠시 후 다시 시도해 주세요.';
const MAX_SEEN_REWARDS = 256;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseView(value: unknown): ProgressionView | null {
  if (!isRecord(value) || !isRecord(value.progression) || !isRecord(value.missions)) {
    return null;
  }
  const progression = value.progression as unknown as ProgressionSnapshot;
  const missions = value.missions as unknown as DailyMissionDaySnapshot;
  if (
    !isRecord(progression.profile)
    || typeof progression.profile.profileId !== 'string'
    || !Array.isArray(progression.affinities)
    || !Array.isArray(progression.inventory)
    || !isRecord(progression.equipment)
    || !Array.isArray(missions.missions)
    || typeof missions.missionDate !== 'string'
  ) return null;
  return { progression, missions };
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json() as unknown;
  } catch {
    return null;
  }
}

function jsonPost(body: unknown): RequestInit {
  return {
    method: 'POST',
    credentials: 'same-origin',
    cache: 'no-store',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  };
}

export function createProgressionStore(dependencies: Dependencies): ProgressionStore {
  let boundSocket: PokerClientSocket | null = null;
  let bindCount = 0;
  let onSnapshot: ((snapshot: ProgressionSnapshot) => void) | null = null;
  let onReward: ((summary: ProgressionRewardSummary) => void) | null = null;
  let seenEventIds: string[] = [];

  return create<ProgressionStoreState>((set, get) => {
    const request = async (
      path: string,
      init: RequestInit,
      action: Exclude<ProgressionAction, null>,
    ): Promise<{ outcome: LoadOutcome; payload: unknown }> => {
      set({ action, error: null, authExpired: false, ...(action === 'loading' ? { status: 'loading' as const } : {}) });
      try {
        const response = await dependencies.fetch(path, init);
        const payload = await readJson(response);
        if (response.status === 401) {
          set({ status: 'error', action: null, authExpired: true, error: '프로필 인증이 만료됐어요. 복구 코드를 확인해 주세요.' });
          return { outcome: 'unauthorized', payload };
        }
        if (!response.ok) {
          const message = isRecord(payload) && isRecord(payload.error)
            && typeof payload.error.message === 'string'
            ? payload.error.message : DEFAULT_ERROR;
          set({ status: get().snapshot ? 'ready' : 'error', action: null, error: message });
          return { outcome: 'error', payload };
        }
        set({ action: null, error: null, authExpired: false });
        return { outcome: 'ready', payload };
      } catch {
        set({ status: get().snapshot ? 'ready' : 'error', action: null, error: DEFAULT_ERROR });
        return { outcome: 'error', payload: null };
      }
    };

    const replaceProgressionPayload = (payload: unknown): boolean => {
      if (!isRecord(payload) || !isRecord(payload.progression)) return false;
      const snapshot = payload.progression as unknown as ProgressionSnapshot;
      if (!isRecord(snapshot.profile) || typeof snapshot.profile.profileId !== 'string') return false;
      set({ snapshot, status: 'ready' });
      return true;
    };

    return {
      snapshot: null,
      missions: null,
      status: 'idle',
      action: null,
      error: null,
      authExpired: false,
      activeReward: null,
      rewardQueue: [],

      load: async () => {
        const result = await request('/api/progression', {
          credentials: 'same-origin', cache: 'no-store',
        }, 'loading');
        if (result.outcome !== 'ready') return result.outcome;
        const view = parseView(result.payload);
        if (!view) {
          set({ status: 'error', error: DEFAULT_ERROR });
          return 'error';
        }
        set({ snapshot: view.progression, missions: view.missions, status: 'ready' });
        return 'ready';
      },

      rerollMission: async slot => {
        const result = await request('/api/progression/missions/reroll', jsonPost({ slot }), 'reroll');
        if (result.outcome !== 'ready') return result.outcome;
        if (!isRecord(result.payload) || !isRecord(result.payload.missions)) {
          set({ error: DEFAULT_ERROR });
          return 'error';
        }
        set({ missions: result.payload.missions as unknown as DailyMissionDaySnapshot, status: 'ready' });
        return 'ready';
      },

      selectCharacter: async characterId => {
        const result = await request('/api/progression/character', jsonPost({ characterId }), 'character');
        if (result.outcome === 'ready' && !replaceProgressionPayload(result.payload)) {
          set({ error: DEFAULT_ERROR });
          return 'error';
        }
        return result.outcome;
      },

      setEquipment: async (slot, itemId) => {
        const result = await request('/api/progression/equipment', jsonPost({ slot, itemId }), 'equipment');
        if (result.outcome === 'ready' && !replaceProgressionPayload(result.payload)) {
          set({ error: DEFAULT_ERROR });
          return 'error';
        }
        return result.outcome;
      },

      receiveSnapshot: snapshot => set({ snapshot, status: 'ready', authExpired: false }),

      enqueueReward: summary => {
        if (seenEventIds.includes(summary.eventId)) return;
        seenEventIds = [...seenEventIds.slice(-(MAX_SEEN_REWARDS - 1)), summary.eventId];
        if (!get().activeReward) {
          set({ activeReward: summary });
          return;
        }
        set(state => ({ rewardQueue: [...state.rewardQueue, summary] }));
      },

      consumeReward: eventId => {
        if (get().activeReward?.eventId !== eventId) return;
        set(state => ({
          activeReward: state.rewardQueue[0] ?? null,
          rewardQueue: state.rewardQueue.slice(1),
        }));
      },

      bindSocket: socket => {
        if (boundSocket === socket) {
          bindCount += 1;
        } else {
          if (boundSocket && onSnapshot && onReward) {
            boundSocket.off('progression-update', onSnapshot);
            boundSocket.off('reward-summary', onReward);
          }
          boundSocket = socket;
          bindCount = 1;
          onSnapshot = snapshot => get().receiveSnapshot(snapshot);
          onReward = summary => {
            get().enqueueReward(summary);
            void get().load();
          };
          socket.on('progression-update', onSnapshot);
          socket.on('reward-summary', onReward);
        }
        let cleaned = false;
        return () => {
          if (cleaned || boundSocket !== socket) return;
          cleaned = true;
          bindCount -= 1;
          if (bindCount > 0 || !onSnapshot || !onReward) return;
          socket.off('progression-update', onSnapshot);
          socket.off('reward-summary', onReward);
          boundSocket = null;
          onSnapshot = null;
          onReward = null;
        };
      },

      reset: () => {
        seenEventIds = [];
        set({
          snapshot: null, missions: null, status: 'idle', action: null,
          error: null, authExpired: false, activeReward: null, rewardQueue: [],
        });
      },
      clearError: () => set({ error: null }),
    };
  });
}

export const useProgressionStore = createProgressionStore({
  fetch: (input, init) => fetch(input, init),
});
