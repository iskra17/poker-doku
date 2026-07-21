import type { IncomingMessage, ServerResponse } from 'http';
import { randomBytes } from 'node:crypto';
import { parse } from 'url';
import type { UrlWithParsedQuery } from 'url';
import {
  createAdminHttpHandler,
  type AdminRuntimeSnapshot,
} from './admin-http';
import { eventLog } from './event-log';
import type { OpsEventRepository } from './ops-log';
import {
  createFeedbackHttpHandler,
  FeedbackRepository,
} from './feedback-http';
import { HandHistoryRepository } from './hand-history';
import { createHandHistoryHttpHandler } from './hand-history-http';
import type {
  TransientHttpConcurrencyGate,
  TransientHttpRateLimiter,
} from './http-rate-limit';
import type { PokerDatabase } from './persistence/database';
import {
  createProfileHttpHandler,
  type EconomyHttpService,
  type ProfileHttpManager,
} from './profile-http';
import {
  createProgressionHttpHandler,
  type ProgressionHttpService,
} from './progression-http';
import type { ProgressionSnapshot } from '@/lib/progression/types';
import {
  createArenaHttpHandler,
  type ArenaHttpService,
} from './arena-http';

export type NextRequestHandler = (
  req: IncomingMessage,
  res: ServerResponse,
  parsedUrl: UrlWithParsedQuery,
) => void | Promise<void>;

interface HttpHandlerCommonOptions {
  debugToken?: string;
  database?: PokerDatabase;
  production?: boolean;
  onProfileRevoked?: (profileId: string) => void | Promise<void>;
  now?: () => number;
  onProgressionPublicCosmeticsChanged?: (
    profileId: string,
    snapshot: ProgressionSnapshot,
  ) => void;
  arenaHttpService?: ArenaHttpService;
  arenaEnabled?: () => boolean;
  arenaCursorSecret?: string;
  /** 시작 복구가 끝나기 전까지 /healthz를 503으로 유지한다. */
  ready?: () => boolean;
  /** 운영 백오피스 (/api/admin/*) — 영속 이벤트 저장소 + 늦은 바인딩 런타임 스냅샷 */
  opsEvents?: OpsEventRepository;
  adminRuntime?: () => AdminRuntimeSnapshot | null;
}

interface HttpHandlerWithoutProfileOptions extends HttpHandlerCommonOptions {
  profileManager?: undefined;
  economyService?: undefined;
  profileRateLimiter?: undefined;
  profileConcurrencyGate?: undefined;
  progressionService?: undefined;
}

interface HttpHandlerWithProfileOptions extends HttpHandlerCommonOptions {
  profileManager: ProfileHttpManager;
  economyService: EconomyHttpService;
  profileRateLimiter: TransientHttpRateLimiter;
  profileConcurrencyGate?: TransientHttpConcurrencyGate;
  progressionService?: ProgressionHttpService;
}

export type HttpHandlerOptions =
  | HttpHandlerWithoutProfileOptions
  | HttpHandlerWithProfileOptions;

function one(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function handleDebugLog(
  parsedUrl: UrlWithParsedQuery,
  res: ServerResponse,
  debugToken: string | undefined,
): void {
  if (!debugToken || one(parsedUrl.query.token) !== debugToken) {
    res.writeHead(403, { 'content-type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ error: 'forbidden' }));
    return;
  }
  const events = eventLog.recent({
    roomId: one(parsedUrl.query.room),
    playerId: one(parsedUrl.query.player),
    type: one(parsedUrl.query.type),
    limit: one(parsedUrl.query.limit) ? parseInt(one(parsedUrl.query.limit)!, 10) : undefined,
  });
  res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify({ stats: eventLog.stats(), count: events.length, events }, null, 2));
}

export function createHttpRequestHandler(
  nextHandler: NextRequestHandler,
  options: HttpHandlerOptions = {},
): (req: IncomingMessage, res: ServerResponse) => void {
  const debugToken = options.debugToken ?? process.env.DEBUG_LOG_TOKEN;
  if (options.profileManager && !options.profileRateLimiter) {
    throw new Error('PROFILE_RATE_LIMITER_REQUIRED');
  }
  if (options.profileManager && !options.economyService) {
    throw new Error('ECONOMY_SERVICE_REQUIRED');
  }
  const profileHandler = options.profileManager
    ? createProfileHttpHandler({
        manager: options.profileManager,
        economyService: options.economyService,
        rateLimiter: options.profileRateLimiter,
        concurrencyGate: options.profileConcurrencyGate,
        production: options.production ?? process.env.NODE_ENV === 'production',
        onProfileRevoked: options.onProfileRevoked,
      })
    : undefined;
  const progressionHandler = options.profileManager && options.progressionService
    ? createProgressionHttpHandler({
        manager: options.profileManager,
        service: options.progressionService,
        rateLimiter: options.profileRateLimiter,
        concurrencyGate: options.profileConcurrencyGate,
        production: options.production ?? process.env.NODE_ENV === 'production',
        now: options.now,
        onPublicCosmeticsChanged: options.onProgressionPublicCosmeticsChanged,
      })
    : undefined;
  const feedbackHandler = options.profileManager && options.database
    ? createFeedbackHttpHandler({
        manager: options.profileManager,
        repository: new FeedbackRepository(options.database),
        rateLimiter: options.profileRateLimiter!,
        production: options.production ?? process.env.NODE_ENV === 'production',
        debugToken,
        now: options.now,
      })
    : undefined;
  const handHistoryHandler = options.profileManager && options.database
    ? createHandHistoryHttpHandler({
        manager: options.profileManager,
        repository: new HandHistoryRepository(options.database),
        rateLimiter: options.profileRateLimiter!,
      })
    : undefined;
  const adminHandler = options.database && options.opsEvents
    ? createAdminHttpHandler({
        database: options.database,
        opsEvents: options.opsEvents,
        runtime: options.adminRuntime ?? (() => null),
        debugToken,
        now: options.now,
      })
    : undefined;
  const arenaHandler = options.profileManager
    ? createArenaHttpHandler({
        enabled: options.arenaEnabled ?? (() => false),
        manager: options.profileManager,
        service: options.arenaHttpService,
        production: options.production ?? process.env.NODE_ENV === 'production',
        cursorSecret: options.arenaCursorSecret
          ?? process.env.ARENA_CURSOR_SECRET
          ?? randomBytes(32).toString('base64url'),
        now: options.now,
      })
    : undefined;
  return (req, res) => {
    const dispatch = async (): Promise<void> => {
      const parsedUrl = parse(req.url ?? '/', true);
      if (parsedUrl.pathname === '/healthz') {
        if (req.method !== 'GET' && req.method !== 'HEAD') {
          res.writeHead(405, { allow: 'GET, HEAD' });
          res.end();
          return;
        }
        const ready = options.ready ? options.ready() : true;
        res.writeHead(ready ? 200 : 503, {
          'content-type': 'application/json; charset=utf-8',
        });
        res.end(req.method === 'HEAD'
          ? undefined
          : JSON.stringify({ ok: ready }));
        return;
      }
      if (parsedUrl.pathname === '/api/debug/log') {
        handleDebugLog(parsedUrl, res, debugToken);
        return;
      }
      if (
        adminHandler
        && parsedUrl.pathname
        && adminHandler(res, parsedUrl.pathname, parsedUrl.query)
      ) {
        return;
      }
      if (profileHandler && await profileHandler(req, res, parsedUrl.pathname)) {
        return;
      }
      if (
        progressionHandler
        && await progressionHandler(req, res, parsedUrl.pathname)
      ) {
        return;
      }
      if (
        feedbackHandler
        && await feedbackHandler(req, res, parsedUrl.pathname, parsedUrl.query)
      ) {
        return;
      }
      if (
        handHistoryHandler
        && await handHistoryHandler(req, res, parsedUrl.pathname, parsedUrl.query)
      ) {
        return;
      }
      if (
        arenaHandler
        && await arenaHandler(
          req,
          res,
          new URL(req.url ?? '/', 'http://localhost'),
        )
      ) {
        return;
      }
      await nextHandler(req, res, parsedUrl);
    };

    void dispatch().catch(() => {
      if (res.headersSent) {
        res.destroy();
        return;
      }
      res.writeHead(500, {
        'cache-control': 'no-store',
        'content-type': 'application/json; charset=utf-8',
      });
      res.end(JSON.stringify({
        error: { code: 'INTERNAL_ERROR', message: '요청을 처리하지 못했습니다.' },
      }));
    });
  };
}
