import { PokerEngine } from '../lib/poker/engine';
import { RoomConfig, Player, ChatMessage, ActionType } from '../lib/poker/types';
import { fillEmptySeats, processBotTurn } from '../lib/bot/bot-manager';
import { getCharacterById } from '../lib/characters';
import { SNG_BLIND_SCHEDULE, SNG_LEVEL_DURATION_MS, levelIndexAt } from '../lib/poker/blind-schedule';
import { AIDialogue } from './ai-dialogue';

const DEFAULT_TURN_TIMEOUT_S = 8; // config.turnTime 미설정 시 폴백 (초) — 짧은 기본 + 타임뱅크 자동 연장
const DISCONNECTED_AUTO_ACT_MS = 1_000; // 끊긴 플레이어 턴 자동 처리 지연
const TIME_BANK_EXTEND_MS = 30_000; // 타임칩 1개당 연장 시간

export class RoomManager {
  private rooms: Map<string, { engine: PokerEngine; config: RoomConfig; createdAt: number; persistent?: boolean }> = new Map();
  private chatHistory: Map<string, ChatMessage[]> = new Map();
  private botIntervals: Map<string, NodeJS.Timeout> = new Map();
  private pendingStartTimers: Map<string, NodeJS.Timeout> = new Map();
  private turnTimers: Map<string, NodeJS.Timeout> = new Map();
  private turnDeadlines: Map<string, number> = new Map();
  /** 시트앤고 진행 시계 — 블라인드 레벨 산정 기준 + 탈락 공지 커서 */
  private tournamentClocks: Map<string, { startedAt: number; announcedResults: number }> = new Map();
  /** AI 상황 대사 (키 없으면 비활성 — 스크립트 대사만) */
  private ai = new AIDialogue();
  private onUpdate: (roomId: string, engine: PokerEngine) => void;
  private onChat: (roomId: string, message: ChatMessage) => void;

  constructor(
    onUpdate: (roomId: string, engine: PokerEngine) => void,
    onChat: (roomId: string, message: ChatMessage) => void,
  ) {
    this.onUpdate = onUpdate;
    this.onChat = onChat;
  }

  createRoom(config: RoomConfig, persistent = false): string {
    const id = `room-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const engine = new PokerEngine(config, id);
    this.rooms.set(id, { engine, config, createdAt: Date.now(), persistent });
    this.chatHistory.set(id, []);
    return id;
  }

  getRoom(roomId: string): { engine: PokerEngine; config: RoomConfig; createdAt: number } | undefined {
    return this.rooms.get(roomId);
  }

  getRoomCount(): number {
    return this.rooms.size;
  }

  /** 휴먼이 없는 유저 생성 방을 유휴 시간 경과 후 정리. 삭제한 방 수 반환 */
  sweepIdleRooms(idleMs = 10 * 60_000): number {
    let removed = 0;
    const now = Date.now();
    this.rooms.forEach((room, id) => {
      if (room.persistent) return;
      const humans = room.engine.state.players.filter(p => p.type === 'human' && !p.pendingRemoval);
      if (humans.length === 0 && now - room.createdAt > idleMs) {
        this.stopBotLoop(id);
        this.clearPendingStart(id);
        this.clearTurnTimer(id);
        this.rooms.delete(id);
        this.chatHistory.delete(id);
        this.tournamentClocks.delete(id);
        removed++;
      }
    });
    return removed;
  }

  /** 클라이언트에 전달할 턴 남은 시간 (ms) */
  getTurnTimeRemaining(roomId: string): number {
    const deadline = this.turnDeadlines.get(roomId);
    if (!deadline) return 0;
    return Math.max(0, deadline - Date.now());
  }

  getRoomList(): Array<{
    id: string; name: string; playerCount: number; maxPlayers: number;
    blinds: string; status: string; mode: string; locked: boolean;
    hasPassword: boolean; bigBlind: number; minBuyIn: number; maxBuyIn: number;
  }> {
    const list: ReturnType<RoomManager['getRoomList']> = [];
    this.rooms.forEach((room, id) => {
      const tournament = room.engine.state.tournament;
      list.push({
        id,
        name: room.config.name,
        playerCount: room.engine.state.players.length,
        maxPlayers: room.config.maxPlayers,
        blinds: `${room.config.smallBlind}/${room.config.bigBlind}`,
        status: room.engine.state.isHandInProgress ? 'Playing' : 'Waiting',
        mode: room.config.gameMode ?? 'cash',
        // 시트앤고는 시작 후 참가 불가
        locked: !!tournament && tournament.entrants > 0,
        hasPassword: !!room.config.password,
        bigBlind: room.config.bigBlind,
        minBuyIn: room.config.minBuyIn,
        maxBuyIn: room.config.maxBuyIn,
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

  /**
   * 시트앤고 대기 중 남는 자리를 봇으로 채우고 시작 (방장 전용 — 테스트/소인원 매칭용).
   * 요청자가 착석한 휴먼이어야 하고, 토너먼트가 아직 시작 전이어야 한다.
   */
  fillWithBots(roomId: string, requesterId: string): boolean {
    const room = this.rooms.get(roomId);
    if (!room) return false;
    const tournament = room.engine.state.tournament;
    if (!tournament || tournament.entrants > 0 || tournament.finished) return false;

    const requester = room.engine.state.players.find(
      p => p.id === requesterId && p.type === 'human' && !p.pendingRemoval,
    );
    if (!requester) return false;
    // 방장이 착석해 있으면 방장만 가능, 없으면 아무 휴먼이나 가능
    const host = room.engine.state.players.find(
      p => p.id === room.config.hostId && p.type === 'human' && !p.pendingRemoval,
    );
    if (host && host.id !== requesterId) return false;

    fillEmptySeats(room.engine, room.config.maxPlayers, room.config.startingStack);
    this.sendSystemChat(roomId, '남는 자리를 봇으로 채웠어요 — 곧 시작합니다!');
    this.tryStartGame(roomId);
    return true;
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
      this.tournamentClocks.delete(roomId);
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
    if (room.engine.state.tournament?.finished) return; // 토너먼트 종료 — 재시작 없음

    // 이미 예약된 start가 있으면 취소 후 재스케줄
    this.clearPendingStart(roomId);

    // 시트앤고: 6인이 모두 모여야 시작 (자동 봇 충원 없음 — 방장이 '봇 채우기'로 채울 수 있음)
    const tournament = room.engine.state.tournament;
    if (tournament) {
      if (tournament.entrants === 0 && room.engine.state.players.length < room.config.maxPlayers) {
        this.onUpdate(roomId, room.engine);
        return;
      }
    } else {
      fillEmptySeats(room.engine);
    }
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

    // 시트앤고: 첫 핸드 직전 토너먼트 개시, 이후엔 시간 경과에 따른 레벨 인상
    const tournament = room.engine.state.tournament;
    if (tournament) {
      if (tournament.finished) return;
      if (tournament.entrants === 0) {
        const startedAt = Date.now();
        this.tournamentClocks.set(roomId, { startedAt, announcedResults: 0 });
        const next = SNG_BLIND_SCHEDULE[1] ?? null;
        room.engine.startTournament(
          startedAt + SNG_LEVEL_DURATION_MS,
          next?.smallBlind ?? null,
          next?.bigBlind ?? null,
        );
        this.sendSystemChat(
          roomId,
          `Sit & Go 시작! ${room.engine.state.players.length}인 · 블라인드 ${SNG_LEVEL_DURATION_MS / 60000}분마다 인상 · 1~3위 시상`,
        );
      } else {
        this.applyBlindLevel(roomId);
      }
    }

    // Reset folded/waiting players — 접속 끊김(grace)·자리비움 예약자는 새 핸드에 딜인하지 않음
    for (const p of room.engine.state.players) {
      if (p.chips > 0) {
        p.status = (p.isDisconnected || p.sitOutNext) ? 'sitting-out' : 'waiting';
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

  private startTurnTimer(roomId: string, overrideMs?: number): void {
    this.clearTurnTimer(roomId);

    const room = this.rooms.get(roomId);
    if (!room || !room.engine.state.isHandInProgress) return;

    const activePlayer = room.engine.state.players[room.engine.state.activePlayerIndex];
    if (!activePlayer || activePlayer.type !== 'human') return;

    const timeoutMs = overrideMs ?? (room.config.turnTime || DEFAULT_TURN_TIMEOUT_S) * 1000;
    const deadline = Date.now() + timeoutMs;
    this.turnDeadlines.set(roomId, deadline);

    const timer = setTimeout(() => {
      this.turnTimers.delete(roomId);
      this.turnDeadlines.delete(roomId);

      // 기본 시간 초과 → 타임뱅크가 남아 있으면 자동 사용해 연장, 다 쓰면 자동 체크/폴드
      const current = this.rooms.get(roomId);
      const stillActive = current?.engine.state.players[current.engine.state.activePlayerIndex];
      if (
        current && stillActive && stillActive.id === activePlayer.id
        && current.engine.state.isHandInProgress
        && (stillActive.timeBankChips ?? 0) > 0
      ) {
        stillActive.timeBankChips = (stillActive.timeBankChips ?? 0) - 1;
        this.sendSystemChat(
          roomId,
          `${stillActive.name}님 시간 초과 — 타임뱅크 자동 사용 (+${TIME_BANK_EXTEND_MS / 1000}초, 남은 타임칩 ${stillActive.timeBankChips}개)`,
        );
        this.startTurnTimer(roomId, TIME_BANK_EXTEND_MS);
        this.onUpdate(roomId, current.engine);
        return;
      }

      this.autoActFor(roomId, activePlayer.id, '시간 초과');
    }, timeoutMs);

    this.turnTimers.set(roomId, timer);
  }

  /** 자리비움 토글 — 핸드 중이면 다음 핸드부터 적용, 아니면 즉시 */
  toggleSitOut(roomId: string, playerId: string): void {
    const room = this.rooms.get(roomId);
    if (!room) return;
    const player = room.engine.state.players.find(p => p.id === playerId);
    if (!player || player.pendingRemoval) return;

    const sittingOut = player.sitOutNext || player.status === 'sitting-out';
    if (sittingOut) {
      player.sitOutNext = false;
      if (player.status === 'sitting-out' && player.chips > 0 && !player.isDisconnected) {
        player.status = 'waiting';
      }
      this.sendSystemChat(roomId, `${player.name}님이 게임에 복귀했습니다.`);
      this.onUpdate(roomId, room.engine);
      this.tryStartGame(roomId);
    } else {
      player.sitOutNext = true;
      // 진행 중인 핸드에 참여하고 있지 않으면 즉시 적용
      const inHand = room.engine.state.isHandInProgress
        && (player.status === 'active' || player.status === 'all-in');
      if (!inHand) {
        player.status = 'sitting-out';
      }
      this.sendSystemChat(roomId, `${player.name}님이 자리를 비웁니다${inHand ? ' (다음 핸드부터)' : ''}.`);
      this.onUpdate(roomId, room.engine);
    }
  }

  /** 타임칩 사용 — 본인 턴에 남은 시간 +30초 */
  useTimeBank(roomId: string, playerId: string): void {
    const room = this.rooms.get(roomId);
    if (!room || !room.engine.state.isHandInProgress) return;
    const activePlayer = room.engine.state.players[room.engine.state.activePlayerIndex];
    if (!activePlayer || activePlayer.id !== playerId || activePlayer.type !== 'human') return;
    if ((activePlayer.timeBankChips ?? 0) <= 0) return;

    activePlayer.timeBankChips = (activePlayer.timeBankChips ?? 0) - 1;
    const remaining = this.getTurnTimeRemaining(roomId);
    this.startTurnTimer(roomId, remaining + TIME_BANK_EXTEND_MS);
    this.sendSystemChat(roomId, `${activePlayer.name}님이 타임칩을 사용했습니다 (+${TIME_BANK_EXTEND_MS / 1000}초).`);
    this.onUpdate(roomId, room.engine);
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
        // Bot chat based on action — 올인은 극적인 순간이라 AI 대사 시도, 나머지는 스크립트
        const character = getCharacterById(activePlayer.personalityId || '');
        if (character && action.action === 'all-in') {
          const situation = `방금 남은 칩 전부를 걸고 올인을 선언했다 (${room.engine.state.street} 단계). 긴장감 있는 한마디.`;
          void this.botQuip(roomId, activePlayer, situation, Math.random() < 0.4 ? character.bluffQuote : null);
        } else if (character && Math.random() < 0.4) {
          let msg = '';
          switch (action.action) {
            case 'fold': msg = character.foldQuote; break;
            case 'raise': msg = character.bluffQuote; break;
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

    // 시트앤고: 탈락/우승 공지 후, 종료됐으면 다음 핸드를 잡지 않는다
    const room = this.rooms.get(roomId);
    if (room?.engine.state.tournament) {
      this.announceTournamentProgress(roomId);
      if (room.engine.state.tournament.finished) {
        this.onUpdate(roomId, room.engine);
        return;
      }
    }

    // 승리 연출 시퀀스(~5.5s)가 끝난 뒤 다음 핸드 시작
    const timer = setTimeout(() => {
      this.pendingStartTimers.delete(roomId);
      this.startNewHand(roomId);
    }, 6500);
    this.pendingStartTimers.set(roomId, timer);
  }

  /** 시간 경과에 따라 블라인드 레벨 인상 — 핸드 사이에만 호출 */
  private applyBlindLevel(roomId: string): void {
    const room = this.rooms.get(roomId);
    const clock = this.tournamentClocks.get(roomId);
    const tournament = room?.engine.state.tournament;
    if (!room || !clock || !tournament) return;

    const idx = levelIndexAt(clock.startedAt, Date.now());
    const level = idx + 1;
    if (level === tournament.level) return;

    const cur = SNG_BLIND_SCHEDULE[idx];
    const next = SNG_BLIND_SCHEDULE[idx + 1] ?? null;
    const isLast = idx >= SNG_BLIND_SCHEDULE.length - 1;
    room.engine.setTournamentLevel(
      level,
      cur.smallBlind,
      cur.bigBlind,
      next?.smallBlind ?? null,
      next?.bigBlind ?? null,
      isLast ? 0 : clock.startedAt + (idx + 1) * SNG_LEVEL_DURATION_MS,
    );
    this.sendSystemChat(roomId, `블라인드 인상 — 레벨 ${level}: ${cur.smallBlind}/${cur.bigBlind}`);
  }

  /** 새로 확정된 탈락/우승을 시스템 채팅으로 공지 */
  private announceTournamentProgress(roomId: string): void {
    const room = this.rooms.get(roomId);
    const clock = this.tournamentClocks.get(roomId);
    const tournament = room?.engine.state.tournament;
    if (!room || !clock || !tournament) return;

    const results = [...tournament.results].sort((a, b) => b.place - a.place); // 낮은 순위부터 공지
    const fresh = results.length - clock.announcedResults;
    if (fresh <= 0) return;

    for (const r of results.slice(0, fresh)) {
      if (r.place === 1) continue; // 우승은 아래 종합 공지에서
      const prizeText = r.prize > 0 ? ` (상금 ${r.prize.toLocaleString()})` : '';
      this.sendSystemChat(roomId, `${r.name}님이 ${r.place}위로 탈락했습니다${prizeText}.`);

      // 탈락한 봇의 퇴장 대사 (AI 시도 → 실패 시 loseQuote)
      const busted = room.engine.state.players.find(p => p.id === r.playerId);
      if (busted?.type === 'bot') {
        const character = getCharacterById(busted.personalityId || '');
        if (character) {
          const situation = `Sit & Go 토너먼트에서 ${r.place}위로 탈락이 확정됐다`
            + (r.prize > 0 ? ` (상금 ${r.prize.toLocaleString()} 획득)` : ' (상금 없음)') + '. 퇴장 인사.';
          void this.botQuip(roomId, busted, situation, character.loseQuote);
        }
      }
    }
    clock.announcedResults = results.length;

    if (tournament.finished) {
      const podium = [...tournament.results]
        .filter(r => r.place <= 3)
        .sort((a, b) => a.place - b.place)
        .map(r => `${r.place}위 ${r.name}${r.prize > 0 ? ` +${r.prize.toLocaleString()}` : ''}`)
        .join(' · ');
      this.sendSystemChat(roomId, `🏆 Sit & Go 종료! ${podium}`);

      // 우승한 봇의 우승 소감 (AI 시도 → 실패 시 winQuote)
      const champ = tournament.results.find(r => r.place === 1);
      const champPlayer = champ && room.engine.state.players.find(p => p.id === champ.playerId);
      if (champ && champPlayer?.type === 'bot') {
        const character = getCharacterById(champPlayer.personalityId || '');
        if (character) {
          const situation = `Sit & Go 토너먼트에서 최종 우승했다 (상금 ${champ.prize.toLocaleString()}). 우승 소감 한마디.`;
          void this.botQuip(roomId, champPlayer, situation, character.winQuote);
        }
      }
    }
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

  /**
   * 봇 상황 대사 — AI 생성 시도 후 실패/게이팅 차단 시 fallback 스크립트 대사.
   * fallback이 null이면 침묵. 비동기 응답 시점에 방/좌석이 사라졌으면 버린다.
   */
  private async botQuip(roomId: string, player: Player, situation: string, fallback: string | null): Promise<void> {
    const line = await this.ai.generateLine(roomId, player.personalityId || '', situation);
    const room = this.rooms.get(roomId);
    if (!room || !room.engine.state.players.some(p => p.id === player.id)) return;
    const text = line ?? fallback;
    if (text) this.sendBotChat(roomId, player.id, player.name, text);
  }

  private announceWinner(roomId: string): void {
    const room = this.rooms.get(roomId);
    if (!room || !room.engine.state.winners) return;

    const bb = room.engine.state.bigBlind || 1;

    for (const winner of room.engine.state.winners) {
      const player = room.engine.state.players.find(p => p.id === winner.playerId);
      if (!player) continue;

      const handDesc = winner.hand ? ` with ${winner.hand.description}` : '';
      this.sendSystemChat(roomId, `${player.name}님이 ${winner.amount.toLocaleString()} 칩을 획득했습니다${handDesc}!`);

      // Winner character quote — 큰 팟이면 AI 상황 대사 시도, 아니면/실패 시 스크립트
      if (player.type === 'bot') {
        const character = getCharacterById(player.personalityId || '');
        if (character) {
          const bigPot = winner.amount >= bb * 15;
          if (bigPot) {
            const situation = `방금 팟 ${winner.amount.toLocaleString()} 칩을 이겼다`
              + (winner.hand ? ` (핸드: ${winner.hand.description})` : ' (상대가 모두 폴드)') + '. 승리 한마디.';
            void this.botQuip(roomId, player, situation, character.winQuote);
          } else {
            this.sendBotChat(roomId, player.id, player.name, character.winQuote);
          }
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
