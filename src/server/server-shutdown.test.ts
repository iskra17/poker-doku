import { describe, expect, it } from 'vitest';
import { createServerShutdown } from './server-shutdown';

function callbackCloseable(
  name: string,
  order: string[],
  error?: Error,
): { close: (callback: (closeError?: Error) => void) => void } {
  return {
    close: callback => {
      order.push(name);
      queueMicrotask(() => callback(error));
    },
  };
}

describe('custom server shutdown', () => {
  it('is idempotent and closes resources in dependency order', async () => {
    const order: string[] = [];
    const shutdown = createServerShutdown({
      runtime: {
        close: () => {
          order.push('runtime');
        },
      },
      io: callbackCloseable('socket.io', order),
      httpServer: callbackCloseable('http', order),
      app: {
        close: async () => {
          order.push('next');
        },
      },
    });

    const first = shutdown('SIGTERM');
    const second = shutdown('SIGINT');

    expect(second).toBe(first);
    await Promise.all([first, second]);
    expect(order).toEqual(['runtime', 'socket.io', 'http', 'next']);
  });

  it('attempts every close when an earlier resource reports an error', async () => {
    const order: string[] = [];
    const httpError = new Error('http close failed');
    const shutdown = createServerShutdown({
      runtime: {
        close: () => {
          order.push('runtime');
        },
      },
      io: callbackCloseable('socket.io', order),
      httpServer: callbackCloseable('http', order, httpError),
      app: {
        close: async () => {
          order.push('next');
        },
      },
    });

    await expect(shutdown('SIGTERM')).rejects.toMatchObject({
      errors: [httpError],
    });
    expect(order).toEqual(['runtime', 'socket.io', 'http', 'next']);
  });

  it('treats an HTTP server already closed by Socket.IO as cleanly closed', async () => {
    const order: string[] = [];
    const alreadyClosed = Object.assign(new Error('Server is not running'), {
      code: 'ERR_SERVER_NOT_RUNNING',
    });
    const shutdown = createServerShutdown({
      runtime: {
        close: () => {
          order.push('runtime');
        },
      },
      io: callbackCloseable('socket.io', order),
      httpServer: callbackCloseable('http', order, alreadyClosed),
      app: {
        close: async () => {
          order.push('next');
        },
      },
    });

    await expect(shutdown('SIGTERM')).resolves.toBeUndefined();
    expect(order).toEqual(['runtime', 'socket.io', 'http', 'next']);
  });

  it('continues shutdown when an async close rejects without calling back', async () => {
    const order: string[] = [];
    const socketError = new Error('socket close rejected');
    const rejectedClose = Promise.reject(socketError);
    void rejectedClose.catch(() => undefined);
    const shutdown = createServerShutdown({
      runtime: {
        close: () => {
          order.push('runtime');
        },
      },
      io: {
        close: () => {
          order.push('socket.io');
          return rejectedClose;
        },
      },
      httpServer: callbackCloseable('http', order),
      app: {
        close: async () => {
          order.push('next');
        },
      },
    });

    const outcome = await Promise.race([
      shutdown('SIGTERM').then(
        () => ({ status: 'resolved' as const }),
        error => ({ status: 'rejected' as const, error }),
      ),
      new Promise<{ status: 'pending' }>(resolve => {
        setTimeout(() => resolve({ status: 'pending' }), 0);
      }),
    ]);

    expect(outcome).toMatchObject({
      status: 'rejected',
      error: { errors: [socketError] },
    });
    expect(order).toEqual(['runtime', 'socket.io', 'http', 'next']);
  });
});
