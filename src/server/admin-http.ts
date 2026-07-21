import type { ServerResponse } from 'node:http';
import type { UrlWithParsedQuery } from 'node:url';
import { eventLog } from './event-log';
import type { OpsEventRepository } from './ops-log';
import type { PokerDatabase } from './persistence/database';

/**
 * 운영 백오피스 API — 토큰(`DEBUG_LOG_TOKEN`) 게이트, /admin 페이지가 짧은 주기로 폴링한다.
 *
 * - GET /api/admin/overview  — 접속자/방/프로세스/DB 집계 스냅샷
 * - GET /api/admin/profiles  — 익명 프로필 활동·칩 현황 (개인정보 없음 — 익명 별명뿐)
 * - GET /api/admin/events    — 영속 운영 이벤트 (ops_event, 커서 페이지네이션)
 *
 * 커스텀 서버 직결 (debug/log와 동일) — Next 라우트로 옮기면 번들 경계에서
 * 링 버퍼/런타임 참조가 쪼개진다.
 */

export interface AdminRoomSummary {
  id: string;
  name: string;
  mode: string;
  tableType: string;
  economyMode: string;
  handNumber: number;
  handInProgress: boolean;
  humans: number;
  bots: number;
  sittingOut: number;
  disconnected: number;
  potTotal: number;
  blinds: string;
}

export interface AdminRuntimeSnapshot {
  sessions: { sessions: number; sockets: number; grace: number };
  sessionList: Array<{
    playerId: string;
    connected: boolean;
    roomId: string | null;
    graceActive: boolean;
  }>;
  rooms: AdminRoomSummary[];
  roomRuntime: Readonly<Record<string, number>>;
}

export interface AdminHttpOptions {
  database: PokerDatabase;
  opsEvents: OpsEventRepository;
  /** 늦은 바인딩 — 소켓 런타임은 HTTP 핸들러 생성 이후에 준비된다 */
  runtime: () => AdminRuntimeSnapshot | null;
  debugToken?: string;
  now?: () => number;
}

function one(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function send(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  });
  res.end(JSON.stringify(body));
}

export function createAdminHttpHandler(options: AdminHttpOptions) {
  const now = options.now ?? Date.now;
  const startedAt = now();

  return (
    res: ServerResponse,
    pathname: string,
    query: UrlWithParsedQuery['query'],
  ): boolean => {
    if (!pathname.startsWith('/api/admin/')) return false;
    if (!options.debugToken || one(query.token) !== options.debugToken) {
      send(res, 403, { error: 'forbidden' });
      return true;
    }

    if (pathname === '/api/admin/overview') {
      const runtime = options.runtime();
      const db = options.database.db;
      const count = (table: string): number => (
        db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }
      ).n;
      send(res, 200, {
        at: now(),
        startedAt,
        uptimeMs: Math.round(process.uptime() * 1000),
        memoryRssMb: Math.round(process.memoryUsage().rss / 1024 / 1024),
        sessions: runtime?.sessions ?? null,
        rooms: runtime?.rooms ?? [],
        roomRuntime: runtime?.roomRuntime ?? null,
        eventLog: eventLog.stats(),
        db: {
          profiles: count('profiles'),
          feedback: count('feedback'),
          handHistory: count('hand_history'),
          opsEvents: options.opsEvents.count(),
        },
      });
      return true;
    }

    if (pathname === '/api/admin/profiles') {
      const runtime = options.runtime();
      const online = new Map(
        (runtime?.sessionList ?? []).map(s => [s.playerId, s]),
      );
      const limit = Math.min(
        Math.max(parseInt(one(query.limit) ?? '50', 10) || 50, 1),
        200,
      );
      const rows = options.database.db.prepare(`
        SELECT p.id, p.alias, p.avatar_id, p.created_at, p.last_seen_at, p.connect_count,
               COALESCE(w.balance, 0) AS balance,
               COALESCE((
                 SELECT amount FROM seat_escrows
                 WHERE profile_id = p.id AND status = 'active'
               ), 0) AS active_escrow
        FROM profiles p
        LEFT JOIN wallets w ON w.profile_id = p.id
        ORDER BY COALESCE(p.last_seen_at, p.created_at) DESC
        LIMIT ?
      `).all(limit) as Array<{
        id: string; alias: string; avatar_id: string; created_at: number;
        last_seen_at: number | null; connect_count: number;
        balance: number; active_escrow: number;
      }>;
      send(res, 200, {
        at: now(),
        count: rows.length,
        profiles: rows.map(row => {
          const session = online.get(row.id);
          return {
            id: row.id,
            alias: row.alias,
            avatarId: row.avatar_id,
            createdAt: row.created_at,
            lastSeenAt: row.last_seen_at,
            connectCount: row.connect_count,
            wallet: { balance: row.balance, activeEscrow: row.active_escrow },
            online: session?.connected ?? false,
            roomId: session?.roomId ?? null,
            graceActive: session?.graceActive ?? false,
          };
        }),
      });
      return true;
    }

    if (pathname === '/api/admin/events') {
      const before = one(query.before);
      send(res, 200, {
        at: now(),
        events: options.opsEvents.recent({
          type: one(query.type),
          limit: parseInt(one(query.limit) ?? '100', 10) || 100,
          before: before ? parseInt(before, 10) : undefined,
        }),
      });
      return true;
    }

    send(res, 404, { error: 'not-found' });
    return true;
  };
}
