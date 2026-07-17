'use client';

import { create, type StoreApi, type UseBoundStore } from 'zustand';
import { ARENA_CONFIG_V1 } from '@/lib/arena/config';
import type { ArenaTier } from '@/lib/arena/types';
import type {
  ArenaQueueState,
  ArenaResultPayload,
  PokerClientSocket,
} from '@/lib/realtime/protocol';

export type ArenaPhase =
  | 'idle'
  | 'queued'
  | 'training-offered'
  | 'match-found'
  | 'playing'
  | 'result';

export type ArenaSnapshot =
  | { readonly enabled: false }
  | {
      readonly enabled: true;
      readonly season: {
        readonly startsAt: number;
        readonly endsAt: number;
        readonly remainingMs: number;
        readonly preseason: boolean;
        readonly preseasonScarceRewardsSuppressed: boolean;
      };
      readonly profile: {
        readonly availableTickets: number;
        readonly placementGames: number;
        readonly placementMatches: number;
        readonly placementPoints: number;
        readonly tier: ArenaTier | null;
      };
      readonly weekly: {
        readonly groupAssigned: boolean;
        readonly rank: number | null;
        readonly score: number;
        readonly matches: number;
        readonly memberCount: number;
        readonly tier: ArenaTier | null;
      };
    };

interface ArenaOffer {
  readonly offerId: string;
  readonly expiresAt: number;
}

type LoadOutcome = 'ready' | 'unauthorized' | 'error';

interface ArenaStoreDependencies {
  fetch: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
  now: () => number;
  setTimer: (callback: () => void) => unknown;
  clearTimer: (timer: unknown) => void;
}

export interface ArenaStoreState {
  snapshot: ArenaSnapshot | null;
  loading: boolean;
  phase: ArenaPhase;
  joinedAt: number | null;
  deadlineAt: number | null;
  remainingMs: number;
  offer: ArenaOffer | null;
  matchId: string | null;
  training: boolean;
  result: ArenaResultPayload | null;
  error: string | null;
  load(): Promise<LoadOutcome>;
  joinQueue(): void;
  cancelQueue(): void;
  acceptTraining(): void;
  rejectTraining(): void;
  receiveQueueState(state: ArenaQueueState): void;
  receiveTrainingOffer(offer: ArenaOffer): void;
  receiveMatchFound(match: { matchId: string; training: boolean }): void;
  receiveRoomJoined(room: { roomId: string }): void;
  receiveResult(result: ArenaResultPayload): void;
  receiveRoomLost(): void;
  resetAfterResult(): void;
  reset(): void;
  bindSocket(socket: PokerClientSocket): () => void;
}

export type ArenaStore = UseBoundStore<StoreApi<ArenaStoreState>>;

const DEFAULT_ERROR = '포커 아레나 정보를 불러오지 못했어요. 잠시 후 다시 시도해 주세요.';

const browserDependencies: ArenaStoreDependencies = {
  fetch: (...args) => globalThis.fetch(...args),
  now: Date.now,
  setTimer: callback => globalThis.setInterval(callback, 250),
  clearTimer: timer => globalThis.clearInterval(
    timer as ReturnType<typeof setInterval>,
  ),
};

export function createArenaStore(
  dependencies: ArenaStoreDependencies,
): ArenaStore {
  let timer: unknown = null;
  let boundSocket: PokerClientSocket | null = null;
  let bindingCount = 0;
  let unbindListeners: (() => void) | null = null;
  const seenResults = new Set<string>();

  return create<ArenaStoreState>((set, get) => {
    const stopTimer = (): void => {
      if (timer === null) return;
      dependencies.clearTimer(timer);
      timer = null;
    };
    const resetMatch = (): void => {
      stopTimer();
      set({
        phase: 'idle',
        joinedAt: null,
        deadlineAt: null,
        remainingMs: 0,
        offer: null,
        matchId: null,
        training: false,
        result: null,
      });
    };
    const tick = (): void => {
      const deadlineAt = get().deadlineAt;
      if (deadlineAt === null) return;
      const remainingMs = Math.max(0, deadlineAt - dependencies.now());
      if (remainingMs === 0 && get().phase === 'training-offered') {
        resetMatch();
        return;
      }
      set({ remainingMs });
    };
    const startTimer = (): void => {
      if (timer !== null) return;
      timer = dependencies.setTimer(tick);
    };
    const setDeadline = (deadlineAt: number): void => {
      set({
        deadlineAt,
        remainingMs: Math.max(0, deadlineAt - dependencies.now()),
      });
      startTimer();
    };

    const state: ArenaStoreState = {
      snapshot: null,
      loading: false,
      phase: 'idle',
      joinedAt: null,
      deadlineAt: null,
      remainingMs: 0,
      offer: null,
      matchId: null,
      training: false,
      result: null,
      error: null,

      load: async () => {
        set({ loading: true, error: null });
        try {
          const response = await dependencies.fetch('/api/arena', {
            method: 'GET',
            credentials: 'same-origin',
            cache: 'no-store',
          });
          const value = await readJson(response);
          if (response.status === 401) {
            set({ loading: false, error: '프로필 인증이 만료되었어요.' });
            return 'unauthorized';
          }
          const snapshot = parseSnapshot(value);
          if (!response.ok || !snapshot) {
            set({ loading: false, error: DEFAULT_ERROR });
            return 'error';
          }
          set({ snapshot, loading: false, error: null });
          return 'ready';
        } catch {
          set({ loading: false, error: DEFAULT_ERROR });
          return 'error';
        }
      },

      joinQueue: () => {
        const socket = boundSocket;
        if (!socket?.connected || get().phase !== 'idle') return;
        set({ error: null });
        socket.emit('arena-queue-join', ack => {
          if (!ack.ok) set({ error: ack.message });
        });
      },

      cancelQueue: () => {
        const socket = boundSocket;
        if (!socket?.connected || get().phase !== 'queued') return;
        socket.emit('arena-queue-leave', ack => {
          if (ack.ok) resetMatch();
          else set({ error: ack.message });
        });
      },

      acceptTraining: () => {
        const socket = boundSocket;
        const offer = get().offer;
        if (
          !socket?.connected
          || get().phase !== 'training-offered'
          || !offer
        ) return;
        socket.emit('arena-training-accept', { offerId: offer.offerId }, ack => {
          if (!ack.ok) {
            set({ error: ack.message });
            return;
          }
          get().receiveMatchFound({
            matchId: ack.data?.matchId ?? '',
            training: true,
          });
        });
      },

      rejectTraining: () => {
        const socket = boundSocket;
        const offer = get().offer;
        if (
          !socket?.connected
          || get().phase !== 'training-offered'
          || !offer
        ) return;
        socket.emit('arena-training-reject', { offerId: offer.offerId }, ack => {
          if (ack.ok) resetMatch();
          else set({ error: ack.message });
        });
      },

      receiveQueueState: incoming => {
        const current = get().phase;
        if (incoming.status === 'idle') {
          if (current === 'queued' || current === 'training-offered') {
            resetMatch();
          }
          return;
        }
        if (incoming.status === 'queued') {
          if (current !== 'idle' && current !== 'queued') return;
          const joinedAt = incoming.joinedAt ?? dependencies.now();
          set({
            phase: 'queued',
            joinedAt,
            offer: null,
            matchId: null,
            training: false,
            result: null,
            error: null,
          });
          setDeadline(joinedAt + ARENA_CONFIG_V1.queueFallbackAtMs);
          return;
        }
        // "forming" is an authoritative queued snapshot until match-found.
        if (incoming.status === 'forming' && current === 'queued') return;
      },

      receiveTrainingOffer: offer => {
        if (get().phase !== 'queued') return;
        if (get().offer?.offerId === offer.offerId) return;
        if (
          !offer.offerId
          || !Number.isSafeInteger(offer.expiresAt)
          || offer.expiresAt <= dependencies.now()
        ) return;
        set({
          phase: 'training-offered',
          offer: { ...offer },
          error: null,
        });
        setDeadline(offer.expiresAt);
      },

      receiveMatchFound: match => {
        const current = get().phase;
        if (current !== 'queued' && current !== 'training-offered') return;
        if (!match.matchId) return;
        stopTimer();
        set({
          phase: 'match-found',
          deadlineAt: null,
          remainingMs: 0,
          offer: null,
          matchId: match.matchId,
          training: match.training,
          result: null,
          error: null,
        });
        void get().load();
      },

      receiveRoomJoined: () => {
        if (get().phase !== 'match-found') return;
        set({ phase: 'playing' });
      },

      receiveResult: result => {
        const current = get();
        if (
          (current.phase !== 'playing' && current.phase !== 'match-found')
          || current.matchId !== result.matchId
          || seenResults.has(result.resultId)
        ) return;
        seenResults.add(result.resultId);
        set({
          phase: 'result',
          result: { ...result },
          training: result.training,
          error: null,
        });
        void get().load();
      },

      receiveRoomLost: resetMatch,
      resetAfterResult: resetMatch,
      reset: () => {
        resetMatch();
        set({ snapshot: null, loading: false, error: null });
      },

      bindSocket: socket => {
        if (boundSocket === socket && unbindListeners) {
          bindingCount += 1;
          return releaseBinding;
        }
        unbindListeners?.();
        boundSocket = socket;
        bindingCount = 1;
        const onQueue = (value: ArenaQueueState): void => {
          get().receiveQueueState(value);
        };
        const onOffer = (value: ArenaOffer): void => {
          get().receiveTrainingOffer(value);
        };
        const onMatch = (
          value: { matchId: string; training: boolean },
        ): void => {
          get().receiveMatchFound(value);
        };
        const onRoomJoined = (value: { roomId: string }): void => {
          get().receiveRoomJoined(value);
        };
        const onResult = (value: ArenaResultPayload): void => {
          get().receiveResult(value);
        };
        const onRoomLost = (): void => {
          get().receiveRoomLost();
        };
        socket.on('arena-queue-update', onQueue);
        socket.on('arena-training-offered', onOffer);
        socket.on('arena-match-found', onMatch);
        socket.on('room-joined', onRoomJoined);
        socket.on('arena-result', onResult);
        socket.on('room-lost', onRoomLost);
        unbindListeners = () => {
          socket.off('arena-queue-update', onQueue);
          socket.off('arena-training-offered', onOffer);
          socket.off('arena-match-found', onMatch);
          socket.off('room-joined', onRoomJoined);
          socket.off('arena-result', onResult);
          socket.off('room-lost', onRoomLost);
        };
        return releaseBinding;
      },
    };

    function releaseBinding(): void {
      bindingCount = Math.max(0, bindingCount - 1);
      if (bindingCount !== 0) return;
      unbindListeners?.();
      unbindListeners = null;
      boundSocket = null;
    }

    return state;
  });
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json() as unknown;
  } catch {
    return null;
  }
}

function parseSnapshot(value: unknown): ArenaSnapshot | null {
  if (!isRecord(value) || typeof value.enabled !== 'boolean') return null;
  if (!value.enabled) return { enabled: false };
  if (
    !isRecord(value.season)
    || !isRecord(value.profile)
    || !isRecord(value.weekly)
    || !Number.isSafeInteger(value.profile.availableTickets)
    || !Number.isSafeInteger(value.profile.placementGames)
    || !Number.isSafeInteger(value.profile.placementMatches)
    || (value.profile.tier !== null && typeof value.profile.tier !== 'string')
  ) return null;
  return value as unknown as ArenaSnapshot;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export const useArenaStore = createArenaStore(browserDependencies);
