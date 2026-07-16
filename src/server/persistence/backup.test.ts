import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import * as sqlite from 'node:sqlite';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  BackupManager,
  DailyBackupScheduler,
  decryptBackupFile,
  encryptBackupFile,
  formatKstBackupDate,
  getNextKstFourAm,
  pruneExpiredBackups,
  resolveBackupEncryptionKey,
} from './backup';
import { openPokerDatabase, type PokerDatabase } from './database';

const temporaryDirectories: string[] = [];

function temporaryDirectory(): string {
  const directory = mkdtempSync(join(tmpdir(), 'poker-doku-backup-'));
  temporaryDirectories.push(directory);
  return directory;
}

function key(seed = 7): Buffer {
  return Buffer.alloc(32, seed);
}

function deferred(): {
  promise: Promise<void>;
  resolve: () => void;
  reject: (error: Error) => void;
} {
  let resolve!: () => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<void>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}

afterEach(() => {
  vi.useRealTimers();
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe('KST backup calendar', () => {
  it.each([
    ['2026-07-15T14:59:59.999Z', '2026-07-15'],
    ['2026-07-15T15:00:00.000Z', '2026-07-16'],
    ['2024-02-29T14:59:59.999Z', '2024-02-29'],
    ['2024-02-29T15:00:00.000Z', '2024-03-01'],
  ])('formats %s as KST date %s', (instant, expected) => {
    expect(formatKstBackupDate(new Date(instant))).toBe(expected);
  });

  it.each([
    ['2026-07-15T18:59:59.000Z', '2026-07-15T19:00:00.000Z'],
    ['2026-07-15T19:00:00.000Z', '2026-07-16T19:00:00.000Z'],
    ['2024-02-28T20:00:00.000Z', '2024-02-29T19:00:00.000Z'],
  ])('calculates the next KST 04:00 after %s', (instant, expected) => {
    expect(getNextKstFourAm(new Date(instant)).toISOString()).toBe(expected);
  });
});

describe('backup encryption', () => {
  it('accepts only exact 32-byte base64 or 64-character hex keys', () => {
    const raw = key();
    expect(resolveBackupEncryptionKey(raw.toString('base64'), true)).toEqual(raw);
    expect(resolveBackupEncryptionKey(raw.toString('hex'), true)).toEqual(raw);
    expect(resolveBackupEncryptionKey(undefined, false)).toBeUndefined();
    expect(() => resolveBackupEncryptionKey(undefined, true)).toThrowError(
      'Invalid backup encryption configuration',
    );
    for (const invalid of ['short', Buffer.alloc(31).toString('base64'), 'z'.repeat(64)]) {
      expect(() => resolveBackupEncryptionKey(invalid, true)).toThrowError(
        'Invalid backup encryption configuration',
      );
    }
  });

  it('round-trips a backup and authenticates its versioned format', async () => {
    const directory = temporaryDirectory();
    const source = join(directory, 'source.sqlite');
    const encrypted = join(directory, 'backup.sqlite.enc');
    const restored = join(directory, 'restored.sqlite');
    const content = Buffer.concat([
      Buffer.from('SQLite format 3\0'),
      Buffer.alloc(256 * 1024, 0xa5),
    ]);
    writeFileSync(source, content);

    await encryptBackupFile(source, encrypted, key());
    await decryptBackupFile(encrypted, restored, key());

    expect(readFileSync(restored)).toEqual(content);
    expect(readFileSync(encrypted).subarray(0, 8).toString('ascii'))
      .toBe('PDKUBAK1');
  });

  it.each(['tampered', 'wrong-key'])(
    'leaves no plaintext destination for %s encrypted input',
    async scenario => {
      const directory = temporaryDirectory();
      const source = join(directory, 'source.sqlite');
      const encrypted = join(directory, 'backup.sqlite.enc');
      const restored = join(directory, 'restored.sqlite');
      writeFileSync(source, Buffer.alloc(128 * 1024, 0x41));
      await encryptBackupFile(source, encrypted, key());
      if (scenario === 'tampered') {
        const contents = readFileSync(encrypted);
        contents[Math.floor(contents.length / 2)] ^= 1;
        writeFileSync(encrypted, contents);
      }

      await expect(decryptBackupFile(
        encrypted,
        restored,
        scenario === 'wrong-key' ? key(8) : key(),
      )).rejects.toThrow();
      expect(existsSync(restored)).toBe(false);
      expect(readdirSync(directory).some(name => name.includes('.tmp'))).toBe(false);
    },
  );
});

describe('backup retention', () => {
  it('keeps 14 KST days and removes only exact regular 15-day-old backup names', async () => {
    const directory = temporaryDirectory();
    for (const name of [
      'poker-doku-2026-07-02.sqlite',
      'poker-doku-2026-07-01.sqlite',
      'poker-doku-2026-07-01.sqlite.enc',
      'other-2026-07-01.sqlite',
      'poker-doku-2026-02-30.sqlite',
      'poker-doku-2026-07-01.sqlite.tmp',
      'poker-doku.sqlite',
      'poker-doku.sqlite-wal',
      'poker-doku.sqlite-shm',
    ]) writeFileSync(join(directory, name), name);
    mkdirSync(join(directory, 'poker-doku-2026-07-01.sqlite.directory'));
    mkdirSync(join(directory, 'poker-doku-2026-06-29.sqlite.enc'));
    const outside = join(temporaryDirectory(), 'outside.sqlite');
    writeFileSync(outside, 'outside');
    try {
      symlinkSync(outside, join(directory, 'poker-doku-2026-06-30.sqlite'));
    } catch {
      // Windows may deny symlink creation; directory and regular-file checks remain covered.
    }

    const deleted = await pruneExpiredBackups(
      directory,
      new Date('2026-07-16T03:00:00.000Z'),
    );

    expect(deleted.sort()).toEqual([
      'poker-doku-2026-07-01.sqlite',
      'poker-doku-2026-07-01.sqlite.enc',
    ]);
    expect(existsSync(join(directory, 'poker-doku-2026-07-02.sqlite'))).toBe(true);
    expect(readFileSync(outside, 'utf8')).toBe('outside');
  });
});

describe('BackupManager', () => {
  function createManager(options: {
    directory?: string;
    now?: Date;
    backupDatabase?: (database: DatabaseSync, destination: string) => Promise<number>;
    encryptionKey?: Buffer;
  } = {}): { manager: BackupManager; database: PokerDatabase; directory: string } {
    const directory = options.directory ?? temporaryDirectory();
    const database = openPokerDatabase(':memory:');
    const manager = new BackupManager({
      database,
      backupDirectory: directory,
      encryptionKey: options.encryptionKey,
      now: () => options.now ?? new Date('2026-07-16T03:00:00.000Z'),
      backupDatabase: options.backupDatabase ?? (async (_db, destination) => {
        writeFileSync(destination, 'valid fake sqlite');
        return 1;
      }),
      validateBackup: async () => undefined,
    });
    return { manager, database, directory };
  }

  it('shares one in-flight promise and permits a later run after settlement', async () => {
    const pending = deferred();
    let calls = 0;
    const { manager, database } = createManager({
      backupDatabase: async (_db, destination) => {
        calls += 1;
        writeFileSync(destination, 'backup');
        await pending.promise;
        return 1;
      },
    });

    const first = manager.backup();
    const overlap = manager.backup();
    expect(overlap).toBe(first);
    expect(calls).toBe(1);
    pending.resolve();
    await first;
    await manager.backup();
    expect(calls).toBe(2);
    database.close();
  });

  it('cleans partial files, preserves the completed same-day backup, and retries after rejection', async () => {
    const directory = temporaryDirectory();
    const completed = join(directory, 'poker-doku-2026-07-16.sqlite');
    writeFileSync(completed, 'completed');
    let fail = true;
    const failedAttempt = deferred();
    let calls = 0;
    const { manager, database } = createManager({
      directory,
      backupDatabase: async (_db, destination) => {
        calls += 1;
        writeFileSync(destination, 'partial');
        if (fail) await failedAttempt.promise;
        return 1;
      },
    });

    const first = manager.backup();
    const overlap = manager.backup();
    expect(overlap).toBe(first);
    expect(calls).toBe(1);
    failedAttempt.reject(new Error('backup failed'));
    await expect(first).rejects.toThrowError('backup failed');
    expect(readFileSync(completed, 'utf8')).toBe('completed');
    expect(readdirSync(directory)).toEqual(['poker-doku-2026-07-16.sqlite']);

    fail = false;
    await expect(manager.backup()).resolves.toBe(completed);
    expect(calls).toBe(2);
    expect(readFileSync(completed, 'utf8')).toBe('completed');
    expect(readdirSync(directory)).toEqual(['poker-doku-2026-07-16.sqlite']);
    database.close();
  });

  it('encrypts the final backup and removes every temporary plaintext file', async () => {
    const { manager, database, directory } = createManager({
      encryptionKey: key(),
    });

    const result = await manager.backup();

    expect(basename(result)).toBe('poker-doku-2026-07-16.sqlite.enc');
    expect(readdirSync(directory)).toEqual(['poker-doku-2026-07-16.sqlite.enc']);
    database.close();
  });

  it('does not prune before a failed backup completes', async () => {
    const directory = temporaryDirectory();
    const old = join(directory, 'poker-doku-2026-07-01.sqlite');
    writeFileSync(old, 'old');
    const { manager, database } = createManager({
      directory,
      backupDatabase: async () => { throw new Error('no backup'); },
    });

    await expect(manager.backup()).rejects.toThrowError('no backup');
    expect(existsSync(old)).toBe(true);
    database.close();
  });
});

describe('official SQLite backup', () => {
  const nativeBackup = (sqlite as unknown as {
    backup?: (database: DatabaseSync, path: string) => Promise<number>;
  }).backup;

  it.skipIf(!nativeBackup)(
    'captures committed WAL data into an independently integral SQLite file',
    async () => {
      const directory = temporaryDirectory();
      const livePath = join(directory, 'live.sqlite');
      const backupDirectory = join(directory, 'backups');
      const database = openPokerDatabase(livePath);
      database.db.exec('PRAGMA wal_autocheckpoint=0');
      database.db.prepare(`
        INSERT INTO profiles (
          id, credential_hash, credential_lookup, recovery_hash, recovery_lookup,
          alias, avatar_id, adult_confirmed_at, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run('wal-row', 'a', 'b', 'c', 'd', '별칭', 'sakura', 1, 1, 1);
      const manager = new BackupManager({
        database,
        backupDirectory,
        now: () => new Date('2026-07-16T03:00:00.000Z'),
      });

      const result = await manager.backup();
      const copy = new DatabaseSync(result, { readOnly: true });
      try {
        expect(copy.prepare('PRAGMA integrity_check').get()).toEqual({
          integrity_check: 'ok',
        });
        expect(copy.prepare(`SELECT alias FROM profiles WHERE id = 'wal-row'`).get())
          .toEqual({ alias: '별칭' });
      } finally {
        copy.close();
        database.close();
      }
    },
  );
});

describe('daily backup scheduler', () => {
  it('recalculates the next KST 04:00 after each run and continues after errors', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-15T18:59:59.000Z'));
    const logger = { error: vi.fn() };
    let attempts = 0;
    const scheduler = new DailyBackupScheduler({
      backup: async () => {
        attempts += 1;
        if (attempts === 1) throw new Error('daily failed');
      },
      logger,
    });

    scheduler.start();
    scheduler.start();
    expect(vi.getTimerCount()).toBe(1);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(attempts).toBe(1);
    expect(logger.error).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(1);

    await vi.advanceTimersByTimeAsync(24 * 60 * 60 * 1_000);
    expect(attempts).toBe(2);
    expect(vi.getTimerCount()).toBe(1);

    scheduler.close();
    scheduler.close();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('continues scheduling even when the error logger throws', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-15T18:59:59.000Z'));
    let attempts = 0;
    const scheduler = new DailyBackupScheduler({
      backup: async () => {
        attempts += 1;
        throw new Error('daily failed');
      },
      logger: { error: () => { throw new Error('logger failed'); } },
    });

    scheduler.start();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(attempts).toBe(1);
    expect(vi.getTimerCount()).toBe(1);
    scheduler.close();
  });
});
