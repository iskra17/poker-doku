import {
  DatabaseSync,
  type DatabaseSyncOptions,
} from 'node:sqlite';
import { applyMigrations } from './migrations';

const BUSY_TIMEOUT_MS = 5_000;

function supportsConstructorTimeout(nodeVersion: string): boolean {
  const [major = 0, minor = 0] = nodeVersion.split('.').map(Number);
  return major > 22 || (major === 22 && minor >= 16);
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

    this.db = new DatabaseSync(path, options);
    this.db.exec(`
      PRAGMA journal_mode=WAL;
      PRAGMA synchronous=FULL;
      PRAGMA busy_timeout=${BUSY_TIMEOUT_MS};
    `);
    applyMigrations(this.db);
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

  transaction<T>(work: () => T): T {
    if (this.transactionActive) {
      throw new Error('Nested transactions are not supported');
    }

    this.transactionActive = true;
    try {
      this.db.exec('BEGIN IMMEDIATE');
      try {
        const value = work();
        this.db.exec('COMMIT');
        return value;
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
