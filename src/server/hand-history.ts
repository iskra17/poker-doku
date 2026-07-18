import type {
  CompletedHandRecord,
  HandHistoryDetail,
  HandHistorySummary,
} from '@/lib/poker/hand-history';
import type { Card, GameMode } from '@/lib/poker/types';
import type { PokerDatabase } from './persistence/database';

/** 프로필당 보존 핸드 수 상한 — 넘치면 오래된 것부터 정리 (GGPoker PokerCraft식 자동 기록의 저용량 변형) */
export const HAND_HISTORY_KEEP_PER_PROFILE = 500;

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
  }): void {
    this.#database.db.prepare(`
      INSERT INTO hand_history (
        profile_id, room_id, room_name, game_mode, hand_number,
        big_blind, profit, hero_cards, board, detail, played_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
  readonly #keep: number;
  readonly #now: () => number;

  constructor(
    repository: HandHistoryRepository,
    options: { keepPerProfile?: number; now?: () => number } = {},
  ) {
    this.#repository = repository;
    this.#keep = options.keepPerProfile ?? HAND_HISTORY_KEEP_PER_PROFILE;
    this.#now = options.now ?? Date.now;
  }

  recordCompletedHand(input: {
    roomId: string;
    roomName: string;
    gameMode: GameMode;
    record: CompletedHandRecord;
  }): void {
    const playedAt = this.#now();
    for (const hero of input.record.players) {
      if (hero.type !== 'human') continue;
      const detail: HandHistoryDetail = {
        ...input.record,
        heroId: hero.id,
        roomName: input.roomName,
        gameMode: input.gameMode,
        playedAt,
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
      });
      this.#repository.prune(hero.id, this.#keep);
    }
  }
}
