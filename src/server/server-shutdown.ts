export interface ImmediateCloseable {
  close: () => void | Promise<void>;
}

export interface CallbackCloseable {
  close: (callback: (error?: Error) => void) => unknown;
}

export interface ServerShutdownResources {
  backup?: {
    stopScheduler: () => void | Promise<void>;
    backup: () => void | Promise<void>;
  };
  runtime: ImmediateCloseable;
  rateLimiter?: ImmediateCloseable;
  io: CallbackCloseable;
  httpServer: CallbackCloseable;
  database?: ImmediateCloseable;
  app: ImmediateCloseable;
}

export type ServerShutdown = (reason: string) => Promise<void>;
export type ShutdownSignal = 'SIGTERM' | 'SIGINT';

export interface ServerProcess {
  exitCode?: string | number | null;
  once: (
    signal: ShutdownSignal,
    listener: (signal: ShutdownSignal) => void,
  ) => unknown;
  off: (
    signal: ShutdownSignal,
    listener: (signal: ShutdownSignal) => void,
  ) => unknown;
  exit: (code: number) => unknown;
}

export interface ServerLifecycleOptions {
  prepare: () => Promise<void>;
  recover?: () => void | Promise<void>;
  backup?: () => Promise<unknown>;
  listen: () => Promise<void>;
  startScheduler?: () => void;
  shutdown: ServerShutdown;
  process: ServerProcess;
  production: boolean;
  forceExitMs?: number;
  logger: {
    error: (message: string, error?: unknown) => void;
  };
}

function isPromiseLike(value: unknown): value is PromiseLike<unknown> {
  return (
    value !== null
    && (typeof value === 'object' || typeof value === 'function')
    && typeof (value as { then?: unknown }).then === 'function'
  );
}

function isServerAlreadyClosed(error: unknown): boolean {
  return (
    typeof error === 'object'
    && error !== null
    && 'code' in error
    && error.code === 'ERR_SERVER_NOT_RUNNING'
  );
}

function closeWithCallback(resource: CallbackCloseable): Promise<void> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const succeed = (): void => {
      if (settled) return;
      settled = true;
      resolve();
    };
    const fail = (error: unknown): void => {
      if (settled) return;
      settled = true;
      if (!isServerAlreadyClosed(error)) {
        reject(error);
        return;
      }
      resolve();
    };

    try {
      const result = resource.close(error => {
        if (error) fail(error);
        else succeed();
      });
      if (isPromiseLike(result)) {
        void Promise.resolve(result).then(succeed, fail);
      }
    } catch (error) {
      fail(error);
    }
  });
}

export function createServerShutdown(
  resources: ServerShutdownResources,
): ServerShutdown {
  let shutdownPromise: Promise<void> | undefined;

  const run = async (reason: string): Promise<void> => {
    const errors: unknown[] = [];
    const attempt = async (close: () => void | Promise<void>): Promise<void> => {
      try {
        await close();
      } catch (error) {
        errors.push(error);
      }
    };

    const backup = resources.backup;
    if (backup) await attempt(() => backup.stopScheduler());
    await attempt(() => resources.runtime.close());
    await attempt(() => closeWithCallback(resources.io));
    await attempt(() => closeWithCallback(resources.httpServer));
    const rateLimiter = resources.rateLimiter;
    if (rateLimiter) await attempt(() => rateLimiter.close());
    if (backup && reason !== 'startup-error') {
      await attempt(() => backup.backup());
    }
    const database = resources.database;
    if (database) await attempt(() => database.close());
    await attempt(() => resources.app.close());

    if (errors.length > 0) {
      throw new AggregateError(errors, `Server shutdown failed (${reason})`);
    }
  };

  return reason => {
    shutdownPromise ??= run(reason);
    return shutdownPromise;
  };
}

export async function startServerLifecycle(
  options: ServerLifecycleOptions,
): Promise<boolean> {
  try {
    await options.prepare();
    await options.recover?.();
    await options.backup?.();
    await options.listen();
    options.startScheduler?.();
  } catch (startupError) {
    let reportedError = startupError;
    try {
      await options.shutdown('startup-error');
    } catch (cleanupError) {
      reportedError = new AggregateError(
        [startupError, cleanupError],
        'Server startup and cleanup failed',
      );
    }
    options.logger.error('> Poker server failed to start:', reportedError);
    options.process.exitCode = 1;
    return false;
  }

  let shutdownStarted = false;
  const removeSignalListeners = (): void => {
    options.process.off('SIGTERM', handleSignal);
    options.process.off('SIGINT', handleSignal);
  };
  const handleSignal = (signal: ShutdownSignal): void => {
    if (shutdownStarted) return;
    shutdownStarted = true;
    removeSignalListeners();

    const forceExitTimer = options.production
      ? setTimeout(() => {
          options.logger.error(
            `> Poker server shutdown timed out after ${options.forceExitMs ?? 10_000}ms`,
          );
          options.process.exit(1);
        }, options.forceExitMs ?? 10_000)
      : undefined;

    void options.shutdown(signal).then(
      () => {
        if (forceExitTimer) clearTimeout(forceExitTimer);
      },
      error => {
        options.logger.error(`> Poker server shutdown failed (${signal}):`, error);
        options.process.exitCode = 1;
      },
    );
  };

  options.process.once('SIGTERM', handleSignal);
  options.process.once('SIGINT', handleSignal);
  return true;
}
