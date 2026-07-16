import type { Socket } from 'socket.io-client';
import type { ActionType, ChatMessage, GameState } from '../poker/types';
import type {
  ProgressionRewardSummary,
  ProgressionSnapshot,
} from '../progression/types';

export type RealtimeErrorCode =
  | 'invalid-payload'
  | 'rate-limited'
  | 'room-not-found'
  | 'room-full'
  | 'bad-password'
  | 'sng-started'
  | 'practice-occupied'
  | 'bot-seat-pending'
  | 'session-replaced'
  | 'stale-state'
  | 'not-your-turn'
  | 'action-rejected'
  | 'join-timeout'
  | 'server-error';

export type RealtimeAck<T = undefined> =
  | { ok: true; data?: T }
  | { ok: false; code: RealtimeErrorCode; message: string };

export type AckCallback<T = undefined> = (ack: RealtimeAck<T>) => void;

export interface RoomListItem {
  id: string;
  name: string;
  playerCount: number;
  maxPlayers: number;
  blinds: string;
  status: string;
  mode?: string;
  locked?: boolean;
  hasPassword?: boolean;
  bigBlind?: number;
  minBuyIn?: number;
  maxBuyIn?: number;
  economyMode?: 'practice' | 'wallet' | 'arena';
  entryBuyIn?: number;
  entryFee?: number;
  difficulty?: 'easy' | 'normal' | 'hard';
  turnTime?: number;
  humanCount?: number;
  tableType?: 'bots' | 'mixed' | 'humans';
  mySeat?: { chips: number; sittingOut: boolean };
}

export interface JoinRoomRequest {
  roomId: string;
  buyIn: number;
  seatIndex: number;
  password?: string;
}

export interface CreateRoomRequest {
  name: string;
  bigBlind: number;
  turnTime: number;
  gameMode: 'cash' | 'sng';
  difficulty: 'easy' | 'normal' | 'hard';
  tableType: 'bots' | 'mixed' | 'humans';
  botCount: number;
  password?: string;
}

export interface LeaveRoomRequest {
  mode: 'exit' | 'sitout';
}

export interface PlayerActionRequest {
  roomId: string;
  action: ActionType;
  amount?: number;
  expectedHandNumber: number;
  expectedActionSeq: number;
}

export interface GameUpdatePayload {
  roomId: string;
  state: GameState;
}

export interface RoomJoinedPayload {
  roomId: string;
  gameState: GameState;
  chatHistory: ChatMessage[];
}

export interface ServerToClientEvents {
  session: (data: { playerId: string }) => void;
  'session-replaced': (data: { message: string }) => void;
  'room-list': (rooms: RoomListItem[]) => void;
  'room-joined': (data: RoomJoinedPayload) => void;
  'room-lost': (data?: { message?: string }) => void;
  'room-created': (data: { roomId: string }) => void;
  'game-update': (data: GameUpdatePayload) => void;
  'game-update-public': (data: GameUpdatePayload) => void;
  'chat-message': (message: ChatMessage) => void;
  'progression-update': (snapshot: ProgressionSnapshot) => void;
  'reward-summary': (summary: ProgressionRewardSummary) => void;
}

export interface ClientToServerEvents {
  resync: (ack?: AckCallback) => void;
  'get-rooms': (ack?: AckCallback) => void;
  'join-room': (data: unknown, ack?: AckCallback<{ roomId: string }>) => void;
  'leave-room': (data?: unknown, ack?: AckCallback) => void;
  'player-action': (
    data: unknown,
    ack?: AckCallback<{ handNumber: number; actionSeq: number }>,
  ) => void;
  'toggle-sit-out': (ack?: AckCallback) => void;
  'use-time-bank': (ack?: AckCallback) => void;
  'send-chat': (data: unknown, ack?: AckCallback) => void;
  'create-room': (data: unknown, ack?: AckCallback<{ roomId: string }>) => void;
  'sng-fill-bots': (ack?: AckCallback) => void;
}

export type PokerClientSocket = Socket<ServerToClientEvents, ClientToServerEvents>;
