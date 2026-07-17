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

type LoadOutcome = 'ready' | 'unauthorized' | 'error' | 'stale';
type ProgressionAction = 'loading' | 'reroll' | 'character' | 'equipment' | null;

interface Dependencies {
  fetch: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
}

export interface ProgressionStoreState {
  profileId: string | null;
  snapshot: ProgressionSnapshot | null;
  missions: DailyMissionDaySnapshot | null;
  status: 'idle' | 'loading' | 'ready' | 'error';
  action: ProgressionAction;
  error: string | null;
  authExpired: boolean;
  activeReward: ProgressionRewardSummary | null;
  rewardQueue: ProgressionRewardSummary[];
  economySummaryState: 'idle' | 'active';
  load(): Promise<LoadOutcome>;
  rerollMission(slot: number): Promise<LoadOutcome>;
  selectCharacter(characterId: ProgressionCharacterId): Promise<LoadOutcome>;
  setEquipment(slot: ProgressionEquipmentSlot, itemId: string | null): Promise<LoadOutcome>;
  receiveSnapshot(snapshot: ProgressionSnapshot): void;
  enqueueReward(summary: ProgressionRewardSummary): void;
  consumeReward(eventId: string): void;
  setEconomySummaryActive(active: boolean): void;
  setProfileIdentity(profileId: string | null): void;
  bindSocket(socket: PokerClientSocket): () => void;
  reset(): void;
  clearError(): void;
}

export type ProgressionStore = UseBoundStore<StoreApi<ProgressionStoreState>>;

const DEFAULT_ERROR = '성장 정보를 불러오지 못했어요. 잠시 후 다시 시도해 주세요.';
export function selectDisplayReward(
  state: Pick<ProgressionStoreState, 'activeReward' | 'economySummaryState'>,
): ProgressionRewardSummary | null {
  return state.economySummaryState === 'idle' ? state.activeReward : null;
}

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
  const seenEventIds = new Set<string>();
  let requestGeneration = 0;
  let activeController: AbortController | null = null;

  return create<ProgressionStoreState>((set, get) => {
    const invalidateRequests = (): void => {
      requestGeneration += 1;
      activeController?.abort();
      activeController = null;
    };

    const request = async (
      path: string,
      init: RequestInit,
      action: Exclude<ProgressionAction, null>,
    ): Promise<{
      outcome: LoadOutcome;
      payload: unknown;
      profileId: string | null;
      generation: number;
    }> => {
      invalidateRequests();
      const controller = new AbortController();
      activeController = controller;
      const generation = requestGeneration;
      const profileId = get().profileId;
      const current = (): boolean => (
        requestGeneration === generation
        && activeController === controller
        && get().profileId === profileId
      );
      set({ action, error: null, authExpired: false, ...(action === 'loading' ? { status: 'loading' as const } : {}) });
      try {
        const response = await dependencies.fetch(path, {
          ...init,
          signal: controller.signal,
        });
        const payload = await readJson(response);
        if (!current()) return { outcome: 'stale', payload, profileId, generation };
        if (response.status === 401) {
          set({ status: 'error', action: null, authExpired: true, error: '프로필 인증이 만료됐어요. 복구 코드를 확인해 주세요.' });
          activeController = null;
          return { outcome: 'unauthorized', payload, profileId, generation };
        }
        if (!response.ok) {
          const message = isRecord(payload) && isRecord(payload.error)
            && typeof payload.error.message === 'string'
            ? payload.error.message : DEFAULT_ERROR;
          set({ status: get().snapshot ? 'ready' : 'error', action: null, error: message });
          activeController = null;
          return { outcome: 'error', payload, profileId, generation };
        }
        set({ action: null, error: null, authExpired: false });
        activeController = null;
        return { outcome: 'ready', payload, profileId, generation };
      } catch {
        if (!current()) {
          return { outcome: 'stale', payload: null, profileId, generation };
        }
        set({ status: get().snapshot ? 'ready' : 'error', action: null, error: DEFAULT_ERROR });
        activeController = null;
        return { outcome: 'error', payload: null, profileId, generation };
      }
    };

    const replaceProgressionPayload = (
      payload: unknown,
      expectedProfileId: string | null,
    ): boolean => {
      if (!isRecord(payload) || !isRecord(payload.progression)) return false;
      const snapshot = payload.progression as unknown as ProgressionSnapshot;
      if (!isRecord(snapshot.profile) || typeof snapshot.profile.profileId !== 'string') return false;
      if (expectedProfileId !== null && snapshot.profile.profileId !== expectedProfileId) {
        return false;
      }
      set({
        profileId: expectedProfileId ?? snapshot.profile.profileId,
        snapshot,
        status: 'ready',
      });
      return true;
    };

    const isCurrentResult = (result: {
      profileId: string | null;
      generation: number;
    }): boolean => (
      result.generation === requestGeneration
      && get().profileId === result.profileId
    );

    return {
      profileId: null,
      snapshot: null,
      missions: null,
      status: 'idle',
      action: null,
      error: null,
      authExpired: false,
      activeReward: null,
      rewardQueue: [],
      economySummaryState: 'idle',

      load: async () => {
        const result = await request('/api/progression', {
          credentials: 'same-origin', cache: 'no-store',
        }, 'loading');
        if (result.outcome !== 'ready') return result.outcome;
        if (!isCurrentResult(result)) return 'stale';
        const view = parseView(result.payload);
        if (!view) {
          set({ status: 'error', error: DEFAULT_ERROR });
          return 'error';
        }
        if (
          result.profileId !== null
          && view.progression.profile.profileId !== result.profileId
        ) {
          set({ status: 'error', error: DEFAULT_ERROR });
          return 'error';
        }
        set({
          profileId: result.profileId ?? view.progression.profile.profileId,
          snapshot: view.progression,
          missions: view.missions,
          status: 'ready',
        });
        return 'ready';
      },

      rerollMission: async slot => {
        const result = await request('/api/progression/missions/reroll', jsonPost({ slot }), 'reroll');
        if (result.outcome !== 'ready') return result.outcome;
        if (!isCurrentResult(result)) return 'stale';
        if (!isRecord(result.payload) || !isRecord(result.payload.missions)) {
          set({ error: DEFAULT_ERROR });
          return 'error';
        }
        const missions = result.payload.missions as unknown as DailyMissionDaySnapshot;
        if (result.profileId !== null && missions.profileId !== result.profileId) {
          set({ error: DEFAULT_ERROR });
          return 'error';
        }
        set({ missions, status: 'ready' });
        return 'ready';
      },

      selectCharacter: async characterId => {
        const result = await request('/api/progression/character', jsonPost({ characterId }), 'character');
        if (result.outcome === 'ready' && !isCurrentResult(result)) return 'stale';
        if (result.outcome === 'ready' && !replaceProgressionPayload(result.payload, result.profileId)) {
          set({ error: DEFAULT_ERROR });
          return 'error';
        }
        return result.outcome;
      },

      setEquipment: async (slot, itemId) => {
        const result = await request('/api/progression/equipment', jsonPost({ slot, itemId }), 'equipment');
        if (result.outcome === 'ready' && !isCurrentResult(result)) return 'stale';
        if (result.outcome === 'ready' && !replaceProgressionPayload(result.payload, result.profileId)) {
          set({ error: DEFAULT_ERROR });
          return 'error';
        }
        return result.outcome;
      },

      receiveSnapshot: snapshot => {
        const currentProfileId = get().profileId;
        if (
          currentProfileId !== null
          && currentProfileId !== snapshot.profile.profileId
        ) return;
        invalidateRequests();
        set({
          profileId: currentProfileId ?? snapshot.profile.profileId,
          snapshot,
          status: 'ready',
          action: null,
          error: null,
          authExpired: false,
        });
      },

      enqueueReward: summary => {
        if (seenEventIds.has(summary.eventId)) return;
        seenEventIds.add(summary.eventId);
        if (!get().activeReward) {
          set({ activeReward: summary });
          return;
        }
        set(state => ({
          rewardQueue: [...state.rewardQueue, summary],
        }));
      },

      consumeReward: eventId => {
        if (get().activeReward?.eventId !== eventId) return;
        set(state => ({
          activeReward: state.rewardQueue[0] ?? null,
          rewardQueue: state.rewardQueue.slice(1),
        }));
      },

      setEconomySummaryActive: active => set({
        economySummaryState: active ? 'active' : 'idle',
      }),

      setProfileIdentity: profileId => {
        if (get().profileId === profileId) return;
        invalidateRequests();
        set({
          profileId,
          snapshot: null,
          missions: null,
          status: 'idle',
          action: null,
          error: null,
          authExpired: false,
          activeReward: null,
          rewardQueue: [],
          economySummaryState: 'idle',
        });
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
          onReward = summary => get().enqueueReward(summary);
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
        invalidateRequests();
        set({
          profileId: null, snapshot: null, missions: null, status: 'idle', action: null,
          error: null, authExpired: false, activeReward: null, rewardQueue: [],
          economySummaryState: 'idle',
        });
      },
      clearError: () => set({ error: null }),
    };
  });
}

export const useProgressionStore = createProgressionStore({
  fetch: (input, init) => fetch(input, init),
});
