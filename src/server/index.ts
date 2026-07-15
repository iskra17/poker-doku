import { createServer } from 'http';
import next from 'next';
import { Server } from 'socket.io';
import type { ClientToServerEvents, ServerToClientEvents } from '../lib/realtime/protocol';
import { setupSocketHandlers } from './socket-handler';
import { createHttpRequestHandler } from './http-handler';
import { isSocketOriginAllowed, parseSocketAllowedOrigins } from './socket-origin';
import { createServerShutdown, startServerLifecycle } from './server-shutdown';

const dev = process.env.NODE_ENV !== 'production';
const hostname = '0.0.0.0';
const port = parseInt(process.env.PORT || '3000', 10);
const FORCE_EXIT_MS = 10_000;

const app = next({ dev, hostname, port });
let httpServer: ReturnType<typeof createServer> | undefined;
let io: Server<ClientToServerEvents, ServerToClientEvents> | undefined;
let runtime: ReturnType<typeof setupSocketHandlers> | undefined;

const shutdown = createServerShutdown({
  runtime: {
    close: () => runtime?.close(),
  },
  io: {
    close: callback => {
      if (!io) {
        callback();
        return;
      }
      return io.close(callback);
    },
  },
  httpServer: {
    close: callback => {
      if (!httpServer) {
        callback();
        return;
      }
      return httpServer.close(callback);
    },
  },
  app,
});

async function listen(): Promise<void> {
  const handle = app.getRequestHandler();
  const server = createServer(createHttpRequestHandler(handle));
  httpServer = server;
  const originOptions = {
    production: !dev,
    allowedOrigins: parseSocketAllowedOrigins(process.env.SOCKET_ALLOWED_ORIGINS),
  };

  io = new Server<ClientToServerEvents, ServerToClientEvents>(server, {
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

  runtime = setupSocketHandlers(io);

  await new Promise<void>((resolve, reject) => {
    const onError = (error: Error): void => {
      httpServer?.off('listening', onListening);
      reject(error);
    };
    const onListening = (): void => {
      httpServer?.off('error', onError);
      resolve();
    };

    server.once('error', onError);
    server.once('listening', onListening);
    server.listen(port);
  });
}

void startServerLifecycle({
  prepare: () => app.prepare(),
  listen,
  shutdown,
  process,
  production: !dev,
  forceExitMs: FORCE_EXIT_MS,
  logger: console,
}).then(started => {
  if (started) console.log(`> Poker server ready on http://${hostname}:${port}`);
});
