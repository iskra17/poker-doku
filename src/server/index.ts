import { mkdirSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { createServer } from 'http';
import { dirname, join, resolve } from 'node:path';
import next from 'next';
import { Server } from 'socket.io';
import type { ClientToServerEvents, ServerToClientEvents } from '../lib/realtime/protocol';
import { createHttpRequestHandler } from './http-handler';
import { ArenaRepository } from './arena-repository';
import { ArenaMatchmaker } from './arena-matchmaker';
import { ArenaScheduler } from './arena-scheduler';
import { ArenaService, parseArenaRuntimeConfig } from './arena-service';
import { EconomyRepository } from './economy-repository';
import { EconomyRuntime } from './economy-runtime';
import { EconomyService } from './economy-service';
import {
  TransientHttpConcurrencyGate,
  TransientHttpRateLimiter,
} from './http-rate-limit';
import { openPokerDatabase, type PokerDatabase } from './persistence/database';
import {
  BackupManager,
  DailyBackupScheduler,
  resolveBackupEncryptionKey,
} from './persistence/backup';
import { ProfileManager } from './profile-manager';
import { ProfileRepository } from './profile-repository';
import { ProgressionRepository } from './progression-repository';
import { ProgressionService } from './progression-service';
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
let profileManager: ProfileManager | undefined;
let economyService: EconomyService | undefined;
let economyRuntime: EconomyRuntime | undefined;
let progressionService: ProgressionService | undefined;
let backupManager: BackupManager | undefined;
let backupScheduler: DailyBackupScheduler | undefined;
let arenaService: ArenaService | undefined;
let arenaScheduler: ArenaScheduler | undefined;
let arenaMatchmaker: ArenaMatchmaker | undefined;

const shutdown = createServerShutdown({
  backup: {
    stopScheduler: () => backupScheduler?.close(),
    backupAfterCurrent: async () => {
      await backupManager?.backupAfterCurrent();
    },
  },
  runtime: {
    close: async () => {
      arenaScheduler?.close();
      const arenaClose = await runtime?.close();
      if (
        arenaClose
        && (
          arenaClose.pendingOfficialMatchIds.length > 0
          || arenaClose.pendingTrainingOfferIds.length > 0
        )
      ) {
        try {
          console.error('[arena] cleanup deferred to startup recovery', arenaClose);
        } catch {
          // Shutdown must continue even if diagnostic output is unavailable.
        }
      }
    },
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

function initializePersistenceAndRecover(): void {
  const databasePath = process.env.POKER_DB_PATH
    ?? join(process.cwd(), 'data', 'poker-doku.sqlite');
  if (databasePath !== ':memory:') {
    mkdirSync(dirname(resolve(databasePath)), { recursive: true });
  }
  database = openPokerDatabase(databasePath);
  profileManager = new ProfileManager(new ProfileRepository(database));
  const economyRepository = new EconomyRepository(database);
  economyService = new EconomyService(economyRepository);
  economyRuntime = new EconomyRuntime(economyService);
  const progressionRepository = new ProgressionRepository(database);
  progressionService = new ProgressionService(database, progressionRepository);
  const arenaConfig = parseArenaRuntimeConfig(process.env);
  if (arenaConfig.enabled) {
    arenaService = new ArenaService(new ArenaRepository(database), {
      ...arenaConfig,
      isProfileInNonArenaSeat: profileId => {
        if (!economyService || !runtime) {
          throw new Error('Arena participation authority is not ready');
        }
        if (economyService.getStatus(profileId).economy.hasActiveSeat) {
          return true;
        }
        if (runtime.sessions.getByPlayerId(profileId)?.roomId) return true;
        return runtime.roomManager.getRoomList(profileId)
          .some(room => room.mySeat !== undefined);
      },
    });
    arenaScheduler = new ArenaScheduler({
      epochMs: arenaConfig.epochMs,
      reconcile: at => arenaService!.reconcile(at),
      logger: console,
    });
    arenaMatchmaker = new ArenaMatchmaker({
      reserveOfficial: async (candidate, isCandidateValid) => {
        if (!isCandidateValid()) return null;
        const at = Date.now();
        const seasonId = arenaService!.getMatchmakingProfile(
          candidate.entries[0].profileId,
          at,
        ).seasonId;
        if (!isCandidateValid()) return null;
        const match = arenaService!.reserveMatchTickets(
          `arena-${randomUUID()}`,
          candidate.entries.map(entry => entry.profileId),
          at,
          seasonId,
        );
        return { matchId: match.id };
      },
      // Arena room construction is introduced by the next phase. Until then a
      // successful ticket reservation is immediately voided and refunded.
      createOfficialRoom: async () => false,
      rollbackOfficialRoom: async () => undefined,
      voidOfficial: async matchId => {
        arenaService!.voidMatch(matchId);
      },
      createTrainingRoom: async () => null,
      rollbackTrainingRoom: async () => undefined,
      onError: (error, context) => {
        console.error(`[arena] notification failed (${context})`, error);
      },
    });
  }
  // 방/소켓을 만들기 전에 이전 프로세스의 cash checkpoint를 전부 void-refund한다.
  // 새 입장 escrow가 생긴 뒤 실행하면 정상 좌석까지 환불하므로 시작 시점에 딱 한 번만 호출한다.
  economyRuntime.recoverActiveEscrows();
  const backupDirectory = process.env.POKER_BACKUP_DIR
    ?? join(process.cwd(), 'data', 'backups');
  const encryptionKey = resolveBackupEncryptionKey(
    process.env.BACKUP_ENCRYPTION_KEY,
    !dev,
  );
  backupManager = new BackupManager({
    database,
    backupDirectory,
    encryptionKey,
  });
  backupScheduler = new DailyBackupScheduler({
    backup: () => backupManager!.backup(),
    logger: console,
  });
}

async function listen(): Promise<void> {
  if (
    !database
    || !profileManager
    || !economyService
    || !economyRuntime
    || !progressionService
  ) {
    throw new Error('Persistence must be initialized before listening');
  }
  profileRateLimiter = new TransientHttpRateLimiter();
  const profileConcurrencyGate = new TransientHttpConcurrencyGate(4);

  const handle = app.getRequestHandler();
  const server = createServer(createHttpRequestHandler(handle, {
    database,
    profileManager,
    economyService,
    progressionService,
    profileRateLimiter,
    profileConcurrencyGate,
    production: !dev,
    onProfileRevoked: profileId => runtime?.revokeProfile(profileId),
    onProgressionPublicCosmeticsChanged: (profileId, snapshot) => {
      runtime?.refreshPublicCosmetics(profileId, snapshot);
    },
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
    progressionService,
    ...(arenaMatchmaker && arenaService
      ? {
        arena: {
          matchmaker: arenaMatchmaker,
          getEligibility: (profileId: string) =>
            arenaService!.getMatchmakingProfile(profileId),
        },
      }
      : {}),
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
  recover: () => initializePersistenceAndRecover(),
  backup: () => backupManager!.backup(),
  listen,
  startScheduler: () => {
    backupScheduler!.start();
    arenaScheduler?.start();
    arenaMatchmaker?.start();
  },
  shutdown,
  process,
  production: !dev,
  forceExitMs: FORCE_EXIT_MS,
  logger: console,
}).then(started => {
  if (started) console.log(`> Poker server ready on http://${hostname}:${port}`);
});
