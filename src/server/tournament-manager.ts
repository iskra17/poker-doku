import { randomUUID } from 'node:crypto';
import type { PokerEngine } from '../lib/poker/engine';
import type { Player } from '../lib/poker/types';
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
}

type HoldReason = 'setup' | 'break' | 'h4h' | 'complete';

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
  pauseAccumMs: number; // Phase 2 일시정지 대비 (v1은 항상 0)
  entrants: Map<string, MttEntrant>;
  seatedCount: number; // 시작 확정 총 인원 (봇 포함)
  tables: Map<string, { no: number }>;
  results: MttResult[];
  remaining: number;
  prizePool: number;
  prizes: number[];
  held: Map<string, HoldReason>;
  h4h: { active: boolean; armed: Set<string>; busts: PendingBust[] };
  breakTimer: NodeJS.Timeout | null;
  breakAnnounced: boolean;
  finalAnnounced: boolean;
  startTimer: NodeJS.Timeout | null;
  cleanupTimer: NodeJS.Timeout | null;
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
      onHandComplete: roomId => this.onHandComplete(roomId),
      isHeld: roomId => this.isHeld(roomId),
      onPlayerLeave: (roomId, playerId) => this.onPlayerLeave(roomId, playerId),
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

    const id = `mtt-${Date.now()}-${randomUUID().slice(0, 8)}`;
    const t: TournamentRuntime = {
      id,
      config: { ...input, name, tableSize, maxEntrants },
      structure: MTT_STRUCTURES[input.speed],
      phase: 'registering',
      createdAt: Date.now(),
      startedAt: null,
      finishedAt: null,
      pauseAccumMs: 0,
      entrants: new Map(),
      seatedCount: 0,
      tables: new Map(),
      results: [],
      remaining: 0,
      prizePool: 0,
      prizes: [],
      held: new Map(),
      h4h: { active: false, armed: new Set(), busts: [] },
      breakTimer: null,
      breakAnnounced: false,
      finalAnnounced: false,
      startTimer: null,
      cleanupTimer: null,
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

  register(tournamentId: string, entrant: MttEntrant):
    'ok' | 'not-found' | 'closed' | 'full' | 'already' {
    const t = this.tournaments.get(tournamentId);
    if (!t) return 'not-found';
    if (t.phase !== 'registering') return 'closed';
    if (t.entrants.has(entrant.id)) return 'already';
    if (t.entrants.size >= t.config.maxEntrants) return 'full';
    t.entrants.set(entrant.id, { ...entrant, name: entrant.name.slice(0, 20) });
    this.hooks.onTournamentsChanged?.();
    this.hooks.onTournamentUpdate?.(tournamentId);
    return 'ok';
  }

  unregister(tournamentId: string, playerId: string): boolean {
    const t = this.tournaments.get(tournamentId);
    if (!t || t.phase !== 'registering') return false;
    const removed = t.entrants.delete(playerId);
    if (removed) {
      this.hooks.onTournamentsChanged?.();
      this.hooks.onTournamentUpdate?.(tournamentId);
    }
    return removed;
  }

  /** 호스트 수동 시작 */
  startTournament(tournamentId: string, requesterId: string):
    'ok' | 'not-found' | 'not-host' | 'not-registering' | 'not-enough' {
    const t = this.tournaments.get(tournamentId);
    if (!t) return 'not-found';
    if (t.config.hostId !== requesterId) return 'not-host';
    return this.attemptStart(t, requesterId);
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
      ? Math.max(t.entrants.size, 2) * t.structure.startingStack
      : t.prizePool;
    const previewEntrants = t.phase === 'registering'
      ? Math.max(
        t.entrants.size,
        t.config.botFill ? t.config.maxEntrants : t.entrants.size,
        2,
      )
      : t.seatedCount;
    const pool = t.phase === 'registering' && t.config.botFill
      ? t.config.maxEntrants * t.structure.startingStack
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
    for (const t of this.tournaments.values()) held += t.held.size;
    return { tournaments: this.tournaments.size, tables: this.byRoom.size, held };
  }

  shutdown(): void {
    for (const t of this.tournaments.values()) {
      if (t.startTimer) clearTimeout(t.startTimer);
      if (t.breakTimer) clearTimeout(t.breakTimer);
      if (t.cleanupTimer) clearTimeout(t.cleanupTimer);
    }
  }

  // --- 시작 ---

  private attemptStart(
    t: TournamentRuntime,
    requesterId: string | null,
  ): 'ok' | 'not-registering' | 'not-enough' {
    if (t.phase !== 'registering') return 'not-registering';
    if (t.startTimer) {
      clearTimeout(t.startTimer);
      t.startTimer = null;
    }

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
      if (requesterId === null) this.cancelTournament(t, 'not-enough');
      return 'not-enough';
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
      t.held.set(roomId, 'setup');
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
          if (engine.addPlayer(bot)) usedGlobal.push(bot.personalityId ?? '');
        }
      });
    }

    t.seatedCount = total;
    t.remaining = total;
    t.prizePool = total * t.structure.startingStack;
    t.prizes = computePayouts(t.prizePool, total);
    t.startedAt = Date.now();
    t.phase = 'running';

    const pos = this.clockPos(t);
    for (const roomId of roomIds) {
      const engine = this.roomManager.getRoom(roomId)?.engine;
      if (!engine) continue;
      engine.setTournamentField(total, t.prizes, false);
      this.pushLevel(t, engine, pos, true);
    }
    this.syncRemaining(t);

    // 착석 통지 (소켓 계층이 세션 전환 + room-joined) → 보류 해제 → 각 테이블 진행
    for (let i = 0; i < shuffled.length; i++) {
      this.hooks.onSeated?.({
        tournamentId: t.id,
        playerId: shuffled[i].id,
        roomId: roomIds[i % tableCount],
      });
    }
    for (const roomId of roomIds) {
      t.held.delete(roomId);
      this.roomManager.postSystemChat(
        roomId,
        `🏆 ${t.config.name} 시작! 참가 ${total}명 · 테이블 ${tableCount}개 · `
        + `${paidPlaces(total)}명 입상 · 우승 상금 ${t.prizes[0].toLocaleString()}`,
      );
      this.roomManager.resumeRoom(roomId);
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
    if (t.startTimer) { clearTimeout(t.startTimer); t.startTimer = null; }
    if (t.breakTimer) { clearTimeout(t.breakTimer); t.breakTimer = null; }
    for (const roomId of t.tables.keys()) {
      this.byRoom.delete(roomId);
      this.roomManager.disposeRoom(roomId, 'mtt-cancel');
    }
    t.tables.clear();
    t.held.clear();
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
    if (t.held.has(roomId)) return true;
    // H4H 중에는 배리어 해제 시 무장(armed)된 테이블만 다음 핸드를 시작할 수 있다
    if (t.h4h.active && !t.h4h.armed.has(roomId)) return true;
    return false;
  }

  private applyLevel(roomId: string, engine: PokerEngine): void {
    const t = this.byTable(roomId);
    if (!t || t.startedAt === null || t.phase !== 'running') return;
    // H4H 동기화 핸드 시작 — 무장 소모 (이 핸드가 끝나면 다시 배리어 대기)
    if (t.h4h.active) t.h4h.armed.delete(roomId);
    this.pushLevel(t, engine, this.clockPos(t), false);
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
      this.hold(t, roomId, 'h4h');
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

    // 버블(입상 1명 전) 도달 → hand-for-hand 발동 (테이블 2개 이상일 때만 의미)
    if (!t.h4h.active && t.tables.size > 1 && t.remaining === paidPlaces(t.seatedCount) + 1) {
      this.activateH4h(t);
      this.hold(t, roomId, 'h4h');
      this.tryReleaseH4h(t);
      return 'hold';
    }

    // 밸런싱/테이블 브레이크 — 이 테이블은 방금 핸드를 끝냈으므로 이동/해체 안전 구간
    const balance = this.balanceAfterHand(t, roomId);
    if (balance === 'gone') return 'gone';

    // 브레이크 — 시계가 휴식 구간이면 전 테이블이 핸드를 끝내는 대로 정지
    if (this.clockPos(t).onBreak) {
      this.hold(t, roomId, 'break');
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
    this.assignEliminations(t, [{
      roomId,
      playerId,
      name: player.name,
      handStartChips: player.handStartChips ?? player.chips,
    }]);
    this.checkCompletion(t);
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
    this.syncRemaining(t);
    for (const roomId of new Set(ordered.map(b => b.roomId))) {
      this.roomManager.broadcastRoom(roomId);
    }
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
    t.finishedAt = Date.now();
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
      this.hold(t, roomId, 'complete');
      const engine = this.roomManager.getRoom(roomId)?.engine;
      engine?.setTournamentField(t.seatedCount, t.prizes, true, results);
      this.roomManager.postSystemChat(roomId, `🏆 ${t.config.name} 종료! ${podium}`);
      // 종료 상태 브로드캐스트 (tryStartGame은 finished/held 게이트로 조기 반환)
      this.roomManager.resumeRoom(roomId);
      // 결과 확인을 위해 10분 보존 후 정리 (SnG retention 계약 재사용)
      this.roomManager.retainFinishedTournament(roomId);
    }

    eventLog.log('mtt-complete', {
      data: {
        tournamentId: t.id,
        entrants: t.seatedCount,
        champion: results[0]?.name,
        prizePool: t.prizePool,
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

  private balanceAfterHand(t: TournamentRuntime, roomId: string): 'kept' | 'gone' {
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

    // 개별 이동 — 이 테이블이 최다이고 최소 테이블과 격차 > 1이면 다음 BB 좌석을 이동
    counts = this.aliveCounts(t);
    const myCount = counts.get(roomId) ?? 0;
    let minRoom: string | null = null;
    let minCount = Infinity;
    for (const [rid, count] of counts) {
      if (rid === roomId) continue;
      if (count < minCount) { minCount = count; minRoom = rid; }
    }
    if (minRoom && myCount - minCount > 1) {
      this.moveOnePlayer(t, roomId, minRoom);
    }

    this.announceFinalIfReady(t);
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
    t.held.delete(roomId);
    t.h4h.armed.delete(roomId);
    this.roomManager.disposeRoom(roomId, 'mtt-break');
    for (const rid of t.tables.keys()) {
      this.roomManager.postSystemChat(rid, `테이블 ${tableNo ?? '?'}이(가) 해체되어 통합됐어요.`);
    }
    eventLog.log('mtt-table-break', {
      data: { tournamentId: t.id, tableNo, remainingTables: t.tables.size },
    });
    this.announceFinalIfReady(t);
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
    if (!destRoom.engine.state.isHandInProgress) {
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

  private announceFinalIfReady(t: TournamentRuntime): void {
    if (t.finalAnnounced || t.tables.size !== 1) return;
    if (t.remaining > t.config.tableSize) return;
    t.finalAnnounced = true;
    const [finalRoomId] = t.tables.keys();
    this.roomManager.postSystemChat(
      finalRoomId,
      `🔥 파이널 테이블! 남은 ${t.remaining}명이 우승 상금 ${t.prizes[0]?.toLocaleString() ?? 0}을 놓고 겨룹니다.`,
    );
    this.hooks.onTournamentUpdate?.(t.id);
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

    for (const roomId of [...t.held.keys()]) {
      if (t.held.get(roomId) === 'h4h') {
        t.held.delete(roomId);
        this.roomManager.resumeRoom(roomId);
      }
    }
    // 배리어 없이 유휴 상태로 대기하던 테이블(1인 고립 등)도 재가동
    if (t.h4h.active) {
      for (const roomId of t.tables.keys()) {
        const engine = this.roomManager.getRoom(roomId)?.engine;
        if (engine && !engine.state.isHandInProgress) {
          this.roomManager.resumeRoom(roomId);
        }
      }
    }
  }

  // --- 브레이크/시계 ---

  private hold(t: TournamentRuntime, roomId: string, reason: HoldReason): void {
    if (!t.held.has(roomId)) t.held.set(roomId, reason);
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
      for (const roomId of [...t.held.keys()]) {
        if (t.held.get(roomId) === 'break') {
          t.held.delete(roomId);
          this.roomManager.postSystemChat(roomId, '휴식이 끝났어요 — 게임을 재개합니다!');
          this.roomManager.resumeRoom(roomId);
        }
      }
      this.hooks.onTournamentUpdate?.(t.id);
    }, pos.segmentRemainingMs + 250);
  }

  private clockPos(t: TournamentRuntime) {
    const elapsed = t.startedAt === null ? 0 : Date.now() - t.startedAt - t.pauseAccumMs;
    return mttClockAt(t.structure, elapsed);
  }

  /** 각 테이블의 tournament 미러에 전체 잔존 인원을 반영 (HUD 표시용) */
  private syncRemaining(t: TournamentRuntime): void {
    for (const roomId of t.tables.keys()) {
      const state = this.roomManager.getRoom(roomId)?.engine.state.tournament;
      if (state) state.fieldRemaining = t.remaining;
    }
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
          * t.structure.startingStack
        : t.prizePool,
      startAt: t.config.startAt,
      startedAt: t.startedAt,
      botFill: t.config.botFill,
      hostId: t.config.hostId,
      level: clockLevel,
      ...(forPlayerId
        ? { registered: t.entrants.has(forPlayerId) }
        : {}),
      ...(myTableRoomId ? { myTableRoomId } : {}),
    };
  }
}
