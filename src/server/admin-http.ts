import type { IncomingMessage, ServerResponse } from 'node:http';
import type { UrlWithParsedQuery } from 'node:url';
import { eventLog } from './event-log';
import { GAME_CONFIG_GROUP_LABELS } from './game-config/registry';
import { GameConfigValidationError, type GameConfigService } from './game-config/service';
import type { HandHistoryRepository, TableHandRepository } from './hand-history';
import { drainRequest, HttpBodyError, readJsonBody } from './http-body';
import type { OpsEventRepository } from './ops-log';
import type { PokerDatabase } from './persistence/database';
import type { CreateTournamentRequest } from '../lib/realtime/protocol';
import { PAYOUT_PRESET_IDS } from '../lib/poker/payout-table';
import type {
  AdminTournamentView,
  TournamentDirectorAction,
} from './tournament-manager';
import type {
  TournamentActionResult,
  TournamentCreateResult,
  TournamentStartResult,
} from './tournament-command-service';

/**
 * 운영 백오피스 API — 토큰(`DEBUG_LOG_TOKEN`) 게이트, /admin 페이지가 짧은 주기로 폴링한다.
 *
 * - GET /api/admin/overview  — 접속자/방/프로세스/DB 집계 + 24h 핸드/레이크 + 최신 문의 커서
 * - GET /api/admin/profiles  — 익명 프로필 활동·칩 현황 (개인정보 없음 — 익명 별명뿐)
 * - GET /api/admin/events    — 영속 운영 이벤트 (ops_event, 커서 페이지네이션)
 * - GET /api/admin/hands     — 테이블 정본 핸드 목록 (room=/profile=/limit=/before=)
 * - GET /api/admin/hands/:id — 전역 핸드 ID로 정본 상세 (전체 홀카드 — 핸드 감사 전용)
 * - GET /api/admin/security  — 최근 신호 이벤트 타입별 집계 (hours=, 기본 24)
 * - GET/POST /api/admin/config — 런타임 게임 설정 조회/변경 (핫 컨피그 — 레지스트리 메타 포함,
 *   변경은 config-change 이벤트로 감사 기록)
 *
 * 커스텀 서버 직결 (debug/log와 동일) — Next 라우트로 옮기면 번들 경계에서
 * 링 버퍼/런타임 참조가 쪼개진다.
 * 정본 핸드 상세는 머킹 패까지 담으므로 이 토큰 게이트 밖으로 노출 금지.
 */

export interface AdminRoomSummary {
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
  /** MTT 토너먼트 전체 뷰 — /api/admin/tournaments (Phase 2) */
  tournaments?: AdminTournamentView[];
}

export interface AdminHttpOptions {
  database: PokerDatabase;
  opsEvents: OpsEventRepository;
  /** 테이블 정본 핸드 기록 — 핸드 감사 탭의 데이터 소스 */
  tableHands?: TableHandRepository;
  /** 개인(히어로 관점) 기록 — 프로필 드릴다운(profile= 필터)용 */
  handHistory?: HandHistoryRepository;
  /** 늦은 바인딩 — 소켓 런타임은 HTTP 핸들러 생성 이후에 준비된다 */
  runtime: () => AdminRuntimeSnapshot | null;
  /** 런타임 게임 설정 (핫 컨피그) — 게임 읽기 경로(live cfg)와 같은 인스턴스여야 한다 */
  gameConfig?: GameConfigService;
  tournamentCommands?: AdminTournamentCommands;
  debugToken?: string;
  now?: () => number;
}

export interface AdminTournamentCommands {
  create(input: CreateTournamentRequest): TournamentCreateResult;
  start(tournamentId: string): TournamentStartResult;
  act(tournamentId: string, action: TournamentDirectorAction): TournamentActionResult;
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseTournamentDraft(body: unknown, now: number): CreateTournamentRequest | null {
  if (
    !isRecord(body)
    || typeof body.name !== 'string'
    || body.name.trim().length === 0
    || body.name.trim().length > 30
    || !(body.speed === 'standard' || body.speed === 'turbo' || body.speed === 'hyper')
    || !Number.isInteger(body.maxEntrants)
    || (body.maxEntrants as number) < 8
    || (body.maxEntrants as number) > 48
    || typeof body.botFill !== 'boolean'
    || !(body.turnTime === 8 || body.turnTime === 15 || body.turnTime === 30)
    || !(body.economyMode === 'practice' || body.economyMode === 'wallet')
    || !PAYOUT_PRESET_IDS.includes(body.payoutPreset as never)
    || !(body.startAt === null
      || (typeof body.startAt === 'number'
        && body.startAt > now - 10_000
        && body.startAt < now + 24 * 60 * 60_000))
  ) {
    return null;
  }
  return {
    name: body.name.trim(),
    speed: body.speed,
    maxEntrants: body.maxEntrants as number,
    startAt: body.startAt as number | null,
    botFill: body.economyMode === 'wallet' ? false : body.botFill,
    turnTime: body.turnTime,
    economyMode: body.economyMode,
    payoutPreset: body.payoutPreset as (typeof PAYOUT_PRESET_IDS)[number],
  };
}

function parseTournamentAction(body: unknown): TournamentDirectorAction | 'start' | null {
  if (!isRecord(body)) return null;
  switch (body.action) {
    case 'start':
    case 'pause':
    case 'resume':
    case 'cancel':
      return body.action === 'start' ? 'start' : { kind: body.action };
    case 'set-level':
      return Number.isInteger(body.level)
        ? { kind: 'set-level', level: body.level as number }
        : null;
    case 'remove-player':
      return typeof body.playerId === 'string' && body.playerId.length > 0
        ? { kind: 'remove-player', playerId: body.playerId }
        : null;
    default:
      return null;
  }
}

export function createAdminHttpHandler(options: AdminHttpOptions) {
  const now = options.now ?? Date.now;
  const startedAt = now();

  return async (
    req: IncomingMessage,
    res: ServerResponse,
    pathname: string,
    query: UrlWithParsedQuery['query'],
  ): Promise<boolean> => {
    if (!pathname.startsWith('/api/admin/')) return false;
    if (!options.debugToken || one(query.token) !== options.debugToken) {
      drainRequest(req);
      send(res, 403, { error: 'forbidden' });
      return true;
    }

    if (pathname === '/api/admin/config') {
      await handleGameConfig(req, res, options, now);
      return true;
    }

    if (pathname === '/api/admin/tournaments' && req.method === 'POST') {
      if (!options.tournamentCommands) {
        drainRequest(req);
        send(res, 503, { error: 'unavailable' });
        return true;
      }
      let body: unknown;
      try {
        body = await readJsonBody(req);
      } catch (error) {
        send(res, 400, {
          error: 'invalid-body',
          message: error instanceof HttpBodyError && error.kind === 'too-large'
            ? '요청 본문이 너무 큽니다.'
            : '요청 본문이 올바르지 않습니다.',
        });
        return true;
      }
      const draft = parseTournamentDraft(body, now());
      if (!draft) {
        send(res, 400, { error: 'invalid-payload' });
        return true;
      }
      const result = options.tournamentCommands.create(draft);
      if (result.ok) {
        send(res, 201, { tournamentId: result.tournamentId });
        return true;
      }
      const status = result.reason === 'forbidden'
        ? 403
        : result.reason === 'invalid'
          ? 400
          : 409;
      send(res, status, { error: result.reason });
      return true;
    }

    const tournamentActionMatch = pathname.match(
      /^\/api\/admin\/tournaments\/([^/]{1,128})\/actions$/,
    );
    if (tournamentActionMatch && req.method === 'POST') {
      if (!options.tournamentCommands) {
        drainRequest(req);
        send(res, 503, { error: 'unavailable' });
        return true;
      }
      let body: unknown;
      try {
        body = await readJsonBody(req);
      } catch {
        send(res, 400, { error: 'invalid-body' });
        return true;
      }
      const action = parseTournamentAction(body);
      if (!action) {
        send(res, 400, { error: 'invalid-payload' });
        return true;
      }
      const tournamentId = decodeURIComponent(tournamentActionMatch[1]);
      const result = action === 'start'
        ? options.tournamentCommands.start(tournamentId)
        : options.tournamentCommands.act(tournamentId, action);
      if (result === 'ok') {
        send(res, 200, { ok: true });
        return true;
      }
      const status = result === 'forbidden'
        ? 403
        : result === 'not-found'
          ? 404
          : result === 'invalid'
            ? 400
            : 409;
      send(res, status, { error: result });
      return true;
    }

    // 나머지 라우트는 전부 조회 전용
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      drainRequest(req);
      send(res, 405, { error: 'method-not-allowed', allow: 'GET' });
      return true;
    }

    if (pathname === '/api/admin/overview') {
      const runtime = options.runtime();
      const db = options.database.db;
      const count = (table: string): number => (
        db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }
      ).n;
      const latestFeedbackId = (
        db.prepare('SELECT COALESCE(MAX(id), 0) AS n FROM feedback').get() as { n: number }
      ).n;
      // same-install 리텐션 — 익명 로컬 프로필 특성상 "사람"이 아니라 동일 설치본 기준.
      // 일일 활동은 streak_daily_progress(핸드 완료마다 갱신되는 프로필×KST일자)를 재사용 —
      // 별도 계측 테이블 없이 D1/W1(7일 내 복귀)·활성화 퍼널을 계산한다 (2026-07-22 레드팀 반영).
      const windowMs = 14 * 24 * 3_600_000;
      const cutoffEpoch = now() - windowMs;
      const cutoffDay = new Date(cutoffEpoch + 9 * 3_600_000).toISOString().slice(0, 10);
      const retention = {
        daily: db.prepare(`
          SELECT kst_date AS day,
                 COUNT(DISTINCT profile_id) AS actives,
                 COALESCE(SUM(hands), 0) AS hands
          FROM streak_daily_progress
          WHERE kst_date >= ?
          GROUP BY kst_date
          ORDER BY kst_date
        `).all(cutoffDay),
        cohorts: db.prepare(`
          SELECT cohort.day AS day,
                 COUNT(*) AS cohortSize,
                 COALESCE(SUM(EXISTS(
                   SELECT 1 FROM streak_daily_progress s
                   WHERE s.profile_id = cohort.id AND s.kst_date = date(cohort.day, '+1 day')
                 )), 0) AS returnedD1,
                 COALESCE(SUM(EXISTS(
                   SELECT 1 FROM streak_daily_progress s
                   WHERE s.profile_id = cohort.id
                     AND s.kst_date > cohort.day
                     AND s.kst_date <= date(cohort.day, '+7 day')
                 )), 0) AS returnedW1
          FROM (
            SELECT id, date(created_at / 1000, 'unixepoch', '+9 hours') AS day
            FROM profiles WHERE created_at >= ?
          ) AS cohort
          GROUP BY cohort.day
          ORDER BY cohort.day
        `).all(cutoffEpoch),
        activation: db.prepare(`
          SELECT COUNT(*) AS totalProfiles,
                 COALESCE(SUM(CASE WHEN pp.completed_hands >= 1 THEN 1 ELSE 0 END), 0) AS playedOneHand,
                 COALESCE(SUM(CASE WHEN pp.completed_hands >= 10 THEN 1 ELSE 0 END), 0) AS playedTenHands
          FROM profiles p
          LEFT JOIN progression_profiles pp ON pp.profile_id = p.id
        `).get(),
      };
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
          tableHands: options.tableHands?.count() ?? 0,
          opsEvents: options.opsEvents.count(),
        },
        // 문의 알림 커서 — feedback은 불변·미삭제라 (최신 id - 마지막 확인 id) = 새 문의 수
        latestFeedbackId,
        // 24h 재무 라이트 — 핸드 수/레이크/팟 (테이블 정본 집계)
        handStats24h: options.tableHands?.statsSince(now() - 24 * 3_600_000)
          ?? { hands: 0, rake: 0, potTotal: 0 },
        retention,
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

    if (pathname === '/api/admin/tournaments') {
      const runtime = options.runtime();
      send(res, 200, { at: now(), tournaments: runtime?.tournaments ?? [] });
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

    if (pathname === '/api/admin/hands') {
      const limit = Math.min(
        Math.max(parseInt(one(query.limit) ?? '50', 10) || 50, 1),
        200,
      );
      const beforeRaw = one(query.before);
      const beforeId = beforeRaw ? parseInt(beforeRaw, 10) : undefined;
      const profileId = one(query.profile);
      if (profileId) {
        // 프로필 드릴다운 — 개인(히어로 관점) 기록 요약. 홀카드는 히어로 것만 담겨 있다.
        send(res, 200, {
          at: now(),
          mode: 'profile',
          hands: options.handHistory?.listByProfile(profileId, limit, beforeId) ?? [],
        });
        return true;
      }
      send(res, 200, {
        at: now(),
        mode: 'table',
        hands: options.tableHands?.list({
          roomId: one(query.room),
          tournamentId: one(query.tournament),
          limit,
          beforeId,
        }) ?? [],
      });
      return true;
    }

    const handDetailMatch = pathname.match(/^\/api\/admin\/hands\/(\d{1,15})$/);
    if (handDetailMatch) {
      const detail = options.tableHands?.getDetail(parseInt(handDetailMatch[1], 10)) ?? null;
      if (!detail) {
        send(res, 404, { error: 'not-found' });
        return true;
      }
      // 마스킹 전 정본(전체 홀카드) — 토큰 게이트 뒤 핸드 감사 전용, 재노출 금지
      send(res, 200, { at: now(), hand: detail });
      return true;
    }

    if (pathname === '/api/admin/security') {
      const hours = Math.min(
        Math.max(parseInt(one(query.hours) ?? '24', 10) || 24, 1),
        24 * 7,
      );
      send(res, 200, {
        at: now(),
        windowHours: hours,
        counts: options.opsEvents.countByTypeSince(now() - hours * 3_600_000),
      });
      return true;
    }

    send(res, 404, { error: 'not-found' });
    return true;
  };
}

/**
 * 런타임 게임 설정 조회/변경 (핫 컨피그).
 * GET  → 레지스트리 메타 + 현재값/오버라이드 여부 (UI는 이 메타만 렌더 — 클라 번들에 레지스트리 미포함)
 * POST → { updates: { [key]: number | null } } (null = 기본값 복원). 전체 검증 통과 시에만 반영,
 *        diff를 응답하고 config-change 이벤트로 감사 기록(ops_event 영속).
 */
async function handleGameConfig(
  req: IncomingMessage,
  res: ServerResponse,
  options: AdminHttpOptions,
  now: () => number,
): Promise<void> {
  const service = options.gameConfig;
  if (!service) {
    drainRequest(req);
    send(res, 404, { error: 'not-found' });
    return;
  }

  if (req.method === 'GET' || req.method === 'HEAD') {
    send(res, 200, {
      at: now(),
      groupLabels: GAME_CONFIG_GROUP_LABELS,
      entries: service.snapshot(),
    });
    return;
  }

  if (req.method !== 'POST') {
    drainRequest(req);
    send(res, 405, { error: 'method-not-allowed', allow: 'GET, POST' });
    return;
  }

  let body: unknown;
  try {
    body = await readJsonBody(req);
  } catch (error) {
    send(res, 400, {
      error: 'invalid-body',
      message: error instanceof HttpBodyError && error.kind === 'too-large'
        ? '요청 본문이 너무 큽니다'
        : '요청 본문이 올바르지 않습니다 (application/json)',
    });
    return;
  }

  const updates = (body as { updates?: unknown } | null)?.updates;
  if (
    typeof updates !== 'object'
    || updates === null
    || Array.isArray(updates)
    || Object.keys(updates).length === 0
    || Object.values(updates).some(
      value => value !== null && typeof value !== 'number',
    )
  ) {
    send(res, 400, {
      error: 'invalid-body',
      message: 'updates에 { 설정키: 숫자 | null } 형태만 허용됩니다',
    });
    return;
  }

  try {
    const changes = service.set(updates as Record<string, number | null>);
    if (changes.length > 0) {
      // 감사 기록 — ops_event 화이트리스트(config-change)로 SQLite 영속
      eventLog.log('config-change', { data: { changes } });
    }
    send(res, 200, { at: now(), changes });
  } catch (error) {
    if (error instanceof GameConfigValidationError) {
      send(res, 400, { error: 'validation', errors: error.errors });
      return;
    }
    send(res, 500, { error: 'internal' });
  }
}
