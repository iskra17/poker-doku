import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SOCKET_RATE_LIMITS, SocketRateLimiter } from './socket-rate-limit';

describe('소켓 sliding-window 제한', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-16T00:00:00.000Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('요청 그룹별 정책을 고정한다', () => {
    expect(SOCKET_RATE_LIMITS).toEqual({
      playerAction: { limit: 12, windowMs: 2_000 },
      joinRoom: { limit: 5, windowMs: 10_000 },
      roomSync: { limit: 10, windowMs: 5_000 },
      createRoom: { limit: 1, windowMs: 5_000 },
      chat: { limit: 1, windowMs: 700 },
    });
  });

  it.each(Object.entries(SOCKET_RATE_LIMITS))('%s 그룹은 한도까지만 허용한다', (key, rule) => {
    const limiter = new SocketRateLimiter();
    for (let index = 0; index < rule.limit; index++) {
      expect(limiter.allow(key, rule)).toBe(true);
    }
    expect(limiter.allow(key, rule)).toBe(false);
  });

  it('윈도우 경계가 지나면 오래된 요청을 버리고 다시 허용한다', () => {
    const limiter = new SocketRateLimiter();
    const rule = { limit: 2, windowMs: 100 };
    expect(limiter.allow('test', rule)).toBe(true);
    vi.advanceTimersByTime(50);
    expect(limiter.allow('test', rule)).toBe(true);
    vi.advanceTimersByTime(49);
    expect(limiter.allow('test', rule)).toBe(false);
    vi.advanceTimersByTime(1);
    expect(limiter.allow('test', rule)).toBe(true);
  });

  it('요청 그룹과 limiter 인스턴스의 윈도우를 서로 격리한다', () => {
    const first = new SocketRateLimiter();
    const second = new SocketRateLimiter();
    const rule = { limit: 1, windowMs: 100 };

    expect(first.allow('roomSync', rule)).toBe(true);
    expect(first.allow('roomSync', rule)).toBe(false);
    expect(first.allow('playerAction', rule)).toBe(true);
    expect(second.allow('roomSync', rule)).toBe(true);
  });
});
