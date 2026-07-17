import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createHmac } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PublicProfile } from '@/lib/profile/types';
import {
  createArenaHttpHandler,
  type ArenaHttpService,
} from './arena-http';

const NOW = Date.parse('2026-07-20T12:00:00+09:00');
const PROFILE: PublicProfile = {
  id: 'profile-self',
  alias: '본인',
  avatarId: 'sakura',
  wallet: { balance: 999_999, activeEscrow: 0 },
};

describe('arena HTTP API', () => {
  let baseUrl: string;
  let close: () => Promise<void>;
  let enabled: boolean;
  let currentNow: number;
  let service: ArenaHttpService;

  beforeEach(async () => {
    enabled = true;
    currentNow = NOW;
    const rows = Array.from({ length: 56 }, (_, index) => ({
      stableId: `profile-${String(index + 1).padStart(2, '0')}`,
      alias: `도전자 ${index + 1}`,
      avatarId: 'sakura',
      cosmetics: { titleId: null, frameId: null },
      place: index + 1,
      score: 100 - index,
      matches: 3,
      tier: 'gold' as const,
    }));
    service = {
      getSnapshot: vi.fn(() => ({
        season: {
          startsAt: NOW - 1_000,
          endsAt: NOW + 10_000,
          remainingMs: 10_000,
          preseason: true,
          preseasonScarceRewardsSuppressed: true,
        },
        profile: {
          availableTickets: 2,
          placementGames: 2,
          placementMatches: 5,
          placementPoints: 160,
          tier: null,
        },
        weekly: {
          groupAssigned: true,
          rank: 4,
          score: 75,
          matches: 3,
          memberCount: 20,
          tier: 'gold' as const,
        },
      })),
      getGroupLeaderboard: vi.fn(() => ({
        contextId: 'arena-v1-0:2026-W30:group-a',
        tier: 'gold' as const,
        smallGroup: false,
        promotionGamesRequired: 3,
        rows: rows.map((row, index) => ({
          ...row,
          isSelf: index === 3,
        })),
      })),
      getGlobalLeaderboard: vi.fn(() => ({
        contextId: 'arena-v1-0',
        season: { startsAt: NOW - 1_000, endsAt: NOW + 10_000 },
        rows,
      })),
      getRewards: vi.fn(() => ({
        season: {
          id: 'arena-v1-0',
          preseason: true,
          preseasonScarceRewardsSuppressed: true,
        },
        items: [{
          rewardKey: 'participation-emblem',
          name: '참가 엠블럼',
          description: '10경기 참가 보상',
          kind: 'emblem' as const,
        }],
      })),
    };
    const handler = createArenaHttpHandler({
      enabled: () => enabled,
      manager: {
        authenticateCredential: async credential => (
          credential === 'good-credential' ? PROFILE : null
        ),
      },
      service,
      production: false,
      cursorSecret: 'test-cursor-secret-that-is-long-enough',
      now: () => currentNow,
    });
    const server = createServer((request, response) => {
      void handler(request, response, new URL(
        request.url ?? '/',
        'http://127.0.0.1',
      )).then(handled => {
        if (handled) return;
        response.writeHead(404);
        response.end();
      });
    });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    close = () => new Promise(resolve => server.close(() => resolve()));
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await close();
  });

  it('returns a private authenticated no-store snapshot without hidden fields', async () => {
    const response = await request('/api/arena');
    const text = await response.text();
    const body = JSON.parse(text) as Record<string, unknown>;

    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(body).toMatchObject({
      enabled: true,
      season: { remainingMs: 10_000, preseason: true },
      profile: { availableTickets: 2, placementGames: 2, placementMatches: 5 },
      weekly: { rank: 4, score: 75, matches: 3 },
    });
    expect(text).not.toMatch(/mmr|credential|secret|wallet|device|recovery|profileId/iu);
  });

  it('uses bounded pages and private/public cache policies', async () => {
    const group = await request('/api/arena/leaderboard/group');
    const global = await fetch(`${baseUrl}/api/arena/leaderboard/global`);
    const groupBody = await group.json() as {
      items: unknown[];
      nextCursor: string | null;
    };
    const globalBody = await global.json() as {
      items: unknown[];
      nextCursor: string | null;
    };

    expect(group.status).toBe(200);
    expect(group.headers.get('cache-control')).toBe('private, max-age=5');
    expect(groupBody.items).toHaveLength(50);
    expect(groupBody.nextCursor).toEqual(expect.any(String));
    expect(global.status).toBe(200);
    expect(global.headers.get('cache-control')).toBe('public, max-age=30');
    expect(globalBody.items).toHaveLength(50);
    expect(globalBody.nextCursor).toEqual(expect.any(String));
    expect(JSON.stringify(globalBody)).not.toMatch(/stableId|profileId|mmr/iu);
  });

  it('accepts a valid scoped cursor and safely rejects tamper and scope reuse', async () => {
    const first = await fetch(`${baseUrl}/api/arena/leaderboard/global`);
    const cursor = (await first.json() as { nextCursor: string }).nextCursor;
    const decodedCursor = Buffer.from(
      cursor.split('.')[0],
      'base64url',
    ).toString('utf8');
    const next = await fetch(
      `${baseUrl}/api/arena/leaderboard/global?cursor=${encodeURIComponent(cursor)}`,
    );
    const tampered = await fetch(
      `${baseUrl}/api/arena/leaderboard/global?cursor=${encodeURIComponent(`${cursor}x`)}`,
    );
    const wrongScope = await request(
      `/api/arena/leaderboard/group?cursor=${encodeURIComponent(cursor)}`,
    );

    expect(next.status).toBe(200);
    expect((await next.json() as { items: unknown[] }).items).toHaveLength(6);
    expect(tampered.status).toBe(400);
    expect(wrongScope.status).toBe(400);
    expect(decodedCursor).not.toMatch(/profile-|arena-v1-|도전자/iu);
  });

  it('rejects expired and signed unsupported cursor versions', async () => {
    const first = await fetch(`${baseUrl}/api/arena/leaderboard/global`);
    const cursor = (await first.json() as { nextCursor: string }).nextCursor;
    const [data] = cursor.split('.');
    const payload = JSON.parse(
      Buffer.from(data, 'base64url').toString('utf8'),
    ) as Record<string, unknown>;
    const unsupportedData = Buffer.from(JSON.stringify({
      ...payload,
      v: 2,
    })).toString('base64url');
    const unsupportedSignature = createHmac(
      'sha256',
      'test-cursor-secret-that-is-long-enough',
    ).update(unsupportedData).digest('base64url');
    const unsupported = `${unsupportedData}.${unsupportedSignature}`;

    const versionResponse = await fetch(
      `${baseUrl}/api/arena/leaderboard/global?cursor=${encodeURIComponent(unsupported)}`,
    );
    currentNow = NOW + 5 * 60_000 + 1;
    const expiredResponse = await fetch(
      `${baseUrl}/api/arena/leaderboard/global?cursor=${encodeURIComponent(cursor)}`,
    );

    expect(versionResponse.status).toBe(400);
    expect(expiredResponse.status).toBe(400);
  });

  it('returns reward metadata and suppresses all scarcity claims in preseason', async () => {
    const response = await fetch(`${baseUrl}/api/arena/rewards`);
    const text = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('public, max-age=30');
    expect(JSON.parse(text)).toMatchObject({
      enabled: true,
      season: {
        preseason: true,
        preseasonScarceRewardsSuppressed: true,
      },
    });
    expect(text).not.toMatch(/profileId|mmr|wallet|credential/iu);
  });

  it('requires authentication for private routes and reflects no credential', async () => {
    const absent = await fetch(`${baseUrl}/api/arena`);
    const invalid = await fetch(`${baseUrl}/api/arena/leaderboard/group`, {
      headers: { cookie: 'poker_doku_profile=do-not-reflect-me' },
    });

    expect(absent.status).toBe(401);
    expect(invalid.status).toBe(401);
    expect(await invalid.text()).not.toContain('do-not-reflect-me');
  });

  it('returns safe disabled responses without calling arena data services', async () => {
    enabled = false;
    const snapshot = await request('/api/arena');
    const global = await fetch(`${baseUrl}/api/arena/leaderboard/global`);
    const rewards = await fetch(`${baseUrl}/api/arena/rewards`);

    expect(await snapshot.json()).toEqual({ enabled: false });
    expect(await global.json()).toEqual({
      enabled: false,
      items: [],
      nextCursor: null,
    });
    expect(await rewards.json()).toEqual({
      enabled: false,
      items: [],
    });
    expect(service.getSnapshot).not.toHaveBeenCalled();
    expect(service.getGlobalLeaderboard).not.toHaveBeenCalled();
    expect(service.getRewards).not.toHaveBeenCalled();
  });

  it('rejects unsupported methods and duplicate cursor parameters', async () => {
    const method = await request('/api/arena', { method: 'POST' });
    const duplicate = await fetch(
      `${baseUrl}/api/arena/leaderboard/global?cursor=a&cursor=b`,
    );

    expect(method.status).toBe(405);
    expect(method.headers.get('allow')).toBe('GET');
    expect(duplicate.status).toBe(400);
  });

  function request(path: string, init: RequestInit = {}): Promise<Response> {
    return fetch(`${baseUrl}${path}`, {
      ...init,
      headers: {
        cookie: 'poker_doku_profile=good-credential',
        ...init.headers,
      },
    });
  }
});
