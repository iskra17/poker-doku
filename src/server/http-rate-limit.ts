export interface HttpRateLimitPolicy {
  limit: number;
  windowMs: number;
}

export const PROFILE_HTTP_RATE_POLICIES = {
  profileCreate: { limit: 20, windowMs: 60 * 60_000 },
  profileRecover: { limit: 5, windowMs: 15 * 60_000 },
  // 세션/소켓/진행도 인증이 공유 소비 + 한국 통신사 CGNAT는 여러 사용자가 한 IP를 공유한다 —
  // 30/분은 동일 IP 4~5명 동시 접속에도 빠듯했다 (2026-07-21 접속 장애)
  profileAuth: { limit: 120, windowMs: 60_000 },
  daily: { limit: 30, windowMs: 60_000 },
  rescue: { limit: 30, windowMs: 60_000 },
  feedback: { limit: 5, windowMs: 10 * 60_000 },
  handHistory: { limit: 30, windowMs: 60_000 },
} as const satisfies Record<string, HttpRateLimitPolicy>;

interface RateWindow {
  count: number;
  resetAt: number;
}

interface RateLimiterOptions {
  now?: () => number;
  sweepIntervalMs?: number;
}

const DEFAULT_SWEEP_INTERVAL_MS = 5 * 60_000;

export class TransientHttpRateLimiter {
  private readonly windows = new Map<string, RateWindow>();
  private readonly now: () => number;
  private readonly sweepTimer: ReturnType<typeof setInterval>;

  constructor(
    private readonly policies: Record<string, HttpRateLimitPolicy>
      = PROFILE_HTTP_RATE_POLICIES,
    options: RateLimiterOptions = {},
  ) {
    this.now = options.now ?? Date.now;
    this.sweepTimer = setInterval(
      () => this.sweepExpired(),
      options.sweepIntervalMs ?? DEFAULT_SWEEP_INTERVAL_MS,
    );
    this.sweepTimer.unref?.();
  }

  allow(operation: string, remoteAddress: string): boolean {
    const policy = this.policies[operation];
    if (!policy) throw new Error('HTTP_RATE_LIMIT_POLICY_MISSING');

    const key = `${operation}:${remoteAddress}`;
    const now = this.now();
    const current = this.windows.get(key);
    if (!current || now >= current.resetAt) {
      this.windows.set(key, {
        count: 1,
        resetAt: now + policy.windowMs,
      });
      return true;
    }
    if (current.count >= policy.limit) return false;
    current.count += 1;
    return true;
  }

  sweepExpired(): number {
    const now = this.now();
    let removed = 0;
    for (const [key, window] of this.windows) {
      if (now < window.resetAt) continue;
      this.windows.delete(key);
      removed += 1;
    }
    return removed;
  }

  close(): void {
    clearInterval(this.sweepTimer);
    this.windows.clear();
  }
}

export class HttpConcurrencyLimitError extends Error {
  constructor() {
    super('HTTP_CONCURRENCY_LIMIT');
    this.name = 'HttpConcurrencyLimitError';
  }
}

export class TransientHttpConcurrencyGate {
  private active = 0;
  private readonly waiters: Array<() => void> = [];

  constructor(
    private readonly maximum: number = 4,
    /**
     * 동시 실행 초과분을 즉시 거절하지 않고 담아두는 대기열 상한.
     * KDF(스크립트) 작업은 수십 ms 안에 슬롯이 비므로, 방문 폭주·재접속 폭풍의 순간
     * 버스트를 짧은 대기로 흡수한다 (2026-07-21 접속 장애 — 즉시 거절 방식은 스파이크마다
     * 429를 쏟아냈다). 대기열까지 차면 그때 HttpConcurrencyLimitError.
     */
    private readonly maxQueue: number = 64,
  ) {
    if (!Number.isSafeInteger(maximum) || maximum < 1) {
      throw new Error('HTTP_CONCURRENCY_LIMIT_INVALID');
    }
    if (!Number.isSafeInteger(maxQueue) || maxQueue < 0) {
      throw new Error('HTTP_CONCURRENCY_QUEUE_INVALID');
    }
  }

  async run<T>(work: () => Promise<T>): Promise<T> {
    if (this.active >= this.maximum) {
      if (this.waiters.length >= this.maxQueue) {
        throw new HttpConcurrencyLimitError();
      }
      // 슬롯 승계 대기 — 해제자가 active를 줄이는 대신 대기자에게 슬롯을 그대로 넘긴다
      // (감소→증가 사이에 새 호출이 끼어드는 초과 실행 레이스 방지)
      await new Promise<void>(resolve => this.waiters.push(resolve));
    } else {
      this.active += 1;
    }
    try {
      return await work();
    } finally {
      const next = this.waiters.shift();
      if (next) next();
      else this.active -= 1;
    }
  }
}
