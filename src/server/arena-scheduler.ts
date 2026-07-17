const KST_OFFSET_MS = 9 * 60 * 60 * 1_000;
const DAY_MS = 24 * 60 * 60 * 1_000;
const WEEK_MS = 7 * DAY_MS;
const SEASON_MS = 4 * WEEK_MS;

type TimerHandle = ReturnType<typeof setTimeout> | unknown;

export interface ArenaSchedulerOptions {
  readonly epochMs: number;
  readonly reconcile: (at: number) => void;
  readonly now?: () => number;
  readonly setTimer?: (callback: () => void, delay: number) => TimerHandle;
  readonly clearTimer?: (handle: TimerHandle) => void;
  readonly logger?: Pick<Console, 'error'>;
}

export function getNextKstMonday(at: number): number {
  assertTime(at);
  const shifted = new Date(at + KST_OFFSET_MS);
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
  const seasonEnd = epochMs + (ordinal + 1) * SEASON_MS;
  const next = Math.min(getNextKstMonday(at), seasonEnd);
  assertTime(next);
  return next;
}

export class ArenaScheduler {
  readonly #options: ArenaSchedulerOptions;
  readonly #now: () => number;
  readonly #setTimer: (callback: () => void, delay: number) => TimerHandle;
  readonly #clearTimer: (handle: TimerHandle) => void;
  #timer: TimerHandle | undefined;
  #closed = false;
  #started = false;

  constructor(options: ArenaSchedulerOptions) {
    assertTime(options.epochMs);
    this.#options = options;
    this.#now = options.now ?? Date.now;
    this.#setTimer = options.setTimer ?? ((callback, delay) =>
      setTimeout(callback, delay));
    this.#clearTimer = options.clearTimer ?? (handle =>
      clearTimeout(handle as ReturnType<typeof setTimeout>));
  }

  start(): void {
    if (this.#closed || this.#started) return;
    this.#started = true;
    const at = this.#now();
    this.#options.reconcile(at);
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
      try {
        this.#options.reconcile(at);
      } catch (error) {
        try {
          this.#options.logger?.error('> Arena reconciliation failed:', error);
        } catch {
          // Logging failure must not stop the next absolute reconciliation.
        }
      } finally {
        this.#scheduleNext();
      }
    }, Math.max(0, next - now));
  }
}

function assertTime(value: number): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error('ARENA_SCHEDULER_TIME_INVALID');
  }
}
