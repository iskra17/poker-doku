import { mkdirSync } from 'node:fs';
import { createServer } from 'http';
import { dirname, join, resolve } from 'node:path';
import next from 'next';
import { Server } from 'socket.io';
import type { ClientToServerEvents, ServerToClientEvents } from '../lib/realtime/protocol';
import { createHttpRequestHandler } from './http-handler';
import { EconomyRepository } from './economy-repository';
import { EconomyRuntime } from './economy-runtime';
import { EconomyService } from './economy-service';
import {
  TransientHttpConcurrencyGate,
  TransientHttpRateLimiter,
} from './http-rate-limit';
import { openPokerDatabase, type PokerDatabase } from './persistence/database';
import { ProfileManager } from './profile-manager';
import { ProfileRepository } from './profile-repository';
import { isSocketOriginAllowed, parseSocketAllowedOrigins } from './socket-origin';
import {
  setupSocketHandlers,
  type AuthenticatedSocketData,
} from './socket-handler';
import { createServerShutdown, startServerLifecycle } from './server-shutdown';

const dev = process.env.NODE_ENV !== 'production';
const hostname = '0.0.0.0';
const port = parseInt(process.env.PORT || '3000', 10);
const FORCE_EXIT_MS = 10_000;

const app = next({ dev, hostname, port });
let httpServer: ReturnType<typeof createServer> | undefined;
let io: Server<
  ClientToServerEvents,
  ServerToClientEvents,
  Record<string, never>,
  AuthenticatedSocketData
> | undefined;
let runtime: ReturnType<typeof setupSocketHandlers> | undefined;
let database: PokerDatabase | undefined;
let profileRateLimiter: TransientHttpRateLimiter | undefined;

const shutdown = createServerShutdown({
  runtime: {
    close: () => runtime?.close(),
  },
  rateLimiter: {
    close: () => profileRateLimiter?.close(),
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
  database: {
    close: () => database?.close(),
  },
  app,
});

async function listen(): Promise<void> {
  const databasePath = process.env.POKER_DB_PATH
    ?? join(process.cwd(), 'data', 'poker-doku.sqlite');
  if (databasePath !== ':memory:') {
    mkdirSync(dirname(resolve(databasePath)), { recursive: true });
  }
  database = openPokerDatabase(databasePath);
  const profileRepository = new ProfileRepository(database);
  const profileManager = new ProfileManager(profileRepository);
  const economyRepository = new EconomyRepository(database);
  const economyService = new EconomyService(economyRepository);
  const economyRuntime = new EconomyRuntime(economyService);
  // 방/소켓을 만들기 전에 이전 프로세스의 cash checkpoint를 전부 void-refund한다.
  // 새 입장 escrow가 생긴 뒤 실행하면 정상 좌석까지 환불하므로 시작 시점에 딱 한 번만 호출한다.
  economyRuntime.recoverActiveEscrows();
  profileRateLimiter = new TransientHttpRateLimiter();
  const profileConcurrencyGate = new TransientHttpConcurrencyGate(4);

  const handle = app.getRequestHandler();
  const server = createServer(createHttpRequestHandler(handle, {
    database,
    profileManager,
    economyService,
    profileRateLimiter,
    profileConcurrencyGate,
    production: !dev,
    onProfileRevoked: profileId => runtime?.revokeProfile(profileId),
  }));
  httpServer = server;
  const originOptions = {
    production: !dev,
    allowedOrigins: parseSocketAllowedOrigins(process.env.SOCKET_ALLOWED_ORIGINS),
  };

  io = new Server<
    ClientToServerEvents,
    ServerToClientEvents,
    Record<string, never>,
    AuthenticatedSocketData
  >(server, {
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

  runtime = setupSocketHandlers(io, {
    profileAuth: {
      manager: profileManager,
      rateLimiter: profileRateLimiter,
      concurrencyGate: profileConcurrencyGate,
    },
    economy: economyRuntime,
  });

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
