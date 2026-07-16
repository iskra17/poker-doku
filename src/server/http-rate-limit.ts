export interface HttpRateLimitPolicy {
  limit: number;
  windowMs: number;
}

export const PROFILE_HTTP_RATE_POLICIES = {
  profileCreate: { limit: 20, windowMs: 60 * 60_000 },
  profileRecover: { limit: 5, windowMs: 15 * 60_000 },
  profileAuth: { limit: 30, windowMs: 60_000 },
  daily: { limit: 30, windowMs: 60_000 },
  rescue: { limit: 30, windowMs: 60_000 },
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

  constructor(private readonly maximum: number = 4) {
    if (!Number.isSafeInteger(maximum) || maximum < 1) {
      throw new Error('HTTP_CONCURRENCY_LIMIT_INVALID');
    }
  }

  async run<T>(work: () => Promise<T>): Promise<T> {
    if (this.active >= this.maximum) {
      throw new HttpConcurrencyLimitError();
    }
    this.active += 1;
    try {
      return await work();
    } finally {
      this.active -= 1;
    }
  }
}
