'use client';

import { create } from 'zustand';
import { io, Socket } from 'socket.io-client';
import { GameState, ChatMessage, ActionType } from '../poker/types';
import { diffGameState, emitGameEvent } from '../events/game-events';
import { useSettingsStore } from './settings-store';

export interface RoomInfo {
  id: string;
  name: string;
  playerCount: number;
  maxPlayers: number;
  blinds: string;
  status: string;
  mode?: string; // 'cash' | 'sng'
  locked?: boolean; // 시작된 Sit & Go — 참가 불가
  hasPassword?: boolean; // 비밀번호 방
  bigBlind?: number; // 바이인 슬라이더 계산용
  minBuyIn?: number;
  maxBuyIn?: number;
}

// 조인 응답 타임아웃 — room-joined/error 어느 쪽도 안 오면 로비로 롤백
let joinTimeoutTimer: ReturnType<typeof setTimeout> | null = null;
const JOIN_TIMEOUT_MS = 8000;

function clearJoinTimeout(): void {
  if (joinTimeoutTimer) {
    clearTimeout(joinTimeoutTimer);
    joinTimeoutTimer = null;
  }
}

// 재접속용 세션 토큰: localStorage에 보관하는 비밀값 (서버가 좌석/칩을 이 토큰으로 복원)
function getSessionToken(): string {
  if (typeof window === 'undefined') return '';
  const KEY = 'poker-doku-session';
  let token = localStorage.getItem(KEY);
  if (!token) {
    token = typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : `s-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
    localStorage.setItem(KEY, token);
  }
  return token;
}

interface GameStore {
  // Connection
  socket: Socket | null;
  connected: boolean;
  playerName: string;
  myPlayerId: string | null;
  currentRoomId: string | null;
  pendingRoomId: string | null;
  joinError: string | null;

  // Game
  gameState: GameState | null;
  chatMessages: ChatMessage[];
  rooms: RoomInfo[];

  // UI
  showCreateRoom: boolean;

  // Actions
  connect: () => void;
  disconnect: () => void;
  setPlayerName: (name: string) => void;
  joinRoom: (roomId: string, buyIn: number, seatIndex: number, password?: string) => void;
  leaveRoom: () => void;
  sendAction: (action: ActionType, amount?: number) => void;
  sendChat: (message: string) => void;
  toggleSitOut: () => void;
  useTimeBank: () => void;
  sngFillBots: () => void;
  createRoom: (config: { name: string; smallBlind: number; bigBlind: number; minBuyIn: number; maxBuyIn: number; gameMode?: 'cash' | 'sng'; password?: string }) => void;
  setShowCreateRoom: (show: boolean) => void;
}

export const useGameStore = create<GameStore>((set, get) => ({
  socket: null,
  connected: false,
  playerName: '',
  myPlayerId: null,
  currentRoomId: null,
  pendingRoomId: null,
  joinError: null,
  gameState: null,
  chatMessages: [],
  rooms: [],
  showCreateRoom: false,

  connect: () => {
    const socket = io({
      transports: ['websocket', 'polling'],
      auth: { sessionToken: getSessionToken() },
    });

    socket.on('connect', () => {
      set({ connected: true });
    });

    socket.on('disconnect', () => {
      set({ connected: false });
    });

    // 서버 발급 공개 playerId (socket.id와 무관 — 재접속에도 유지됨)
    socket.on('session', (data: { playerId: string }) => {
      set({ myPlayerId: data.playerId });
    });

    socket.on('room-list', (rooms: RoomInfo[]) => {
      set({ rooms });
    });

    // [FIX 3] room-joined 이벤트에서 currentRoomId 설정 (ack 기반)
    // 재접속 복원 시에는 pendingRoomId가 없으므로 서버가 내려주는 roomId를 사용
    socket.on('room-joined', (data: { roomId?: string; gameState: GameState; chatHistory: ChatMessage[] }) => {
      const { pendingRoomId } = get();
      set({
        currentRoomId: data.roomId ?? pendingRoomId,
        pendingRoomId: null,
        gameState: data.gameState,
        chatMessages: data.chatHistory,
        joinError: null,
      });
      clearJoinTimeout();
    });

    socket.on('game-update', (gameState: GameState) => {
      const prev = get().gameState;
      set({ gameState });
      // 스냅샷 diff → 게임 이벤트 발행 (사운드/애니메이션/로그가 구독)
      for (const event of diffGameState(prev, gameState, get().myPlayerId)) {
        emitGameEvent(event);
      }
    });

    socket.on('chat-message', (message: ChatMessage) => {
      set(state => ({
        chatMessages: [...state.chatMessages.slice(-99), message],
      }));
    });

    socket.on('room-created', () => {
      set({ showCreateRoom: false });
    });

    // [FIX 3] 에러 핸들러 — join 실패 시 상태 롤백
    socket.on('error', (data: { message: string }) => {
      set({
        currentRoomId: null,
        pendingRoomId: null,
        gameState: null,
        joinError: data.message,
      });
      clearJoinTimeout();
    });

    set({ socket });
  },

  disconnect: () => {
    const { socket } = get();
    if (socket) {
      socket.disconnect();
      set({ socket: null, connected: false });
    }
  },

  setPlayerName: (name: string) => set({ playerName: name }),

  // [FIX 3] joinRoom은 pendingRoomId만 설정, 실제 roomId는 room-joined에서 확정
  joinRoom: (roomId: string, buyIn: number, seatIndex: number, password?: string) => {
    const { socket, playerName } = get();
    if (!socket) return;
    const avatar = useSettingsStore.getState().profileCharacter;
    socket.emit('join-room', { roomId, playerName, buyIn, seatIndex, avatar, password });
    // pending 상태로 설정 — 서버 room-joined 응답 후 확정
    set({ pendingRoomId: roomId, joinError: null, currentRoomId: roomId });
    // 응답이 없으면(서버 재시작/유실) "연결 중"에 갇히지 않게 롤백
    clearJoinTimeout();
    joinTimeoutTimer = setTimeout(() => {
      joinTimeoutTimer = null;
      if (get().pendingRoomId === roomId && !get().gameState) {
        set({ currentRoomId: null, pendingRoomId: null, joinError: '방 입장에 실패했어요. 잠시 후 다시 시도해 주세요.' });
      }
    }, JOIN_TIMEOUT_MS);
  },

  leaveRoom: () => {
    const { socket } = get();
    if (!socket) return;
    socket.emit('leave-room');
    set({ currentRoomId: null, pendingRoomId: null, gameState: null, chatMessages: [], joinError: null });
  },

  sendAction: (action: ActionType, amount?: number) => {
    const { socket } = get();
    if (!socket) return;
    socket.emit('player-action', { action, amount });
  },

  sendChat: (message: string) => {
    const { socket } = get();
    if (!socket) return;
    socket.emit('send-chat', { message });
  },

  toggleSitOut: () => {
    get().socket?.emit('toggle-sit-out');
  },

  useTimeBank: () => {
    get().socket?.emit('use-time-bank');
  },

  sngFillBots: () => {
    get().socket?.emit('sng-fill-bots');
  },

  createRoom: (config) => {
    const { socket } = get();
    if (!socket) return;
    socket.emit('create-room', {
      ...config,
      maxPlayers: 6,
      turnTime: 8,
    });
  },

  setShowCreateRoom: (show: boolean) => set({ showCreateRoom: show }),
}));
