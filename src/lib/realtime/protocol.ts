import type { Socket } from 'socket.io-client';
import type { ActionType, ChatMessage, GameState } from '../poker/types';
import type {
  ProgressionRewardSummary,
  ProgressionSnapshot,
} from '../progression/types';
import type { ArenaTier } from '../arena/types';

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
  | 'arena-disabled'
  | 'arena-unavailable'
  | 'arena-ineligible'
  | 'arena-busy'
  | 'arena-reserved'
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
  /**
   * SnG 참가 방식 (기본 'wallet'). wallet은 지갑 칩 바이인+수수료 에스크로라 사람 6명 전용 —
   * 봇 채우기는 'practice'(무료, 지갑 무관)에서만 가능하다. 캐시 게임에는 적용되지 않는다.
   */
  economyMode?: 'wallet' | 'practice';
}

export interface LeaveRoomRequest {
  /**
   * exit/sitout은 즉시 퇴장. reserve-*는 나가기 예약 (캐시 전용):
   * reserve-hand=이번 핸드 종료 시, reserve-bb=다음 빅블라인드 직전, reserve-cancel=예약 취소.
   * 예약이 즉시 실행 조건이면(핸드 미진행 등) 서버가 그 자리에서 exit로 처리하고
   * ack data.status='left'로 알린다 — 클라이언트는 이때만 방 상태를 정리한다.
   */
  mode: 'exit' | 'sitout' | 'reserve-hand' | 'reserve-bb' | 'reserve-cancel';
}

/** leave-room reserve-* 요청의 ack data */
export interface LeaveReserveAckData {
  status: 'reserved' | 'cleared' | 'left';
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

/** throw-item 요청 payload — 서버가 itemId를 THROWABLE_MAP으로 재검증한다 */
export interface ThrowItemRequest {
  itemId: string;
  targetPlayerId: string;
}

/**
 * 투척 브로드캐스트. 게임 상태와 무관한 즉발 연출 이벤트라 game-update와 분리.
 * roomId envelope는 game-update와 같은 계약 — 클라이언트는 currentRoomId 일치를 검증한다.
 * seatIndex는 emit 시점 스냅샷이라 수신 시 store 상태와 어긋나도 연출은 그대로 가능.
 */
export interface ThrowableThrownPayload {
  roomId: string;
  /** 연출 dedup/react key용 서버 발급 id */
  throwId: string;
  itemId: string;
  fromPlayerId: string;
  fromSeatIndex: number;
  targetPlayerId: string;
  targetSeatIndex: number;
}

export interface RoomJoinedPayload {
  roomId: string;
  gameState: GameState;
  chatHistory: ChatMessage[];
}

export interface ArenaQueueState {
  status: 'idle' | 'queued' | 'forming' | 'training-offered';
  joinedAt?: number;
}

export interface ArenaResultPayload {
  resultId: string;
  matchId: string;
  training: boolean;
  place: number;
  points: number;
  weeklyRankBefore: number | null;
  weeklyRankAfter: number | null;
  placementGames: number;
  placementMatches: number;
  tier: ArenaTier | null;
}

export interface ArenaStateReplay {
  roomId: string;
  matchId: string;
  training: boolean;
  finished: boolean;
  result: ArenaResultPayload | null;
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
  'throwable-thrown': (data: ThrowableThrownPayload) => void;
  'progression-update': (snapshot: ProgressionSnapshot) => void;
  'reward-summary': (summary: ProgressionRewardSummary) => void;
  'arena-queue-update': (data: ArenaQueueState) => void;
  'arena-training-offered': (
    data: { offerId: string; expiresAt: number },
  ) => void;
  'arena-match-found': (
    data: { matchId: string; training: boolean },
  ) => void;
  'arena-result': (data: ArenaResultPayload) => void;
  'arena-state-replay': (data: ArenaStateReplay) => void;
}

export interface ClientToServerEvents {
  resync: (ack?: AckCallback) => void;
  'get-rooms': (ack?: AckCallback) => void;
  'join-room': (data: unknown, ack?: AckCallback<{ roomId: string }>) => void;
  'leave-room': (data?: unknown, ack?: AckCallback<LeaveReserveAckData>) => void;
  'player-action': (
    data: unknown,
    ack?: AckCallback<{ handNumber: number; actionSeq: number }>,
  ) => void;
  'toggle-sit-out': (ack?: AckCallback) => void;
  'use-time-bank': (ack?: AckCallback) => void;
  'send-chat': (data: unknown, ack?: AckCallback) => void;
  'throw-item': (data: unknown, ack?: AckCallback<{ cooldownMs: number }>) => void;
  'create-room': (data: unknown, ack?: AckCallback<{ roomId: string }>) => void;
  'sng-fill-bots': (ack?: AckCallback) => void;
  'arena-queue-join': (ack?: AckCallback) => void;
  'arena-queue-leave': (ack?: AckCallback) => void;
  'arena-training-accept': (
    data: { offerId: string },
    ack?: AckCallback<{ matchId: string }>,
  ) => void;
  'arena-training-reject': (
    data: { offerId: string },
    ack?: AckCallback,
  ) => void;
}

export type PokerClientSocket = Socket<ServerToClientEvents, ClientToServerEvents>;
