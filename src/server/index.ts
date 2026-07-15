import { createServer } from 'http';
import next from 'next';
import { Server } from 'socket.io';
import type { ClientToServerEvents, ServerToClientEvents } from '../lib/realtime/protocol';
import { setupSocketHandlers } from './socket-handler';
import { createHttpRequestHandler } from './http-handler';
import { isSocketOriginAllowed, parseSocketAllowedOrigins } from './socket-origin';

const dev = process.env.NODE_ENV !== 'production';
const hostname = '0.0.0.0';
const port = parseInt(process.env.PORT || '3000', 10);

const app = next({ dev, hostname, port });
const handle = app.getRequestHandler();

app.prepare().then(() => {
  const httpServer = createServer(createHttpRequestHandler(handle));
  const originOptions = {
    production: !dev,
    allowedOrigins: parseSocketAllowedOrigins(process.env.SOCKET_ALLOWED_ORIGINS),
  };

  const io = new Server<ClientToServerEvents, ServerToClientEvents>(httpServer, {
    cors: {
      origin: dev ? '*' : true,
      methods: ['GET', 'POST'],
    },
    allowRequest: (req, callback) => {
      callback(null, isSocketOriginAllowed(
        req.headers.origin,
        req.headers.host,
        originOptions,
      ));
    },
    pingTimeout: 60000,
  });

  setupSocketHandlers(io);

  httpServer.listen(port, () => {
    console.log(`> Poker server ready on http://${hostname}:${port}`);
  });
});
