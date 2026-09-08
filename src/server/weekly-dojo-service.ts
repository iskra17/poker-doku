import {
  WEEKLY_DOJO_CONFIG,
  WEEKLY_DOJO_LINEUP,
  type WeeklyDojoFinishReason,
} from '@/lib/weekly-dojo/config';
import {
  parseWeeklyDojoCheckpoint,
  serializeWeeklyDojoCheckpoint,
  type WeeklyDojoCheckpoint,
} from '@/lib/weekly-dojo/checkpoint';
import {
  milliBBToBB,
  nearbySlice,
  netMilliBB,
  rankScores,
  weeklyDojoWeekEndsAt,
  weeklyDojoWeekKey,
} from '@/lib/weekly-dojo/rules';
import type {
  WeeklyDojoAttemptView,
  WeeklyDojoLeaderboardEntry,
  WeeklyDojoRules,
  WeeklyDojoView,
} from '@/lib/weekly-dojo/types';
import type { RealtimeErrorCode } from '@/lib/realtime/protocol';
import { createBotWithCharacter } from '@/lib/bot/bot-manager';
import { getCharacterById } from '@/lib/characters';
import type { PokerEngine } from '@/lib/poker/engine';
import type { Player, RoomConfig } from '@/lib/poker/types';
import { eventLog } from './event-log';
import type {
  RoomDisposeReason,
  RoomManager,
  WeeklyDojoRoomHooks,
} from './room-manager';
import type {
  WeeklyDojoAttemptRecord,
  WeeklyDojoRepository,
} from './weekly-dojo-repository';

/**
 * 주간 도장 런타임 — 개인 전용 봇 테이블 1개 = 시도 1개.
 *
 * `LiveTableAdapter`(수련 스토리)와 **같은 병렬 훅 패턴**이다. 일반화하지 않는다:
 * 스토리/MTT 경로는 참조가 많아 공통화하면 회귀 위험이 크다. 모든 RoomManager 호출은
 * `isWeeklyDojoRoom` 가드 뒤에서만 일어나므로 일반 방의 실행 경로는 불변이다.
 *
 * 권위 계약:
 * - 점수·완료 여부·시도 번호·핸드 인덱스는 전부 `WeeklyDojoRepository`가 확정한다.
 *   클라이언트는 어떤 숫자도 제출하지 않는다 (소켓 payload에 필드 자체가 없다).
 * - **진행 중 핸드는 나가기/포기로 지울 수 없다.** 히어로가 그 핸드에 기여한 상태로 떠나면
 *   그 자리에서 폴드시키고 "기여금 전액 포기" 경계를 먼저 영속한 뒤에야 방을 닫는다.
 *   올인이라 팟 지분이 살아 있으면 런아웃이 끝날 때까지 기다렸다가 닫는다(closeIntent).
 *   진짜 서버 크래시만 미확정 핸드를 롤백한다.
 * - 방을 다시 열 때는 `room_epoch`을 durable하게 올리고(핸드 키 충돌 방지) 경계 체크포인트로
 *   봇 스택·버튼을 복원한다. 재개가 봇에게 새 칩을 주지 않는다.
 * - 지갑·경기권·아레나 MMR·진행도 XP 어디에도 쓰지 않는다 (`skipHandProgression` = true).
 */

export type WeeklyDojoResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly code: RealtimeErrorCode; readonly message: string };

export interface WeeklyDojoHeroPort {
  isOnline(profileId: string): boolean;
  /** 방에 히어로를 앉히고 room-joined까지 보낸다 (스토리 히어로 착석과 같은 포트) */
  seatHero(
    profileId: string,
    roomId: string,
    seat: { seatIndex: number; chips: number },
  ): boolean;
}

export interface WeeklyDojoEvents {
  /** 뷰가 바뀌었다 — 소켓 계층이 weekly-dojo-update를 다시 보낸다 */
  onChanged(profileId: string): void;
}

export interface WeeklyDojoServiceOptions {
  readonly repository: WeeklyDojoRepository;
  readonly roomManager: RoomManager;
  readonly hero: WeeklyDojoHeroPort;
  readonly now?: () => number;
  readonly holdTimeoutMs?: number;
  readonly finishDelayMs?: number;
  readonly sweepIntervalMs?: number;
  /** 종료/영속 재시도 간격 (기본 10초) */
  readonly retryDelayMs?: number;
  /**
   * 새 시도의 핸드 상한 (기본 WEEKLY_DOJO_CONFIG.maxHands). 이미 예약된 시도는 **자기 행에
   * 저장된 값**을 쓰므로 이 값을 바꿔도 진행 중 기록의 규칙이 바뀌지 않는다. 테스트/운영 튜닝용.
   */
  readonly maxHands?: number;
}

export interface WeeklyDojoStartValue {
  readonly attemptId: string;
  readonly roomId: string;
  readonly slot: number;
  readonly resumed: boolean;
}

export interface WeeklyDojoCloseValue {
  readonly attemptId: string;
  /**
   * 'closed' = 기록까지 확정됨, 'left' = 테이블만 닫힘(기록은 live),
   * 'closing' = 진행 중 핸드를 마무리하는 중 — 끝나면 weekly-dojo-update가 결과를 싣는다.
   */
  readonly status: 'closed' | 'left' | 'closing';
}

type HoldReason = 'away' | 'finishing' | 'closing' | 'persistence';
type CloseIntent = 'forfeit' | 'leave';
type SettleOutcome = 'settled' | 'pending' | 'error';

interface WeeklySession {
  readonly profileId: string;
  readonly attemptId: string;
  readonly weekKey: string;
  readonly slot: number;
  readonly startingChips: number;
  readonly bigBlind: number;
  readonly maxHands: number;
  /** 현재 방의 durable 에폭 — 핸드 키의 일부 */
  roomEpoch: number;
  roomId: string | null;
  handsPlayed: number;
  committedChips: number;
  checkpoint: WeeklyDojoCheckpoint | null;
  hold: boolean;
  holdReason: HoldReason | null;
  holdSince: number | null;
  /** 이 방에서 이미 경계를 기록한 엔진 handNumber */
  lastRecordedHand: number | null;
  /** 진행 중 핸드가 끝나면 실행할 종료 의도 */
  closeIntent: CloseIntent | null;
  /** 훅이 확정한 종료 사유 (완료 저장 실패 시 재시도용으로 남는다) */
  pendingFinish: WeeklyDojoFinishReason | null;
  persistenceError: boolean;
  finishTimer: NodeJS.Timeout | null;
  /** closeIntent가 핸드 종료를 기다리는 상한 타이머 (봇 핸드가 멈춰도 방이 남지 않게) */
  closeTimer: NodeJS.Timeout | null;
  disposing: boolean;
}

const DEFAULT_SWEEP_INTERVAL_MS = 30_000;
const DEFAULT_RETRY_DELAY_MS = 10_000;
/**
 * 종료 의도를 걸고 남은 핸드가 끝나기를 기다리는 상한. 넘기면 방을 강제로 닫는다 —
 * 히어로의 경계는 이미 영속돼 있으므로 손실은 남고, 체크포인트만 비어 재개가 막힌다.
 */
const CLOSE_TIMEOUT_MS = 60_000;
const LEADERBOARD_TOP = 5;
const LEADERBOARD_NEARBY_RADIUS = 2;

const RULES: WeeklyDojoRules = Object.freeze({
  startingChips: WEEKLY_DOJO_CONFIG.startingChips,
  smallBlind: WEEKLY_DOJO_CONFIG.smallBlind,
  bigBlind: WEEKLY_DOJO_CONFIG.bigBlind,
  startingBB: Math.round(
    WEEKLY_DOJO_CONFIG.startingChips / WEEKLY_DOJO_CONFIG.bigBlind,
  ),
  maxHands: WEEKLY_DOJO_CONFIG.maxHands,
  attemptsPerWeek: WEEKLY_DOJO_CONFIG.attemptsPerWeek,
  lineupVersion: WEEKLY_DOJO_CONFIG.lineupVersion,
  lineup: Object.freeze(WEEKLY_DOJO_LINEUP.map(seat => Object.freeze({
    seatIndex: seat.seatIndex,
    characterId: seat.characterId,
    name: getCharacterById(seat.characterId)?.name ?? seat.characterId,
  }))),
});

const PERSISTENCE_ERROR: WeeklyDojoResult<never> = {
  ok: false,
  code: 'server-error',
  message: '기록을 저장하지 못했어요. 잠시 후 다시 시도해 주세요.',
};

export class WeeklyDojoService implements WeeklyDojoRoomHooks {
  readonly #options: WeeklyDojoServiceOptions;
  readonly #sessions = new Map<string, WeeklySession>();
  readonly #byRoom = new Map<string, WeeklySession>();
  readonly #now: () => number;
  readonly #holdTimeoutMs: number;
  readonly #finishDelayMs: number;
  readonly #retryDelayMs: number;
  #events: WeeklyDojoEvents | null = null;
  #sweepTimer: NodeJS.Timeout | null = null;

  constructor(options: WeeklyDojoServiceOptions) {
    this.#options = options;
    this.#now = options.now ?? (() => Date.now());
    this.#holdTimeoutMs = options.holdTimeoutMs ?? WEEKLY_DOJO_CONFIG.holdTimeoutMs;
    this.#finishDelayMs = options.finishDelayMs ?? WEEKLY_DOJO_CONFIG.finishDelayMs;
    this.#retryDelayMs = options.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS;
    const sweepMs = options.sweepIntervalMs ?? DEFAULT_SWEEP_INTERVAL_MS;
    if (sweepMs > 0) {
      this.#sweepTimer = setInterval(() => this.#sweepHolds(), sweepMs);
      this.#sweepTimer.unref?.();
    }
  }

  bindEvents(events: WeeklyDojoEvents): void {
    this.#events = events;
  }

  // ---------------------------------------------------------------------------
  // 소켓 계층 → 서비스

  /**
   * 시도 시작 또는 「이어하기」. 진행 중 시도가 있으면 **새 번호를 뽑지 않고** 그것을 잇는다 —
   * 불리한 기록을 버리고 다시 뽑는 경로를 만들지 않는 것이 이 기능의 공정성 핵심이다.
   */
  start(profileId: string): WeeklyDojoResult<WeeklyDojoStartValue> {
    const existing = this.#sessions.get(profileId);
    if (existing?.roomId) {
      return {
        ok: true,
        value: {
          attemptId: existing.attemptId,
          roomId: existing.roomId,
          slot: existing.slot,
          resumed: true,
        },
      };
    }
    const now = this.#now();
    let reserved;
    try {
      reserved = this.#options.repository.reserveAttempt({
        profileId,
        weekKey: weeklyDojoWeekKey(now),
        lineupVersion: WEEKLY_DOJO_CONFIG.lineupVersion,
        startingChips: WEEKLY_DOJO_CONFIG.startingChips,
        bigBlind: WEEKLY_DOJO_CONFIG.bigBlind,
        maxHands: this.#options.maxHands ?? WEEKLY_DOJO_CONFIG.maxHands,
        attemptsPerWeek: WEEKLY_DOJO_CONFIG.attemptsPerWeek,
        at: now,
      });
    } catch {
      return PERSISTENCE_ERROR;
    }
    if (reserved.status === 'cap-reached') {
      return {
        ok: false,
        code: 'action-rejected',
        message: '이번 주 도전 3회를 모두 사용했어요.',
      };
    }
    // 이미 끝났어야 할 시도(상한 도달·파산·복원 불가)를 다시 열지 않는다 — 그 자리에서 확정한다
    const settled = this.#settleUnresumable(reserved.attempt);
    if (settled !== 'resumable') {
      return settled === 'closed'
        ? {
            ok: false,
            code: 'action-rejected',
            message: '직전 도전이 마무리됐어요. 결과를 확인한 뒤 다시 시작해 주세요.',
          }
        : PERSISTENCE_ERROR;
    }
    const session = this.#freshSession(reserved.attempt);
    this.#sessions.set(profileId, session);
    if (!this.#openRoom(session)) {
      this.#sessions.delete(profileId);
      return {
        ok: false,
        code: 'server-error',
        message: '수련 테이블을 열지 못했어요. 잠시 후 다시 시도해 주세요.',
      };
    }
    eventLog.log('weekly-dojo', {
      roomId: session.roomId ?? undefined,
      playerId: profileId,
      data: {
        event: 'attempt-open',
        attemptId: session.attemptId,
        slot: session.slot,
        weekKey: session.weekKey,
        epoch: session.roomEpoch,
        resumed: reserved.status === 'resumed',
        handsPlayed: session.handsPlayed,
      },
    });
    this.#events?.onChanged(profileId);
    return {
      ok: true,
      value: {
        attemptId: session.attemptId,
        roomId: session.roomId!,
        slot: session.slot,
        resumed: reserved.status === 'resumed',
      },
    };
  }

  /**
   * 명시적 포기 — **진행 중 핸드를 먼저 확정한 뒤에** 기록을 닫는다.
   * 성공(ok + status 'closed')은 DB에 완료가 커밋된 뒤에만 보고한다.
   */
  forfeit(profileId: string): WeeklyDojoResult<WeeklyDojoCloseValue> {
    const session = this.#sessions.get(profileId);
    if (!session) {
      // 방이 이미 사라진 live 시도 — 확정 스택 그대로 닫는다
      let attempt;
      try {
        attempt = this.#options.repository.findLiveAttempt(profileId);
      } catch {
        return PERSISTENCE_ERROR;
      }
      if (!attempt) {
        return { ok: false, code: 'stale-state', message: '진행 중인 도전이 없어요.' };
      }
      if (!this.#complete(attempt.id, 'forfeit')) return PERSISTENCE_ERROR;
      this.#events?.onChanged(profileId);
      return { ok: true, value: { attemptId: attempt.id, status: 'closed' } };
    }
    return this.#closeSession(session, 'forfeit');
  }

  /**
   * 테이블만 닫는다 (기록은 live로 보존) — 나가기는 기록을 지우지 않는다.
   * 진행 중 핸드가 있으면 먼저 확정하므로 "지는 판에서 나가기"로 손실을 지울 수 없다.
   */
  leaveTable(profileId: string): WeeklyDojoResult<WeeklyDojoCloseValue> {
    const session = this.#sessions.get(profileId);
    if (!session) {
      return { ok: false, code: 'stale-state', message: '진행 중인 테이블이 없어요.' };
    }
    return this.#closeSession(session, 'leave');
  }

  /** 이 프로필이 지금 주간 도장 테이블에 앉아 있는가 */
  hasLiveRoom(profileId: string): boolean {
    return !!this.#sessions.get(profileId)?.roomId;
  }

  isWeeklyDojoRoom(roomId: string): boolean {
    return this.#byRoom.has(roomId);
  }

  currentRoomId(profileId: string): string | null {
    return this.#sessions.get(profileId)?.roomId ?? null;
  }

  getView(profileId: string): WeeklyDojoView {
    const now = this.#now();
    const weekKey = weeklyDojoWeekKey(now);
    const repository = this.#options.repository;
    const rows = repository.listAttempts(profileId, weekKey);
    const live = repository.findLiveAttempt(profileId);
    const session = this.#sessions.get(profileId);

    const bySlot = new Map(rows.map(row => [row.attemptNo, row]));
    // 지난 주 시도가 아직 live면 이번 주 목록에는 없지만 진행 배너로는 보여야 한다
    const attempts: WeeklyDojoAttemptView[] = [];
    for (let slot = 1; slot <= WEEKLY_DOJO_CONFIG.attemptsPerWeek; slot++) {
      const row = bySlot.get(slot);
      attempts.push(row ? this.#attemptView(row) : {
        slot,
        status: 'empty',
        handsPlayed: 0,
        netBB: 0,
        finishReason: null,
        completedAt: null,
      });
    }

    const standings = repository.listWeeklyStandings(
      weekKey,
      WEEKLY_DOJO_CONFIG.attemptsPerWeek,
    );
    const ranked = rankScores(standings);
    const meIndex = ranked.findIndex(item => item.entry.profileId === profileId);
    const toEntry = (
      item: { rank: number; entry: (typeof standings)[number] },
    ): WeeklyDojoLeaderboardEntry => ({
      rank: item.rank,
      profileId: item.entry.profileId,
      alias: item.entry.alias,
      avatarId: item.entry.avatarId,
      netBB: milliBBToBB(item.entry.scoreMilliBB),
      isMe: item.entry.profileId === profileId,
    });

    const completedCount = rows.filter(row => row.status === 'completed').length;
    const me = meIndex >= 0 ? ranked[meIndex] : null;
    return {
      weekKey,
      weekEndsAt: weeklyDojoWeekEndsAt(now),
      serverNow: now,
      rules: RULES,
      attempts,
      live: live
        ? {
            attemptId: live.id,
            slot: live.attemptNo,
            roomId: session?.attemptId === live.id ? session.roomId : null,
            handsPlayed: live.handsPlayed,
            netBB: milliBBToBB(netMilliBB(
              live.committedChips,
              live.startingChips,
              live.bigBlind,
            )),
            weekKey: live.weekKey,
          }
        : null,
      completedCount,
      totalNetBB: me ? milliBBToBB(me.entry.scoreMilliBB) : null,
      rank: me?.rank ?? null,
      entrants: ranked.length,
      top: ranked.slice(0, LEADERBOARD_TOP).map(toEntry),
      nearby: nearbySlice(ranked, meIndex, LEADERBOARD_NEARBY_RADIUS).map(toEntry),
    };
  }

  stats(): { sessions: number; rooms: number; holds: number } {
    let holds = 0;
    for (const session of this.#sessions.values()) if (session.hold) holds += 1;
    return {
      sessions: this.#sessions.size,
      rooms: this.#byRoom.size,
      holds,
    };
  }

  shutdown(): void {
    if (this.#sweepTimer) {
      clearInterval(this.#sweepTimer);
      this.#sweepTimer = null;
    }
    for (const session of [...this.#sessions.values()]) {
      this.#clearFinishTimer(session);
      // 종료 시엔 실패를 따지지 않는다 — RoomManager.shutdown이 나머지를 정리한다.
      // 진행 중이던 시도는 DB에 live로 남아 재시작 후 확정 스택으로 이어진다.
      this.#disposeOwnRoom(session, 'shutdown');
    }
    this.#sessions.clear();
    this.#byRoom.clear();
  }

  // ---------------------------------------------------------------------------
  // WeeklyDojoRoomHooks (RoomManager → 서비스)

  isHeld(roomId: string): boolean {
    const session = this.#byRoom.get(roomId);
    if (!session) return false;
    return session.hold
      || session.finishTimer !== null
      || session.closeIntent !== null
      || session.persistenceError;
  }

  /** 주간 도장 핸드는 도장 XP·일일 미션에 적립하지 않는다 (경제·진행도와 완전 분리) */
  skipHandProgression(): boolean {
    return true;
  }

  beforeHand(roomId: string, engine: PokerEngine): 'deal' | 'hold' {
    const session = this.#byRoom.get(roomId);
    if (!session) return 'deal';
    if (session.finishTimer || session.closeIntent || session.persistenceError) return 'hold';

    const state = engine.state;
    const hero = state.players.find(player => player.id === session.profileId);
    if (!hero || hero.pendingRemoval) return 'hold';

    if (session.handsPlayed >= session.maxHands) {
      this.#finish(session, 'max-hands');
      return 'hold';
    }
    if (hero.chips <= 0) {
      this.#finish(session, 'bust');
      return 'hold';
    }
    const funded = state.players.filter(
      player => !player.pendingRemoval && player.chips > 0,
    );
    if (funded.length < 2) {
      this.#finish(session, 'table-short');
      return 'hold';
    }
    // 자리를 비운 사이 봇끼리 남은 핸드를 소진하면 안 된다 — 핸드 경계에서 안전하게 멈춘다
    if (hero.isDisconnected) {
      this.#setHold(session, 'away');
      return 'hold';
    }
    if (hero.sitOutNext) {
      hero.sitOutNext = false;
      hero.sitOutAuto = undefined;
      hero.sitOutSinceHand = undefined;
      hero.sitOutSinceMs = undefined;
      if (hero.chips > 0 && hero.status === 'sitting-out') hero.status = 'waiting';
      this.#setHold(session, 'away');
      return 'hold';
    }
    return 'deal';
  }

  onHandComplete(roomId: string): 'continue' | 'hold' | 'gone' {
    const session = this.#byRoom.get(roomId);
    if (!session) return 'continue';
    const room = this.#options.roomManager.getRoom(roomId);
    if (!room) return 'gone';
    const state = room.engine.state;
    const hero = state.players.find(player => player.id === session.profileId);
    if (!hero) return 'continue';

    const record = room.engine.getCompletedHandRecord();
    const dealtIn = !!record
      && record.handNumber === state.handNumber
      && record.players.some(player => player.id === session.profileId);
    if (dealtIn) {
      // 경계 확정 — 중복 콜백이면 저장소가 흡수하고, 진행 중 이탈로 비워 둔 체크포인트만 채운다
      const outcome = this.#commitBoundary(
        session,
        room.engine,
        state.handNumber,
        Math.max(0, hero.chips),
      );
      if (outcome === 'error') {
        this.#markPersistenceError(session);
        return 'hold';
      }
      if (outcome === 'not-live') {
        // 다른 경로가 이미 시도를 닫았다 — 이 방은 더 진행하지 않는다
        session.closeIntent = session.closeIntent ?? 'leave';
      }
    }

    // 진행 중 핸드를 기다리던 종료 의도를 이제 실행한다 (나가기/포기 모두 여기서 마무리)
    if (session.closeIntent) {
      this.#executeClose(session);
      return this.#byRoom.has(roomId) ? 'hold' : 'gone';
    }
    if (hero.pendingRemoval) return 'continue';

    if (session.handsPlayed >= session.maxHands) {
      this.#finish(session, 'max-hands');
      return 'hold';
    }
    if (hero.chips <= 0) {
      this.#finish(session, 'bust');
      return 'hold';
    }
    const funded = state.players.filter(
      player => !player.pendingRemoval && player.chips > 0,
    );
    if (funded.length < 2) {
      this.#finish(session, 'table-short');
      return 'hold';
    }
    this.#events?.onChanged(session.profileId);
    return session.hold ? 'hold' : 'continue';
  }

  /**
   * 좌석 제거 직전 (grace 만료 회수·서버 주도 퇴장). 진행 중 핸드에 히어로가 기여한 상태면
   * 여기서 "기여금 전액 포기" 경계를 남긴다 — 끊김으로 진 핸드를 지울 수 없다.
   * 체크포인트는 비워 두므로(핸드가 안 끝났다) 그 시도는 재개 대신 다음 start에서 확정된다.
   */
  onPlayerLeave(roomId: string, playerId: string): void {
    const session = this.#byRoom.get(roomId);
    if (!session || playerId !== session.profileId) return;
    const room = this.#options.roomManager.getRoom(roomId);
    if (room) this.#commitAbandonedHand(session, room.engine);
    eventLog.log('weekly-dojo', {
      roomId,
      playerId,
      data: {
        event: 'hero-left',
        attemptId: session.attemptId,
        handsPlayed: session.handsPlayed,
      },
    });
  }

  onRoomDisposed(roomId: string): void {
    const session = this.#byRoom.get(roomId);
    if (!session) return;
    this.#byRoom.delete(roomId);
    session.roomId = null;
    if (session.disposing) return; // 자체 해체 — 후속 처리는 호출부가 담당
    this.#clearFinishTimer(session);
    this.#sessions.delete(session.profileId);
    this.#events?.onChanged(session.profileId);
  }

  // ---------------------------------------------------------------------------
  // 종료 경로

  /**
   * 나가기/포기 공통 — **진행 중 핸드를 먼저 확정**하고, 확정할 수 없으면(올인 런아웃) 의도를
   * 걸어 두고 핸드 종료 훅에서 마무리한다.
   */
  #closeSession(
    session: WeeklySession,
    intent: CloseIntent,
  ): WeeklyDojoResult<WeeklyDojoCloseValue> {
    if (session.closeIntent) {
      // 이미 마무리 중이다 — 연타로 남은 핸드를 건너뛰고 강제로 닫지 않는다.
      // 포기는 나가기보다 강한 의도라 승격만 허용한다.
      if (intent === 'forfeit') session.closeIntent = 'forfeit';
      return { ok: true, value: { attemptId: session.attemptId, status: 'closing' } };
    }
    const settled = this.#settleLiveHand(session);
    if (settled === 'error') return PERSISTENCE_ERROR;
    if (settled === 'pending') {
      // 남은 핸드가 끝나면 onHandComplete가 이 의도를 실행한다 (상한 타이머로 강제 종료 보장)
      session.closeIntent = intent;
      this.#armCloseTimeout(session);
      this.#setHold(session, 'closing');
      return { ok: true, value: { attemptId: session.attemptId, status: 'closing' } };
    }
    session.closeIntent = intent;
    if (!this.#executeClose(session)) {
      return intent === 'forfeit'
        ? PERSISTENCE_ERROR
        : {
            ok: false,
            code: 'action-rejected',
            message: '결과를 정리하는 중이에요. 잠시 후 다시 시도해 주세요.',
          };
    }
    if (intent === 'leave') {
      eventLog.log('weekly-dojo', {
        playerId: session.profileId,
        data: {
          event: 'table-left',
          attemptId: session.attemptId,
          handsPlayed: session.handsPlayed,
        },
      });
    }
    return {
      ok: true,
      value: {
        attemptId: session.attemptId,
        status: intent === 'forfeit' ? 'closed' : 'left',
      },
    };
  }

  /**
   * 진행 중 핸드 확정. 히어로가 그 핸드에 살아 있으면 즉시 폴드시키고(칩은 이미 팟으로
   * 빠져 있으므로 그 순간 확정된다) 경계를 영속한다. 올인은 팟 지분이 있어 폴드할 수 없으므로
   * 런아웃을 기다린다('pending').
   */
  #settleLiveHand(session: WeeklySession): SettleOutcome {
    const roomId = session.roomId;
    if (!roomId) return 'settled';
    const room = this.#options.roomManager.getRoom(roomId);
    if (!room) return 'settled';
    const state = room.engine.state;
    if (!state.isHandInProgress) return 'settled';
    const hero = state.players.find(player => player.id === session.profileId);
    if (!hero || hero.pendingRemoval) return 'settled';
    if (session.lastRecordedHand === state.handNumber) return 'settled';
    // 이번 핸드에 딜인되지 않았다면(자리비움 등) 잃을 것도 없다
    if (hero.status !== 'active' && hero.status !== 'all-in') return 'settled';
    // 올인은 아직 팟을 딸 수 있다 — 결과 전에 닫으면 승리를 지우게 되므로 런아웃을 기다린다
    if (hero.status === 'all-in') return 'pending';

    const handNumber = state.handNumber;
    if (state.players[state.activePlayerIndex]?.id === hero.id) {
      this.#options.roomManager.processPlayerAction(roomId, hero.id, 'fold');
    } else {
      // 턴이 아니어도 즉시 폴드시킨다 — 자동 처리 경로는 무료 체크를 고를 수 있어
      // "떠난 사람이 계속 플레이해 팟을 따는" 상태가 되고, 그러면 기록한 스택과 테이블
      // 칩 풀이 어긋난다 (재개 시 복원 상태가 깨진다).
      this.#options.roomManager.foldWeeklyDojoHero(roomId, hero.id);
    }
    // 폴드로 핸드가 즉시 끝났다면 onHandComplete가 이미 경계를 기록했다
    if (session.lastRecordedHand === handNumber) return 'settled';
    const current = this.#options.roomManager.getRoom(roomId);
    if (!current) return 'settled';
    const settledHero = current.engine.state.players
      .find(player => player.id === session.profileId);
    // 손실을 **지금** 영속한다 — 여기서 크래시가 나도 진 핸드는 남는다.
    // 아직 핸드가 끝나지 않았으므로 복원 스냅샷(봇 칩)은 비워 둔다.
    const outcome = this.#commitBoundary(
      session,
      current.engine,
      handNumber,
      Math.max(0, settledHero?.chips ?? hero.chips),
      { checkpoint: false },
    );
    if (outcome === 'error') {
      this.#markPersistenceError(session);
      return 'error';
    }
    // 남은 봇 핸드가 끝나야 복원 스냅샷이 확정된다 — 그때까지 방을 유지한다
    return current.engine.state.isHandInProgress ? 'pending' : 'settled';
  }

  /** 좌석이 서버에 의해 제거되기 직전의 마지막 확정 기회 (grace 만료 등) */
  #commitAbandonedHand(session: WeeklySession, engine: PokerEngine): void {
    const state = engine.state;
    if (!state.isHandInProgress) return;
    if (session.lastRecordedHand === state.handNumber) return;
    const hero = state.players.find(player => player.id === session.profileId);
    if (!hero) return;
    if (hero.status !== 'active' && hero.status !== 'all-in') return;
    const outcome = this.#commitBoundary(
      session,
      engine,
      state.handNumber,
      Math.max(0, hero.chips),
      { checkpoint: false },
    );
    if (outcome === 'error') this.#markPersistenceError(session);
  }

  /**
   * 종료 의도 실행 — 포기면 DB 완료를 **먼저** 확정하고 그 다음 방을 닫는다.
   * 어느 단계든 실패하면 의도를 남긴 채 false (재시도 가능, 성공으로 보고하지 않는다).
   */
  #executeClose(session: WeeklySession): boolean {
    const intent = session.closeIntent;
    if (!intent) return true;
    this.#clearCloseTimeout(session);
    if (intent === 'forfeit' && !this.#complete(session.attemptId, 'forfeit')) {
      this.#markPersistenceError(session);
      return false;
    }
    if (!this.#disposeOwnRoom(session, 'weekly-dojo-end')) {
      this.#scheduleRetry(session);
      return false;
    }
    session.closeIntent = null;
    this.#dropSession(session);
    this.#events?.onChanged(session.profileId);
    return true;
  }

  // ---------------------------------------------------------------------------
  // 내부

  #freshSession(attempt: WeeklyDojoAttemptRecord): WeeklySession {
    return {
      profileId: attempt.profileId,
      attemptId: attempt.id,
      weekKey: attempt.weekKey,
      slot: attempt.attemptNo,
      startingChips: attempt.startingChips,
      bigBlind: attempt.bigBlind,
      maxHands: attempt.maxHands,
      roomEpoch: attempt.roomEpoch,
      roomId: null,
      handsPlayed: attempt.handsPlayed,
      committedChips: attempt.committedChips,
      checkpoint: parseWeeklyDojoCheckpoint(attempt.checkpointJson),
      hold: false,
      holdReason: null,
      holdSince: null,
      lastRecordedHand: null,
      closeIntent: null,
      pendingFinish: null,
      persistenceError: false,
      finishTimer: null,
      closeTimer: null,
      disposing: false,
    };
  }

  /**
   * 재개 가능 여부 판정 + 불가하면 그 자리에서 확정.
   * - 상한 도달·확정 스택 0 → 종료
   * - 핸드를 친 적이 있는데 복원 스냅샷이 없다/깨졌다 → 재개 불가(포기로 확정).
   *   시작 스택으로 봇을 리필해 이어가면 칩 풀과 상대 조건이 리셋된다.
   */
  #settleUnresumable(
    attempt: WeeklyDojoAttemptRecord,
  ): 'resumable' | 'closed' | 'error' {
    if (attempt.status !== 'live') return 'closed';
    if (attempt.handsPlayed >= attempt.maxHands) {
      return this.#complete(attempt.id, 'max-hands') ? 'closed' : 'error';
    }
    if (attempt.committedChips <= 0) {
      return this.#complete(attempt.id, 'bust') ? 'closed' : 'error';
    }
    if (
      attempt.handsPlayed > 0
      && parseWeeklyDojoCheckpoint(attempt.checkpointJson) === null
    ) {
      eventLog.log('weekly-dojo', {
        playerId: attempt.profileId,
        data: {
          event: 'unresumable',
          attemptId: attempt.id,
          handsPlayed: attempt.handsPlayed,
        },
      });
      return this.#complete(attempt.id, 'forfeit') ? 'closed' : 'error';
    }
    return 'resumable';
  }

  /**
   * 방 생성 → 봇 라인업 복원 → 히어로 착석 → 버튼 복원 → hold 해제.
   * 에폭은 방보다 먼저 durable하게 올린다 (핸드 키 충돌 방지, fail-closed).
   */
  #openRoom(session: WeeklySession): boolean {
    if (!this.#options.hero.isOnline(session.profileId)) return false;
    let epoch;
    try {
      epoch = this.#options.repository.beginRoomEpoch(session.attemptId, this.#now());
    } catch {
      return false;
    }
    if (epoch.status !== 'ok') return false;
    session.roomEpoch = epoch.attempt.roomEpoch;
    session.handsPlayed = epoch.attempt.handsPlayed;
    session.committedChips = epoch.attempt.committedChips;
    session.checkpoint = parseWeeklyDojoCheckpoint(epoch.attempt.checkpointJson);

    const config: RoomConfig = {
      name: '주간 도장',
      smallBlind: WEEKLY_DOJO_CONFIG.smallBlind,
      bigBlind: WEEKLY_DOJO_CONFIG.bigBlind,
      minBuyIn: session.startingChips,
      maxBuyIn: session.startingChips,
      maxPlayers: 6,
      economyMode: 'practice',
      turnTime: WEEKLY_DOJO_CONFIG.turnTimeSec,
      gameMode: 'cash',
      difficulty: WEEKLY_DOJO_CONFIG.difficulty,
      botCount: 0,
      tableType: 'bots',
      weeklyDojoAttemptId: session.attemptId,
    };
    let roomId: string;
    try {
      roomId = this.#options.roomManager.createRoom(config);
    } catch {
      return false;
    }
    session.roomId = roomId;
    session.disposing = false;
    session.lastRecordedHand = null;
    // 착석 중 핸드가 시작되지 않도록 hold를 먼저 세운다 (joinRoom → tryStartGame)
    session.hold = true;
    session.holdReason = 'away';
    session.holdSince = this.#now();
    this.#byRoom.set(roomId, session);

    // 재개면 경계 스냅샷의 봇 스택 그대로 — 새 칩을 주지 않는다
    const seats = session.checkpoint
      ? session.checkpoint.seats
      : WEEKLY_DOJO_LINEUP.map(seat => ({
        seatIndex: seat.seatIndex,
        characterId: seat.characterId,
        chips: session.startingChips,
      }));
    for (const seat of seats) {
      const bot = createBotWithCharacter(
        seat.seatIndex,
        seat.chips,
        seat.characterId,
        WEEKLY_DOJO_CONFIG.difficulty,
      );
      if (!bot || !this.#options.roomManager.joinRoom(roomId, bot)) {
        // 라인업은 전원 착석이 전제 — 한 좌석이라도 빠지면 다른 참가자와 조건이 달라진다
        eventLog.log('weekly-dojo', {
          roomId,
          playerId: session.profileId,
          data: { event: 'lineup-failed', seat: seat.seatIndex },
        });
        this.#disposeOwnRoom(session, 'weekly-dojo-end');
        return false;
      }
    }
    // 히어로 스택의 권위는 committed_chips다 (체크포인트는 같은 트랜잭션 사본)
    if (!this.#options.hero.seatHero(session.profileId, roomId, {
      seatIndex: WEEKLY_DOJO_CONFIG.heroSeatIndex,
      chips: session.committedChips,
    })) {
      this.#disposeOwnRoom(session, 'weekly-dojo-end');
      return false;
    }
    this.#restoreDealer(session, roomId);
    this.#clearHold(session);
    this.#options.roomManager.resumeRoom(roomId);
    return true;
  }

  /** 버튼 앵커 복원 — 다음 핸드의 버튼/블라인드가 재개 전과 이어진다 */
  #restoreDealer(session: WeeklySession, roomId: string): void {
    const dealerSeatIndex = session.checkpoint?.dealerSeatIndex;
    if (dealerSeatIndex === undefined) return;
    const state = this.#options.roomManager.getRoom(roomId)?.engine.state;
    if (!state) return;
    const index = state.players.findIndex(
      player => player.seatIndex === dealerSeatIndex,
    );
    if (index >= 0) state.dealerIndex = index;
  }

  #captureCheckpoint(session: WeeklySession, engine: PokerEngine): string | null {
    const state = engine.state;
    const hero = state.players.find(player => player.id === session.profileId);
    if (!hero) return null;
    const seats = state.players
      .filter((player): player is Player => (
        player.type === 'bot' && !player.pendingRemoval
      ))
      .map(player => ({
        seatIndex: player.seatIndex,
        characterId: player.personalityId ?? player.avatar,
        chips: Math.max(0, player.chips),
      }));
    if (seats.length !== WEEKLY_DOJO_LINEUP.length) return null;
    const dealer = state.players[state.dealerIndex];
    return serializeWeeklyDojoCheckpoint({
      v: 1,
      lineupVersion: WEEKLY_DOJO_CONFIG.lineupVersion,
      dealerSeatIndex: dealer?.seatIndex ?? WEEKLY_DOJO_CONFIG.heroSeatIndex,
      heroChips: Math.max(0, hero.chips),
      seats,
    });
  }

  /** 확정 경계 기록 — 중복 콜백은 저장소가 흡수하고, 인덱스는 저장소가 계산한다 */
  #commitBoundary(
    session: WeeklySession,
    engine: PokerEngine,
    handNumber: number,
    chipsAfter: number,
    options: { checkpoint?: boolean } = {},
  ): 'ok' | 'duplicate' | 'cap-reached' | 'not-live' | 'error' {
    const checkpointJson = options.checkpoint === false
      ? null
      : this.#captureCheckpoint(session, engine);
    let outcome;
    try {
      outcome = this.#options.repository.recordHandBoundary({
        attemptId: session.attemptId,
        roomEpoch: session.roomEpoch,
        handNumber,
        chipsAfter,
        checkpointJson,
        at: this.#now(),
      });
    } catch {
      eventLog.log('weekly-dojo', {
        roomId: session.roomId ?? undefined,
        playerId: session.profileId,
        data: {
          event: 'boundary-failed',
          attemptId: session.attemptId,
          epoch: session.roomEpoch,
          handNumber,
        },
      });
      return 'error';
    }
    session.lastRecordedHand = handNumber;
    if (outcome.status === 'not-live') return 'not-live';
    session.handsPlayed = outcome.attempt.handsPlayed;
    session.committedChips = outcome.attempt.committedChips;
    session.checkpoint = parseWeeklyDojoCheckpoint(outcome.attempt.checkpointJson);
    return outcome.status === 'recorded'
      ? 'ok'
      : outcome.status === 'cap-reached' ? 'cap-reached' : 'duplicate';
  }

  /** 완료 확정 — 성공했을 때만 true (실패는 live로 남아 재시도 가능하다) */
  #complete(attemptId: string, reason: WeeklyDojoFinishReason): boolean {
    try {
      const outcome = this.#options.repository.completeAttempt({
        attemptId,
        reason,
        at: this.#now(),
      });
      if (outcome.status === 'not-found') return false;
      eventLog.log('weekly-dojo', {
        data: {
          event: 'attempt-complete',
          attemptId,
          reason,
          duplicate: outcome.status === 'already-completed',
          handsPlayed: outcome.attempt.handsPlayed,
          scoreMilliBB: outcome.attempt.scoreMilliBB,
        },
      });
      return true;
    } catch {
      eventLog.log('weekly-dojo', {
        data: { event: 'complete-failed', attemptId, reason },
      });
      return false;
    }
  }

  /** 종료 확정 — DB를 먼저 닫고, 방은 승리 연출이 끝난 뒤 해체한다 */
  #finish(session: WeeklySession, reason: WeeklyDojoFinishReason): void {
    if (session.finishTimer || session.pendingFinish) return;
    session.pendingFinish = reason;
    session.hold = true;
    session.holdReason = 'finishing';
    session.holdSince = this.#now();
    if (!this.#complete(session.attemptId, reason)) {
      this.#markPersistenceError(session);
      this.#scheduleRetry(session);
      return;
    }
    if (this.#finishDelayMs <= 0) {
      this.#finishNow(session);
      return;
    }
    session.finishTimer = setTimeout(() => {
      session.finishTimer = null;
      this.#finishNow(session);
    }, this.#finishDelayMs);
    this.#events?.onChanged(session.profileId);
  }

  /** 방 해체 + 세션 폐기 (DB는 이미 닫혀 있다) */
  #finishNow(session: WeeklySession): void {
    if (!this.#disposeOwnRoom(session, 'weekly-dojo-end')) {
      this.#scheduleRetry(session);
      return;
    }
    session.pendingFinish = null;
    this.#dropSession(session);
    this.#events?.onChanged(session.profileId);
  }

  /** 영속/해체 실패 재시도 — hold를 유지한 채 같은 마무리를 다시 시도한다 */
  #scheduleRetry(session: WeeklySession): void {
    if (session.finishTimer) return;
    session.finishTimer = setTimeout(() => {
      session.finishTimer = null;
      if (session.pendingFinish) {
        if (!this.#complete(session.attemptId, session.pendingFinish)) {
          this.#scheduleRetry(session);
          return;
        }
        session.persistenceError = false;
        this.#finishNow(session);
        return;
      }
      if (session.closeIntent) {
        session.persistenceError = false;
        if (!this.#executeClose(session)) this.#scheduleRetry(session);
        return;
      }
      session.persistenceError = false;
      this.#events?.onChanged(session.profileId);
    }, this.#retryDelayMs);
  }

  #markPersistenceError(session: WeeklySession): void {
    session.persistenceError = true;
    session.hold = true;
    session.holdReason = 'persistence';
    session.holdSince = this.#now();
    this.#scheduleRetry(session);
    this.#events?.onChanged(session.profileId);
  }

  #dropSession(session: WeeklySession): void {
    this.#clearFinishTimer(session);
    if (session.roomId) this.#byRoom.delete(session.roomId);
    session.roomId = null;
    const current = this.#sessions.get(session.profileId);
    if (current === session) this.#sessions.delete(session.profileId);
  }

  #disposeOwnRoom(session: WeeklySession, reason: RoomDisposeReason): boolean {
    const roomId = session.roomId;
    if (!roomId) return true;
    session.disposing = true;
    const disposed = this.#options.roomManager.disposeRoom(roomId, reason);
    session.disposing = false;
    if (!disposed) return false;
    this.#byRoom.delete(roomId);
    session.roomId = null;
    return true;
  }

  #setHold(session: WeeklySession, reason: HoldReason): void {
    session.hold = true;
    session.holdReason = reason;
    session.holdSince = this.#now();
    this.#events?.onChanged(session.profileId);
  }

  #clearHold(session: WeeklySession): void {
    session.hold = false;
    session.holdReason = null;
    session.holdSince = null;
  }

  #clearFinishTimer(session: WeeklySession): void {
    if (session.finishTimer) {
      clearTimeout(session.finishTimer);
      session.finishTimer = null;
    }
    this.#clearCloseTimeout(session);
  }

  #armCloseTimeout(session: WeeklySession): void {
    if (session.closeTimer) return;
    session.closeTimer = setTimeout(() => {
      session.closeTimer = null;
      if (!session.closeIntent) return;
      eventLog.log('weekly-dojo', {
        roomId: session.roomId ?? undefined,
        playerId: session.profileId,
        data: { event: 'close-timeout', attemptId: session.attemptId },
      });
      this.#executeClose(session);
    }, CLOSE_TIMEOUT_MS);
  }

  #clearCloseTimeout(session: WeeklySession): void {
    if (session.closeTimer) {
      clearTimeout(session.closeTimer);
      session.closeTimer = null;
    }
  }

  /** hold 상한 초과 — 방만 닫는다. 시도는 live로 남아 「이어하기」가 그대로 잇는다 */
  #sweepHolds(): void {
    const now = this.#now();
    for (const session of [...this.#sessions.values()]) {
      if (!session.roomId || !session.hold || session.holdSince === null) continue;
      if (session.holdReason !== 'away') continue;
      if (now - session.holdSince < this.#holdTimeoutMs) continue;
      eventLog.log('weekly-dojo', {
        roomId: session.roomId,
        playerId: session.profileId,
        data: {
          event: 'hold-timeout',
          attemptId: session.attemptId,
          handsPlayed: session.handsPlayed,
        },
      });
      if (!this.#disposeOwnRoom(session, 'weekly-dojo-end')) continue;
      this.#dropSession(session);
      this.#events?.onChanged(session.profileId);
    }
  }

  #attemptView(row: WeeklyDojoAttemptRecord): WeeklyDojoAttemptView {
    return {
      slot: row.attemptNo,
      status: row.status,
      handsPlayed: row.handsPlayed,
      netBB: milliBBToBB(
        row.scoreMilliBB
        ?? netMilliBB(row.committedChips, row.startingChips, row.bigBlind),
      ),
      finishReason: row.finishReason,
      completedAt: row.completedAt,
    };
  }
}
