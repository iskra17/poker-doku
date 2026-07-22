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
  // 소켓별 1차 스팸 가드 — 개인 쿨다운(playerId 키, socket-handler의 공유 리미터)과 별개
  throwItem: { limit: 3, windowMs: 10_000 },
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
