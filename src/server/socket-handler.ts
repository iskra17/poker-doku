import { Server, Socket } from 'socket.io';
import { RoomManager } from './room-manager';
import { SessionManager, GRACE_MS } from './session-manager';
import { RoomConfig, Player, ActionType, RoomDifficulty } from '../lib/poker/types';
import { getCharacterById } from '../lib/characters';
import { CHAT_PRESET_MAP } from '../lib/chat/presets';
import { SNG_BLIND_SCHEDULE, SNG_STARTING_STACK } from '../lib/poker/blind-schedule';

const VALID_ACTIONS: ActionType[] = ['fold', 'check', 'call', 'raise', 'all-in'];
const VALID_DIFFICULTIES: RoomDifficulty[] = ['easy', 'normal', 'hard'];
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
    socket.on('resync', () => {
      if (session.roomId) {
        restoreOrEvict();
      } else {
        socket.emit('room-lost', { message: '서버가 재시작되어 게임이 초기화됐어요. 다시 입장해 주세요.' });
      }
    });

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
          // 리바이/복귀로 게임을 재개할 수 있으면 시작 (다른 좌석에도 상태 반영)
          roomManager.resumeRoom(roomId);
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
      // 자리비움으로 떠나 세션에 안 잡힌 다른 방 좌석도 회수 (1세션 1테이블)
      roomManager.leaveAllSeatsExcept(session.playerId, roomId);

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
            socket.emit('error', { message: '자리가 모두 찼어요 — 다른 테이블을 찾아보세요.' });
            return;
          }
          // leaveRoom 경유: 폴드로 핸드가 끝나는 경우의 승자 처리까지 위임
          roomManager.leaveRoom(roomId, bot.id);
          socket.emit('error', { message: `${bot.name}이(가) 이번 핸드를 끝으로 자리를 비워줘요 — 몇 초 후 다시 참가해 주세요!` });
          return;
        }
        // 핸드 사이: 예약된 봇(pendingRemoval) 포함 아무 봇이나 즉시 정리하고 그 자리에 착석
        const bot = room.engine.state.players.find(p => p.type === 'bot');
        if (!bot) {
          socket.emit('error', { message: '자리가 모두 찼어요 — 다른 테이블을 찾아보세요.' });
          return;
        }
        room.engine.processLeave(bot.id);
        assignedSeat = bot.seatIndex;
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

    // Leave room — mode 'sitout'이면 좌석/칩을 유지한 채 자리비움으로 떠남 (재입장 시 복귀)
    socket.on('leave-room', (data?: { mode?: string }) => {
      if (session.roomId) {
        const roomId = session.roomId;
        socket.leave(roomId);
        if (data?.mode === 'sitout') {
          roomManager.sitOutAndLeave(roomId, session.playerId);
        } else {
          roomManager.leaveRoom(roomId, session.playerId);
        }
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
    socket.on('send-chat', (data: { presetId?: string }) => {
      if (!session.roomId) return;

      // 채팅 플러딩 방지 — 쿨다운 내 메시지는 조용히 무시 (에러 피드백 루프 방지)
      const now = Date.now();
      if (now - lastChatAt < CHAT_COOLDOWN_MS) return;
      lastChatAt = now;

      const room = roomManager.getRoom(session.roomId);
      if (!room) return;

      const player = room.engine.state.players.find(p => p.id === session.playerId);
      if (!player) return;

      // 프리셋만 허용 — 자유 텍스트는 욕설/비하 차단을 위해 받지 않는다.
      // 클라이언트가 보낸 텍스트는 신뢰하지 않고 서버 테이블에서 id→문구를 조회한다.
      const text = CHAT_PRESET_MAP[String(data.presetId ?? '')];
      if (!text) return;
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
        difficulty: VALID_DIFFICULTIES.includes(config.difficulty as RoomDifficulty)
          ? config.difficulty
          : 'normal',
        // 봇 충원 수 0~5 (기본 2) — 친구 방은 0으로 좌석 확보
        botCount: Math.min(Math.max(Math.floor(Number(config.botCount ?? 2)), 0), 5),
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
        // 자리비움 좌석은 유지 (캐시: 미납 BB/최종 유예로 정리, SnG: 블라인드 소진에 맡김)
        const seatKept = roomManager.handleGraceExpired(roomId, detached.playerId);
        if (!seatKept) detached.roomId = null;
        io.emit('room-list', roomManager.getRoomList());
      });
    });
  });
}
