import { Server, Socket } from 'socket.io';
import { RoomManager } from './room-manager';
import { SessionManager, GRACE_MS } from './session-manager';
import { RoomConfig, Player, ActionType, RoomDifficulty, TableType } from '../lib/poker/types';
import { getCharacterById } from '../lib/characters';
import { CHAT_PRESET_MAP } from '../lib/chat/presets';
import { SNG_BLIND_SCHEDULE, SNG_STARTING_STACK } from '../lib/poker/blind-schedule';
import { eventLog, tokenHint } from './event-log';
import type {
  AckCallback,
  ClientToServerEvents,
  ServerToClientEvents,
} from '../lib/realtime/protocol';
import {
  isRecord,
  parseCreateRoomRequest,
  parseJoinRoomRequest,
  parseLeaveRoomRequest,
  parsePlayerActionRequest,
} from './socket-payload';

const VALID_DIFFICULTIES: RoomDifficulty[] = ['easy', 'normal', 'hard'];
const VALID_TABLE_TYPES: TableType[] = ['bots', 'mixed', 'humans'];
const MAX_ROOMS = 30; // 운영 가드: 동시 존재 가능한 방 수 상한
const MIN_BUYIN_BB = 40; // 캐시 게임 바이인 하한 (BB 배수)
const MAX_BUYIN_BB = 200; // 캐시 게임 바이인 상한 (BB 배수)
// 플러딩 방지 쿨다운 (연결당) — 로비/채팅 스팸으로 방 상한을 소진하거나 채팅을 도배하는 것 차단
const ROOM_CREATE_COOLDOWN_MS = 5_000;
const CHAT_COOLDOWN_MS = 700;

export interface SocketRuntimeOptions {
  createDefaultRooms?: boolean;
  sweepIntervalMs?: number;
  graceMs?: number;
}

export interface SocketRuntime {
  roomManager: RoomManager;
  sessions: SessionManager;
  close: () => void;
}

export function setupSocketHandlers(
  io: Server<ClientToServerEvents, ServerToClientEvents>,
  options: SocketRuntimeOptions = {},
): SocketRuntime {
  const {
    createDefaultRooms = true,
    sweepIntervalMs = 60_000,
    graceMs = GRACE_MS,
  } = options;
  const sessions = new SessionManager();

  // 방 목록은 소켓별로 개인화해 보낸다 — 보존 중인 내 좌석(mySeat)이 실려야
  // 로비에서 바이인/비밀번호 없이 '게임 복귀'가 가능하다.
  function broadcastRoomList(): void {
    for (const [socketId, sock] of io.sockets.sockets) {
      sock.emit('room-list', roomManager.getRoomList(sessions.getBySocketId(socketId)?.playerId));
    }
  }

  const roomManager = new RoomManager(
    // onUpdate
    (roomId, engine) => {
      const turnTimeRemaining = roomManager.getTurnTimeRemaining(roomId);
      const players = engine.state.players;
      for (const player of players) {
        if (player.type === 'human') {
          const targetSession = sessions.getByPlayerId(player.id);
          if (!targetSession?.socketId || targetSession.roomId !== roomId) continue;
          const socket = io.sockets.sockets.get(targetSession.socketId);
          if (socket) {
            socket.emit('game-update', {
              roomId,
              state: {
                ...engine.getPublicState(player.id),
                turnTimeRemaining,
              },
            });
          }
        }
      }
      // Also broadcast to spectators / general room
      io.to(roomId).emit('game-update-public', {
        roomId,
        state: {
          ...engine.getPublicState(),
          turnTimeRemaining,
        },
      });
    },
    // onChat
    (roomId, message) => {
      io.to(roomId).emit('chat-message', message);
    },
    // onRoomsChanged — 서버 내부 자동 정리(미납 블라인드/방치 회수)도 로비에 즉시 반영
    () => broadcastRoomList(),
  );

  // Create default rooms — persistent: 유휴 정리 대상에서 제외. 바이인 범위는 40~200BB 표준
  // 봇 전용 연습 방: 휴먼 1명 제한 — 다른 사람 방해 없이 봇들과 연습 (도장의 입구)
  if (createDefaultRooms) {
    roomManager.createRoom({
      name: 'Practice Dojo',
      smallBlind: 10,
      bigBlind: 20,
      minBuyIn: 20 * MIN_BUYIN_BB,
      maxBuyIn: 20 * MAX_BUYIN_BB,
      maxPlayers: 6,
      turnTime: 20,
      difficulty: 'easy',
      botCount: 5,
      tableType: 'bots',
    }, true);

    // 초보 방: 순한 봇 + 여유 턴 시간 (난이도 사다리의 입구)
    roomManager.createRoom({
      name: 'Sakura Lounge',
      smallBlind: 10,
      bigBlind: 20,
      minBuyIn: 20 * MIN_BUYIN_BB,
      maxBuyIn: 20 * MAX_BUYIN_BB,
      maxPlayers: 6,
      turnTime: 20,
      difficulty: 'easy',
      botCount: 5, // 솔로 쇼케이스 방 — 캐릭터 전원 등장 (휴먼이 오면 봇이 양보)
      tableType: 'mixed',
    }, true);

    roomManager.createRoom({
      name: "Dragon's Den",
      smallBlind: 25,
      bigBlind: 50,
      minBuyIn: 50 * MIN_BUYIN_BB,
      maxBuyIn: 50 * MAX_BUYIN_BB,
      maxPlayers: 6,
      turnTime: 8,
      difficulty: 'normal',
      botCount: 5,
      tableType: 'mixed',
    }, true);

    roomManager.createRoom({
      name: 'Moonlight Table',
      smallBlind: 50,
      bigBlind: 100,
      minBuyIn: 100 * MIN_BUYIN_BB,
      maxBuyIn: 100 * MAX_BUYIN_BB,
      maxPlayers: 6,
      turnTime: 8,
      difficulty: 'hard',
      botCount: 5,
      tableType: 'mixed',
    }, true);
  }

  // 유저 생성 방 유휴 정리: 휴먼이 없는 방을 10분 후 삭제 (기본 방 제외)
  const sweepTimer = sweepIntervalMs > 0
    ? setInterval(() => {
        const removed = roomManager.sweepIdleRooms();
        if (removed > 0) {
          broadcastRoomList();
        }
      }, sweepIntervalMs)
    : null;

  /** 방의 좌석 구성 스냅샷 — 중복 좌석/유령 좌석 역추적의 핵심 단서 */
  function seatSnapshot(roomId: string): Array<Record<string, unknown>> {
    const room = roomManager.getRoom(roomId);
    if (!room) return [];
    return room.engine.state.players.map(p => ({
      id: p.id,
      name: p.name,
      type: p.type,
      seat: p.seatIndex,
      chips: p.chips,
      status: p.status,
      ...(p.pendingRemoval ? { pendingRemoval: true } : {}),
      ...(p.isDisconnected ? { disconnected: true } : {}),
      ...(p.sitOutNext ? { sitOutNext: true } : {}),
    }));
  }

  io.on('connection', (socket: Socket<ClientToServerEvents, ServerToClientEvents>) => {
    const rawToken = socket.handshake.auth?.sessionToken;
    const { session, replacedSocketId } = sessions.resolve(rawToken, socket.id);
    if (replacedSocketId) {
      const previousSocket = io.sockets.sockets.get(replacedSocketId);
      previousSocket?.emit('session-replaced', {
        message: '다른 탭에서 게임을 열어 이 연결을 종료했어요.',
      });
      previousSocket?.disconnect(true);
    }
    console.log(`Player connected: socket=${socket.id} player=${session.playerId}`);
    // 세션 재사용 여부가 중복 좌석 조사의 출발점 — 같은 사람이 새 토큰으로 들어오면
    // 새 playerId가 발급되어 이전 좌석이 유령으로 남는다.
    eventLog.log('connect', {
      playerId: session.playerId,
      data: {
        socketId: socket.id,
        tokenHint: tokenHint(typeof rawToken === 'string' ? rawToken : undefined),
        hadToken: typeof rawToken === 'string' && rawToken.length > 0,
        resumedRoomId: session.roomId ?? null,
      },
    });

    // 연결당 레이트리밋 상태 (재접속 시 초기화 — 단순 플러딩 방지용)
    let lastRoomCreateAt = 0;
    let lastChatAt = 0;
    const ownsSession = (): boolean => sessions.isCurrentSocket(session.playerId, socket.id);
    const ensureOwnership = <T>(ack?: AckCallback<T>): boolean => {
      if (ownsSession()) return true;
      ack?.({
        ok: false,
        code: 'session-replaced',
        message: '이 연결은 더 이상 현재 게임을 제어하지 않아요.',
      });
      return false;
    };
    const invalidPayload = <T>(ack?: AckCallback<T>): void => {
      ack?.({
        ok: false,
        code: 'invalid-payload',
        message: '요청 형식이 올바르지 않아요.',
      });
    };
    const commitRoomMembership = (roomId: string): void => {
      const previousRoomId = session.roomId;
      if (previousRoomId && previousRoomId !== roomId) {
        roomManager.leaveRoom(previousRoomId, session.playerId);
        socket.leave(previousRoomId);
      }
      roomManager.leaveAllSeatsExcept(session.playerId, roomId);
      session.roomId = roomId;
      socket.join(roomId);
    };

    // 클라이언트에 공개 playerId 통지 (히어로 식별용)
    socket.emit('session', { playerId: session.playerId });

    // Send room list — 보존 중인 내 좌석(mySeat) 포함 개인화
    socket.emit('room-list', roomManager.getRoomList(session.playerId));

    // 재접속 복원: 세션에 방이 남아 있고 좌석이 유지되어 있으면 그대로 복귀.
    // 방/좌석이 사라졌으면(유휴 정리·grace 만료) room-lost로 클라이언트를 로비로 돌려보낸다.
    const restoreOrEvict = (): void => {
      if (!session.roomId) return;
      const room = roomManager.getRoom(session.roomId);
      const seated = room?.engine.state.players.find(
        p => p.id === session.playerId && !p.pendingRemoval,
      );
      if (room && seated) {
        socket.join(session.roomId);
        roomManager.handleReconnect(session.roomId, session.playerId);
        socket.emit('room-joined', {
          roomId: session.roomId,
          gameState: {
            ...room.engine.getPublicState(session.playerId),
            turnTimeRemaining: roomManager.getTurnTimeRemaining(session.roomId),
          },
          chatHistory: roomManager.getChatHistory(session.roomId),
        });
      } else {
        session.roomId = null;
        socket.emit('room-lost', { message: '게임이 종료되어 로비로 돌아왔어요.' });
      }
    };
    restoreOrEvict();

    // 클라이언트 주도 재동기화 — 소켓 재연결 직후 방 상태 확인.
    // 서버가 재시작되면 세션이 초기화되어(roomId 없음) room-lost가 응답된다 —
    // 이게 없으면 클라이언트가 죽은 방의 마지막 스냅샷을 든 채 얼어붙는다 (와이프 화면 버그).
    socket.on('resync', (ack?: AckCallback) => {
      if (!ensureOwnership(ack)) return;
      if (session.roomId) {
        restoreOrEvict();
      } else {
        socket.emit('room-lost', { message: '서버가 재시작되어 게임이 초기화됐어요. 다시 입장해 주세요.' });
      }
      ack?.({ ok: true });
    });

    // Join room
    socket.on('join-room', (input: unknown, ack?: AckCallback<{ roomId: string }>) => {
      if (!ensureOwnership(ack)) return;
      const parsed = parseJoinRoomRequest(input);
      if (!parsed.ok) {
        invalidPayload(ack);
        return;
      }
      const data = parsed.value;
      const { roomId, buyIn, seatIndex } = data;
      const playerName = data.playerName;
      // 프로필 캐릭터 — 등록된 캐릭터 id만 허용 (그 외엔 기본 'player')
      const avatar = data.avatar && getCharacterById(data.avatar) ? data.avatar : 'player';

      const room = roomManager.getRoom(roomId);
      if (!room) {
        eventLog.log('join-room:reject', {
          roomId, playerId: session.playerId, data: { reason: 'room-not-found' },
        });
        ack?.({ ok: false, code: 'room-not-found', message: '방을 찾을 수 없어요.' });
        return;
      }

      eventLog.log('join-room:request', {
        roomId,
        playerId: session.playerId,
        data: {
          name: playerName,
          buyIn: Number(buyIn) || 0,
          seatIndex,
          mode: room.config.gameMode ?? 'cash',
          tableType: room.config.tableType ?? 'mixed',
          // 요청 시점의 좌석 구성 — 같은 이름/사람이 두 좌석을 잡는 순간을 여기서 짚을 수 있다
          seats: seatSnapshot(roomId),
        },
      });

      // 캐시 게임 바이인은 방 범위(40~200BB)로 검증/클램프 (신규 입장·리바이 공용)
      const safeBuyIn = Math.min(
        Math.max(Math.floor(Number(buyIn) || room.config.minBuyIn), room.config.minBuyIn),
        room.config.maxBuyIn,
      );

      // 멱등/재입장 처리: 같은 playerId가 이미 좌석에 있으면 새 Player를 만들지 않는다.
      // 핸드 중 이탈은 splice 대신 pendingRemoval 마킹만 하므로, 그 좌석을 되살려
      // 동일 id의 Player가 둘 생기는 것(불변식 위반 + 새 스택 리바이 악용)을 막는다.
      const seated = room.engine.state.players.find(p => p.id === session.playerId);
      if (seated) {
        const startedTournament = !!room.engine.state.tournament && room.engine.state.tournament.entrants > 0;
        // 시작된 토너먼트에서 이탈은 탈락 확정이므로 되살리지 않고 아래 lock 체크로 넘긴다
        if (!seated.pendingRemoval || !startedTournament) {
          if (seated.pendingRemoval) {
            // 예약 취소 — 좌석 유지. 칩이 남아 있으면 그대로 (새 바이인 무시)
            seated.pendingRemoval = false;
            if (seated.chips > 0 && !seated.isDisconnected && !room.engine.state.isHandInProgress) {
              seated.status = 'waiting';
            }
          }
          // 캐시 파산 좌석 복귀는 새 바이인으로 리바이 — 0칩 좌석에 고착되는 문제 방지
          // (핸드 중이면 다음 핸드부터 딜인 — startHand가 chips>0을 waiting으로 되살린다)
          if (room.config.gameMode !== 'sng' && seated.chips <= 0) {
            seated.chips = safeBuyIn;
            if (!room.engine.state.isHandInProgress && !seated.isDisconnected) {
              seated.status = 'waiting';
            }
          }
          // 자리비움으로 떠났던 좌석 복귀 — 좌석은 자리비움 그대로 두고(본인이 '게임 복귀'로 참여),
          // 방치 회수 유예만 취소한다. (자동 복귀 대신 명시 복귀 — UI 안내와 일치)
          roomManager.handleSeatRejoin(roomId, session.playerId);
          eventLog.log('join-room:rejoin', {
            roomId,
            playerId: session.playerId,
            data: { seat: seated.seatIndex, chips: seated.chips, status: seated.status, sitOutNext: !!seated.sitOutNext },
          });
          commitRoomMembership(roomId);
          socket.emit('room-joined', {
            roomId,
            gameState: {
              ...room.engine.getPublicState(session.playerId),
              turnTimeRemaining: roomManager.getTurnTimeRemaining(roomId),
            },
            chatHistory: roomManager.getChatHistory(roomId),
          });
          ack?.({ ok: true, data: { roomId } });
          // 리바이/복귀로 게임을 재개할 수 있으면 시작 (다른 좌석에도 상태 반영)
          roomManager.resumeRoom(roomId);
          return;
        }
      }

      // 비밀번호 방: 재입장(위 멱등 처리)이 아닌 신규 입장은 비밀번호 검증
      if (room.config.password && String(data.password ?? '') !== room.config.password) {
        eventLog.log('join-room:reject', { roomId, playerId: session.playerId, data: { reason: 'bad-password' } });
        ack?.({ ok: false, code: 'bad-password', message: '비밀번호가 틀렸어요.' });
        return;
      }

      // 시트앤고: 이미 시작된(또는 끝난) 토너먼트에는 참가 불가
      const tournament = room.engine.state.tournament;
      if (tournament && tournament.entrants > 0) {
        eventLog.log('join-room:reject', { roomId, playerId: session.playerId, data: { reason: 'sng-started' } });
        ack?.({ ok: false, code: 'sng-started', message: '이미 시작된 Sit & Go입니다.' });
        return;
      }

      // 봇 전용 연습 테이블: 휴먼 1명만 (재입장은 위 멱등 경로가 처리)
      if (
        room.config.tableType === 'bots'
        && room.engine.state.players.some(p => p.type === 'human' && !p.pendingRemoval && p.id !== session.playerId)
      ) {
        eventLog.log('join-room:reject', { roomId, playerId: session.playerId, data: { reason: 'practice-occupied' } });
        ack?.({
          ok: false,
          code: 'practice-occupied',
          message: '혼자 연습하는 테이블이에요 — 지금은 다른 플레이어가 연습 중입니다.',
        });
        return;
      }

      // Find first available seat — 요청 좌석은 0~5 정수만 유효, 그 외/점유 시 빈 자리 배정
      const requestedSeat = Number.isInteger(seatIndex) && seatIndex >= 0 && seatIndex <= 5 ? seatIndex : -1;
      let assignedSeat = requestedSeat;
      const occupiedSeats = new Set(room.engine.state.players.map(p => p.seatIndex));
      if (requestedSeat < 0 || occupiedSeats.has(requestedSeat)) {
        for (let s = 0; s < 6; s++) {
          if (!occupiedSeats.has(s)) {
            assignedSeat = s;
            break;
          }
        }
      }
      // 만석이면 봇이 휴먼에게 자리를 양보한다.
      // 핸드 진행 중 splice는 인덱스를 밀어 핸드를 깨뜨리므로, 핸드 사이에만 즉시 제거.
      if (room.engine.state.players.length >= 6) {
        if (room.engine.state.isHandInProgress) {
          const bot = room.engine.state.players.find(p => p.type === 'bot' && !p.pendingRemoval);
          if (!bot) {
            ack?.({ ok: false, code: 'room-full', message: '자리가 모두 찼어요 — 다른 테이블을 찾아보세요.' });
            return;
          }
          // leaveRoom 경유: 폴드로 핸드가 끝나는 경우의 승자 처리까지 위임
          roomManager.leaveRoom(roomId, bot.id);
          ack?.({
            ok: false,
            code: 'bot-seat-pending',
            message: `${bot.name}이(가) 이번 핸드를 끝으로 자리를 비워줘요 — 몇 초 후 다시 참가해 주세요!`,
          });
          return;
        }
        // 핸드 사이: 예약된 봇(pendingRemoval) 포함 아무 봇이나 즉시 정리하고 그 자리에 착석
        const bot = room.engine.state.players.find(p => p.type === 'bot');
        if (!bot) {
          ack?.({ ok: false, code: 'room-full', message: '자리가 모두 찼어요 — 다른 테이블을 찾아보세요.' });
          return;
        }
        room.engine.processLeave(bot.id);
        assignedSeat = bot.seatIndex;
      }

      // 빈 좌석 탐색이 실패하면 assignedSeat이 -1로 남는다 — 그대로 앉히면 좌석 좌표가 없는
      // 유령 플레이어가 생겨(팟에는 참여) 테이블이 어그러진다. 여기서 끊는다.
      if (assignedSeat < 0 || assignedSeat > 5) {
        eventLog.log('join-room:reject', {
          roomId, playerId: session.playerId,
          data: { reason: 'no-seat', assignedSeat, seats: seatSnapshot(roomId) },
        });
        ack?.({ ok: false, code: 'room-full', message: '자리를 배정하지 못했어요 — 잠시 후 다시 시도해 주세요.' });
        return;
      }

      const player: Player = {
        id: session.playerId,
        name: playerName,
        type: 'human',
        avatar,
        // 시트앤고는 바이인 무관 고정 스택
        chips: room.config.gameMode === 'sng' ? (room.config.startingStack ?? safeBuyIn) : safeBuyIn,
        seatIndex: assignedSeat,
        holeCards: [],
        currentBet: 0,
        totalContributed: 0,
        status: 'waiting',
        hasActed: false,
        timeBankChips: 1, // 입장 시 기본 타임칩 1개
      };

      const success = roomManager.joinRoom(roomId, player);
      eventLog.log(success ? 'join-room:seated' : 'join-room:reject', {
        roomId,
        playerId: session.playerId,
        data: success
          ? { name: playerName, seat: assignedSeat, chips: player.chips, seats: seatSnapshot(roomId) }
          : { reason: 'engine-rejected', seat: assignedSeat, seats: seatSnapshot(roomId) },
      });
      if (success) {
        commitRoomMembership(roomId);
        socket.emit('room-joined', {
          roomId,
          gameState: room.engine.getPublicState(session.playerId),
          chatHistory: roomManager.getChatHistory(roomId),
        });
        ack?.({ ok: true, data: { roomId } });
        // Update room list for all
        broadcastRoomList();
      } else {
        ack?.({ ok: false, code: 'room-full', message: '방에 입장할 수 없어요.' });
      }
    });

    // Leave room — mode 'sitout'이면 좌석/칩을 유지한 채 자리비움으로 떠남 (재입장 시 복귀)
    socket.on('leave-room', (input?: unknown, ack?: AckCallback) => {
      if (!ensureOwnership(ack)) return;
      const parsed = parseLeaveRoomRequest(input);
      if (!parsed.ok) {
        invalidPayload(ack);
        return;
      }
      const data = parsed.value;
      if (session.roomId) {
        const roomId = session.roomId;
        eventLog.log('leave-room', {
          roomId, playerId: session.playerId,
          data: { mode: data.mode, seats: seatSnapshot(roomId) },
        });
        socket.leave(roomId);
        if (data.mode === 'sitout') {
          roomManager.sitOutAndLeave(roomId, session.playerId);
        } else {
          roomManager.leaveRoom(roomId, session.playerId);
        }
        session.roomId = null;
        broadcastRoomList();
      }
      ack?.({ ok: true });
    });

    // Player action
    socket.on('player-action', (input: unknown, ack?: AckCallback<{ handNumber: number; actionSeq: number }>) => {
      if (!ensureOwnership(ack)) return;
      const parsed = parsePlayerActionRequest(input);
      if (!parsed.ok) {
        invalidPayload(ack);
        return;
      }
      const data = parsed.value;
      if (!session.roomId) {
        ack?.({ ok: false, code: 'action-rejected', message: '현재 참가 중인 방이 없어요.' });
        return;
      }

      const roomId = session.roomId;
      if (data.roomId !== roomId) {
        ack?.({ ok: false, code: 'stale-state', message: '현재 테이블 상태가 바뀌었어요.' });
        return;
      }
      const room = roomManager.getRoom(roomId);
      const me = room?.engine.state.players.find(p => p.id === session.playerId);
      const st = room?.engine.state;
      if (
        !st
        || st.handNumber !== data.expectedHandNumber
        || st.actionSeq !== data.expectedActionSeq
      ) {
        ack?.({ ok: false, code: 'stale-state', message: '상태가 바뀌어 액션을 다시 선택해 주세요.' });
        return;
      }
      // 액션 처리 전 스냅샷 — 거부 사유를 재현하려면 '그 시점' 상태여야 한다
      const before = room && me && st
        ? {
            street: st.street,
            handNumber: st.handNumber,
            myChips: me.chips,
            myBet: me.currentBet,
            tableBet: st.currentBet,
            minRaise: st.minRaise,
            isMyTurn: st.players[st.activePlayerIndex]?.id === session.playerId,
            valid: room.engine.getValidActions(me),
          }
        : { noSeat: true };

      const accepted = roomManager.processPlayerAction(
        roomId,
        session.playerId,
        data.action as ActionType,
        typeof data.amount === 'number' ? data.amount : 0,
      );
      // 거부된 액션(accepted=false)이 곧 "버튼을 눌렀는데 아무 일도 안 일어남"의 정체다 —
      // 클라 버튼 조건이 서버 getValidActions와 어긋나면 여기 남는다.
      eventLog.log(accepted ? 'player-action' : 'player-action:rejected', {
        roomId,
        playerId: session.playerId,
        data: {
          action: data.action,
          amount: typeof data.amount === 'number' ? data.amount : 0,
          ...before,
        },
      });
      if (!accepted || !room) {
        ack?.({ ok: false, code: 'action-rejected', message: '지금은 그 액션을 실행할 수 없어요.' });
        return;
      }
      ack?.({
        ok: true,
        data: {
          handNumber: room.engine.state.handNumber,
          actionSeq: room.engine.state.actionSeq,
        },
      });
    });

    // 자리비움 토글
    socket.on('toggle-sit-out', (ack?: AckCallback) => {
      if (!ensureOwnership(ack)) return;
      if (!session.roomId) {
        ack?.({ ok: false, code: 'action-rejected', message: '현재 참가 중인 방이 없어요.' });
        return;
      }
      roomManager.toggleSitOut(session.roomId, session.playerId);
      ack?.({ ok: true });
    });

    // 타임칩 사용
    socket.on('use-time-bank', (ack?: AckCallback) => {
      if (!ensureOwnership(ack)) return;
      if (!session.roomId) {
        ack?.({ ok: false, code: 'action-rejected', message: '현재 참가 중인 방이 없어요.' });
        return;
      }
      roomManager.useTimeBank(session.roomId, session.playerId);
      ack?.({ ok: true });
    });

    // Chat message
    socket.on('send-chat', (input: unknown, ack?: AckCallback) => {
      if (!ensureOwnership(ack)) return;
      if (!isRecord(input) || typeof input.presetId !== 'string') {
        invalidPayload(ack);
        return;
      }
      const text = CHAT_PRESET_MAP[input.presetId];
      if (!text) {
        invalidPayload(ack);
        return;
      }
      if (!session.roomId) {
        ack?.({ ok: false, code: 'action-rejected', message: '현재 참가 중인 방이 없어요.' });
        return;
      }

      // 채팅 플러딩 방지 — 쿨다운 내 메시지는 조용히 무시 (에러 피드백 루프 방지)
      const now = Date.now();
      if (now - lastChatAt < CHAT_COOLDOWN_MS) {
        ack?.({ ok: false, code: 'rate-limited', message: '채팅은 잠시 후 다시 보내 주세요.' });
        return;
      }
      lastChatAt = now;

      const room = roomManager.getRoom(session.roomId);
      if (!room) {
        ack?.({ ok: false, code: 'room-not-found', message: '방을 찾을 수 없어요.' });
        return;
      }

      const player = room.engine.state.players.find(p => p.id === session.playerId);
      if (!player) {
        ack?.({ ok: false, code: 'action-rejected', message: '현재 좌석을 찾을 수 없어요.' });
        return;
      }

      // 프리셋만 허용 — 자유 텍스트는 욕설/비하 차단을 위해 받지 않는다.
      // 클라이언트가 보낸 텍스트는 신뢰하지 않고 서버 테이블에서 id→문구를 조회한다.
      roomManager.addChatMessage(session.roomId, session.playerId, player.name, text);
      ack?.({ ok: true });
    });

    // Create room
    socket.on('create-room', (input: unknown, ack?: AckCallback<{ roomId: string }>) => {
      if (!ensureOwnership(ack)) return;
      const parsed = parseCreateRoomRequest(input);
      if (!parsed.ok) {
        invalidPayload(ack);
        return;
      }
      const config = parsed.value;
      // 플러딩 방지: 연결당 방 생성 쿨다운 (로비 스팸/방 상한 소진 예방)
      const now = Date.now();
      if (now - lastRoomCreateAt < ROOM_CREATE_COOLDOWN_MS) {
        ack?.({ ok: false, code: 'rate-limited', message: '방 생성은 잠시 후 다시 시도해 주세요.' });
        return;
      }
      // 운영 가드: 방 수 상한
      if (roomManager.getRoomCount() >= MAX_ROOMS) {
        ack?.({ ok: false, code: 'server-error', message: '방이 너무 많아요. 잠시 후 다시 시도해 주세요.' });
        return;
      }
      lastRoomCreateAt = now;
      const isSng = config.gameMode === 'sng';
      const password = String(config.password ?? '').trim().slice(0, 20);
      const bigBlind = Math.max(Number(config.bigBlind) || 20, 2);
      // 인원 구성 검증 — SnG는 방장 봇 채우기가 있는 혼합 테이블로 고정
      const tableType: TableType = isSng
        ? 'mixed'
        : VALID_TABLE_TYPES.includes(config.tableType as TableType)
          ? (config.tableType as TableType)
          : 'mixed';
      const safeConfig: RoomConfig = {
        ...config,
        maxPlayers: 6,
        turnTime: Math.min(Math.max(Number(config.turnTime) || 8, 5), 60),
        difficulty: VALID_DIFFICULTIES.includes(config.difficulty as RoomDifficulty)
          ? config.difficulty
          : 'normal',
        tableType,
        // 봇 충원 수는 구성이 결정: 사람만=0, 봇 전용=5, 혼합=1~5 (기본 2)
        botCount: tableType === 'humans'
          ? 0
          : tableType === 'bots'
            ? 5
            : Math.min(Math.max(Math.floor(Number(config.botCount ?? 2)), 1), 5),
        password: password || undefined,
        hostId: session.playerId, // 방장 — Sit & Go 봇 채우기 권한
        // 시트앤고는 고정 구조: 블라인드 스케줄 1레벨 시작 + 고정 스택
        ...(isSng
          ? {
              gameMode: 'sng' as const,
              smallBlind: SNG_BLIND_SCHEDULE[0].smallBlind,
              bigBlind: SNG_BLIND_SCHEDULE[0].bigBlind,
              startingStack: SNG_STARTING_STACK,
              minBuyIn: SNG_STARTING_STACK,
              maxBuyIn: SNG_STARTING_STACK,
            }
          : {
              gameMode: 'cash' as const,
              // 캐시 바이인 범위는 서버가 강제 (40~200BB)
              bigBlind,
              smallBlind: Math.max(Math.floor(bigBlind / 2), 1),
              minBuyIn: bigBlind * MIN_BUYIN_BB,
              maxBuyIn: bigBlind * MAX_BUYIN_BB,
            }),
      };
      const roomId = roomManager.createRoom(safeConfig);
      socket.emit('room-created', { roomId });
      ack?.({ ok: true, data: { roomId } });
      broadcastRoomList();
    });

    // 시트앤고 대기 중 봇 채우기 (방장)
    socket.on('sng-fill-bots', (ack?: AckCallback) => {
      if (!ensureOwnership(ack)) return;
      if (!session.roomId) {
        ack?.({ ok: false, code: 'action-rejected', message: '현재 참가 중인 방이 없어요.' });
        return;
      }
      const ok = roomManager.fillWithBots(session.roomId, session.playerId);
      if (ok) {
        broadcastRoomList();
        ack?.({ ok: true });
      } else {
        ack?.({ ok: false, code: 'action-rejected', message: '지금은 봇으로 채울 수 없어요.' });
      }
    });

    // Request room list
    socket.on('get-rooms', (ack?: AckCallback) => {
      if (!ensureOwnership(ack)) return;
      socket.emit('room-list', roomManager.getRoomList(session.playerId));
      ack?.({ ok: true });
    });

    // Disconnect: 즉시 제거하지 않고 grace period 동안 좌석/칩 보존
    socket.on('disconnect', () => {
      const detached = sessions.detachSocket(socket.id);
      console.log(`Player disconnected: socket=${socket.id}`);
      eventLog.log('disconnect', {
        playerId: session.playerId,
        ...(detached?.roomId ? { roomId: detached.roomId } : {}),
        // detached=null이면 이미 새 소켓이 세션을 가져간 것(중복 탭) — grace를 걸지 않는 정상 경로
        data: { socketId: socket.id, graceStarted: !!detached?.roomId },
      });
      if (!detached?.roomId) return;

      const roomId = detached.roomId;
      roomManager.handleDisconnect(roomId, detached.playerId);
      sessions.startGrace(detached, graceMs, () => {
        // 자리비움 좌석은 유지 (캐시: 미납 BB/최종 유예로 정리, SnG: 블라인드 소진에 맡김)
        const seatKept = roomManager.handleGraceExpired(roomId, detached.playerId);
        eventLog.log('grace-expired', {
          roomId, playerId: detached.playerId, data: { seatKept, seats: seatSnapshot(roomId) },
        });
        if (!seatKept) detached.roomId = null;
        broadcastRoomList();
      });
    });
  });

  return {
    roomManager,
    sessions,
    close: () => {
      if (sweepTimer) clearInterval(sweepTimer);
      sessions.shutdown();
      roomManager.shutdown();
    },
  };
}
