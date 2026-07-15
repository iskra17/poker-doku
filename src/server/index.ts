import { createServer } from 'http';
import { parse } from 'url';
import next from 'next';
import { Server } from 'socket.io';
import type { ClientToServerEvents, ServerToClientEvents } from '../lib/realtime/protocol';
import { setupSocketHandlers } from './socket-handler';
import { eventLog } from './event-log';

const dev = process.env.NODE_ENV !== 'production';
const hostname = '0.0.0.0';
const port = parseInt(process.env.PORT || '3000', 10);

const app = next({ dev, hostname, port });
const handle = app.getRequestHandler();

/**
 * 플레이 이벤트 로그 조회 — 버그 역추적용.
 *   /api/debug/log?token=<DEBUG_LOG_TOKEN>&room=<id>&player=<id>&type=<t>&limit=200
 * Next 라우트가 아니라 커스텀 서버가 직접 처리한다 (번들 경계를 타지 않아 링 버퍼를 확실히 공유).
 * DEBUG_LOG_TOKEN이 없으면 비활성 — 로그에 좌석/칩 흐름이 담기므로 공개하면 안 된다.
 */
function handleDebugLog(query: Record<string, string | string[] | undefined>, res: import('http').ServerResponse): void {
  const secret = process.env.DEBUG_LOG_TOKEN;
  const one = (v: string | string[] | undefined): string | undefined => (Array.isArray(v) ? v[0] : v);
  if (!secret || one(query.token) !== secret) {
    res.writeHead(403, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: 'forbidden' }));
    return;
  }
  const events = eventLog.recent({
    roomId: one(query.room),
    playerId: one(query.player),
    type: one(query.type),
    limit: one(query.limit) ? parseInt(one(query.limit)!, 10) : undefined,
  });
  res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify({ stats: eventLog.stats(), count: events.length, events }, null, 2));
}

app.prepare().then(() => {
  const httpServer = createServer((req, res) => {
    const parsedUrl = parse(req.url!, true);
    if (parsedUrl.pathname === '/api/debug/log') {
      handleDebugLog(parsedUrl.query, res);
      return;
    }
    handle(req, res, parsedUrl);
  });

  const io = new Server<ClientToServerEvents, ServerToClientEvents>(httpServer, {
    cors: {
      origin: '*',
      methods: ['GET', 'POST'],
    },
    pingTimeout: 60000,
  });

  setupSocketHandlers(io);

  httpServer.listen(port, () => {
    console.log(`> Poker server ready on http://${hostname}:${port}`);
  });
});
