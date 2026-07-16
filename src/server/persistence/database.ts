import {
  DatabaseSync,
  type DatabaseSyncOptions,
} from 'node:sqlite';
import { applyMigrations } from './migrations';

const BUSY_TIMEOUT_MS = 5_000;
const SYNCHRONOUS_TRANSACTION_ERROR =
  'PokerDatabase transactions must be synchronous';

type SyncWork<TWork extends () => unknown> =
  [ReturnType<TWork>] extends [never]
    ? TWork
    : ReturnType<TWork> extends PromiseLike<unknown> ? never : TWork;

function supportsConstructorTimeout(nodeVersion: string): boolean {
  const [major = 0, minor = 0] = nodeVersion.split('.').map(Number);
  return major > 22 || (major === 22 && minor >= 16);
}

function isPromiseLike(value: unknown): value is PromiseLike<unknown> {
  return (
    value !== null
    && (typeof value === 'object' || typeof value === 'function')
    && typeof (value as { then?: unknown }).then === 'function'
  );
}

function isNativeAsyncFunction(work: () => unknown): boolean {
  return Object.prototype.toString.call(work) === '[object AsyncFunction]';
}

export class PokerDatabase {
  readonly db: DatabaseSync;
  private transactionActive = false;

  constructor(path: string) {
    const options: DatabaseSyncOptions = {
      enableForeignKeyConstraints: true,
    };
    if (supportsConstructorTimeout(process.versions.node)) {
      options.timeout = BUSY_TIMEOUT_MS;
    }

    const db = new DatabaseSync(path, options);
    try {
      db.exec(`
        PRAGMA journal_mode=WAL;
        PRAGMA synchronous=FULL;
        PRAGMA busy_timeout=${BUSY_TIMEOUT_MS};
      `);
      applyMigrations(db);
    } catch (error) {
      try {
        db.close();
      } catch {
        // Preserve the initialization error that explains why opening failed.
      }
      throw error;
    }
    this.db = db;
  }

  tableNames(): string[] {
    return this.db
      .prepare(`
        SELECT name
        FROM sqlite_schema
        WHERE type = 'table' AND name NOT LIKE 'sqlite_%'
        ORDER BY name
      `)
      .all()
      .map((row) => (row as { name: string }).name);
  }

  transaction<TWork extends () => unknown>(
    work: SyncWork<TWork>,
  ): ReturnType<TWork> {
    if (this.transactionActive) {
      throw new Error('Nested transactions are not supported');
    }
    if (isNativeAsyncFunction(work)) {
      throw new Error(SYNCHRONOUS_TRANSACTION_ERROR);
    }

    this.transactionActive = true;
    try {
      this.db.exec('BEGIN IMMEDIATE');
      try {
        const value = work();
        if (isPromiseLike(value)) {
          throw new Error(SYNCHRONOUS_TRANSACTION_ERROR);
        }
        this.db.exec('COMMIT');
        return value as ReturnType<TWork>;
      } catch (error) {
        this.db.exec('ROLLBACK');
        throw error;
      }
    } finally {
      this.transactionActive = false;
    }
  }

  close(): void {
    this.db.close();
  }
}

export function openPokerDatabase(path: string): PokerDatabase {
  return new PokerDatabase(path);
}
