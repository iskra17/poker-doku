'use client';

import { create, type StoreApi, type UseBoundStore } from 'zustand';
import type {
  PokerClientSocket,
  WeeklyDojoStartAck,
} from '@/lib/realtime/protocol';
import type { WeeklyDojoView } from '@/lib/weekly-dojo/types';

/**
 * 주간 도장 클라이언트 미러 — **수신 전용**이다.
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
const LOAD_ERROR = '주간 도장 정보를 불러오지 못했어요.';

export function createWeeklyDojoStore(): WeeklyDojoStore {
  let boundSocket: PokerClientSocket | null = null;

  return create<WeeklyDojoStoreState>((set, get) => ({
    view: null,
    loadState: 'idle',
    pending: false,
    error: null,

    refresh: () => {
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
      socket.emit('get-weekly-dojo', ack => {
        if (ack.ok && ack.data) {
          set({ view: ack.data, loadState: 'ready', error: null });
          return;
        }
        set(state => ({
          loadState: state.view ? 'ready' : 'error',
          error: ack.ok ? LOAD_ERROR : ack.message,
        }));
      });
    },

    start: () => {
      const socket = boundSocket;
      if (!socket?.connected || get().pending) {
        if (!socket?.connected) set({ error: OFFLINE_ERROR });
        return Promise.resolve(null);
      }
      set({ pending: true, error: null });
      return new Promise<WeeklyDojoStartAck | null>(resolve => {
        socket.emit('weekly-dojo-start', {}, ack => {
          set({ pending: false, error: ack.ok ? null : ack.message });
          resolve(ack.ok ? ack.data ?? null : null);
        });
      });
    },

    forfeit: () => {
      const socket = boundSocket;
      if (!socket?.connected || get().pending) {
        if (!socket?.connected) set({ error: OFFLINE_ERROR });
        return Promise.resolve(false);
      }
      set({ pending: true, error: null });
      return new Promise<boolean>(resolve => {
        socket.emit('weekly-dojo-forfeit', {}, ack => {
          set({ pending: false, error: ack.ok ? null : ack.message });
          resolve(ack.ok);
        });
      });
    },

    receiveUpdate: view => {
      set({ view, loadState: 'ready', error: null });
    },

    clearError: () => set({ error: null }),

    reset: () => set({
      view: null,
      loadState: 'idle',
      pending: false,
      error: null,
    }),

    bindSocket: socket => {
      boundSocket = socket;
      const onUpdate = (view: WeeklyDojoView): void => {
        get().receiveUpdate(view);
      };
      socket.on('weekly-dojo-update', onUpdate);
      return () => {
        socket.off('weekly-dojo-update', onUpdate);
        if (boundSocket === socket) boundSocket = null;
      };
    },
  }));
}

export const useWeeklyDojoStore = createWeeklyDojoStore();
