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

    socket.on('room-joined', (data: { gameState: GameState; chatHistory: ChatMessage[] }) => {
      set({
        gameState: data.gameState,
        chatMessages: data.chatHistory,
      });
    });

    socket.on('game-update', (gameState: GameState) => {
      set({ gameState });
    });

    socket.on('chat-message', (message: ChatMessage) => {
      set(state => ({
        chatMessages: [...state.chatMessages.slice(-99), message],
      }));
    });

    socket.on('room-created', (data: { roomId: string }) => {
      set({ showCreateRoom: false });
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

  joinRoom: (roomId: string, buyIn: number, seatIndex: number) => {
    const { socket, playerName } = get();
    if (!socket) return;
    socket.emit('join-room', { roomId, playerName, buyIn, seatIndex });
    set({ currentRoomId: roomId });
  },

  leaveRoom: () => {
    const { socket } = get();
    if (!socket) return;
    socket.emit('leave-room');
    set({ currentRoomId: null, gameState: null, chatMessages: [] });
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
