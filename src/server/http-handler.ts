import type { IncomingMessage, ServerResponse } from 'http';
import { parse } from 'url';
import type { UrlWithParsedQuery } from 'url';
import { eventLog } from './event-log';

export type NextRequestHandler = (
  req: IncomingMessage,
  res: ServerResponse,
  parsedUrl: UrlWithParsedQuery,
) => void | Promise<void>;

export interface HttpHandlerOptions {
  debugToken?: string;
}

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
  return (req, res) => {
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
    void nextHandler(req, res, parsedUrl);
  };
}
