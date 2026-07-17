import { describe, expect, it } from 'vitest';
import {
  ArenaScheduler,
  MAX_ARENA_TIMER_DELAY_MS,
  getNextArenaReconcileAt,
  getNextKstMonday,
} from './arena-scheduler';

const EPOCH = Date.parse('2026-07-20T00:00:00+09:00');
const HOUR = 60 * 60 * 1_000;
const DAY = 24 * HOUR;

describe('ArenaScheduler', () => {
  it('waits at the absolute epoch when started before the season', () => {
    const fake = new FakeTimers(EPOCH - DAY);
    const calls: number[] = [];
    const scheduler = new ArenaScheduler({
      epochMs: EPOCH,
      now: () => fake.now,
      reconcile: at => calls.push(at),
      setTimer: fake.setTimer,
      clearTimer: fake.clearTimer,
    });

    scheduler.start();
    expect(calls).toEqual([]);
    expect(fake.nextAt).toBe(EPOCH);
    fake.now = EPOCH;
    fake.fire();
    expect(calls).toEqual([EPOCH]);
    expect(fake.nextAt).toBe(EPOCH + 7 * DAY);
    scheduler.close();
  });

  it('chunks a far epoch without reconciling early or creating a 1ms loop', () => {
    const farEpoch = EPOCH + 70 * DAY;
    const fake = new FakeTimers(EPOCH);
    const calls: number[] = [];
    const scheduler = new ArenaScheduler({
      epochMs: farEpoch,
      now: () => fake.now,
      reconcile: at => calls.push(at),
      setTimer: fake.setTimer,
      clearTimer: fake.clearTimer,
    });

    scheduler.start();
    expect(calls).toEqual([]);
    expect(fake.lastDelay).toBe(MAX_ARENA_TIMER_DELAY_MS);

    const earlyCallback = fake.callback;
    earlyCallback?.();
    expect(calls).toEqual([]);
    expect(fake.lastDelay).toBe(MAX_ARENA_TIMER_DELAY_MS);
    expect(fake.activeCount).toBe(1);

    while ((fake.nextAt ?? farEpoch) < farEpoch) {
      expect(fake.lastDelay).toBeGreaterThan(1);
      expect(fake.lastDelay).toBeLessThanOrEqual(MAX_ARENA_TIMER_DELAY_MS);
      fake.now = fake.nextAt!;
      fake.fire();
      expect(calls).toEqual([]);
    }
    expect(fake.nextAt).toBe(farEpoch);
    expect(fake.lastDelay).toBeGreaterThan(1);
    expect(fake.lastDelay).toBeLessThanOrEqual(MAX_ARENA_TIMER_DELAY_MS);

    fake.now = farEpoch;
    fake.fire();
    expect(calls).toEqual([farEpoch]);
    expect(fake.activeCount).toBe(1);
    scheduler.close();
  });

  it('closes during a long-delay chunk without leaking or reconciling', () => {
    const fake = new FakeTimers(EPOCH);
    const calls: number[] = [];
    const scheduler = new ArenaScheduler({
      epochMs: EPOCH + 70 * DAY,
      now: () => fake.now,
      reconcile: at => calls.push(at),
      setTimer: fake.setTimer,
      clearTimer: fake.clearTimer,
    });
    scheduler.start();
    const racedCallback = fake.callback;
    scheduler.close();
    racedCallback?.();
    expect(calls).toEqual([]);
    expect(fake.activeCount).toBe(0);
  });

  it('finds the next absolute KST Monday and season boundary', () => {
    const wednesday = Date.parse('2026-07-22T12:00:00+09:00');
    expect(getNextKstMonday(wednesday))
      .toBe(Date.parse('2026-07-27T00:00:00+09:00'));
    expect(getNextKstMonday(Date.parse('2026-07-27T00:00:00+09:00')))
      .toBe(Date.parse('2026-08-03T00:00:00+09:00'));
    expect(getNextArenaReconcileAt(EPOCH - DAY, EPOCH)).toBe(EPOCH);
    expect(getNextArenaReconcileAt(EPOCH + 27 * DAY, EPOCH))
      .toBe(EPOCH + 28 * DAY);
  });

  it('reconciles at startup and recomputes from absolute time after a late timer', () => {
    const fake = new FakeTimers(Date.parse('2026-07-22T12:00:00+09:00'));
    const calls: number[] = [];
    const scheduler = new ArenaScheduler({
      epochMs: EPOCH,
      now: () => fake.now,
      reconcile: at => calls.push(at),
      setTimer: fake.setTimer,
      clearTimer: fake.clearTimer,
    });

    scheduler.start();
    scheduler.start();
    expect(calls).toEqual([fake.now]);
    expect(fake.activeCount).toBe(1);
    expect(fake.nextAt).toBe(Date.parse('2026-07-27T00:00:00+09:00'));

    fake.now = fake.nextAt! + HOUR;
    fake.fire();
    expect(calls.at(-1)).toBe(fake.now);
    expect(fake.nextAt).toBe(Date.parse('2026-08-03T00:00:00+09:00'));
    expect(fake.activeCount).toBe(1);
  });

  it('retries one failed reconciliation after 30 seconds then restores the absolute schedule', () => {
    const fake = new FakeTimers(EPOCH);
    const calls: number[] = [];
    const errors: unknown[][] = [];
    let attempts = 0;
    const scheduler = new ArenaScheduler({
      epochMs: EPOCH,
      now: () => fake.now,
      reconcile: at => {
        calls.push(at);
        attempts += 1;
        if (attempts === 1) throw new Error('transient-reconcile');
      },
      setTimer: fake.setTimer,
      clearTimer: fake.clearTimer,
      logger: { error: (...args: unknown[]) => errors.push(args) },
    });

    expect(() => scheduler.start()).not.toThrow();
    expect(calls).toEqual([EPOCH]);
    expect(errors).toHaveLength(1);
    expect(fake.activeCount).toBe(1);
    expect(fake.nextAt).toBe(EPOCH + 30_000);

    fake.now = fake.nextAt!;
    fake.fire();
    expect(calls).toEqual([EPOCH, EPOCH + 30_000]);
    expect(fake.activeCount).toBe(1);
    expect(fake.nextAt).toBe(EPOCH + 7 * DAY);
    scheduler.close();
  });

  it('starts the retry delay when a slow failed reconciliation completes', () => {
    const fake = new FakeTimers(EPOCH);
    const scheduler = new ArenaScheduler({
      epochMs: EPOCH,
      now: () => fake.now,
      reconcile: () => {
        fake.now += 40_000;
        throw new Error('slow-reconcile');
      },
      setTimer: fake.setTimer,
      clearTimer: fake.clearTimer,
      logger: { error: () => undefined },
    });

    scheduler.start();

    expect(fake.nextAt).toBe(EPOCH + 70_000);
    expect(fake.lastDelay).toBe(30_000);
    scheduler.close();
  });

  it('keeps one bounded retry timer across repeated failures and close cancels it', () => {
    const fake = new FakeTimers(EPOCH);
    const calls: number[] = [];
    const scheduler = new ArenaScheduler({
      epochMs: EPOCH,
      now: () => fake.now,
      reconcile: at => {
        calls.push(at);
        throw new Error('persistent-reconcile');
      },
      retryDelayMs: 5_000,
      setTimer: fake.setTimer,
      clearTimer: fake.clearTimer,
      logger: { error: () => undefined },
    });

    expect(() => scheduler.start()).not.toThrow();
    scheduler.start();
    expect(calls).toEqual([EPOCH]);
    expect(fake.activeCount).toBe(1);
    expect(fake.nextAt).toBe(EPOCH + 5_000);

    fake.now = fake.nextAt!;
    fake.fire();
    expect(calls).toEqual([EPOCH, EPOCH + 5_000]);
    expect(fake.activeCount).toBe(1);
    expect(fake.nextAt).toBe(EPOCH + 10_000);

    const racedRetry = fake.callback;
    scheduler.close();
    racedRetry?.();
    expect(calls).toEqual([EPOCH, EPOCH + 5_000]);
    expect(fake.activeCount).toBe(0);
  });

  it('rejects unsafe reconciliation retry delays', () => {
    for (const retryDelayMs of [
      0,
      -1,
      1.5,
      Number.NaN,
      Number.POSITIVE_INFINITY,
      MAX_ARENA_TIMER_DELAY_MS + 1,
    ]) {
      expect(() => new ArenaScheduler({
        epochMs: EPOCH,
        retryDelayMs,
        reconcile: () => undefined,
      })).toThrowError('ARENA_SCHEDULER_TIME_INVALID');
    }
  });

  it('hands a shared KST Monday and season boundary to one ordered reconcile call', () => {
    const boundary = EPOCH + 28 * DAY;
    const fake = new FakeTimers(boundary - DAY);
    const calls: number[] = [];
    const scheduler = new ArenaScheduler({
      epochMs: EPOCH,
      now: () => fake.now,
      reconcile: at => calls.push(at),
      setTimer: fake.setTimer,
      clearTimer: fake.clearTimer,
    });

    scheduler.start();
    calls.length = 0;
    expect(fake.nextAt).toBe(boundary);
    fake.now = boundary;
    fake.fire();

    expect(calls).toEqual([boundary]);
    expect(fake.nextAt).toBe(boundary + 7 * DAY);
    scheduler.close();
  });

  it('stops safely and a racing cleared callback cannot reconcile or leak a timer', () => {
    const fake = new FakeTimers(EPOCH);
    const calls: number[] = [];
    const scheduler = new ArenaScheduler({
      epochMs: EPOCH,
      now: () => fake.now,
      reconcile: at => calls.push(at),
      setTimer: fake.setTimer,
      clearTimer: fake.clearTimer,
    });
    scheduler.start();
    const racedCallback = fake.callback;
    scheduler.close();
    scheduler.close();
    expect(fake.activeCount).toBe(0);
    racedCallback?.();
    expect(calls).toEqual([EPOCH]);
    expect(fake.activeCount).toBe(0);
  });
});

class FakeTimers {
  now: number;
  callback: (() => void) | undefined;
  nextAt: number | undefined;
  activeCount = 0;
  lastDelay: number | undefined;
  private nextHandle = 0;
  private activeHandle: number | undefined;

  constructor(now: number) {
    this.now = now;
  }

  readonly setTimer = (callback: () => void, delay: number): number => {
    this.nextHandle += 1;
    this.activeHandle = this.nextHandle;
    this.callback = callback;
    this.lastDelay = delay;
    this.nextAt = this.now + delay;
    this.activeCount = 1;
    return this.nextHandle;
  };

  readonly clearTimer = (handle: unknown): void => {
    if (handle !== this.activeHandle) return;
    this.activeHandle = undefined;
    this.activeCount = 0;
  };

  fire(): void {
    const callback = this.callback;
    this.activeHandle = undefined;
    this.activeCount = 0;
    callback?.();
  }
}
