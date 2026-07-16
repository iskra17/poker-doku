import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  HttpConcurrencyLimitError,
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
      for (let index = 0; index < 30; index += 1) {
        expect(limiter.allow(operation, '192.0.2.1')).toBe(true);
      }
      expect(limiter.allow(operation, '192.0.2.1')).toBe(false);
    }
    limiter.close();
  });
});

describe('TransientHttpConcurrencyGate', () => {
  it('rejects excess work and releases capacity after success', async () => {
    const gate = new TransientHttpConcurrencyGate(1);
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

  it('releases capacity when work throws', async () => {
    const gate = new TransientHttpConcurrencyGate(1);

    await expect(gate.run(async () => {
      throw new Error('boom');
    })).rejects.toThrow('boom');
    await expect(gate.run(async () => 'recovered')).resolves.toBe('recovered');
  });
});
