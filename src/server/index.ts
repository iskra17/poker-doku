import { mkdirSync } from 'node:fs';
import { createServer } from 'http';
import { dirname, join, resolve } from 'node:path';
import next from 'next';
import { Server } from 'socket.io';
import type { ClientToServerEvents, ServerToClientEvents } from '../lib/realtime/protocol';
import { createHttpRequestHandler } from './http-handler';
import { ArenaHttpDataService } from './arena-http';
import { ArenaMetrics } from './arena-metrics';
import { ArenaRepository } from './arena-repository';
import { ArenaScheduler } from './arena-scheduler';
import {
  ArenaService,
  calculateArenaSeasonWindow,
  parseArenaRuntimeConfig,
} from './arena-service';
import { EconomyRepository } from './economy-repository';
import { EconomyRuntime } from './economy-runtime';
import { EconomyService } from './economy-service';
import { initGameConfig } from './game-config/live';
import { resolveEnvConfigDefaults } from './game-config/registry';
import { GameConfigRepository } from './game-config/repository';
import { GameConfigService } from './game-config/service';
import {
  TransientHttpConcurrencyGate,
  TransientHttpRateLimiter,
} from './http-rate-limit';
import {
  HandHistoryRepository,
  HandHistoryService,
  TableHandRepository,
} from './hand-history';
import { openPokerDatabase, type PokerDatabase } from './persistence/database';
import {
  BackupManager,
  DailyBackupScheduler,
  isNativeSqliteBackupSupported,
  resolveBackupEncryptionKey,
} from './persistence/backup';
import { eventLog } from './event-log';
import { OpsEventRepository, shouldPersistOpsEvent } from './ops-log';
import { ProfileManager } from './profile-manager';
import { ProfileRepository } from './profile-repository';
import { PromotionFundRepository } from './promotion-fund-repository';
import { ProgressionRepository } from './progression-repository';
import { ProgressionService } from './progression-service';
import { isSocketOriginAllowed, parseSocketAllowedOrigins } from './socket-origin';
import {
  setupSocketHandlers,
  type AuthenticatedSocketData,
} from './socket-handler';
import { createServerShutdown, startServerLifecycle } from './server-shutdown';
import {
  loadTournamentRecoveryPlan,
  resumeTournamentRefund,
  TournamentRecoveryService,
} from './tournament-recovery-service';
import { TournamentInstanceRepository } from './tournament-instance-repository';
import { TournamentEnrollmentRepository } from './tournament-enrollment-repository';
import { TournamentScheduler } from './tournament-scheduler';
import type {
  ClaimedTournamentStartSnapshot,
  PersistentTournamentStartPorts,
} from './tournament-command-service';
import type { StartClaimSource } from './tournament-instance-repository';

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
let gameConfigService: GameConfigService | undefined;
let progressionService: ProgressionService | undefined;
let handHistoryService: HandHistoryService | undefined;
let backupManager: BackupManager | undefined;
let backupScheduler: DailyBackupScheduler | undefined;
let arenaService: ArenaService | undefined;
let arenaHttpService: ArenaHttpDataService | undefined;
let arenaScheduler: ArenaScheduler | undefined;
let arenaMetrics: ArenaMetrics | undefined;
let tournamentScheduler: TournamentScheduler | undefined;
let persistentTournamentStart: PersistentTournamentStartPorts | undefined;
const pendingTournamentStarts: Array<{
  instance: ClaimedTournamentStartSnapshot;
  source: StartClaimSource;
}> = [];
const pendingTournamentLeaseExpiries: ClaimedTournamentStartSnapshot[] = [];
let lifecycleReady = false;

const shutdown = createServerShutdown({
  backup: {
    stopScheduler: () => backupScheduler?.close(),
    backupAfterCurrent: async () => {
      await backupManager?.backupAfterCurrent();
    },
  },
  runtime: {
    close: async () => {
      lifecycleReady = false;
      tournamentScheduler?.close();
      arenaScheduler?.close();
      arenaMetrics?.close(Date.now());
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
  // 런타임 게임 설정(핫 컨피그) — 다른 모든 서비스보다 먼저 하이드레이션해야
  // 이후 생성되는 서비스들이 부팅 시점부터 오버라이드 값을 본다.
  gameConfigService = new GameConfigService(new GameConfigRepository(database), {
    envDefaults: resolveEnvConfigDefaults(process.env),
  });
  initGameConfig(gameConfigService);
  profileManager = new ProfileManager(new ProfileRepository(database));
  const economyRepository = new EconomyRepository(database);
  economyService = new EconomyService(economyRepository);
  economyRuntime = new EconomyRuntime(economyService);
  const progressionRepository = new ProgressionRepository(database);
  progressionService = new ProgressionService(database, progressionRepository);
  handHistoryService = new HandHistoryService(new HandHistoryRepository(database), {
    // 테이블 정본 기록(전역 핸드 ID) — 백오피스 핸드 감사(/api/admin/hands*)의 데이터 소스
    tableHands: new TableHandRepository(database),
  });
  // 방/소켓을 만들기 전에 이전 프로세스의 cash checkpoint를 전부 void-refund한다.
  // 새 입장 escrow가 생긴 뒤 실행하면 정상 좌석까지 환불하므로 시작 시점에 딱 한 번만 호출한다.
  // Arena 복구보다 먼저 실행 — 시작 순서 계약:
  // migration → cash/SnG 회수 → Arena refund → 주간/시즌 reconcile → socket accept.
  const tournamentInstances = new TournamentInstanceRepository(database);
  const tournamentEnrollments = new TournamentEnrollmentRepository(
    database,
    economyRepository,
  );
  const promotionFunds = new PromotionFundRepository(database);
  const refundDependencies = {
    database,
    instances: tournamentInstances,
    funds: promotionFunds,
    voidWallet: (instanceId: string, at: number) =>
      economyService!.voidMttTournament(instanceId, at),
  };
  const persistentStartEnabled =
    process.env.MTT_PERSISTENT_START_ENABLED === 'true';
  persistentTournamentStart = persistentStartEnabled
    ? {
        claimManualStart: tournamentId => {
          const claim = tournamentInstances.claimStart(
            tournamentId,
            `manual-start-${process.pid}`,
            Date.now() + 30_000,
          );
          return claim.status === 'claimed'
            ? {
                ...claim.instance,
                startSource: claim.source,
              }
            : null;
        },
        claimStartingRoster: (snapshot, ownerToken) => {
          const candidates = tournamentEnrollments.listStartingCandidates(
            snapshot.id,
          );
          const checkedIn = candidates.filter(player => {
            const session = runtime?.sessions.getByPlayerId(player.id);
            return !!(
              session?.socketId
              && io?.sockets.sockets.get(session.socketId)
            );
          });
          const claimed = tournamentEnrollments.claimStartingRoster({
            tournamentId: snapshot.id,
            ownerId: ownerToken,
            startAttempt: snapshot.startAttempt,
            checkedInProfileIds: checkedIn.map(player => player.id),
          });
          const claimedIds = new Set(
            claimed.entries.map(entry => entry.profileId),
          );
          return {
            roster: checkedIn.filter(player => claimedIds.has(player.id)),
          };
        },
        startEconomy: (snapshot, roster) => {
          if (snapshot.config.economy.mode !== 'wallet') return;
          economyService!.startMttTournament(
            snapshot.id,
            roster.map(player => player.id),
            snapshot.config.economy.buyIn,
            snapshot.config.economy.fee,
          );
        },
        commitRunning: input => tournamentEnrollments.commitStartingRoster({
          tournamentId: input.snapshot.id,
          ownerId: input.ownerToken,
          startAttempt: input.snapshot.startAttempt,
          humanEntrants:
            input.initialEntrants - input.initialBotEntrants,
          initialEntrants: input.initialEntrants,
          initialBotEntrants: input.initialBotEntrants,
          committedEntrants: input.committedEntrants,
          everMultiTable: input.everMultiTable,
          actualStartedAt: input.actualStartedAt,
        }),
        restoreStartSource: (snapshot, ownerToken, source) => {
          tournamentEnrollments.rollbackStartClaim({
            tournamentId: snapshot.id,
            ownerId: ownerToken,
            startAttempt: snapshot.startAttempt,
            restore: {
              status: source.status,
              statusReason: source.statusReason,
              nextRetryAt: source.nextRetryAt,
            },
          });
        },
        handoffRefund: (snapshot, _ownerToken, _error) => {
          void _ownerToken;
          void _error;
          const current = tournamentInstances.getInstance(snapshot.id);
          if (!current) throw new Error(`Tournament disappeared: ${snapshot.id}`);
          resumeTournamentRefund(
            refundDependencies,
            current,
            Date.now(),
            'financial-invariant',
          );
        },
      }
    : undefined;
  tournamentScheduler = new TournamentScheduler({
    database,
    startProcessingEnabled: persistentStartEnabled,
    onStartClaim: (instance, source) => {
      const snapshot = { ...instance, startSource: source };
      if (runtime) {
        runtime.tournamentCommands.processStartClaim(snapshot);
      } else {
        pendingTournamentStarts.push({ instance: snapshot, source });
      }
    },
    onStartLeaseExpired: instance => {
      if (runtime) {
        runtime.tournamentCommands.processExpiredStartLease(instance);
      } else {
        pendingTournamentLeaseExpiries.push(instance);
      }
    },
    onRefundPending: instance => {
      resumeTournamentRefund(
        refundDependencies,
        instance,
        Date.now(),
        instance.statusReason === 'financial-invariant'
          ? 'financial-invariant'
          : 'server-restart-unrecoverable',
      );
    },
    onError: (error, context) => {
      eventLog.log('tournament-scheduler-error', {
        data: {
          phase: context.phase,
          instanceId: context.instanceId,
          retryAttempt: context.retryAttempt,
          error: error.message,
        },
      });
    },
  });
  const tournamentRecovery = new TournamentRecoveryService({
    loadAndValidate: () => loadTournamentRecoveryPlan(database!, Date.now()),
    recoverGeneric: options => {
      economyService!.recoverActiveCashEscrows();
      return economyRuntime!.recoverIncompleteEntries(options);
    },
    resumeRefund: (instanceId, reason) => {
      const instance = tournamentInstances.getInstance(instanceId);
      if (!instance) {
        throw new Error(`Tournament recovery instance missing: ${instanceId}`);
      }
      resumeTournamentRefund(
        refundDependencies,
        instance,
        Date.now(),
        reason,
      );
    },
    resumePayout: instanceId => {
      // The stored-plan executor is supplied with settlement integration.
      // Until then, fail closed instead of ever reclassifying payout as refund.
      throw new Error(
        `Tournament payout recovery executor is unavailable: ${instanceId}`,
      );
    },
    reconcileTemplatesAndTimers: () => {
      tournamentScheduler!.reconcileAndHydrate();
    },
  });
  tournamentRecovery.recoverBeforeListen();
  const arenaConfig = parseArenaRuntimeConfig(process.env);
  if (arenaConfig.enabled) {
    const arenaRepository = new ArenaRepository(database);
    arenaMetrics = new ArenaMetrics({
      logger: console,
      collectTierDistribution: () => arenaRepository.countTierDistribution(
        calculateArenaSeasonWindow(Date.now(), arenaConfig).id,
      ),
    });
    arenaService = new ArenaService(arenaRepository, {
      ...arenaConfig,
      metrics: arenaMetrics,
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
    arenaHttpService = new ArenaHttpDataService(arenaService, arenaRepository);
    arenaService.recoverUnfinishedMatches();
    arenaService.reconcile(Date.now());
    arenaScheduler = new ArenaScheduler({
      epochMs: arenaConfig.epochMs,
      reconcile: at => arenaService!.reconcile(at),
      logger: console,
    });
  }
  // 개발: Node 런타임이 native sqlite backup(23.8+)을 지원하지 않으면 백업을 비활성하고 기동한다.
  // 프로덕션은 무조건 구성 — 미지원 런타임이면 시작 백업에서 실패하는 것이 맞다.
  if (dev && !isNativeSqliteBackupSupported()) {
    console.warn(
      '> node:sqlite native backup을 지원하지 않는 Node 런타임 — dev 백업 비활성 (Node 23.8+ 필요)',
    );
    return;
  }
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

  // 운영 이벤트 영속화 — 신호 이벤트(429·정산 실패·grace 만료 등)를 SQLite로 남겨
  // 재시작 후에도 장애를 역추적할 수 있게 한다 (/api/admin/events)
  const opsEvents = new OpsEventRepository(database);
  const promotionFunds = new PromotionFundRepository(database);
  eventLog.setPersistentSink(event => {
    if (shouldPersistOpsEvent(event)) opsEvents.record(event);
  });
  const profileRepositoryForActivity = new ProfileRepository(database);

  const handle = app.getRequestHandler();
  const server = createServer(createHttpRequestHandler(handle, {
    database,
    profileManager,
    economyService,
    progressionService,
    arenaHttpService,
    arenaEnabled: () => arenaService !== undefined,
    ready: () => lifecycleReady,
    profileRateLimiter,
    profileConcurrencyGate,
    production: !dev,
    onProfileRevoked: profileId => runtime?.revokeProfile(profileId),
    onAvatarChanged: (profileId, avatarId) => runtime?.refreshAvatar(profileId, avatarId),
    onProgressionPublicCosmeticsChanged: (profileId, snapshot) => {
      runtime?.refreshPublicCosmetics(profileId, snapshot);
    },
    opsEvents,
    promotionFunds,
    promotionFundRateLimiter: profileRateLimiter,
    gameConfig: gameConfigService,
    adminTournamentCommands: {
      create: draft => runtime
        ? runtime.tournamentCommands.create({ kind: 'backoffice' }, draft)
        : { ok: false, reason: 'invalid' },
      start: tournamentId => runtime
        ? runtime.tournamentCommands.start({ kind: 'backoffice' }, tournamentId)
        : 'not-found',
      act: (tournamentId, action) => runtime
        ? runtime.tournamentCommands.act({ kind: 'backoffice' }, tournamentId, action)
        : 'not-found',
    },
    adminRuntime: () => {
      if (!runtime) return null;
      return {
        sessions: runtime.sessions.stats(),
        sessionList: runtime.sessions.snapshot(),
        rooms: runtime.roomManager.getAdminRoomSummaries(),
        roomRuntime: { ...runtime.roomManager.getRuntimeStats() } as Record<string, number>,
        tournaments: runtime.tournamentManager.getAdminSummaries(),
      };
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
    onProfileConnected: profileId => {
      try {
        profileRepositoryForActivity.recordConnect(profileId, Date.now());
      } catch {
        // 활동 지표 실패는 접속에 영향 없음
      }
    },
    economy: economyRuntime,
    persistentTournamentStart,
    progressionService,
    handHistory: handHistoryService,
    ...(arenaService
      ? {
        arena: {
          service: arenaService,
          metrics: arenaMetrics,
        },
      }
      : {}),
  });

  for (const pending of pendingTournamentLeaseExpiries.splice(0)) {
    runtime.tournamentCommands.processExpiredStartLease(pending);
  }
  const startupInstances = new TournamentInstanceRepository(database!);
  for (const pending of pendingTournamentStarts.splice(0)) {
    const current = startupInstances.getInstance(pending.instance.id);
    if (
      current?.status !== 'starting'
      || current.startOwnerId !== pending.instance.startOwnerId
    ) {
      continue;
    }
    if (
      current.startLeaseUntil !== null
      && current.startLeaseUntil <= Date.now()
    ) {
      runtime.tournamentCommands.processExpiredStartLease(current);
      continue;
    }
    runtime.tournamentCommands.processStartClaim(pending.instance);
  }

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

  // 재시작/배포 마커 — 장애 시각 상관관계의 기준점 (ops_event로 영속)
  eventLog.log('server-start', { data: { production: !dev, port } });
}

void startServerLifecycle({
  prepare: () => app.prepare(),
  recover: () => initializePersistenceAndRecover(),
  backup: async () => {
    await backupManager?.backup();
  },
  listen,
  startScheduler: () => {
    backupScheduler?.start();
    arenaScheduler?.start();
    runtime?.startArena();
    lifecycleReady = true;
  },
  shutdown,
  process,
  production: !dev,
  forceExitMs: FORCE_EXIT_MS,
  logger: console,
}).then(started => {
  if (started) console.log(`> Poker server ready on http://${hostname}:${port}`);
});
