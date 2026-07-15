import { PokerEngine } from '../lib/poker/engine';
import { HAND_RANK_KO } from '../lib/poker/evaluator';
import { RoomConfig, Player, ChatMessage, ActionType } from '../lib/poker/types';
import { fillEmptySeats, processBotTurn } from '../lib/bot/bot-manager';
import { getCharacterById } from '../lib/characters';
import { SNG_BLIND_SCHEDULE, SNG_LEVEL_DURATION_MS, levelIndexAt } from '../lib/poker/blind-schedule';
import { SITOUT_MISSED_BB_LIMIT, SITOUT_ABANDON_MS, shouldRemoveForMissedBlinds } from './sitout';
import { AIDialogue } from './ai-dialogue';
import { DialogueManager } from './dialogue-manager';

const DEFAULT_TURN_TIMEOUT_S = 8; // config.turnTime 미설정 시 폴백 (초) — 짧은 기본 + 타임뱅크 자동 연장
const DISCONNECTED_AUTO_ACT_MS = 1_000; // 끊긴 플레이어 턴 자동 처리 지연
const TIME_BANK_EXTEND_MS = 30_000; // 타임칩 1개당 연장 시간

export class RoomManager {
  private rooms: Map<string, { engine: PokerEngine; config: RoomConfig; createdAt: number; persistent?: boolean }> = new Map();
  private chatHistory: Map<string, ChatMessage[]> = new Map();
  private botIntervals: Map<string, NodeJS.Timeout> = new Map();
  /** 봇 루프 세대 — stopBotLoop마다 증가. await(사고 지연) 중이던 이전 루프가 깨어나도 진행 못 하게 한다 */
  private botLoopEpochs: Map<string, number> = new Map();
  private pendingStartTimers: Map<string, NodeJS.Timeout> = new Map();
  private turnTimers: Map<string, NodeJS.Timeout> = new Map();
  private turnDeadlines: Map<string, number> = new Map();
  /** 자리비움 후 방을 떠난 좌석의 최종 정리 타이머 — 키 `${roomId}:${playerId}` (복귀 시 취소) */
  private sitOutAbandonTimers: Map<string, NodeJS.Timeout> = new Map();
  /** 시트앤고 진행 시계 — 블라인드 레벨 산정 기준 + 탈락 공지 커서 */
  private tournamentClocks: Map<string, { startedAt: number; announcedResults: number }> = new Map();
  /** AI 상황 대사 (키 없으면 비활성 — 스크립트 대사만) */
  private dialogue = new DialogueManager(new AIDialogue());
  private onUpdate: (roomId: string, engine: PokerEngine) => void;
  private onChat: (roomId: string, message: ChatMessage) => void;
  /** 좌석 구성이 서버 내부에서 바뀔 때(자동 정리 등) 로비 목록 재브로드캐스트 훅 */
  private onRoomsChanged?: () => void;

  constructor(
    onUpdate: (roomId: string, engine: PokerEngine) => void,
    onChat: (roomId: string, message: ChatMessage) => void,
    onRoomsChanged?: () => void,
  ) {
    this.onUpdate = onUpdate;
    this.onChat = onChat;
    this.onRoomsChanged = onRoomsChanged;
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
        this.botLoopEpochs.delete(id);
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

  /**
   * 로비 방 목록. forPlayerId를 주면 그 플레이어가 보존 중인 좌석(자리비움 이탈 등)을
   * mySeat으로 표시한다 — 클라이언트는 이걸로 바이인/비밀번호 없이 '게임 복귀' UI를 띄운다.
   * pendingRemoval 좌석은 정리 예약이므로 내 좌석으로 치지 않는다.
   */
  getRoomList(forPlayerId?: string): Array<{
    id: string; name: string; playerCount: number; maxPlayers: number;
    blinds: string; status: string; mode: string; locked: boolean;
    hasPassword: boolean; bigBlind: number; minBuyIn: number; maxBuyIn: number;
    difficulty: string; turnTime: number; humanCount: number; tableType: string;
    mySeat?: { chips: number; sittingOut: boolean };
  }> {
    const list: ReturnType<RoomManager['getRoomList']> = [];
    this.rooms.forEach((room, id) => {
      const tournament = room.engine.state.tournament;
      const seat = forPlayerId
        ? room.engine.state.players.find(p => p.id === forPlayerId && !p.pendingRemoval)
        : undefined;
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
        difficulty: room.config.difficulty ?? 'normal',
        turnTime: room.config.turnTime,
        // 봇 좌석은 만석 판정에서 제외 — 휴먼이 오면 봇이 자리를 양보한다
        humanCount: room.engine.state.players.filter(p => p.type === 'human').length,
        // 인원 구성 — 명시 설정이 없는 구방은 botCount로 유도 (0=사람만, 그 외=봇+사람)
        tableType: room.config.tableType ?? ((room.config.botCount ?? 2) === 0 ? 'humans' : 'mixed'),
        ...(seat
          ? {
              mySeat: {
                chips: seat.chips,
                sittingOut: !!seat.sitOutNext || seat.status === 'sitting-out',
              },
            }
          : {}),
      });
    });
    return list;
  }

  /** 좌석 복귀/리바이 후 상태 브로드캐스트 + 게임 재개 시도 (join 경로 밖 공개 래퍼) */
  resumeRoom(roomId: string): void {
    const room = this.rooms.get(roomId);
    if (!room) return;
    this.onUpdate(roomId, room.engine);
    this.tryStartGame(roomId);
  }

  joinRoom(roomId: string, player: Player): boolean {
    const room = this.rooms.get(roomId);
    if (!room) return false;
    // 봇 전용 연습 테이블은 휴먼 1명만 — 다른 휴먼이 이미 앉아 있으면 거절
    if (
      player.type === 'human' && room.config.tableType === 'bots'
      && room.engine.state.players.some(p => p.type === 'human' && !p.pendingRemoval && p.id !== player.id)
    ) {
      return false;
    }
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

    fillEmptySeats(room.engine, room.config.maxPlayers, room.config.startingStack, room.config.difficulty);
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
    // 좌석이 정리되므로 남아 있던 자리비움 최종 정리 타이머도 취소 (orphan 방지)
    this.cancelSitOutAbandon(roomId, playerId);

    const { player, handComplete } = room.engine.processLeave(playerId);
    if (player) {
      this.sendSystemChat(roomId, `${player.name}님이 테이블을 떠났습니다.`);
    }

    // Clean up empty rooms — 제거 예약자는 휴먼 수에서 제외.
    const humans = room.engine.state.players.filter(p => p.type === 'human' && !p.pendingRemoval);
    if (humans.length === 0) {
      this.stopBotLoop(roomId);
      this.clearPendingStart(roomId);
      this.clearTurnTimer(roomId);
      if (room.persistent) {
        // 영속(기본 로비) 방은 삭제하지 않고 대기 상태로 리셋 — 남은 봇/진행 중 핸드를 비워
        // 다음 입장자가 깨끗한 테이블에서 시작하게 한다 (안 그러면 isHandInProgress로 얼어붙음)
        this.resetRoomToIdle(roomId);
      } else {
        this.rooms.delete(roomId);
        this.chatHistory.delete(roomId);
        this.tournamentClocks.delete(roomId);
        this.botLoopEpochs.delete(roomId);
      }
      // 방 삭제/리셋까지 끝난 뒤 로비 목록 반영
      if (player) this.onRoomsChanged?.();
      return;
    }

    // 서버 내부 자동 정리(미납 블라인드/방치 회수 등)도 로비 목록에 즉시 반영 —
    // 자리비움 좌석의 '게임 복귀' 배너가 죽은 좌석을 가리키지 않게 한다
    if (player) this.onRoomsChanged?.();

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

  /**
   * 영속 방을 대기 상태로 초기화 — 휴먼이 모두 떠났을 때 호출.
   * 남은 봇을 비우고 진행 중이던 핸드를 정리해, 다음 입장자가 새 핸드를 깨끗이 시작하게 한다.
   */
  private resetRoomToIdle(roomId: string): void {
    const room = this.rooms.get(roomId);
    if (!room) return;
    const s = room.engine.state;
    s.players = [];
    s.isHandInProgress = false;
    s.winners = null;
    s.communityCards = [];
    s.pots = [{ amount: 0, eligiblePlayerIds: [] }];
    s.currentBet = 0;
    s.minRaise = s.bigBlind;
    s.activePlayerIndex = -1;
    s.dealerIndex = 0;
    s.street = 'preflop';
    s.lastAction = null;
    this.tournamentClocks.delete(roomId);
    if (s.tournament) {
      s.tournament.level = 1;
      s.tournament.entrants = 0;
      s.tournament.finished = false;
      s.tournament.results = [];
      s.tournament.prizes = [];
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
      // 캐시 게임: 봇은 설정 수(botCount, 기본 2)까지만 충원 — 나머지 좌석은 휴먼 몫.
      // 솔로용 영속 방은 botCount=5 (캐릭터 6명 중 히어로 프로필을 제외한 5명이 등장).
      const humans = room.engine.state.players.filter(p => p.type === 'human').length;
      const bots = room.engine.state.players.length - humans;
      const targetBots = Math.min(room.config.botCount ?? 2, room.config.maxPlayers - humans);
      if (bots < targetBots) {
        fillEmptySeats(room.engine, humans + targetBots, undefined, room.config.difficulty);
      }
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

    // Reset folded/waiting players.
    // 캐시: 접속 끊김(grace)·자리비움은 새 핸드에 딜인하지 않음 (미납 BB 카운트로 정리).
    // SnG: 자리비움/끊김도 딜인 유지 — 블라인드는 계속 나가고 턴은 자동 폴드 (블라인드 회피 방지).
    const isSng = !!tournament;
    for (const p of room.engine.state.players) {
      if (p.chips > 0) {
        const out = !isSng && (p.isDisconnected || p.sitOutNext);
        p.status = out ? 'sitting-out' : 'waiting';
        // 캐시 자리비움 시작 시점 기록 (미납 오르빗 산정 기준). 복귀하면 clear.
        if (out) {
          if (p.sitOutSinceHand === undefined) p.sitOutSinceHand = room.engine.state.handNumber;
        } else {
          p.sitOutSinceHand = undefined;
        }
      }
    }

    const prevHandNumber = room.engine.state.handNumber;
    room.engine.startHand();

    if (!room.engine.state.isHandInProgress) {
      if (room.engine.state.handNumber > prevHandNumber) {
        // 딜은 됐지만 블라인드 전원 올인 런아웃으로 즉시 쇼다운까지 끝난 핸드 — 정상 종료 플로우
        this.onUpdate(roomId, room.engine);
        this.announceWinner(roomId);
        this.scheduleNextHand(roomId);
      } else {
        // 이탈자 제거 후 인원 부족 등으로 핸드가 시작되지 못함 — 봇 충원 경로로 재시도
        this.tryStartGame(roomId);
      }
      return;
    }

    const dealer = getCharacterById('dealer');
    if (dealer) {
      this.sendBotChat(roomId, 'dealer', dealer.name, dealer.chatMessages[0]);
    }

    // 타이머를 먼저 시작해야 스냅샷에 turnTimeRemaining이 실린다
    this.startPlayerLoop(roomId);
    this.onUpdate(roomId, room.engine);

    // 캐시: 자리비움 좌석이 대략 2오르빗(미납 BB 2회)을 넘기면 자동 정리
    if (!isSng) this.trackMissedBlinds(roomId);
  }

  /** 캐시 자리비움 좌석의 경과 핸드를 오르빗으로 환산해, 한도 초과 시 자리를 정리한다 */
  private trackMissedBlinds(roomId: string): void {
    const room = this.rooms.get(roomId);
    if (!room) return;
    const st = room.engine.state;
    // 한 오르빗 ≈ 참여했다면 로테이션에 들어갔을 좌석 수 (칩 보유 인원)
    const orbitSize = st.players.filter(p => p.chips > 0 && !p.pendingRemoval).length;

    const toRemove: Player[] = [];
    for (const p of st.players) {
      if (p.type !== 'human' || p.pendingRemoval || p.chips <= 0) continue;
      if (p.status !== 'sitting-out' || p.sitOutSinceHand === undefined) continue;
      const handsSatOut = st.handNumber - p.sitOutSinceHand;
      if (shouldRemoveForMissedBlinds(handsSatOut, orbitSize)) toRemove.push(p);
    }
    for (const p of toRemove) {
      this.sendSystemChat(roomId, `${p.name}님이 빅블라인드를 ${SITOUT_MISSED_BB_LIMIT}번 걸러 자리에서 일어납니다.`);
      this.leaveRoom(roomId, p.id);
    }
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

  // --- 자리비움 후 이탈 좌석의 최종 정리 타이머 ---

  private abandonKey(roomId: string, playerId: string): string {
    return `${roomId}:${playerId}`;
  }

  /** 자리비움 상태로 자리를 떠난 좌석에 최종 정리 유예를 건다 (캐시 전용 — SnG는 블라인드 소진에 맡김) */
  private scheduleSitOutAbandon(roomId: string, playerId: string): void {
    const key = this.abandonKey(roomId, playerId);
    const existing = this.sitOutAbandonTimers.get(key);
    if (existing) clearTimeout(existing);
    const timer = setTimeout(() => {
      this.sitOutAbandonTimers.delete(key);
      const r = this.rooms.get(roomId);
      const p = r?.engine.state.players.find(pl => pl.id === playerId);
      if (p && (p.sitOutNext || p.status === 'sitting-out')) {
        this.sendSystemChat(roomId, `${p.name}님이 오랫동안 돌아오지 않아 자리를 정리했어요.`);
        this.leaveRoom(roomId, p.id);
      }
    }, SITOUT_ABANDON_MS);
    this.sitOutAbandonTimers.set(key, timer);
  }

  /** 좌석 복귀/제거 시 최종 정리 타이머 취소 */
  private cancelSitOutAbandon(roomId: string, playerId: string): void {
    const key = this.abandonKey(roomId, playerId);
    const t = this.sitOutAbandonTimers.get(key);
    if (t) {
      clearTimeout(t);
      this.sitOutAbandonTimers.delete(key);
    }
  }

  /**
   * 자리비움 토글. 공통: 내 턴이 오면 자동 체크/폴드 — 자리에 없는 사람을 기다리지 않는다
   * (누른 순간이 본인 턴이면 즉시 처리, 아니면 startPlayerLoop가 턴 도래 시 처리).
   * 캐시: 다음 핸드부터 딜인 제외 + 대략 2오르빗(미납 BB 2회)을 넘기면 자동 정리 (trackMissedBlinds).
   * SnG: 딜인/블라인드 유지 (away) — 블라인드 소진으로 자연 탈락, 좌석은 토너먼트 종료까지 보존.
   */
  toggleSitOut(roomId: string, playerId: string): void {
    const room = this.rooms.get(roomId);
    if (!room) return;
    const player = room.engine.state.players.find(p => p.id === playerId);
    if (!player || player.pendingRemoval) return;

    const isSng = room.config.gameMode === 'sng';
    const sittingOut = player.sitOutNext || player.status === 'sitting-out';
    if (sittingOut) {
      // --- 게임 복귀 ---
      player.sitOutNext = false;
      player.sitOutSinceHand = undefined;
      this.cancelSitOutAbandon(roomId, playerId);
      if (player.status === 'sitting-out' && player.chips > 0 && !player.isDisconnected) {
        player.status = 'waiting';
      }
      this.sendSystemChat(roomId, `${player.name}님이 게임에 복귀했습니다.`);
      // SnG away 상태에서 내 턴 자동 폴드 타이머가 걸려 있었다면, 복귀 즉시 정상 턴으로 되돌린다
      const active = room.engine.state.players[room.engine.state.activePlayerIndex];
      if (room.engine.state.isHandInProgress && active?.id === playerId) {
        this.startPlayerLoop(roomId);
      }
      this.onUpdate(roomId, room.engine);
      this.tryStartGame(roomId);
      return;
    }

    // --- 자리비움 시작 ---
    player.sitOutNext = true;
    const inHand = room.engine.state.isHandInProgress
      && (player.status === 'active' || player.status === 'all-in');
    // 캐시는 핸드에 끼어 있지 않으면 즉시 자리비움 확정 (핸드 중이면 다음 핸드 딜인에서 제외된다)
    if (!isSng && !inHand) player.status = 'sitting-out';
    this.sendSystemChat(
      roomId,
      isSng
        ? `${player.name}님이 자리를 비웁니다 — 돌아올 때까지 자동 폴드돼요 (블라인드는 계속 차감).`
        : `${player.name}님이 자리를 비웁니다 — 빅블라인드를 ${SITOUT_MISSED_BB_LIMIT}번 거르면 자동으로 일어나요.`,
    );
    // 지금이 본인 턴이면 즉시 자동 처리 — 자리에 없는 사람을 테이블이 기다리지 않게 (캐시/SnG 공통).
    // 이게 없으면 턴 타이머 + 타임뱅크가 모두 소진될 때까지(최대 38초) 게임이 멈춘다.
    if (inHand) {
      const active = room.engine.state.players[room.engine.state.activePlayerIndex];
      if (active?.id === playerId) {
        this.clearTurnTimer(roomId);
        this.autoActFor(roomId, playerId, '자리비움');
        return; // autoActFor가 onUpdate/루프 재개까지 처리
      }
    }
    this.onUpdate(roomId, room.engine);
  }

  /** 자리비움 상태로 방을 떠남 — 좌석/칩 유지 (leave-room mode:'sitout') */
  sitOutAndLeave(roomId: string, playerId: string): void {
    const room = this.rooms.get(roomId);
    if (!room) return;
    const player = room.engine.state.players.find(p => p.id === playerId);
    if (!player || player.pendingRemoval) return;

    const already = player.sitOutNext || player.status === 'sitting-out';
    if (!already) this.toggleSitOut(roomId, playerId);

    // 떠난 뒤 지금이 본인 턴이면(핸드 중 이탈) 즉시 자동 처리 — 남은 플레이어가 기다리지 않게
    if (room.engine.state.isHandInProgress) {
      const active = room.engine.state.players[room.engine.state.activePlayerIndex];
      if (active?.id === playerId) {
        this.clearTurnTimer(roomId);
        this.autoActFor(roomId, playerId, '자리비움');
      }
    }

    // 캐시: 돌아오지 않아도 확실히 회수되도록 최종 정리 유예 (SnG는 블라인드 소진 → 자연 탈락)
    if (room.config.gameMode !== 'sng') {
      this.scheduleSitOutAbandon(roomId, playerId);
    }
  }

  /**
   * 재접속 grace 만료 처리. 좌석을 유지하면 true.
   * - SnG: 무조건 좌석 보존 (자리비움 여부 무관) — 딜인 유지로 블라인드 소진 → 자연 탈락에 맡긴다.
   * - 캐시 자리비움: 유지하되, 핸드가 돌지 않는 방까지 위해 최종 정리 유예를 건다.
   * - 캐시 비자리비움: 즉시 이탈.
   */
  handleGraceExpired(roomId: string, playerId: string): boolean {
    const room = this.rooms.get(roomId);
    const player = room?.engine.state.players.find(p => p.id === playerId);
    if (!room || !player) {
      this.leaveRoom(roomId, playerId);
      return false;
    }
    const isSng = room.config.gameMode === 'sng';
    const sittingOut = player.sitOutNext || player.status === 'sitting-out';
    const keep = isSng || sittingOut;
    if (!keep) {
      this.leaveRoom(roomId, playerId);
      return false;
    }
    // 캐시 자리비움 이탈: 최종 정리 유예 (SnG는 유예 없이 블라인드 소진에 맡김)
    if (!isSng) this.scheduleSitOutAbandon(roomId, playerId);
    return true;
  }

  /**
   * 자리비움 좌석으로 재입장(join-room 멱등 경로)했을 때의 처리.
   * 좌석은 자리비움 상태 그대로 두고(본인이 '게임 복귀'를 눌러 참여), 최종 정리 유예만 취소한다 —
   * 다시 자리에 앉아 있으니 방치로 회수되면 안 된다. (복귀는 toggleSitOut이 담당)
   */
  handleSeatRejoin(roomId: string, playerId: string): void {
    this.cancelSitOutAbandon(roomId, playerId);
  }

  /** 다른 방에 남아 있는 좌석 정리 — 새 방 착석 시 자리비움 좌석 회수 (1세션 1테이블) */
  leaveAllSeatsExcept(playerId: string, exceptRoomId: string): void {
    this.rooms.forEach((room, id) => {
      if (id === exceptRoomId) return;
      if (room.engine.state.players.some(p => p.id === playerId && !p.pendingRemoval)) {
        this.leaveRoom(id, playerId);
      }
    });
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

    const result = room.engine.processAction({ playerId, type: action, amount: 0 });

    if (result.valid) {
      this.sendSystemChat(roomId, `${activePlayer.name}님 ${reason} — 자동 ${action === 'check' ? '체크' : '폴드'}되었습니다.`);
      if (result.handComplete) {
        this.onUpdate(roomId, room.engine);
        this.announceWinner(roomId);
        this.scheduleNextHand(roomId);
      } else {
        // 타이머를 먼저 시작해야 스냅샷에 turnTimeRemaining이 실린다
        this.startPlayerLoop(roomId);
        this.onUpdate(roomId, room.engine);
      }
    } else {
      // 자동 액션이 거부됨(그 사이 상태 변화) — 현재 액터 기준으로 루프를 재정렬해 교착 방지
      this.startPlayerLoop(roomId);
      this.onUpdate(roomId, room.engine);
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
    // 돌아왔으니 최종 정리 유예 취소
    this.cancelSitOutAbandon(roomId, playerId);
    // 명시적 자리비움(sitOutNext)은 재접속만으로 해제하지 않는다 — 본인이 복귀 버튼을 눌러야 함
    if (player.status === 'sitting-out' && player.chips > 0 && !player.sitOutNext) {
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

    // 즉시 자동 처리 대상: 접속 끊김(부재) 또는 자리비움(캐시·SnG 공통).
    // 자리비움은 "나는 이 자리에 없다"는 선언이므로 그 사람의 턴을 기다리지 않는다 — 기다리면
    // 타임뱅크까지 소진되며 테이블이 최대 38초 멈춘다. 팟에 이미 넣은 칩은 체크 가능하면
    // 체크로 지켜진다(autoActFor). 캐시/SnG 차이는 딜인 여부일 뿐 턴 처리는 동일.
    const autoAct = activePlayer.isDisconnected || !!activePlayer.sitOutNext;
    if (activePlayer.type === 'bot') {
      this.startBotLoop(roomId);
    } else if (autoAct) {
      this.clearTurnTimer(roomId);
      const reason = activePlayer.isDisconnected ? '접속 끊김' : '자리비움';
      const timer = setTimeout(() => {
        this.turnTimers.delete(roomId);
        this.autoActFor(roomId, activePlayer.id, reason);
      }, DISCONNECTED_AUTO_ACT_MS);
      this.turnTimers.set(roomId, timer);
    } else {
      // 휴먼 턴 → 타이머 시작
      this.startTurnTimer(roomId);
    }
  }

  private startBotLoop(roomId: string): void {
    this.stopBotLoop(roomId);
    const epoch = this.botLoopEpochs.get(roomId) ?? 0;
    const isStale = () => (this.botLoopEpochs.get(roomId) ?? 0) !== epoch;

    const loop = async () => {
      if (isStale()) return;
      const room = this.rooms.get(roomId);
      if (!room || !room.engine.state.isHandInProgress) return;

      const activePlayer = room.engine.state.players[room.engine.state.activePlayerIndex];
      if (!activePlayer || activePlayer.type !== 'bot') {
        // 다음 플레이어가 봇이 아니면 → 휴먼 턴 처리(타이머/접속 끊김 지연)로 위임
        this.startPlayerLoop(roomId);
        return;
      }

      const { acted, action } = await processBotTurn(room.engine, isStale);
      if (isStale()) return; // 사고 지연 중 루프가 교체됨 — 새 루프가 진행을 소유
      if (acted && action) {
        // Bot chat based on action — 올인은 극적인 순간이라 AI 대사 시도, 나머지는 스크립트
        const character = getCharacterById(activePlayer.personalityId || '');
        if (character && action.action === 'all-in') {
          const situation = `방금 남은 칩 전부를 걸고 올인을 선언했다 (${room.engine.state.street} 단계). 긴장감 있는 한마디.`;
          void this.botQuip(roomId, activePlayer, 'all-in', situation, Math.random() < 0.4 ? character.bluffQuote : null);
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
          void this.botQuip(roomId, busted, r.prize > 0 ? 'sng-bust-prize' : 'sng-bust-noprize', situation, character.loseQuote);
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
          void this.botQuip(roomId, champPlayer, 'sng-champ', situation, character.winQuote);
        }
      }
    }
  }

  stopBotLoop(roomId: string): void {
    // 세대 증가 — 사고 지연(await) 중인 in-flight 루프는 타이머 클리어로 멈출 수 없으므로
    // 깨어난 뒤 세대 불일치를 보고 스스로 중단한다 (중복 루프/이중 액션 방지)
    this.botLoopEpochs.set(roomId, (this.botLoopEpochs.get(roomId) ?? 0) + 1);
    const interval = this.botIntervals.get(roomId);
    if (interval) {
      clearTimeout(interval);
      this.botIntervals.delete(roomId);
    }
  }

  processPlayerAction(roomId: string, playerId: string, actionType: ActionType, amount: number = 0): boolean {
    const room = this.rooms.get(roomId);
    if (!room) return false;

    const result = room.engine.processAction({
      playerId,
      type: actionType,
      amount,
    });

    // 검증 통과 후에만 타이머 클리어 — 잘못된(또는 남의 턴) 액션이 현재 액터의 턴 시계를 죽이면
    // 자동 체크/폴드가 사라져 게임이 멈춘다
    if (!result.valid) return false;
    this.clearTurnTimer(roomId);

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
   * 봇 상황 대사 — 캐시 재사용/AI 생성(DialogueManager 3층 전략) 후 실패 시 fallback 스크립트.
   * fallback이 null이면 침묵. 비동기 응답 시점에 방/좌석이 사라졌으면 버린다.
   */
  private async botQuip(
    roomId: string,
    player: Player,
    situationKey: string,
    situation: string,
    fallback: string | null,
  ): Promise<void> {
    const line = await this.dialogue.getLine(roomId, player.personalityId || '', situationKey, situation);
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

      const handDesc = winner.hand ? ` — ${HAND_RANK_KO[winner.hand.rank]}` : '';
      this.sendSystemChat(roomId, `${player.name}님이 ${winner.amount.toLocaleString()} 칩을 획득했습니다${handDesc}!`);

      // Winner character quote — 큰 팟이면 AI 상황 대사 시도, 아니면/실패 시 스크립트
      if (player.type === 'bot') {
        const character = getCharacterById(player.personalityId || '');
        if (character) {
          const bigPot = winner.amount >= bb * 15;
          if (bigPot) {
            const situation = `방금 팟 ${winner.amount.toLocaleString()} 칩을 이겼다`
              + (winner.hand ? ` (핸드: ${winner.hand.description})` : ' (상대가 모두 폴드)') + '. 승리 한마디.';
            void this.botQuip(roomId, player, 'bigpot-win', situation, character.winQuote);
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
