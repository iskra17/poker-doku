import { randomUUID } from 'node:crypto';
import type { PokerEngine } from '../lib/poker/engine';
import type {
  FinalTableTheme,
  Player,
  TournamentHoldReason,
  TournamentStage,
} from '../lib/poker/types';
import {
  MTT_STRUCTURES,
  mttClockAt,
  mttLevelAt,
  type MttSpeed,
  type MttStructure,
} from '../lib/poker/mtt-structure';
import { computePayouts, paidPlaces } from '../lib/poker/payout-table';
import { createBot, getUsedCharacterIds } from '../lib/bot/bot-manager';
import type {
  TournamentDetailView,
  TournamentPhase,
  TournamentStandingRow,
  TournamentSummary,
} from '../lib/realtime/protocol';
import type { MttRoomHooks, RoomManager } from './room-manager';
import { eventLog } from './event-log';

export type {
  TournamentDetailView,
  TournamentPhase,
  TournamentStandingRow,
  TournamentSummary,
};

/**
 * MTT(멀티테이블 토너먼트) 오케스트레이터 — 아레나 패턴의 확장 (1토너 = N방).
 *
 * 소유: 등록부(프로필 귀속)·공용 시계/레벨·전역 순위·상금·테이블 밸런싱/브레이크·
 * H4H(hand-for-hand) 배리어·브레이크·종료. RoomManager는 MttRoomHooks로 핸드 경계마다
 * 이 매니저에게 진행 여부를 위임한다 (spec-mtt-2026-07-23.md §4).
 *
 * v1 범위: practice 전용(무료, 상금은 표시용), 프리즈아웃(레이트 레지/리엔트리 없음),
 * 체크인은 "시작 시점 접속 = 출석" 단순형. wallet 에스크로/디렉터 콘솔은 Phase 2.
 */

export interface CreateTournamentInput {
  name: string;
  speed: MttSpeed;
  maxEntrants: number; // 8~48 (v1 상한 — 확장 시 payout-table 밴드 추가와 함께 올린다)
  tableSize: number; // v1 UI는 6 고정 노출, 내부는 2~9 지원
  startAt: number | null; // 예약 시각 (null = 호스트 수동 시작만)
  botFill: boolean; // 시작 시 남는 자리를 봇으로 충원 (practice)
  turnTime: number;
  hostId: string;
  /** 'wallet' = 지갑 바이인 에스크로 (봇 충원 불가, 상금 = 리얼 칩). 기본 'practice' */
  economyMode?: 'practice' | 'wallet';
  /** wallet 참가 바이인 — 상금 풀 산정 기준 (practice는 0) */
  entryBuyIn?: number;
  /** wallet 참가 수수료 — 시작 시 소각 (practice는 0) */
  entryFee?: number;
}

/**
 * wallet MTT 경제 훅 — EconomyService 토너 단위 에스크로에 대한 좁은 어댑터.
 * 전부 동기·throw 계약 (EconomyDomainError) — 호출부(manager)가 흐름별로 처리한다.
 */
export interface MttEconomyHooks {
  reserveEntry(profileId: string, tournamentId: string, maxEntrants: number): void;
  refundEntry(profileId: string, tournamentId: string): void;
  startEscrow(tournamentId: string, profileIds: readonly string[]): void;
  settle(
    tournamentId: string,
    results: ReadonlyArray<{ playerId: string; place: number; prize: number }>,
  ): void;
  refundAll(tournamentId: string): number;
}

export interface MttEntrant {
  id: string; // 세션 playerId = 인증 profileId (상금/순위 귀속 주체)
  name: string;
  avatar: string;
}

export interface MttResult {
  playerId: string;
  name: string;
  place: number;
  prize: number;
}

export interface TournamentRuntimeHooks {
  /** 체크인 판정 — 시작 시점에 접속 중인 등록자만 착석 (노쇼 방지). 미주입 시 전원 출석 취급 */
  isConnected?(playerId: string): boolean;
  /** 시작 착석 통지 — 세션 roomId 전환 + room-joined emit은 소켓 계층 몫 */
  onSeated?(input: { tournamentId: string; playerId: string; roomId: string }): void;
  /** 테이블 이동 통지 (휴먼만) — 세션 전환 + table-move emit은 소켓 계층 몫 */
  onPlayerMoved?(input: {
    tournamentId: string;
    playerId: string;
    fromRoomId: string;
    toRoomId: string;
  }): void;
  /** 탈락 확정 통지 (휴먼만) — 안내 후 로비 복귀 처리는 소켓 계층 몫 */
  onEliminated?(input: {
    tournamentId: string;
    roomId: string;
    playerId: string;
    place: number;
    prize: number;
  }): void;
  /** 토너먼트 목록 변화 (생성/등록/시작/종료) — 로비 브로드캐스트 트리거 */
  onTournamentsChanged?(): void;
  /** 특정 토너먼트 상세 변화 (탈락/이동/레벨) — 관전/참가자 브로드캐스트 트리거 */
  onTournamentUpdate?(tournamentId: string): void;
  /** wallet MTT 에스크로 — 미주입 시 wallet 토너먼트 개설 불가 */
  economy?: MttEconomyHooks;
}

type InternalHoldReason = TournamentHoldReason | 'setup' | 'complete';

/** 백오피스 토너먼트 탭 뷰 (admin-http /api/admin/tournaments) */
export interface AdminTournamentView {
  id: string;
  name: string;
  phase: TournamentPhase;
  speed: MttSpeed;
  hostId: string;
  createdAt: number;
  startedAt: number | null;
  finishedAt: number | null;
  paused: boolean;
  level: number;
  onBreak: boolean;
  h4hActive: boolean;
  economyMode: 'practice' | 'wallet';
  entrantCount: number;
  seatedCount: number;
  remaining: number;
  prizePool: number;
  tables: Array<{
    roomId: string;
    no: number;
    players: number;
    humans: number;
    alive: number;
    handInProgress: boolean;
    held: string | null;
  }>;
  standings: TournamentStandingRow[];
}

interface PendingBust {
  roomId: string;
  playerId: string;
  name: string;
  handStartChips: number;
}

interface TournamentRuntime {
  id: string;
  config: CreateTournamentInput;
  structure: MttStructure;
  phase: TournamentPhase;
  createdAt: number;
  startedAt: number | null;
  finishedAt: number | null;
  pauseAccumMs: number; // 일시정지 누적 — clockPos가 (now - startedAt - accum)으로 시계를 계산
  /** 디렉터 일시정지 시각 — null이 아니면 시계 동결 + 전 테이블 다음 핸드 보류 */
  pausedAt: number | null;
  entrants: Map<string, MttEntrant>;
  seatedCount: number; // 시작 확정 총 인원 (봇 포함)
  tables: Map<string, { no: number }>;
  results: MttResult[];
  remaining: number;
  prizePool: number;
  prizes: number[];
  stage: TournamentStage;
  stageEndsAt?: number;
  finalTheme: FinalTableTheme;
  holds: Map<string, Set<InternalHoldReason>>;
  presentationBatchDepth: number;
  presentationDirtyRooms: Set<string>;
  h4h: { active: boolean; armed: Set<string>; busts: PendingBust[] };
  finalIntroTimer: NodeJS.Timeout | null;
  breakTimer: NodeJS.Timeout | null;
  breakAnnounced: boolean;
  finalAnnounced: boolean;
  startTimer: NodeJS.Timeout | null;
  cleanupTimer: NodeJS.Timeout | null;
  /** wallet 정산 재시도 (1회) — 완주 시 settle 실패하면 잠시 후 다시 시도 */
  settleRetryTimer: NodeJS.Timeout | null;
}

const MAX_TOURNAMENTS = 4; // 동시 개설 상한 (테이블 수 폭주 방지 — MAX_ROOMS와 별개 가드)
const MIN_ENTRANTS_CAP = 8;
const MAX_ENTRANTS_CAP = 48;
const COMPLETED_RETENTION_MS = 10 * 60_000;

function shuffle<T>(items: T[]): T[] {
  const arr = [...items];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

export class TournamentManager {
  private tournaments = new Map<string, TournamentRuntime>();
  private byRoom = new Map<string, string>();
  /** RoomManager에 주입하는 훅 — 테스트에서 직접 호출할 수 있도록 공개 */
  readonly roomHooks: MttRoomHooks;

  constructor(
    private readonly roomManager: RoomManager,
    private readonly hooks: TournamentRuntimeHooks = {},
  ) {
    this.roomHooks = {
      applyLevel: (roomId, engine) => this.applyLevel(roomId, engine),
      onHandStarted: (roomId, handNumber) => this.onHandStarted(roomId, handNumber),
      onHandComplete: roomId => this.onHandComplete(roomId),
      isHeld: roomId => this.isHeld(roomId),
      onPlayerLeave: (roomId, playerId) => this.onPlayerLeave(roomId, playerId),
      onPlayerLeft: roomId => this.onPlayerLeft(roomId),
    };
    roomManager.setMttHooks(this.roomHooks);
  }

  // --- 생성/등록 ---

  createTournament(input: CreateTournamentInput):
    | { ok: true; tournamentId: string }
    | { ok: false; reason: 'limit' | 'invalid' } {
    const active = [...this.tournaments.values()].filter(
      t => t.phase === 'registering' || t.phase === 'running',
    );
    if (active.length >= MAX_TOURNAMENTS) return { ok: false, reason: 'limit' };

    const name = input.name.trim().slice(0, 30);
    if (!name) return { ok: false, reason: 'invalid' };
    if (!MTT_STRUCTURES[input.speed]) return { ok: false, reason: 'invalid' };
    const tableSize = Math.floor(input.tableSize);
    if (!Number.isFinite(tableSize) || tableSize < 2 || tableSize > 9) {
      return { ok: false, reason: 'invalid' };
    }
    const maxEntrants = Math.floor(input.maxEntrants);
    if (
      !Number.isFinite(maxEntrants)
      || maxEntrants < MIN_ENTRANTS_CAP
      || maxEntrants > MAX_ENTRANTS_CAP
    ) {
      return { ok: false, reason: 'invalid' };
    }
    const economyMode = input.economyMode ?? 'practice';
    // wallet은 봇 충원 불가(봇은 바이인을 못 낸다) + 경제 훅 필수 + 상품가 필수
    if (economyMode === 'wallet' && (
      !this.hooks.economy
      || input.botFill
      || !Number.isSafeInteger(input.entryBuyIn)
      || (input.entryBuyIn ?? 0) <= 0
      || !Number.isSafeInteger(input.entryFee)
      || (input.entryFee ?? 0) <= 0
    )) {
      return { ok: false, reason: 'invalid' };
    }
    const entryBuyIn = economyMode === 'wallet' ? input.entryBuyIn ?? 0 : 0;
    const entryFee = economyMode === 'wallet' ? input.entryFee ?? 0 : 0;

    const id = `mtt-${Date.now()}-${randomUUID().slice(0, 8)}`;
    const t: TournamentRuntime = {
      id,
      config: { ...input, name, tableSize, maxEntrants, economyMode, entryBuyIn, entryFee },
      structure: MTT_STRUCTURES[input.speed],
      phase: 'registering',
      createdAt: Date.now(),
      startedAt: null,
      finishedAt: null,
      pauseAccumMs: 0,
      pausedAt: null,
      entrants: new Map(),
      seatedCount: 0,
      tables: new Map(),
      results: [],
      remaining: 0,
      prizePool: 0,
      prizes: [],
      stage: 'multi-table',
      stageEndsAt: undefined,
      finalTheme: 'sakura-championship',
      holds: new Map(),
      presentationBatchDepth: 0,
      presentationDirtyRooms: new Set(),
      h4h: { active: false, armed: new Set(), busts: [] },
      finalIntroTimer: null,
      breakTimer: null,
      breakAnnounced: false,
      finalAnnounced: false,
      startTimer: null,
      cleanupTimer: null,
      settleRetryTimer: null,
    };
    if (input.startAt !== null) {
      const delay = Math.max(1_000, input.startAt - Date.now());
      t.startTimer = setTimeout(() => {
        t.startTimer = null;
        this.attemptStart(t, null);
      }, delay);
    }
    this.tournaments.set(id, t);
    eventLog.log('mtt-create', {
      data: { tournamentId: id, name, speed: input.speed, maxEntrants, tableSize, hostId: input.hostId },
    });
    this.hooks.onTournamentsChanged?.();
    return { ok: true, tournamentId: id };
  }

  /** 등록 — wallet은 에스크로 예약이 먼저다 (실패 시 EconomyDomainError를 그대로 던진다) */
  register(tournamentId: string, entrant: MttEntrant):
    'ok' | 'not-found' | 'closed' | 'full' | 'already' {
    const t = this.tournaments.get(tournamentId);
    if (!t) return 'not-found';
    if (t.phase !== 'registering') return 'closed';
    if (t.entrants.has(entrant.id)) return 'already';
    if (t.entrants.size >= t.config.maxEntrants) return 'full';
    if (t.config.economyMode === 'wallet') {
      // throw 시 등록 미반영 — 소켓 계층이 코드별 안내(잔액 부족/이중 좌석)로 변환
      this.hooks.economy?.reserveEntry(entrant.id, t.id, t.config.maxEntrants);
    }
    t.entrants.set(entrant.id, { ...entrant, name: entrant.name.slice(0, 20) });
    this.hooks.onTournamentsChanged?.();
    this.hooks.onTournamentUpdate?.(tournamentId);
    return 'ok';
  }

  unregister(tournamentId: string, playerId: string): boolean {
    const t = this.tournaments.get(tournamentId);
    if (!t || t.phase !== 'registering') return false;
    if (!t.entrants.has(playerId)) return false;
    if (t.config.economyMode === 'wallet') {
      try {
        this.hooks.economy?.refundEntry(playerId, t.id);
      } catch {
        // 환불 실패면 등록을 유지한다 — 에스크로와 등록부가 어긋나면 안 된다
        return false;
      }
    }
    const removed = t.entrants.delete(playerId);
    if (removed) {
      this.hooks.onTournamentsChanged?.();
      this.hooks.onTournamentUpdate?.(tournamentId);
    }
    return removed;
  }

  /** 호스트 수동 시작 */
  startTournament(tournamentId: string, requesterId: string):
    'ok' | 'not-found' | 'not-host' | 'not-registering' | 'not-enough' | 'economy' {
    const t = this.tournaments.get(tournamentId);
    if (!t) return 'not-found';
    if (t.config.hostId !== requesterId) return 'not-host';
    return this.attemptStart(t, requesterId);
  }

  // --- 디렉터 콘솔 (Phase 2 — 개설자 전용 운영 개입) ---

  /**
   * 디렉터 개입 — 개설자(hostId)만. 모든 개입은 시스템 채팅 공지 + ops_event
   * (mtt-director-action) 감사 기록을 남긴다 (spec §5-3).
   * - pause: 시계 동결 + 전 테이블 다음 핸드 보류 (진행 중 핸드는 끝까지)
   * - resume: 시계 재개 + 보류 해제 (브레이크 구간이면 브레이크 대기로 복귀)
   * - set-level: 정지 중에만 — 시계를 해당 레벨 시작점으로 리셋 (실수 인상 롤백/스킵)
   * - remove-player: 강제 제거 = 현재 순위 탈락 (명시적 퇴장과 같은 경로)
   * - cancel: 토너먼트 취소 — 전 테이블 해산, 참가자는 room-lost 로비 복귀
   */
  directorAction(
    tournamentId: string,
    requesterId: string,
    action:
      | { kind: 'pause' }
      | { kind: 'resume' }
      | { kind: 'set-level'; level: number }
      | { kind: 'remove-player'; playerId: string }
      | { kind: 'cancel' },
  ): 'ok' | 'not-found' | 'not-host' | 'bad-state' | 'invalid' {
    const t = this.tournaments.get(tournamentId);
    if (!t) return 'not-found';
    if (t.config.hostId !== requesterId) return 'not-host';
    switch (action.kind) {
      case 'pause': return this.directorPause(t);
      case 'resume': return this.directorResume(t);
      case 'set-level': return this.directorSetLevel(t, action.level);
      case 'remove-player': return this.directorRemovePlayer(t, action.playerId);
      case 'cancel': {
        if (t.phase === 'completed' || t.phase === 'cancelled') return 'bad-state';
        this.logDirectorAction(t, { action: 'cancel' });
        this.cancelTournament(t, 'director');
        return 'ok';
      }
    }
  }

  private directorPause(t: TournamentRuntime): 'ok' | 'bad-state' {
    if (t.phase !== 'running' || t.pausedAt !== null) return 'bad-state';
    t.pausedAt = Date.now();
    // 브레이크 재개 타이머는 정지 중 발화하면 안 된다 — 재개 시 남은 시간으로 재무장
    if (t.breakTimer) { clearTimeout(t.breakTimer); t.breakTimer = null; }
    t.breakAnnounced = false;
    this.batchTournamentPresentation(t, () => {
      for (const roomId of t.tables.keys()) {
        this.addHold(t, roomId, 'director-pause');
      }
    });
    for (const roomId of t.tables.keys()) {
      this.roomManager.postSystemChat(
        roomId,
        '⏸️ 운영자가 토너먼트를 일시정지했습니다 — 진행 중인 핸드까지만 진행돼요.',
      );
    }
    this.logDirectorAction(t, { action: 'pause' });
    this.hooks.onTournamentsChanged?.();
    this.hooks.onTournamentUpdate?.(t.id);
    return 'ok';
  }

  private directorResume(t: TournamentRuntime): 'ok' | 'bad-state' {
    if (t.phase !== 'running' || t.pausedAt === null) return 'bad-state';
    t.pauseAccumMs += Date.now() - t.pausedAt;
    t.pausedAt = null;
    for (const roomId of t.tables.keys()) {
      this.roomManager.postSystemChat(roomId, '▶️ 토너먼트가 재개됩니다!');
    }
    this.logDirectorAction(t, { action: 'resume' });
    // 브레이크 구간에서 재개하면 브레이크 대기로 복귀, 아니면 보류 없는 테이블부터 재가동
    if (this.clockPos(t).onBreak) {
      this.batchTournamentPresentation(t, () => {
        for (const roomId of t.tables.keys()) {
          this.removeHold(t, roomId, 'director-pause');
          this.addHold(t, roomId, 'scheduled-break');
        }
      });
      this.armBreakResume(t);
    } else {
      this.batchTournamentPresentation(t, () => {
        for (const roomId of t.tables.keys()) {
          this.removeHold(t, roomId, 'director-pause');
        }
      });
      for (const roomId of t.tables.keys()) {
        this.resumeIfUnheld(t, roomId);
      }
    }
    this.hooks.onTournamentsChanged?.();
    this.hooks.onTournamentUpdate?.(t.id);
    return 'ok';
  }

  private directorSetLevel(
    t: TournamentRuntime,
    level: number,
  ): 'ok' | 'bad-state' | 'invalid' {
    // 정지 중에만 — 라이브 시계 밑에서 레벨을 움직이면 테이블별 적용 시점이 갈린다
    if (t.phase !== 'running' || t.pausedAt === null || t.startedAt === null) {
      return 'bad-state';
    }
    if (!Number.isInteger(level) || level < 1 || level > t.structure.levels.length) {
      return 'invalid';
    }
    // 시계를 해당 레벨의 시작점으로 리셋 — 경과 시간 = 레벨 앞 세그먼트(레벨+브레이크) 합
    const idx = level - 1;
    const breaks = t.structure.breakEveryLevels > 0
      ? Math.floor(idx / t.structure.breakEveryLevels)
      : 0;
    const offset = idx * t.structure.levelDurationMs + breaks * t.structure.breakDurationMs;
    t.pauseAccumMs = t.pausedAt - t.startedAt - offset;

    const pos = this.clockPos(t);
    const cur = mttLevelAt(t.structure, pos.levelIndex);
    for (const roomId of t.tables.keys()) {
      const engine = this.roomManager.getRoom(roomId)?.engine;
      if (!engine) continue;
      this.pushLevel(t, engine, pos, true); // initial=true — 공지는 아래 전용 문구로
      const anteText = cur.ante > 0 ? ` · 앤티 ${cur.ante}` : '';
      this.roomManager.postSystemChat(
        roomId,
        `🛠️ 운영자가 블라인드를 조정했습니다 — 레벨 ${level}: ${cur.smallBlind}/${cur.bigBlind}${anteText}`,
      );
    }
    this.logDirectorAction(t, { action: 'set-level', level });
    this.hooks.onTournamentUpdate?.(t.id);
    return 'ok';
  }

  private directorRemovePlayer(
    t: TournamentRuntime,
    playerId: string,
  ): 'ok' | 'bad-state' | 'invalid' {
    if (t.phase !== 'running') return 'bad-state';
    for (const roomId of t.tables.keys()) {
      const engine = this.roomManager.getRoom(roomId)?.engine;
      const player = engine?.state.players.find(
        p => p.id === playerId && !p.finishPlace && !p.pendingRemoval,
      );
      if (!player) continue;
      this.roomManager.postSystemChat(
        roomId,
        `⚠️ 운영자가 ${player.name}님을 토너먼트에서 제거했습니다.`,
      );
      this.logDirectorAction(t, { action: 'remove-player', playerId, name: player.name });
      // 명시적 퇴장과 같은 경로 — leaveRoom이 onPlayerLeave 훅(현재 순위 탈락 확정)을 태운다
      this.roomManager.leaveRoom(roomId, playerId);
      return 'ok';
    }
    return 'invalid';
  }

  private logDirectorAction(
    t: TournamentRuntime,
    data: Record<string, unknown>,
  ): void {
    eventLog.log('mtt-director-action', {
      data: { tournamentId: t.id, ...data },
    });
  }

  // --- 조회 ---

  listTournaments(forPlayerId?: string): TournamentSummary[] {
    return [...this.tournaments.values()]
      .sort((a, b) => b.createdAt - a.createdAt)
      .map(t => this.toSummary(t, forPlayerId));
  }

  getDetail(tournamentId: string, forPlayerId?: string): TournamentDetailView | null {
    const t = this.tournaments.get(tournamentId);
    if (!t) return null;
    const clockPos = t.startedAt !== null && t.phase === 'running'
      ? this.clockPos(t)
      : null;
    const previewPool = t.phase === 'registering'
      ? Math.max(t.entrants.size, 2) * this.entryUnit(t)
      : t.prizePool;
    const previewEntrants = t.phase === 'registering'
      ? Math.max(
        t.entrants.size,
        t.config.botFill ? t.config.maxEntrants : t.entrants.size,
        2,
      )
      : t.seatedCount;
    const pool = t.phase === 'registering' && t.config.botFill
      ? t.config.maxEntrants * this.entryUnit(t)
      : previewPool;
    const payouts = t.phase === 'registering'
      ? computePayouts(pool, previewEntrants).map((prize, i) => ({ place: i + 1, prize }))
      : t.prizes.map((prize, i) => ({ place: i + 1, prize }));
    return {
      summary: this.toSummary(t, forPlayerId),
      levels: t.structure.levels.slice(0, 16).map(l => ({
        level: l.level, smallBlind: l.smallBlind, bigBlind: l.bigBlind, ante: l.ante,
      })),
      levelDurationMs: t.structure.levelDurationMs,
      payouts,
      entrants: [...t.entrants.values()],
      standings: this.standings(t),
      clock: clockPos
        ? {
            level: clockPos.levelIndex + 1,
            onBreak: clockPos.onBreak,
            segmentRemainingMs: Number.isFinite(clockPos.segmentRemainingMs)
              ? clockPos.segmentRemainingMs
              : null,
          }
        : null,
      stage: t.stage,
      holdReasons: this.publicHoldReasons(t),
      stageEndsAt: this.presentationDeadline(t),
      finalTheme: t.finalTheme,
    };
  }

  getTournamentIdForRoom(roomId: string): string | undefined {
    return this.byRoom.get(roomId);
  }

  /** 진행 중인 다른 토너먼트에 이미 등록/생존 참가 중인지 — 중복 참가 가드 */
  hasActiveEngagement(playerId: string): boolean {
    for (const t of this.tournaments.values()) {
      if (t.phase === 'registering' && t.entrants.has(playerId)) return true;
      if (t.phase === 'running') {
        for (const roomId of t.tables.keys()) {
          const engine = this.roomManager.getRoom(roomId)?.engine;
          if (engine?.state.players.some(
            p => p.id === playerId && !p.finishPlace && !p.pendingRemoval,
          )) {
            return true;
          }
        }
      }
    }
    return false;
  }

  getRuntimeStats(): { tournaments: number; tables: number; held: number } {
    let held = 0;
    for (const t of this.tournaments.values()) held += t.holds.size;
    return { tournaments: this.tournaments.size, tables: this.byRoom.size, held };
  }

  /** 백오피스(/admin 토너먼트 탭) 전용 전체 뷰 — 테이블 상태·보류 사유·전 순위 포함 */
  getAdminSummaries(): AdminTournamentView[] {
    return [...this.tournaments.values()]
      .sort((a, b) => b.createdAt - a.createdAt)
      .map(t => {
        const clock = t.startedAt !== null && t.phase === 'running'
          ? this.clockPos(t)
          : null;
        return {
          id: t.id,
          name: t.config.name,
          phase: t.phase,
          speed: t.config.speed,
          hostId: t.config.hostId,
          createdAt: t.createdAt,
          startedAt: t.startedAt,
          finishedAt: t.finishedAt,
          paused: t.pausedAt !== null,
          level: clock ? clock.levelIndex + 1 : 1,
          onBreak: clock?.onBreak ?? false,
          h4hActive: t.h4h.active,
          economyMode: t.config.economyMode ?? 'practice',
          entrantCount: t.phase === 'registering' ? t.entrants.size : t.seatedCount,
          seatedCount: t.seatedCount,
          remaining: t.remaining,
          prizePool: t.prizePool,
          tables: [...t.tables.entries()].map(([roomId, meta]) => {
            const engine = this.roomManager.getRoom(roomId)?.engine;
            const players = engine?.state.players ?? [];
            return {
              roomId,
              no: meta.no,
              players: players.length,
              humans: players.filter(p => p.type === 'human').length,
              alive: engine
                ? players.filter(p => this.isAlive(engine, p)).length
                : 0,
              handInProgress: engine?.state.isHandInProgress ?? false,
              held: [...(t.holds.get(roomId) ?? [])].sort().join(',') || null,
            };
          }),
          standings: this.standings(t),
        };
      });
  }

  shutdown(): void {
    for (const t of this.tournaments.values()) {
      if (t.startTimer) clearTimeout(t.startTimer);
      if (t.finalIntroTimer) clearTimeout(t.finalIntroTimer);
      if (t.breakTimer) clearTimeout(t.breakTimer);
      if (t.cleanupTimer) clearTimeout(t.cleanupTimer);
      if (t.settleRetryTimer) clearTimeout(t.settleRetryTimer);
    }
  }

  /** wallet 정산 시도 — 성공 여부만 반환 (재호출은 리포지토리가 멱등 처리) */
  private settleWallet(t: TournamentRuntime, results: MttResult[]): boolean {
    try {
      this.hooks.economy?.settle(
        t.id,
        results.map(r => ({ playerId: r.playerId, place: r.place, prize: r.prize })),
      );
      return true;
    } catch {
      return false;
    }
  }

  // --- 시작 ---

  private attemptStart(
    t: TournamentRuntime,
    requesterId: string | null,
  ): 'ok' | 'not-registering' | 'not-enough' | 'economy' {
    if (t.phase !== 'registering') return 'not-registering';
    if (t.startTimer) {
      clearTimeout(t.startTimer);
      t.startTimer = null;
    }
    const isWallet = t.config.economyMode === 'wallet';

    // 체크인: 시작 시점 접속 = 출석. 미접속 등록자는 착석에서 제외한다 (노쇼 방지 — 무료 등록의
    // 유령 좌석이 초반 테이블을 죽이는 문제. 리서치 §3-3 #4)
    const checkedIn = [...t.entrants.values()].filter(
      e => this.hooks.isConnected?.(e.id) ?? true,
    );
    const botCount = t.config.botFill
      ? Math.max(0, t.config.maxEntrants - checkedIn.length)
      : 0;
    const total = checkedIn.length + botCount;
    if (total < 2 || checkedIn.length < 1) {
      // 자동 시작(예약)인데 인원이 안 되면 취소한다 — 수동 시작은 에러만 반환
      // (wallet 환불은 cancelTournament의 refundAll이 담당)
      if (requesterId === null) this.cancelTournament(t, 'not-enough');
      return 'not-enough';
    }

    if (isWallet) {
      // 노쇼(미접속 등록자) 환불 — 시작 에스크로는 출석 명단과 정확히 일치해야 한다
      const checkedInIds = new Set(checkedIn.map(e => e.id));
      for (const entrant of t.entrants.values()) {
        if (checkedInIds.has(entrant.id)) continue;
        try {
          this.hooks.economy?.refundEntry(entrant.id, t.id);
        } catch {
          // 환불 실패 좌석은 서버 재시작 복구(recoverIncompleteSngEntries)가 회수한다
          eventLog.log('mtt-cancel', {
            data: { tournamentId: t.id, reason: 'no-show-refund-failed', playerId: entrant.id },
          });
        }
      }
      try {
        this.hooks.economy?.startEscrow(t.id, checkedIn.map(e => e.id));
      } catch {
        // 시작 에스크로 실패 — 등록 상태를 유지하고(노쇼는 이미 제외) 재시도 여지를 남긴다
        t.entrants = new Map(checkedIn.map(e => [e.id, e]));
        this.hooks.onTournamentsChanged?.();
        return 'economy';
      }
    }

    t.entrants = new Map(checkedIn.map(e => [e.id, e]));

    const tableCount = Math.ceil(total / t.config.tableSize);
    const base = Math.floor(total / tableCount);
    const extra = total % tableCount;
    const targetSizes = Array.from({ length: tableCount }, (_, i) => base + (i < extra ? 1 : 0));

    const level1 = t.structure.levels[0];
    const roomIds: string[] = [];
    for (let i = 0; i < tableCount; i++) {
      const roomId = this.roomManager.createRoom({
        name: `${t.config.name} · 테이블 ${i + 1}`,
        smallBlind: level1.smallBlind,
        bigBlind: level1.bigBlind,
        minBuyIn: t.structure.startingStack,
        maxBuyIn: t.structure.startingStack,
        maxPlayers: t.config.tableSize,
        economyMode: 'practice',
        turnTime: t.config.turnTime,
        gameMode: 'mtt',
        startingStack: t.structure.startingStack,
        ante: level1.ante,
        tournamentId: t.id,
        hostId: t.config.hostId,
        difficulty: 'normal',
        botCount: 0,
        tableType: 'mixed',
      });
      // joinRoom의 tryStartGame이 만석 테이블을 조기 시작하지 못하게, 착석 전에 보류를 건다
      this.byRoom.set(roomId, t.id);
      t.tables.set(roomId, { no: i + 1 });
      t.holds.set(roomId, new Set(['setup']));
      roomIds.push(roomId);
    }

    // 초기 배치: 휴먼 셔플 → 라운드로빈 (테이블 간 휴먼 수 균등)
    const shuffled = shuffle(checkedIn);
    const perTableSeat = roomIds.map(() => 0);
    shuffled.forEach((entrant, i) => {
      const ti = i % tableCount;
      const player: Player = {
        id: entrant.id,
        name: entrant.name,
        type: 'human',
        avatar: entrant.avatar,
        chips: t.structure.startingStack,
        seatIndex: perTableSeat[ti]++,
        holeCards: [],
        currentBet: 0,
        totalContributed: 0,
        status: 'waiting',
        hasActed: false,
      };
      this.roomManager.joinRoom(roomIds[ti], player);
    });

    // 남는 자리는 봇으로 — 캐릭터는 토너먼트 전역에서 중복 회피 (로스터 16명 소진 시에만
    // 테이블 간 중복 허용, 테이블 내 중복은 항상 회피). 같은 캐릭터가 두 테이블에서 각각
    // 탈락해 순위표에 "초코 4위·초코 6위"로 보이는 혼란 방지 (2026-07-23 QA).
    if (botCount > 0) {
      const usedGlobal: string[] = roomIds.flatMap(roomId => {
        const engine = this.roomManager.getRoom(roomId)?.engine;
        return engine ? getUsedCharacterIds(engine) : [];
      });
      // 로스터(16명)보다 봇이 많으면 같은 캐릭터가 여러 테이블에 앉는다 — 순위표/로비에서
      // "엘레나 2명"으로 보이는 혼란 방지를 위해 2번째 등장부터 이름에 번호를 붙인다
      // (엘레나, 엘레나 2, 엘레나 3 …). 2026-07-24 모바일 QA 피드백.
      const characterUses = new Map<string, number>();
      for (const id of usedGlobal) {
        characterUses.set(id, (characterUses.get(id) ?? 0) + 1);
      }
      roomIds.forEach((roomId, i) => {
        const engine = this.roomManager.getRoom(roomId)?.engine;
        if (!engine) return;
        for (
          let seat = 0;
          seat < t.config.tableSize && engine.state.players.length < targetSizes[i];
          seat++
        ) {
          if (engine.state.players.some(p => p.seatIndex === seat)) continue;
          const tableUsed = getUsedCharacterIds(engine);
          let bot = createBot(seat, t.structure.startingStack, usedGlobal, 'normal');
          if (bot.personalityId && tableUsed.includes(bot.personalityId)) {
            bot = createBot(seat, t.structure.startingStack, tableUsed, 'normal');
          }
          const characterId = bot.personalityId ?? '';
          const uses = (characterUses.get(characterId) ?? 0) + 1;
          characterUses.set(characterId, uses);
          if (uses > 1) bot.name = `${bot.name} ${uses}`;
          if (engine.addPlayer(bot)) usedGlobal.push(characterId);
        }
      });
    }

    t.seatedCount = total;
    t.remaining = total;
    // 상금 풀 — practice는 표시용 칩 풀, wallet은 리얼 칩(바이인 × 인원, 수수료 제외)
    t.prizePool = isWallet
      ? total * t.config.entryBuyIn!
      : total * t.structure.startingStack;
    t.prizes = computePayouts(t.prizePool, total);
    t.startedAt = Date.now();
    t.phase = 'running';

    const pos = this.clockPos(t);
    for (const roomId of roomIds) {
      const engine = this.roomManager.getRoom(roomId)?.engine;
      if (!engine) continue;
      engine.setTournamentField(total, t.prizes, false);
      // 게임 중 토너 상세(순위표/구조) 진입점 — 클라이언트가 이 ID로 get-tournament 조회
      if (engine.state.tournament) engine.state.tournament.tournamentId = t.id;
      this.pushLevel(t, engine, pos, true);
    }
    this.syncTournamentPresentation(t);

    // 착석 통지 (소켓 계층이 세션 전환 + room-joined) → 보류 해제 → 각 테이블 진행
    for (let i = 0; i < shuffled.length; i++) {
      this.hooks.onSeated?.({
        tournamentId: t.id,
        playerId: shuffled[i].id,
        roomId: roomIds[i % tableCount],
      });
    }
    for (const roomId of roomIds) {
      this.roomManager.postSystemChat(
        roomId,
        `🏆 ${t.config.name} 시작! 참가 ${total}명 · 테이블 ${tableCount}개 · `
        + `${paidPlaces(total)}명 입상 · 우승 상금 ${t.prizes[0].toLocaleString()}`,
      );
    }
    let formingFinal = false;
    this.batchTournamentPresentation(t, () => {
      formingFinal = this.beginFinalFormation(t);
      for (const roomId of roomIds) this.removeHold(t, roomId, 'setup');
    });
    if (formingFinal) {
      this.finishFinalFormation(t);
    } else {
      for (const roomId of roomIds) this.resumeIfUnheld(t, roomId);
    }

    eventLog.log('mtt-start', {
      data: {
        tournamentId: t.id, entrants: total, humans: checkedIn.length,
        bots: botCount, tables: tableCount,
      },
    });
    this.hooks.onTournamentsChanged?.();
    this.hooks.onTournamentUpdate?.(t.id);
    return 'ok';
  }

  private cancelTournament(t: TournamentRuntime, reason: string): void {
    if (t.phase === 'completed' || t.phase === 'cancelled') return;
    t.phase = 'cancelled';
    t.pausedAt = null;
    if (t.startTimer) { clearTimeout(t.startTimer); t.startTimer = null; }
    if (t.finalIntroTimer) { clearTimeout(t.finalIntroTimer); t.finalIntroTimer = null; }
    if (t.breakTimer) { clearTimeout(t.breakTimer); t.breakTimer = null; }
    // wallet 무효화 환불 — 등록 중(reserved)·진행 중(started) 전원 전액(수수료 포함) 반환.
    // 프리즈아웃 중도 취소는 순위 확정이 불가능하므로 전원 환불이 유일하게 공정하다.
    if (t.config.economyMode === 'wallet') {
      try {
        this.hooks.economy?.refundAll(t.id);
      } catch {
        // 환불 실패 좌석은 서버 재시작 복구가 회수한다 — 취소 진행은 막지 않는다
        eventLog.log('mtt-cancel', {
          data: { tournamentId: t.id, reason: 'refund-failed' },
        });
      }
    }
    for (const roomId of t.tables.keys()) {
      this.byRoom.delete(roomId);
      this.roomManager.disposeRoom(roomId, 'mtt-cancel');
    }
    t.tables.clear();
    t.holds.clear();
    eventLog.log('mtt-cancel', { data: { tournamentId: t.id, reason } });
    this.hooks.onTournamentsChanged?.();
    // 취소 기록은 잠시 보여준 뒤 목록에서 제거
    t.cleanupTimer = setTimeout(() => {
      this.tournaments.delete(t.id);
      this.hooks.onTournamentsChanged?.();
    }, 60_000);
  }

  // --- RoomManager 훅 구현 ---

  private isHeld(roomId: string): boolean {
    const t = this.byTable(roomId);
    if (!t) return false;
    // 디렉터 일시정지 — 진행 중 핸드는 끝까지, 다음 핸드는 전 테이블 보류
    if (t.pausedAt !== null) return true;
    if (this.hasHolds(t, roomId)) return true;
    // H4H 중에는 배리어 해제 시 무장(armed)된 테이블만 다음 핸드를 시작할 수 있다
    if (t.h4h.active && !t.h4h.armed.has(roomId)) return true;
    return false;
  }

  private applyLevel(roomId: string, engine: PokerEngine): void {
    const t = this.byTable(roomId);
    if (!t || t.startedAt === null || t.phase !== 'running') return;
    this.pushLevel(t, engine, this.clockPos(t), false);
  }

  private onHandStarted(roomId: string, handNumber: number): void {
    const t = this.byTable(roomId);
    const engine = this.roomManager.getRoom(roomId)?.engine;
    if (!t || !engine || engine.state.handNumber !== handNumber) return;
    if (t.h4h.active) t.h4h.armed.delete(roomId);
  }

  private onHandComplete(roomId: string): 'continue' | 'hold' | 'gone' {
    const t = this.byTable(roomId);
    if (!t) return 'continue';
    if (t.phase !== 'running') return 'hold';
    const room = this.roomManager.getRoom(roomId);
    if (!room) return 'gone';
    const engine = room.engine;

    const busted = engine.state.players.filter(
      p => p.chips <= 0 && !p.finishPlace && !p.pendingRemoval,
    );

    // H4H: 버스트를 라운드 버퍼에 모으고 전 테이블 완료를 기다린다 —
    // 같은 동기화 핸드의 탈락은 테이블이 달라도 "같은 핸드"로 순위를 판정한다 (Stars 2.2)
    if (t.h4h.active) {
      for (const p of busted) {
        t.h4h.busts.push({
          roomId,
          playerId: p.id,
          name: p.name,
          handStartChips: p.handStartChips ?? 0,
        });
        p.pendingRemoval = true;
      }
      this.addHold(t, roomId, 'h4h-barrier');
      this.tryReleaseH4h(t);
      return 'hold';
    }

    if (busted.length > 0) {
      this.assignEliminations(
        t,
        busted
          .map(p => ({ roomId, playerId: p.id, name: p.name, handStartChips: p.handStartChips ?? 0 })),
      );
    }

    if (this.checkCompletion(t)) return 'hold';

    if (this.beginFinalFormation(t) || t.stage === 'final-forming') {
      this.finishFinalFormation(t);
      return this.roomManager.getRoom(roomId) ? 'hold' : 'gone';
    }

    const enteringH4h = (
      !t.h4h.active
      && t.tables.size > 1
      && t.remaining === paidPlaces(t.seatedCount) + 1
    );
    // 파이널 전환이 아니면 테이블 브레이크/밸런싱을 먼저 확정한 뒤 다음 H4H를 무장한다.
    // H4H 진입 경계에서는 방금 끝난 테이블이 숏이어도 전역 최다 테이블에서 이동할 수 있다.
    const balance = this.balanceAfterHand(t, roomId, enteringH4h);
    if (balance === 'gone') {
      if (
        enteringH4h
        && t.tables.size > 1
        && t.remaining === paidPlaces(t.seatedCount) + 1
      ) {
        this.enterH4hBarrier(t);
      }
      return 'gone';
    }

    // 버블(입상 1명 전) 도달 → hand-for-hand 발동 (테이블 2개 이상일 때만 의미)
    if (!t.h4h.active && t.tables.size > 1 && t.remaining === paidPlaces(t.seatedCount) + 1) {
      this.enterH4hBarrier(t);
      return 'hold';
    }

    // 브레이크 — 시계가 휴식 구간이면 전 테이블이 핸드를 끝내는 대로 정지
    if (this.clockPos(t).onBreak) {
      this.addHold(t, roomId, 'scheduled-break');
      this.armBreakResume(t);
      return 'hold';
    }

    return 'continue';
  }

  private onPlayerLeave(roomId: string, playerId: string): void {
    const t = this.byTable(roomId);
    if (!t || t.phase !== 'running') return;
    const engine = this.roomManager.getRoom(roomId)?.engine;
    const player = engine?.state.players.find(p => p.id === playerId);
    if (!engine || !player || player.finishPlace || player.pendingRemoval) return;
    // 명시적 퇴장 = 현재 순위로 탈락 확정 (SnG 계약 승계)
    this.batchTournamentPresentation(t, () => {
      this.assignEliminations(t, [{
        roomId,
        playerId,
        name: player.name,
        handStartChips: player.handStartChips ?? player.chips,
      }]);
      if (!this.checkCompletion(t)) this.beginFinalFormation(t);
    });
  }

  private onPlayerLeft(roomId: string): void {
    const t = this.byTable(roomId);
    if (!t || t.phase !== 'running') return;
    if (t.stage !== 'final-forming' && !this.beginFinalFormation(t)) return;
    this.finishFinalFormation(t);
  }

  // --- 탈락/순위 ---

  /** 같은 배치 내 동시 탈락은 핸드 시작 스택 오름차순으로 낮은 순위부터 부여 */
  private assignEliminations(t: TournamentRuntime, busts: PendingBust[]): void {
    if (busts.length === 0) return;
    const ordered = [...busts].sort((a, b) => a.handStartChips - b.handStartChips);
    for (const bust of ordered) {
      const place = t.remaining;
      const prize = t.prizes[place - 1] ?? 0;
      t.remaining -= 1;
      t.results.push({ playerId: bust.playerId, name: bust.name, place, prize });

      const room = this.roomManager.getRoom(bust.roomId);
      if (room) {
        room.engine.applyTournamentEliminations([{ playerId: bust.playerId, place, prize }]);
        const player = room.engine.state.players.find(p => p.id === bust.playerId);
        if (player) {
          player.pendingRemoval = true;
          if (player.type === 'human') {
            this.hooks.onEliminated?.({
              tournamentId: t.id,
              roomId: bust.roomId,
              playerId: bust.playerId,
              place,
              prize,
            });
          }
        }
        const prizeText = prize > 0 ? ` — 상금 ${prize.toLocaleString()} 획득!` : '';
        this.roomManager.postSystemChat(
          bust.roomId,
          `${bust.name}님이 ${place}위로 탈락했습니다${prizeText} (남은 인원 ${t.remaining}명)`,
        );
      }
    }
    // 탈락 확정(finishPlace)·잔존 인원이 실린 스냅샷을 즉시 재브로드캐스트 — EliminationNotice 표시 계약
    this.syncTournamentPresentation(t);
    this.hooks.onTournamentUpdate?.(t.id);
    this.hooks.onTournamentsChanged?.();
  }

  private checkCompletion(t: TournamentRuntime): boolean {
    if (t.phase !== 'running' || t.remaining > 1) return false;

    let winner: { roomId: string; player: Player } | null = null;
    for (const roomId of t.tables.keys()) {
      const engine = this.roomManager.getRoom(roomId)?.engine;
      const alive = engine?.state.players.find(p => this.isAlive(engine, p));
      if (alive) winner = { roomId, player: alive };
    }

    t.phase = 'completed';
    t.stage = 'complete';
    t.stageEndsAt = undefined;
    t.finishedAt = Date.now();
    t.pausedAt = null;
    t.h4h.active = false;
    t.h4h.armed.clear();
    t.h4h.busts = [];
    t.holds.clear();
    if (t.finalIntroTimer) {
      clearTimeout(t.finalIntroTimer);
      t.finalIntroTimer = null;
    }
    if (t.breakTimer) { clearTimeout(t.breakTimer); t.breakTimer = null; }

    if (winner) {
      const prize = t.prizes[0] ?? 0;
      t.results.push({ playerId: winner.player.id, name: winner.player.name, place: 1, prize });
      const engine = this.roomManager.getRoom(winner.roomId)?.engine;
      engine?.applyTournamentEliminations([{ playerId: winner.player.id, place: 1, prize }]);
    }
    const results = [...t.results].sort((a, b) => a.place - b.place);
    const podium = results
      .filter(r => r.place <= 3)
      .map(r => `${r.place}위 ${r.name}${r.prize > 0 ? ` +${r.prize.toLocaleString()}` : ''}`)
      .join(' · ');

    for (const roomId of t.tables.keys()) {
      const engine = this.roomManager.getRoom(roomId)?.engine;
      engine?.setTournamentField(t.seatedCount, t.prizes, true, results);
      this.roomManager.postSystemChat(roomId, `🏆 ${t.config.name} 종료! ${podium}`);
    }
    this.batchTournamentPresentation(t, () => {
      for (const roomId of t.tables.keys()) {
        this.addHold(t, roomId, 'complete');
      }
    });
    for (const roomId of t.tables.keys()) {
      // 종료 상태 브로드캐스트 (tryStartGame은 finished/held 게이트로 조기 반환)
      this.roomManager.resumeRoom(roomId);
      // 결과 확인을 위해 10분 보존 후 정리 (SnG retention 계약 재사용)
      this.roomManager.retainFinishedTournament(roomId);
    }

    // wallet 상금 정산 — 전 순위(1..N) 결과를 payout-table 검증과 함께 지급.
    // 실패 시 10초 후 1회 재시도, 그래도 실패하면 재시작 복구가 전액 환불로 회수한다
    // (상금 미지급이 조용히 사라지지 않게 mtt-complete에 settlementOk를 남긴다).
    let settlementOk = true;
    if (t.config.economyMode === 'wallet') {
      settlementOk = this.settleWallet(t, results);
      if (!settlementOk) {
        t.settleRetryTimer = setTimeout(() => {
          t.settleRetryTimer = null;
          const retried = this.settleWallet(t, results);
          eventLog.log('mtt-complete', {
            data: { tournamentId: t.id, settlementRetryOk: retried },
          });
        }, 10_000);
      }
    }

    eventLog.log('mtt-complete', {
      data: {
        tournamentId: t.id,
        entrants: t.seatedCount,
        champion: results[0]?.name,
        prizePool: t.prizePool,
        settlementOk,
      },
    });
    this.hooks.onTournamentsChanged?.();
    this.hooks.onTournamentUpdate?.(t.id);

    t.cleanupTimer = setTimeout(() => {
      for (const roomId of t.tables.keys()) this.byRoom.delete(roomId);
      this.tournaments.delete(t.id);
      this.hooks.onTournamentsChanged?.();
    }, COMPLETED_RETENTION_MS + 30_000);
    return true;
  }

  // --- 파이널 테이블 배리어 ---

  private beginFinalFormation(t: TournamentRuntime): boolean {
    if (t.remaining > t.config.tableSize || t.stage !== 'multi-table') return false;
    t.stage = 'final-forming';
    t.stageEndsAt = undefined;
    this.batchTournamentPresentation(t, () => {
      for (const roomId of t.tables.keys()) {
        this.addHold(t, roomId, 'final-forming');
      }
    });
    this.hooks.onTournamentUpdate?.(t.id);
    return true;
  }

  /** 모든 소스 테이블이 핸드 사이일 때만 전원을 한 테이블로 옮기고 인트로를 건다. */
  private finishFinalFormation(t: TournamentRuntime): boolean {
    if (t.stage !== 'final-forming' || t.tables.size === 0) return false;
    for (const roomId of t.tables.keys()) {
      if (this.roomManager.getRoom(roomId)?.engine.state.isHandInProgress) return false;
    }

    const destination = [...t.tables.entries()]
      .map(([roomId, meta]) => ({
        roomId,
        no: meta.no,
        alive: this.aliveCounts(t).get(roomId) ?? 0,
      }))
      .sort((a, b) => b.alive - a.alive || a.no - b.no)[0]?.roomId;
    if (!destination) return false;

    // 핸드 사이이므로 확정 탈락 좌석을 먼저 비워 파이널 수용 공간을 만든다.
    for (const roomId of t.tables.keys()) {
      this.roomManager.getRoom(roomId)?.engine.removePendingPlayers();
    }

    const sourceIds = [...t.tables.keys()].filter(roomId => roomId !== destination);
    for (const sourceId of sourceIds) {
      const source = this.roomManager.getRoom(sourceId);
      if (!source) return false;
      const movers = source.engine.state.players.filter(
        p => p.chips > 0 && !p.finishPlace && !p.pendingRemoval,
      );
      for (const mover of movers) {
        this.moveSeat(t, sourceId, destination, mover.id, false);
      }
      const stranded = source.engine.state.players.some(
        p => p.chips > 0 && !p.finishPlace && !p.pendingRemoval,
      );
      if (stranded) return false;
    }

    for (const sourceId of sourceIds) {
      this.byRoom.delete(sourceId);
      t.tables.delete(sourceId);
      t.holds.delete(sourceId);
      t.h4h.armed.delete(sourceId);
      this.roomManager.disposeRoom(sourceId, 'mtt-break');
    }

    t.h4h.active = false;
    t.h4h.armed.clear();
    t.h4h.busts = [];
    t.stage = 'final-intro';
    t.stageEndsAt = Date.now() + 4_500;
    const onBreak = this.clockPos(t).onBreak;
    this.batchTournamentPresentation(t, () => {
      this.removeHold(t, destination, 'h4h-barrier');
      this.removeHold(t, destination, 'final-forming');
      this.removeHold(t, destination, 'setup');
      this.addHold(t, destination, 'final-intro');
      if (onBreak) this.addHold(t, destination, 'scheduled-break');
    });

    if (onBreak) {
      this.armBreakResume(t);
    }

    if (!t.finalAnnounced) {
      t.finalAnnounced = true;
      this.roomManager.postSystemChat(
        destination,
        `🔥 파이널 테이블! 남은 ${t.remaining}명이 우승 상금 `
        + `${t.prizes[0]?.toLocaleString() ?? 0}을 놓고 겨룹니다.`,
      );
    }
    this.hooks.onTournamentUpdate?.(t.id);
    this.hooks.onTournamentsChanged?.();

    if (t.finalIntroTimer) clearTimeout(t.finalIntroTimer);
    const introDelay = Math.max(0, (t.stageEndsAt ?? Date.now()) - Date.now());
    t.finalIntroTimer = setTimeout(() => {
      t.finalIntroTimer = null;
      this.finishFinalIntro(t);
    }, introDelay);
    return true;
  }

  private finishFinalIntro(t: TournamentRuntime): void {
    if (t.phase !== 'running' || t.stage !== 'final-intro') return;
    t.stage = 'final-playing';
    t.stageEndsAt = undefined;
    const [roomId] = t.tables.keys();
    if (!roomId) return;
    this.removeHold(t, roomId, 'final-intro');
    this.resumeIfUnheld(t, roomId);
    this.hooks.onTournamentUpdate?.(t.id);
    this.hooks.onTournamentsChanged?.();
  }

  // --- 밸런싱/브레이크 ---

  /**
   * 생존 판정 — 진행 중 핸드의 올인 좌석은 chips가 0이어도 팟 지분이 있는 생존자다.
   * chips > 0만 보면 다른 테이블의 라이브 핸드 동안 총 생존을 과소평가해
   * 조기 테이블 브레이크(정원 부족 부분 이주)와 순위표 누락이 생긴다 (2026-07-23 QA).
   */
  private isAlive(engine: PokerEngine, p: Player): boolean {
    if (p.finishPlace || p.pendingRemoval) return false;
    if (p.chips > 0) return true;
    return engine.state.isHandInProgress
      && (p.status === 'active' || p.status === 'all-in');
  }

  /** 테이블별 생존(다음 핸드 딜인 대상) 인원 */
  private aliveCounts(t: TournamentRuntime): Map<string, number> {
    const counts = new Map<string, number>();
    for (const roomId of t.tables.keys()) {
      const engine = this.roomManager.getRoom(roomId)?.engine;
      const alive = engine
        ? engine.state.players.filter(p => this.isAlive(engine, p)).length
        : 0;
      counts.set(roomId, alive);
    }
    return counts;
  }

  private balanceAfterHand(
    t: TournamentRuntime,
    roomId: string,
    useGlobalExtremes = false,
  ): 'kept' | 'gone' {
    let counts = this.aliveCounts(t);
    const totalAlive = [...counts.values()].reduce((s, v) => s + v, 0);
    const target = Math.max(1, Math.ceil(totalAlive / t.config.tableSize));

    // 테이블 브레이크 — 인원 최소 테이블(동률이면 뒤 번호)을 해체해 나머지에 흡수.
    // 지금 핸드를 끝낸 테이블이 후보면 즉시, 다른 유휴(핸드 사이) 테이블이 후보여도 즉시.
    // 핸드 중인 후보는 그 테이블의 핸드 종료 훅에서 처리된다 (핸드 중 이탈 금지 불변식).
    while (t.tables.size > target) {
      const candidate = this.pickBreakCandidate(t, counts);
      if (!candidate) break;
      const candRoom = this.roomManager.getRoom(candidate);
      if (!candRoom) break;
      if (candidate !== roomId && candRoom.engine.state.isHandInProgress) break;
      this.breakTable(t, candidate);
      if (candidate === roomId) return 'gone';
      counts = this.aliveCounts(t);
    }

    // 개별 이동 — 평상시는 기존처럼 방금 끝난 테이블에서만 이동한다.
    // H4H 진입 경계는 1대4처럼 숏 테이블에서 탈락해도 전역 최다→최소로 먼저 맞춘다.
    counts = this.aliveCounts(t);
    let minRoom: string | null = null;
    let minCount = Infinity;
    let maxRoom: string | null = useGlobalExtremes ? null : roomId;
    let maxCount = useGlobalExtremes ? -1 : (counts.get(roomId) ?? 0);
    for (const [rid, count] of counts) {
      if (!useGlobalExtremes && rid === roomId) continue;
      if (count < minCount) { minCount = count; minRoom = rid; }
      if (useGlobalExtremes && count > maxCount) { maxCount = count; maxRoom = rid; }
    }
    const maxEngine = maxRoom ? this.roomManager.getRoom(maxRoom)?.engine : undefined;
    if (
      minRoom && maxRoom && minRoom !== maxRoom
      && maxCount - minCount > 1
      && maxEngine && !maxEngine.state.isHandInProgress
    ) {
      this.moveOnePlayer(t, maxRoom, minRoom);
    }

    return 'kept';
  }

  private pickBreakCandidate(
    t: TournamentRuntime,
    counts: Map<string, number>,
  ): string | null {
    let candidate: string | null = null;
    let candidateCount = Infinity;
    let candidateNo = -1;
    for (const [rid, meta] of t.tables) {
      const count = counts.get(rid) ?? 0;
      if (
        count < candidateCount
        || (count === candidateCount && meta.no > candidateNo)
      ) {
        candidate = rid;
        candidateCount = count;
        candidateNo = meta.no;
      }
    }
    return candidate;
  }

  /** 테이블 해체 — 생존자를 남은 테이블의 빈 좌석으로 흡수하고 방을 정리한다 */
  private breakTable(t: TournamentRuntime, roomId: string): void {
    const room = this.roomManager.getRoom(roomId);
    if (!room || room.engine.state.isHandInProgress) return;
    const movers = room.engine.state.players.filter(
      p => p.chips > 0 && !p.finishPlace && !p.pendingRemoval,
    );
    const tableNo = t.tables.get(roomId)?.no;

    // 정원 사전 검사 — 전원 수용이 불가능하면 해체를 시작하지 않는다.
    // 절반만 이주된 채 중단되면 남은 테이블들이 격차 밸런싱으로 되밀어내는 핑퐁이 생긴다.
    let capacity = 0;
    for (const rid of t.tables.keys()) {
      if (rid === roomId) continue;
      const destRoom = this.roomManager.getRoom(rid);
      if (!destRoom) continue;
      const occupied = destRoom.engine.state.players.filter(p => !p.pendingRemoval).length;
      capacity += Math.max(0, destRoom.config.maxPlayers - occupied);
    }
    if (capacity < movers.length) return;

    for (const mover of movers) {
      // 흡수처: 생존 인원이 가장 적은 다른 테이블 (탈락 예약 좌석은 곧 비워지므로 정원에서 제외)
      const counts = this.aliveCounts(t);
      let dest: string | null = null;
      let destCount = Infinity;
      for (const [rid, count] of counts) {
        if (rid === roomId) continue;
        const destRoom = this.roomManager.getRoom(rid);
        if (!destRoom) continue;
        const occupied = destRoom.engine.state.players.filter(p => !p.pendingRemoval).length;
        if (occupied >= destRoom.config.maxPlayers) continue;
        if (count < destCount) { destCount = count; dest = rid; }
      }
      if (!dest) break;
      this.moveSeat(t, roomId, dest, mover.id);
    }

    // 이주 실패한 생존자가 남아 있으면 해체를 중단한다 — 방과 함께 스택이 소멸하면 안 된다
    const stranded = room.engine.state.players.some(
      p => p.chips > 0 && !p.finishPlace && !p.pendingRemoval,
    );
    if (stranded) return;

    this.byRoom.delete(roomId);
    t.tables.delete(roomId);
    t.holds.delete(roomId);
    t.h4h.armed.delete(roomId);
    this.roomManager.disposeRoom(roomId, 'mtt-break');
    for (const rid of t.tables.keys()) {
      this.roomManager.postSystemChat(rid, `테이블 ${tableNo ?? '?'}이(가) 해체되어 통합됐어요.`);
    }
    eventLog.log('mtt-table-break', {
      data: { tournamentId: t.id, tableNo, remainingTables: t.tables.size },
    });
    this.hooks.onTournamentUpdate?.(t.id);
  }

  /** 이동자 선정(다음 BB — TDA Rule 11) 후 한 명을 이동 */
  private moveOnePlayer(t: TournamentRuntime, fromRoomId: string, toRoomId: string): void {
    const engine = this.roomManager.getRoom(fromRoomId)?.engine;
    const destEngine = this.roomManager.getRoom(toRoomId)?.engine;
    if (!engine || !destEngine) return;

    const alive = engine.state.players.filter(
      p => p.chips > 0 && !p.finishPlace && !p.pendingRemoval,
    );
    if (alive.length === 0) return;
    const nextBbId = engine.predictNextBigBlindId();
    const destUsed = new Set(getUsedCharacterIds(destEngine));
    const ordered = [
      ...alive.filter(p => p.id === nextBbId),
      ...alive.filter(p => p.id !== nextBbId),
    ];
    // 봇 캐릭터가 목적지와 중복되면 차선 후보 — 전원 충돌이면 중복을 허용한다 (16캐릭터 현실 제약)
    const mover = ordered.find(
      p => p.type === 'human' || !destUsed.has(p.personalityId ?? ''),
    ) ?? ordered[0];
    this.moveSeat(t, fromRoomId, toRoomId, mover.id);
  }

  private moveSeat(
    t: TournamentRuntime,
    fromRoomId: string,
    toRoomId: string,
    playerId: string,
    resumeDestination = true,
  ): void {
    const destRoom = this.roomManager.getRoom(toRoomId);
    if (!destRoom) return;
    let seatIndex = this.pickSeat(destRoom.engine, destRoom.config.maxPlayers);
    if (seatIndex === null && !destRoom.engine.state.isHandInProgress) {
      // 탈락 예약(pendingRemoval) 좌석이 자리를 막고 있으면 핸드 사이 한정으로 즉시 정리 —
      // 탈락 확정 스냅샷은 assignEliminations가 이미 브로드캐스트했다
      destRoom.engine.removePendingPlayers();
      seatIndex = this.pickSeat(destRoom.engine, destRoom.config.maxPlayers);
    }
    if (seatIndex === null) return;
    const engine = this.roomManager.getRoom(fromRoomId)?.engine;
    const mover = engine?.state.players.find(p => p.id === playerId);
    if (!mover) return;
    const isHuman = mover.type === 'human';

    if (!this.roomManager.transferMttSeat(fromRoomId, toRoomId, playerId, seatIndex)) return;
    eventLog.log('mtt-move', {
      data: { tournamentId: t.id, playerId, from: fromRoomId, to: toRoomId, seatIndex },
    });
    if (isHuman) {
      this.hooks.onPlayerMoved?.({
        tournamentId: t.id,
        playerId,
        fromRoomId,
        toRoomId,
      });
    }
    // 목적지가 핸드 사이면 재가동 (1인 고립 테이블 소생 경로)
    if (resumeDestination && !destRoom.engine.state.isHandInProgress) {
      this.roomManager.resumeRoom(toRoomId);
    }
  }

  /**
   * 새 좌석 배정 — "곧 BB가 되는 빈 좌석"(worst position, TDA Rule 11).
   * 현재 BB 좌석에서 좌석 순서상 가장 가까운 다음 빈 좌석을 고른다.
   */
  private pickSeat(engine: PokerEngine, maxPlayers: number): number | null {
    const occupied = new Set(engine.state.players.map(p => p.seatIndex));
    const empty: number[] = [];
    for (let seat = 0; seat < maxPlayers; seat++) {
      if (!occupied.has(seat)) empty.push(seat);
    }
    if (empty.length === 0) return null;
    const bbSeat = engine.state.players.find(
      p => p.id === engine.state.bigBlindId,
    )?.seatIndex;
    if (bbSeat === undefined) return empty[0];
    empty.sort(
      (a, b) =>
        ((a - bbSeat + maxPlayers) % maxPlayers) - ((b - bbSeat + maxPlayers) % maxPlayers),
    );
    return empty[0];
  }

  // --- hand-for-hand ---

  private activateH4h(t: TournamentRuntime): void {
    t.h4h.active = true;
    t.h4h.armed.clear();
    t.h4h.busts = [];
    for (const roomId of t.tables.keys()) {
      this.roomManager.postSystemChat(
        roomId,
        '⚔️ 버블입니다! 지금부터 모든 테이블이 같은 핸드를 진행합니다 (hand-for-hand).',
      );
    }
  }

  /** 다음 H4H 라운드가 열리기 전 모든 잔존 테이블의 다음 핸드를 먼저 동기적으로 막는다. */
  private enterH4hBarrier(t: TournamentRuntime): void {
    if (!t.h4h.active) this.activateH4h(t);
    this.batchTournamentPresentation(t, () => {
      for (const roomId of t.tables.keys()) {
        this.addHold(t, roomId, 'h4h-barrier');
      }
    });
    this.tryReleaseH4h(t);
  }

  /** 전 테이블이 핸드 사이가 되면 라운드 버스트 순위 확정 + 다음 동기화 핸드 무장 */
  private tryReleaseH4h(t: TournamentRuntime): void {
    if (!t.h4h.active) return;
    for (const roomId of t.tables.keys()) {
      const engine = this.roomManager.getRoom(roomId)?.engine;
      if (engine?.state.isHandInProgress) return; // 아직 도는 테이블이 있다 — 배리어 유지
    }

    const roundBusts = t.h4h.busts;
    t.h4h.busts = [];
    if (roundBusts.length > 0) {
      this.assignEliminations(t, roundBusts);
    }
    if (this.checkCompletion(t)) return;

    // 버블 붕괴가 파이널 정원 이하를 만들면 다음 H4H 라운드보다 병합 배리어가 우선한다.
    if (this.beginFinalFormation(t) || t.stage === 'final-forming') {
      t.h4h.active = false;
      t.h4h.armed.clear();
      this.batchTournamentPresentation(t, () => {
        for (const roomId of t.tables.keys()) {
          this.removeHold(t, roomId, 'h4h-barrier');
        }
      });
      this.finishFinalFormation(t);
      return;
    }

    // H4H 진입 시 최다 테이블이 아직 핸드 중이었다면 이 배리어 지점에서 처음 안전하게
    // 1대4→2대3 밸런싱할 수 있다. permit을 만들기 전에 반드시 재시도한다.
    if (t.tables.size > 1) {
      const anchor = [...this.aliveCounts(t).entries()]
        .sort((a, b) => b[1] - a[1])[0]?.[0];
      if (anchor) this.balanceAfterHand(t, anchor, true);
    }

    // 버블이 터졌으면 H4H 종료
    if (t.remaining <= paidPlaces(t.seatedCount)) {
      t.h4h.active = false;
      t.h4h.armed.clear();
      for (const roomId of t.tables.keys()) {
        this.roomManager.postSystemChat(
          roomId,
          '🎉 버블 종료! 남은 전원 입상이 확정됐습니다.',
        );
      }
    } else {
      t.h4h.armed = new Set(t.tables.keys());
    }

    this.batchTournamentPresentation(t, () => {
      for (const roomId of t.tables.keys()) {
        this.removeHold(t, roomId, 'h4h-barrier');
      }
    });
    // 배리어 해제 뒤 모든 유휴 테이블을 한 번씩만 재가동한다.
    for (const roomId of t.tables.keys()) {
      const engine = this.roomManager.getRoom(roomId)?.engine;
      if (engine && !engine.state.isHandInProgress) {
        this.resumeIfUnheld(t, roomId);
      }
    }
  }

  // --- 브레이크/시계 ---

  private addHold(
    t: TournamentRuntime,
    roomId: string,
    reason: InternalHoldReason,
  ): void {
    const reasons = t.holds.get(roomId) ?? new Set<InternalHoldReason>();
    if (reasons.has(reason)) return;
    reasons.add(reason);
    t.holds.set(roomId, reasons);
    this.syncTournamentPresentation(t, [roomId]);
  }

  private removeHold(
    t: TournamentRuntime,
    roomId: string,
    reason: InternalHoldReason,
  ): void {
    const reasons = t.holds.get(roomId);
    if (!reasons?.has(reason)) return;
    reasons.delete(reason);
    if (reasons.size === 0) t.holds.delete(roomId);
    this.syncTournamentPresentation(t, [roomId]);
  }

  private hasHolds(t: TournamentRuntime, roomId: string): boolean {
    return (t.holds.get(roomId)?.size ?? 0) > 0;
  }

  private resumeIfUnheld(t: TournamentRuntime, roomId: string): void {
    if (!this.hasHolds(t, roomId)) {
      this.roomManager.resumeMttRoomAfterPresentation(roomId);
    }
  }

  private publicHoldReasons(
    t: TournamentRuntime,
    roomId?: string,
  ): TournamentHoldReason[] {
    const reasons = new Set<TournamentHoldReason>();
    const roomReasons = roomId === undefined
      ? t.holds.values()
      : [t.holds.get(roomId) ?? new Set<InternalHoldReason>()];
    for (const entries of roomReasons) {
      for (const reason of entries) {
        if (reason !== 'setup' && reason !== 'complete') reasons.add(reason);
      }
    }
    return [...reasons].sort();
  }

  private presentationDeadline(t: TournamentRuntime): number | undefined {
    if (t.stageEndsAt !== undefined) return t.stageEndsAt;
    if (!this.publicHoldReasons(t).includes('scheduled-break')) return undefined;
    const pos = this.clockPos(t);
    return Number.isFinite(pos.segmentRemainingMs)
      ? (t.pausedAt ?? Date.now()) + pos.segmentRemainingMs
      : undefined;
  }

  /** 서버 권위 MTT 표시 상태를 모든 살아 있는 테이블에 동일한 시계 기준으로 미러한다. */
  private batchTournamentPresentation(
    t: TournamentRuntime,
    mutate: () => void,
  ): void {
    t.presentationBatchDepth += 1;
    try {
      mutate();
    } finally {
      t.presentationBatchDepth -= 1;
      if (t.presentationBatchDepth === 0 && t.presentationDirtyRooms.size > 0) {
        this.flushTournamentPresentation(t);
      }
    }
  }

  private syncTournamentPresentation(
    t: TournamentRuntime,
    roomIds: Iterable<string> = t.tables.keys(),
  ): void {
    for (const roomId of roomIds) t.presentationDirtyRooms.add(roomId);
    if (t.presentationBatchDepth === 0) this.flushTournamentPresentation(t);
  }

  private flushTournamentPresentation(t: TournamentRuntime): void {
    const dirtyRoomIds = [...t.presentationDirtyRooms];
    t.presentationDirtyRooms.clear();
    const pos = t.startedAt !== null && t.phase === 'running'
      ? this.clockPos(t)
      : null;
    const cur = pos ? mttLevelAt(t.structure, pos.levelIndex) : null;
    const next = pos ? t.structure.levels[pos.levelIndex + 1] ?? null : null;
    const clockDeadline = pos && Number.isFinite(pos.segmentRemainingMs)
      ? (t.pausedAt ?? Date.now()) + pos.segmentRemainingMs
      : 0;
    for (const roomId of t.tables.keys()) {
      const state = this.roomManager.getRoom(roomId)?.engine.state.tournament;
      if (!state) continue;
      state.fieldRemaining = t.remaining;
      state.stage = t.stage;
      state.holdReasons = this.publicHoldReasons(t, roomId);
      state.stageEndsAt = t.stageEndsAt
        ?? (state.holdReasons.includes('scheduled-break') ? clockDeadline : undefined);
      state.finalTheme = t.finalTheme;
      if (pos && cur) {
        state.level = pos.levelIndex + 1;
        state.smallBlind = cur.smallBlind;
        state.bigBlind = cur.bigBlind;
        state.ante = cur.ante;
        state.nextSmallBlind = next?.smallBlind ?? null;
        state.nextBigBlind = next?.bigBlind ?? null;
        state.levelEndsAt = clockDeadline;
      }
    }
    for (const roomId of dirtyRoomIds) {
      if (t.tables.has(roomId) && this.roomManager.getRoom(roomId)) {
        this.roomManager.broadcastRoom(roomId);
      }
    }
  }

  private armBreakResume(t: TournamentRuntime): void {
    const pos = this.clockPos(t);
    if (!pos.onBreak || !Number.isFinite(pos.segmentRemainingMs)) return;
    if (!t.breakAnnounced) {
      t.breakAnnounced = true;
      const minutes = Math.max(1, Math.round(pos.segmentRemainingMs / 60_000));
      for (const roomId of t.tables.keys()) {
        this.roomManager.postSystemChat(
          roomId,
          `☕ 휴식 시간! 약 ${minutes}분 후 게임이 재개됩니다.`,
        );
      }
    }
    if (t.breakTimer) return;
    t.breakTimer = setTimeout(() => {
      t.breakTimer = null;
      t.breakAnnounced = false;
      const releasedRoomIds = [...t.holds.keys()].filter(
        roomId => t.holds.get(roomId)?.has('scheduled-break'),
      );
      this.batchTournamentPresentation(t, () => {
        for (const roomId of releasedRoomIds) {
          this.removeHold(t, roomId, 'scheduled-break');
        }
      });
      for (const roomId of releasedRoomIds) {
        this.roomManager.postSystemChat(roomId, '휴식이 끝났어요 — 게임을 재개합니다!');
        this.resumeIfUnheld(t, roomId);
      }
      this.hooks.onTournamentUpdate?.(t.id);
    }, pos.segmentRemainingMs + 250);
  }

  private clockPos(t: TournamentRuntime) {
    // 일시정지 중엔 정지 시각을 기준으로 시계를 동결한다
    const nowRef = t.pausedAt ?? Date.now();
    const elapsed = t.startedAt === null ? 0 : nowRef - t.startedAt - t.pauseAccumMs;
    return mttClockAt(t.structure, elapsed);
  }

  /** 엔진에 현재 레벨 반영 (변화가 있을 때만) + 테이블 채팅 공지 */
  private pushLevel(
    t: TournamentRuntime,
    engine: PokerEngine,
    pos: ReturnType<typeof mttClockAt>,
    initial: boolean,
  ): void {
    const state = engine.state.tournament;
    if (!state) return;
    const level = pos.levelIndex + 1;
    if (!initial && state.level === level && state.levelEndsAt !== 0) return;
    const cur = mttLevelAt(t.structure, pos.levelIndex);
    const next = t.structure.levels[pos.levelIndex + 1] ?? null;
    const levelEndsAt = Number.isFinite(pos.segmentRemainingMs)
      ? Date.now() + pos.segmentRemainingMs
      : 0;
    const changed = state.level !== level;
    engine.setTournamentLevel(
      level,
      cur.smallBlind,
      cur.bigBlind,
      next?.smallBlind ?? null,
      next?.bigBlind ?? null,
      levelEndsAt,
      cur.ante,
    );
    if (changed && !initial) {
      const anteText = cur.ante > 0 ? ` · 앤티 ${cur.ante}` : '';
      this.roomManager.postSystemChat(
        engine.state.id,
        `블라인드 인상 — 레벨 ${level}: ${cur.smallBlind}/${cur.bigBlind}${anteText}`,
      );
    }
  }

  // --- 내부 ---

  private byTable(roomId: string): TournamentRuntime | undefined {
    const tid = this.byRoom.get(roomId);
    return tid ? this.tournaments.get(tid) : undefined;
  }

  /** 1인당 상금 풀 기여 단위 — practice는 시작 스택(표시용), wallet은 바이인(리얼 칩) */
  private entryUnit(t: TournamentRuntime): number {
    return t.config.economyMode === 'wallet'
      ? t.config.entryBuyIn ?? 0
      : t.structure.startingStack;
  }

  private standings(t: TournamentRuntime): TournamentStandingRow[] {
    const rows: TournamentStandingRow[] = [];
    for (const [roomId, meta] of t.tables) {
      const engine = this.roomManager.getRoom(roomId)?.engine;
      if (!engine) continue;
      for (const p of engine.state.players) {
        if (!this.isAlive(engine, p)) continue;
        rows.push({
          playerId: p.id,
          name: p.name,
          // 진행 중 핸드의 기여분(팟 몫)을 포함해 표시 — 올인 생존자가 0으로 보이지 않게
          chips: p.chips + (engine.state.isHandInProgress ? p.totalContributed : 0),
          tableNo: meta.no,
          place: null,
          prize: 0,
        });
      }
    }
    rows.sort((a, b) => b.chips - a.chips);
    const finished = [...t.results]
      .sort((a, b) => a.place - b.place)
      .map(r => ({
        playerId: r.playerId,
        name: r.name,
        chips: 0,
        tableNo: null,
        place: r.place,
        prize: r.prize,
      }));
    // 생존자(칩 순) 다음에 확정 순위 (우승자가 확정되면 맨 앞)
    return t.phase === 'completed' ? finished : [...rows, ...finished];
  }

  private toSummary(t: TournamentRuntime, forPlayerId?: string): TournamentSummary {
    let myTableRoomId: string | undefined;
    if (forPlayerId && t.phase === 'running') {
      for (const roomId of t.tables.keys()) {
        const engine = this.roomManager.getRoom(roomId)?.engine;
        if (engine?.state.players.some(p => p.id === forPlayerId && !p.pendingRemoval)) {
          myTableRoomId = roomId;
          break;
        }
      }
    }
    const clockLevel = t.startedAt !== null && t.phase === 'running'
      ? this.clockPos(t).levelIndex + 1
      : 1;
    return {
      id: t.id,
      name: t.config.name,
      phase: t.phase,
      speed: t.config.speed,
      entrantCount: t.phase === 'registering' ? t.entrants.size : t.seatedCount,
      maxEntrants: t.config.maxEntrants,
      tableSize: t.config.tableSize,
      remaining: t.remaining,
      tableCount: t.tables.size,
      prizePool: t.phase === 'registering'
        ? (t.config.botFill ? t.config.maxEntrants : Math.max(t.entrants.size, 2))
          * this.entryUnit(t)
        : t.prizePool,
      startAt: t.config.startAt,
      startedAt: t.startedAt,
      botFill: t.config.botFill,
      hostId: t.config.hostId,
      level: clockLevel,
      paused: t.pausedAt !== null,
      economyMode: t.config.economyMode ?? 'practice',
      entryBuyIn: t.config.entryBuyIn ?? 0,
      entryFee: t.config.entryFee ?? 0,
      stage: t.stage,
      holdReasons: this.publicHoldReasons(t),
      stageEndsAt: this.presentationDeadline(t),
      finalTheme: t.finalTheme,
      ...(forPlayerId
        ? { registered: t.entrants.has(forPlayerId) }
        : {}),
      ...(myTableRoomId ? { myTableRoomId } : {}),
    };
  }
}
