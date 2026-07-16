import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { openPokerDatabase, type PokerDatabase } from './database';
import {
  applyMigrations,
  type Migration,
  validateMigrations,
} from './migrations';

describe('PokerDatabase migrations', () => {
  let database: PokerDatabase | undefined;
  const temporaryDirectories: string[] = [];

  afterEach(() => {
    database?.close();
    database = undefined;
    vi.restoreAllMocks();
    for (const directory of temporaryDirectories.splice(0)) {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('applies the initial schema migration', () => {
    database = openPokerDatabase(':memory:');

    const migration = database.db
      .prepare('SELECT MAX(version) AS version FROM schema_migrations')
      .get() as { version: number };
    const profileColumns = database.db
      .prepare('PRAGMA table_info(profiles)')
      .all()
      .map((column) => (column as { name: string }).name);

    expect(migration.version).toBe(1);
    expect(database.tableNames()).toEqual(
      expect.arrayContaining([
        'profiles',
        'wallets',
        'chip_ledger',
        'seat_escrows',
        'daily_claims',
        'rescue_claims',
        'sng_entries',
      ]),
    );
    expect(profileColumns).toEqual(
      expect.arrayContaining(['credential_lookup', 'recovery_lookup']),
    );
  });

  it('does not reapply migrations when reopening a file database', () => {
    const directory = mkdtempSync(join(tmpdir(), 'poker-doku-'));
    temporaryDirectories.push(directory);
    const path = join(directory, 'poker.sqlite');

    database = openPokerDatabase(path);
    database.close();
    database = openPokerDatabase(path);

    const result = database.db
      .prepare('SELECT COUNT(*) AS count FROM schema_migrations')
      .get() as { count: number };
    expect(result.count).toBe(1);
  });

  it('rejects migration versions unknown to this binary', () => {
    const directory = mkdtempSync(join(tmpdir(), 'poker-doku-'));
    temporaryDirectories.push(directory);
    const path = join(directory, 'poker.sqlite');
    const rawDatabase = new DatabaseSync(path);
    rawDatabase.exec(`
      CREATE TABLE schema_migrations (
        version INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        applied_at INTEGER NOT NULL
      ) STRICT;
      INSERT INTO schema_migrations (version, name, applied_at)
      VALUES (999, 'future', 0);
    `);
    rawDatabase.close();

    let unexpectedlyOpened: PokerDatabase | undefined;
    try {
      expect(() => {
        unexpectedlyOpened = openPokerDatabase(path);
      }).toThrowError('Unknown applied migration version: 999');
    } finally {
      unexpectedlyOpened?.close();
    }
  });

  it('closes a file handle when database initialization fails', () => {
    const directory = mkdtempSync(join(tmpdir(), 'poker-doku-'));
    temporaryDirectories.push(directory);
    const path = join(directory, 'poker.sqlite');
    createConflictingV1Database(path);
    const closeSpy = vi.spyOn(DatabaseSync.prototype, 'close');

    expect(() => openPokerDatabase(path)).toThrowError(
      'table profiles already exists',
    );
    expect(closeSpy).toHaveBeenCalledOnce();
    closeSpy.mockRestore();

    const reopened = new DatabaseSync(path);
    const result = reopened
      .prepare('SELECT COUNT(*) AS count FROM schema_migrations')
      .get() as { count: number };
    reopened.close();
    expect(result.count).toBe(0);
  });

  it('rolls back the whole migration when a V1 statement fails', () => {
    const rawDatabase = new DatabaseSync(':memory:');
    rawDatabase.exec(`
      CREATE TABLE schema_migrations (
        version INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        applied_at INTEGER NOT NULL
      ) STRICT;
      CREATE TABLE profiles (id TEXT PRIMARY KEY) STRICT;
    `);

    expect(() => applyMigrations(rawDatabase)).toThrowError(
      'table profiles already exists',
    );
    const migrationCount = rawDatabase
      .prepare('SELECT COUNT(*) AS count FROM schema_migrations')
      .get() as { count: number };
    const tableNames = rawDatabase
      .prepare(`
        SELECT name FROM sqlite_schema
        WHERE type = 'table' AND name NOT LIKE 'sqlite_%'
        ORDER BY name
      `)
      .all()
      .map(row => (row as { name: string }).name);
    rawDatabase.close();

    expect(migrationCount.count).toBe(0);
    expect(tableNames).toEqual(['profiles', 'schema_migrations']);
  });

  it.each([
    { label: 'duplicate', versions: [1, 1] },
    { label: 'out-of-order', versions: [2, 1] },
  ])('rejects $label migration definitions', ({ versions }) => {
    const definitions = versions.map<Migration>(version => ({
      version,
      name: `migration-${version}`,
      sql: '',
    }));

    expect(() => validateMigrations(definitions)).toThrowError(
      'Migration versions must be unique and strictly increasing',
    );
  });

  it('rejects rows that violate a foreign key', () => {
    database = openPokerDatabase(':memory:');

    expect(() => {
      database?.db
        .prepare(
          'INSERT INTO wallets (profile_id, balance, updated_at) VALUES (?, ?, ?)',
        )
        .run('missing-profile', 100, Date.now());
    }).toThrow();
  });

  it('rejects a negative wallet balance', () => {
    database = openPokerDatabase(':memory:');
    insertProfile(database, 'negative-wallet');

    expect(() => {
      database?.db
        .prepare(
          'INSERT INTO wallets (profile_id, balance, updated_at) VALUES (?, ?, ?)',
        )
        .run('negative-wallet', -1, Date.now());
    }).toThrow();
  });

  it('rejects more than one active seat escrow for a profile', () => {
    database = openPokerDatabase(':memory:');
    insertProfile(database, 'active-escrow');
    const insertEscrow = database.db.prepare(`
      INSERT INTO seat_escrows (
        id,
        profile_id,
        room_id,
        mode,
        amount,
        checkpoint_amount,
        checkpoint_hand,
        status,
        updated_at
      ) VALUES (?, ?, ?, 'cash', 100, 100, 0, 'active', ?)
    `);
    insertEscrow.run('escrow-1', 'active-escrow', 'room-1', Date.now());

    expect(() => {
      insertEscrow.run('escrow-2', 'active-escrow', 'room-2', Date.now());
    }).toThrow();
  });

  it('rejects duplicate chip ledger idempotency keys', () => {
    database = openPokerDatabase(':memory:');
    insertProfile(database, 'ledger-idempotency');
    const insertLedger = database.db.prepare(`
      INSERT INTO chip_ledger (
        id,
        profile_id,
        account,
        delta,
        reason,
        ref_id,
        idempotency_key,
        created_at
      ) VALUES (?, ?, 'wallet', 100, 'TEST', NULL, ?, ?)
    `);
    insertLedger.run(
      'ledger-1',
      'ledger-idempotency',
      'same-key',
      Date.now(),
    );

    expect(() => {
      insertLedger.run(
        'ledger-2',
        'ledger-idempotency',
        'same-key',
        Date.now(),
      );
    }).toThrow();
  });

  it('rejects values with the wrong type in STRICT tables', () => {
    database = openPokerDatabase(':memory:');
    insertProfile(database, 'strict-wallet');

    expect(() => {
      database?.db
        .prepare(
          'INSERT INTO wallets (profile_id, balance, updated_at) VALUES (?, ?, ?)',
        )
        .run('strict-wallet', 'not-an-integer', Date.now());
    }).toThrow();
  });

  it('configures durable file-backed SQLite pragmas', () => {
    const directory = mkdtempSync(join(tmpdir(), 'poker-doku-'));
    temporaryDirectories.push(directory);
    database = openPokerDatabase(join(directory, 'poker.sqlite'));

    const journal = database.db.prepare('PRAGMA journal_mode').get() as {
      journal_mode: string;
    };
    const synchronous = database.db.prepare('PRAGMA synchronous').get() as {
      synchronous: number;
    };
    const busyTimeout = database.db.prepare('PRAGMA busy_timeout').get() as {
      timeout: number;
    };
    const foreignKeys = database.db.prepare('PRAGMA foreign_keys').get() as {
      foreign_keys: number;
    };

    expect(journal.journal_mode).toBe('wal');
    expect(synchronous.synchronous).toBe(2);
    expect(busyTimeout.timeout).toBe(5_000);
    expect(foreignKeys.foreign_keys).toBe(1);
  });

  it('rolls back a transaction when its work throws', () => {
    database = openPokerDatabase(':memory:');

    expect(() => {
      database?.transaction(() => {
        insertProfile(database as PokerDatabase, 'rolled-back');
        throw new Error('boom');
      });
    }).toThrowError('boom');

    const result = database.db
      .prepare('SELECT COUNT(*) AS count FROM profiles')
      .get() as { count: number };
    expect(result.count).toBe(0);
  });

  it('rejects nested transactions without corrupting transaction state', () => {
    database = openPokerDatabase(':memory:');

    expect(() => {
      database?.transaction(() => {
        database?.transaction(() => undefined);
      });
    }).toThrowError('Nested transactions are not supported');

    expect(database.transaction(() => 'available')).toBe('available');
  });

  it('rejects PromiseLike transaction results synchronously and rolls back work', () => {
    database = openPokerDatabase(':memory:');
    let thenCalled = false;
    const castedWork = (() => {
      insertProfile(database as PokerDatabase, 'promise-like');
      return {
        then: () => {
          thenCalled = true;
        },
      };
    }) as unknown as () => void;

    expect(() => database?.transaction(castedWork)).toThrowError(
      'PokerDatabase transactions must be synchronous',
    );

    const result = database.db
      .prepare('SELECT COUNT(*) AS count FROM profiles')
      .get() as { count: number };
    expect(result.count).toBe(0);
    expect(thenCalled).toBe(false);
  });

  it('does not invoke a casted native async transaction callback', () => {
    database = openPokerDatabase(':memory:');
    let invoked = false;
    const castedWork = (async () => {
      invoked = true;
    }) as unknown as () => void;

    expect(() => database?.transaction(castedWork)).toThrowError(
      'PokerDatabase transactions must be synchronous',
    );
    expect(invoked).toBe(false);
  });
});

function compileTimeTransactionContract(database: PokerDatabase): void {
  // @ts-expect-error PokerDatabase transactions intentionally reject async callbacks.
  database.transaction(async () => undefined);
}

void compileTimeTransactionContract;

function createConflictingV1Database(path: string): void {
  const rawDatabase = new DatabaseSync(path);
  rawDatabase.exec(`
    CREATE TABLE schema_migrations (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at INTEGER NOT NULL
    ) STRICT;
    CREATE TABLE profiles (id TEXT PRIMARY KEY) STRICT;
  `);
  rawDatabase.close();
}

function insertProfile(database: PokerDatabase, id: string): void {
  database.db
    .prepare(`
      INSERT INTO profiles (
        id,
        credential_hash,
        credential_lookup,
        recovery_hash,
        recovery_lookup,
        alias,
        avatar_id,
        adult_confirmed_at,
        created_at,
        updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)
    .run(
      id,
      `credential-hash-${id}`,
      `credential-lookup-${id}`,
      `recovery-hash-${id}`,
      `recovery-lookup-${id}`,
      `alias-${id}`,
      'sakura',
      Date.now(),
      Date.now(),
      Date.now(),
    );
}
