import { describe, expect, it } from 'vitest';
import {
  ArenaScheduler,
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
  private nextHandle = 0;
  private activeHandle: number | undefined;

  constructor(now: number) {
    this.now = now;
  }

  readonly setTimer = (callback: () => void, delay: number): number => {
    this.nextHandle += 1;
    this.activeHandle = this.nextHandle;
    this.callback = callback;
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
