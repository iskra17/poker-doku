import type { IncomingMessage, ServerResponse } from 'http';
import { parse } from 'url';
import type { UrlWithParsedQuery } from 'url';
import { eventLog } from './event-log';
import type {
  TransientHttpConcurrencyGate,
  TransientHttpRateLimiter,
} from './http-rate-limit';
import type { PokerDatabase } from './persistence/database';
import {
  createProfileHttpHandler,
  type ProfileHttpManager,
} from './profile-http';

export type NextRequestHandler = (
  req: IncomingMessage,
  res: ServerResponse,
  parsedUrl: UrlWithParsedQuery,
) => void | Promise<void>;

interface HttpHandlerCommonOptions {
  debugToken?: string;
  database?: PokerDatabase;
  production?: boolean;
}

interface HttpHandlerWithoutProfileOptions extends HttpHandlerCommonOptions {
  profileManager?: undefined;
  profileRateLimiter?: undefined;
  profileConcurrencyGate?: undefined;
}

interface HttpHandlerWithProfileOptions extends HttpHandlerCommonOptions {
  profileManager: ProfileHttpManager;
  profileRateLimiter: TransientHttpRateLimiter;
  profileConcurrencyGate?: TransientHttpConcurrencyGate;
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
  const profileHandler = options.profileManager
    ? createProfileHttpHandler({
        manager: options.profileManager,
        rateLimiter: options.profileRateLimiter,
        concurrencyGate: options.profileConcurrencyGate,
        production: options.production ?? process.env.NODE_ENV === 'production',
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
        res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
        res.end(req.method === 'HEAD' ? undefined : JSON.stringify({ ok: true }));
        return;
      }
      if (parsedUrl.pathname === '/api/debug/log') {
        handleDebugLog(parsedUrl, res, debugToken);
        return;
      }
      if (profileHandler && await profileHandler(req, res, parsedUrl.pathname)) {
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
