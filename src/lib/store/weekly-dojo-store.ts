'use client';

import { create, type StoreApi, type UseBoundStore } from 'zustand';
import type {
  PokerClientSocket,
  RealtimeAck,
  WeeklyDojoStartAck,
} from '@/lib/realtime/protocol';
import type { WeeklyDojoView } from '@/lib/weekly-dojo/types';

/**
 * 주간 도전 클라이언트 미러 — **수신 전용**이다.
 * 점수·시도 번호·완료 판정은 전부 서버 뷰(`weekly-dojo-update` / `get-weekly-dojo`)에서 오고,
 * 이 스토어는 어떤 숫자도 계산하거나 낙관적으로 갱신하지 않는다.
 */

export type WeeklyDojoLoadState = 'idle' | 'loading' | 'ready' | 'error';

export interface WeeklyDojoStoreState {
  view: WeeklyDojoView | null;
  loadState: WeeklyDojoLoadState;
  /** 시작/포기 요청이 왕복 중 — 버튼 중복 입력 잠금 */
  pending: boolean;
  error: string | null;
  refresh(): void;
  start(): Promise<WeeklyDojoStartAck | null>;
  forfeit(): Promise<boolean>;
  receiveUpdate(view: WeeklyDojoView): void;
  clearError(): void;
  reset(): void;
  bindSocket(socket: PokerClientSocket): () => void;
}

export type WeeklyDojoStore = UseBoundStore<StoreApi<WeeklyDojoStoreState>>;

const OFFLINE_ERROR = '연결이 끊겨 있어요. 잠시 후 다시 시도해 주세요.';
const LOAD_ERROR = '주간 도전 정보를 불러오지 못했어요.';
const ACK_TIMEOUT_ERROR = '응답이 지연되고 있어요. 연결을 확인한 뒤 다시 시도해 주세요.';
const ACK_TIMEOUT_MS = 10_000;

interface CancelableRequest {
  cancel(): void;
}

export function createWeeklyDojoStore(): WeeklyDojoStore {
  let boundSocket: PokerClientSocket | null = null;
  let bindCount = 0;
  let onUpdate: ((view: WeeklyDojoView) => void) | null = null;
  let onDisconnect: (() => void) | null = null;
  let bindingGeneration = 0;
  let lifecycleGeneration = 0;
  let refreshSequence = 0;
  let latestRefreshSequence = 0;
  let pendingRefresh: CancelableRequest | null = null;
  let pendingCommand: CancelableRequest | null = null;

  return create<WeeklyDojoStoreState>((set, get) => {
    const invalidateRequests = (): void => {
      lifecycleGeneration += 1;
      latestRefreshSequence = ++refreshSequence;
      const refresh = pendingRefresh;
      const command = pendingCommand;
      pendingRefresh = null;
      pendingCommand = null;
      refresh?.cancel();
      command?.cancel();
    };

    const sendCommand = <T>(
      send: (socket: PokerClientSocket, done: (ack: RealtimeAck<T>) => void) => void,
    ): Promise<RealtimeAck<T> | null> => {
      const socket = boundSocket;
      if (!socket?.connected) {
        set({ error: OFFLINE_ERROR });
        return Promise.resolve(null);
      }
      if (get().pending) return Promise.resolve(null);
      set({ pending: true, error: null });
      const generation = lifecycleGeneration;
      return new Promise(resolve => {
        let settled = false;
        let request: CancelableRequest | null = null;
        const finish = (ack: RealtimeAck<T> | null): void => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          if (pendingCommand === request) pendingCommand = null;
          const current = generation === lifecycleGeneration
            && boundSocket === socket
            && socket.connected;
          if (current) {
            set({
              pending: false,
              error: ack === null ? ACK_TIMEOUT_ERROR : ack.ok ? null : ack.message,
            });
            resolve(ack);
            return;
          }
          resolve(null);
        };
        const timer = setTimeout(() => finish(null), ACK_TIMEOUT_MS);
        request = { cancel: () => finish(null) };
        pendingCommand = request;
        try {
          send(socket, finish);
        } catch {
          finish(null);
        }
      });
    };

    return {
      view: null,
      loadState: 'idle',
      pending: false,
      error: null,

      refresh: () => {
      const previous = pendingRefresh;
      pendingRefresh = null;
      const sequence = ++refreshSequence;
      latestRefreshSequence = sequence;
      previous?.cancel();
      const socket = boundSocket;
      if (!socket?.connected) {
        set(state => ({
          loadState: state.view ? state.loadState : 'error',
          error: OFFLINE_ERROR,
        }));
        return;
      }
      set(state => ({
        loadState: state.view ? state.loadState : 'loading',
        error: null,
      }));
      const generation = lifecycleGeneration;
      let settled = false;
      let request: CancelableRequest | null = null;
      const finish = (ack: RealtimeAck<WeeklyDojoView> | null): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (pendingRefresh === request) pendingRefresh = null;
        if (
          generation !== lifecycleGeneration
          || sequence !== latestRefreshSequence
          || boundSocket !== socket
          || !socket.connected
        ) return;
        if (ack?.ok && ack.data) {
          set({ view: ack.data, loadState: 'ready', error: null });
          return;
        }
        set(state => ({
          loadState: state.view ? 'ready' : 'error',
          error: ack === null ? LOAD_ERROR : ack.ok ? LOAD_ERROR : ack.message,
        }));
      };
      const timer = setTimeout(() => finish(null), ACK_TIMEOUT_MS);
      request = { cancel: () => finish(null) };
      pendingRefresh = request;
      try {
        socket.emit('get-weekly-dojo', finish);
      } catch {
        finish(null);
      }
      },

      start: async () => {
      const ack = await sendCommand<WeeklyDojoStartAck>((socket, done) => {
        socket.emit('weekly-dojo-start', {}, done);
      });
      return ack?.ok ? ack.data ?? null : null;
      },

      forfeit: async () => {
      const ack = await sendCommand((socket, done) => {
        socket.emit('weekly-dojo-forfeit', {}, done);
      });
      return !!ack?.ok;
      },

      receiveUpdate: view => {
      const previous = pendingRefresh;
      pendingRefresh = null;
      latestRefreshSequence = ++refreshSequence;
      previous?.cancel();
      set({ view, loadState: 'ready', error: null });
      },

      clearError: () => set({ error: null }),

      reset: () => {
      invalidateRequests();
      set({
        view: null,
        loadState: 'idle',
        pending: false,
        error: null,
      });
      },

      bindSocket: socket => {
      if (boundSocket === socket) {
        bindCount += 1;
      } else {
        if (boundSocket) {
          if (onUpdate) boundSocket.off('weekly-dojo-update', onUpdate);
          if (onDisconnect) boundSocket.off('disconnect', onDisconnect);
          boundSocket = null;
          onUpdate = null;
          onDisconnect = null;
          bindCount = 0;
          bindingGeneration += 1;
          invalidateRequests();
        }
        boundSocket = socket;
        bindCount = 1;
        const generation = ++bindingGeneration;
        onUpdate = view => {
          if (boundSocket !== socket || generation !== bindingGeneration) return;
          get().receiveUpdate(view);
        };
        onDisconnect = () => {
          if (boundSocket !== socket || generation !== bindingGeneration) return;
          invalidateRequests();
          set({ pending: false, error: OFFLINE_ERROR });
        };
        socket.on('weekly-dojo-update', onUpdate);
        socket.on('disconnect', onDisconnect);
      }
      let cleaned = false;
      return () => {
        if (cleaned) return;
        cleaned = true;
        if (boundSocket !== socket) return;
        bindCount -= 1;
        if (bindCount > 0) return;
        if (onUpdate) socket.off('weekly-dojo-update', onUpdate);
        if (onDisconnect) socket.off('disconnect', onDisconnect);
        boundSocket = null;
        onUpdate = null;
        onDisconnect = null;
        bindingGeneration += 1;
        invalidateRequests();
        set({ pending: false });
      };
      },
    };
  });
}

export const useWeeklyDojoStore = createWeeklyDojoStore();
