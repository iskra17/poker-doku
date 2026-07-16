import {
  createReadStream,
  createWriteStream,
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { open, appendFile } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';
import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  randomUUID,
} from 'node:crypto';
import { pipeline } from 'node:stream/promises';
import * as sqlite from 'node:sqlite';
import { DatabaseSync } from 'node:sqlite';
import type { PokerDatabase } from './database';

const KST_OFFSET_MS = 9 * 60 * 60 * 1_000;
const RETENTION_DAYS = 14;
const MAGIC = Buffer.from('PDKUBAK1', 'ascii');
const IV_BYTES = 12;
const AUTH_TAG_BYTES = 16;
const BACKUP_NAME = /^poker-doku-(\d{4})-(\d{2})-(\d{2})\.sqlite(?:\.enc)?$/;
const INVALID_ENCRYPTION_CONFIGURATION =
  'Invalid backup encryption configuration';

type NativeBackup = (database: DatabaseSync, path: string) => Promise<number>;

export interface BackupManagerOptions {
  database: PokerDatabase;
  backupDirectory: string;
  encryptionKey?: Buffer;
  now?: () => Date;
  backupDatabase?: NativeBackup;
  validateBackup?: (path: string) => void | Promise<void>;
}

export interface DailyBackupSchedulerOptions {
  backup: () => Promise<unknown>;
  now?: () => Date;
  logger: { error: (message: string, error?: unknown) => void };
}

function safeDateParts(year: string, month: string, day: string): number | undefined {
  const numericYear = Number(year);
  const numericMonth = Number(month);
  const numericDay = Number(day);
  const utc = Date.UTC(numericYear, numericMonth - 1, numericDay);
  const parsed = new Date(utc);
  if (
    parsed.getUTCFullYear() !== numericYear
    || parsed.getUTCMonth() !== numericMonth - 1
    || parsed.getUTCDate() !== numericDay
  ) return undefined;
  return utc;
}

function ensureEncryptionKey(key: Buffer): void {
  if (key.length !== 32) throw new Error(INVALID_ENCRYPTION_CONFIGURATION);
}

function defaultNativeBackup(database: DatabaseSync, path: string): Promise<number> {
  const nativeBackup = (sqlite as unknown as { backup?: NativeBackup }).backup;
  if (!nativeBackup) {
    throw new Error('The configured Node.js runtime does not support node:sqlite backup');
  }
  return nativeBackup(database, path);
}

function validateSqliteBackup(path: string): void {
  const database = new DatabaseSync(path, { readOnly: true });
  try {
    const result = database.prepare('PRAGMA integrity_check').get() as {
      integrity_check?: string;
    };
    if (result.integrity_check !== 'ok') {
      throw new Error('SQLite backup integrity check failed');
    }
  } finally {
    database.close();
  }
}

function retainCompletedSameDayBackup(temporary: string, finalPath: string): void {
  if (existsSync(finalPath)) {
    if (!lstatSync(finalPath).isFile()) {
      throw new Error('Backup destination is not a regular file');
    }
    return;
  }
  renameSync(temporary, finalPath);
}

export function formatKstBackupDate(now: Date): string {
  if (!Number.isFinite(now.getTime())) throw new Error('Invalid backup clock');
  const shifted = new Date(now.getTime() + KST_OFFSET_MS);
  const year = shifted.getUTCFullYear().toString().padStart(4, '0');
  const month = (shifted.getUTCMonth() + 1).toString().padStart(2, '0');
  const day = shifted.getUTCDate().toString().padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function getNextKstFourAm(now: Date): Date {
  if (!Number.isFinite(now.getTime())) throw new Error('Invalid backup clock');
  const shifted = new Date(now.getTime() + KST_OFFSET_MS);
  let target = Date.UTC(
    shifted.getUTCFullYear(),
    shifted.getUTCMonth(),
    shifted.getUTCDate(),
    4,
  ) - KST_OFFSET_MS;
  if (target <= now.getTime()) {
    target = Date.UTC(
      shifted.getUTCFullYear(),
      shifted.getUTCMonth(),
      shifted.getUTCDate() + 1,
      4,
    ) - KST_OFFSET_MS;
  }
  return new Date(target);
}

export function resolveBackupEncryptionKey(
  encoded: string | undefined,
  production: boolean,
): Buffer | undefined {
  if (encoded === undefined || encoded.length === 0) {
    if (production) throw new Error(INVALID_ENCRYPTION_CONFIGURATION);
    return undefined;
  }

  let decoded: Buffer | undefined;
  if (/^[0-9a-fA-F]{64}$/.test(encoded)) {
    decoded = Buffer.from(encoded, 'hex');
  } else if (/^[A-Za-z0-9+/]{43}=$/.test(encoded)) {
    const candidate = Buffer.from(encoded, 'base64');
    if (candidate.toString('base64') === encoded) decoded = candidate;
  }
  if (!decoded || decoded.length !== 32) {
    throw new Error(INVALID_ENCRYPTION_CONFIGURATION);
  }
  return decoded;
}

export async function encryptBackupFile(
  sourcePath: string,
  destinationPath: string,
  key: Buffer,
): Promise<void> {
  ensureEncryptionKey(key);
  const iv = randomBytes(IV_BYTES);
  writeFileSync(destinationPath, Buffer.concat([MAGIC, iv]), { flag: 'wx' });
  try {
    const cipher = createCipheriv('aes-256-gcm', key, iv);
    await pipeline(
      createReadStream(sourcePath),
      cipher,
      createWriteStream(destinationPath, { flags: 'a' }),
    );
    await appendFile(destinationPath, cipher.getAuthTag());
  } catch (error) {
    rmSync(destinationPath, { force: true });
    throw error;
  }
}

export async function decryptBackupFile(
  sourcePath: string,
  destinationPath: string,
  key: Buffer,
): Promise<void> {
  ensureEncryptionKey(key);
  if (existsSync(destinationPath)) {
    throw new Error('Restore destination already exists');
  }
  const source = await open(sourcePath, 'r');
  const temporary = `${destinationPath}.${randomUUID()}.tmp`;
  try {
    const stat = await source.stat();
    const minimumSize = MAGIC.length + IV_BYTES + AUTH_TAG_BYTES;
    if (stat.size < minimumSize) throw new Error('Invalid encrypted backup');
    const header = Buffer.alloc(MAGIC.length + IV_BYTES);
    const tag = Buffer.alloc(AUTH_TAG_BYTES);
    await source.read(header, 0, header.length, 0);
    await source.read(tag, 0, tag.length, stat.size - AUTH_TAG_BYTES);
    if (!header.subarray(0, MAGIC.length).equals(MAGIC)) {
      throw new Error('Invalid encrypted backup');
    }
    const iv = header.subarray(MAGIC.length);
    const decipher = createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(tag);
    await pipeline(
      createReadStream(sourcePath, {
        start: header.length,
        end: stat.size - AUTH_TAG_BYTES - 1,
      }),
      decipher,
      createWriteStream(temporary, { flags: 'wx' }),
    );
    renameSync(temporary, destinationPath);
  } finally {
    await source.close();
    rmSync(temporary, { force: true });
  }
}

export async function pruneExpiredBackups(
  backupDirectory: string,
  now: Date,
): Promise<string[]> {
  const currentDate = formatKstBackupDate(now);
  const [year, month, day] = currentDate.split('-');
  const currentDay = safeDateParts(year, month, day);
  if (currentDay === undefined) throw new Error('Invalid backup clock');
  const root = resolve(backupDirectory);
  const deleted: string[] = [];

  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (!entry.isFile()) continue;
    const match = BACKUP_NAME.exec(entry.name);
    if (!match) continue;
    const backupDay = safeDateParts(match[1], match[2], match[3]);
    if (backupDay === undefined) continue;
    const age = Math.floor((currentDay - backupDay) / (24 * 60 * 60 * 1_000));
    if (age < RETENTION_DAYS + 1) continue;
    const candidate = resolve(root, entry.name);
    if (resolve(candidate) !== join(root, basename(entry.name))) continue;
    rmSync(candidate);
    deleted.push(entry.name);
  }
  return deleted;
}

export class BackupManager {
  private readonly now: () => Date;
  private readonly backupDatabase: NativeBackup;
  private readonly validateBackup: (path: string) => void | Promise<void>;
  private inFlight?: Promise<string>;

  constructor(private readonly options: BackupManagerOptions) {
    if (options.encryptionKey) ensureEncryptionKey(options.encryptionKey);
    this.now = options.now ?? (() => new Date());
    this.backupDatabase = options.backupDatabase ?? defaultNativeBackup;
    this.validateBackup = options.validateBackup ?? validateSqliteBackup;
  }

  backup(): Promise<string> {
    if (this.inFlight) return this.inFlight;
    const pending = this.performBackup();
    this.inFlight = pending;
    void pending.then(
      () => {
        if (this.inFlight === pending) this.inFlight = undefined;
      },
      () => {
        if (this.inFlight === pending) this.inFlight = undefined;
      },
    );
    return pending;
  }

  private async performBackup(): Promise<string> {
    const now = this.now();
    const date = formatKstBackupDate(now);
    const directory = resolve(this.options.backupDirectory);
    mkdirSync(directory, { recursive: true });
    const identifier = randomUUID();
    const plaintext = join(directory, `.poker-doku-${date}.${identifier}.sqlite.tmp`);
    const encrypted = join(directory, `.poker-doku-${date}.${identifier}.sqlite.enc.tmp`);
    const suffix = this.options.encryptionKey ? '.sqlite.enc' : '.sqlite';
    const finalPath = join(directory, `poker-doku-${date}${suffix}`);

    try {
      await this.backupDatabase(this.options.database.db, plaintext);
      await this.validateBackup(plaintext);
      let completed = plaintext;
      if (this.options.encryptionKey) {
        await encryptBackupFile(
          plaintext,
          encrypted,
          this.options.encryptionKey,
        );
        completed = encrypted;
      }
      retainCompletedSameDayBackup(completed, finalPath);
      await pruneExpiredBackups(directory, now);
      return finalPath;
    } finally {
      rmSync(plaintext, { force: true });
      rmSync(encrypted, { force: true });
    }
  }
}

export class DailyBackupScheduler {
  private readonly now: () => Date;
  private timer?: ReturnType<typeof setTimeout>;
  private closed = false;

  constructor(private readonly options: DailyBackupSchedulerOptions) {
    this.now = options.now ?? (() => new Date());
  }

  start(): void {
    if (this.closed || this.timer) return;
    this.scheduleNext();
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
  }

  private scheduleNext(): void {
    if (this.closed) return;
    const now = this.now();
    const delay = Math.max(0, getNextKstFourAm(now).getTime() - now.getTime());
    this.timer = setTimeout(() => {
      this.timer = undefined;
      void this.options.backup().catch(error => {
        try {
          this.options.logger.error('> Daily SQLite backup failed:', error);
        } catch {
          // A logging sink must not stop tomorrow's backup from being scheduled.
        }
      }).finally(() => {
        this.scheduleNext();
      });
    }, delay);
  }
}
