import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  HttpConcurrencyLimitError,
  PROFILE_HTTP_RATE_POLICIES,
  TransientHttpConcurrencyGate,
  TransientHttpRateLimiter,
} from './http-rate-limit';

describe('TransientHttpRateLimiter', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('resets a fixed window exactly at its boundary', () => {
    let now = 1_000;
    const limiter = new TransientHttpRateLimiter(
      { create: { limit: 2, windowMs: 100 } },
      { now: () => now },
    );

    expect(limiter.allow('create', '127.0.0.1')).toBe(true);
    expect(limiter.allow('create', '127.0.0.1')).toBe(true);
    expect(limiter.allow('create', '127.0.0.1')).toBe(false);

    now = 1_099;
    expect(limiter.allow('create', '127.0.0.1')).toBe(false);
    now = 1_100;
    expect(limiter.allow('create', '127.0.0.1')).toBe(true);
    limiter.close();
  });

  it('isolates counters by operation and remote address', () => {
    const limiter = new TransientHttpRateLimiter({
      create: { limit: 1, windowMs: 1_000 },
      recover: { limit: 1, windowMs: 1_000 },
    });

    expect(limiter.allow('create', '198.51.100.1')).toBe(true);
    expect(limiter.allow('create', '198.51.100.1')).toBe(false);
    expect(limiter.allow('recover', '198.51.100.1')).toBe(true);
    expect(limiter.allow('create', '198.51.100.2')).toBe(true);
    limiter.close();
  });

  it('sweeps expired keys every five minutes and close stops the timer', async () => {
    vi.useFakeTimers();
    const limiter = new TransientHttpRateLimiter(
      { create: { limit: 1, windowMs: 100 } },
      { now: () => Date.now() },
    );

    expect(limiter.allow('create', '203.0.113.10')).toBe(true);
    expect(limiter.sweepExpired()).toBe(0);
    await vi.advanceTimersByTimeAsync(5 * 60_000);
    expect(limiter.sweepExpired()).toBe(0);

    limiter.close();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('ships the required profile and future operation policies', () => {
    const limiter = new TransientHttpRateLimiter();

    for (let index = 0; index < 20; index += 1) {
      expect(limiter.allow('profileCreate', '192.0.2.1')).toBe(true);
    }
    expect(limiter.allow('profileCreate', '192.0.2.1')).toBe(false);

    for (let index = 0; index < 5; index += 1) {
      expect(limiter.allow('profileRecover', '192.0.2.1')).toBe(true);
    }
    expect(limiter.allow('profileRecover', '192.0.2.1')).toBe(false);

    for (const operation of ['profileAuth', 'daily', 'rescue'] as const) {
      const { limit } = PROFILE_HTTP_RATE_POLICIES[operation];
      for (let index = 0; index < limit; index += 1) {
        expect(limiter.allow(operation, '192.0.2.1')).toBe(true);
      }
      expect(limiter.allow(operation, '192.0.2.1')).toBe(false);
    }
    limiter.close();
  });
});

describe('TransientHttpConcurrencyGate', () => {
  it('대기열이 없으면(maxQueue 0) 초과 작업을 즉시 거절하고, 해제 후 다시 받는다', async () => {
    const gate = new TransientHttpConcurrencyGate(1, 0);
    let release!: () => void;
    const held = gate.run(() => new Promise<void>(resolve => {
      release = resolve;
    }));

    await expect(gate.run(async () => undefined)).rejects.toBeInstanceOf(
      HttpConcurrencyLimitError,
    );

    release();
    await held;
    await expect(gate.run(async () => 'ok')).resolves.toBe('ok');
  });

  it('초과 작업은 대기열에서 기다렸다가 슬롯을 승계받아 실행된다', async () => {
    const gate = new TransientHttpConcurrencyGate(1, 8);
    let release!: () => void;
    const order: string[] = [];
    const held = gate.run(() => new Promise<void>(resolve => {
      release = resolve;
    }).then(() => order.push('first')));
    const queued = gate.run(async () => {
      order.push('second');
      return 'queued-ok';
    });

    // 대기 중 — 아직 실행되지 않아야 한다
    await new Promise(resolve => setTimeout(resolve, 10));
    expect(order).toEqual([]);

    release();
    await held;
    await expect(queued).resolves.toBe('queued-ok');
    expect(order).toEqual(['first', 'second']);
  });

  it('대기열 상한까지 차면 그때 거절한다', async () => {
    const gate = new TransientHttpConcurrencyGate(1, 1);
    let release!: () => void;
    const held = gate.run(() => new Promise<void>(resolve => {
      release = resolve;
    }));
    const queued = gate.run(async () => 'queued'); // 대기열 1/1

    await expect(gate.run(async () => 'overflow')).rejects.toBeInstanceOf(
      HttpConcurrencyLimitError,
    );

    release();
    await held;
    await expect(queued).resolves.toBe('queued');
  });

  it('releases capacity when work throws', async () => {
    const gate = new TransientHttpConcurrencyGate(1);

    await expect(gate.run(async () => {
      throw new Error('boom');
    })).rejects.toThrow('boom');
    await expect(gate.run(async () => 'recovered')).resolves.toBe('recovered');
  });
});
