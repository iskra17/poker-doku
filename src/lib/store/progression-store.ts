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
const AUTH_ERROR = '프로필 인증이 만료됐어요. 복구 코드를 확인해 주세요.';

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
    || typeof missions.profileId !== 'string'
    || typeof missions.missionDate !== 'string'
  ) return null;
  return { progression, missions };
}

function parseProgression(
  value: unknown,
  expectedProfileId: string | null,
): ProgressionSnapshot | null {
  if (!isRecord(value) || !isRecord(value.progression)) return null;
  const snapshot = value.progression as unknown as ProgressionSnapshot;
  if (!isRecord(snapshot.profile) || typeof snapshot.profile.profileId !== 'string') {
    return null;
  }
  if (expectedProfileId !== null && snapshot.profile.profileId !== expectedProfileId) {
    return null;
  }
  return snapshot;
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

interface RequestResult {
  outcome: LoadOutcome;
  payload: unknown;
  profileId: string | null;
}

export function createProgressionStore(dependencies: Dependencies): ProgressionStore {
  let boundSocket: PokerClientSocket | null = null;
  let bindCount = 0;
  let onSnapshot: ((snapshot: ProgressionSnapshot) => void) | null = null;
  let onReward: ((summary: ProgressionRewardSummary) => void) | null = null;
  const seenEventIds = new Set<string>();
  const controllers = new Set<AbortController>();
  let identityGeneration = 0;
  let progressionEpoch = 0;
  let readSequence = 0;
  let latestReadSequence = 0;
  let actionOwner = 0;
  let mutationTail: Promise<void> = Promise.resolve();
  let currentMutationCount = 0;
  let protectedCharacter: {
    profileId: string;
    value: ProgressionCharacterId;
  } | null = null;
  const protectedEquipment = new Map<ProgressionEquipmentSlot, string | null>();
  let missionRefreshScheduled = false;
  let missionRefreshRequested = false;
  let missionRefreshPromise: Promise<void> | null = null;

  return create<ProgressionStoreState>((set, get) => {
    const invalidateIdentity = (): void => {
      identityGeneration += 1;
      progressionEpoch += 1;
      latestReadSequence = ++readSequence;
      actionOwner += 1;
      for (const controller of controllers) controller.abort();
      controllers.clear();
      mutationTail = Promise.resolve();
      currentMutationCount = 0;
      protectedCharacter = null;
      protectedEquipment.clear();
      missionRefreshScheduled = false;
      missionRefreshRequested = false;
      missionRefreshPromise = null;
    };

    const finishAction = (
      owner: number | null,
      patch: Partial<ProgressionStoreState> = {},
    ): void => {
      if (owner === null || owner !== actionOwner) return;
      set({ ...patch, action: null });
    };

    const requestJson = async (
      path: string,
      init: RequestInit,
      action: Exclude<ProgressionAction, null> | null,
      isLatest: () => boolean = () => true,
      silent = false,
    ): Promise<RequestResult> => {
      const controller = new AbortController();
      controllers.add(controller);
      const requestIdentityGeneration = identityGeneration;
      const profileId = get().profileId;
      const owner = action === null ? null : ++actionOwner;
      const sameIdentity = (): boolean => (
        identityGeneration === requestIdentityGeneration
        && get().profileId === profileId
      );
      const current = (): boolean => sameIdentity() && isLatest();
      if (action !== null) {
        set({
          action,
          error: null,
          authExpired: false,
          ...(action === 'loading' ? { status: 'loading' as const } : {}),
        });
      }
      try {
        const response = await dependencies.fetch(path, { ...init, signal: controller.signal });
        const payload = await readJson(response);
        if (!current()) {
          finishAction(owner);
          return {
            outcome: 'stale', payload, profileId,
          };
        }
        if (response.status === 401) {
          const patch = {
            status: 'error' as const,
            authExpired: true,
            error: AUTH_ERROR,
          };
          if (silent) set(patch);
          else finishAction(owner, patch);
          return {
            outcome: 'unauthorized', payload, profileId,
          };
        }
        if (!response.ok) {
          const message = isRecord(payload) && isRecord(payload.error)
            && typeof payload.error.message === 'string'
            ? payload.error.message : DEFAULT_ERROR;
          if (!silent) {
            finishAction(owner, {
              status: get().snapshot ? 'ready' : 'error',
              error: message,
            });
          }
          return {
            outcome: 'error', payload, profileId,
          };
        }
        if (!silent) finishAction(owner, { error: null, authExpired: false });
        return {
          outcome: 'ready', payload, profileId,
        };
      } catch {
        if (!current()) {
          finishAction(owner);
          return {
            outcome: 'stale', payload: null, profileId,
          };
        }
        if (!silent) {
          finishAction(owner, {
            status: get().snapshot ? 'ready' : 'error',
            error: DEFAULT_ERROR,
          });
        }
        return {
          outcome: 'error', payload: null, profileId,
        };
      } finally {
        controllers.delete(controller);
      }
    };

    const mergeProtectedFields = (incoming: ProgressionSnapshot): ProgressionSnapshot => {
      let selectedCharacterId = incoming.profile.selectedCharacterId;
      if (protectedCharacter?.profileId === incoming.profile.profileId) {
        if (selectedCharacterId === protectedCharacter.value) protectedCharacter = null;
        else selectedCharacterId = protectedCharacter.value;
      }
      const equipment = { ...incoming.equipment };
      for (const [slot, value] of protectedEquipment) {
        if (equipment[slot] === value) protectedEquipment.delete(slot);
        else equipment[slot] = value;
      }
      return {
        ...incoming,
        profile: { ...incoming.profile, selectedCharacterId },
        equipment,
      };
    };

    const nextRead = (): number => {
      const sequence = ++readSequence;
      latestReadSequence = sequence;
      return sequence;
    };

    const readView = async (
      includeProgression: boolean,
      showLoading: boolean,
    ): Promise<LoadOutcome> => {
      const sequence = nextRead();
      const capturedProgressionEpoch = progressionEpoch;
      const capturedIdentityGeneration = identityGeneration;
      const result = await requestJson(
        '/api/progression',
        { credentials: 'same-origin', cache: 'no-store' },
        showLoading ? 'loading' : null,
        () => latestReadSequence === sequence,
        !showLoading,
      );
      if (result.outcome !== 'ready') return result.outcome;
      const view = parseView(result.payload);
      if (
        !view
        || (result.profileId !== null
          && (view.progression.profile.profileId !== result.profileId
            || view.missions.profileId !== result.profileId))
        || view.missions.profileId !== view.progression.profile.profileId
      ) {
        if (showLoading) set({ status: 'error', error: DEFAULT_ERROR });
        return 'error';
      }
      if (
        identityGeneration !== capturedIdentityGeneration
        || get().profileId !== result.profileId
      ) return 'stale';
      const applyProgression = includeProgression
        && progressionEpoch === capturedProgressionEpoch
        && currentMutationCount === 0;
      set({
        ...(applyProgression
          ? { snapshot: mergeProtectedFields(view.progression) }
          : {}),
        missions: view.missions,
        status: get().snapshot || applyProgression ? 'ready' : get().status,
      });
      return 'ready';
    };

    const scheduleMissionRefresh = (): void => {
      if (!get().profileId) return;
      missionRefreshRequested = true;
      if (missionRefreshScheduled || missionRefreshPromise) return;
      missionRefreshScheduled = true;
      queueMicrotask(() => {
        missionRefreshScheduled = false;
        if (!missionRefreshRequested || missionRefreshPromise || !get().profileId) return;
        missionRefreshRequested = false;
        const refreshIdentity = identityGeneration;
        const pending = readView(false, false)
          .then(() => undefined)
          .finally(() => {
            if (missionRefreshPromise === pending) missionRefreshPromise = null;
            if (identityGeneration === refreshIdentity && missionRefreshRequested) {
              scheduleMissionRefresh();
            }
          });
        missionRefreshPromise = pending;
      });
    };

    const serializeMutation = (
      operation: () => Promise<LoadOutcome>,
    ): Promise<LoadOutcome> => {
      const queuedIdentityGeneration = identityGeneration;
      const queuedProfileId = get().profileId;
      const pending = mutationTail.then(async () => {
        if (
          identityGeneration !== queuedIdentityGeneration
          || get().profileId !== queuedProfileId
        ) return 'stale' as const;
        currentMutationCount += 1;
        progressionEpoch += 1;
        try {
          return await operation();
        } finally {
          if (identityGeneration === queuedIdentityGeneration) {
            currentMutationCount -= 1;
            progressionEpoch += 1;
          }
        }
      });
      mutationTail = pending.then(() => undefined, () => undefined);
      return pending;
    };

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

      load: () => readView(true, true),

      rerollMission: slot => serializeMutation(async () => {
        const result = await requestJson(
          '/api/progression/missions/reroll',
          jsonPost({ slot }),
          'reroll',
        );
        if (result.outcome !== 'ready') return result.outcome;
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
      }),

      selectCharacter: characterId => serializeMutation(async () => {
        const result = await requestJson(
          '/api/progression/character',
          jsonPost({ characterId }),
          'character',
        );
        if (result.outcome !== 'ready') return result.outcome;
        const responseSnapshot = parseProgression(result.payload, result.profileId);
        if (!responseSnapshot) {
          set({ error: DEFAULT_ERROR });
          return 'error';
        }
        const committed = responseSnapshot.profile.selectedCharacterId;
        protectedCharacter = {
          profileId: responseSnapshot.profile.profileId,
          value: committed,
        };
        set(state => ({
          snapshot: state.snapshot
            ? {
                ...state.snapshot,
                profile: { ...state.snapshot.profile, selectedCharacterId: committed },
              }
            : responseSnapshot,
          status: 'ready',
        }));
        return 'ready';
      }),

      setEquipment: (slot, itemId) => serializeMutation(async () => {
        const result = await requestJson(
          '/api/progression/equipment',
          jsonPost({ slot, itemId }),
          'equipment',
        );
        if (result.outcome !== 'ready') return result.outcome;
        const responseSnapshot = parseProgression(result.payload, result.profileId);
        if (!responseSnapshot) {
          set({ error: DEFAULT_ERROR });
          return 'error';
        }
        const committed = responseSnapshot.equipment[slot];
        protectedEquipment.set(slot, committed);
        set(state => ({
          snapshot: state.snapshot
            ? {
                ...state.snapshot,
                equipment: { ...state.snapshot.equipment, [slot]: committed },
              }
            : responseSnapshot,
          status: 'ready',
        }));
        return 'ready';
      }),

      receiveSnapshot: snapshot => {
        const currentProfileId = get().profileId;
        if (!currentProfileId || currentProfileId !== snapshot.profile.profileId) return;
        progressionEpoch += 1;
        set({
          snapshot: mergeProtectedFields(snapshot),
          status: 'ready',
          error: null,
          authExpired: false,
        });
      },

      enqueueReward: summary => {
        if (seenEventIds.has(summary.eventId)) return;
        seenEventIds.add(summary.eventId);
        scheduleMissionRefresh();
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

      setEconomySummaryActive: active => set({
        economySummaryState: active ? 'active' : 'idle',
      }),

      setProfileIdentity: profileId => {
        if (get().profileId === profileId) return;
        invalidateIdentity();
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
        invalidateIdentity();
        set({
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
        });
      },

      clearError: () => set({ error: null }),
    };
  });
}

export const useProgressionStore = createProgressionStore({
  fetch: (input, init) => fetch(input, init),
});
