import { PokerEngine } from '../lib/poker/engine';
import { RoomConfig, Player, ChatMessage, ActionType } from '../lib/poker/types';
import { fillEmptySeats, processBotTurn } from '../lib/bot/bot-manager';
import { getCharacterById } from '../lib/characters';

const DEFAULT_TURN_TIMEOUT_S = 30; // config.turnTime 미설정 시 폴백 (초)
const DISCONNECTED_AUTO_ACT_MS = 1_000; // 끊긴 플레이어 턴 자동 처리 지연

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
      this.sendSystemChat(roomId, `${player.name}님이 테이블에 앉았습니다.`);
      this.tryStartGame(roomId);
    }
    return success;
  }

  leaveRoom(roomId: string, playerId: string): void {
    const room = this.rooms.get(roomId);
    if (!room) return;

    const wasInProgress = room.engine.state.isHandInProgress;
    // 이탈자 턴에 걸려 있던 stale 타이머 제거 (아니어도 아래 startPlayerLoop가 재설정)
    this.clearTurnTimer(roomId);

    const { player, handComplete } = room.engine.processLeave(playerId);
    if (player) {
      this.sendSystemChat(roomId, `${player.name}님이 테이블을 떠났습니다.`);
    }

    // Clean up empty rooms — 제거 예약자는 휴먼 수에서 제외
    const humans = room.engine.state.players.filter(p => p.type === 'human' && !p.pendingRemoval);
    if (humans.length === 0) {
      this.stopBotLoop(roomId);
      this.clearPendingStart(roomId);
      this.clearTurnTimer(roomId);
      this.rooms.delete(roomId);
      this.chatHistory.delete(roomId);
      return;
    }

    if (wasInProgress && player) {
      if (handComplete) {
        this.onUpdate(roomId, room.engine);
        this.announceWinner(roomId);
        this.scheduleNextHand(roomId);
      } else if (room.engine.state.isHandInProgress) {
        // 이탈이 턴/라운드를 진행시켰을 수 있으므로 루프 재가동 (핸드 정지 방지)
        this.startPlayerLoop(roomId);
        this.onUpdate(roomId, room.engine);
      } else {
        this.onUpdate(roomId, room.engine);
      }
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

    // Reset folded/waiting players — grace 중(접속 끊김)인 플레이어는 새 핸드에 딜인하지 않음
    for (const p of room.engine.state.players) {
      if (p.chips > 0) {
        p.status = p.isDisconnected ? 'sitting-out' : 'waiting';
      }
    }

    room.engine.startHand();

    // 이탈자 제거 후 인원 부족 등으로 핸드가 시작되지 못했으면 봇 충원 경로로 재시도
    if (!room.engine.state.isHandInProgress) {
      this.tryStartGame(roomId);
      return;
    }

    const dealer = getCharacterById('dealer');
    if (dealer) {
      this.sendBotChat(roomId, 'dealer', dealer.name, dealer.chatMessages[0]);
    }

    // 타이머를 먼저 시작해야 스냅샷에 turnTimeRemaining이 실린다
    this.startPlayerLoop(roomId);
    this.onUpdate(roomId, room.engine);
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

    const timeoutMs = (room.config.turnTime || DEFAULT_TURN_TIMEOUT_S) * 1000;
    const deadline = Date.now() + timeoutMs;
    this.turnDeadlines.set(roomId, deadline);

    const timer = setTimeout(() => {
      this.turnTimers.delete(roomId);
      this.turnDeadlines.delete(roomId);
      this.autoActFor(roomId, activePlayer.id, '시간 초과');
    }, timeoutMs);

    this.turnTimers.set(roomId, timer);
  }

  /** 체크 가능하면 체크, 아니면 폴드로 자동 처리 (타임아웃/접속 끊김 공용) */
  private autoActFor(roomId: string, playerId: string, reason: string): void {
    const room = this.rooms.get(roomId);
    if (!room || !room.engine.state.isHandInProgress) return;

    // 아직 같은 플레이어의 턴인지 확인
    const activePlayer = room.engine.state.players[room.engine.state.activePlayerIndex];
    if (!activePlayer || activePlayer.id !== playerId) return;

    const canCheck = activePlayer.currentBet >= room.engine.state.currentBet;
    const action: ActionType = canCheck ? 'check' : 'fold';

    this.sendSystemChat(roomId, `${activePlayer.name}님 ${reason} — 자동 ${action === 'check' ? '체크' : '폴드'}되었습니다.`);

    const result = room.engine.processAction({ playerId, type: action, amount: 0 });

    if (result.valid) {
      if (result.handComplete) {
        this.onUpdate(roomId, room.engine);
        this.announceWinner(roomId);
        this.scheduleNextHand(roomId);
      } else {
        // 타이머를 먼저 시작해야 스냅샷에 turnTimeRemaining이 실린다
        this.startPlayerLoop(roomId);
        this.onUpdate(roomId, room.engine);
      }
    }
  }

  // --- 재접속 (grace period) ---

  /** disconnect 직후: 좌석/칩은 유지하고 마킹만. 자기 턴이면 즉시 자동 처리 */
  handleDisconnect(roomId: string, playerId: string): void {
    const room = this.rooms.get(roomId);
    if (!room) return;
    const player = room.engine.state.players.find(p => p.id === playerId);
    if (!player || player.pendingRemoval) return;

    player.isDisconnected = true;
    this.sendSystemChat(roomId, `${player.name}님의 연결이 끊겼어요 — 잠시 자리를 지켜둘게요.`);

    if (room.engine.state.isHandInProgress) {
      const active = room.engine.state.players[room.engine.state.activePlayerIndex];
      if (active?.id === playerId) {
        this.clearTurnTimer(roomId);
        this.autoActFor(roomId, playerId, '접속 끊김');
        return; // autoActFor가 onUpdate/루프 재개까지 처리
      }
    }
    this.onUpdate(roomId, room.engine);
  }

  /** grace 내 재접속: 좌석/칩 복원 */
  handleReconnect(roomId: string, playerId: string): void {
    const room = this.rooms.get(roomId);
    if (!room) return;
    const player = room.engine.state.players.find(p => p.id === playerId);
    if (!player) return;

    player.isDisconnected = false;
    if (player.status === 'sitting-out' && player.chips > 0) {
      player.status = 'waiting'; // 다음 핸드 자동 참여
    }
    this.sendSystemChat(roomId, `${player.name}님이 다시 연결됐어요!`);
    this.onUpdate(roomId, room.engine);
    this.tryStartGame(roomId);
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
    } else if (activePlayer.isDisconnected) {
      // 끊긴 플레이어의 턴: 풀 타이머 대신 짧은 지연 후 자동 처리 (다른 플레이어 대기 방지)
      this.clearTurnTimer(roomId);
      const timer = setTimeout(() => {
        this.turnTimers.delete(roomId);
        this.autoActFor(roomId, activePlayer.id, '접속 끊김');
      }, DISCONNECTED_AUTO_ACT_MS);
      this.turnTimers.set(roomId, timer);
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

        if (!room.engine.state.isHandInProgress) {
          // Hand ended
          this.onUpdate(roomId, room.engine);
          this.announceWinner(roomId);
          this.scheduleNextHand(roomId);
          return;
        }

        // 다음 차례가 휴먼이면 타이머를 먼저 시작해 스냅샷에 turnTimeRemaining을 싣는다
        const next = room.engine.state.players[room.engine.state.activePlayerIndex];
        if (next && next.type !== 'bot') {
          this.startPlayerLoop(roomId);
          this.onUpdate(roomId, room.engine);
          return;
        }

        this.onUpdate(roomId, room.engine);
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
    // 승리 연출 시퀀스(~5.5s)가 끝난 뒤 다음 핸드 시작
    const timer = setTimeout(() => {
      this.pendingStartTimers.delete(roomId);
      this.startNewHand(roomId);
    }, 6500);
    this.pendingStartTimers.set(roomId, timer);
  }

  stopBotLoop(roomId: string): void {
    const interval = this.botIntervals.get(roomId);
    if (interval) {
      clearTimeout(interval);
      this.botIntervals.delete(roomId);
    }
  }

  processPlayerAction(roomId: string, playerId: string, actionType: ActionType, amount: number = 0): boolean {
    const room = this.rooms.get(roomId);
    if (!room) return false;

    // 턴 타이머 클리어 (플레이어가 행동함)
    this.clearTurnTimer(roomId);

    const result = room.engine.processAction({
      playerId,
      type: actionType,
      amount,
    });

    if (!result.valid) return false;

    if (result.handComplete) {
      this.onUpdate(roomId, room.engine);
      this.announceWinner(roomId);
      this.scheduleNextHand(roomId);
    } else {
      // 타이머를 먼저 시작해야 스냅샷에 turnTimeRemaining이 실린다
      this.startPlayerLoop(roomId);
      this.onUpdate(roomId, room.engine);
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
      this.sendSystemChat(roomId, `${player.name}님이 ${winner.amount.toLocaleString()} 칩을 획득했습니다${handDesc}!`);

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
