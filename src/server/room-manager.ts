import { PokerEngine } from '../lib/poker/engine';
import { Room, RoomConfig, Player, ChatMessage } from '../lib/poker/types';
import { fillEmptySeats, processBotTurn } from '../lib/bot/bot-manager';
import { getCharacterById } from '../lib/characters';

const TURN_TIMEOUT_MS = 30_000; // 30초 턴 타임아웃

export class RoomManager {
  private rooms: Map<string, { engine: PokerEngine; config: RoomConfig; createdAt: number }> = new Map();
  private chatHistory: Map<string, ChatMessage[]> = new Map();
  private botIntervals: Map<string, NodeJS.Timeout> = new Map();
  private pendingStartTimers: Map<string, NodeJS.Timeout> = new Map();
  private turnTimers: Map<string, NodeJS.Timeout> = new Map();
  private turnDeadlines: Map<string, number> = new Map();
  private onUpdate: (roomId: string, engine: PokerEngine) => void;
  private onChat: (roomId: string, message: ChatMessage) => void;

  constructor(
    onUpdate: (roomId: string, engine: PokerEngine) => void,
    onChat: (roomId: string, message: ChatMessage) => void,
  ) {
    this.onUpdate = onUpdate;
    this.onChat = onChat;
  }

  createRoom(config: RoomConfig): string {
    const id = `room-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const engine = new PokerEngine(config, id);
    this.rooms.set(id, { engine, config, createdAt: Date.now() });
    this.chatHistory.set(id, []);
    return id;
  }

  getRoom(roomId: string): { engine: PokerEngine; config: RoomConfig; createdAt: number } | undefined {
    return this.rooms.get(roomId);
  }

  /** 클라이언트에 전달할 턴 남은 시간 (ms) */
  getTurnTimeRemaining(roomId: string): number {
    const deadline = this.turnDeadlines.get(roomId);
    if (!deadline) return 0;
    return Math.max(0, deadline - Date.now());
  }

  getRoomList(): Array<{ id: string; name: string; playerCount: number; maxPlayers: number; blinds: string; status: string }> {
    const list: Array<{ id: string; name: string; playerCount: number; maxPlayers: number; blinds: string; status: string }> = [];
    this.rooms.forEach((room, id) => {
      list.push({
        id,
        name: room.config.name,
        playerCount: room.engine.state.players.length,
        maxPlayers: room.config.maxPlayers,
        blinds: `${room.config.smallBlind}/${room.config.bigBlind}`,
        status: room.engine.state.isHandInProgress ? 'Playing' : 'Waiting',
      });
    });
    return list;
  }

  joinRoom(roomId: string, player: Player): boolean {
    const room = this.rooms.get(roomId);
    if (!room) return false;
    const success = room.engine.addPlayer(player);
    if (success) {
      this.sendSystemChat(roomId, `${player.name} joined the table!`);
      this.tryStartGame(roomId);
    }
    return success;
  }

  leaveRoom(roomId: string, playerId: string): void {
    const room = this.rooms.get(roomId);
    if (!room) return;
    const player = room.engine.removePlayer(playerId);
    if (player) {
      this.sendSystemChat(roomId, `${player.name} left the table.`);
    }
    // Clean up empty rooms
    if (room.engine.state.players.filter(p => p.type === 'human').length === 0) {
      this.stopBotLoop(roomId);
      this.clearPendingStart(roomId);
      this.clearTurnTimer(roomId);
      this.rooms.delete(roomId);
      this.chatHistory.delete(roomId);
    }
  }

  // --- [FIX 1] Hand start 중복 방지 ---

  private clearPendingStart(roomId: string): void {
    const timer = this.pendingStartTimers.get(roomId);
    if (timer) {
      clearTimeout(timer);
      this.pendingStartTimers.delete(roomId);
    }
  }

  private tryStartGame(roomId: string): void {
    const room = this.rooms.get(roomId);
    if (!room || room.engine.state.isHandInProgress) return;

    // 이미 예약된 start가 있으면 취소 후 재스케줄
    this.clearPendingStart(roomId);

    // Fill bots if needed
    fillEmptySeats(room.engine);
    this.onUpdate(roomId, room.engine);

    if (room.engine.canStartHand()) {
      const timer = setTimeout(() => {
        this.pendingStartTimers.delete(roomId);
        this.startNewHand(roomId);
      }, 2000);
      this.pendingStartTimers.set(roomId, timer);
    }
  }

  private startNewHand(roomId: string): void {
    const room = this.rooms.get(roomId);
    if (!room) return;

    // [FIX 1] 이미 핸드가 진행 중이면 중복 시작 방지
    if (room.engine.state.isHandInProgress) return;

    // Reset folded/waiting players
    for (const p of room.engine.state.players) {
      if (p.chips > 0) {
        p.status = 'waiting';
      }
    }

    room.engine.startHand();

    const dealer = getCharacterById('dealer');
    if (dealer) {
      this.sendBotChat(roomId, 'dealer', dealer.name, dealer.chatMessages[0]);
    }

    this.onUpdate(roomId, room.engine);
    this.startPlayerLoop(roomId);
  }

  // --- [FIX 2] 서버 턴 타이머 ---

  private clearTurnTimer(roomId: string): void {
    const timer = this.turnTimers.get(roomId);
    if (timer) {
      clearTimeout(timer);
      this.turnTimers.delete(roomId);
    }
    this.turnDeadlines.delete(roomId);
  }

  private startTurnTimer(roomId: string): void {
    this.clearTurnTimer(roomId);

    const room = this.rooms.get(roomId);
    if (!room || !room.engine.state.isHandInProgress) return;

    const activePlayer = room.engine.state.players[room.engine.state.activePlayerIndex];
    if (!activePlayer || activePlayer.type !== 'human') return;

    const deadline = Date.now() + TURN_TIMEOUT_MS;
    this.turnDeadlines.set(roomId, deadline);

    const timer = setTimeout(() => {
      this.turnTimers.delete(roomId);
      this.turnDeadlines.delete(roomId);
      this.handleTurnTimeout(roomId, activePlayer.id);
    }, TURN_TIMEOUT_MS);

    this.turnTimers.set(roomId, timer);
  }

  private handleTurnTimeout(roomId: string, playerId: string): void {
    const room = this.rooms.get(roomId);
    if (!room || !room.engine.state.isHandInProgress) return;

    // 아직 같은 플레이어의 턴인지 확인
    const activePlayer = room.engine.state.players[room.engine.state.activePlayerIndex];
    if (!activePlayer || activePlayer.id !== playerId) return;

    // 체크 가능하면 체크, 아니면 폴드
    const canCheck = activePlayer.currentBet >= room.engine.state.currentBet;
    const action = canCheck ? 'check' : 'fold';

    this.sendSystemChat(roomId, `${activePlayer.name} timed out — auto ${action}.`);

    const result = room.engine.processAction({
      playerId,
      type: action as any,
      amount: 0,
    });

    if (result.valid) {
      this.onUpdate(roomId, room.engine);
      if (result.handComplete) {
        this.announceWinner(roomId);
        this.scheduleNextHand(roomId);
      } else {
        this.startPlayerLoop(roomId);
      }
    }
  }

  // --- 통합 플레이어 루프 (봇 + 휴먼 턴 타이머) ---

  private startPlayerLoop(roomId: string): void {
    this.stopBotLoop(roomId);
    this.clearTurnTimer(roomId);

    const room = this.rooms.get(roomId);
    if (!room || !room.engine.state.isHandInProgress) return;

    const activePlayer = room.engine.state.players[room.engine.state.activePlayerIndex];
    if (!activePlayer) return;

    if (activePlayer.type === 'bot') {
      this.startBotLoop(roomId);
    } else {
      // 휴먼 턴 → 타이머 시작
      this.startTurnTimer(roomId);
    }
  }

  private startBotLoop(roomId: string): void {
    this.stopBotLoop(roomId);

    const loop = async () => {
      const room = this.rooms.get(roomId);
      if (!room || !room.engine.state.isHandInProgress) return;

      const activePlayer = room.engine.state.players[room.engine.state.activePlayerIndex];
      if (!activePlayer || activePlayer.type !== 'bot') {
        // 다음 플레이어가 봇이 아니면 → 턴 타이머 시작
        this.startTurnTimer(roomId);
        return;
      }

      const { acted, action } = await processBotTurn(room.engine);
      if (acted && action) {
        // Bot chat based on action
        const character = getCharacterById(activePlayer.personalityId || '');
        if (character && Math.random() < 0.4) {
          let msg = '';
          switch (action.action) {
            case 'fold': msg = character.foldQuote; break;
            case 'raise': case 'all-in': msg = character.bluffQuote; break;
            default: msg = character.chatMessages[Math.floor(Math.random() * character.chatMessages.length)];
          }
          if (msg) this.sendBotChat(roomId, activePlayer.id, activePlayer.name, msg);
        }

        this.onUpdate(roomId, room.engine);

        if (!room.engine.state.isHandInProgress) {
          // Hand ended
          this.announceWinner(roomId);
          this.scheduleNextHand(roomId);
          return;
        }

        // Continue bot loop if next player is also a bot
        const nextInterval = setTimeout(loop, 500);
        this.botIntervals.set(roomId, nextInterval);
      }
    };

    const interval = setTimeout(loop, 500);
    this.botIntervals.set(roomId, interval);
  }

  private scheduleNextHand(roomId: string): void {
    this.clearPendingStart(roomId);
    const timer = setTimeout(() => {
      this.pendingStartTimers.delete(roomId);
      this.startNewHand(roomId);
    }, 4000);
    this.pendingStartTimers.set(roomId, timer);
  }

  stopBotLoop(roomId: string): void {
    const interval = this.botIntervals.get(roomId);
    if (interval) {
      clearTimeout(interval);
      this.botIntervals.delete(roomId);
    }
  }

  processPlayerAction(roomId: string, playerId: string, actionType: string, amount: number = 0): boolean {
    const room = this.rooms.get(roomId);
    if (!room) return false;

    // 턴 타이머 클리어 (플레이어가 행동함)
    this.clearTurnTimer(roomId);

    const result = room.engine.processAction({
      playerId,
      type: actionType as any,
      amount,
    });

    if (!result.valid) return false;

    this.onUpdate(roomId, room.engine);

    if (result.handComplete) {
      this.announceWinner(roomId);
      this.scheduleNextHand(roomId);
    } else {
      this.startPlayerLoop(roomId);
    }

    return true;
  }

  private announceWinner(roomId: string): void {
    const room = this.rooms.get(roomId);
    if (!room || !room.engine.state.winners) return;

    for (const winner of room.engine.state.winners) {
      const player = room.engine.state.players.find(p => p.id === winner.playerId);
      if (!player) continue;

      const handDesc = winner.hand ? ` with ${winner.hand.description}` : '';
      this.sendSystemChat(roomId, `${player.name} wins ${winner.amount} chips${handDesc}!`);

      // Winner character quote
      if (player.type === 'bot') {
        const character = getCharacterById(player.personalityId || '');
        if (character) {
          this.sendBotChat(roomId, player.id, player.name, character.winQuote);
        }
      }
    }
  }

  addChatMessage(roomId: string, playerId: string, playerName: string, message: string): void {
    const chatMsg: ChatMessage = {
      id: `msg-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
      roomId,
      playerId,
      playerName,
      message,
      timestamp: Date.now(),
      type: 'player',
    };
    const history = this.chatHistory.get(roomId) || [];
    history.push(chatMsg);
    if (history.length > 100) history.shift();
    this.chatHistory.set(roomId, history);
    this.onChat(roomId, chatMsg);
  }

  private sendSystemChat(roomId: string, message: string): void {
    const chatMsg: ChatMessage = {
      id: `msg-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
      roomId,
      playerId: 'system',
      playerName: 'System',
      message,
      timestamp: Date.now(),
      type: 'system',
    };
    const history = this.chatHistory.get(roomId) || [];
    history.push(chatMsg);
    this.chatHistory.set(roomId, history);
    this.onChat(roomId, chatMsg);
  }

  private sendBotChat(roomId: string, botId: string, botName: string, message: string): void {
    const chatMsg: ChatMessage = {
      id: `msg-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
      roomId,
      playerId: botId,
      playerName: botName,
      message,
      timestamp: Date.now(),
      type: 'bot',
    };
    const history = this.chatHistory.get(roomId) || [];
    history.push(chatMsg);
    this.chatHistory.set(roomId, history);
    this.onChat(roomId, chatMsg);
  }

  getChatHistory(roomId: string): ChatMessage[] {
    return this.chatHistory.get(roomId) || [];
  }
}
