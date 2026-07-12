import { Server, Socket } from 'socket.io';
import { RoomManager } from './room-manager';
import { SessionManager, GRACE_MS } from './session-manager';
import { RoomConfig, Player, ActionType } from '../lib/poker/types';
import { getCharacterById } from '../lib/characters';
import { SNG_BLIND_SCHEDULE, SNG_STARTING_STACK } from '../lib/poker/blind-schedule';

const VALID_ACTIONS: ActionType[] = ['fold', 'check', 'call', 'raise', 'all-in'];
const MAX_ROOMS = 30; // 운영 가드: 동시 존재 가능한 방 수 상한
const MIN_BUYIN_BB = 40; // 캐시 게임 바이인 하한 (BB 배수)
const MAX_BUYIN_BB = 200; // 캐시 게임 바이인 상한 (BB 배수)
// 플러딩 방지 쿨다운 (연결당) — 로비/채팅 스팸으로 방 상한을 소진하거나 채팅을 도배하는 것 차단
const ROOM_CREATE_COOLDOWN_MS = 5_000;
const CHAT_COOLDOWN_MS = 700;

export function setupSocketHandlers(io: Server): void {
  const sessions = new SessionManager();

  const roomManager = new RoomManager(
    // onUpdate
    (roomId, engine) => {
      const turnTimeRemaining = roomManager.getTurnTimeRemaining(roomId);
      const players = engine.state.players;
      for (const player of players) {
        if (player.type === 'human') {
          const socketId = sessions.getByPlayerId(player.id)?.socketId;
          const socket = socketId ? io.sockets.sockets.get(socketId) : undefined;
          if (socket) {
            socket.emit('game-update', {
              ...engine.getPublicState(player.id),
              turnTimeRemaining,
            });
          }
        }
      }
      // Also broadcast to spectators / general room
      io.to(roomId).emit('game-update-public', {
        ...engine.getPublicState(),
        turnTimeRemaining,
      });
    },
    // onChat
    (roomId, message) => {
      io.to(roomId).emit('chat-message', message);
    },
  );

  // Create default rooms — persistent: 유휴 정리 대상에서 제외. 바이인 범위는 40~200BB 표준
  roomManager.createRoom({
    name: 'Sakura Lounge',
    smallBlind: 10,
    bigBlind: 20,
    minBuyIn: 20 * MIN_BUYIN_BB,
    maxBuyIn: 20 * MAX_BUYIN_BB,
    maxPlayers: 6,
    turnTime: 8,
  }, true);

  roomManager.createRoom({
    name: "Dragon's Den",
    smallBlind: 25,
    bigBlind: 50,
    minBuyIn: 50 * MIN_BUYIN_BB,
    maxBuyIn: 50 * MAX_BUYIN_BB,
    maxPlayers: 6,
    turnTime: 8,
  }, true);

  roomManager.createRoom({
    name: 'Moonlight Table',
    smallBlind: 50,
    bigBlind: 100,
    minBuyIn: 100 * MIN_BUYIN_BB,
    maxBuyIn: 100 * MAX_BUYIN_BB,
    maxPlayers: 6,
    turnTime: 8,
  }, true);

  // 유저 생성 방 유휴 정리: 휴먼이 없는 방을 10분 후 삭제 (기본 방 제외)
  setInterval(() => {
    const removed = roomManager.sweepIdleRooms();
    if (removed > 0) {
      io.emit('room-list', roomManager.getRoomList());
    }
  }, 60_000);

  io.on('connection', (socket: Socket) => {
    const session = sessions.resolve(socket.handshake.auth?.sessionToken, socket.id);
    console.log(`Player connected: socket=${socket.id} player=${session.playerId}`);

    // 연결당 레이트리밋 상태 (재접속 시 초기화 — 단순 플러딩 방지용)
    let lastRoomCreateAt = 0;
    let lastChatAt = 0;

    // 클라이언트에 공개 playerId 통지 (히어로 식별용)
    socket.emit('session', { playerId: session.playerId });

    // Send room list
    socket.emit('room-list', roomManager.getRoomList());

    // 재접속 복원: 세션에 방이 남아 있고 좌석이 유지되어 있으면 그대로 복귀
    if (session.roomId) {
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
      }
    }

    // Join room
    socket.on('join-room', (data: { roomId: string; playerName: string; buyIn: number; seatIndex: number; avatar?: string; password?: string }) => {
      const { roomId, buyIn, seatIndex } = data;
      // 입력 검증: 닉네임은 트리밍 후 24자 클램프 (빈 값이면 기본 닉네임)
      const playerName = (String(data.playerName ?? '').trim().slice(0, 24)) || '플레이어';
      // 프로필 캐릭터 — 등록된 캐릭터 id만 허용 (그 외엔 기본 'player')
      const avatar = data.avatar && getCharacterById(data.avatar) ? data.avatar : 'player';

      const room = roomManager.getRoom(roomId);
      if (!room) {
        socket.emit('error', { message: 'Room not found' });
        return;
      }

      // 멱등/재입장 처리: 같은 playerId가 이미 좌석에 있으면 새 Player를 만들지 않는다.
      // 핸드 중 이탈은 splice 대신 pendingRemoval 마킹만 하므로, 그 좌석을 되살려
      // 동일 id의 Player가 둘 생기는 것(불변식 위반 + 새 스택 리바이 악용)을 막는다.
      const seated = room.engine.state.players.find(p => p.id === session.playerId);
      if (seated) {
        const startedTournament = !!room.engine.state.tournament && room.engine.state.tournament.entrants > 0;
        // 시작된 토너먼트에서 이탈은 탈락 확정이므로 되살리지 않고 아래 lock 체크로 넘긴다
        if (!seated.pendingRemoval || !startedTournament) {
          if (seated.pendingRemoval) {
            // 예약 취소 — 기존 칩/좌석 그대로 유지 (새 바이인 무시)
            seated.pendingRemoval = false;
            if (seated.chips > 0 && !seated.isDisconnected && !room.engine.state.isHandInProgress) {
              seated.status = 'waiting';
            }
          }
          socket.join(roomId);
          session.roomId = roomId;
          socket.emit('room-joined', {
            roomId,
            gameState: {
              ...room.engine.getPublicState(session.playerId),
              turnTimeRemaining: roomManager.getTurnTimeRemaining(roomId),
            },
            chatHistory: roomManager.getChatHistory(roomId),
          });
          return;
        }
      }

      // 비밀번호 방: 재입장(위 멱등 처리)이 아닌 신규 입장은 비밀번호 검증
      if (room.config.password && String(data.password ?? '') !== room.config.password) {
        socket.emit('error', { message: '비밀번호가 틀렸어요.' });
        return;
      }

      // 시트앤고: 이미 시작된(또는 끝난) 토너먼트에는 참가 불가
      const tournament = room.engine.state.tournament;
      if (tournament && tournament.entrants > 0) {
        socket.emit('error', { message: '이미 시작된 Sit & Go입니다.' });
        return;
      }

      // 다른 방에 착석 중이면 먼저 퇴장
      if (session.roomId && session.roomId !== roomId) {
        socket.leave(session.roomId);
        roomManager.leaveRoom(session.roomId, session.playerId);
        session.roomId = null;
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
      // Remove a bot to make space if table is full.
      // 핸드 진행 중 splice는 인덱스를 밀어 핸드를 깨뜨리므로, 핸드 사이에만 허용한다.
      if (room.engine.state.players.length >= 6) {
        if (room.engine.state.isHandInProgress) {
          socket.emit('error', { message: 'Table is full — try again after this hand.' });
          return;
        }
        const bot = room.engine.state.players.find(p => p.type === 'bot');
        if (bot) {
          room.engine.processLeave(bot.id);
          assignedSeat = bot.seatIndex;
        }
      }

      // 캐시 게임 바이인은 방 범위(40~200BB)로 검증/클램프
      const safeBuyIn = Math.min(
        Math.max(Math.floor(Number(buyIn) || room.config.minBuyIn), room.config.minBuyIn),
        room.config.maxBuyIn,
      );

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
      if (success) {
        socket.join(roomId);
        session.roomId = roomId;
        socket.emit('room-joined', {
          roomId,
          gameState: room.engine.getPublicState(session.playerId),
          chatHistory: roomManager.getChatHistory(roomId),
        });
        // Update room list for all
        io.emit('room-list', roomManager.getRoomList());
      } else {
        socket.emit('error', { message: 'Could not join room' });
      }
    });

    // Leave room
    socket.on('leave-room', () => {
      if (session.roomId) {
        const roomId = session.roomId;
        socket.leave(roomId);
        roomManager.leaveRoom(roomId, session.playerId);
        session.roomId = null;
        io.emit('room-list', roomManager.getRoomList());
      }
    });

    // Player action
    socket.on('player-action', (data: { action: string; amount?: number }) => {
      if (!session.roomId) return;
      if (!VALID_ACTIONS.includes(data.action as ActionType)) return;

      roomManager.processPlayerAction(
        session.roomId,
        session.playerId,
        data.action as ActionType,
        typeof data.amount === 'number' ? data.amount : 0,
      );
    });

    // 자리비움 토글
    socket.on('toggle-sit-out', () => {
      if (!session.roomId) return;
      roomManager.toggleSitOut(session.roomId, session.playerId);
    });

    // 타임칩 사용
    socket.on('use-time-bank', () => {
      if (!session.roomId) return;
      roomManager.useTimeBank(session.roomId, session.playerId);
    });

    // Chat message
    socket.on('send-chat', (data: { message: string }) => {
      if (!session.roomId) return;

      // 채팅 플러딩 방지 — 쿨다운 내 메시지는 조용히 무시 (에러 피드백 루프 방지)
      const now = Date.now();
      if (now - lastChatAt < CHAT_COOLDOWN_MS) return;
      lastChatAt = now;

      const room = roomManager.getRoom(session.roomId);
      if (!room) return;

      const player = room.engine.state.players.find(p => p.id === session.playerId);
      if (!player) return;

      const text = String(data.message ?? '').slice(0, 300);
      if (!text.trim()) return;
      roomManager.addChatMessage(session.roomId, session.playerId, player.name, text);
    });

    // Create room
    socket.on('create-room', (config: RoomConfig) => {
      // 플러딩 방지: 연결당 방 생성 쿨다운 (로비 스팸/방 상한 소진 예방)
      const now = Date.now();
      if (now - lastRoomCreateAt < ROOM_CREATE_COOLDOWN_MS) {
        socket.emit('error', { message: '방 생성은 잠시 후 다시 시도해 주세요.' });
        return;
      }
      // 운영 가드: 방 수 상한
      if (roomManager.getRoomCount() >= MAX_ROOMS) {
        socket.emit('error', { message: '방이 너무 많아요. 잠시 후 다시 시도해 주세요.' });
        return;
      }
      lastRoomCreateAt = now;
      const isSng = config.gameMode === 'sng';
      const password = String(config.password ?? '').trim().slice(0, 20);
      const bigBlind = Math.max(Number(config.bigBlind) || 20, 2);
      const safeConfig: RoomConfig = {
        ...config,
        maxPlayers: 6,
        turnTime: Math.min(Math.max(Number(config.turnTime) || 8, 5), 60),
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
      io.emit('room-list', roomManager.getRoomList());
    });

    // 시트앤고 대기 중 봇 채우기 (방장)
    socket.on('sng-fill-bots', () => {
      if (!session.roomId) return;
      const ok = roomManager.fillWithBots(session.roomId, session.playerId);
      if (ok) {
        io.emit('room-list', roomManager.getRoomList());
      }
    });

    // Request room list
    socket.on('get-rooms', () => {
      socket.emit('room-list', roomManager.getRoomList());
    });

    // Disconnect: 즉시 제거하지 않고 grace period 동안 좌석/칩 보존
    socket.on('disconnect', () => {
      const detached = sessions.detachSocket(socket.id);
      console.log(`Player disconnected: socket=${socket.id}`);
      if (!detached?.roomId) return;

      const roomId = detached.roomId;
      roomManager.handleDisconnect(roomId, detached.playerId);
      sessions.startGrace(detached, GRACE_MS, () => {
        roomManager.leaveRoom(roomId, detached.playerId);
        detached.roomId = null;
        io.emit('room-list', roomManager.getRoomList());
      });
    });
  });
}
