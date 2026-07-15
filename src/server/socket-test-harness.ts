import { createServer } from 'http';
import type { AddressInfo } from 'net';
import { Server } from 'socket.io';
import { io as createClient } from 'socket.io-client';
import type {
  ClientToServerEvents,
  PokerClientSocket,
  ServerToClientEvents,
} from '../lib/realtime/protocol';
import { setupSocketHandlers } from './socket-handler';
import type { SocketRuntime } from './socket-handler';

export interface ConnectedTestClient {
  socket: PokerClientSocket;
  playerId: string;
}

export interface SocketTestHarness {
  runtime: SocketRuntime;
  connect: (sessionToken: string) => Promise<ConnectedTestClient>;
  close: () => Promise<void>;
}

export interface SocketTestHarnessOptions {
  graceMs?: number;
  sngRetentionMs?: number;
}

export async function createSocketTestHarness(
  options: SocketTestHarnessOptions = {},
): Promise<SocketTestHarness> {
  const httpServer = createServer();
  const io = new Server<ClientToServerEvents, ServerToClientEvents>(httpServer, {
    transports: ['websocket'],
  });
  const runtime = setupSocketHandlers(io, {
    createDefaultRooms: false,
    sweepIntervalMs: 0,
    graceMs: options.graceMs ?? 50,
    sngRetentionMs: options.sngRetentionMs,
  });
  const clients = new Set<PokerClientSocket>();

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
    connect: (sessionToken: string) => new Promise((resolve, reject) => {
      const socket = createClient(
        `http://127.0.0.1:${port}`,
        {
          transports: ['websocket'],
          auth: { sessionToken },
          forceNew: true,
          reconnection: false,
        },
      ) as PokerClientSocket;
      clients.add(socket);

      const onConnectError = (error: Error): void => {
        clients.delete(socket);
        reject(error);
      };
      socket.once('connect_error', onConnectError);
      socket.once('session', ({ playerId }) => {
        socket.off('connect_error', onConnectError);
        resolve({ socket, playerId });
      });
    }),
    close: async () => {
      for (const socket of clients) socket.disconnect();
      clients.clear();
      runtime.close();
      await new Promise<void>(resolve => io.close(() => resolve()));
      if (httpServer.listening) {
        await new Promise<void>((resolve, reject) => {
          httpServer.close(error => error ? reject(error) : resolve());
        });
      }
    },
  };
}
