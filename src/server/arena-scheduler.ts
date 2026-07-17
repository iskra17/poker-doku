const KST_OFFSET_MS = 9 * 60 * 60 * 1_000;
const DAY_MS = 24 * 60 * 60 * 1_000;
const WEEK_MS = 7 * DAY_MS;
const SEASON_MS = 4 * WEEK_MS;
const MAX_TIMESTAMP = 253_402_300_799_999;

export const MAX_ARENA_TIMER_DELAY_MS = 2_147_483_647;
const DEFAULT_ARENA_RETRY_DELAY_MS = 30_000;

type TimerHandle = ReturnType<typeof setTimeout> | unknown;

export interface ArenaSchedulerOptions {
  readonly epochMs: number;
  readonly reconcile: (at: number) => void;
  readonly retryDelayMs?: number;
  readonly now?: () => number;
  readonly setTimer?: (callback: () => void, delay: number) => TimerHandle;
  readonly clearTimer?: (handle: TimerHandle) => void;
  readonly logger?: Pick<Console, 'error'>;
}

export function getNextKstMonday(at: number): number {
  assertTime(at);
  const shifted = new Date(safeTimeAdd(at, KST_OFFSET_MS));
  const weekday = shifted.getUTCDay();
  const daysUntilMonday = (8 - weekday) % 7 || 7;
  const next = Date.UTC(
    shifted.getUTCFullYear(),
    shifted.getUTCMonth(),
    shifted.getUTCDate() + daysUntilMonday,
  ) - KST_OFFSET_MS;
  assertTime(next);
  return next;
}

export function getNextArenaReconcileAt(at: number, epochMs: number): number {
  assertTime(at);
  assertTime(epochMs);
  if (at < epochMs) return epochMs;
  const ordinal = Math.floor((at - epochMs) / SEASON_MS);
  const seasonOffset = (ordinal + 1) * SEASON_MS;
  if (!Number.isSafeInteger(seasonOffset)) {
    throw new Error('ARENA_SCHEDULER_TIME_INVALID');
  }
  const seasonEnd = safeTimeAdd(epochMs, seasonOffset);
  const next = Math.min(getNextKstMonday(at), seasonEnd);
  assertTime(next);
  return next;
}

export class ArenaScheduler {
  readonly #options: ArenaSchedulerOptions;
  readonly #now: () => number;
  readonly #setTimer: (callback: () => void, delay: number) => TimerHandle;
  readonly #clearTimer: (handle: TimerHandle) => void;
  readonly #retryDelayMs: number;
  #timer: TimerHandle | undefined;
  #closed = false;
  #started = false;

  constructor(options: ArenaSchedulerOptions) {
    assertTime(options.epochMs);
    const retryDelayMs =
      options.retryDelayMs ?? DEFAULT_ARENA_RETRY_DELAY_MS;
    assertTimerDelay(retryDelayMs);
    this.#options = options;
    this.#now = options.now ?? Date.now;
    this.#setTimer = options.setTimer ?? ((callback, delay) =>
      setTimeout(callback, delay));
    this.#clearTimer = options.clearTimer ?? (handle =>
      clearTimeout(handle as ReturnType<typeof setTimeout>));
    this.#retryDelayMs = retryDelayMs;
  }

  start(): void {
    if (this.#closed || this.#started) return;
    this.#started = true;
    const at = this.#now();
    if (at >= this.#options.epochMs) {
      this.#reconcileOrRetry(at);
      return;
    }
    this.#scheduleNext();
  }

  close(): void {
    if (this.#closed) return;
    this.#closed = true;
    if (this.#timer !== undefined) this.#clearTimer(this.#timer);
    this.#timer = undefined;
  }

  #scheduleNext(): void {
    if (this.#closed) return;
    const now = this.#now();
    const next = getNextArenaReconcileAt(now, this.#options.epochMs);
    this.#timer = this.#setTimer(() => {
      this.#timer = undefined;
      if (this.#closed) return;
      const at = this.#now();
      if (at < next) {
        this.#scheduleNext();
        return;
      }
      this.#reconcileOrRetry(at);
    }, Math.min(MAX_ARENA_TIMER_DELAY_MS, Math.max(0, next - now)));
  }

  #reconcileOrRetry(at: number): void {
    try {
      this.#options.reconcile(at);
    } catch (error) {
      try {
        this.#options.logger?.error('> Arena reconciliation failed:', error);
      } catch {
        // Logging failure must not stop the bounded retry.
      }
      this.#scheduleRetryAt(safeTimeAdd(at, this.#retryDelayMs));
      return;
    }
    this.#scheduleNext();
  }

  #scheduleRetryAt(retryAt: number): void {
    if (this.#closed) return;
    const now = this.#now();
    assertTime(now);
    this.#timer = this.#setTimer(() => {
      this.#timer = undefined;
      if (this.#closed) return;
      const at = this.#now();
      if (at < retryAt) {
        this.#scheduleRetryAt(retryAt);
        return;
      }
      this.#reconcileOrRetry(at);
    }, Math.min(MAX_ARENA_TIMER_DELAY_MS, Math.max(0, retryAt - now)));
  }
}

function assertTime(value: number): void {
  if (
    !Number.isSafeInteger(value)
    || value < 0
    || value > MAX_TIMESTAMP
  ) {
    throw new Error('ARENA_SCHEDULER_TIME_INVALID');
  }
}

function safeTimeAdd(value: number, delta: number): number {
  if (
    !Number.isSafeInteger(delta)
    || delta < 0
    || value > MAX_TIMESTAMP - delta
  ) {
    throw new Error('ARENA_SCHEDULER_TIME_INVALID');
  }
  const result = value + delta;
  assertTime(result);
  return result;
}

function assertTimerDelay(value: number): void {
  if (
    !Number.isSafeInteger(value)
    || value < 1
    || value > MAX_ARENA_TIMER_DELAY_MS
  ) {
    throw new Error('ARENA_SCHEDULER_TIME_INVALID');
  }
}
