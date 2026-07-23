import { randomUUID } from 'node:crypto';
import { ARENA_CONFIG_V1 } from '../lib/arena/config';
import { PokerEngine, type EngineRuntimeHooks } from '../lib/poker/engine';
import { cfg } from './game-config/live';
import { HAND_RANK_KO } from '../lib/poker/evaluator';
import {
  RoomConfig,
  Player,
  ChatMessage,
  ActionType,
  type GameMode,
  type GameState,
  type PlayerPublicCosmetics,
} from '../lib/poker/types';
import type { CompletedHandRecord } from '../lib/poker/hand-history';
import { createBotWithCharacter, fillEmptySeats, processBotTurn } from '../lib/bot/bot-manager';
import { AggroTracker } from '../lib/bot/aggro-tracker';
import { getCharacterById } from '../lib/characters';
import { SNG_BLIND_SCHEDULE, SNG_LEVEL_DURATION_MS, levelIndexAt } from '../lib/poker/blind-schedule';
import { shouldRemoveForMissedBlinds } from './sitout';
import { THROW_FLIGHT_MS } from '../lib/throwables/catalog';
import { AIDialogue } from './ai-dialogue';
import { DialogueManager } from './dialogue-manager';
import { eventLog, handSettlementLogFields } from './event-log';
import type { RoomListItem } from '../lib/realtime/protocol';
import type {
  CashHandPersistenceResult,
  RoomEconomyHooks,
} from './economy-runtime';
import type { RoomProgressionHooks, RuntimeGameMode } from './progression-runtime';
import type { ArenaOfficialSummary } from './arena-service';

/** 엔진에 주입하는 서버 런타임 훅 — 레이크 정책을 정산 시점마다 핫 컨피그에서 읽는다 */
const ENGINE_RUNTIME_HOOKS: EngineRuntimeHooks = {
  rakePolicy: () => ({
    rateBps: cfg('economy.rakeBps'),
    capBB: cfg('economy.rakeCapBB'),
  }),
};

// 턴 타임 폴백·자동 처리 지연·런아웃 간격은 핫 컨피그로 이동 —
// cfg('timer.*')를 사용 시점마다 읽는다 (기본값 정의는 game-config/registry.ts)
/** 타임칩 연장 시간 — 클라 3곳(도움말·액션바·방 만들기)에 "+30초" 문구가 하드코딩되어 있어
 *  핫 컨피그 제외 (변경하려면 문구와 함께 코드 수정) */
const TIME_BANK_EXTEND_MS = 30_000;
const DEFAULT_SNG_RETENTION_MS = 10 * 60_000;
/** 마지막 휴먼이 떠난 캐시 유저 방의 보존 시간 — 그 사이 재입장하면 방이 유지된다 (SnG는 즉시 정리 유지) */
const EMPTY_USER_ROOM_RETENTION_MS = 10 * 60_000;
const PRE_HAND_RETRY_MS = 1_000;
const MAX_PRE_HAND_RETRIES = 3;
const HAND_SETTLEMENT_RETRY_MS = 1_000;
// 착석 대기 핸드오프 연출 — 핸드 종료(승리 연출 ~5.5s와 병행) 후 봇 퇴장을 먼저 보여주고,
// 잠시 뒤 대기자를 앉힌다. 봇 퇴장과 착석이 한 프레임에 겹치면 "봇이 사람으로 바뀌는 버그"로
// 오인된다 (2026-07-23 유저 피드백). 착석 시 joinRoom→tryStartGame이 다음 핸드를 +2초로
// 재예약하므로 기본 6.5초 스타트 타이머와 경합하지 않는다.
const SEAT_HANDOFF_BOT_EXIT_MS = 5_000;
const SEAT_HANDOFF_SIT_DELAY_MS = 1_200;

function seatWaiterCancelMessage(reason: SeatWaiterCancelReason): string {
  switch (reason) {
    case 'self-leave': return '착석 대기를 취소했어요.';
    case 'disconnect': return '연결이 끊겨 착석 대기가 취소됐어요.';
    case 'room-closed': return '테이블이 정리되어 로비로 돌아왔어요.';
    case 'seat-unavailable': return '좌석을 확보하지 못했어요 — 다른 테이블을 찾아보세요.';
  }
}
const SNG_FINALIZE_RETRY_MS = 1_000;
const MAX_ROOM_RUN_ID_ATTEMPTS = 8;

// 봇 피격 리액션 AI 생성 실패 시 폴백 대사 (캐릭터 중립 톤 — 2차에서 캐릭터별 대사 확장 가능)
const THROWABLE_HIT_FALLBACKS = [
  '야! 지금 뭐 던진 거야?!',
  '으악! 정통으로 맞았잖아…!',
  '이게 무슨 짓이야! 두고 봐!',
  '아잇… 카드에 집중 좀 하자?',
] as const;

export interface RoomHandHistoryHooks {
  recordCompletedHand(input: {
    roomId: string;
    roomName: string;
    gameMode: GameMode;
    record: CompletedHandRecord;
    /** MTT 테이블이면 소속 토너먼트 — 정본 기록(table_hand.tournament_id)의 조인 키 */
    tournamentId?: string | null;
  }): void;
}

export interface RoomManagerOptions {
  sngRetentionMs?: number;
  /** 올인 런아웃 스트리트 간 지연 (ms) — 테스트에서 짧게 줄이기 위한 옵션 */
  runoutStreetDelayMs?: number;
  economy?: RoomEconomyHooks;
  progression?: RoomProgressionHooks;
  arena?: RoomArenaHooks;
  /** 완료 핸드를 참여 휴먼별 핸드 히스토리로 영속하는 훅 (없으면 기록 생략) */
  handHistory?: RoomHandHistoryHooks;
  roomRunIdFactory?: () => string;
  onRoomDisposed?: (
    roomId: string,
    playerIds: string[],
    reason: RoomDisposeReason,
    arenaMatchId?: string,
  ) => void;
  /**
   * 서버 타이머(파산 리바이 유예·자리비움 방치·미납 BB)나 나가기 예약이 좌석을 회수했을 때
   * 호출 — 접속 중인 클라이언트를 room-lost로 로비에 돌려보낸다 (없으면 다음 resync 때 정리).
   * message를 주면 room-lost 안내 문구를 대체한다 (예: 나가기 예약 실행 안내).
   */
  onSeatReclaimed?: (roomId: string, playerId: string, message?: string) => void;
}

/**
 * 착석 대기 취소 사유.
 * - self-leave: 본인이 대기 취소(leave-room) — 클라이언트가 ack로 정리하므로 room-lost 불필요
 * - disconnect: 대기 중 접속 끊김 — 대기석은 grace 없이 즉시 회수
 * - room-closed: 방 정리/초기화 — room-lost 안내 필요
 * - seat-unavailable: 좌석 확보 실패(엔진 거절 등 예외 경로)
 */
export type SeatWaiterCancelReason =
  | 'self-leave'
  | 'disconnect'
  | 'room-closed'
  | 'seat-unavailable';

export interface SeatWaiterHooks {
  /**
   * 대기 취소 통지 — escrow 환불·세션 정리·room-lost emit은 socket-handler 몫.
   * 착석 성공 시에는 호출되지 않는다 (클라이언트는 game-update의 본인 좌석 등장으로 감지).
   */
  onCancelled?: (reason: SeatWaiterCancelReason, message: string) => void;
}

interface SeatWaiter {
  player: Player;
  hooks?: SeatWaiterHooks;
  enqueuedAt: number;
}

export interface RoomArenaHooks {
  completeOfficial(input: {
    matchId: string;
    results: readonly {
      playerId: string;
      place: number;
      type: Player['type'];
    }[];
  }): ArenaOfficialSummary;
  completeTraining?(input: {
    matchId: string;
    results: readonly {
      playerId: string;
      place: number;
      type: Player['type'];
    }[];
  }): void;
}

export type RoomDisposeReason =
  | 'manual'
  | 'idle'
  | 'empty'
  | 'sng-expired'
  | 'arena-rollback'
  | 'mtt-break'
  | 'mtt-cancel'
  | 'shutdown';

/**
 * MTT 테이블 훅 — TournamentManager가 setMttHooks로 주입한다.
 * 토너먼트 공용 시계·전역 순위·밸런싱은 전부 매니저 소유이고, RoomManager는
 * 핸드 경계에서 이 훅을 호출해 진행 여부만 위임받는다 (아레나 패턴의 확장).
 */
export interface MttRoomHooks {
  /** 핸드 사이 블라인드 레벨 적용 — 토너먼트 공용 시계 기준 (TDA Rule 23: 다음 핸드부터) */
  applyLevel(roomId: string, engine: PokerEngine): void;
  /** startHand 성공 후 handNumber가 증가했을 때만 호출 — H4H permit 소비 시점 */
  onHandStarted(roomId: string, handNumber: number): void;
  /**
   * 핸드 종료 훅 — 탈락 수집/밸런싱/브레이크/H4H 처리 후 진행 지시를 반환.
   * 'continue'=다음 핸드 예약, 'hold'=보류(매니저가 나중에 resumeRoom), 'gone'=테이블 해체됨.
   */
  onHandComplete(roomId: string): 'continue' | 'hold' | 'gone';
  /** 브레이크/H4H 배리어/종료 등으로 다음 핸드 시작을 보류 중인지 */
  isHeld(roomId: string): boolean;
  /** 명시적 퇴장/서버 회수 직전 호출 — 매니저가 현재 순위로 탈락 확정 */
  onPlayerLeave(roomId: string, playerId: string): void;
  /** processLeave 성공 뒤 호출 — 좌석 제거가 필요한 테이블 편성을 안전하게 마무리 */
  onPlayerLeft(roomId: string, playerId: string): void;
}

export interface RoomManagerRuntimeStats {
  rooms: number;
  chatRooms: number;
  botTimers: number;
  pendingStartTimers: number;
  turnTimers: number;
  sitOutTimers: number;
  finishedRoomTimers: number;
  deadlines: number;
  epochs: number;
  tournamentClocks: number;
  seatWaiters: number;
}

export class RoomManager {
  private rooms: Map<string, {
    engine: PokerEngine;
    config: RoomConfig;
    createdAt: number;
    runId: string;
    persistent?: boolean;
  }> = new Map();
  private chatHistory: Map<string, ChatMessage[]> = new Map();
  private botIntervals: Map<string, NodeJS.Timeout> = new Map();
  /** 봇 루프 세대 — stopBotLoop마다 증가. await(사고 지연) 중이던 이전 루프가 깨어나도 진행 못 하게 한다 */
  private botLoopEpochs: Map<string, number> = new Map();
  private pendingStartTimers: Map<string, NodeJS.Timeout> = new Map();
  private preHandStartRetryAttempts = new Map<string, number>();
  private handSettlementRetryAttempts = new Map<string, number>();
  private turnTimers: Map<string, NodeJS.Timeout> = new Map();
  private turnDeadlines: Map<string, number> = new Map();
  /** 자리비움 후 방을 떠난 좌석의 최종 정리 타이머 — 키 `${roomId}:${playerId}` (복귀 시 취소) */
  private sitOutAbandonTimers: Map<string, NodeJS.Timeout> = new Map();
  /** 착석 대기열 — 만석(봇 포함) 방에 입장한 휴먼이 봇 좌석이 비워질 때까지 관전 대기 (FIFO) */
  private seatWaiters: Map<string, SeatWaiter[]> = new Map();
  /** 착석 핸드오프 연출 타이머(봇 퇴장→대기자 착석 순차 브로드캐스트) — disposeRoom에서 정리 */
  private seatHandoffTimers: Map<string, NodeJS.Timeout[]> = new Map();
  /** 방별 휴먼 공격성 추적 — 봇의 상습 쇼버/레이저 대응용 (disposeRoom/엔진 교체 시 함께 정리) */
  private aggroTrackers: Map<string, AggroTracker> = new Map();
  private finishedRoomTimers: Map<string, NodeJS.Timeout> = new Map();
  /** 마지막 휴먼이 떠난 캐시 유저 방의 보존 타이머 — 재입장/초대 링크 여지를 위해 즉시 삭제하지 않는다 */
  private emptyRoomTimers: Map<string, NodeJS.Timeout> = new Map();
  /** 시트앤고 진행 시계 — 블라인드 레벨 산정 기준 + 탈락 공지 커서 */
  private tournamentClocks: Map<string, { startedAt: number; announcedResults: number; finishedAnnounced: boolean }> = new Map();
  /** 영속 정산 실패 방은 현재 엔진 스냅샷을 보존한 채 다음 핸드를 시작하지 않는다. */
  private economyBlockedRooms = new Set<string>();
  /** 이탈 정산 실패가 만든 방 잠금을 재시도 성공 때만 안전하게 해제하기 위한 추적. */
  private economyLeaveBlockedPlayers = new Map<string, Set<string>>();
  private economyLeaveBlockWasPreexisting = new Set<string>();
  /** 완료된 엔진 핸드의 DB 정산이 확정되지 않아 cashout/void가 금지된 방. */
  private unresolvedSettlementRooms = new Set<string>();
  private handSettlementStatus = new Map<string, {
    handNumber: number;
    ok: boolean;
    paidTotal: number;
    rake: number;
  }>();
  /** wallet Sit & Go 결과가 DB에 확정된 방 — retained snapshot 재처리 시 중복 호출 방지 */
  private settledTournamentRooms = new Set<string>();
  /** 칩 보유 좌석 부족(파산 정지) 안내를 정지 상태(handNumber)당 1회만 보내기 위한 커서 */
  private stallNoticeHands = new Map<string, number>();
  /** 핸드 히스토리 기록 완료 커서 — 정산 재시도로 handleCompletedHand가 재진입해도 중복 저장 방지 */
  private handHistoryRecordedHands = new Map<string, number>();
  private readonly usedRoomRunIds = new Set<string>();
  private readonly roomRunInstanceId = randomUUID().replaceAll('-', '_');
  private roomRunGeneration = 0;
  /** AI 상황 대사 (키 없으면 비활성 — 스크립트 대사만) */
  private dialogue = new DialogueManager(new AIDialogue());
  private mttHooks?: MttRoomHooks;
  private onUpdate: (roomId: string, engine: PokerEngine) => void;
  private onChat: (roomId: string, message: ChatMessage) => void;
  /** 좌석 구성이 서버 내부에서 바뀔 때(자동 정리 등) 로비 목록 재브로드캐스트 훅 */
  private onRoomsChanged?: () => void;
  private options: Required<Pick<RoomManagerOptions, 'sngRetentionMs'>> & Omit<RoomManagerOptions, 'sngRetentionMs'>;

  constructor(
    onUpdate: (roomId: string, engine: PokerEngine) => void,
    onChat: (roomId: string, message: ChatMessage) => void,
    onRoomsChanged?: () => void,
    options: RoomManagerOptions = {},
  ) {
    this.onUpdate = onUpdate;
    this.onChat = onChat;
    this.onRoomsChanged = onRoomsChanged;
    this.options = {
      ...options,
      sngRetentionMs: options.sngRetentionMs ?? DEFAULT_SNG_RETENTION_MS,
    };
  }

  /** MTT 훅 주입 — TournamentManager가 생성 후 연결한다 (순환 참조 회피) */
  setMttHooks(hooks: MttRoomHooks): void {
    this.mttHooks = hooks;
  }

  /** MTT 소속 테이블 여부 — 수명주기/레벨/순위가 TournamentManager 소유인 방 */
  private isMttRoom(room: { config: RoomConfig }): boolean {
    return room.config.gameMode === 'mtt';
  }

  /** 토너먼트형 방(SnG/MTT) — 좌석 보존·딜인 유지·즉시 퇴장 계약을 공유한다 */
  private isTournamentRoom(room: { config: RoomConfig }): boolean {
    return room.config.gameMode === 'sng' || room.config.gameMode === 'mtt';
  }

  /** TournamentManager 등 외부 오케스트레이터의 시스템 채팅 공지용 공개 래퍼 */
  postSystemChat(roomId: string, message: string): void {
    this.sendSystemChat(roomId, message);
  }

  /** 상태 스냅샷만 재브로드캐스트 (게임 재개 시도 없음 — 탈락 확정 표시 등) */
  broadcastRoom(roomId: string): void {
    const room = this.rooms.get(roomId);
    if (room) this.onUpdate(roomId, room.engine);
  }

  createRoom(config: RoomConfig, persistent = false): string {
    const normalizedConfig: RoomConfig = config.competitionMode
      ? {
          ...config,
          smallBlind: SNG_BLIND_SCHEDULE[0].smallBlind,
          bigBlind: SNG_BLIND_SCHEDULE[0].bigBlind,
          minBuyIn: ARENA_CONFIG_V1.startingStack,
          maxBuyIn: ARENA_CONFIG_V1.startingStack,
          maxPlayers: 6,
          economyMode: 'arena',
          gameMode: 'sng',
          startingStack: ARENA_CONFIG_V1.startingStack,
          entryBuyIn: undefined,
          entryFee: undefined,
          difficulty: 'hard',
          tableType: 'mixed',
          arenaParticipantIds: normalizeArenaParticipantIds(
            config.arenaParticipantIds,
          ),
        }
      : config;
    const id = `room-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const runId = this.reserveRoomRunId();
    const engine = new PokerEngine(
      normalizedConfig,
      id,
      undefined,
      ENGINE_RUNTIME_HOOKS,
    );
    this.rooms.set(id, {
      engine,
      config: normalizedConfig,
      createdAt: Date.now(),
      runId,
      persistent,
    });
    this.chatHistory.set(id, []);
    return id;
  }

  getRoom(roomId: string): { engine: PokerEngine; config: RoomConfig; createdAt: number } | undefined {
    return this.rooms.get(roomId);
  }

  getRoomCount(): number {
    return this.rooms.size;
  }

  /** 백오피스용 전체 방 요약 — 로비 필터와 무관하게 모든 방 (비밀번호·홀카드 등 비밀 없이 상태만) */
  getAdminRoomSummaries(): Array<{
    id: string;
    name: string;
    mode: string;
    tableType: string;
    economyMode: string;
    handNumber: number;
    handInProgress: boolean;
    street: string | null;
    humans: number;
    bots: number;
    sittingOut: number;
    disconnected: number;
    potTotal: number;
    blinds: string;
    seats: Array<{
      seatIndex: number;
      name: string;
      type: string;
      chips: number;
      status: string;
      currentBet: number;
      sitOutNext: boolean;
      disconnected: boolean;
      pendingRemoval: boolean;
    }>;
  }> {
    return [...this.rooms.entries()].map(([id, room]) => {
      const st = room.engine.state;
      const humans = st.players.filter(p => p.type === 'human');
      return {
        id,
        name: room.config.name,
        mode: room.config.gameMode ?? 'cash',
        tableType: room.config.tableType ?? 'mixed',
        economyMode: room.config.economyMode ?? 'practice',
        handNumber: st.handNumber,
        handInProgress: st.isHandInProgress,
        street: st.isHandInProgress ? st.street : null,
        humans: humans.length,
        bots: st.players.length - humans.length,
        sittingOut: st.players.filter(p => p.status === 'sitting-out' || p.sitOutNext).length,
        disconnected: st.players.filter(p => p.isDisconnected).length,
        potTotal: st.pots.reduce((sum, pot) => sum + pot.amount, 0),
        blinds: `${st.smallBlind}/${st.bigBlind}`,
        seats: st.players.map(p => ({
          seatIndex: p.seatIndex,
          name: p.name,
          type: p.type,
          chips: p.chips,
          status: p.status,
          currentBet: p.currentBet,
          sitOutNext: p.sitOutNext ?? false,
          disconnected: p.isDisconnected ?? false,
          pendingRemoval: p.pendingRemoval ?? false,
        })),
      };
    });
  }

  getRuntimeStats(): RoomManagerRuntimeStats {
    return {
      rooms: this.rooms.size,
      chatRooms: this.chatHistory.size,
      botTimers: this.botIntervals.size,
      pendingStartTimers: this.pendingStartTimers.size,
      turnTimers: this.turnTimers.size,
      sitOutTimers: this.sitOutAbandonTimers.size,
      finishedRoomTimers: this.finishedRoomTimers.size,
      deadlines: this.turnDeadlines.size,
      epochs: this.botLoopEpochs.size,
      tournamentClocks: this.tournamentClocks.size,
      seatWaiters: [...this.seatWaiters.values()].reduce((sum, list) => sum + list.length, 0),
    };
  }

  disposeRoom(
    roomId: string,
    reason: RoomDisposeReason = 'manual',
    notify = true,
  ): boolean {
    const room = this.rooms.get(roomId);
    if (!room) return false;
    const tournament = room.engine.state.tournament;
    if (
      room.config.competitionMode === 'arena-official'
      && tournament
      && !tournament.finished
      && reason !== 'arena-rollback'
      && reason !== 'shutdown'
    ) {
      return false;
    }
    if (this.unresolvedSettlementRooms.has(roomId) && !tournament?.finished) return false;
    if (
      this.isWalletCash(room)
      && room.engine.state.isHandInProgress
    ) {
      return false;
    }
    const walletSng = this.isWalletSng(room);
    if (walletSng && tournament && tournament.entrants > 0 && !tournament.finished) {
      return false;
    }
    if (tournament?.finished && !this.finalizeFinishedTournament(roomId)) {
      return false;
    }
    if (this.unresolvedSettlementRooms.has(roomId)) return false;
    if (this.isWalletCash(room) || (walletSng && tournament?.entrants === 0)) {
      try {
        this.requireEconomy().voidRoom(roomId);
      } catch {
        this.economyBlockedRooms.add(roomId);
        this.sendSystemChat(roomId, '저장 연결을 확인 중이에요');
        return false;
      }
    }
    const playerIds = room.engine.state.players
      .filter(player => player.type === 'human')
      .map(player => player.id);
    const arenaMatchId = room.config.arenaMatchId;

    this.stopBotLoop(roomId);
    this.clearPendingStart(roomId);
    this.preHandStartRetryAttempts.delete(roomId);
    this.handSettlementRetryAttempts.delete(roomId);
    this.clearTurnTimer(roomId);
    this.clearFinishedRoomTimer(roomId);
    this.clearEmptyRoomTimer(roomId);
    for (const [key, timer] of this.sitOutAbandonTimers) {
      if (!key.startsWith(`${roomId}:`)) continue;
      clearTimeout(timer);
      this.sitOutAbandonTimers.delete(key);
    }
    this.cancelAllSeatWaiters(roomId, 'room-closed');

    this.rooms.delete(roomId);
    this.chatHistory.delete(roomId);
    this.tournamentClocks.delete(roomId);
    this.botLoopEpochs.delete(roomId);
    this.aggroTrackers.delete(roomId);
    this.economyBlockedRooms.delete(roomId);
    this.economyLeaveBlockedPlayers.delete(roomId);
    this.economyLeaveBlockWasPreexisting.delete(roomId);
    this.unresolvedSettlementRooms.delete(roomId);
    this.handSettlementStatus.delete(roomId);
    this.settledTournamentRooms.delete(roomId);
    this.stallNoticeHands.delete(roomId);
    this.handHistoryRecordedHands.delete(roomId);
    this.options.progression?.disposeRoom(roomId);
    this.dialogue.disposeScope(roomId);
    if (notify) {
      this.options.onRoomDisposed?.(
        roomId,
        playerIds,
        reason,
        arenaMatchId,
      );
      this.onRoomsChanged?.();
    }
    return true;
  }

  retainFinishedTournament(roomId: string): boolean {
    const room = this.rooms.get(roomId);
    if (!room?.engine.state.tournament?.finished) return false;
    if (this.finishedRoomTimers.has(roomId)) return true;
    const timer = setTimeout(() => {
      this.finishedRoomTimers.delete(roomId);
      this.disposeRoom(roomId, 'sng-expired');
    }, this.options.sngRetentionMs);
    this.finishedRoomTimers.set(roomId, timer);
    return true;
  }

  /** 휴먼이 없는 유저 생성 방을 유휴 시간 경과 후 정리. 삭제한 방 수 반환 */
  sweepIdleRooms(idleMs = 10 * 60_000): number {
    let removed = 0;
    const now = Date.now();
    this.rooms.forEach((room, id) => {
      if (room.persistent) return;
      // MTT 테이블은 휴먼이 전원 탈락해 봇만 남아도 토너먼트가 끝날 때까지 진행해야 한다 —
      // 수명주기는 TournamentManager 소유 (2026-07-23 라이브 QA: 스윕이 파이널 테이블을
      // 회수해 토너먼트가 영영 안 끝나는 교착)
      if (room.config.tournamentId) return;
      const humans = room.engine.state.players.filter(p => p.type === 'human' && !p.pendingRemoval);
      if (humans.length === 0 && now - room.createdAt > idleMs) {
        if (this.disposeRoom(id, 'idle')) removed++;
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
  getRoomList(forPlayerId?: string): RoomListItem[] {
    const list: RoomListItem[] = [];
    this.rooms.forEach((room, id) => {
      if (room.config.competitionMode) return;
      // MTT 테이블은 로비 방 목록에 노출하지 않는다 — 토너먼트 엔티티(별도 목록)로만 보인다
      if (room.config.tournamentId) return;
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
        economyMode: room.config.economyMode ?? 'practice',
        entryBuyIn: room.config.entryBuyIn,
        entryFee: room.config.entryFee,
        difficulty: room.config.difficulty ?? 'normal',
        turnTime: room.config.turnTime,
        // 봇 좌석은 만석 판정에서 제외 — 휴먼이 오면 봇이 자리를 양보한다
        humanCount: room.engine.state.players.filter(p => p.type === 'human').length,
        // 인원 구성 — 명시 설정이 없는 구방은 botCount로 유도 (0=사람만, 그 외=봇+사람)
        tableType: room.config.tableType
          ?? ((room.config.botCount ?? cfg('bot.defaultBotCount')) === 0 ? 'humans' : 'mixed'),
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
    if (
      room.config.competitionMode
      && player.type === 'human'
      && !this.isArenaParticipant(roomId, player.id)
    ) {
      return false;
    }
    // 봇 전용 연습 테이블은 휴먼 1명만 — 다른 휴먼이 이미 앉아 있으면 거절
    if (
      player.type === 'human' && room.config.tableType === 'bots'
      && room.engine.state.players.some(p => p.type === 'human' && !p.pendingRemoval && p.id !== player.id)
    ) {
      return false;
    }
    const success = room.engine.addPlayer(player);
    if (success) {
      // 빈 방 보존 타이머가 걸려 있었다면 재입장으로 취소 — 방이 다시 살아난다
      if (player.type === 'human') this.clearEmptyRoomTimer(roomId);
      this.sendSystemChat(roomId, `${player.name}님이 테이블에 앉았습니다.`);
      this.tryStartGame(roomId);
    }
    return success;
  }

  isArenaParticipant(roomId: string, playerId: string): boolean {
    const room = this.rooms.get(roomId);
    return !!room?.config.competitionMode
      && !!room.config.arenaParticipantIds?.includes(playerId);
  }

  /**
   * 시트앤고 대기 중 남는 자리를 봇으로 채우고 시작 (방장 전용 — 테스트/소인원 매칭용).
   * 요청자가 착석한 휴먼이어야 하고, 토너먼트가 아직 시작 전이어야 한다.
   */
  fillWithBots(roomId: string, requesterId: string): boolean {
    const room = this.rooms.get(roomId);
    if (!room) return false;
    if (this.isWalletSng(room)) return false;
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

  // --- 착석 대기 (만석 방의 봇 좌석 핸드오프) ---
  // 만석(봇 포함) 방에 휴먼이 오면 거절/재시도 대신 관전 대기로 입장시키고, 진행 중 핸드가
  // 끝나면 봇 퇴장 → 대기자 착석을 순차 브로드캐스트한다. 폴드한 봇이라도 핸드 종료 전에는
  // 좌석을 제거하지 않는다 — 팟 회계(sum(pots) === sum(totalContributed))가 좌석 splice에
  // 깨지는 엔진 불변식 때문이다 (AGENTS.md '핸드 중 이탈').

  /**
   * 착석 대기 등록 — 호출 전제: 캐시 방 만석 + 핸드 진행 중 (검증은 여기서 최종 수행).
   * 양보할 봇을 즉시 pendingRemoval+폴드로 마킹해 "이번 핸드를 끝으로 나간다"를 확정한다.
   * 대기자 push를 봇 이탈보다 먼저 해, 봇 폴드로 핸드가 동기 종료돼도 핸드오프가 대기자를 본다.
   */
  enqueueSeatWaiter(
    roomId: string,
    player: Player,
    hooks?: SeatWaiterHooks,
  ): 'waiting' | 'no-room' | 'not-cash' | 'already' | 'no-bot' {
    const room = this.rooms.get(roomId);
    if (!room) return 'no-room';
    if (room.engine.state.tournament) return 'not-cash';
    const st = room.engine.state;
    if (st.players.some(p => p.id === player.id)) return 'already';
    const queue = this.seatWaiters.get(roomId) ?? [];
    if (queue.some(w => w.player.id === player.id)) return 'already';
    const yieldingBot = st.players.find(p => p.type === 'bot' && !p.pendingRemoval);
    if (!yieldingBot) return 'no-bot';

    queue.push({ player, hooks, enqueuedAt: Date.now() });
    this.seatWaiters.set(roomId, queue);
    this.sendSystemChat(
      roomId,
      `${player.name}님이 입장했어요 — ${yieldingBot.name}이(가) 이번 핸드를 끝으로 자리를 비워줍니다.`,
    );
    this.leaveRoom(roomId, yieldingBot.id);
    // 그 사이 핸드가 이미 끝나 있으면(동기 종료 포함) 기다릴 이유가 없다 — 즉시 착석 시도
    const current = this.rooms.get(roomId);
    if (current && !current.engine.state.isHandInProgress && !this.seatHandoffTimers.has(roomId)) {
      this.trySeatWaitersNow(roomId);
    }
    return 'waiting';
  }

  /** 대기 취소 — 등록돼 있었으면 true. 양보 예약된 봇은 되돌린다 (다음 핸드부터 계속 딜인). */
  cancelSeatWaiter(
    roomId: string,
    playerId: string,
    reason: SeatWaiterCancelReason,
  ): boolean {
    const queue = this.seatWaiters.get(roomId);
    if (!queue) return false;
    const idx = queue.findIndex(w => w.player.id === playerId);
    if (idx === -1) return false;
    const [waiter] = queue.splice(idx, 1);
    if (queue.length === 0) this.seatWaiters.delete(roomId);

    // 방이 정리되는 중이 아니면 양보 봇 하나를 원복 — 파산(chips<=0) 봇은 어차피 정리 대상이라 제외
    if (reason === 'self-leave' || reason === 'disconnect') {
      const room = this.rooms.get(roomId);
      const yieldedBot = room?.engine.state.players.find(
        p => p.type === 'bot' && p.pendingRemoval && p.chips > 0,
      );
      if (yieldedBot) {
        yieldedBot.pendingRemoval = false;
        this.sendSystemChat(roomId, `${yieldedBot.name}이(가) 그대로 자리를 지키기로 했어요.`);
      }
    }

    waiter.hooks?.onCancelled?.(reason, seatWaiterCancelMessage(reason));
    return true;
  }

  isSeatWaiter(roomId: string, playerId: string): boolean {
    return this.seatWaiters.get(roomId)?.some(w => w.player.id === playerId) ?? false;
  }

  /** 대기자 개인 game-update 전송 대상 — socket-handler onUpdate가 좌석 플레이어에 더해 사용 */
  getSeatWaiterIds(roomId: string): string[] {
    return this.seatWaiters.get(roomId)?.map(w => w.player.id) ?? [];
  }

  private seatWaiterCount(roomId: string): number {
    return this.seatWaiters.get(roomId)?.length ?? 0;
  }

  /**
   * 대기자 착석 시도 — 핸드 사이에만 실제 착석. 빈 좌석이 모자라면 남은 대기자는 다음
   * 핸드오프까지 대기 유지. joinRoom이 착석 채팅과 tryStartGame(다음 핸드 +2초 재예약)을 담당.
   */
  private trySeatWaitersNow(roomId: string): void {
    const room = this.rooms.get(roomId);
    const queue = this.seatWaiters.get(roomId);
    if (!room || !queue || queue.length === 0) return;
    if (room.engine.state.isHandInProgress) return;

    let seatedAny = false;
    while (queue.length > 0) {
      const occupied = new Set(room.engine.state.players.map(p => p.seatIndex));
      let seatIndex = -1;
      for (let seat = 0; seat < room.config.maxPlayers; seat++) {
        if (!occupied.has(seat)) { seatIndex = seat; break; }
      }
      if (seatIndex < 0) break; // 빈 좌석 없음 — 다음 핸드오프에서 재시도
      const waiter = queue.shift()!;
      waiter.player.seatIndex = seatIndex;
      if (this.joinRoom(roomId, waiter.player)) {
        seatedAny = true;
      } else {
        // 엔진 거절(중복 id 등 예외 경로) — 대기 유지가 더 위험하므로 취소 통지
        waiter.hooks?.onCancelled?.(
          'seat-unavailable',
          seatWaiterCancelMessage('seat-unavailable'),
        );
      }
    }
    if (queue.length === 0) this.seatWaiters.delete(roomId);
    if (seatedAny) {
      this.onUpdate(roomId, room.engine);
      this.onRoomsChanged?.();
    }
  }

  /**
   * 핸드 종료 후 좌석 핸드오프 연출 — 봇 퇴장(t=5s)과 대기자 착석(t=6.2s)을 별도
   * 브로드캐스트로 나눠 기존 플레이어에게 순차적으로 보여준다.
   */
  private scheduleSeatHandoff(roomId: string): void {
    if (this.seatWaiterCount(roomId) === 0) return;
    this.clearSeatHandoffTimers(roomId);
    const timers: NodeJS.Timeout[] = [];

    timers.push(setTimeout(() => {
      const room = this.rooms.get(roomId);
      if (!room || room.engine.state.isHandInProgress) return;
      const leaving = room.engine.state.players.filter(p => p.pendingRemoval && p.type === 'bot');
      room.engine.removePendingPlayers();
      if (leaving.length > 0) {
        this.sendSystemChat(
          roomId,
          `${leaving.map(p => p.name).join(', ')}이(가) 자리에서 일어났어요.`,
        );
        this.onUpdate(roomId, room.engine);
      }
    }, SEAT_HANDOFF_BOT_EXIT_MS));

    timers.push(setTimeout(() => {
      this.seatHandoffTimers.delete(roomId);
      this.trySeatWaitersNow(roomId);
    }, SEAT_HANDOFF_BOT_EXIT_MS + SEAT_HANDOFF_SIT_DELAY_MS));

    this.seatHandoffTimers.set(roomId, timers);
  }

  private clearSeatHandoffTimers(roomId: string): void {
    const timers = this.seatHandoffTimers.get(roomId);
    if (!timers) return;
    for (const timer of timers) clearTimeout(timer);
    this.seatHandoffTimers.delete(roomId);
  }

  /** 방 정리/초기화 시 대기열 일괄 취소 — escrow 환불·room-lost 안내는 hooks가 수행 */
  private cancelAllSeatWaiters(roomId: string, reason: SeatWaiterCancelReason): void {
    this.clearSeatHandoffTimers(roomId);
    const queue = this.seatWaiters.get(roomId);
    if (!queue) return;
    this.seatWaiters.delete(roomId);
    for (const waiter of queue) {
      waiter.hooks?.onCancelled?.(reason, seatWaiterCancelMessage(reason));
    }
  }

  leaveRoom(roomId: string, playerId: string): boolean {
    const room = this.rooms.get(roomId);
    if (!room) return true;
    const mttRoom = this.isMttRoom(room);
    const officialArenaPlayer = room.config.competitionMode === 'arena-official'
      && !room.engine.state.tournament?.finished
      && room.engine.state.players.some(player => (
        player.id === playerId
        && player.type === 'human'
        && !player.pendingRemoval
      ));
    if (officialArenaPlayer) {
      this.handleDisconnect(roomId, playerId);
      return true;
    }

    // MTT: 명시적 퇴장 = 현재 순위로 탈락 확정 (전역 순위는 매니저 소유 — 엔진 로컬 판정은 비활성)
    if (mttRoom) {
      this.mttHooks?.onPlayerLeave(roomId, playerId);
    }

    const wasInProgress = room.engine.state.isHandInProgress;
    const leavingPlayer = room.engine.state.players.find(p => p.id === playerId);
    let economicLeaveCommitted = false;
    if (
      leavingPlayer?.type === 'human'
      && this.isWalletSng(room)
      && room.engine.state.tournament?.entrants === 0
    ) {
      try {
        this.requireEconomy().cancelWaitingSng(roomId, leavingPlayer);
        economicLeaveCommitted = true;
      } catch {
        this.blockEconomicLeave(roomId, playerId);
        this.sendSystemChat(roomId, '저장 연결을 확인 중이에요');
        return false;
      }
    }
    if (
      !wasInProgress
      && leavingPlayer?.type === 'human'
      && this.isWalletCash(room)
    ) {
      try {
        this.requireEconomy().settleExit(roomId, leavingPlayer);
        economicLeaveCommitted = true;
      } catch {
        this.blockEconomicLeave(roomId, playerId);
        this.sendSystemChat(roomId, '저장 연결을 확인 중이에요');
        return false;
      }
    }
    if (economicLeaveCommitted) this.clearEconomicLeaveBlock(roomId, playerId);
    // 이탈자 턴에 걸려 있던 stale 타이머 제거 (아니어도 아래 startPlayerLoop가 재설정)
    this.clearTurnTimer(roomId);
    // 좌석이 정리되므로 남아 있던 자리비움 최종 정리 타이머도 취소 (orphan 방지)
    this.cancelSitOutAbandon(roomId, playerId);

    const { player, handComplete } = room.engine.processLeave(playerId);
    if (player) {
      this.sendSystemChat(roomId, `${player.name}님이 테이블을 떠났습니다.`);
    }

    if (
      !wasInProgress
      && room.engine.state.tournament?.finished
    ) {
      if (this.finalizeFinishedTournament(roomId)) {
        this.announceTournamentProgress(roomId);
      }
      this.onUpdate(roomId, room.engine);
    }

    // 진행 중 wallet cash 핸드는 마지막 휴먼이 나가도 봇 액션/정산이 끝날 때까지 보존한다.
    // 엔진을 먼저 초기화하면 마지막 체크포인트만 남고 현재 핸드 정산이 사라진다.
    const humans = room.engine.state.players.filter(p => p.type === 'human' && !p.pendingRemoval);
    const preserveForEconomicSettlement = this.isWalletCash(room)
      && wasInProgress
      && room.engine.state.isHandInProgress;
    if (
      humans.length === 0
      && !preserveForEconomicSettlement
      && this.seatWaiterCount(roomId) === 0
      && !this.isMttRoom(room) // MTT 테이블은 봇만 남아도 계속 진행 — 수명주기는 매니저 소유
    ) {
      if (wasInProgress && handComplete) {
        this.handleCompletedHand(roomId);
        this.cleanupEmptyRoom(roomId, player !== null);
        return true;
      }
      this.cleanupEmptyRoom(roomId, player !== null);
      return true;
    }

    // 서버 내부 자동 정리(미납 블라인드/방치 회수 등)도 로비 목록에 즉시 반영 —
    // 자리비움 좌석의 '게임 복귀' 배너가 죽은 좌석을 가리키지 않게 한다
    if (player) this.onRoomsChanged?.();

    if (wasInProgress && player) {
      if (handComplete) {
        this.handleCompletedHand(roomId);
      } else if (room.engine.state.isHandInProgress) {
        // 이탈이 턴/라운드를 진행시켰을 수 있으므로 루프 재가동 (핸드 정지 방지)
        this.startPlayerLoop(roomId);
        this.onUpdate(roomId, room.engine);
      } else {
        this.onUpdate(roomId, room.engine);
      }
    }
    if (economicLeaveCommitted) this.resumeAfterEconomicLeave(roomId);
    if (mttRoom && player) this.mttHooks?.onPlayerLeft(roomId, playerId);
    return true;
  }

  /**
   * MTT 테이블 간 좌석 이동 — 칩을 보존한 채 소스에서 빼 목적지에 정렬 삽입한다.
   * 경제 정산(leaveRoom의 settleExit/cancelWaitingSng)을 절대 타지 않는 이동 전용 경로.
   * 소스는 핸드 사이여야 하고(핸드 종료 훅에서 호출 전제), 목적지는 핸드 중이어도 된다
   * (엔진이 꼬리 push 후 다음 핸드 normalizeSeatOrder로 정렬 — 착석 대기와 같은 계약).
   * 세션 roomId 전환·table-move emit은 호출자(TournamentManager 훅) 책임.
   */
  transferMttSeat(
    fromRoomId: string,
    toRoomId: string,
    playerId: string,
    seatIndex: number,
  ): boolean {
    const from = this.rooms.get(fromRoomId);
    const to = this.rooms.get(toRoomId);
    if (!from || !to || !this.isMttRoom(from) || !this.isMttRoom(to)) return false;
    if (from.engine.state.isHandInProgress) return false;
    const seated = from.engine.state.players.find(p => p.id === playerId);
    if (!seated || seated.pendingRemoval || seated.chips <= 0) return false;

    this.cancelSitOutAbandon(fromRoomId, playerId);
    const { player: removed } = from.engine.processLeave(playerId);
    if (!removed) return false;

    const moved: Player = {
      ...removed,
      seatIndex,
      holeCards: [],
      currentBet: 0,
      totalContributed: 0,
      deadContributed: 0,
      status: 'waiting',
      hasActed: false,
      pendingRemoval: undefined,
      revealed: false,
      leaveReservation: undefined,
      bustReclaimDeadline: undefined,
      // 유지: chips(스택 보존) · timeBankChips · handsPlayed · sitOutNext(자리비움 승계) ·
      // isDisconnected/disconnectGraceDeadline(끊김 상태 승계) · finishPlace 없음(생존자만 이동)
    };
    if (!to.engine.addPlayer(moved)) {
      // 목적지 거절(좌석 충돌 등 예외 경로) — 원 좌석으로 원복해 칩 소실을 막는다
      from.engine.addPlayer(removed);
      this.onUpdate(fromRoomId, from.engine);
      return false;
    }

    this.sendSystemChat(fromRoomId, `${removed.name}님이 다른 테이블로 이동했어요.`);
    this.sendSystemChat(toRoomId, `${removed.name}님이 이 테이블로 이동해 왔어요.`);
    this.onUpdate(fromRoomId, from.engine);
    this.onUpdate(toRoomId, to.engine);
    return true;
  }

  refreshPlayerPublicCosmetics(
    roomId: string,
    playerId: string,
    cosmetics: PlayerPublicCosmetics,
  ): boolean {
    const room = this.rooms.get(roomId);
    const player = room?.engine.state.players.find(candidate => (
      candidate.id === playerId
      && candidate.type === 'human'
      && !candidate.pendingRemoval
    ));
    if (!room || !player) return false;
    player.publicCosmetics = { ...cosmetics };
    this.onUpdate(roomId, room.engine);
    return true;
  }

  /** 좌석 아바타 라이브 갱신 — 설정 캐릭터 변경이 앉아 있는 좌석에 즉시 반영되게 (2026-07-22 유저 신고) */
  refreshPlayerAvatar(roomId: string, playerId: string, avatarId: string): boolean {
    const room = this.rooms.get(roomId);
    const player = room?.engine.state.players.find(candidate => (
      candidate.id === playerId
      && candidate.type === 'human'
      && !candidate.pendingRemoval
    ));
    if (!room || !player) return false;
    player.avatar = avatarId;
    this.onUpdate(roomId, room.engine);
    return true;
  }

  private clearFinishedRoomTimer(roomId: string): void {
    const timer = this.finishedRoomTimers.get(roomId);
    if (timer) clearTimeout(timer);
    this.finishedRoomTimers.delete(roomId);
  }

  private scheduleFinishedTournamentRetry(roomId: string): void {
    if (!this.rooms.has(roomId)) return;
    this.clearFinishedRoomTimer(roomId);
    const timer = setTimeout(() => {
      this.finishedRoomTimers.delete(roomId);
      if (!this.finalizeFinishedTournament(roomId)) return;
      const room = this.rooms.get(roomId);
      if (!room) return;
      this.announceTournamentProgress(roomId);
      this.onUpdate(roomId, room.engine);
    }, SNG_FINALIZE_RETRY_MS);
    this.finishedRoomTimers.set(roomId, timer);
  }

  private resumeAfterEconomicLeave(roomId: string): void {
    const room = this.rooms.get(roomId);
    if (
      !room
      || room.engine.state.isHandInProgress
      || room.engine.state.tournament?.finished
      || this.economyBlockedRooms.has(roomId)
      || this.unresolvedSettlementRooms.has(roomId)
    ) {
      return;
    }
    this.tryStartGame(roomId);
  }

  private blockEconomicLeave(roomId: string, playerId: string): void {
    let players = this.economyLeaveBlockedPlayers.get(roomId);
    if (!players) {
      players = new Set<string>();
      this.economyLeaveBlockedPlayers.set(roomId, players);
      if (this.economyBlockedRooms.has(roomId)) {
        this.economyLeaveBlockWasPreexisting.add(roomId);
      }
    }
    players.add(playerId);
    this.economyBlockedRooms.add(roomId);
  }

  private clearEconomicLeaveBlock(roomId: string, playerId: string): void {
    const players = this.economyLeaveBlockedPlayers.get(roomId);
    if (!players) return;
    players.delete(playerId);
    if (players.size > 0) return;
    this.economyLeaveBlockedPlayers.delete(roomId);
    if (!this.economyLeaveBlockWasPreexisting.delete(roomId)) {
      this.economyBlockedRooms.delete(roomId);
    }
  }

  private cleanupEmptyRoom(roomId: string, roomsChanged: boolean): void {
    const room = this.rooms.get(roomId);
    if (!room) return;
    // 착석 대기자가 있으면 방은 비어 있지 않다 — 정리 대신 착석시켜 게임을 잇는다
    if (this.seatWaiterCount(roomId) > 0) {
      if (!room.engine.state.isHandInProgress) this.trySeatWaitersNow(roomId);
      return;
    }
    if (this.unresolvedSettlementRooms.has(roomId)) {
      this.stopBotLoop(roomId);
      this.clearPendingStart(roomId);
      this.clearTurnTimer(roomId);
      return;
    }
    this.stopBotLoop(roomId);
    this.clearPendingStart(roomId);
    this.clearTurnTimer(roomId);
    if (room.persistent) {
      // 영속(기본 로비) 방은 삭제하지 않고 대기 상태로 리셋 — 남은 봇/진행 중 핸드를 비워
      // 다음 입장자가 깨끗한 테이블에서 시작하게 한다 (안 그러면 isHandInProgress로 얼어붙음)
      this.resetRoomToIdle(roomId);
      if (roomsChanged) this.onRoomsChanged?.();
    } else if (room.config.gameMode === 'sng') {
      // SnG는 모든 휴먼이 떠나면 즉시 정리 (결과 보존 계약은 finishedRoomTimers가 별도 담당)
      this.disposeRoom(roomId, 'empty');
    } else {
      // 캐시 유저 방은 즉시 삭제하지 않고 영속 방처럼 대기 리셋 후 보존 — 초대 링크/재입장
      // 여지를 유지한다 (2026-07-22 QA: 마지막 휴먼 퇴장 즉시 소멸로 재입장 불가).
      // 휴먼이 다시 앉으면 joinRoom이 보존 타이머를 취소한다.
      this.resetRoomToIdle(roomId);
      if (roomsChanged) this.onRoomsChanged?.();
      this.clearEmptyRoomTimer(roomId);
      const timer = setTimeout(() => {
        this.emptyRoomTimers.delete(roomId);
        this.disposeRoom(roomId, 'empty');
      }, EMPTY_USER_ROOM_RETENTION_MS);
      this.emptyRoomTimers.set(roomId, timer);
    }
  }

  private clearEmptyRoomTimer(roomId: string): void {
    const timer = this.emptyRoomTimers.get(roomId);
    if (timer) clearTimeout(timer);
    this.emptyRoomTimers.delete(roomId);
  }

  /**
   * 영속 방을 대기 상태로 초기화 — 휴먼이 모두 떠났을 때 호출.
   * 남은 봇을 비우고 진행 중이던 핸드를 정리해, 다음 입장자가 새 핸드를 깨끗이 시작하게 한다.
   */
  private resetRoomToIdle(roomId: string): void {
    const room = this.rooms.get(roomId);
    if (!room) return;
    // 엔진 교체는 양보 예약·좌석 상태를 전부 무효화한다 — 남은 대기자는 안내 후 정리
    this.cancelAllSeatWaiters(roomId, 'room-closed');
    if (this.unresolvedSettlementRooms.has(roomId)) return;
    if (this.isWalletCash(room) && room.engine.state.isHandInProgress) return;
    const nextRunId = this.reserveRoomRunId();
    const nextEngine = new PokerEngine(
      room.config,
      roomId,
      undefined,
      ENGINE_RUNTIME_HOOKS,
    );
    if (this.isWalletCash(room)) {
      try {
        this.requireEconomy().voidRoom(roomId);
      } catch {
        this.economyBlockedRooms.add(roomId);
        return;
      }
    }
    room.engine = nextEngine;
    room.runId = nextRunId;
    this.chatHistory.set(roomId, []);
    this.clearFinishedRoomTimer(roomId);
    this.preHandStartRetryAttempts.delete(roomId);
    this.handSettlementRetryAttempts.delete(roomId);
    this.tournamentClocks.delete(roomId);
    this.botLoopEpochs.delete(roomId);
    this.aggroTrackers.delete(roomId);
    this.economyBlockedRooms.delete(roomId);
    this.economyLeaveBlockedPlayers.delete(roomId);
    this.economyLeaveBlockWasPreexisting.delete(roomId);
    this.unresolvedSettlementRooms.delete(roomId);
    this.handSettlementStatus.delete(roomId);
    this.settledTournamentRooms.delete(roomId);
    this.stallNoticeHands.delete(roomId);
    // 엔진 교체로 handNumber가 리셋되므로 기록 커서도 함께 비운다 (안 지우면 새 핸드가 스킵됨)
    this.handHistoryRecordedHands.delete(roomId);
    this.options.progression?.disposeRoom(roomId);
  }

  // --- [FIX 1] Hand start 중복 방지 ---

  private clearPendingStart(roomId: string): void {
    const timer = this.pendingStartTimers.get(roomId);
    if (timer) {
      clearTimeout(timer);
      this.pendingStartTimers.delete(roomId);
    }
  }

  private schedulePreHandRetry(roomId: string, blockOnExhaustion = true): boolean {
    const attempts = this.preHandStartRetryAttempts.get(roomId) ?? 0;
    if (attempts >= MAX_PRE_HAND_RETRIES) {
      this.preHandStartRetryAttempts.delete(roomId);
      if (blockOnExhaustion) this.economyBlockedRooms.add(roomId);
      return false;
    }
    this.clearPendingStart(roomId);
    this.preHandStartRetryAttempts.set(roomId, attempts + 1);
    const timer = setTimeout(() => {
      this.pendingStartTimers.delete(roomId);
      this.startNewHand(roomId);
    }, PRE_HAND_RETRY_MS);
    this.pendingStartTimers.set(roomId, timer);
    return true;
  }

  private scheduleCompletedHandRetry(roomId: string, handNumber: number): void {
    const attempts = this.handSettlementRetryAttempts.get(roomId) ?? 0;
    if (attempts >= MAX_PRE_HAND_RETRIES) {
      this.handSettlementRetryAttempts.delete(roomId);
      return;
    }
    this.clearPendingStart(roomId);
    this.handSettlementRetryAttempts.set(roomId, attempts + 1);
    const timer = setTimeout(() => {
      this.pendingStartTimers.delete(roomId);
      const room = this.rooms.get(roomId);
      if (!room || room.engine.state.handNumber !== handNumber) return;
      this.handleCompletedHand(roomId);
    }, HAND_SETTLEMENT_RETRY_MS);
    this.pendingStartTimers.set(roomId, timer);
  }

  /**
   * 캐시 방 봇 정비 — 핸드 사이에만 호출.
   * 봇은 리바이하지 않으므로 파산한 봇 좌석을 회수하고, 설정 수(botCount, 기본 2)까지 새 봇으로
   * 다시 충원한다 — 나머지 좌석은 휴먼 몫. 솔로용 영속 방은 botCount=5.
   * 이 회수가 없으면 봇/혼합 방이 파산 봇 좌석에 잠식돼 "칩 보유 2인 미만" 정지에 빠진다.
   */
  private refreshCashBots(roomId: string): void {
    const room = this.rooms.get(roomId);
    if (!room || room.engine.state.isHandInProgress) return;
    if (room.engine.state.tournament) return; // SnG 탈락 봇 좌석은 순위 표시용으로 보존

    const bustedBots = room.engine.state.players.filter(
      p => p.type === 'bot' && p.chips <= 0 && !p.pendingRemoval,
    );
    for (const bot of bustedBots) {
      room.engine.processLeave(bot.id);
      this.sendSystemChat(roomId, `${bot.name}님이 칩을 모두 잃어 자리에서 일어납니다.`);
    }

    const humans = room.engine.state.players.filter(p => p.type === 'human').length;
    const bots = room.engine.state.players.length - humans;
    // 착석 대기자 몫의 좌석은 봇 재충원에서 제외 — 아니면 양보로 비운 자리를 봇이 도로 채운다
    const targetBots = Math.min(
      room.config.botCount ?? cfg('bot.defaultBotCount'),
      room.config.maxPlayers - humans - this.seatWaiterCount(roomId),
    );
    if (bots < targetBots) {
      fillEmptySeats(room.engine, humans + targetBots, undefined, room.config.difficulty);
    }
  }

  /**
   * 파트너 우선 착석 — 혼자 연습(bots) 방 전용. 휴먼의 인연 파트너 캐릭터가 테이블에 없으면
   * 핸드 사이에 봇 하나를 파트너로 교체(빈 좌석이 있으면 추가)한다.
   * bots 방은 휴먼 1명 제한이라 다른 유저의 테이블 구성에 영향이 없다.
   * 핸드 진행 중이면 조용히 무시 — 다음 입장에서 다시 시도되는 best-effort 연출이다.
   */
  ensurePartnerBot(roomId: string, characterId: string): boolean {
    const room = this.rooms.get(roomId);
    if (!room) return false;
    if ((room.config.tableType ?? 'mixed') !== 'bots') return false;
    if (room.engine.state.isHandInProgress) return false;
    const st = room.engine.state;
    if (st.players.some(
      p => p.type === 'bot' && (p.personalityId || p.avatar) === characterId,
    )) {
      return true; // 이미 앉아 있음
    }

    // 빈 좌석 우선, 없으면 봇 하나가 자리를 양보
    const occupied = new Set(st.players.map(p => p.seatIndex));
    let seatIndex = -1;
    for (let seat = 0; seat < room.config.maxPlayers; seat++) {
      if (!occupied.has(seat)) { seatIndex = seat; break; }
    }
    if (seatIndex < 0) {
      const yielding = st.players.find(p => p.type === 'bot' && !p.pendingRemoval);
      if (!yielding) return false;
      room.engine.processLeave(yielding.id);
      seatIndex = yielding.seatIndex;
    }
    const bot = createBotWithCharacter(
      seatIndex, st.bigBlind * 100, characterId, room.config.difficulty,
    );
    if (!bot || !room.engine.addPlayer(bot)) return false;
    this.sendSystemChat(roomId, `${bot.name}님이 파트너로 합류했어요.`);
    this.onUpdate(roomId, room.engine);
    return true;
  }

  /**
   * 칩 보유 좌석이 2명 미만이라 다음 핸드를 열 수 없는 정지 상태 안내.
   * 오류가 아니라 대기 상태다 — 파산자가 재바이인하거나 새 플레이어가 앉으면
   * join 경로(tryStartGame)가 다시 깨운다. 정지 중엔 handNumber가 멈춰 있으므로
   * 같은 handNumber에는 1회만 보낸다.
   */
  private notifyStalledHand(roomId: string): void {
    const room = this.rooms.get(roomId);
    if (!room) return;
    const handNumber = room.engine.state.handNumber;
    if (this.stallNoticeHands.get(roomId) === handNumber) return;
    this.stallNoticeHands.set(roomId, handNumber);
    const hasBustedHuman = room.engine.state.players.some(
      p => p.type === 'human' && !p.pendingRemoval && p.chips <= 0,
    );
    this.sendSystemChat(
      roomId,
      hasBustedHuman
        ? '칩을 가진 플레이어가 2명 이상 있어야 다음 핸드를 시작할 수 있어요. 칩을 모두 잃은 분은 나갔다가 다시 앉으면 새 바이인으로 계속할 수 있어요.'
        : '칩을 가진 플레이어가 2명 이상 모이면 다음 핸드가 시작돼요.',
    );
  }

  private tryStartGame(roomId: string): void {
    const room = this.rooms.get(roomId);
    if (!room || room.engine.state.isHandInProgress) return;
    if (room.engine.state.tournament?.finished) return; // 토너먼트 종료 — 재시작 없음
    // MTT 보류(브레이크/H4H 배리어/종료 처리) 중엔 다음 핸드를 잡지 않는다 — 매니저가 resumeRoom으로 해제
    if (this.isMttRoom(room) && this.mttHooks?.isHeld(roomId)) {
      this.onUpdate(roomId, room.engine);
      return;
    }

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
      this.refreshCashBots(roomId);
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
    if (this.economyBlockedRooms.has(roomId)) return;

    // [FIX 1] 이미 핸드가 진행 중이면 중복 시작 방지
    if (room.engine.state.isHandInProgress) return;
    // MTT 보류 재확인 — 예약 타이머가 걸린 뒤 브레이크/배리어가 시작됐을 수 있다
    if (this.isMttRoom(room) && this.mttHooks?.isHeld(roomId)) return;

    // 파산한 봇 좌석 회수 + 재충원 — 누적되면 칩 보유 2인 미만으로 방이 정지한다
    this.refreshCashBots(roomId);

    const walletCash = this.isWalletCash(room);
    // 2초 예약 뒤 최종 인원을 다시 본다. 아래 checkpoint→startHand 구간에는 await가 없어
    // 다른 leave/join 이벤트가 끼어 prepared identity만 남길 수 없다.
    if (walletCash && !this.canStartWalletHand(room.engine)) {
      this.tryStartGame(roomId);
      // 재충원으로도 칩 보유 좌석이 2명 미만이면(휴먼 파산 등) 정지 사유를 안내한다
      if (!room.engine.canStartHand()) this.notifyStalledHand(roomId);
      return;
    }

    const prevHandNumber = room.engine.state.handNumber;
    const nextHandNumber = prevHandNumber + 1;
    const tracksProgression = room.config.competitionMode === undefined;
    const captureProgressionHand = (): void => {
      if (!tracksProgression) return;
      this.options.progression?.captureHandStart({
        roomId,
        roomRunId: room.runId,
        handNumber: nextHandNumber,
        mode: this.progressionMode(room),
        players: room.engine.state.players
          .filter(player => player.type === 'human' && !player.pendingRemoval)
          .map(player => ({
            profileId: player.id,
            fallbackCharacterId: player.avatar,
            dealt: player.chips > 0 && player.status !== 'sitting-out',
          })),
      });
    };
    let progressionCaptured = false;

    let cashHandPrepared = false;
    if (walletCash) {
      try {
        this.requireEconomy().beforeHand(roomId, room.engine);
        cashHandPrepared = true;
      } catch {
        this.economyBlockedRooms.add(roomId);
        this.sendSystemChat(roomId, '저장 연결을 확인 중이에요');
        this.onUpdate(roomId, room.engine);
        return;
      }
    }

    // 시트앤고: 첫 핸드 직전 토너먼트 개시, 이후엔 시간 경과에 따른 레벨 인상
    // MTT: 개시·상금·레벨은 전부 TournamentManager 소유 — 공용 시계에서 레벨만 당겨 적용
    const tournament = room.engine.state.tournament;
    if (tournament && this.isMttRoom(room)) {
      if (tournament.finished) return;
      this.mttHooks?.applyLevel(roomId, room.engine);
    } else if (tournament) {
      if (tournament.finished) return;
      if (tournament.entrants === 0) {
        const walletSng = this.isWalletSng(room);
        if (walletSng && !this.canStartWalletSng(room.engine, room.config)) {
          return;
        }
        try {
          captureProgressionHand();
          progressionCaptured = true;
        } catch {
          if (tracksProgression) {
            this.options.progression?.cancelHand(roomId, room.runId, nextHandNumber);
          }
          this.schedulePreHandRetry(roomId, false);
          this.sendSystemChat(roomId, '저장 연결을 확인 중이에요');
          this.onUpdate(roomId, room.engine);
          return;
        }
        const preTournamentState = JSON.stringify(room.engine.state);
        let tournamentStartCommitted = false;
        if (walletSng) {
          try {
            this.requireEconomy().beforeTournament(roomId, room.engine);
            tournamentStartCommitted = true;
          } catch {
            if (tracksProgression) {
              this.options.progression?.cancelHand(roomId, room.runId, nextHandNumber);
            }
            this.sendSystemChat(roomId, '저장 연결을 확인 중이에요');
            this.onUpdate(roomId, room.engine);
            return;
          }
        }
        const startedAt = Date.now();
        const next = SNG_BLIND_SCHEDULE[1] ?? null;
        try {
          room.engine.startTournament(
            startedAt + SNG_LEVEL_DURATION_MS,
            next?.smallBlind ?? null,
            next?.bigBlind ?? null,
          );
        } catch {
          if (tracksProgression) {
            this.options.progression?.cancelHand(roomId, room.runId, nextHandNumber);
          }
          if (!this.revertUnmutatedTournamentStart(
            roomId,
            room.engine,
            tournamentStartCommitted,
            preTournamentState,
          )) {
            this.economyBlockedRooms.add(roomId);
            this.unresolvedSettlementRooms.add(roomId);
          }
          this.sendSystemChat(roomId, '저장 연결을 확인 중이에요');
          this.onUpdate(roomId, room.engine);
          return;
        }
        if (walletSng && room.engine.state.tournament?.entrants !== 6) {
          if (tracksProgression) {
            this.options.progression?.cancelHand(roomId, room.runId, nextHandNumber);
          }
          if (!this.revertUnmutatedTournamentStart(
            roomId,
            room.engine,
            tournamentStartCommitted,
            preTournamentState,
          )) {
            this.economyBlockedRooms.add(roomId);
            this.unresolvedSettlementRooms.add(roomId);
          }
          this.sendSystemChat(roomId, '저장 연결을 확인 중이에요');
          this.onUpdate(roomId, room.engine);
          return;
        }
        this.tournamentClocks.set(roomId, {
          startedAt,
          announcedResults: 0,
          finishedAnnounced: false,
        });
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
      // 시간 초과 자동 마킹은 해당 핸드 안에서만 유효 — 새 핸드부터는 일반 자리비움 취급
      // (캐시: 딜인 제외 / SnG: away 자동 폴드로 복귀. 안 그러면 부재 좌석이 매 핸드 테이블을 붙잡는다)
      p.sitOutAuto = undefined;
      if (p.chips > 0) {
        const out = !isSng && (p.isDisconnected || p.sitOutNext);
        p.status = out ? 'sitting-out' : 'waiting';
        // 캐시 자리비움 시작 시점 기록 (미납 오르빗 + 벽시계 하한 산정 기준). 복귀하면 clear.
        if (out) {
          if (p.sitOutSinceHand === undefined) {
            p.sitOutSinceHand = room.engine.state.handNumber;
            p.sitOutSinceMs = Date.now();
          }
        } else {
          p.sitOutSinceHand = undefined;
          p.sitOutSinceMs = undefined;
        }
      }
    }

    const preStartState = JSON.stringify(room.engine.state);
    try {
      if (!progressionCaptured) captureProgressionHand();
      room.engine.startHand();
    } catch {
      if (tracksProgression) {
        this.options.progression?.cancelHand(roomId, room.runId, nextHandNumber);
      }
      const classification = this.classifyUnstartedHand(
        roomId,
        room.engine,
        cashHandPrepared,
        preStartState,
      );
      if (classification === 'blocked') {
        this.economyBlockedRooms.add(roomId);
      } else {
        this.schedulePreHandRetry(roomId);
      }
      this.sendSystemChat(roomId, '저장 연결을 확인 중이에요');
      this.onUpdate(roomId, room.engine);
      return;
    }

    if (room.engine.state.handNumber > prevHandNumber) {
      if (this.isMttRoom(room)) {
        this.mttHooks?.onHandStarted(roomId, room.engine.state.handNumber);
      }
      this.preHandStartRetryAttempts.delete(roomId);
      if (tracksProgression) {
        this.options.progression?.confirmHandStart(roomId, room.runId, nextHandNumber);
      }
      const s = room.engine.state;
      eventLog.log('hand-start', {
        roomId,
        data: {
          handNumber: s.handNumber,
          blinds: `${s.smallBlind}/${s.bigBlind}`,
          dealerIndex: s.dealerIndex,
          // 딜인 구성 — "왜 저 사람이 이번 핸드에 빠졌나"를 되짚는 기준점 (홀카드는 절대 남기지 않는다)
          players: s.players.map(p => ({
            id: p.id, name: p.name, type: p.type, seat: p.seatIndex, chips: p.chips, status: p.status,
          })),
        },
      });
    }

    if (!room.engine.state.isHandInProgress) {
      if (room.engine.state.handNumber > prevHandNumber) {
        // 딜은 됐지만 블라인드 전원 올인 런아웃으로 즉시 쇼다운까지 끝난 핸드 — 정상 종료 플로우
        this.handleCompletedHand(roomId);
      } else {
        if (tracksProgression) {
          this.options.progression?.cancelHand(roomId, room.runId, nextHandNumber);
        }
        // 이탈자 제거 후 인원 부족 등으로 핸드가 시작되지 못함 — 봇 충원 경로로 재시도
        const classification = this.classifyUnstartedHand(
          roomId,
          room.engine,
          cashHandPrepared,
          preStartState,
        );
        if (classification === 'blocked') {
          this.economyBlockedRooms.add(roomId);
          this.sendSystemChat(roomId, '저장 연결을 확인 중이에요');
          this.onUpdate(roomId, room.engine);
          return;
        }
        // 칩 보유 좌석 부족(휴먼 파산 등)은 오류가 아니라 대기 상태 — 재시도로 해결되지
        // 않으므로 차단 없이 유휴 대기한다 (입장/리바이가 tryStartGame으로 다시 깨운다).
        // 여기서 schedulePreHandRetry를 태우면 재시도 소진 시 방이 영구 차단된다.
        if (!room.engine.canStartHand()) {
          this.preHandStartRetryAttempts.delete(roomId);
          this.notifyStalledHand(roomId);
          this.onUpdate(roomId, room.engine);
          return;
        }
        this.schedulePreHandRetry(roomId);
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
      // 타임스탬프가 없으면(구 상태) 벽시계 조건은 통과한 것으로 본다 — 오르빗 조건 단독 판정
      const satOutMs = p.sitOutSinceMs === undefined ? Infinity : Date.now() - p.sitOutSinceMs;
      if (shouldRemoveForMissedBlinds(handsSatOut, orbitSize, satOutMs, {
        missedBbLimit: cfg('table.sitoutMissedBbLimit'),
        minWallMs: cfg('table.sitoutMinWallMs'),
      })) toRemove.push(p);
    }
    for (const p of toRemove) {
      if (this.leaveRoom(roomId, p.id)) {
        this.sendSystemChat(roomId, `${p.name}님이 빅블라인드를 ${cfg('table.sitoutMissedBbLimit')}번 걸러 자리에서 일어납니다.`);
        this.options.onSeatReclaimed?.(roomId, p.id);
      }
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

    const timeoutMs = overrideMs
      ?? (room.config.turnTime || cfg('timer.turnTimeDefault')) * 1000;
    const deadline = Date.now() + timeoutMs;
    this.turnDeadlines.set(roomId, deadline);

    const timer = setTimeout(() => {
      this.turnTimers.delete(roomId);
      this.turnDeadlines.delete(roomId);

      // 시간 초과 → 즉시 자동 체크/폴드 + 자리비움 마킹. 타임칩은 자동 소모하지 않는다 —
      // 연장은 본인이 ActionBar 타임칩 버튼을 눌렀을 때만(useTimeBank). 자동 연장은
      // 부재중 좌석이 타임칩 수만큼 매 턴 테이블을 수십 초씩 붙잡는 문제가 있었다.
      // (캐시: 다음 핸드 딜아웃, SnG: away 자동 폴드) 복귀는 ActionBar [게임 복귀].
      const current = this.rooms.get(roomId);
      const stillActive = current?.engine.state.players[current.engine.state.activePlayerIndex];
      if (
        current && stillActive && stillActive.id === activePlayer.id
        && current.engine.state.isHandInProgress
        && !stillActive.sitOutNext && stillActive.status !== 'sitting-out'
      ) {
        // 자동 마킹(sitOutAuto)은 명시적 자리비움과 다르다 — 같은 핸드의 남은 스트리트에서는
        // 기본 턴 시간을 그대로 주고, 본인이 액션하면 즉시 해제된다 (잠깐 자리 비운 사람 보호)
        stillActive.sitOutNext = true;
        stillActive.sitOutAuto = true;
        this.sendSystemChat(
          roomId,
          `${stillActive.name}님이 응답이 없어 자리비움 처리됐어요 — 다시 액션하거나 [게임 복귀]를 누르면 참여해요.`,
        );
      }
      this.autoActFor(roomId, activePlayer.id, '시간 초과');
    }, timeoutMs);

    this.turnTimers.set(roomId, timer);
  }

  // --- 자리비움 후 이탈 좌석의 최종 정리 타이머 ---

  private abandonKey(roomId: string, playerId: string): string {
    return `${roomId}:${playerId}`;
  }

  /** 자리비움 이탈·파산(0칩) 좌석에 최종 정리 유예를 건다 (캐시 전용 — SnG는 블라인드 소진에 맡김) */
  private scheduleSitOutAbandon(
    roomId: string,
    playerId: string,
    delayMs: number = cfg('table.sitoutAbandonMs'),
  ): void {
    // 파산 리바이 유예(BUST_RECLAIM_MS)가 이미 무장돼 있으면 더 긴 유예로 되돌리지 않는다 —
    // 파산 직후 sitOutAndLeave가 5분 방치 유예를 덮어써 30초 유예가 풀리는 순서 하자 방지
    const armed = this.rooms.get(roomId)?.engine.state.players
      .find(p => p.id === playerId)?.bustReclaimDeadline;
    if (armed !== undefined) {
      const remaining = armed - Date.now();
      if (remaining > 0 && delayMs > remaining) delayMs = remaining;
    }
    const key = this.abandonKey(roomId, playerId);
    const existing = this.sitOutAbandonTimers.get(key);
    if (existing) clearTimeout(existing);
    const timer = setTimeout(() => {
      this.sitOutAbandonTimers.delete(key);
      const r = this.rooms.get(roomId);
      const p = r?.engine.state.players.find(pl => pl.id === playerId);
      if (!r || !p) return;
      // 진행 중 핸드에 살아 있는 좌석(올인 0칩 포함 — 팟 지분 보유)은 건드리지 않는다
      const inHandAlive = r.engine.state.isHandInProgress
        && (p.status === 'active' || p.status === 'all-in');
      if (inHandAlive) return;
      const busted = p.chips <= 0;
      if (busted || p.sitOutNext || p.status === 'sitting-out') {
        if (this.leaveRoom(roomId, p.id)) {
          this.sendSystemChat(
            roomId,
            busted
              ? `${p.name}님이 리바이 없이 자리를 오래 비워 자리를 정리했어요.`
              : `${p.name}님이 오랫동안 돌아오지 않아 자리를 정리했어요.`,
          );
          this.options.onSeatReclaimed?.(roomId, p.id);
        }
      }
    }, delayMs);
    this.sitOutAbandonTimers.set(key, timer);
  }

  /**
   * 캐시 파산(0칩) 휴먼 좌석에 리바이 유예(BUST_RECLAIM_MS, 30초)를 건다 (핸드 종료 시점 호출).
   * 파산 좌석은 trackMissedBlinds가 chips<=0을 건너뛰어 미납 BB 정리 대상이 아니므로,
   * 접속을 유지한 채 방치되면 이 유예가 유일한 회수 경로다 (오프라인도 이 유예가 30초 내 회수 —
   * grace 만료는 그보다 빠를 때만 관여). 이미 무장된 유예(bustReclaimDeadline)는 갱신하지
   * 않는다 — 다른 좌석의 핸드가 끝날 때마다 재무장하면 유예가 영영 만료되지 않는다.
   * 단, 파산 전에 걸린 더 긴 자리비움 유예(5분)는 30초 유예로 교체한다.
   */
  private scheduleBustReclaims(roomId: string): void {
    const room = this.rooms.get(roomId);
    if (!room || this.isTournamentRoom(room)) return;
    let armed = false;
    for (const p of room.engine.state.players) {
      if (p.type !== 'human' || p.pendingRemoval || p.chips > 0) continue;
      if (p.bustReclaimDeadline !== undefined) continue;
      const bustReclaimMs = cfg('table.bustReclaimMs');
      p.bustReclaimDeadline = Date.now() + bustReclaimMs;
      this.scheduleSitOutAbandon(roomId, p.id, bustReclaimMs);
      armed = true;
    }
    // 카운트다운(bustReclaimDeadline)이 바로 화면에 실리도록 스냅샷을 다시 브로드캐스트
    if (armed) this.onUpdate(roomId, room.engine);
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
  toggleSitOut(roomId: string, playerId: string): boolean {
    const room = this.rooms.get(roomId);
    if (!room) return false;
    const player = room.engine.state.players.find(p => p.id === playerId);
    if (!player || player.pendingRemoval) return false;

    const isSng = this.isTournamentRoom(room); // SnG/MTT 공통: 딜인 유지 + away 자동 폴드
    const sittingOut = player.sitOutNext || player.status === 'sitting-out';
    if (sittingOut) {
      // --- 게임 복귀 ---
      player.sitOutNext = false;
      player.sitOutAuto = undefined;
      player.sitOutSinceHand = undefined;
      player.sitOutSinceMs = undefined;
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
      return true;
    }

    // --- 자리비움 시작 --- (명시 선언이므로 시간 초과 자동 마킹은 소거 — 턴 즉시 자동 처리 대상)
    player.sitOutNext = true;
    player.sitOutAuto = undefined;
    const inHand = room.engine.state.isHandInProgress
      && (player.status === 'active' || player.status === 'all-in');
    // 캐시는 핸드에 끼어 있지 않으면 즉시 자리비움 확정 (핸드 중이면 다음 핸드 딜인에서 제외된다)
    if (!isSng && !inHand) player.status = 'sitting-out';
    this.sendSystemChat(
      roomId,
      isSng
        ? `${player.name}님이 자리를 비웁니다 — 돌아올 때까지 자동 폴드돼요 (블라인드는 계속 차감).`
        : `${player.name}님이 자리를 비웁니다 — 빅블라인드를 ${cfg('table.sitoutMissedBbLimit')}번 거르면 자동으로 일어나요.`,
    );
    // 지금이 본인 턴이면 즉시 자동 처리 — 자리에 없는 사람을 테이블이 기다리지 않게 (캐시/SnG 공통).
    // 이게 없으면 턴 타이머 + 타임뱅크가 모두 소진될 때까지(최대 38초) 게임이 멈춘다.
    if (inHand) {
      const active = room.engine.state.players[room.engine.state.activePlayerIndex];
      if (active?.id === playerId) {
        this.clearTurnTimer(roomId);
        this.autoActFor(roomId, playerId, '자리비움');
        return true; // autoActFor가 onUpdate/루프 재개까지 처리
      }
    }
    this.onUpdate(roomId, room.engine);
    return true;
  }

  /** 자리비움 상태로 방을 떠남 — 좌석/칩 유지 (leave-room mode:'sitout') */
  sitOutAndLeave(roomId: string, playerId: string): void {
    const room = this.rooms.get(roomId);
    if (!room) return;
    const player = room.engine.state.players.find(p => p.id === playerId);
    if (!player || player.pendingRemoval) return;

    const already = player.sitOutNext || player.status === 'sitting-out';
    if (!already) this.toggleSitOut(roomId, playerId);
    // 방을 떠나는 것도 명시적 부재 선언 — 시간 초과 마킹의 '기본 시간 보장'을 해제해
    // 남은 턴이 1초 자동 처리되게 한다 (떠난 사람을 스트리트마다 8초씩 기다리지 않게)
    player.sitOutAuto = undefined;

    // 떠난 뒤 지금이 본인 턴이면(핸드 중 이탈) 즉시 자동 처리 — 남은 플레이어가 기다리지 않게
    if (room.engine.state.isHandInProgress) {
      const active = room.engine.state.players[room.engine.state.activePlayerIndex];
      if (active?.id === playerId) {
        this.clearTurnTimer(roomId);
        this.autoActFor(roomId, playerId, '자리비움');
      }
    }

    // 캐시: 돌아오지 않아도 확실히 회수되도록 최종 정리 유예.
    // 토너먼트(SnG/MTT)는 회수하지 않는다 — 블라인드·앤티 소진 → 자연 탈락 (TDA 30).
    // MTT를 회수 대상에 넣으면 leaveRoom 경유로 기권 탈락이 되어 자리비움 계약이 깨진다.
    if (!this.isTournamentRoom(room)) {
      this.scheduleSitOutAbandon(roomId, playerId);
    }
  }

  /**
   * 나가기 예약 설정/취소 (leave-room mode:'reserve-*', 캐시 전용).
   * - 'hand': 이번 핸드 종료 시 자동 퇴장. 진행 중 핸드에 딜인돼 있지 않으면(핸드 사이·
   *   자리비움·이미 폴드) 기다릴 핸드가 없으므로 'leave-now' — 호출부가 즉시 exit 처리한다.
   * - 'bb': 다음 빅블라인드를 낼 차례가 오기 직전 자동 퇴장 (핸드 종료 시마다
   *   predictNextBigBlindId로 판정). 핸드 사이에 이미 다음 BB로 예측되면 'leave-now'.
   * - null: 예약 취소.
   * SnG/아레나는 기권·순위 규칙과 얽혀 예약을 지원하지 않는다 ('rejected').
   */
  setLeaveReservation(
    roomId: string,
    playerId: string,
    kind: 'hand' | 'bb' | null,
  ): 'reserved' | 'cleared' | 'leave-now' | 'rejected' {
    const room = this.rooms.get(roomId);
    const player = room?.engine.state.players.find(p => p.id === playerId);
    if (!room || !player || player.pendingRemoval) return 'rejected';
    if (kind === null) {
      if (player.leaveReservation) {
        player.leaveReservation = undefined;
        this.onUpdate(roomId, room.engine);
      }
      return 'cleared';
    }
    if (this.isTournamentRoom(room) || room.config.competitionMode) return 'rejected';

    const st = room.engine.state;
    const inCurrentHand = st.isHandInProgress
      && (player.status === 'active' || player.status === 'all-in');
    if (kind === 'hand' && !inCurrentHand) return 'leave-now';
    if (kind === 'bb' && !st.isHandInProgress) {
      // 다음 핸드에 딜인되지 않는 좌석(자리비움/끊김/파산)은 더 낼 블라인드가 없다 — 즉시 퇴장
      const willBeDealt = player.chips > 0
        && !(player.isDisconnected || player.sitOutNext)
        && player.status !== 'sitting-out';
      if (!willBeDealt || room.engine.predictNextBigBlindId() === playerId) {
        return 'leave-now';
      }
    }
    player.leaveReservation = kind;
    this.onUpdate(roomId, room.engine);
    return 'reserved';
  }

  /**
   * 나가기 예약 실행 — 핸드 종료(정산 확정) 시점에 handleCompletedHand가 호출.
   * 'hand'는 무조건, 'bb'는 다음 핸드 BB로 예측되는 좌석만 퇴장 처리한다.
   * 단 'bb'라도 다음 핸드에 딜인되지 않는 좌석(자리비움/시간 초과 마킹/끊김/파산)은 더 낼
   * 블라인드가 없으므로 즉시 이행한다 — 딜인 제외 좌석은 영영 BB로 예측되지 않아, 이 처리가
   * 없으면 자리 뜬 예약자가 방치 타이머까지 좌석을 붙잡는다.
   * leaveRoom 실패(지갑 정산 실패로 방 잠금)면 예약을 유지해 다음 핸드 종료 때 재시도한다.
   */
  private processLeaveReservations(roomId: string): void {
    const room = this.rooms.get(roomId);
    if (!room || room.engine.state.isHandInProgress) return;
    const willBeDealt = (p: Player): boolean =>
      p.chips > 0 && !(p.isDisconnected || p.sitOutNext) && p.status !== 'sitting-out';
    const due = room.engine.state.players.filter(p =>
      p.type === 'human'
      && !p.pendingRemoval
      && p.leaveReservation !== undefined
      && (p.leaveReservation === 'hand'
        || !willBeDealt(p)
        || room.engine.predictNextBigBlindId() === p.id));
    for (const p of due) {
      if (!this.rooms.has(roomId)) return; // 앞선 퇴장으로 방이 정리됐으면 종료
      const reason = p.leaveReservation === 'hand' ? '핸드 종료' : '빅블라인드 순서';
      if (this.leaveRoom(roomId, p.id)) {
        this.options.onSeatReclaimed?.(
          roomId,
          p.id,
          `예약하신 대로 ${reason}에 맞춰 테이블에서 나왔어요.`,
        );
      }
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
    const isSng = this.isTournamentRoom(room); // SnG/MTT 공통: 좌석 무조건 보존
    const sittingOut = player.sitOutNext || player.status === 'sitting-out';
    // 캐시 파산(0칩) 좌석은 지킬 칩이 없다 — 자리비움이라도 유지하지 않고 즉시 회수
    // (진행 중 핸드의 올인 0칩은 팟 지분이 살아 있으므로 파산이 아니다. 재입장은 새 바이인 리바이)
    const inHandAlive = room.engine.state.isHandInProgress
      && (player.status === 'active' || player.status === 'all-in');
    const busted = player.chips <= 0 && !inHandAlive;
    const keep = isSng || (sittingOut && !busted);
    if (!keep) {
      return !this.leaveRoom(roomId, playerId);
    }
    // 좌석을 지키기로 했으니 회수 카운트다운은 해제 (타임바가 0에서 얼어붙지 않게)
    player.disconnectGraceDeadline = undefined;
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
    // 리바이 완료 — 파산 유예 카운트다운 해제
    const player = this.rooms.get(roomId)?.engine.state.players
      .find(p => p.id === playerId);
    if (player) player.bustReclaimDeadline = undefined;
  }

  /**
   * 핸드 정산 뒤 escrow가 이미 cashout된 pending 좌석을 새 입장 전에 폐기한다.
   * 일반 leaveRoom을 타면 빈 방 정리/reset이 먼저 실행될 수 있으므로 좌석만 제한적으로 제거한다.
   */
  retirePendingSeat(roomId: string, playerId: string): boolean {
    const room = this.rooms.get(roomId);
    if (!room || room.engine.state.isHandInProgress) return false;
    const player = room.engine.state.players.find(candidate => (
      candidate.id === playerId && candidate.pendingRemoval
    ));
    if (!player) return false;
    this.cancelSitOutAbandon(roomId, playerId);
    const removed = room.engine.processLeave(playerId).player;
    if (!removed) return false;
    this.onRoomsChanged?.();
    return true;
  }

  /**
   * DB reserve가 이미 환불된 대기 SnG 메모리 좌석을 새 reserve 전에 제거한다.
   * 경제 훅을 다시 호출하지 않아 이중 환불을 피하고, 시작된 토너먼트에는 적용하지 않는다.
   */
  retireUnbackedWaitingSngSeat(roomId: string, playerId: string): boolean {
    const room = this.rooms.get(roomId);
    if (
      !room
      || !this.isWalletSng(room)
      || room.engine.state.isHandInProgress
      || room.engine.state.tournament?.entrants !== 0
    ) {
      return false;
    }
    const player = room.engine.state.players.find(candidate => (
      candidate.id === playerId
      && candidate.type === 'human'
      && !candidate.pendingRemoval
    ));
    if (!player) return false;
    this.cancelSitOutAbandon(roomId, playerId);
    const removed = room.engine.processLeave(playerId).player;
    if (!removed) return false;
    this.onRoomsChanged?.();
    return true;
  }

  /** 다른 방에 남아 있는 좌석 정리 — 새 방 착석 시 자리비움 좌석 회수 (1세션 1테이블) */
  leaveAllSeatsExcept(playerId: string, exceptRoomId: string): boolean {
    for (const [id, room] of this.rooms) {
      if (id === exceptRoomId) continue;
      if (room.engine.state.players.some(p => p.id === playerId && !p.pendingRemoval)) {
        if (!this.leaveRoom(id, playerId)) return false;
      }
    }
    return true;
  }

  /** 타임칩 사용 — 본인 턴에 남은 시간 +30초 */
  useTimeBank(roomId: string, playerId: string): boolean {
    const room = this.rooms.get(roomId);
    if (!room || !room.engine.state.isHandInProgress) return false;
    const activePlayer = room.engine.state.players[room.engine.state.activePlayerIndex];
    if (!activePlayer || activePlayer.id !== playerId || activePlayer.type !== 'human') return false;
    if ((activePlayer.timeBankChips ?? 0) <= 0) return false;

    activePlayer.timeBankChips = (activePlayer.timeBankChips ?? 0) - 1;
    const remaining = this.getTurnTimeRemaining(roomId);
    this.startTurnTimer(roomId, remaining + TIME_BANK_EXTEND_MS);
    this.sendSystemChat(roomId, `${activePlayer.name}님이 타임칩을 사용했습니다 (+${TIME_BANK_EXTEND_MS / 1000}초).`);
    this.onUpdate(roomId, room.engine);
    return true;
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
        this.handleCompletedHand(roomId);
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

  /**
   * disconnect 직후: 좌석/칩은 유지하고 마킹만. 자기 턴이면 즉시 자동 처리.
   * graceDeadline(epoch ms)을 주면, grace 만료 시 좌석이 실제로 제거되는 경우
   * (캐시 & 비자리비움 — handleGraceExpired의 keep 판정과 동일 기준)에만 스냅샷에 실어
   * 클라이언트가 회수 카운트다운 타임바를 그리게 한다.
   */
  handleDisconnect(roomId: string, playerId: string, graceDeadline?: number): void {
    const room = this.rooms.get(roomId);
    if (!room) return;
    const player = room.engine.state.players.find(p => p.id === playerId);
    if (!player || player.pendingRemoval) return;

    player.isDisconnected = true;
    const sittingOut = player.sitOutNext || player.status === 'sitting-out';
    const willBeRemoved = room.config.gameMode !== 'sng' && !sittingOut;
    player.disconnectGraceDeadline = willBeRemoved ? graceDeadline : undefined;
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

    const wasDisconnected = !!player.isDisconnected;
    player.isDisconnected = false;
    player.disconnectGraceDeadline = undefined;
    // 돌아왔으니 최종 정리 유예 취소
    this.cancelSitOutAbandon(roomId, playerId);
    // 명시적 자리비움(sitOutNext)은 재접속만으로 해제하지 않는다 — 본인이 복귀 버튼을 눌러야 함
    if (player.status === 'sitting-out' && player.chips > 0 && !player.sitOutNext) {
      player.status = 'waiting'; // 다음 핸드 자동 참여
    }
    if (wasDisconnected) this.sendSystemChat(roomId, `${player.name}님이 다시 연결됐어요!`);
    this.onUpdate(roomId, room.engine);
    this.tryStartGame(roomId);
  }

  // --- 통합 플레이어 루프 (봇 + 휴먼 턴 타이머) ---

  private startPlayerLoop(roomId: string): void {
    this.stopBotLoop(roomId);
    this.clearTurnTimer(roomId);

    const room = this.rooms.get(roomId);
    if (!room || !room.engine.state.isHandInProgress) return;

    // 올인 런아웃 모드: 더 이상 액션이 없다 — 턴 타이머 대신 스트리트 시간차 딜 체인을 돌린다
    if (room.engine.state.allInRunout) {
      this.scheduleRunoutStreet(roomId);
      return;
    }

    const activePlayer = room.engine.state.players[room.engine.state.activePlayerIndex];
    if (!activePlayer) return;

    // 즉시 자동 처리 대상: 접속 끊김(부재) 또는 명시적 자리비움(캐시·SnG 공통).
    // 자리비움은 "나는 이 자리에 없다"는 선언이므로 그 사람의 턴을 기다리지 않는다 — 기다리면
    // 타임뱅크까지 소진되며 테이블이 최대 38초 멈춘다. 팟에 이미 넣은 칩은 체크 가능하면
    // 체크로 지켜진다(autoActFor). 캐시/SnG 차이는 딜인 여부일 뿐 턴 처리는 동일.
    // 단, 시간 초과 자동 마킹(sitOutAuto)은 예외 — 같은 핸드의 남은 스트리트에서는 매번
    // 기본 턴 시간을 그대로 준다 (플랍 타임아웃이 턴/리버 즉시 체크로 번지지 않게).
    const autoAct = activePlayer.isDisconnected
      || (!!activePlayer.sitOutNext && !activePlayer.sitOutAuto);
    if (activePlayer.type === 'bot') {
      this.startBotLoop(roomId);
    } else if (autoAct) {
      this.clearTurnTimer(roomId);
      const reason = activePlayer.isDisconnected ? '접속 끊김' : '자리비움';
      const timer = setTimeout(() => {
        this.turnTimers.delete(roomId);
        this.autoActFor(roomId, activePlayer.id, reason);
      }, cfg('timer.disconnectedAutoActMs'));
      this.turnTimers.set(roomId, timer);
    } else {
      // 휴먼 턴 → 타이머 시작
      this.startTurnTimer(roomId);
    }
  }

  /**
   * 올인 런아웃 스트리트 딜 체인 — 핸드 공개 상태에서 스트리트를 하나씩 시간차로 깐다.
   * 타이머는 turnTimers 슬롯을 재사용해 기존 정리 경로(dispose/leave/shutdown)를 그대로 탄다.
   * 진행 중 이탈로 핸드가 먼저 끝났으면(allInRunout 해제) 아무것도 하지 않는다.
   */
  private scheduleRunoutStreet(roomId: string): void {
    this.clearTurnTimer(roomId);
    const timer = setTimeout(() => {
      this.turnTimers.delete(roomId);
      const room = this.rooms.get(roomId);
      if (!room || !room.engine.state.isHandInProgress || !room.engine.state.allInRunout) return;
      const done = room.engine.dealRunoutStreet();
      if (done) {
        this.handleCompletedHand(roomId);
      } else {
        this.onUpdate(roomId, room.engine);
        this.scheduleRunoutStreet(roomId);
      }
    }, this.options.runoutStreetDelayMs ?? cfg('timer.runoutStreetDelayMs'));
    this.turnTimers.set(roomId, timer);
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

      const { acted, action } = await processBotTurn(room.engine, isStale, aggressorId => {
        // 상습 쇼버/레이저 대응은 휴먼 상대에게만 — 봇끼리는 기본 전략 유지
        const aggressor = room.engine.state.players.find(p => p.id === aggressorId);
        if (aggressor?.type !== 'human') return undefined;
        return this.aggroTrackers.get(roomId)?.stats(aggressorId, room.engine.state.handNumber);
      }, cfg('bot.thinkDelayPct') / 100);
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
          this.handleCompletedHand(roomId);
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
    if (this.economyBlockedRooms.has(roomId)) return;

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
    if (fresh > 0) {
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
    }

    if (tournament.finished && !clock.finishedAnnounced) {
      clock.finishedAnnounced = true;
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
      this.retainFinishedTournament(roomId);
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

  shutdown(): void {
    for (const roomId of [...this.rooms.keys()]) {
      if (this.disposeRoom(roomId, 'shutdown', false)) continue;
      // 진행 중 wallet hand는 마지막 checkpoint를 startup recovery가 환불해야 하므로
      // 엔진을 dispose/reset하지 않고 타이머만 멈춘다. 프로세스 종료와 함께 메모리만 사라진다.
      this.stopBotLoop(roomId);
      this.clearPendingStart(roomId);
      this.clearTurnTimer(roomId);
      for (const [key, timer] of this.sitOutAbandonTimers) {
        if (!key.startsWith(`${roomId}:`)) continue;
        clearTimeout(timer);
        this.sitOutAbandonTimers.delete(key);
      }
    }
    for (const timer of this.finishedRoomTimers.values()) clearTimeout(timer);
    this.finishedRoomTimers.clear();
    for (const timer of this.emptyRoomTimers.values()) clearTimeout(timer);
    this.emptyRoomTimers.clear();
    this.dialogue.shutdown();
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

    // 시간 초과 자동 마킹은 본인 액션으로 즉시 해제 — 잠깐 자리를 비웠다 돌아온 사람이
    // [게임 복귀]를 따로 누르지 않아도 다음 핸드에서 빠지지 않는다 (명시적 자리비움은 유지)
    const actor = room.engine.state.players.find(p => p.id === playerId);

    // 휴먼 공격 액션 기록 — 봇의 상습 쇼버/레이저 대응 재료 (aggro-tracker)
    if (actor?.type === 'human' && (actionType === 'raise' || actionType === 'all-in')) {
      let tracker = this.aggroTrackers.get(roomId);
      if (!tracker) {
        tracker = new AggroTracker();
        this.aggroTrackers.set(roomId, tracker);
      }
      tracker.record(
        playerId,
        actionType === 'all-in' ? 'shove' : 'raise',
        room.engine.state.handNumber,
      );
    }
    if (actor?.sitOutAuto) {
      actor.sitOutAuto = undefined;
      actor.sitOutNext = false;
      actor.sitOutSinceHand = undefined;
      actor.sitOutSinceMs = undefined;
      this.sendSystemChat(roomId, `${actor.name}님이 게임에 복귀했습니다.`);
    }

    if (result.handComplete) {
      this.handleCompletedHand(roomId);
    } else {
      // 타이머를 먼저 시작해야 스냅샷에 turnTimeRemaining이 실린다
      this.startPlayerLoop(roomId);
      this.onUpdate(roomId, room.engine);
    }

    return true;
  }

  private isWalletCash(room: {
    config: RoomConfig;
    engine: PokerEngine;
  }): boolean {
    return (
      (room.config.gameMode ?? 'cash') === 'cash'
      && room.config.economyMode === 'wallet'
    );
  }

  private isWalletSng(room: {
    config: RoomConfig;
    engine: PokerEngine;
  }): boolean {
    return (
      room.config.gameMode === 'sng'
      && room.config.economyMode === 'wallet'
    );
  }

  private progressionMode(room: {
    config: RoomConfig;
    engine: PokerEngine;
  }): RuntimeGameMode {
    if (room.engine.state.tournament) return 'sng';
    return room.config.economyMode === 'practice' ? 'practice' : 'cash';
  }

  private canStartWalletSng(engine: PokerEngine, config: RoomConfig): boolean {
    return (
      Number.isSafeInteger(config.entryBuyIn)
      && (config.entryBuyIn as number) > 0
      && Number.isSafeInteger(config.entryFee)
      && (config.entryFee as number) > 0
      && config.startingStack === config.entryBuyIn
      && engine.state.players.length === 6
      && engine.state.players.every(player => (
        player.type === 'human'
        && !player.pendingRemoval
        && player.chips === config.entryBuyIn
      ))
    );
  }

  private revertUnmutatedTournamentStart(
    roomId: string,
    engine: PokerEngine,
    committed: boolean,
    preTournamentState: string,
  ): boolean {
    if (JSON.stringify(engine.state) !== preTournamentState) return false;
    if (!committed) return true;
    try {
      return this.requireEconomy().cancelTournamentStart(roomId, engine);
    } catch {
      return false;
    }
  }

  private settleFinishedWalletTournament(roomId: string): boolean {
    const room = this.rooms.get(roomId);
    if (!room || !this.isWalletSng(room) || !room.engine.state.tournament?.finished) {
      return true;
    }
    if (this.settledTournamentRooms.has(roomId)) return true;
    try {
      this.requireEconomy().afterTournament(roomId, room.engine);
      this.completeProgressionTournament(roomId);
      this.settledTournamentRooms.add(roomId);
      this.recoverFinishedTournament(roomId);
      return true;
    } catch {
      this.blockFinishedTournament(roomId, room.engine);
      return false;
    }
  }

  private finalizeFinishedTournament(roomId: string): boolean {
    const room = this.rooms.get(roomId);
    if (!room?.engine.state.tournament?.finished) return true;
    if (this.isMttRoom(room)) return true; // MTT 상금/기록 정산은 TournamentManager 소유
    if (room.config.competitionMode) {
      if (this.settledTournamentRooms.has(roomId)) return true;
      try {
        const matchId = room.config.arenaMatchId;
        if (!matchId || !this.options.arena) {
          throw new Error('Arena settlement is unavailable');
        }
        const playerTypes = new Map(
          room.engine.state.players.map(player => [player.id, player.type]),
        );
        const results = room.engine.state.tournament.results.map(result => {
          const type = playerTypes.get(result.playerId);
          if (!type) throw new Error('Arena result player is unavailable');
          return {
            playerId: result.playerId,
            place: result.place,
            type,
          };
        });
        if (room.config.competitionMode === 'arena-official') {
          this.options.arena.completeOfficial({ matchId, results });
        } else {
          this.options.arena.completeTraining?.({ matchId, results });
        }
        this.settledTournamentRooms.add(roomId);
        this.recoverFinishedTournament(roomId);
        return true;
      } catch {
        this.blockFinishedTournament(roomId, room.engine);
        return false;
      }
    }
    if (this.isWalletSng(room)) return this.settleFinishedWalletTournament(roomId);
    if (this.settledTournamentRooms.has(roomId)) return true;
    try {
      this.completeProgressionTournament(roomId);
      this.settledTournamentRooms.add(roomId);
      this.recoverFinishedTournament(roomId);
      return true;
    } catch {
      this.blockFinishedTournament(roomId, room.engine);
      return false;
    }
  }

  private recoverFinishedTournament(roomId: string): void {
    this.economyBlockedRooms.delete(roomId);
    this.unresolvedSettlementRooms.delete(roomId);
    this.clearFinishedRoomTimer(roomId);
    this.retainFinishedTournament(roomId);
  }

  private blockFinishedTournament(roomId: string, engine: PokerEngine): void {
    this.economyBlockedRooms.add(roomId);
    this.unresolvedSettlementRooms.add(roomId);
    this.scheduleFinishedTournamentRetry(roomId);
    this.sendSystemChat(roomId, '저장 연결을 확인 중이에요');
    this.onUpdate(roomId, engine);
  }

  private completeProgressionTournament(roomId: string): void {
    const room = this.rooms.get(roomId);
    const tournament = room?.engine.state.tournament;
    if (!room || !tournament?.finished) return;
    if (room.config.competitionMode) return;
    this.options.progression?.completeSng({
      roomId,
      roomRunId: room.runId,
      results: tournament.results.map(result => ({
        profileId: result.playerId,
        place: result.place,
      })),
    });
  }

  private canStartWalletHand(engine: PokerEngine): boolean {
    return engine.state.players.filter(player => (
      !player.pendingRemoval
      && player.chips > 0
      && player.status !== 'sitting-out'
      && !player.isDisconnected
      && !player.sitOutNext
    )).length >= 2;
  }

  private requireEconomy(): RoomEconomyHooks {
    if (!this.options.economy) throw new Error('wallet economy is unavailable');
    return this.options.economy;
  }

  private reserveRoomRunId(): string {
    for (let attempt = 0; attempt < MAX_ROOM_RUN_ID_ATTEMPTS; attempt += 1) {
      const runId = this.options.roomRunIdFactory?.()
        ?? `run_${this.roomRunInstanceId}_${++this.roomRunGeneration}`;
      if (!/^[A-Za-z0-9_-]{1,128}$/.test(runId)) continue;
      if (this.usedRoomRunIds.has(runId)) continue;
      this.usedRoomRunIds.add(runId);
      return runId;
    }
    throw new Error('unable to reserve unique room run id');
  }

  private classifyUnstartedHand(
    roomId: string,
    engine: PokerEngine,
    cashHandPrepared: boolean,
    preStartState: string,
  ): 'retryable' | 'blocked' {
    if (JSON.stringify(engine.state) !== preStartState) {
      if (cashHandPrepared) this.unresolvedSettlementRooms.add(roomId);
      return 'blocked';
    }
    if (!cashHandPrepared) return 'retryable';

    try {
      if (this.requireEconomy().cancelPreparedHand(roomId, engine)) {
        return 'retryable';
      }
    } catch {
      // Without a durable exact-cancel result, the prepared identity is unresolved.
    }
    this.unresolvedSettlementRooms.add(roomId);
    return 'blocked';
  }

  /**
   * 모든 핸드 종료 진입점. 엔진 스냅샷을 먼저 영속 정산하고, 성공한 뒤에만
   * 진행 중 이탈 escrow를 닫고 다음 핸드를 예약한다.
   */
  private handleCompletedHand(roomId: string): void {
    const room = this.rooms.get(roomId);
    if (!room || room.engine.state.isHandInProgress) return;
    const state = room.engine.state;
    const previous = this.handSettlementStatus.get(roomId);
    if (previous?.handNumber === state.handNumber && previous.ok) return;

    // 핸드 히스토리는 정산 성공 여부와 무관하게 엔진 확정 결과를 1회 기록한다
    this.persistHandHistory(roomId, room, state);

    let paidTotal = (state.winners ?? []).reduce(
      (sum, winner) => sum + winner.amount,
      0,
    );
    let rake = state.handRake;
    let settlementOk = true;
    let progressionRetryable = false;

    if (this.isWalletCash(room)) {
      try {
        const economy = this.requireEconomy();
        const result: CashHandPersistenceResult = economy.afterHand(
          roomId,
          room.engine,
        );
        paidTotal = result.paidTotal;
        rake = result.rake;
        for (const player of state.players) {
          if (player.type === 'human' && player.pendingRemoval) {
            economy.settleExit(roomId, player);
          }
        }
      } catch {
        settlementOk = false;
        this.economyBlockedRooms.add(roomId);
        this.unresolvedSettlementRooms.add(roomId);
        this.sendSystemChat(roomId, '저장 연결을 확인 중이에요');
      }
    }
    if (
      settlementOk
      && state.tournament?.finished
      && !this.isMttRoom(room) // MTT 종료 정산은 TournamentManager 소유
      && !this.finalizeFinishedTournament(roomId)
    ) {
      settlementOk = false;
    }

    if (settlementOk && !state.tournament) {
      try {
        this.options.progression?.completeHand({
          roomId,
          roomRunId: room.runId,
          handNumber: state.handNumber,
          pendingRemovalProfileIds: state.players
            .filter(player => player.type === 'human' && player.pendingRemoval)
            .map(player => player.id),
        });
      } catch {
        settlementOk = false;
        progressionRetryable = true;
        this.economyBlockedRooms.add(roomId);
        this.unresolvedSettlementRooms.add(roomId);
        this.sendSystemChat(roomId, '저장 연결을 확인 중이에요');
      }
    }

    this.handSettlementStatus.set(roomId, {
      handNumber: state.handNumber,
      ok: settlementOk,
      paidTotal,
      rake,
    });
    this.onUpdate(roomId, room.engine);
    this.announceWinner(roomId, { paidTotal, rake, settlementOk });
    if (!settlementOk) {
      if (!state.tournament && progressionRetryable) {
        this.scheduleCompletedHandRetry(roomId, state.handNumber);
      }
      return;
    }
    this.handSettlementRetryAttempts.delete(roomId);
    if (previous?.handNumber === state.handNumber && !previous.ok) {
      this.economyBlockedRooms.delete(roomId);
      this.unresolvedSettlementRooms.delete(roomId);
    }

    // MTT 테이블: 탈락/밸런싱/브레이크는 매니저가 핸드 경계에서 처리하고 진행 여부를 지시한다.
    // 캐시/SnG 전용 경로(나가기 예약·빈 방 정리·파산 유예·착석 핸드오프)는 타지 않는다.
    if (this.isMttRoom(room)) {
      const verdict = this.mttHooks?.onHandComplete(roomId) ?? 'continue';
      if (verdict === 'continue' && this.rooms.has(roomId)) {
        this.scheduleNextHand(roomId);
      }
      return;
    }

    // 나가기 예약('이번 핸드 후'/'다음 BB 전') 실행 — 정산 확정 후·다음 핸드 예약 전.
    // 마지막 휴먼이 예약 퇴장하면 leaveRoom이 방을 정리하므로 남은 인원은 그 뒤에 다시 센다.
    this.processLeaveReservations(roomId);
    if (!this.rooms.has(roomId)) return;

    const remainingHumans = state.players.filter(
      player => player.type === 'human' && !player.pendingRemoval,
    );
    if (remainingHumans.length === 0 && this.seatWaiterCount(roomId) === 0) {
      this.cleanupEmptyRoom(roomId, true);
      return;
    }
    // 이번 핸드로 파산한 캐시 휴먼 좌석에 리바이 유예를 건다 (방치 좌석 회수의 유일한 경로)
    this.scheduleBustReclaims(roomId);
    this.scheduleNextHand(roomId);
    // 착석 대기자가 있으면 봇 퇴장→착석을 순차 연출 (다음 핸드는 착석 시점에 +2초로 재예약됨)
    this.scheduleSeatHandoff(roomId);
  }

  /**
   * 완료 핸드를 히스토리로 기록. 저장 실패가 게임 진행(정산/다음 핸드 예약)을 막으면 안 되므로
   * 예외는 삼킨다. 기록 커서를 먼저 옮겨 재시도 재진입에도 같은 핸드를 두 번 저장하지 않는다.
   */
  private persistHandHistory(
    roomId: string,
    room: { engine: PokerEngine; config: RoomConfig },
    state: GameState,
  ): void {
    const hooks = this.options.handHistory;
    if (!hooks) return;
    if (this.handHistoryRecordedHands.get(roomId) === state.handNumber) return;
    const record = room.engine.getCompletedHandRecord();
    if (!record || record.handNumber !== state.handNumber) return;
    this.handHistoryRecordedHands.set(roomId, state.handNumber);
    try {
      hooks.recordCompletedHand({
        roomId,
        roomName: room.config.name,
        gameMode: (room.config.gameMode ?? 'cash') as GameMode,
        record,
        tournamentId: room.config.tournamentId ?? null,
      });
    } catch {
      // 히스토리 저장 실패는 게임에 치명적이지 않다 — 다음 핸드 진행을 우선한다
    }
  }

  /**
   * 봇이 투척 아이템에 맞았을 때 리액션 대사. 클라이언트 비행 연출이 끝난 시점(명중)에
   * 말풍선이 뜨도록 지연한다. botQuip이 방/좌석 소멸을 재검증하므로 dispose 이후에도 안전.
   */
  reactToThrowableHit(roomId: string, targetPlayerId: string, throwerName: string, itemName: string): void {
    if (Math.random() > 0.6) return; // 확률 게이팅 — 연속 투척 시 대사 도배 방지
    setTimeout(() => {
      const room = this.rooms.get(roomId);
      const player = room?.engine.state.players.find(p => p.id === targetPlayerId);
      if (!player || player.type !== 'bot') return;
      const fallback = THROWABLE_HIT_FALLBACKS[Math.floor(Math.random() * THROWABLE_HIT_FALLBACKS.length)];
      const situation = `${throwerName}이(가) 테이블 너머로 던진 ${itemName}에 정통으로 맞았다. 놀람과 장난 섞인 짧은 반발 한마디.`;
      void this.botQuip(roomId, player, 'throwable-hit', situation, fallback);
    }, THROW_FLIGHT_MS + 250);
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

  private announceWinner(
    roomId: string,
    settlement: { paidTotal: number; rake: number; settlementOk: boolean },
  ): void {
    const room = this.rooms.get(roomId);
    if (!room || !room.engine.state.winners) return;

    const bb = room.engine.state.bigBlind || 1;

    // 팟 회계 검증 로그 — 불변식 sum(pots) === sum(totalContributed)이 깨지면 여기서 잡힌다
    const s = room.engine.state;
    eventLog.log('hand-end', {
      roomId,
      data: {
        handNumber: s.handNumber,
        street: s.street,
        potTotal: s.pots.reduce((sum, p) => sum + p.amount, 0),
        contributedTotal: s.players.reduce((sum, p) => sum + p.totalContributed, 0),
        ...handSettlementLogFields({
          rake: settlement.rake,
          paidTotal: settlement.paidTotal,
          settlementOk: settlement.settlementOk,
        }),
        winners: (s.winners ?? []).map(w => ({ playerId: w.playerId, amount: w.amount, rank: w.hand?.rank ?? null })),
        stacks: s.players.map(p => ({ id: p.id, name: p.name, seat: p.seatIndex, chips: p.chips, status: p.status })),
      },
    });

    // 영속 정산이 확정되기 전에는 칩 획득/봇 승리 대사 같은 완료 공지를 내보내지 않는다.
    // hand-end 진단 로그와 최종 스냅샷 브로드캐스트는 위에서 유지한다.
    if (!settlement.settlementOk) return;

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

  addChatMessage(
    roomId: string,
    playerId: string,
    playerName: string,
    message: string,
    type: ChatMessage['type'] = 'player',
  ): void {
    this.appendChatMessage({ roomId, playerId, playerName, message, type });
  }

  private appendChatMessage(input: Omit<ChatMessage, 'id' | 'timestamp'>): void {
    const chatMsg: ChatMessage = {
      id: `msg-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
      ...input,
      timestamp: Date.now(),
    };
    const history = this.chatHistory.get(input.roomId) || [];
    history.push(chatMsg);
    if (history.length > 100) history.splice(0, history.length - 100);
    this.chatHistory.set(input.roomId, history);
    this.onChat(input.roomId, chatMsg);
  }

  private sendSystemChat(roomId: string, message: string): void {
    this.appendChatMessage({
      roomId,
      playerId: 'system',
      playerName: 'System',
      message,
      type: 'system',
    });
  }

  private sendBotChat(roomId: string, botId: string, botName: string, message: string): void {
    this.appendChatMessage({
      roomId,
      playerId: botId,
      playerName: botName,
      message,
      type: 'bot',
    });
  }

  getChatHistory(roomId: string): ChatMessage[] {
    return [...(this.chatHistory.get(roomId) || [])];
  }
}

function normalizeArenaParticipantIds(
  participantIds: readonly string[] | undefined,
): string[] {
  if (!Array.isArray(participantIds)) return [];
  return [...new Set(participantIds.filter(
    participantId => (
      typeof participantId === 'string' && participantId.length > 0
    ),
  ))];
}
