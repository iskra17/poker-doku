import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createServerShutdown,
  startServerLifecycle,
  type ShutdownSignal,
} from './server-shutdown';

type SignalListener = (signal: ShutdownSignal) => void;

class FakeProcess {
  exitCode: string | number | null | undefined;
  readonly listeners = new Map<ShutdownSignal, SignalListener>();
  readonly onceCalls: ShutdownSignal[] = [];
  readonly offCalls: ShutdownSignal[] = [];
  readonly exitCalls: number[] = [];

  once(signal: ShutdownSignal, listener: SignalListener): this {
    this.onceCalls.push(signal);
    this.listeners.set(signal, listener);
    return this;
  }

  off(signal: ShutdownSignal, listener: SignalListener): this {
    this.offCalls.push(signal);
    if (this.listeners.get(signal) === listener) this.listeners.delete(signal);
    return this;
  }

  exit(code: number): void {
    this.exitCalls.push(code);
  }

  emit(signal: ShutdownSignal): void {
    const listener = this.listeners.get(signal);
    if (!listener) return;
    this.listeners.delete(signal);
    listener(signal);
  }
}

function deferred(): {
  promise: Promise<void>;
  resolve: () => void;
} {
  let resolve!: () => void;
  const promise = new Promise<void>(done => {
    resolve = done;
  });
  return { promise, resolve };
}

afterEach(() => {
  vi.useRealTimers();
});

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
      rateLimiter: {
        close: () => {
          order.push('rate-limiter');
        },
      },
      io: callbackCloseable('socket.io', order),
      httpServer: callbackCloseable('http', order),
      database: {
        close: () => {
          order.push('database');
        },
      },
      backup: {
        stopScheduler: () => {
          order.push('backup-stop');
        },
        backupAfterCurrent: async () => {
          order.push('final-backup');
        },
      },
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
    expect(order).toEqual([
      'backup-stop',
      'runtime',
      'socket.io',
      'http',
      'rate-limiter',
      'final-backup',
      'database',
      'next',
    ]);
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

    let pendingTimer: ReturnType<typeof setTimeout> | undefined;
    let outcome;
    try {
      outcome = await Promise.race([
        shutdown('SIGTERM').then(
          () => ({ status: 'resolved' as const }),
          error => ({ status: 'rejected' as const, error }),
        ),
        new Promise<{ status: 'pending' }>(resolve => {
          pendingTimer = setTimeout(() => resolve({ status: 'pending' }), 0);
        }),
      ]);
    } finally {
      if (pendingTimer !== undefined) clearTimeout(pendingTimer);
    }

    expect(outcome).toMatchObject({
      status: 'rejected',
      error: { errors: [socketError] },
    });
    expect(order).toEqual(['runtime', 'socket.io', 'http', 'next']);
  });
});

describe('custom server process lifecycle', () => {
  it('recovers economy, backs up, listens, then starts the scheduler in order', async () => {
    const order: string[] = [];
    const process = new FakeProcess();

    await expect(startServerLifecycle({
      prepare: async () => { order.push('prepare'); },
      recover: async () => { order.push('recover'); },
      backup: async () => { order.push('backup'); },
      listen: async () => { order.push('listen'); },
      startScheduler: () => { order.push('schedule'); },
      shutdown: async () => undefined,
      process,
      production: false,
      logger: { error: vi.fn() },
    })).resolves.toBe(true);

    expect(order).toEqual([
      'prepare', 'recover', 'backup', 'listen', 'schedule',
    ]);
  });

  it('surfaces a startup backup failure before listen and exits nonzero', async () => {
    const process = new FakeProcess();
    const backupError = new Error('startup backup failed');
    const listen = vi.fn(async () => undefined);
    const shutdown = vi.fn(async () => undefined);
    const logger = { error: vi.fn() };

    await expect(startServerLifecycle({
      prepare: async () => undefined,
      recover: async () => undefined,
      backup: async () => { throw backupError; },
      listen,
      shutdown,
      process,
      production: true,
      logger,
    })).resolves.toBe(false);

    expect(listen).not.toHaveBeenCalled();
    expect(shutdown).toHaveBeenCalledWith('startup-error');
    expect(process.exitCode).toBe(1);
    expect(logger.error).toHaveBeenCalledWith(
      '> Poker server failed to start:',
      backupError,
    );
  });

  it('registers signal listeners once only after listen succeeds', async () => {
    const process = new FakeProcess();
    const listening = deferred();
    const lifecycle = startServerLifecycle({
      prepare: async () => undefined,
      listen: () => listening.promise,
      shutdown: async () => undefined,
      process,
      production: false,
      logger: { error: vi.fn() },
    });

    await Promise.resolve();
    expect(process.onceCalls).toEqual([]);

    listening.resolve();
    await expect(lifecycle).resolves.toBe(true);
    expect(process.onceCalls).toEqual(['SIGTERM', 'SIGINT']);
  });

  it('clears the production fallback and signal listeners after clean shutdown', async () => {
    vi.useFakeTimers();
    const process = new FakeProcess();
    const shutdownDone = deferred();
    const shutdownReasons: string[] = [];
    await startServerLifecycle({
      prepare: async () => undefined,
      listen: async () => undefined,
      shutdown: reason => {
        shutdownReasons.push(reason);
        return shutdownDone.promise;
      },
      process,
      production: true,
      forceExitMs: 25,
      logger: { error: vi.fn() },
    });

    process.emit('SIGTERM');
    expect(vi.getTimerCount()).toBe(1);

    shutdownDone.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(shutdownReasons).toEqual(['SIGTERM']);
    expect(vi.getTimerCount()).toBe(0);
    expect(process.listeners.size).toBe(0);
    expect(process.offCalls).toEqual(['SIGTERM', 'SIGINT']);
  });

  it('forces a nonzero exit when production shutdown hangs', async () => {
    vi.useFakeTimers();
    const process = new FakeProcess();
    await startServerLifecycle({
      prepare: async () => undefined,
      listen: async () => undefined,
      shutdown: () => new Promise<void>(() => undefined),
      process,
      production: true,
      forceExitMs: 25,
      logger: { error: vi.fn() },
    });

    process.emit('SIGINT');
    await vi.advanceTimersByTimeAsync(24);
    expect(process.exitCalls).toEqual([]);

    await vi.advanceTimersByTimeAsync(1);
    expect(process.exitCalls).toEqual([1]);
  });

  it('logs shutdown rejection, sets a nonzero exit code, and removes listeners', async () => {
    const process = new FakeProcess();
    const logger = { error: vi.fn() };
    const shutdownError = new Error('shutdown failed');
    await startServerLifecycle({
      prepare: async () => undefined,
      listen: async () => undefined,
      shutdown: async () => {
        throw shutdownError;
      },
      process,
      production: false,
      logger,
    });

    process.emit('SIGTERM');
    await Promise.resolve();
    await Promise.resolve();

    expect(logger.error).toHaveBeenCalledOnce();
    expect(logger.error).toHaveBeenCalledWith(
      '> Poker server shutdown failed (SIGTERM):',
      shutdownError,
    );
    expect(process.exitCode).toBe(1);
    expect(process.listeners.size).toBe(0);
  });

  it('closes Next and exits nonzero when prepare rejects before listening', async () => {
    const process = new FakeProcess();
    const startupError = new Error('prepare failed');
    const order: string[] = [];
    const logger = { error: vi.fn(() => { order.push('log'); }) };
    const listen = vi.fn(async () => undefined);
    const shutdown = createServerShutdown({
      runtime: { close: () => undefined },
      io: { close: callback => callback() },
      httpServer: { close: callback => callback() },
      app: { close: async () => { order.push('next'); } },
    });

    await expect(startServerLifecycle({
      prepare: async () => {
        throw startupError;
      },
      listen,
      shutdown,
      process,
      production: false,
      logger,
    })).resolves.toBe(false);

    expect(order).toEqual(['next', 'log']);
    expect(listen).not.toHaveBeenCalled();
    expect(process.onceCalls).toEqual([]);
    expect(process.exitCode).toBe(1);
    expect(logger.error).toHaveBeenCalledOnce();
    expect(logger.error).toHaveBeenCalledWith('> Poker server failed to start:', startupError);
  });

  it('cleans partially created resources when setup rejects before listen', async () => {
    const process = new FakeProcess();
    const logger = { error: vi.fn() };
    const setupError = new Error('setup failed');
    const order: string[] = [];
    let closeRuntime: (() => void) | undefined;
    let closeSocket: ((callback: (error?: Error) => void) => void) | undefined;
    let closeHttp: ((callback: (error?: Error) => void) => void) | undefined;
    const shutdown = createServerShutdown({
      runtime: { close: () => closeRuntime?.() },
      io: { close: callback => closeSocket ? closeSocket(callback) : callback() },
      httpServer: { close: callback => closeHttp ? closeHttp(callback) : callback() },
      app: { close: async () => { order.push('next'); } },
    });

    await expect(startServerLifecycle({
      prepare: async () => undefined,
      listen: async () => {
        closeHttp = callbackCloseable('http', order).close;
        closeSocket = callbackCloseable('socket.io', order).close;
        closeRuntime = () => { order.push('runtime'); };
        throw setupError;
      },
      shutdown,
      process,
      production: false,
      logger,
    })).resolves.toBe(false);

    expect(order).toEqual(['runtime', 'socket.io', 'http', 'next']);
    expect(process.onceCalls).toEqual([]);
    expect(process.exitCode).toBe(1);
    expect(logger.error).toHaveBeenCalledOnce();
    expect(logger.error).toHaveBeenCalledWith('> Poker server failed to start:', setupError);
  });
});
