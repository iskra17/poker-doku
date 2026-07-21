import type { LogEvent } from './event-log';
import type { PokerDatabase } from './persistence/database';

/**
 * 운영 이벤트 영속 로그 (SQLite `ops_event`).
 *
 * 인메모리 링 버퍼(event-log)는 재시작에 소멸하고 fly logs는 보관이 짧아, 장애를 사후에
 * 역추적할 수 없었다 (2026-07-21 접속 장애 — 429가 어디에도 안 남았음). 신호 이벤트만
 * 화이트리스트로 영속해 백오피스(/api/admin/events)에서 조회한다.
 *
 * 민감 정보 금지 규칙은 event-log와 동일: 세션 토큰 원문·방 비밀번호·홀카드 금지.
 */

/** 영속 대상 이벤트 타입 — 운영 신호만 (게임 플레이 이벤트는 링 버퍼로 충분) */
export const OPS_PERSIST_TYPES = new Set([
  'server-start',      // 재시작/배포 마커 — 장애 시각 상관관계의 기준점
  'http-reject',       // 레이트리밋/KDF 게이트 429
  'join-room:reject',  // 입장 거부
  'grace-expired',     // 재접속 유예 만료 (좌석 회수 여부 포함)
  'room-lost',
]);

/** settlementOk:false인 hand-end처럼 조건부로 영속할 이벤트 판정 */
export function shouldPersistOpsEvent(event: LogEvent): boolean {
  if (OPS_PERSIST_TYPES.has(event.type)) return true;
  if (event.type === 'hand-end') {
    return event.data?.settlementOk === false;
  }
  return false;
}

const MAX_ROWS = 50_000;
const PRUNE_BATCH_EVERY = 200; // N건 기록마다 1회 초과분 정리 (매 insert 정리 비용 회피)
const MAX_DATA_LENGTH = 8_000;

export interface OpsEventRow {
  id: number;
  at: number;
  type: string;
  roomId: string | null;
  playerId: string | null;
  data: Record<string, unknown>;
}

export class OpsEventRepository {
  private sinceLastPrune = 0;

  constructor(private readonly database: PokerDatabase) {}

  /** 기록 실패는 삼킨다 — 관측 로그가 게임 진행을 막으면 안 된다 */
  record(event: LogEvent): void {
    try {
      let data = JSON.stringify(event.data ?? {});
      if (data.length > MAX_DATA_LENGTH) {
        data = JSON.stringify({ truncated: true, head: data.slice(0, 2_000) });
      }
      this.database.db.prepare(`
        INSERT INTO ops_event (at, type, room_id, player_id, data)
        VALUES (?, ?, ?, ?, ?)
      `).run(
        event.t,
        event.type.slice(0, 64),
        event.roomId ?? null,
        event.playerId ?? null,
        data,
      );
      this.sinceLastPrune += 1;
      if (this.sinceLastPrune >= PRUNE_BATCH_EVERY) {
        this.sinceLastPrune = 0;
        this.prune();
      }
    } catch {
      // 관측 로그 저장 실패는 무시 (다음 이벤트에서 재시도)
    }
  }

  /** 최신순 조회 — before(id) 커서 페이지네이션 */
  recent(opts: { type?: string; limit?: number; before?: number } = {}): OpsEventRow[] {
    const limit = Math.min(Math.max(opts.limit ?? 100, 1), 500);
    const conditions: string[] = [];
    const params: (string | number)[] = [];
    if (opts.type) {
      conditions.push('type = ?');
      params.push(opts.type);
    }
    if (opts.before !== undefined && Number.isSafeInteger(opts.before)) {
      conditions.push('id < ?');
      params.push(opts.before);
    }
    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const rows = this.database.db.prepare(`
      SELECT id, at, type, room_id, player_id, data
      FROM ops_event ${where}
      ORDER BY id DESC LIMIT ?
    `).all(...params, limit) as Array<{
      id: number; at: number; type: string;
      room_id: string | null; player_id: string | null; data: string;
    }>;
    return rows.map(row => ({
      id: row.id,
      at: row.at,
      type: row.type,
      roomId: row.room_id,
      playerId: row.player_id,
      data: safeParse(row.data),
    }));
  }

  count(): number {
    const row = this.database.db.prepare(
      'SELECT COUNT(*) AS n FROM ops_event',
    ).get() as { n: number };
    return row.n;
  }

  /** 최대 행 수 초과분을 오래된 것부터 정리 */
  prune(maxRows: number = MAX_ROWS): number {
    const excess = this.count() - maxRows;
    if (excess <= 0) return 0;
    this.database.db.prepare(`
      DELETE FROM ops_event WHERE id IN (
        SELECT id FROM ops_event ORDER BY id ASC LIMIT ?
      )
    `).run(excess);
    return excess;
  }
}

function safeParse(text: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(text) as unknown;
    return typeof parsed === 'object' && parsed !== null
      ? parsed as Record<string, unknown>
      : {};
  } catch {
    return {};
  }
}
