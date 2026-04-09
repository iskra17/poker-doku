import { Server, Socket } from 'socket.io';
import { RoomManager } from './room-manager';
import { RoomConfig, Player } from '../lib/poker/types';
import { PokerEngine } from '../lib/poker/engine';

export function setupSocketHandlers(io: Server): void {
  const roomManager = new RoomManager(
    // onUpdate
    (roomId, engine) => {
      const turnTimeRemaining = roomManager.getTurnTimeRemaining(roomId);
      const players = engine.state.players;
      for (const player of players) {
        if (player.type === 'human') {
          const socket = io.sockets.sockets.get(player.id);
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

  // Create a default room
  const defaultRoomId = roomManager.createRoom({
    name: 'Sakura Lounge',
    smallBlind: 10,
    bigBlind: 20,
    minBuyIn: 400,
    maxBuyIn: 2000,
    maxPlayers: 6,
    turnTime: 30,
  });

  roomManager.createRoom({
    name: 'Dragon\'s Den',
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
    console.log(`Player connected: ${socket.id}`);

    // Send room list
    socket.emit('room-list', roomManager.getRoomList());

    // Join room
    socket.on('join-room', (data: { roomId: string; playerName: string; buyIn: number; seatIndex: number }) => {
      const { roomId, playerName, buyIn, seatIndex } = data;

      // Find first available seat
      const room = roomManager.getRoom(roomId);
      let assignedSeat = seatIndex;
      if (room) {
        const occupiedSeats = new Set(room.engine.state.players.map(p => p.seatIndex));
        if (occupiedSeats.has(seatIndex)) {
          // Find first empty seat
          for (let s = 0; s < 6; s++) {
            if (!occupiedSeats.has(s)) {
              assignedSeat = s;
              break;
            }
          }
        }
        // Remove a bot to make space if table is full
        if (room.engine.state.players.length >= 6) {
          const bot = room.engine.state.players.find(p => p.type === 'bot');
          if (bot) {
            room.engine.removePlayer(bot.id);
            assignedSeat = bot.seatIndex;
          }
        }
      }

      const player: Player = {
        id: socket.id,
        name: playerName,
        type: 'human',
        avatar: 'player',
        chips: buyIn,
        seatIndex: assignedSeat,
        holeCards: [],
        currentBet: 0,
        status: 'waiting',
        hasActed: false,
      };

      const success = roomManager.joinRoom(roomId, player);
      if (success) {
        socket.join(roomId);
        (socket as any).currentRoom = roomId;

        const room = roomManager.getRoom(roomId);
        if (room) {
          socket.emit('room-joined', {
            gameState: room.engine.getPublicState(socket.id),
            chatHistory: roomManager.getChatHistory(roomId),
          });
        }
        // Update room list for all
        io.emit('room-list', roomManager.getRoomList());
      } else {
        socket.emit('error', { message: 'Could not join room' });
      }
    });

    // Leave room
    socket.on('leave-room', () => {
      const roomId = (socket as any).currentRoom;
      if (roomId) {
        socket.leave(roomId);
        roomManager.leaveRoom(roomId, socket.id);
        (socket as any).currentRoom = null;
        io.emit('room-list', roomManager.getRoomList());
      }
    });

    // Player action
    socket.on('player-action', (data: { action: string; amount?: number }) => {
      const roomId = (socket as any).currentRoom;
      if (!roomId) return;

      roomManager.processPlayerAction(roomId, socket.id, data.action, data.amount || 0);
    });

    // Chat message
    socket.on('send-chat', (data: { message: string }) => {
      const roomId = (socket as any).currentRoom;
      if (!roomId) return;

      const room = roomManager.getRoom(roomId);
      if (!room) return;

      const player = room.engine.state.players.find(p => p.id === socket.id);
      if (!player) return;

      roomManager.addChatMessage(roomId, socket.id, player.name, data.message);
    });

    // Create room
    socket.on('create-room', (config: RoomConfig) => {
      const roomId = roomManager.createRoom(config);
      socket.emit('room-created', { roomId });
      io.emit('room-list', roomManager.getRoomList());
    });

    // Request room list
    socket.on('get-rooms', () => {
      socket.emit('room-list', roomManager.getRoomList());
    });

    // Disconnect
    socket.on('disconnect', () => {
      const roomId = (socket as any).currentRoom;
      if (roomId) {
        roomManager.leaveRoom(roomId, socket.id);
        io.emit('room-list', roomManager.getRoomList());
      }
      console.log(`Player disconnected: ${socket.id}`);
    });
  });
}
