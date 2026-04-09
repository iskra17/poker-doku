'use client';

import { create } from 'zustand';
import { io, Socket } from 'socket.io-client';
import { GameState, ChatMessage, ActionType } from '../poker/types';

interface RoomInfo {
  id: string;
  name: string;
  playerCount: number;
  maxPlayers: number;
  blinds: string;
  status: string;
}

interface GameStore {
  // Connection
  socket: Socket | null;
  connected: boolean;
  playerName: string;
  currentRoomId: string | null;
  pendingRoomId: string | null;
  joinError: string | null;

  // Game
  gameState: (GameState & { turnTimeRemaining?: number }) | null;
  chatMessages: ChatMessage[];
  rooms: RoomInfo[];

  // UI
  showCreateRoom: boolean;

  // Actions
  connect: () => void;
  disconnect: () => void;
  setPlayerName: (name: string) => void;
  joinRoom: (roomId: string, buyIn: number, seatIndex: number) => void;
  leaveRoom: () => void;
  sendAction: (action: ActionType, amount?: number) => void;
  sendChat: (message: string) => void;
  createRoom: (config: { name: string; smallBlind: number; bigBlind: number; minBuyIn: number; maxBuyIn: number }) => void;
  setShowCreateRoom: (show: boolean) => void;
}

export const useGameStore = create<GameStore>((set, get) => ({
  socket: null,
  connected: false,
  playerName: '',
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
    });

    socket.on('connect', () => {
      set({ connected: true });
    });

    socket.on('disconnect', () => {
      set({ connected: false });
    });

    socket.on('room-list', (rooms: RoomInfo[]) => {
      set({ rooms });
    });

    // [FIX 3] room-joined 이벤트에서 currentRoomId 설정 (ack 기반)
    socket.on('room-joined', (data: { gameState: GameState; chatHistory: ChatMessage[] }) => {
      const { pendingRoomId } = get();
      set({
        currentRoomId: pendingRoomId,
        pendingRoomId: null,
        gameState: data.gameState,
        chatMessages: data.chatHistory,
        joinError: null,
      });
    });

    socket.on('game-update', (gameState: GameState & { turnTimeRemaining?: number }) => {
      set({ gameState });
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
  joinRoom: (roomId: string, buyIn: number, seatIndex: number) => {
    const { socket, playerName } = get();
    if (!socket) return;
    socket.emit('join-room', { roomId, playerName, buyIn, seatIndex });
    // pending 상태로 설정 — 서버 room-joined 응답 후 확정
    set({ pendingRoomId: roomId, joinError: null, currentRoomId: roomId });
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

  createRoom: (config) => {
    const { socket } = get();
    if (!socket) return;
    socket.emit('create-room', {
      ...config,
      maxPlayers: 6,
      turnTime: 30,
    });
  },

  setShowCreateRoom: (show: boolean) => set({ showCreateRoom: show }),
}));
