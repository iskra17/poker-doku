import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { Server } from 'socket.io';
import { io as createClient } from 'socket.io-client';
import type { PublicProfile } from '../lib/profile/types';
import type { ProgressionSnapshot } from '../lib/progression/types';
import type {
  ClientToServerEvents,
  PokerClientSocket,
  ServerToClientEvents,
} from '../lib/realtime/protocol';
import { eventLog, type LogEvent } from './event-log';
import { ArenaRepository } from './arena-repository';
import { ArenaService } from './arena-service';
import { EconomyRepository } from './economy-repository';
import { EconomyRuntime } from './economy-runtime';
import { EconomyService } from './economy-service';
import {
  TransientHttpConcurrencyGate,
  TransientHttpRateLimiter,
} from './http-rate-limit';
import { openPokerDatabase } from './persistence/database';
import { PROFILE_COOKIE_NAME } from './profile-http';
import { ProfileManager, type ProfileKdf } from './profile-manager';
import { ProfileRepository } from './profile-repository';
import { ProgressionRepository } from './progression-repository';
import { ProgressionService } from './progression-service';
import { getCollectionItemDefinition } from '../lib/collection/catalog';
import {
  setupSocketHandlers,
  type AuthenticatedSocketData,
  type SocketRuntime,
} from './socket-handler';

export interface ConnectedTestClient {
  socket: PokerClientSocket;
  playerId: string;
  initialProgression: ProgressionSnapshot;
}

export interface TestProfileCredential {
  profile: PublicProfile;
  cookie: string;
  recoveryWords: string;
}

export interface TestConnectOptions {
  /** undefined creates/caches a profile for legacy tests; null deliberately omits the cookie. */
  profileCookie?: string | null;
}

export interface SocketTestHarness {
  runtime: SocketRuntime;
  economyRuntime: EconomyRuntime;
  progressionService: ProgressionService;
  grantProgressionItem: (profileId: string, itemId: string) => void;
  profileManager: ProfileManager;
  createProfile: (input?: { avatarId?: string }) => Promise<TestProfileCredential>;
  recoverProfile: (recoveryWords: string) => Promise<TestProfileCredential | null>;
  connect: (
    sessionToken: string,
    options?: TestConnectOptions,
  ) => Promise<ConnectedTestClient>;
  getServerSocketData: (socketId: string) => AuthenticatedSocketData | undefined;
  getServerSocketCookie: (socketId: string) => string | undefined;
  getServerSocketRawHeaders: (socketId: string) => string[] | undefined;
  getServerSocketAuth: (socketId: string) => Record<string, unknown> | undefined;
  getServerSocketRooms: (socketId: string) => string[];
  failNextServerSocketJoin: (socketId: string) => Promise<void>;
  recentEvents: () => LogEvent[];
  walletState: (profileId: string) => {
    balance: number;
    activeEscrow: number;
    activeRoomId: string | null;
  };
  arenaSnapshot: (
    profileId: string,
  ) => ReturnType<ArenaService['getSnapshot']> | null;
  close: () => Promise<void>;
}

export interface SocketTestHarnessOptions {
  graceMs?: number;
  sngRetentionMs?: number;
  profileKdf?: ProfileKdf;
  profileConcurrency?: number;
  profileAuthLimit?: number;
  arenaEnabled?: boolean;
}

const fastTestKdf: ProfileKdf = {
  derive: async (secret, salt) => createHash('sha256')
    .update(secret, 'utf8')
    .update(salt)
    .digest(),
};

function credentialCookie(credential: string): string {
  return `${PROFILE_COOKIE_NAME}=${credential}`;
}

export async function createSocketTestHarness(
  options: SocketTestHarnessOptions = {},
): Promise<SocketTestHarness> {
  const database = openPokerDatabase(':memory:');
  const profileManager = new ProfileManager(
    new ProfileRepository(database),
    undefined,
    undefined,
    options.profileKdf ?? fastTestKdf,
  );
  const economyService = new EconomyService(new EconomyRepository(database));
  const economyRuntime = new EconomyRuntime(economyService);
  const progressionRepository = new ProgressionRepository(database);
  const progressionService = new ProgressionService(database, progressionRepository);
  const grantProgressionItem = (profileId: string, itemId: string): void => {
    const identity = database.db.prepare(
      'SELECT avatar_id FROM profiles WHERE id = ?',
    ).get(profileId) as { avatar_id: string } | undefined;
    if (!identity) throw new Error(`Unknown profile: ${profileId}`);
    progressionService.getRuntimeSnapshot(profileId, identity.avatar_id, Date.now());
    const definition = getCollectionItemDefinition(itemId);
    if (!definition || definition.source.kind === 'streak') {
      throw new Error(`Not a permanent reward: ${itemId}`);
    }
    const source = definition.source;
    if (source.kind === 'dojo-level') {
      database.db.prepare(`
        UPDATE progression_profiles SET dojo_level = ?, dojo_xp_milli = 0
        WHERE profile_id = ? AND dojo_level < ?
      `).run(source.level, profileId, source.level);
    } else {
      database.db.prepare(`
        INSERT INTO character_affinity (profile_id, character_id, level, xp_milli)
        VALUES (?, ?, ?, 0)
        ON CONFLICT(profile_id, character_id) DO UPDATE SET
          level = MAX(level, excluded.level), xp_milli = 0
      `).run(profileId, source.characterId, source.level);
    }
    const sourceEventId = `harness-grant-${itemId}`;
    database.transaction(() => {
      progressionRepository.grantPermanentInventoryItemInTransaction({
        profileId, itemId, sourceEventId, source, grantedAt: 1,
      });
      progressionRepository.insertProgressionEvent({
        idempotencyKey: sourceEventId,
        profileId,
        eventType: 'completed-hand',
        balanceVersion: 1,
        summary: {
          eventId: sourceEventId,
          dojoXpMilli: 0,
          dojoLevelsGained: source.kind === 'dojo-level' ? [source.level] : [],
          characterId: source.kind === 'affinity-level' ? source.characterId : 'sakura',
          affinityMilli: 0,
          affinityLevelsGained: source.kind === 'affinity-level' ? [source.level] : [],
          missionCompletions: [],
          grantedItemIds: [itemId],
        },
        createdAt: 1,
      });
    });
  };
  economyRuntime.recoverActiveEscrows();
  const profileRateLimiter = new TransientHttpRateLimiter({
    profileAuth: {
      limit: options.profileAuthLimit ?? 1_000,
      windowMs: 60_000,
    },
  });
  const profileConcurrencyGate = new TransientHttpConcurrencyGate(
    options.profileConcurrency ?? 4,
  );
  const httpServer = createServer();
  const io = new Server<
    ClientToServerEvents,
    ServerToClientEvents,
    Record<string, never>,
    AuthenticatedSocketData
  >(httpServer, {
    transports: ['websocket'],
  });
  const runtimeRef: { current?: SocketRuntime } = {};
  const arenaService = options.arenaEnabled
    ? new ArenaService(new ArenaRepository(database), {
      epochMs: Date.parse('2026-06-01T00:00:00+09:00'),
      preseasonCount: 1,
      isProfileInNonArenaSeat: profileId => {
        if (economyService.getStatus(profileId).economy.hasActiveSeat) {
          return true;
        }
        if (!runtimeRef.current) return false;
        return runtimeRef.current.sessions.getByPlayerId(profileId)?.roomId != null
          || runtimeRef.current.roomManager.getRoomList(profileId)
            .some(room => room.mySeat !== undefined);
      },
    })
    : undefined;
  const runtime = setupSocketHandlers(io, {
    profileAuth: {
      manager: profileManager,
      rateLimiter: profileRateLimiter,
      concurrencyGate: profileConcurrencyGate,
    },
    createDefaultRooms: false,
    sweepIntervalMs: 0,
    graceMs: options.graceMs ?? 50,
    sngRetentionMs: options.sngRetentionMs,
    economy: economyRuntime,
    progressionService,
    ...(arenaService
      ? {
        arena: {
          service: arenaService,
          matchIdFactory: (() => {
            let sequence = 0;
            return () => `harness-match-${++sequence}`;
          })(),
        },
      }
      : {}),
  });
  runtimeRef.current = runtime;
  runtime.startArena();
  const clients = new Set<PokerClientSocket>();
  const legacyProfiles = new Map<string, TestProfileCredential>();
  let closed = false;

  const createProfile = async (
    input: { avatarId?: string } = {},
  ): Promise<TestProfileCredential> => {
    const created = await profileManager.create({
      avatarId: input.avatarId ?? 'sakura',
      adultConfirmed: true,
    });
    return {
      profile: created.profile,
      cookie: credentialCookie(created.credential),
      recoveryWords: created.recoveryWords,
    };
  };

  const recoverProfile = async (
    recoveryWords: string,
  ): Promise<TestProfileCredential | null> => {
    const recovered = await profileManager.recover(recoveryWords);
    return recovered ? {
      profile: recovered.profile,
      cookie: credentialCookie(recovered.credential),
      recoveryWords: recovered.recoveryWords,
    } : null;
  };

  await new Promise<void>((resolve, reject) => {
    httpServer.once('error', reject);
    httpServer.listen(0, '127.0.0.1', () => {
      httpServer.off('error', reject);
      resolve();
    });
  });

  const { port } = httpServer.address() as AddressInfo;

  return {
    runtime,
    economyRuntime,
    progressionService,
    grantProgressionItem,
    profileManager,
    createProfile,
    recoverProfile,
    connect: async (sessionToken, connectOptions = {}) => {
      let profileCookie = connectOptions.profileCookie;
      if (profileCookie === undefined) {
        let profile = legacyProfiles.get(sessionToken);
        if (!profile) {
          profile = await createProfile();
          legacyProfiles.set(sessionToken, profile);
        }
        profileCookie = profile.cookie;
      }
      return new Promise((resolve, reject) => {
        const socket = createClient(
          `http://127.0.0.1:${port}`,
          {
            transports: ['websocket'],
            auth: { sessionToken },
            forceNew: true,
            reconnection: false,
            ...(profileCookie === null
              ? {}
              : { extraHeaders: { Cookie: profileCookie } }),
          },
        ) as PokerClientSocket;
        clients.add(socket);

        const onConnectError = (error: Error): void => {
          socket.disconnect();
          clients.delete(socket);
          reject(error);
        };
        let playerId: string | undefined;
        let initialProgression: ProgressionSnapshot | undefined;
        const resolveWhenReady = (): void => {
          if (!playerId || !initialProgression) return;
          socket.off('connect_error', onConnectError);
          resolve({ socket, playerId, initialProgression });
        };
        socket.once('connect_error', onConnectError);
        socket.once('session', data => {
          playerId = data.playerId;
          resolveWhenReady();
        });
        socket.once('progression-update', snapshot => {
          initialProgression = snapshot;
          resolveWhenReady();
        });
      });
    },
    getServerSocketData: socketId => io.sockets.sockets.get(socketId)?.data,
    getServerSocketCookie: socketId => io.sockets.sockets
      .get(socketId)?.handshake.headers.cookie,
    getServerSocketRawHeaders: socketId => io.sockets.sockets
      .get(socketId)?.request.rawHeaders,
    getServerSocketAuth: socketId => io.sockets.sockets
      .get(socketId)?.handshake.auth as Record<string, unknown> | undefined,
    getServerSocketRooms: socketId => [
      ...(io.sockets.sockets.get(socketId)?.rooms ?? []),
    ],
    failNextServerSocketJoin: socketId => new Promise((resolve, reject) => {
      const socket = io.sockets.sockets.get(socketId);
      if (!socket) {
        reject(new Error('server socket not found'));
        return;
      }
      const originalJoin = socket.join.bind(socket);
      let armed = true;
      socket.join = rooms => {
        if (armed) {
          armed = false;
          resolve();
          throw new Error('injected room binding failure');
        }
        return originalJoin(rooms);
      };
    }),
    recentEvents: () => eventLog.recent(),
    walletState: profileId => {
      const row = database.db.prepare(`
        SELECT
          wallets.balance,
          COALESCE(seat_escrows.amount, 0) AS active_escrow,
          seat_escrows.room_id AS active_room_id
        FROM wallets
        LEFT JOIN seat_escrows
          ON seat_escrows.profile_id = wallets.profile_id
          AND seat_escrows.status = 'active'
        WHERE wallets.profile_id = ?
      `).get(profileId) as {
        balance: number;
        active_escrow: number;
        active_room_id: string | null;
      };
      return {
        balance: row.balance,
        activeEscrow: row.active_escrow,
        activeRoomId: row.active_room_id,
      };
    },
    arenaSnapshot: profileId => arenaService?.getSnapshot(profileId) ?? null,
    close: async () => {
      if (closed) return;
      closed = true;
      for (const socket of clients) socket.disconnect();
      clients.clear();
      await runtime.close();
      await new Promise<void>(resolve => io.close(() => resolve()));
      if (httpServer.listening) {
        await new Promise<void>((resolve, reject) => {
          httpServer.close(error => error ? reject(error) : resolve());
        });
      }
      profileRateLimiter.close();
      database.close();
    },
  };
}
