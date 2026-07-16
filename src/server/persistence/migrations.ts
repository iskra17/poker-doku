import type { DatabaseSync } from 'node:sqlite';

export interface Migration {
  version: number;
  name: string;
  sql: string;
}

export const migrations: readonly Migration[] = [
  {
    version: 1,
    name: 'anonymous_progression_foundation',
    sql: `
      CREATE TABLE profiles (
        id TEXT PRIMARY KEY,
        credential_hash TEXT NOT NULL UNIQUE,
        credential_lookup TEXT NOT NULL UNIQUE,
        recovery_hash TEXT NOT NULL UNIQUE,
        recovery_lookup TEXT NOT NULL UNIQUE,
        alias TEXT NOT NULL UNIQUE,
        avatar_id TEXT NOT NULL,
        adult_confirmed_at INTEGER NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      ) STRICT;

      CREATE TABLE wallets (
        profile_id TEXT PRIMARY KEY REFERENCES profiles(id) ON DELETE CASCADE,
        balance INTEGER NOT NULL CHECK (balance >= 0),
        updated_at INTEGER NOT NULL
      ) STRICT;

      CREATE TABLE chip_ledger (
        id TEXT PRIMARY KEY,
        profile_id TEXT REFERENCES profiles(id) ON DELETE CASCADE,
        account TEXT NOT NULL CHECK (account IN ('wallet','escrow','bot','burn')),
        delta INTEGER NOT NULL,
        reason TEXT NOT NULL,
        ref_id TEXT,
        idempotency_key TEXT NOT NULL UNIQUE,
        created_at INTEGER NOT NULL
      ) STRICT;

      CREATE TABLE seat_escrows (
        id TEXT PRIMARY KEY,
        profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
        room_id TEXT NOT NULL,
        mode TEXT NOT NULL CHECK (mode IN ('cash','sng')),
        amount INTEGER NOT NULL CHECK (amount >= 0),
        checkpoint_amount INTEGER NOT NULL CHECK (checkpoint_amount >= 0),
        checkpoint_hand INTEGER NOT NULL DEFAULT 0,
        status TEXT NOT NULL CHECK (status IN ('active','settled')),
        updated_at INTEGER NOT NULL
      ) STRICT;

      CREATE UNIQUE INDEX one_active_room_escrow
        ON seat_escrows(profile_id) WHERE status = 'active';

      CREATE TABLE daily_claims (
        profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
        claim_date TEXT NOT NULL CHECK (length(claim_date) = 10),
        amount INTEGER NOT NULL CHECK (amount > 0),
        claimed_at INTEGER NOT NULL,
        PRIMARY KEY (profile_id, claim_date)
      ) STRICT;

      CREATE TABLE rescue_claims (
        profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
        claim_date TEXT NOT NULL CHECK (length(claim_date) = 10),
        ordinal INTEGER NOT NULL CHECK (ordinal > 0),
        amount INTEGER NOT NULL CHECK (amount > 0),
        claimed_at INTEGER NOT NULL,
        PRIMARY KEY (profile_id, claim_date, ordinal)
      ) STRICT;

      CREATE TABLE sng_entries (
        room_id TEXT NOT NULL,
        profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
        buy_in INTEGER NOT NULL CHECK (buy_in >= 0),
        fee INTEGER NOT NULL CHECK (fee >= 0),
        status TEXT NOT NULL CHECK (status IN ('reserved','started','settled','refunded')),
        place INTEGER CHECK (place IS NULL OR place BETWEEN 1 AND 6),
        prize INTEGER NOT NULL DEFAULT 0 CHECK (prize >= 0),
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        PRIMARY KEY (room_id, profile_id)
      ) STRICT;
    `,
  },
];

export function validateMigrations(definitions: readonly Migration[]): void {
  let previousVersion = 0;
  for (const migration of definitions) {
    if (
      !Number.isInteger(migration.version)
      || migration.version <= previousVersion
    ) {
      throw new Error(
        'Migration versions must be unique and strictly increasing',
      );
    }
    previousVersion = migration.version;
  }
}

export function applyMigrations(db: DatabaseSync): void {
  validateMigrations(migrations);
  db.exec('BEGIN IMMEDIATE');
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        applied_at INTEGER NOT NULL
      ) STRICT;
    `);

    const appliedVersions = new Set(
      db
        .prepare('SELECT version FROM schema_migrations')
        .all()
        .map((row) => (row as { version: number }).version),
    );
    const knownVersions = new Set(migrations.map(migration => migration.version));
    const unknownVersions = [...appliedVersions]
      .filter(version => !knownVersions.has(version))
      .sort((left, right) => left - right);
    if (unknownVersions.length > 0) {
      throw new Error(
        `Unknown applied migration version: ${unknownVersions.join(', ')}`,
      );
    }
    const recordMigration = db.prepare(`
      INSERT INTO schema_migrations (version, name, applied_at)
      VALUES (?, ?, ?)
    `);

    for (const migration of migrations) {
      if (appliedVersions.has(migration.version)) continue;
      db.exec(migration.sql);
      recordMigration.run(migration.version, migration.name, Date.now());
    }

    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}
