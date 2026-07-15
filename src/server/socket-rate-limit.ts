export interface SocketRateLimitRule {
  limit: number;
  windowMs: number;
}

export const SOCKET_RATE_LIMITS = {
  playerAction: { limit: 12, windowMs: 2_000 },
  joinRoom: { limit: 5, windowMs: 10_000 },
  roomSync: { limit: 10, windowMs: 5_000 },
  createRoom: { limit: 1, windowMs: 5_000 },
  chat: { limit: 1, windowMs: 700 },
} as const satisfies Record<string, SocketRateLimitRule>;

export class SocketRateLimiter {
  private readonly requests = new Map<string, number[]>();

  allow(key: string, rule: SocketRateLimitRule): boolean {
    const now = Date.now();
    const timestamps = this.requests.get(key) ?? [];
    const cutoff = now - rule.windowMs;
    let expired = 0;
    while (expired < timestamps.length && timestamps[expired] <= cutoff) expired++;
    if (expired > 0) timestamps.splice(0, expired);

    if (timestamps.length >= rule.limit) return false;

    timestamps.push(now);
    this.requests.set(key, timestamps);
    return true;
  }
}
