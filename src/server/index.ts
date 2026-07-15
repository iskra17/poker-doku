import { createServer } from 'http';
import next from 'next';
import { Server } from 'socket.io';
import type { ClientToServerEvents, ServerToClientEvents } from '../lib/realtime/protocol';
import { setupSocketHandlers } from './socket-handler';
import { createHttpRequestHandler } from './http-handler';
import { isSocketOriginAllowed, parseSocketAllowedOrigins } from './socket-origin';
import { createServerShutdown } from './server-shutdown';

const dev = process.env.NODE_ENV !== 'production';
const hostname = '0.0.0.0';
const port = parseInt(process.env.PORT || '3000', 10);
const FORCE_EXIT_MS = 10_000;

const app = next({ dev, hostname, port });

async function startServer(): Promise<void> {
  await app.prepare();
  const handle = app.getRequestHandler();
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

  const runtime = setupSocketHandlers(io);
  const shutdown = createServerShutdown({ runtime, io, httpServer, app });

  try {
    await new Promise<void>((resolve, reject) => {
      const onError = (error: Error): void => {
        httpServer.off('listening', onListening);
        reject(error);
      };
      const onListening = (): void => {
        httpServer.off('error', onError);
        resolve();
      };

      httpServer.once('error', onError);
      httpServer.once('listening', onListening);
      httpServer.listen(port);
    });
  } catch (error) {
    await shutdown('startup-error').catch(() => undefined);
    throw error;
  }

  let shutdownStarted = false;
  const handleSignal = (signal: NodeJS.Signals): void => {
    if (shutdownStarted) return;
    shutdownStarted = true;

    const forceExitTimer = dev
      ? undefined
      : setTimeout(() => {
          console.error(`> Poker server shutdown timed out after ${FORCE_EXIT_MS}ms`);
          process.exit(1);
        }, FORCE_EXIT_MS);

    void shutdown(signal).then(
      () => {
        if (forceExitTimer) clearTimeout(forceExitTimer);
      },
      error => {
        console.error(`> Poker server shutdown failed (${signal}):`, error);
        process.exitCode = 1;
      },
    );
  };

  process.once('SIGTERM', handleSignal);
  process.once('SIGINT', handleSignal);
  console.log(`> Poker server ready on http://${hostname}:${port}`);
}

void startServer().catch(error => {
  console.error('> Poker server failed to start:', error);
  process.exitCode = 1;
});
