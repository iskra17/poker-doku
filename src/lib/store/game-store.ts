'use client';

import { create } from 'zustand';
import { io } from 'socket.io-client';
import type { ActionType, ChatMessage, GameState } from '../poker/types';
import type {
  CreateTournamentRequest,
  PokerClientSocket,
  RoomListItem,
  TournamentDetailView,
  TournamentSummary,
} from '../realtime/protocol';
import { diffGameState, emitGameEvent } from '../events/game-events';
import { THROWABLE_MAP, THROW_COOLDOWN_MS } from '../throwables/catalog';
import { useSettingsStore } from './settings-store';
import { actionFailureMessage, canSendAction, shouldApplyGameUpdate } from './realtime-state';
import { getBrowserTransportToken } from './transport-token';

export type RoomInfo = RoomListItem;
export type ConnectionState = 'connecting' | 'connected' | 'reconnecting' | 'replaced';

interface PendingAction {
  handNumber: number;
  actionSeq: number;
}

interface CreateRoomConfig {
  name: string;
  smallBlind: number;
  bigBlind: number;
  minBuyIn: number;
  maxBuyIn: number;
  gameMode?: 'cash' | 'sng';
  password?: string;
  turnTime?: number;
  difficulty?: 'easy' | 'normal' | 'hard';
  botCount?: number;
  tableType?: 'bots' | 'mixed' | 'humans';
  /** SnG 참가 방식 — wallet(지갑 바이인, 사람 6명 전용) | practice(무료, 봇 채우기 가능) */
  economyMode?: 'wallet' | 'practice';
}

let joinTimeoutTimer: ReturnType<typeof setTimeout> | null = null;
let actionAckTimer: ReturnType<typeof setTimeout> | null = null;
const JOIN_TIMEOUT_MS = 8_000;
const ACTION_ACK_TIMEOUT_MS = 3_000;

function clearJoinTimeout(): void {
  if (!joinTimeoutTimer) return;
  clearTimeout(joinTimeoutTimer);
  joinTimeoutTimer = null;
}

function clearActionAckTimeout(): void {
  if (!actionAckTimer) return;
  clearTimeout(actionAckTimer);
  actionAckTimer = null;
}

function samePendingAction(a: PendingAction | null, b: PendingAction): boolean {
  return a?.handNumber === b.handNumber && a.actionSeq === b.actionSeq;
}

interface GameStore {
  socket: PokerClientSocket | null;
  connected: boolean;
  connectionState: ConnectionState;
  publicProfileId: string | null;
  playerName: string;
  publicAvatarId: string | null;
  myPlayerId: string | null;
  currentRoomId: string | null;
  pendingRoomId: string | null;
  pendingAction: PendingAction | null;
  joinError: string | null;
  /** 마지막 입장 실패 코드 — 'room-full'이면 로비가 '새 방 만들기' CTA를 함께 노출 */
  joinErrorCode: string | null;
  tableNotice: string | null;

  gameState: GameState | null;
  chatMessages: ChatMessage[];
  rooms: RoomInfo[];
  tournaments: TournamentSummary[];
  showCreateRoom: boolean;
  /** 방금 만든 방 id — 로비가 바이인 모달을 자동으로 띄우는 데 쓰고, 입장/닫기 시 소거 */
  createdRoomId: string | null;

  connect: () => void;
  disconnect: () => void;
  needsFreshConnection: () => boolean;
  setPublicProfile: (profile: { id: string; alias: string; avatarId: string }) => void;
  clearPublicProfile: () => void;
  joinRoom: (roomId: string, buyIn: number, seatIndex: number, password?: string) => void;
  leaveRoom: (mode?: 'exit' | 'sitout') => Promise<boolean>;
  /**
   * 나가기 예약 설정/취소 (캐시 전용). 서버가 즉시 퇴장 조건으로 판정하면(status 'left')
   * leaveRoom과 동일하게 방 상태를 정리하고 로비로 돌아간다.
   */
  reserveLeave: (kind: 'hand' | 'bb' | 'cancel') => Promise<boolean>;
  sendAction: (action: ActionType, amount?: number) => void;
  sendChat: (presetId: string) => void;
  /** 아이템 투척 — 성공 ack 시 onAck(cooldownMs)로 발사대 쿨다운 표시 갱신 */
  throwItem: (itemId: string, targetPlayerId: string, onAck?: (cooldownMs: number) => void) => void;
  toggleSitOut: () => void;
  useTimeBank: () => void;
  sngFillBots: () => void;
  createRoom: (config: CreateRoomConfig) => void;
  setShowCreateRoom: (show: boolean) => void;
  clearCreatedRoom: () => void;

  // --- MTT (멀티테이블 토너먼트) ---
  refreshTournaments: () => void;
  fetchTournamentDetail: (tournamentId: string) => Promise<TournamentDetailView | null>;
  createTournament: (config: CreateTournamentRequest) => Promise<string | null>;
  registerTournament: (tournamentId: string) => Promise<boolean>;
  unregisterTournament: (tournamentId: string) => Promise<boolean>;
  startTournament: (tournamentId: string) => Promise<boolean>;
  /** 디렉터 콘솔 (개설자 전용) — pause/resume/set-level/remove-player/cancel */
  directorTournamentAction: (
    tournamentId: string,
    action:
      | { action: 'pause' | 'resume' | 'cancel' }
      | { action: 'set-level'; level: number }
      | { action: 'remove-player'; playerId: string },
  ) => Promise<boolean>;
  /** 토너먼트 액션 실패 안내 (로비 표시용) */
  tournamentError: string | null;
  clearTournamentError: () => void;
}

export const useGameStore = create<GameStore>((set, get) => ({
  socket: null,
  connected: false,
  connectionState: 'connecting',
  publicProfileId: null,
  playerName: '',
  publicAvatarId: null,
  myPlayerId: null,
  currentRoomId: null,
  pendingRoomId: null,
  pendingAction: null,
  joinError: null,
  joinErrorCode: null,
  tableNotice: null,
  gameState: null,
  chatMessages: [],
  rooms: [],
  tournaments: [],
  showCreateRoom: false,
  createdRoomId: null,
  tournamentError: null,

  connect: () => {
    const existing = get().socket;
    if (existing) {
      if (!existing.connected && get().connectionState !== 'replaced') existing.connect();
      return;
    }

    set({ connectionState: 'connecting' });
    const socket = io({
      transports: ['websocket', 'polling'],
      auth: { sessionToken: getBrowserTransportToken() },
    }) as PokerClientSocket;

    socket.on('connect', () => {
      set({ connected: true, connectionState: 'connected' });
      if (get().currentRoomId) socket.emit('resync');
    });

    socket.on('disconnect', () => {
      clearActionAckTimeout();
      const replaced = get().connectionState === 'replaced';
      set({
        connected: false,
        connectionState: replaced ? 'replaced' : 'reconnecting',
        pendingAction: null,
      });
    });

    socket.on('session-replaced', ({ message }) => {
      clearActionAckTimeout();
      set({
        connected: false,
        connectionState: 'replaced',
        pendingAction: null,
        tableNotice: message,
      });
    });

    socket.on('session', ({ playerId }) => {
      set({ myPlayerId: playerId });
    });

    socket.on('room-list', rooms => {
      set({ rooms });
    });

    socket.on('tournament-list', tournaments => {
      set({ tournaments });
    });

    // 서버 주도 테이블 이동 — 로비를 경유하지 않고 현재 방을 새 테이블로 교체한다.
    // 이전 방의 gameState와 diff를 섞지 않도록 스냅샷·채팅을 통째로 갈아끼운다.
    socket.on('table-move', data => {
      clearActionAckTimeout();
      set({
        currentRoomId: data.roomId,
        pendingRoomId: null,
        pendingAction: null,
        gameState: data.gameState,
        chatMessages: data.chatHistory,
        tableNotice: '🚚 테이블이 이동됐어요! 새 테이블에서 다음 핸드부터 참가합니다.',
      });
    });

    socket.on('room-joined', data => {
      clearJoinTimeout();
      clearActionAckTimeout();
      set({
        currentRoomId: data.roomId,
        pendingRoomId: null,
        pendingAction: null,
        gameState: data.gameState,
        chatMessages: data.chatHistory,
        joinError: null,
        joinErrorCode: null,
        tableNotice: null,
      });
    });

    socket.on('game-update', ({ roomId, state }) => {
      if (!shouldApplyGameUpdate(get().currentRoomId, roomId)) return;
      const prev = get().gameState;
      const pending = get().pendingAction;
      const completed = !!pending
        && (state.handNumber !== pending.handNumber || state.actionSeq > pending.actionSeq);
      if (completed) clearActionAckTimeout();
      set({
        gameState: state,
        ...(completed ? { pendingAction: null } : {}),
      });
      for (const event of diffGameState(prev, state, get().myPlayerId)) emitGameEvent(event);
    });

    socket.on('chat-message', message => {
      if (message.roomId !== get().currentRoomId) return;
      set(state => ({
        chatMessages: [...state.chatMessages.slice(-99), message],
      }));
    });

    socket.on('throwable-thrown', payload => {
      if (payload.roomId !== get().currentRoomId) return; // envelope 검증 (game-update와 동일)
      // 수신자 끄기 설정의 단일 게이트 — 여기서 끊으면 비행/스플랫/표정/사운드 전부 미표시
      if (!useSettingsStore.getState().throwablesEnabled) return;
      if (!THROWABLE_MAP[payload.itemId]) return; // 미지 id 방어
      emitGameEvent({
        type: 'throwable-thrown',
        throwId: payload.throwId,
        itemId: payload.itemId,
        fromPlayerId: payload.fromPlayerId,
        fromSeatIndex: payload.fromSeatIndex,
        targetPlayerId: payload.targetPlayerId,
        targetSeatIndex: payload.targetSeatIndex,
      });
    });

    socket.on('room-created', () => {
      set({ showCreateRoom: false, joinError: null, joinErrorCode: null });
    });

    socket.on('room-lost', data => {
      clearJoinTimeout();
      clearActionAckTimeout();
      set({
        currentRoomId: null,
        pendingRoomId: null,
        pendingAction: null,
        gameState: null,
        chatMessages: [],
        tableNotice: null,
        joinError: data?.message ?? '게임 연결이 초기화되어 로비로 돌아왔어요.',
        joinErrorCode: null,
      });
    });

    set({ socket });
  },

  disconnect: () => {
    const { socket } = get();
    clearJoinTimeout();
    clearActionAckTimeout();
    if (socket) {
      socket.removeAllListeners();
      socket.disconnect();
    }
    set({
      socket: null,
      connected: false,
      connectionState: 'connecting',
      publicProfileId: null,
      playerName: '',
      publicAvatarId: null,
      myPlayerId: null,
      currentRoomId: null,
      pendingRoomId: null,
      pendingAction: null,
      gameState: null,
      chatMessages: [],
      rooms: [],
      tournaments: [],
      joinError: null,
      joinErrorCode: null,
      tableNotice: null,
      showCreateRoom: false,
      tournamentError: null,
    });
  },

  needsFreshConnection: () => get().connectionState === 'replaced',

  setPublicProfile: profile => set({
    publicProfileId: profile.id,
    playerName: profile.alias,
    publicAvatarId: profile.avatarId,
  }),

  clearPublicProfile: () => set({
    publicProfileId: null,
    playerName: '',
    publicAvatarId: null,
    myPlayerId: null,
  }),

  joinRoom: (roomId, buyIn, seatIndex, password) => {
    const { socket } = get();
    if (!socket?.connected) return;
    // 입장을 시도했으면 생성 방 자동 오픈은 소비된 것 — 로비 복귀 시 모달이 다시 뜨지 않게
    set({ pendingRoomId: roomId, joinError: null, joinErrorCode: null, createdRoomId: null });
    clearJoinTimeout();
    joinTimeoutTimer = setTimeout(() => {
      joinTimeoutTimer = null;
      if (get().pendingRoomId !== roomId) return;
      set({
        pendingRoomId: null,
        joinError: '방 입장 응답을 확인하지 못했어요. 잠시 후 다시 시도해 주세요.',
        joinErrorCode: null,
      });
    }, JOIN_TIMEOUT_MS);

    socket.emit('join-room', {
      roomId,
      buyIn,
      seatIndex,
      password,
    }, ack => {
      if (ack.ok || get().pendingRoomId !== roomId) return;
      clearJoinTimeout();
      set({ pendingRoomId: null, joinError: ack.message, joinErrorCode: ack.code });
    });
  },

  leaveRoom: (mode = 'exit') => {
    const { socket } = get();
    if (!socket?.connected) return Promise.resolve(false);
    // emit 경계 방어 — onClick 등에서 이벤트 객체가 인자로 새어 들어오면 순환 참조 payload가
    // socket.io hasBinary 무한 재귀를 일으켜 emit 자체가 죽는다. 리터럴 외 값은 'exit'로 강제.
    const safeMode = mode === 'sitout' ? 'sitout' : 'exit';
    return new Promise(resolve => {
      socket.emit('leave-room', { mode: safeMode }, ack => {
        if (!ack.ok) {
          set({ tableNotice: ack.message });
          resolve(false);
          return;
        }
        clearJoinTimeout();
        clearActionAckTimeout();
        set({
          currentRoomId: null,
          pendingRoomId: null,
          pendingAction: null,
          gameState: null,
          chatMessages: [],
          joinError: null,
          joinErrorCode: null,
          tableNotice: null,
        });
        resolve(true);
      });
    });
  },

  reserveLeave: kind => {
    const { socket } = get();
    if (!socket?.connected) return Promise.resolve(false);
    const mode = kind === 'hand'
      ? 'reserve-hand' as const
      : kind === 'bb' ? 'reserve-bb' as const : 'reserve-cancel' as const;
    return new Promise(resolve => {
      socket.emit('leave-room', { mode }, ack => {
        if (!ack.ok) {
          set({ tableNotice: ack.message });
          resolve(false);
          return;
        }
        // 서버가 즉시 퇴장으로 처리한 경우(기다릴 핸드/블라인드 없음)만 방 상태 정리
        if (ack.data?.status === 'left') {
          clearJoinTimeout();
          clearActionAckTimeout();
          set({
            currentRoomId: null,
            pendingRoomId: null,
            pendingAction: null,
            gameState: null,
            chatMessages: [],
            joinError: null,
            joinErrorCode: null,
            tableNotice: null,
          });
        }
        resolve(true);
      });
    });
  },

  sendAction: (action, amount) => {
    const { socket, currentRoomId, gameState, pendingAction } = get();
    if (
      !socket
      || !currentRoomId
      || !gameState
      || !canSendAction(socket.connected, !!pendingAction)
    ) return;

    const version = {
      handNumber: gameState.handNumber,
      actionSeq: gameState.actionSeq,
    };
    set({ pendingAction: version, tableNotice: null });
    clearActionAckTimeout();
    actionAckTimer = setTimeout(() => {
      actionAckTimer = null;
      if (!samePendingAction(get().pendingAction, version)) return;
      set({
        pendingAction: null,
        tableNotice: actionFailureMessage('join-timeout'),
      });
      if (socket.connected) socket.emit('resync');
    }, ACTION_ACK_TIMEOUT_MS);

    socket.emit('player-action', {
      roomId: currentRoomId,
      action,
      amount,
      expectedHandNumber: version.handNumber,
      expectedActionSeq: version.actionSeq,
    }, ack => {
      if (!samePendingAction(get().pendingAction, version)) return;
      clearActionAckTimeout();
      if (ack.ok) {
        set({ pendingAction: null, tableNotice: null });
      } else {
        set({ pendingAction: null, tableNotice: actionFailureMessage(ack.code) });
        if (ack.code === 'stale-state' && socket.connected) socket.emit('resync');
      }
    });
  },

  sendChat: presetId => {
    const { socket, currentRoomId } = get();
    if (!socket?.connected || !currentRoomId) return;
    socket.emit('send-chat', { presetId });
  },

  throwItem: (itemId, targetPlayerId, onAck) => {
    const { socket, currentRoomId } = get();
    if (!socket?.connected || !currentRoomId) return;
    // 연출은 낙관적 실행 없이 서버 에코(throwable-thrown)로만 — 쿨다운 거절 시 유령 연출 방지
    socket.emit('throw-item', { itemId, targetPlayerId }, ack => {
      if (ack.ok) onAck?.(ack.data?.cooldownMs ?? THROW_COOLDOWN_MS);
      else set({ tableNotice: ack.message });
    });
  },

  toggleSitOut: () => {
    const { socket, currentRoomId } = get();
    if (!socket?.connected || !currentRoomId) return;
    socket.emit('toggle-sit-out', ack => {
      if (!ack.ok) set({ tableNotice: ack.message });
    });
  },

  useTimeBank: () => {
    const { socket, currentRoomId } = get();
    if (!socket?.connected || !currentRoomId) return;
    socket.emit('use-time-bank', ack => {
      if (!ack.ok) set({ tableNotice: ack.message });
    });
  },

  sngFillBots: () => {
    const { socket, currentRoomId } = get();
    if (!socket?.connected || !currentRoomId) return;
    socket.emit('sng-fill-bots', ack => {
      if (!ack.ok) set({ tableNotice: ack.message });
    });
  },

  createRoom: config => {
    const { socket } = get();
    if (!socket?.connected) return;
    socket.emit('create-room', {
      name: config.name,
      bigBlind: config.bigBlind,
      turnTime: config.turnTime ?? 15,
      gameMode: config.gameMode ?? 'cash',
      difficulty: config.difficulty ?? 'normal',
      tableType: config.tableType ?? 'mixed',
      botCount: config.botCount ?? 2,
      economyMode: config.economyMode ?? 'wallet',
      password: config.password,
    }, ack => {
      if (ack.ok) {
        // 방금 만든 방의 바이인 모달을 로비가 바로 띄우도록 id를 남긴다
        set({ showCreateRoom: false, joinError: null, joinErrorCode: null, createdRoomId: ack.data?.roomId ?? null });
      } else {
        set({ joinError: ack.message });
      }
    });
  },

  setShowCreateRoom: showCreateRoom => set({ showCreateRoom }),

  clearCreatedRoom: () => set({ createdRoomId: null }),

  // --- MTT (멀티테이블 토너먼트) ---

  refreshTournaments: () => {
    const { socket } = get();
    if (!socket?.connected) return;
    socket.emit('get-tournaments', ack => {
      if (ack.ok && ack.data) set({ tournaments: ack.data });
    });
  },

  fetchTournamentDetail: tournamentId => {
    const { socket } = get();
    if (!socket?.connected) return Promise.resolve(null);
    return new Promise(resolve => {
      socket.emit('get-tournament', { tournamentId }, ack => {
        resolve(ack.ok ? ack.data ?? null : null);
      });
    });
  },

  createTournament: config => {
    const { socket } = get();
    if (!socket?.connected) return Promise.resolve(null);
    return new Promise(resolve => {
      socket.emit('create-tournament', config, ack => {
        if (ack.ok) {
          set({ tournamentError: null });
          resolve(ack.data?.tournamentId ?? null);
        } else {
          set({ tournamentError: ack.message });
          resolve(null);
        }
      });
    });
  },

  registerTournament: tournamentId => {
    const { socket } = get();
    if (!socket?.connected) return Promise.resolve(false);
    return new Promise(resolve => {
      socket.emit('register-tournament', { tournamentId }, ack => {
        set({ tournamentError: ack.ok ? null : ack.message });
        resolve(ack.ok);
      });
    });
  },

  unregisterTournament: tournamentId => {
    const { socket } = get();
    if (!socket?.connected) return Promise.resolve(false);
    return new Promise(resolve => {
      socket.emit('unregister-tournament', { tournamentId }, ack => {
        set({ tournamentError: ack.ok ? null : ack.message });
        resolve(ack.ok);
      });
    });
  },

  startTournament: tournamentId => {
    const { socket } = get();
    if (!socket?.connected) return Promise.resolve(false);
    return new Promise(resolve => {
      socket.emit('start-tournament', { tournamentId }, ack => {
        set({ tournamentError: ack.ok ? null : ack.message });
        resolve(ack.ok);
      });
    });
  },

  directorTournamentAction: (tournamentId, action) => {
    const { socket } = get();
    if (!socket?.connected) return Promise.resolve(false);
    return new Promise(resolve => {
      socket.emit('tournament-admin', { tournamentId, ...action }, ack => {
        set({ tournamentError: ack.ok ? null : ack.message });
        resolve(ack.ok);
      });
    });
  },

  clearTournamentError: () => set({ tournamentError: null }),
}));
