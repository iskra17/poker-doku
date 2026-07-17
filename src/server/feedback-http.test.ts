import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { PublicProfile } from '@/lib/profile/types';
import { createHttpRequestHandler } from './http-handler';
import { FeedbackRepository } from './feedback-http';
import {
  TransientHttpConcurrencyGate,
  TransientHttpRateLimiter,
} from './http-rate-limit';
import { openPokerDatabase, type PokerDatabase } from './persistence/database';
import type { ProfileHttpManager } from './profile-http';

const NOW = Date.parse('2026-07-17T12:00:00+09:00');
const DAY = 24 * 60 * 60 * 1_000;

describe('feedback HTTP API', () => {
  let database: PokerDatabase;
  let repository: FeedbackRepository;
  let limiter: TransientHttpRateLimiter;
  let baseUrl: string;
  let close: () => Promise<void>;
  const profile: PublicProfile = {
    id: 'feedback-profile',
    alias: '단골손님',
    avatarId: 'sakura',
    wallet: { balance: 10_000, activeEscrow: 0 },
  };

  beforeEach(async () => {
    database = openPokerDatabase(':memory:');
    insertProfile(database, profile.id);
    repository = new FeedbackRepository(database);
    limiter = new TransientHttpRateLimiter();
    const manager = {
      authenticateCredential: async (credential: string) =>
        (credential === 'good-credential' ? profile : null),
    } as ProfileHttpManager;
    const server = createServer(createHttpRequestHandler((_req, res) => {
      res.writeHead(404);
      res.end();
    }, {
      database,
      debugToken: 'debug-secret',
      profileManager: manager,
      economyService: {
        claimDaily: () => { throw new Error('unused'); },
        claimRescue: () => { throw new Error('unused'); },
        getStatus: () => { throw new Error('unused'); },
      },
      profileRateLimiter: limiter,
      profileConcurrencyGate: new TransientHttpConcurrencyGate(1),
      production: false,
      now: () => NOW,
    }));
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    close = () => new Promise(resolve => server.close(() => resolve()));
  });

  afterEach(async () => {
    await close();
    limiter.close();
    database.close();
  });

  function submit(body: unknown, cookie = 'poker_doku_profile=good-credential') {
    return fetch(`${baseUrl}/api/feedback`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        cookie,
      },
      body: JSON.stringify(body),
    });
  }

  it('stores an authenticated submission and lists it for the operator', async () => {
    const created = await submit({
      category: 'idea',
      message: '  봇 난이도를 고를 수 있으면 좋겠어요  ',
    });
    expect(created.status).toBe(201);
    expect(await created.json()).toEqual({ ok: true });

    const listed = await fetch(
      `${baseUrl}/api/debug/feedback?token=debug-secret`,
    );
    expect(listed.status).toBe(200);
    const payload = await listed.json();
    expect(payload.count).toBe(1);
    expect(payload.items[0]).toMatchObject({
      profileId: profile.id,
      alias: profile.alias,
      category: 'idea',
      message: '봇 난이도를 고를 수 있으면 좋겠어요',
      createdAt: NOW,
    });
    expect(JSON.stringify(payload)).not.toMatch(
      /email|phone|credential|recovery|wallet/iu,
    );
  });

  it('rejects missing auth, bad categories, and short messages', async () => {
    const noCookie = await submit({ category: 'bug', message: '12345' }, '');
    expect(noCookie.status).toBe(401);
    const badCredential = await submit(
      { category: 'bug', message: '12345' },
      'poker_doku_profile=stolen',
    );
    expect(badCredential.status).toBe(401);
    const badCategory = await submit({ category: 'spam', message: '12345' });
    expect(badCategory.status).toBe(400);
    const shortMessage = await submit({ category: 'bug', message: '  네  ' });
    expect(shortMessage.status).toBe(400);
    const longMessage = await submit({
      category: 'bug',
      message: 'a'.repeat(501),
    });
    expect(longMessage.status).toBe(400);
    const wrongMethod = await fetch(`${baseUrl}/api/feedback`);
    expect(wrongMethod.status).toBe(405);
  });

  it('limits submissions per address inside the window', async () => {
    for (let index = 0; index < 5; index += 1) {
      const accepted = await submit({
        category: 'other',
        message: `연속 의견 ${index}번째입니다`,
      });
      expect(accepted.status).toBe(201);
    }
    const blocked = await submit({
      category: 'other',
      message: '여섯 번째 의견입니다',
    });
    expect(blocked.status).toBe(429);
    expect((await blocked.json()).error.code).toBe('FEEDBACK_RATE_LIMITED');
  });

  it('caps a profile at ten submissions per day', async () => {
    for (let index = 0; index < 10; index += 1) {
      repository.insert({
        profileId: profile.id,
        alias: profile.alias,
        category: 'other',
        message: `이전 의견 ${index}번째입니다`,
        createdAt: NOW - DAY + 1 + index,
      });
    }
    const blocked = await submit({
      category: 'bug',
      message: '오늘 열한 번째 의견입니다',
    });
    expect(blocked.status).toBe(429);
    expect((await blocked.json()).error.code).toBe('FEEDBACK_DAILY_LIMIT');
  });

  it('protects the operator listing behind the debug token', async () => {
    expect((await fetch(`${baseUrl}/api/debug/feedback`)).status).toBe(403);
    expect((await fetch(
      `${baseUrl}/api/debug/feedback?token=wrong`,
    )).status).toBe(403);

    for (let index = 0; index < 3; index += 1) {
      repository.insert({
        profileId: profile.id,
        alias: profile.alias,
        category: 'bug',
        message: `순서 확인용 의견 ${index}번째`,
        createdAt: NOW + index,
      });
    }
    const page = await fetch(
      `${baseUrl}/api/debug/feedback?token=debug-secret&limit=2`,
    );
    const payload = await page.json();
    expect(payload.items.map((item: { message: string }) => item.message))
      .toEqual(['순서 확인용 의견 2번째', '순서 확인용 의견 1번째']);
    const older = await fetch(
      `${baseUrl}/api/debug/feedback?token=debug-secret&limit=2&before=${payload.items[1].id}`,
    );
    expect((await older.json()).items.map(
      (item: { message: string }) => item.message,
    )).toEqual(['순서 확인용 의견 0번째']);
  });
});

function insertProfile(database: PokerDatabase, id: string): void {
  database.db.prepare(`
    INSERT INTO profiles (
      id, credential_hash, credential_lookup, recovery_hash, recovery_lookup,
      alias, avatar_id, adult_confirmed_at, created_at, updated_at
    ) VALUES (?, 'hash', 'lookup', 'recovery', 'recovery-lookup',
              '단골손님', 'sakura', 1, 1, 1)
  `).run(id);
}
