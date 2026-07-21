import type {
  CompletedHandRecord,
  HandHistoryDetail,
  HandHistorySummary,
} from '@/lib/poker/hand-history';
import type { Card, GameMode } from '@/lib/poker/types';
import type { PokerDatabase } from './persistence/database';

/** 프로필당 보존 핸드 수 상한 — 넘치면 오래된 것부터 정리 (GGPoker PokerCraft식 자동 기록의 저용량 변형) */
export const HAND_HISTORY_KEEP_PER_PROFILE = 500;

/** 테이블 정본 기록 전체 보존 상한 — 감사 창구는 최근성이 생명, 볼륨 폭주 방지 */
export const TABLE_HAND_KEEP = 10_000;

/** 백오피스 목록용 정본 핸드 요약 (홀카드 없음 — 상세 조회에서만 노출) */
export interface TableHandSummary {
  id: number;
  roomId: string;
  roomName: string;
  gameMode: GameMode;
  handNumber: number;
  bigBlind: number;
  potTotal: number;
  rake: number;
  showdown: boolean;
  playerCount: number;
  humanCount: number;
  board: Card[];
  /** 플레이어별 합산 수령액 (멀티팟은 합쳐서 1줄) */
  winners: Array<{ playerId: string; name: string; amount: number }>;
  playedAt: number;
}

/** 백오피스 상세 — 마스킹 전 전체 기록. 토큰 게이트 운영 API 밖으로 절대 내보내지 말 것 */
export interface TableHandDetail extends CompletedHandRecord {
  id: number;
  roomId: string;
  roomName: string;
  gameMode: GameMode;
  playedAt: number;
}

interface TableHandRow {
  id: unknown;
  room_id: unknown;
  room_name: unknown;
  game_mode: unknown;
  hand_number: unknown;
  big_blind: unknown;
  pot_total: unknown;
  rake: unknown;
  showdown: unknown;
  player_count: unknown;
  human_count: unknown;
  board: unknown;
  winners: unknown;
  played_at: unknown;
}

/**
 * 테이블 단위 정본 핸드 기록 (마이그레이션 v23 `table_hand`).
 * id가 사이트 전역 핸드 ID — 상용 포커룸(PokerStars Hand #N)과 같은 전역 유일 조인 키로,
 * CS 분쟁·콜루전 조사·버그 역추적이 전부 이 ID를 기준으로 이뤄진다.
 * detail은 전체 홀카드를 담으므로 조회 경로는 /api/admin/hands*(토큰 게이트)뿐이어야 한다.
 */
export class TableHandRepository {
  readonly #database: PokerDatabase;

  constructor(database: PokerDatabase) {
    this.#database = database;
  }

  /** 정본 기록 1건 삽입 — 부여된 전역 핸드 ID를 반환 */
  insert(input: {
    roomId: string;
    roomName: string;
    gameMode: GameMode;
    record: CompletedHandRecord;
    playedAt: number;
  }): number {
    const { record } = input;
    const humanCount = record.players.filter(p => p.type === 'human').length;
    const winnersByPlayer = new Map<string, number>();
    for (const winner of record.winners) {
      winnersByPlayer.set(
        winner.playerId,
        (winnersByPlayer.get(winner.playerId) ?? 0) + winner.amount,
      );
    }
    const winners = [...winnersByPlayer.entries()].map(([playerId, amount]) => ({
      playerId,
      name: record.players.find(p => p.id === playerId)?.name ?? playerId,
      amount,
    }));
    const result = this.#database.db.prepare(`
      INSERT INTO table_hand (
        room_id, room_name, game_mode, hand_number, big_blind,
        pot_total, rake, showdown, player_count, human_count,
        board, winners, detail, played_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      input.roomId,
      input.roomName,
      input.gameMode,
      record.handNumber,
      record.bigBlind,
      record.potTotal,
      record.rake,
      record.showdown ? 1 : 0,
      record.players.length,
      humanCount,
      JSON.stringify(record.board),
      JSON.stringify(winners),
      JSON.stringify(record),
      input.playedAt,
    );
    return Number(result.lastInsertRowid);
  }

  /** 최신순 목록 — 방 필터 + before(id) 커서 페이지네이션 */
  list(opts: { roomId?: string; limit?: number; beforeId?: number } = {}): TableHandSummary[] {
    const limit = Math.min(Math.max(opts.limit ?? 50, 1), 200);
    const conditions: string[] = [];
    const params: (string | number)[] = [];
    if (opts.roomId) {
      conditions.push('room_id = ?');
      params.push(opts.roomId);
    }
    if (opts.beforeId !== undefined && Number.isSafeInteger(opts.beforeId)) {
      conditions.push('id < ?');
      params.push(opts.beforeId);
    }
    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const rows = this.#database.db.prepare(`
      SELECT id, room_id, room_name, game_mode, hand_number, big_blind,
             pot_total, rake, showdown, player_count, human_count,
             board, winners, played_at
      FROM table_hand ${where}
      ORDER BY id DESC LIMIT ?
    `).all(...params, limit) as unknown as TableHandRow[];
    return rows.map(row => ({
      id: Number(row.id),
      roomId: String(row.room_id),
      roomName: String(row.room_name),
      gameMode: String(row.game_mode) as GameMode,
      handNumber: Number(row.hand_number),
      bigBlind: Number(row.big_blind),
      potTotal: Number(row.pot_total),
      rake: Number(row.rake),
      showdown: Number(row.showdown) === 1,
      playerCount: Number(row.player_count),
      humanCount: Number(row.human_count),
      board: JSON.parse(String(row.board)) as Card[],
      winners: JSON.parse(String(row.winners)) as TableHandSummary['winners'],
      playedAt: Number(row.played_at),
    }));
  }

  /** 전역 핸드 ID로 정본 상세 조회 (전체 홀카드 포함 — 운영 전용) */
  getDetail(id: number): TableHandDetail | null {
    const row = this.#database.db.prepare(`
      SELECT id, room_id, room_name, game_mode, detail, played_at
      FROM table_hand WHERE id = ?
    `).get(id) as unknown as {
      id: unknown; room_id: unknown; room_name: unknown;
      game_mode: unknown; detail: unknown; played_at: unknown;
    } | undefined;
    if (!row) return null;
    return {
      ...(JSON.parse(String(row.detail)) as CompletedHandRecord),
      id: Number(row.id),
      roomId: String(row.room_id),
      roomName: String(row.room_name),
      gameMode: String(row.game_mode) as GameMode,
      playedAt: Number(row.played_at),
    };
  }

  count(): number {
    const row = this.#database.db.prepare(
      'SELECT COUNT(*) AS n FROM table_hand',
    ).get() as { n: number };
    return row.n;
  }

  /** 최근 windowMs 동안의 핸드 수/레이크 합계 (백오피스 재무 지표) */
  statsSince(since: number): { hands: number; rake: number; potTotal: number } {
    const row = this.#database.db.prepare(`
      SELECT COUNT(*) AS hands,
             COALESCE(SUM(rake), 0) AS rake,
             COALESCE(SUM(pot_total), 0) AS pot_total
      FROM table_hand WHERE played_at >= ?
    `).get(since) as { hands: number; rake: number; pot_total: number };
    return { hands: row.hands, rake: row.rake, potTotal: row.pot_total };
  }

  /** 보존 상한 초과분을 오래된 것부터 정리 */
  prune(keep: number = TABLE_HAND_KEEP): void {
    this.#database.db.prepare(`
      DELETE FROM table_hand WHERE id NOT IN (
        SELECT id FROM table_hand ORDER BY id DESC LIMIT ?
      )
    `).run(keep);
  }
}

interface SummaryRow {
  id: unknown;
  played_at: unknown;
  room_name: unknown;
  game_mode: unknown;
  big_blind: unknown;
  hand_number: unknown;
  profit: unknown;
  hero_cards: unknown;
  board: unknown;
}

export class HandHistoryRepository {
  readonly #database: PokerDatabase;

  constructor(database: PokerDatabase) {
    this.#database = database;
  }

  insert(input: {
    profileId: string;
    roomId: string;
    roomName: string;
    gameMode: GameMode;
    handNumber: number;
    bigBlind: number;
    profit: number;
    heroCards: Card[];
    board: Card[];
    detail: HandHistoryDetail;
    playedAt: number;
    /** 전역 핸드 ID (table_hand 정본 링크) — 정본 저장 실패 시 null */
    tableHandId?: number | null;
  }): void {
    this.#database.db.prepare(`
      INSERT INTO hand_history (
        profile_id, room_id, room_name, game_mode, hand_number,
        big_blind, profit, hero_cards, board, detail, played_at, table_hand_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      input.profileId,
      input.roomId,
      input.roomName,
      input.gameMode,
      input.handNumber,
      input.bigBlind,
      input.profit,
      JSON.stringify(input.heroCards),
      JSON.stringify(input.board),
      JSON.stringify(input.detail),
      input.playedAt,
      input.tableHandId ?? null,
    );
  }

  /** 보존 상한 초과분(오래된 것부터) 정리 */
  prune(profileId: string, keep: number): void {
    this.#database.db.prepare(`
      DELETE FROM hand_history
      WHERE profile_id = ? AND id NOT IN (
        SELECT id FROM hand_history
        WHERE profile_id = ? ORDER BY id DESC LIMIT ?
      )
    `).run(profileId, profileId, keep);
  }

  listByProfile(
    profileId: string,
    limit: number,
    beforeId?: number,
  ): HandHistorySummary[] {
    const rows = (beforeId === undefined
      ? this.#database.db.prepare(`
          SELECT id, played_at, room_name, game_mode, big_blind,
                 hand_number, profit, hero_cards, board
          FROM hand_history
          WHERE profile_id = ? ORDER BY id DESC LIMIT ?
        `).all(profileId, limit)
      : this.#database.db.prepare(`
          SELECT id, played_at, room_name, game_mode, big_blind,
                 hand_number, profit, hero_cards, board
          FROM hand_history
          WHERE profile_id = ? AND id < ? ORDER BY id DESC LIMIT ?
        `).all(profileId, beforeId, limit)) as unknown as SummaryRow[];
    return rows.map(row => ({
      id: Number(row.id),
      playedAt: Number(row.played_at),
      roomName: String(row.room_name),
      gameMode: String(row.game_mode) as GameMode,
      bigBlind: Number(row.big_blind),
      handNumber: Number(row.hand_number),
      profit: Number(row.profit),
      heroCards: JSON.parse(String(row.hero_cards)) as Card[],
      board: JSON.parse(String(row.board)) as Card[],
    }));
  }

  /** 본인 소유 핸드만 조회 — 소유가 다르면 null (존재 여부를 구분해 노출하지 않는다) */
  getDetail(id: number, profileId: string): (HandHistoryDetail & { id: number }) | null {
    const row = this.#database.db.prepare(`
      SELECT id, detail FROM hand_history WHERE id = ? AND profile_id = ?
    `).get(id, profileId) as unknown as { id: unknown; detail: unknown } | undefined;
    if (!row) return null;
    return {
      ...(JSON.parse(String(row.detail)) as HandHistoryDetail),
      id: Number(row.id),
    };
  }

  countByProfile(profileId: string): number {
    const row = this.#database.db.prepare(`
      SELECT COUNT(*) AS count FROM hand_history WHERE profile_id = ?
    `).get(profileId) as unknown as { count: number };
    return row.count;
  }
}

/**
 * 완료 핸드를 참여 휴먼(프로필)별 "히어로 관점"으로 마스킹해 저장한다.
 * 마스킹 계약: 상대 홀카드는 revealed(경합 쇼다운/올인 런아웃 공개)일 때만 남기고 null.
 * 이 계약은 getPublicState의 실시간 공개 규칙과 동일해야 한다 — 히스토리가 더 보여주면
 * "히스토리로 머킹 패 훔쳐보기"가 된다.
 */
export class HandHistoryService {
  readonly #repository: HandHistoryRepository;
  readonly #tableHands: TableHandRepository | null;
  readonly #keep: number;
  readonly #keepTableHands: number;
  readonly #now: () => number;

  constructor(
    repository: HandHistoryRepository,
    options: {
      keepPerProfile?: number;
      now?: () => number;
      /** 테이블 정본 기록 저장소 — 없으면 개인 히스토리만 남긴다 (기존 동작) */
      tableHands?: TableHandRepository;
      keepTableHands?: number;
    } = {},
  ) {
    this.#repository = repository;
    this.#tableHands = options.tableHands ?? null;
    this.#keep = options.keepPerProfile ?? HAND_HISTORY_KEEP_PER_PROFILE;
    this.#keepTableHands = options.keepTableHands ?? TABLE_HAND_KEEP;
    this.#now = options.now ?? Date.now;
  }

  recordCompletedHand(input: {
    roomId: string;
    roomName: string;
    gameMode: GameMode;
    record: CompletedHandRecord;
  }): void {
    const playedAt = this.#now();
    // 정본을 먼저 기록해 전역 핸드 ID를 확보 — 개인 기록이 이 ID를 링크한다.
    // 정본 저장 실패는 개인 기록을 막지 않는다 (tableHandId=null로 진행).
    let tableHandId: number | null = null;
    if (this.#tableHands) {
      try {
        tableHandId = this.#tableHands.insert({
          roomId: input.roomId,
          roomName: input.roomName,
          gameMode: input.gameMode,
          record: input.record,
          playedAt,
        });
        this.#tableHands.prune(this.#keepTableHands);
      } catch {
        tableHandId = null;
      }
    }
    for (const hero of input.record.players) {
      if (hero.type !== 'human') continue;
      const detail: HandHistoryDetail = {
        ...input.record,
        heroId: hero.id,
        roomName: input.roomName,
        gameMode: input.gameMode,
        playedAt,
        tableHandId,
        players: input.record.players.map(p => ({
          ...p,
          holeCards: p.id === hero.id || p.revealed
            ? p.holeCards
            : null,
        })),
      };
      this.#repository.insert({
        profileId: hero.id,
        roomId: input.roomId,
        roomName: input.roomName,
        gameMode: input.gameMode,
        handNumber: input.record.handNumber,
        bigBlind: input.record.bigBlind,
        profit: hero.profit,
        heroCards: hero.holeCards ?? [],
        board: input.record.board,
        detail,
        playedAt,
        tableHandId,
      });
      this.#repository.prune(hero.id, this.#keep);
    }
  }
}
