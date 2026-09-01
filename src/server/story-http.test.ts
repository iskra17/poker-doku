import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { PublicProfile } from '@/lib/profile/types';
import type { StoryProgressView } from '@/lib/story/views';
import { createHttpRequestHandler } from './http-handler';
import { TransientHttpConcurrencyGate, TransientHttpRateLimiter } from './http-rate-limit';
import type { ProfileHttpManager } from './profile-http';

const HERO_ID = 'profile-hero';

function makeProgress(profileId: string): StoryProgressView {
  return {
    chapters: [{ chapterId: 'act1-ch01', attempts: 1, completions: 0, bestGrade: null, unlocked: true }],
    flags: { [`seen:${profileId}`]: '1' },
    belt: 'white',
    nextChapterId: 'act1-ch01',
    drillStats: { total: 0, correct: 0, byCategory: {} },
    reviewQueue: 0,
    daily: { date: '2026-09-02', done: 0, total: 3, available: false, teacherId: null },
    activeRun: null,
  };
}

describe('GET /api/story', () => {
  let limiter: TransientHttpRateLimiter;
  let baseUrl: string;
  let close: () => Promise<void>;
  let progressImpl: (profileId: string) => StoryProgressView | null;

  const heroProfile: PublicProfile = {
    id: HERO_ID,
    alias: '히어로',
    avatarId: 'sakura',
    wallet: { balance: 10_000, activeEscrow: 0 },
  };

  beforeEach(async () => {
    limiter = new TransientHttpRateLimiter();
    progressImpl = makeProgress;
    const manager = {
      authenticateCredential: async (credential: string) => (credential === 'hero-credential' ? heroProfile : null),
    } as ProfileHttpManager;
    const server = createServer(createHttpRequestHandler((_req, res) => {
      res.writeHead(404);
      res.end();
    }, {
      profileManager: manager,
      economyService: {
        claimDaily: () => { throw new Error('unused'); },
        claimRescue: () => { throw new Error('unused'); },
        getStatus: () => { throw new Error('unused'); },
      },
      profileRateLimiter: limiter,
      profileConcurrencyGate: new TransientHttpConcurrencyGate(1),
      production: false,
      storyProgress: profileId => progressImpl(profileId),
    }));
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    close = () => new Promise(resolve => server.close(() => resolve()));
  });

  afterEach(async () => {
    await close();
    limiter.close();
  });

  function get(cookie: string | null = 'poker_doku_profile=hero-credential', method = 'GET') {
    return fetch(`${baseUrl}/api/story`, { method, headers: cookie ? { cookie } : {} });
  }

  it('returns the progress view for the authenticated profile', async () => {
    const response = await get();
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    const payload = await response.json();
    expect(payload.progress).toEqual(makeProgress(HERO_ID));
  });

  it('requires a profile cookie', async () => {
    expect((await get(null)).status).toBe(401);
    expect((await get('poker_doku_profile=stranger')).status).toBe(401);
  });

  it('rejects non-GET methods and unrelated paths', async () => {
    expect((await get('poker_doku_profile=hero-credential', 'POST')).status).toBe(405);
    const other = await fetch(`${baseUrl}/api/story/extra`, { headers: { cookie: 'poker_doku_profile=hero-credential' } });
    expect(other.status).toBe(404);
  });

  it('returns 503 before the runtime binds and 500 when the view throws', async () => {
    progressImpl = () => null;
    expect((await get()).status).toBe(503);
    progressImpl = () => { throw new Error('boom'); };
    expect((await get()).status).toBe(500);
  });

  it('rate-limits per client address', async () => {
    for (let index = 0; index < 30; index++) {
      expect((await get()).status).toBe(200);
    }
    expect((await get()).status).toBe(429);
  });
});
