import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { openPokerDatabase, type PokerDatabase } from './database';

describe('PokerDatabase migrations', () => {
  let database: PokerDatabase | undefined;
  const temporaryDirectories: string[] = [];

  afterEach(() => {
    database?.close();
    database = undefined;
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
});

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
