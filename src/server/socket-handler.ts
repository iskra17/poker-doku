import { Server, Socket } from 'socket.io';
import { RoomManager } from './room-manager';
import { SessionManager, GRACE_MS } from './session-manager';
import { RoomConfig, Player, ActionType } from '../lib/poker/types';

const VALID_ACTIONS: ActionType[] = ['fold', 'check', 'call', 'raise', 'all-in'];

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

  // Create default rooms
  roomManager.createRoom({
    name: 'Sakura Lounge',
    smallBlind: 10,
    bigBlind: 20,
    minBuyIn: 400,
    maxBuyIn: 2000,
    maxPlayers: 6,
    turnTime: 30,
  });

  roomManager.createRoom({
    name: "Dragon's Den",
    smallBlind: 25,
    bigBlind: 50,
    minBuyIn: 1000,
    maxBuyIn: 5000,
    maxPlayers: 6,
    turnTime: 30,
  });

  roomManager.createRoom({
    name: 'Moonlight Table',
    smallBlind: 50,
    bigBlind: 100,
    minBuyIn: 2000,
    maxBuyIn: 10000,
    maxPlayers: 6,
    turnTime: 30,
  });

  io.on('connection', (socket: Socket) => {
    const session = sessions.resolve(socket.handshake.auth?.sessionToken, socket.id);
    console.log(`Player connected: socket=${socket.id} player=${session.playerId}`);

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
    socket.on('join-room', (data: { roomId: string; playerName: string; buyIn: number; seatIndex: number }) => {
      const { roomId, playerName, buyIn, seatIndex } = data;

      const room = roomManager.getRoom(roomId);
      if (!room) {
        socket.emit('error', { message: 'Room not found' });
        return;
      }

      // 멱등 처리: 이미 이 방에 착석 중이면 상태만 재전송
      const existing = room.engine.state.players.find(
        p => p.id === session.playerId && !p.pendingRemoval,
      );
      if (existing) {
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

      // 다른 방에 착석 중이면 먼저 퇴장
      if (session.roomId && session.roomId !== roomId) {
        socket.leave(session.roomId);
        roomManager.leaveRoom(session.roomId, session.playerId);
        session.roomId = null;
      }

      // Find first available seat
      let assignedSeat = seatIndex;
      const occupiedSeats = new Set(room.engine.state.players.map(p => p.seatIndex));
      if (occupiedSeats.has(seatIndex)) {
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

      const player: Player = {
        id: session.playerId,
        name: playerName,
        type: 'human',
        avatar: 'player',
        chips: buyIn,
        seatIndex: assignedSeat,
        holeCards: [],
        currentBet: 0,
        totalContributed: 0,
        status: 'waiting',
        hasActed: false,
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

    // Chat message
    socket.on('send-chat', (data: { message: string }) => {
      if (!session.roomId) return;

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
      const safeConfig: RoomConfig = {
        ...config,
        maxPlayers: 6,
        turnTime: Math.min(Math.max(Number(config.turnTime) || 30, 10), 120),
      };
      const roomId = roomManager.createRoom(safeConfig);
      socket.emit('room-created', { roomId });
      io.emit('room-list', roomManager.getRoomList());
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
