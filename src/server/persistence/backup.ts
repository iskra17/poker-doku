import {
  chmodSync,
  closeSync,
  createReadStream,
  existsSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readdirSync,
  renameSync,
  rmSync,
} from 'node:fs';
import { link, open, unlink, type FileHandle } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  randomUUID,
} from 'node:crypto';
import { pipeline } from 'node:stream/promises';
import { Writable } from 'node:stream';
import * as sqlite from 'node:sqlite';
import { DatabaseSync } from 'node:sqlite';
import type { PokerDatabase } from './database';

const KST_OFFSET_MS = 9 * 60 * 60 * 1_000;
const RETENTION_DAYS = 14;
const MAGIC = Buffer.from('PDKUBAK1', 'ascii');
const IV_BYTES = 12;
const AUTH_TAG_BYTES = 16;
const BACKUP_NAME = /^poker-doku-(\d{4})-(\d{2})-(\d{2})\.sqlite(?:\.enc)?$/;
const UUID_PATTERN = '[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}';
const STALE_PARTIAL_NAME = new RegExp(
  `^\\.poker-doku-\\d{4}-\\d{2}-\\d{2}\\.${UUID_PATTERN}\\.sqlite(?:\\.enc)?\\.tmp$`,
);
const ORPHAN_PREVIOUS_NAME = new RegExp(
  `^(poker-doku-\\d{4}-\\d{2}-\\d{2}\\.sqlite(?:\\.enc)?)\\.previous\\.${UUID_PATTERN}\\.tmp$`,
);
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
  encryptBackup?: typeof encryptBackupFile;
  promoteBackup?: (
    temporaryPath: string,
    finalPath: string,
  ) => void | Promise<void>;
}

export interface DailyBackupSchedulerOptions {
  backup: () => Promise<unknown>;
  now?: () => Date;
  logger: { error: (message: string, error?: unknown) => void };
}

export interface EncryptBackupOptions {
  afterHeader?: () => void | Promise<void>;
}

export interface DecryptBackupOptions {
  beforePublish?: () => void | Promise<void>;
}

export interface BackupPromotionDependencies {
  exists: (path: string) => boolean;
  isRegularFile: (path: string) => boolean;
  rename: (source: string, destination: string) => void;
  remove: (path: string) => void;
  uniqueId: () => string;
  syncDirectory: (path: string) => void;
}

function isNarrowWindowsDirectorySyncError(error: unknown): boolean {
  return process.platform === 'win32'
    && typeof error === 'object'
    && error !== null
    && 'code' in error
    && ['EACCES', 'EBADF', 'EISDIR', 'EPERM'].includes(String(error.code));
}

export function syncDirectoryDurably(directory: string): void {
  let descriptor: number | undefined;
  try {
    descriptor = openSync(directory, 'r');
    fsyncSync(descriptor);
  } catch (error) {
    if (!isNarrowWindowsDirectorySyncError(error)) throw error;
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
}

function secureAndSyncFileSync(path: string): void {
  chmodSync(path, 0o600);
  const descriptor = openSync(path, 'r+');
  try {
    fsyncSync(descriptor);
  } finally {
    closeSync(descriptor);
  }
}

async function secureAndSyncFile(path: string): Promise<void> {
  const handle = await open(path, 'r+');
  try {
    await handle.chmod(0o600);
    await handle.sync();
  } finally {
    await handle.close();
  }
}

class PositionedFileWriter extends Writable {
  position: number;

  constructor(
    private readonly handle: FileHandle,
    start: number,
  ) {
    super();
    this.position = start;
  }

  override _write(
    chunk: Buffer | string,
    encoding: BufferEncoding,
    callback: (error?: Error | null) => void,
  ): void {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, encoding);
    void writeFully(this.handle, buffer, this.position).then(
      () => {
        this.position += buffer.length;
        callback();
      },
      error => callback(error as Error),
    );
  }
}

async function writeFully(
  handle: FileHandle,
  buffer: Buffer,
  position: number,
): Promise<void> {
  let offset = 0;
  while (offset < buffer.length) {
    const { bytesWritten } = await handle.write(
      buffer,
      offset,
      buffer.length - offset,
      position + offset,
    );
    if (bytesWritten === 0) throw new Error('Backup file write made no progress');
    offset += bytesWritten;
  }
}

async function readFully(
  handle: FileHandle,
  buffer: Buffer,
  position: number,
): Promise<void> {
  let offset = 0;
  while (offset < buffer.length) {
    const { bytesRead } = await handle.read(
      buffer,
      offset,
      buffer.length - offset,
      position + offset,
    );
    if (bytesRead === 0) throw new Error('Invalid encrypted backup');
    offset += bytesRead;
  }
}

function sameFile(left: { dev: number | bigint; ino: number | bigint }, right: {
  dev: number | bigint;
  ino: number | bigint;
}): boolean {
  return left.ino === right.ino
    && (process.platform === 'win32' || left.dev === right.dev);
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

function isValidBackupDateInName(name: string): boolean {
  const match = /(?:^|-)\b(\d{4})-(\d{2})-(\d{2})(?:\.|$)/.exec(name);
  return Boolean(match && safeDateParts(match[1], match[2], match[3]) !== undefined);
}

function preparePrivateBackupDirectory(directory: string): void {
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const directoryStat = lstatSync(directory);
  if (!directoryStat.isDirectory() || directoryStat.isSymbolicLink()) {
    throw new Error('Backup directory must be a real directory');
  }
  chmodSync(directory, 0o700);

  const previousByFinal = new Map<string, string[]>();
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (!entry.isFile()) continue;
    const completedMatch = BACKUP_NAME.exec(entry.name);
    if (
      completedMatch
      && safeDateParts(
        completedMatch[1],
        completedMatch[2],
        completedMatch[3],
      ) !== undefined
    ) {
      secureAndSyncFileSync(join(directory, entry.name));
    }
    if (STALE_PARTIAL_NAME.test(entry.name) && isValidBackupDateInName(entry.name)) {
      rmSync(join(directory, entry.name));
      continue;
    }
    const previousMatch = ORPHAN_PREVIOUS_NAME.exec(entry.name);
    if (!previousMatch || !isValidBackupDateInName(previousMatch[1])) continue;
    const candidates = previousByFinal.get(previousMatch[1]) ?? [];
    candidates.push(entry.name);
    previousByFinal.set(previousMatch[1], candidates);
  }

  for (const [finalName, candidates] of previousByFinal) {
    candidates.sort();
    const finalPath = join(directory, finalName);
    let finalStat: ReturnType<typeof lstatSync> | undefined;
    try {
      finalStat = lstatSync(finalPath);
    } catch (error) {
      if (
        typeof error !== 'object'
        || error === null
        || !('code' in error)
        || error.code !== 'ENOENT'
      ) throw error;
    }
    if (!finalStat) {
      const selected = candidates.shift();
      if (selected) {
        renameSync(join(directory, selected), finalPath);
        secureAndSyncFileSync(finalPath);
      }
    } else if (!finalStat.isFile() || finalStat.isSymbolicLink()) {
      continue;
    }
    for (const obsolete of candidates) {
      rmSync(join(directory, obsolete));
    }
  }
  syncDirectoryDurably(directory);
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

export function promoteCompletedBackup(
  temporaryPath: string,
  finalPath: string,
  dependencies: BackupPromotionDependencies = {
    exists: existsSync,
    isRegularFile: path => lstatSync(path).isFile(),
    rename: renameSync,
    remove: path => rmSync(path),
    uniqueId: randomUUID,
    syncDirectory: syncDirectoryDurably,
  },
): void {
  if (dependencies.exists(finalPath) && !dependencies.isRegularFile(finalPath)) {
    throw new Error('Backup destination is not a regular file');
  }

  try {
    dependencies.rename(temporaryPath, finalPath);
  } catch (directPromotionError) {
    if (
      !dependencies.exists(finalPath)
      || !dependencies.isRegularFile(finalPath)
    ) {
      throw directPromotionError;
    }

    // Windows can reject rename-overwrite. Move the last completed snapshot
    // aside first, but restore it if promoting the fully completed replacement
    // fails. Every path is in the same backup directory/volume.
    const previousPath = `${finalPath}.previous.${dependencies.uniqueId()}.tmp`;
    dependencies.rename(finalPath, previousPath);
    let replacementPromoted = false;
    let previousRemoved = false;
    try {
      dependencies.syncDirectory(dirname(finalPath));
      dependencies.rename(temporaryPath, finalPath);
      replacementPromoted = true;
      dependencies.syncDirectory(dirname(finalPath));
      dependencies.remove(previousPath);
      previousRemoved = true;
      dependencies.syncDirectory(dirname(finalPath));
    } catch (replacementError) {
      if (previousRemoved) throw replacementError;
      try {
        if (replacementPromoted) {
          dependencies.rename(finalPath, temporaryPath);
        }
        dependencies.rename(previousPath, finalPath);
        dependencies.syncDirectory(dirname(finalPath));
      } catch (restoreError) {
        throw new AggregateError(
          [replacementError, restoreError],
          'Backup promotion and rollback failed',
        );
      }
      throw replacementError;
    }
    return;
  }
  dependencies.syncDirectory(dirname(finalPath));
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
  options: EncryptBackupOptions = {},
): Promise<void> {
  ensureEncryptionKey(key);
  const iv = randomBytes(IV_BYTES);
  const header = Buffer.concat([MAGIC, iv]);
  let handle: FileHandle | undefined;
  let openedStat: Awaited<ReturnType<FileHandle['stat']>> | undefined;
  let completed = false;
  let failure: unknown;
  try {
    handle = await open(destinationPath, 'wx', 0o600);
    await handle.chmod(0o600);
    openedStat = await handle.stat();
    await writeFully(handle, header, 0);
    await options.afterHeader?.();
    const cipher = createCipheriv('aes-256-gcm', key, iv);
    const output = new PositionedFileWriter(handle, header.length);
    await pipeline(
      createReadStream(sourcePath),
      cipher,
      output,
    );
    await writeFully(
      handle,
      cipher.getAuthTag(),
      output.position,
    );
    await handle.sync();
    const pathStat = lstatSync(destinationPath);
    if (!pathStat.isFile() || !sameFile(openedStat, pathStat)) {
      throw new Error('Encrypted backup path changed while writing');
    }
    completed = true;
  } catch (error) {
    failure = error;
  }
  try {
    await handle?.close();
  } catch (error) {
    failure ??= error;
  }
  if (!completed && openedStat) {
    try {
      const pathStat = lstatSync(destinationPath);
      if (pathStat.isFile() && sameFile(openedStat, pathStat)) {
        rmSync(destinationPath);
        syncDirectoryDurably(dirname(resolve(destinationPath)));
      }
    } catch (error) {
      failure ??= error;
    }
  }
  if (failure) throw failure;
}

export async function decryptBackupFile(
  sourcePath: string,
  destinationPath: string,
  key: Buffer,
  options: DecryptBackupOptions = {},
): Promise<void> {
  ensureEncryptionKey(key);
  const source = await open(sourcePath, 'r');
  const temporary = `${destinationPath}.${randomUUID()}.tmp`;
  const outputDirectory = dirname(resolve(destinationPath));
  let output: FileHandle | undefined;
  let temporaryCreated = false;
  let failure: unknown;
  try {
    const stat = await source.stat();
    const minimumSize = MAGIC.length + IV_BYTES + AUTH_TAG_BYTES;
    if (stat.size < minimumSize) throw new Error('Invalid encrypted backup');
    const header = Buffer.alloc(MAGIC.length + IV_BYTES);
    const tag = Buffer.alloc(AUTH_TAG_BYTES);
    await readFully(source, header, 0);
    await readFully(source, tag, stat.size - AUTH_TAG_BYTES);
    if (!header.subarray(0, MAGIC.length).equals(MAGIC)) {
      throw new Error('Invalid encrypted backup');
    }
    const iv = header.subarray(MAGIC.length);
    const decipher = createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(tag);
    output = await open(temporary, 'wx', 0o600);
    temporaryCreated = true;
    await output.chmod(0o600);
    await pipeline(
      source.createReadStream({
        autoClose: false,
        start: header.length,
        end: stat.size - AUTH_TAG_BYTES - 1,
      }),
      decipher,
      new PositionedFileWriter(output, 0),
    );
    await output.sync();
    await output.close();
    output = undefined;
    await options.beforePublish?.();
    await link(temporary, destinationPath);
    syncDirectoryDurably(outputDirectory);
    await unlink(temporary);
    temporaryCreated = false;
    syncDirectoryDurably(outputDirectory);
  } catch (error) {
    failure = error;
  }
  try {
    await output?.close();
  } catch (error) {
    failure ??= error;
  }
  try {
    await source.close();
  } catch (error) {
    failure ??= error;
  }
  if (temporaryCreated) {
    try {
      rmSync(temporary, { force: true });
      syncDirectoryDurably(outputDirectory);
    } catch (error) {
      failure ??= error;
    }
  }
  if (failure) throw failure;
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
  if (deleted.length > 0) syncDirectoryDurably(root);
  return deleted;
}

export class BackupManager {
  private readonly backupDirectory: string;
  private readonly now: () => Date;
  private readonly backupDatabase: NativeBackup;
  private readonly validateBackup: (path: string) => void | Promise<void>;
  private readonly encryptBackup: typeof encryptBackupFile;
  private readonly promoteBackup: (
    temporaryPath: string,
    finalPath: string,
  ) => void | Promise<void>;
  private inFlight?: Promise<string>;
  private finalInFlight?: Promise<string>;

  constructor(private readonly options: BackupManagerOptions) {
    if (options.encryptionKey) ensureEncryptionKey(options.encryptionKey);
    this.backupDirectory = resolve(options.backupDirectory);
    preparePrivateBackupDirectory(this.backupDirectory);
    this.now = options.now ?? (() => new Date());
    this.backupDatabase = options.backupDatabase ?? defaultNativeBackup;
    this.validateBackup = options.validateBackup ?? validateSqliteBackup;
    this.encryptBackup = options.encryptBackup ?? encryptBackupFile;
    this.promoteBackup = options.promoteBackup ?? promoteCompletedBackup;
  }

  backup(): Promise<string> {
    if (this.inFlight) return this.inFlight;
    return this.startBackup();
  }

  backupAfterCurrent(): Promise<string> {
    if (this.finalInFlight) return this.finalInFlight;
    const pending = this.performFinalBackup();
    this.finalInFlight = pending;
    void pending.then(
      () => {
        if (this.finalInFlight === pending) this.finalInFlight = undefined;
      },
      () => {
        if (this.finalInFlight === pending) this.finalInFlight = undefined;
      },
    );
    return pending;
  }

  private startBackup(): Promise<string> {
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

  private async performFinalBackup(): Promise<string> {
    while (this.inFlight) {
      const current = this.inFlight;
      try {
        await current;
      } catch {
        // A final post-writer snapshot is still required after a daily failure.
      }
      if (this.inFlight === current) this.inFlight = undefined;
    }
    return this.startBackup();
  }

  private async performBackup(): Promise<string> {
    const now = this.now();
    const date = formatKstBackupDate(now);
    const directory = this.backupDirectory;
    const identifier = randomUUID();
    const plaintext = join(directory, `.poker-doku-${date}.${identifier}.sqlite.tmp`);
    const encrypted = join(directory, `.poker-doku-${date}.${identifier}.sqlite.enc.tmp`);
    const suffix = this.options.encryptionKey ? '.sqlite.enc' : '.sqlite';
    const finalPath = join(directory, `poker-doku-${date}${suffix}`);

    try {
      const reservation = openSync(plaintext, 'wx', 0o600);
      try {
        chmodSync(plaintext, 0o600);
      } finally {
        closeSync(reservation);
      }
      await this.backupDatabase(this.options.database.db, plaintext);
      await secureAndSyncFile(plaintext);
      await this.validateBackup(plaintext);
      let completed = plaintext;
      if (this.options.encryptionKey) {
        await this.encryptBackup(
          plaintext,
          encrypted,
          this.options.encryptionKey,
        );
        completed = encrypted;
      }
      await this.promoteBackup(completed, finalPath);
      await secureAndSyncFile(finalPath);
      syncDirectoryDurably(directory);
      await pruneExpiredBackups(directory, now);
      return finalPath;
    } finally {
      const hadTemporary = existsSync(plaintext) || existsSync(encrypted);
      rmSync(plaintext, { force: true });
      rmSync(encrypted, { force: true });
      if (hadTemporary) syncDirectoryDurably(directory);
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
