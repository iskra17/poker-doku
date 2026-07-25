import type { IncomingMessage, ServerResponse } from 'node:http';
import type { UrlWithParsedQuery } from 'node:url';
import {
  AdminSessionError,
  type AdminPrincipal,
  type AdminSessionManager,
  isExactAdminOrigin,
  resolveAdminRequestOrigin,
} from './admin-session';
import { clientAddress } from './client-address';
import { eventLog } from './event-log';
import { FeedbackRepository } from './feedback-http';
import { GAME_CONFIG_GROUP_LABELS } from './game-config/registry';
import { GameConfigValidationError, type GameConfigService } from './game-config/service';
import type { HandHistoryRepository, TableHandRepository } from './hand-history';
import { drainRequest, HttpBodyError, readJsonBody } from './http-body';
import type { TransientHttpRateLimiter } from './http-rate-limit';
import type { OpsEventRepository } from './ops-log';
import type { PokerDatabase } from './persistence/database';
import {
  PromotionFundError,
  type PromotionFundRepository,
} from './promotion-fund-repository';
import type { CreateTournamentRequest } from '../lib/realtime/protocol';
import type {
  AdminTournamentView,
  TournamentDirectorAction,
} from './tournament-manager';
import type {
  PersistentTournamentAdminResult,
  PersistentTournamentAdminSnapshot,
  TournamentActionResult,
  TournamentCreateResult,
  TournamentStartResult,
} from './tournament-command-service';
import type {
  TournamentInstanceRecord,
  TournamentTemplateRecord,
} from './tournament-instance-repository';

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
  adminSessions: AdminSessionManager;
  promotionFunds: PromotionFundRepository;
  promotionFundRateLimiter: TransientHttpRateLimiter;
  production: boolean;
  now?: () => number;
}

export interface AdminTournamentCommands {
  /** Legacy live-only adapter kept during the v2 admin migration. */
  create?(input: CreateTournamentRequest): TournamentCreateResult;
  list?(at: number): PersistentTournamentAdminResult<PersistentTournamentAdminSnapshot>;
  createInstance?(
    input: unknown,
    at: number,
  ): PersistentTournamentAdminResult<{ instance: TournamentInstanceRecord }>;
  createTemplate?(
    input: unknown,
    at: number,
  ): PersistentTournamentAdminResult<{ template: TournamentTemplateRecord }>;
  patchTemplate?(
    id: string,
    revision: number,
    input: unknown,
    at: number,
  ): PersistentTournamentAdminResult<{ template: TournamentTemplateRecord }>;
  actTemplate?(
    id: string,
    revision: number,
    input: unknown,
    at: number,
  ): PersistentTournamentAdminResult<{
    template: TournamentTemplateRecord;
    generated?: number;
  }>;
  start(tournamentId: string): TournamentStartResult;
  act(tournamentId: string, action: TournamentDirectorAction): TournamentActionResult;
}

function one(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function send(
  res: ServerResponse,
  status: number,
  body: unknown,
  headers: Record<string, string> = {},
): void {
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    ...headers,
  });
  res.end(JSON.stringify(body));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function header(req: IncomingMessage, name: string): string | undefined {
  const value = req.headers[name];
  return Array.isArray(value) ? value[0] : value;
}

function auditPromotionFundAdjustment(input: {
  readonly principal: AdminPrincipal;
  readonly resultCode: string;
  readonly requestId?: string;
  readonly delta?: number;
  readonly reason?: string;
  readonly balanceAfter?: number;
  readonly replayed?: boolean;
}): void {
  eventLog.log('promotion-fund-adjust', {
    data: {
      actorKind: input.principal.kind,
      actorId: input.principal.id,
      resultCode: input.resultCode,
      ...(input.requestId === undefined
        ? {}
        : { requestId: input.requestId }),
      ...(input.delta === undefined ? {} : { delta: input.delta }),
      ...(input.reason === undefined ? {} : { reason: input.reason }),
      ...(input.balanceAfter === undefined
        ? {}
        : { balanceAfter: input.balanceAfter }),
      ...(input.replayed === undefined ? {} : { replayed: input.replayed }),
    },
  });
}

function boundedInteger(
  raw: string | undefined,
  fallback: number,
  min: number,
  max: number,
): number {
  if (raw === undefined || raw.trim() === '') return fallback;
  const parsed = Number(raw);
  return Number.isSafeInteger(parsed)
    ? Math.min(Math.max(parsed, min), max)
    : fallback;
}

function sendAdminSessionError(res: ServerResponse, error: unknown): void {
  if (!(error instanceof AdminSessionError)) {
    send(res, 500, { error: 'internal-error' });
    return;
  }
  const status = error.kind === 'unauthenticated'
    ? 401
    : error.kind === 'rate-limited'
      ? 429
      : 403;
  send(
    res,
    status,
    { error: error.kind },
    error.retryAfterMs === undefined
      ? {}
      : { 'retry-after': String(Math.max(1, Math.ceil(error.retryAfterMs / 1_000))) },
  );
}

async function handleAdminSession(
  req: IncomingMessage,
  res: ServerResponse,
  sessions: AdminSessionManager,
  production: boolean,
  now: () => number,
): Promise<void> {
  if (req.method === 'GET' || req.method === 'HEAD') {
    const view = sessions.getSessionView(req.headers.cookie, now());
    if (!view) {
      drainRequest(req);
      send(res, 401, { error: 'unauthenticated' });
      return;
    }
    send(res, 200, view);
    return;
  }

  if (req.method === 'POST') {
    const requestOrigin = resolveAdminRequestOrigin(req, production);
    if (!isExactAdminOrigin(header(req, 'origin'), requestOrigin ?? undefined)) {
      drainRequest(req);
      send(res, 403, { error: 'origin' });
      return;
    }
    let body: unknown;
    try {
      body = await readJsonBody(req);
    } catch {
      send(res, 400, { error: 'invalid-body' });
      return;
    }
    const rawToken = isRecord(body) && typeof body.token === 'string'
      ? body.token
      : null;
    if (!rawToken) {
      send(res, 400, { error: 'invalid-body' });
      return;
    }
    const result = sessions.login(rawToken, clientAddress(req), now());
    if (!result.ok) {
      const status = result.reason === 'rate-limited'
        ? 429
        : result.reason === 'unavailable'
          ? 503
          : 401;
      send(
        res,
        status,
        { error: result.reason },
        result.retryAfterMs === undefined
          ? {}
          : { 'retry-after': String(Math.max(1, Math.ceil(result.retryAfterMs / 1_000))) },
      );
      return;
    }
    send(
      res,
      201,
      {
        principal: result.principal,
        csrfToken: result.csrfToken,
        expiresAt: result.expiresAt,
      },
      { 'set-cookie': result.setCookie },
    );
    return;
  }

  if (req.method === 'DELETE') {
    try {
      sessions.requireMutation({
        cookieHeader: req.headers.cookie,
        csrfHeader: header(req, 'x-csrf-token'),
        origin: header(req, 'origin'),
        requestOrigin: resolveAdminRequestOrigin(req, production) ?? undefined,
        now: now(),
      });
    } catch (error) {
      drainRequest(req);
      sendAdminSessionError(res, error);
      return;
    }
    sessions.logout(req.headers.cookie);
    res.writeHead(204, {
      'cache-control': 'no-store',
      'set-cookie': sessions.clearCookie(),
    });
    res.end();
    return;
  }

  drainRequest(req);
  send(res, 405, {
    error: 'method-not-allowed',
    allow: 'GET, POST, DELETE',
  });
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

function isTournamentAdminPath(pathname: string): boolean {
  return pathname === '/api/admin/tournaments'
    || pathname === '/api/admin/tournament-templates'
    || pathname === '/api/admin/promotion-fund'
    || pathname === '/api/admin/promotion-fund/adjust'
    || pathname.startsWith('/api/admin/tournaments/')
    || pathname.startsWith('/api/admin/tournament-templates/');
}

function parseIfMatch(req: IncomingMessage): number | null {
  const raw = header(req, 'if-match');
  if (!raw || !/^[1-9]\d*$/.test(raw)) return null;
  const revision = Number(raw);
  return Number.isSafeInteger(revision) ? revision : null;
}

function persistentAdminStatus(
  result: { readonly ok: false; readonly code: string },
): number {
  if (result.code === 'forbidden') return 403;
  if (result.code === 'unavailable') return 503;
  if (result.code === 'not-found') return 404;
  if (
    result.code === 'revision-conflict'
    || result.code === 'idempotency-conflict'
    || result.code === 'promotion-insufficient'
    || result.code === 'conflict'
  ) {
    return 409;
  }
  return 400;
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
    if (pathname === '/api/admin/session') {
      await handleAdminSession(
        req,
        res,
        options.adminSessions,
        options.production,
        now,
      );
      return true;
    }
    const tournamentAdminPath = isTournamentAdminPath(pathname);
    const sendTournament = (
      status: number,
      body: Record<string, unknown>,
      headers: Record<string, string> = {},
    ): void => {
      send(res, status, { ...body, serverNow: now() }, headers);
    };

    let principal: AdminPrincipal;
    if (req.method === 'GET' || req.method === 'HEAD') {
      const authenticated = options.adminSessions.authenticate(
        req.headers.cookie,
        now(),
      );
      if (!authenticated) {
        drainRequest(req);
        if (tournamentAdminPath) {
          sendTournament(401, { error: 'unauthenticated' });
        } else {
          send(res, 401, { error: 'unauthenticated' });
        }
        return true;
      }
      principal = authenticated;
    } else {
      try {
        principal = options.adminSessions.requireMutation({
          cookieHeader: req.headers.cookie,
          csrfHeader: header(req, 'x-csrf-token'),
          origin: header(req, 'origin'),
          requestOrigin: resolveAdminRequestOrigin(req, options.production)
            ?? undefined,
          now: now(),
        });
      } catch (error) {
        drainRequest(req);
        if (tournamentAdminPath) {
          const status = error instanceof AdminSessionError
            ? error.kind === 'unauthenticated'
              ? 401
              : error.kind === 'rate-limited'
                ? 429
                : 403
            : 500;
          sendTournament(
            status,
            {
              error: error instanceof AdminSessionError
                ? error.kind
                : 'internal-error',
            },
            error instanceof AdminSessionError
              && error.retryAfterMs !== undefined
              ? {
                  'retry-after': String(
                    Math.max(1, Math.ceil(error.retryAfterMs / 1_000)),
                  ),
                }
              : {},
          );
        } else {
          sendAdminSessionError(res, error);
        }
        return true;
      }
    }

    if (pathname === '/api/admin/promotion-fund') {
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        drainRequest(req);
        sendTournament(405, { error: 'method-not-allowed', allow: 'GET' });
        return true;
      }
      const limitRaw = one(query.limit);
      const limit = limitRaw === undefined ? 50 : Number(limitRaw);
      const before = one(query.before);
      if (
        !Number.isSafeInteger(limit)
        || limit < 1
        || limit > 100
        || (before !== undefined && before.length === 0)
      ) {
        sendTournament(400, { error: 'invalid-query' });
        return true;
      }
      try {
        sendTournament(
          200,
          {
            ...options.promotionFunds.getFundPage({
              limit,
              ...(before === undefined ? {} : { before }),
            }),
          },
        );
      } catch (error) {
        sendTournament(
          error instanceof PromotionFundError && error.code === 'invalid-input'
            ? 400
            : 500,
          {
            error: error instanceof PromotionFundError
              ? error.code
              : 'internal-error',
          },
        );
      }
      return true;
    }

    if (pathname === '/api/admin/promotion-fund/adjust') {
      if (req.method !== 'POST') {
        drainRequest(req);
        sendTournament(405, { error: 'method-not-allowed', allow: 'POST' });
        return true;
      }
      if (!options.promotionFundRateLimiter.allow(
        'promotionFundAdjust',
        clientAddress(req),
      )) {
        drainRequest(req);
        auditPromotionFundAdjustment({
          principal,
          resultCode: 'rate-limited',
        });
        sendTournament(429, { error: 'rate-limited' });
        return true;
      }
      let body: unknown;
      try {
        body = await readJsonBody(req);
      } catch {
        auditPromotionFundAdjustment({
          principal,
          resultCode: 'invalid-body',
        });
        sendTournament(400, { error: 'invalid-body' });
        return true;
      }
      if (
        !isRecord(body)
        || typeof body.requestId !== 'string'
        || !Number.isSafeInteger(body.delta)
        || typeof body.reason !== 'string'
      ) {
        auditPromotionFundAdjustment({
          principal,
          resultCode: 'invalid-input',
          ...(isRecord(body) && typeof body.requestId === 'string'
            ? { requestId: body.requestId }
            : {}),
          ...(isRecord(body) && Number.isSafeInteger(body.delta)
            ? { delta: body.delta as number }
            : {}),
        });
        sendTournament(400, { error: 'invalid-body' });
        return true;
      }
      try {
        const adjustment = options.promotionFunds.adjustFund({
          requestId: body.requestId,
          delta: body.delta as number,
          reason: body.reason,
          actor: { kind: 'backoffice-admin', id: principal.id },
          at: now(),
        });
        auditPromotionFundAdjustment({
          principal,
          resultCode: adjustment.replayed ? 'replayed' : 'ok',
          requestId: adjustment.ledger.idempotencyKey,
          delta: adjustment.ledger.delta,
          reason: adjustment.ledger.reason,
          balanceAfter: adjustment.ledger.balanceAfter,
          replayed: adjustment.replayed,
        });
        sendTournament(200, { ...adjustment });
      } catch (error) {
        if (error instanceof PromotionFundError) {
          auditPromotionFundAdjustment({
            principal,
            resultCode: error.code,
            requestId: body.requestId,
            delta: body.delta as number,
          });
          const status = error.code === 'promotion-insufficient'
            ? 409
            : error.code === 'invalid-input'
              ? 400
              : error.code === 'idempotency-conflict'
                ? 409
                : 500;
          sendTournament(status, { error: error.code });
        } else {
          auditPromotionFundAdjustment({
            principal,
            resultCode: 'internal-error',
            requestId: body.requestId,
            delta: body.delta as number,
          });
          sendTournament(500, { error: 'internal-error' });
        }
      }
      return true;
    }

    if (pathname === '/api/admin/feedback') {
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        drainRequest(req);
        send(res, 405, { error: 'method-not-allowed', allow: 'GET' });
        return true;
      }
      const limit = boundedInteger(one(query.limit), 50, 1, 200);
      const beforeRaw = one(query.before);
      const before = beforeRaw === undefined
        ? undefined
        : boundedInteger(beforeRaw, Number.NaN, 1, Number.MAX_SAFE_INTEGER);
      const items = new FeedbackRepository(options.database).list(
        limit,
        Number.isSafeInteger(before) ? before : undefined,
      );
      send(res, 200, { count: items.length, items });
      return true;
    }

    if (pathname === '/api/admin/config') {
      await handleGameConfig(req, res, options, now);
      return true;
    }

    if (pathname === '/api/admin/tournaments' && req.method === 'POST') {
      if (
        !options.tournamentCommands?.createInstance
        && !options.tournamentCommands?.create
      ) {
        drainRequest(req);
        sendTournament(503, { error: 'unavailable' });
        return true;
      }
      let body: unknown;
      try {
        body = await readJsonBody(req);
      } catch (error) {
        if (error instanceof HttpBodyError && error.kind === 'too-large') {
          sendTournament(413, { error: 'body-too-large' });
          return true;
        }
        sendTournament(400, {
          error: 'invalid-body',
          message: error instanceof HttpBodyError && error.kind === 'too-large'
            ? '요청 본문이 너무 큽니다.'
            : '요청 본문이 올바르지 않습니다.',
        });
        return true;
      }
      if (!options.tournamentCommands.createInstance) {
        const legacyResult = options.tournamentCommands.create!(
          body as CreateTournamentRequest,
        );
        if (legacyResult.ok) {
          sendTournament(201, { tournamentId: legacyResult.tournamentId });
        } else {
          const status = legacyResult.reason === 'forbidden'
            ? 403
            : legacyResult.reason === 'invalid'
              ? 400
              : 409;
          sendTournament(status, { error: legacyResult.reason });
        }
        return true;
      }
      const result = options.tournamentCommands.createInstance(body, now());
      if (result.ok) {
        sendTournament(201, {
          tournamentId: result.instance.id,
          instance: result.instance,
        });
        return true;
      }
      sendTournament(persistentAdminStatus(result), {
        error: result.code,
        ...(result.actualRevision === undefined
          ? {}
          : { actualRevision: result.actualRevision }),
      });
      return true;
    }

    if (
      pathname === '/api/admin/tournament-templates'
      && req.method === 'POST'
    ) {
      if (!options.tournamentCommands?.createTemplate) {
        drainRequest(req);
        sendTournament(503, { error: 'unavailable' });
        return true;
      }
      let body: unknown;
      try {
        body = await readJsonBody(req);
      } catch (error) {
        const tooLarge = error instanceof HttpBodyError
          && error.kind === 'too-large';
        sendTournament(tooLarge ? 413 : 400, {
          error: tooLarge ? 'body-too-large' : 'invalid-body',
        });
        return true;
      }
      const result = options.tournamentCommands.createTemplate(body, now());
      if (result.ok) {
        sendTournament(201, { template: result.template });
      } else {
        sendTournament(persistentAdminStatus(result), {
          error: result.code,
          ...(result.actualRevision === undefined
            ? {}
            : { actualRevision: result.actualRevision }),
        });
      }
      return true;
    }

    const templateMatch = pathname.match(
      /^\/api\/admin\/tournament-templates\/([^/]{1,128})$/,
    );
    if (templateMatch && req.method === 'PATCH') {
      if (!options.tournamentCommands?.patchTemplate) {
        drainRequest(req);
        sendTournament(503, { error: 'unavailable' });
        return true;
      }
      const revision = parseIfMatch(req);
      if (revision === null) {
        drainRequest(req);
        sendTournament(428, { error: 'precondition-required' });
        return true;
      }
      let body: unknown;
      try {
        body = await readJsonBody(req);
      } catch (error) {
        const tooLarge = error instanceof HttpBodyError
          && error.kind === 'too-large';
        sendTournament(tooLarge ? 413 : 400, {
          error: tooLarge ? 'body-too-large' : 'invalid-body',
        });
        return true;
      }
      const result = options.tournamentCommands.patchTemplate(
        decodeURIComponent(templateMatch[1]),
        revision,
        body,
        now(),
      );
      if (result.ok) {
        sendTournament(200, { template: result.template });
      } else {
        sendTournament(persistentAdminStatus(result), {
          error: result.code,
          ...(result.actualRevision === undefined
            ? {}
            : { actualRevision: result.actualRevision }),
        });
      }
      return true;
    }

    const templateActionMatch = pathname.match(
      /^\/api\/admin\/tournament-templates\/([^/]{1,128})\/actions$/,
    );
    if (templateActionMatch && req.method === 'POST') {
      if (!options.tournamentCommands?.actTemplate) {
        drainRequest(req);
        sendTournament(503, { error: 'unavailable' });
        return true;
      }
      const revision = parseIfMatch(req);
      if (revision === null) {
        drainRequest(req);
        sendTournament(428, { error: 'precondition-required' });
        return true;
      }
      let body: unknown;
      try {
        body = await readJsonBody(req);
      } catch (error) {
        const tooLarge = error instanceof HttpBodyError
          && error.kind === 'too-large';
        sendTournament(tooLarge ? 413 : 400, {
          error: tooLarge ? 'body-too-large' : 'invalid-body',
        });
        return true;
      }
      const result = options.tournamentCommands.actTemplate(
        decodeURIComponent(templateActionMatch[1]),
        revision,
        body,
        now(),
      );
      if (result.ok) {
        sendTournament(200, {
          template: result.template,
          ...(result.generated === undefined
            ? {}
            : { generated: result.generated }),
        });
      } else {
        sendTournament(persistentAdminStatus(result), {
          error: result.code,
          ...(result.actualRevision === undefined
            ? {}
            : { actualRevision: result.actualRevision }),
        });
      }
      return true;
    }

    const tournamentActionMatch = pathname.match(
      /^\/api\/admin\/tournaments\/([^/]{1,128})\/actions$/,
    );
    if (tournamentActionMatch && req.method === 'POST') {
      if (!options.tournamentCommands) {
        drainRequest(req);
        sendTournament(503, { error: 'unavailable' });
        return true;
      }
      let body: unknown;
      try {
        body = await readJsonBody(req);
      } catch {
        sendTournament(400, { error: 'invalid-body' });
        return true;
      }
      const action = parseTournamentAction(body);
      if (!action) {
        sendTournament(400, { error: 'invalid-payload' });
        return true;
      }
      const tournamentId = decodeURIComponent(tournamentActionMatch[1]);
      const result = action === 'start'
        ? options.tournamentCommands.start(tournamentId)
        : options.tournamentCommands.act(tournamentId, action);
      if (result === 'ok') {
        sendTournament(200, { ok: true });
        return true;
      }
      const status = result === 'forbidden'
        ? 403
        : result === 'not-found'
          ? 404
          : result === 'invalid'
            ? 400
            : 409;
      sendTournament(status, { error: result });
      return true;
    }

    if (
      (
        pathname === '/api/admin/tournaments'
        || pathname === '/api/admin/tournament-templates'
      )
      && (req.method === 'GET' || req.method === 'HEAD')
    ) {
      if (!options.tournamentCommands?.list) {
        if (pathname === '/api/admin/tournaments') {
          sendTournament(200, {
            tournaments: options.runtime()?.tournaments ?? [],
          });
        } else {
          sendTournament(503, { error: 'unavailable' });
        }
        return true;
      }
      const result = options.tournamentCommands.list(now());
      if (!result.ok) {
        sendTournament(persistentAdminStatus(result), { error: result.code });
        return true;
      }
      if (pathname === '/api/admin/tournament-templates') {
        sendTournament(200, { templates: result.templates });
        return true;
      }
      const liveById = new Map(
        (options.runtime()?.tournaments ?? []).map(tournament => [
          tournament.id,
          tournament,
        ]),
      );
      sendTournament(200, {
        tournaments: result.instances.map(instance => ({
          ...instance,
          live: liveById.get(instance.id) ?? null,
        })),
      });
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
