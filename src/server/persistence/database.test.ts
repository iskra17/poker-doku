import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { openPokerDatabase, type PokerDatabase } from './database';
import {
  type Migration,
  migrations,
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

    const indexes = database.db.prepare(`
      SELECT name FROM sqlite_schema WHERE type = 'index'
    `).all().map(row => (row as { name: string }).name);

    const sngColumns = database.db
      .prepare('PRAGMA table_info(sng_entries)')
      .all()
      .map((column) => (column as { name: string }).name);

    expect(migration.version).toBe(5);
    expect(database.tableNames()).toEqual(
      expect.arrayContaining([
        'profiles',
        'wallets',
        'chip_ledger',
        'seat_escrows',
        'daily_claims',
        'rescue_claims',
        'sng_entries',
        'cash_hand_settlements',
        'progression_profiles',
        'character_affinity',
        'daily_missions',
        'streak_state',
        'inventory_items',
        'profile_equipment',
        'progression_events',
      ]),
    );
    expect(profileColumns).toEqual(
      expect.arrayContaining(['credential_lookup', 'recovery_lookup']),
    );
    expect(indexes).toContain('idx_rescue_claims_profile_claimed_at_desc');
    expect(indexes).toContain('one_active_sng_entry_per_profile');
    expect(sngColumns).toEqual(expect.arrayContaining([
      'id', 'tournament_id', 'room_id', 'profile_id', 'start_attempt',
    ]));
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
    expect(result.count).toBe(5);
  });

  it('upgrades an existing V1 database through the latest schema once while preserving data', () => {
    const directory = mkdtempSync(join(tmpdir(), 'poker-doku-'));
    temporaryDirectories.push(directory);
    const path = join(directory, 'poker.sqlite');
    createV1Database(path);

    database = openPokerDatabase(path);
    database.close();
    database = openPokerDatabase(path);

    const versions = database.db.prepare(`
      SELECT version FROM schema_migrations ORDER BY version
    `).all();
    const marker = database.db.prepare(`
      SELECT alias FROM profiles WHERE id = 'v1-marker'
    `).get();
    const index = database.db.prepare(`
      SELECT name FROM sqlite_schema
      WHERE type = 'index' AND name = 'idx_rescue_claims_profile_claimed_at_desc'
    `).get();

    expect(versions).toEqual([
      { version: 1 }, { version: 2 }, { version: 3 }, { version: 4 },
      { version: 5 },
    ]);
    expect(marker).toEqual({ alias: 'v1-marker-alias' });
    expect(index).toEqual({
      name: 'idx_rescue_claims_profile_claimed_at_desc',
    });
  });

  it('atomically upgrades an existing V2 database to the durable V3 cash identity schema', () => {
    const directory = mkdtempSync(join(tmpdir(), 'poker-doku-'));
    temporaryDirectories.push(directory);
    const path = join(directory, 'poker.sqlite');
    createV2Database(path);

    database = openPokerDatabase(path);

    expect(database.db.prepare(`
      SELECT version FROM schema_migrations ORDER BY version
    `).all()).toEqual([
      { version: 1 }, { version: 2 }, { version: 3 }, { version: 4 },
      { version: 5 },
    ]);
    expect(database.tableNames()).toContain('cash_hand_settlements');
    expect(database.db.prepare(`
      SELECT alias FROM profiles WHERE id = 'v1-marker'
    `).get()).toEqual({ alias: 'v1-marker-alias' });
  });

  it('atomically upgrades V3 SNG rows to collision-safe tournament identities', () => {
    const directory = mkdtempSync(join(tmpdir(), 'poker-doku-'));
    temporaryDirectories.push(directory);
    const path = join(directory, 'poker.sqlite');
    createV3Database(path);
    const rawDatabase = new DatabaseSync(path);
    rawDatabase.exec(`
      INSERT INTO sng_entries (
        room_id, profile_id, buy_in, fee, status, place, prize,
        created_at, updated_at
      ) VALUES ('legacy-room', 'v1-marker', 1500, 150, 'reserved', NULL, 0, 3, 3);
    `);
    rawDatabase.close();

    database = openPokerDatabase(path);

    expect(database.db.prepare(`
      SELECT id, tournament_id, room_id, profile_id, start_attempt, status
      FROM sng_entries
    `).get()).toEqual({
      id: 'legacy:legacy-room:v1-marker',
      tournament_id: 'legacy:legacy-room',
      room_id: 'legacy-room',
      profile_id: 'v1-marker',
      start_attempt: 0,
      status: 'reserved',
    });
    expect(database.db.prepare(`
      SELECT version FROM schema_migrations ORDER BY version
    `).all()).toEqual([
      { version: 1 }, { version: 2 }, { version: 3 }, { version: 4 },
      { version: 5 },
    ]);
  });

  it('upgrades V4 data through V5 exactly once without rewriting prior migrations', () => {
    const directory = mkdtempSync(join(tmpdir(), 'poker-doku-'));
    temporaryDirectories.push(directory);
    const path = join(directory, 'poker.sqlite');
    createV4Database(path);
    const rawDatabase = new DatabaseSync(path);
    rawDatabase.exec(`
      INSERT INTO cash_hand_settlements (
        room_id, settlement_seq, engine_hand_number, start_fingerprint,
        settlement_fingerprint, status, updated_at
      ) VALUES (
        'v4-room', 1, 1,
        'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        NULL, 'prepared', 4
      );
      INSERT INTO sng_entries (
        id, tournament_id, room_id, profile_id, buy_in, fee, status,
        place, prize, start_attempt, created_at, updated_at
      ) VALUES (
        'v4-entry', 'v4-tournament', 'v4-sng-room', 'v1-marker',
        1500, 150, 'reserved', NULL, 0, 0, 4, 4
      );
    `);
    rawDatabase.close();

    database = openPokerDatabase(path);
    database.close();
    database = openPokerDatabase(path);

    expect(database.db.prepare(`
      SELECT version FROM schema_migrations ORDER BY version
    `).all()).toEqual([
      { version: 1 }, { version: 2 }, { version: 3 }, { version: 4 },
      { version: 5 },
    ]);
    expect(database.db.prepare(`
      SELECT alias FROM profiles WHERE id = 'v1-marker'
    `).get()).toEqual({ alias: 'v1-marker-alias' });
    expect(database.db.prepare(`
      SELECT status FROM cash_hand_settlements WHERE room_id = 'v4-room'
    `).get()).toEqual({ status: 'prepared' });
    expect(database.db.prepare(`
      SELECT status FROM sng_entries WHERE id = 'v4-entry'
    `).get()).toEqual({ status: 'reserved' });
  });

  it('creates constrained STRICT progression tables with useful indexes', () => {
    database = openPokerDatabase(':memory:');

    const tableSql = database.db.prepare(`
      SELECT name, sql FROM sqlite_schema
      WHERE type = 'table' AND name IN (
        'progression_profiles', 'character_affinity', 'daily_missions',
        'streak_state', 'inventory_items', 'profile_equipment',
        'progression_events'
      )
      ORDER BY name
    `).all() as Array<{ name: string; sql: string }>;
    const foreignKeys = database.db.prepare(`
      PRAGMA foreign_key_list(progression_profiles)
    `).all() as Array<{ table: string; on_delete: string }>;
    const indexes = database.db.prepare(`
      SELECT name FROM sqlite_schema
      WHERE type = 'index' AND name LIKE 'idx_progression_%'
      ORDER BY name
    `).all().map(row => (row as { name: string }).name);

    expect(tableSql).toHaveLength(7);
    expect(tableSql.every(table => table.sql.endsWith('STRICT'))).toBe(true);
    expect(foreignKeys).toEqual(expect.arrayContaining([
      expect.objectContaining({ table: 'profiles', on_delete: 'CASCADE' }),
    ]));
    expect(indexes).toEqual(expect.arrayContaining([
      'idx_progression_daily_date_profile',
      'idx_progression_events_profile_created_at_desc',
      'idx_progression_inventory_item_profile',
    ]));

    insertProfile(database, 'progression-constraints');
    expect(() => database?.db.prepare(`
      INSERT INTO progression_profiles (
        profile_id, balance_version, dojo_level, dojo_xp_milli,
        selected_character_id, practice_date, practice_hands,
        completed_hands, cash_hands, practice_hands_total, sng_completions,
        best_streak, created_at, updated_at
      ) VALUES (?, 1, 51, 0, 'sakura', NULL, 0, 0, 0, 0, 0, 0, 1, 1)
    `).run('progression-constraints')).toThrow();
    expect(() => database?.db.prepare(`
      INSERT INTO profile_equipment (profile_id, slot, item_id, updated_at)
      VALUES (?, 'weapon', NULL, 1)
    `).run('progression-constraints')).toThrow();
  });

  it('rolls back all V5 tables and its version when a middle object conflicts', () => {
    const directory = mkdtempSync(join(tmpdir(), 'poker-doku-'));
    temporaryDirectories.push(directory);
    const path = join(directory, 'poker.sqlite');
    createV4Database(path);
    const rawDatabase = new DatabaseSync(path);
    rawDatabase.exec(`CREATE TABLE daily_missions (id TEXT) STRICT;`);
    rawDatabase.close();

    let unexpectedlyOpened: PokerDatabase | undefined;
    try {
      expect(() => {
        unexpectedlyOpened = openPokerDatabase(path);
      }).toThrowError('table daily_missions already exists');
    } finally {
      unexpectedlyOpened?.close();
    }
    const reopened = new DatabaseSync(path);
    try {
      expect(reopened.prepare(`
        SELECT version FROM schema_migrations ORDER BY version
      `).all()).toEqual([
        { version: 1 }, { version: 2 }, { version: 3 }, { version: 4 },
      ]);
      const tables = reopened.prepare(`
        SELECT name FROM sqlite_schema
        WHERE type = 'table' AND name LIKE 'progression_%'
      `).all().map(row => (row as { name: string }).name);
      expect(tables).toEqual([]);
      expect(reopened.prepare(`
        SELECT name FROM sqlite_schema
        WHERE type = 'table' AND name = 'character_affinity'
      `).get()).toBeUndefined();
    } finally {
      reopened.close();
    }
  });

  it('cascades profile deletion through every progression table', () => {
    database = openPokerDatabase(':memory:');
    insertProfile(database, 'progression-cascade');
    database.db.exec(`
      INSERT INTO progression_profiles VALUES (
        'progression-cascade', 1, 1, 0, 'sakura', NULL,
        0, 0, 0, 0, 0, 0, 1, 1
      );
      INSERT INTO character_affinity VALUES (
        'progression-cascade', 'sakura', 1, 0
      );
      INSERT INTO daily_missions (
        profile_id, mission_date, slot, mission_id, target, progress,
        balance_version, reroll_count, assigned_at, completed_at, rewarded_at
      ) VALUES (
        'progression-cascade', '2026-07-17', 0, 'mission-a', 10, 0,
        1, 0, 1, NULL, NULL
      );
      INSERT INTO streak_state VALUES (
        'progression-cascade', 0, 0, NULL, NULL, 1, 1
      );
      INSERT INTO inventory_items VALUES (
        'progression-cascade', 'frame-a', 1, 1, 1
      );
      INSERT INTO profile_equipment VALUES (
        'progression-cascade', 'frame', 'frame-a', 1
      );
      INSERT INTO progression_events VALUES (
        'event-a', 'progression-cascade', 'test', 1, '{}', 1
      );
      DELETE FROM profiles WHERE id = 'progression-cascade';
    `);

    for (const table of [
      'progression_profiles', 'character_affinity', 'daily_missions',
      'streak_state', 'inventory_items', 'profile_equipment',
      'progression_events',
    ]) {
      const row = database.db.prepare(
        `SELECT COUNT(*) AS count FROM ${table}`,
      ).get() as { count: number };
      expect(row.count).toBe(0);
    }
  });

  it('rolls back the V4 SNG table replacement and version when migration conflicts', () => {
    const directory = mkdtempSync(join(tmpdir(), 'poker-doku-'));
    temporaryDirectories.push(directory);
    const path = join(directory, 'poker.sqlite');
    createV3Database(path);
    const rawDatabase = new DatabaseSync(path);
    rawDatabase.exec('CREATE TABLE sng_entries_v1_backup (id TEXT) STRICT;');
    rawDatabase.close();

    expect(() => openPokerDatabase(path)).toThrowError(
      'there is already another table or index with this name: sng_entries_v1_backup',
    );
    const reopened = new DatabaseSync(path);
    try {
      expect(reopened.prepare(`
        SELECT version FROM schema_migrations ORDER BY version
      `).all()).toEqual([{ version: 1 }, { version: 2 }, { version: 3 }]);
      expect(reopened.prepare('PRAGMA table_info(sng_entries)').all()
        .map(row => (row as { name: string }).name)).not.toContain('tournament_id');
    } finally {
      reopened.close();
    }
  });

  it('rolls back the V3 version record when its durable identity table conflicts', () => {
    const directory = mkdtempSync(join(tmpdir(), 'poker-doku-'));
    temporaryDirectories.push(directory);
    const path = join(directory, 'poker.sqlite');
    createV2Database(path);
    const rawDatabase = new DatabaseSync(path);
    rawDatabase.exec(`CREATE TABLE cash_hand_settlements (id TEXT) STRICT;`);
    rawDatabase.close();

    expect(() => openPokerDatabase(path)).toThrowError(
      'table cash_hand_settlements already exists',
    );
    const reopened = new DatabaseSync(path);
    try {
      expect(reopened.prepare(`
        SELECT version FROM schema_migrations ORDER BY version
      `).all()).toEqual([{ version: 1 }, { version: 2 }]);
    } finally {
      reopened.close();
    }
  });

  it('rolls back the V2 version record when its index creation fails', () => {
    const directory = mkdtempSync(join(tmpdir(), 'poker-doku-'));
    temporaryDirectories.push(directory);
    const path = join(directory, 'poker.sqlite');
    createV1Database(path);
    const rawDatabase = new DatabaseSync(path);
    rawDatabase.exec(`
      CREATE INDEX idx_rescue_claims_profile_claimed_at_desc
      ON rescue_claims(claimed_at)
    `);
    rawDatabase.close();

    let unexpectedlyOpened: PokerDatabase | undefined;
    try {
      expect(() => {
        unexpectedlyOpened = openPokerDatabase(path);
      }).toThrowError(
        'index idx_rescue_claims_profile_claimed_at_desc already exists',
      );
    } finally {
      unexpectedlyOpened?.close();
    }

    const reopened = new DatabaseSync(path);
    const versions = reopened.prepare(`
      SELECT version FROM schema_migrations ORDER BY version
    `).all();
    reopened.close();
    expect(versions).toEqual([{ version: 1 }]);
  });

  it('uses the rescue claimed-at index for the latest-claim query', () => {
    database = openPokerDatabase(':memory:');

    const plan = database.db.prepare(`
      EXPLAIN QUERY PLAN
      SELECT claimed_at
      FROM rescue_claims
      WHERE profile_id = ?
      ORDER BY claimed_at DESC
      LIMIT 1
    `).all('profile-1') as Array<{ detail: string }>;

    expect(plan.map(row => row.detail).join('\n'))
      .toContain('idx_rescue_claims_profile_claimed_at_desc');
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
      CREATE TABLE chip_ledger (id TEXT PRIMARY KEY) STRICT;
    `);
    rawDatabase.close();

    let unexpectedlyOpened: PokerDatabase | undefined;
    try {
      expect(() => {
        unexpectedlyOpened = openPokerDatabase(path);
      }).toThrowError('table chip_ledger already exists');
    } finally {
      unexpectedlyOpened?.close();
    }

    const reopened = new DatabaseSync(path);
    let migrationCount = -1;
    let tableNames: string[] = [];
    try {
      migrationCount = (
        reopened
          .prepare('SELECT COUNT(*) AS count FROM schema_migrations')
          .get() as { count: number }
      ).count;
      tableNames = reopened
        .prepare(`
          SELECT name FROM sqlite_schema
          WHERE type = 'table' AND name NOT LIKE 'sqlite_%'
          ORDER BY name
        `)
        .all()
        .map(row => (row as { name: string }).name);
    } finally {
      reopened.close();
    }

    expect(migrationCount).toBe(0);
    expect(tableNames).toContain('chip_ledger');
    expect(tableNames).not.toContain('profiles');
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

function createV1Database(path: string): void {
  const rawDatabase = new DatabaseSync(path);
  try {
    rawDatabase.exec(`
      CREATE TABLE schema_migrations (
        version INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        applied_at INTEGER NOT NULL
      ) STRICT;
      BEGIN IMMEDIATE;
      ${migrations[0].sql}
      INSERT INTO schema_migrations (version, name, applied_at)
      VALUES (1, 'anonymous_progression_foundation', 1);
      INSERT INTO profiles (
        id, credential_hash, credential_lookup, recovery_hash, recovery_lookup,
        alias, avatar_id, adult_confirmed_at, created_at, updated_at
      ) VALUES (
        'v1-marker', 'v1-credential-hash', 'v1-credential-lookup',
        'v1-recovery-hash', 'v1-recovery-lookup', 'v1-marker-alias',
        'sakura', 1, 1, 1
      );
      COMMIT;
    `);
  } finally {
    rawDatabase.close();
  }
}

function createV2Database(path: string): void {
  createV1Database(path);
  const rawDatabase = new DatabaseSync(path);
  try {
    rawDatabase.exec(`
      BEGIN IMMEDIATE;
      ${migrations[1].sql}
      INSERT INTO schema_migrations (version, name, applied_at)
      VALUES (2, 'index_rescue_claims_by_profile_and_latest_claim', 2);
      COMMIT;
    `);
  } finally {
    rawDatabase.close();
  }
}

function createV3Database(path: string): void {
  createV2Database(path);
  const rawDatabase = new DatabaseSync(path);
  try {
    rawDatabase.exec(`
      BEGIN IMMEDIATE;
      ${migrations[2].sql}
      INSERT INTO schema_migrations (version, name, applied_at)
      VALUES (3, 'durable_cash_hand_settlement_identity', 3);
      COMMIT;
    `);
  } finally {
    rawDatabase.close();
  }
}

function createV4Database(path: string): void {
  createV3Database(path);
  const rawDatabase = new DatabaseSync(path);
  try {
    rawDatabase.exec(`
      BEGIN IMMEDIATE;
      ${migrations[3].sql}
      INSERT INTO schema_migrations (version, name, applied_at)
      VALUES (4, 'durable_sng_tournament_incarnations', 4);
      COMMIT;
    `);
  } finally {
    rawDatabase.close();
  }
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
