import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { Server } from 'socket.io';
import { io as createClient } from 'socket.io-client';
import type { PublicProfile } from '../lib/profile/types';
import type {
  ClientToServerEvents,
  PokerClientSocket,
  ServerToClientEvents,
} from '../lib/realtime/protocol';
import { eventLog, type LogEvent } from './event-log';
import {
  TransientHttpConcurrencyGate,
  TransientHttpRateLimiter,
} from './http-rate-limit';
import { openPokerDatabase } from './persistence/database';
import { PROFILE_COOKIE_NAME } from './profile-http';
import { ProfileManager, type ProfileKdf } from './profile-manager';
import { ProfileRepository } from './profile-repository';
import {
  setupSocketHandlers,
  type AuthenticatedSocketData,
  type SocketRuntime,
} from './socket-handler';

export interface ConnectedTestClient {
  socket: PokerClientSocket;
  playerId: string;
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
  recentEvents: () => LogEvent[];
  close: () => Promise<void>;
}

export interface SocketTestHarnessOptions {
  graceMs?: number;
  sngRetentionMs?: number;
  profileKdf?: ProfileKdf;
  profileConcurrency?: number;
  profileAuthLimit?: number;
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
  });
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
        socket.once('connect_error', onConnectError);
        socket.once('session', ({ playerId }) => {
          socket.off('connect_error', onConnectError);
          resolve({ socket, playerId });
        });
      });
    },
    getServerSocketData: socketId => io.sockets.sockets.get(socketId)?.data,
    getServerSocketCookie: socketId => io.sockets.sockets
      .get(socketId)?.handshake.headers.cookie,
    getServerSocketRawHeaders: socketId => io.sockets.sockets
      .get(socketId)?.request.rawHeaders,
    recentEvents: () => eventLog.recent(),
    close: async () => {
      if (closed) return;
      closed = true;
      for (const socket of clients) socket.disconnect();
      clients.clear();
      runtime.close();
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
