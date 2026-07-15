export interface ImmediateCloseable {
  close: () => void | Promise<void>;
}

export interface CallbackCloseable {
  close: (callback: (error?: Error) => void) => unknown;
}

export interface ServerShutdownResources {
  runtime: ImmediateCloseable;
  io: CallbackCloseable;
  httpServer: CallbackCloseable;
  app: ImmediateCloseable;
}

export type ServerShutdown = (reason: string) => Promise<void>;

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

    await attempt(() => resources.runtime.close());
    await attempt(() => closeWithCallback(resources.io));
    await attempt(() => closeWithCallback(resources.httpServer));
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
