import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { eventLog } from './event-log';
import { resetGameConfigForTest } from './game-config/live';
import { GameConfigRepository } from './game-config/repository';
import { GameConfigService } from './game-config/service';
import { createHttpRequestHandler } from './http-handler';
import { OpsEventRepository, shouldPersistOpsEvent } from './ops-log';
import { openPokerDatabase, type PokerDatabase } from './persistence/database';

const NOW = Date.parse('2026-07-23T12:00:00+09:00');
const TOKEN = 'admin-secret';

describe('admin game config HTTP API', () => {
  let database: PokerDatabase;
  let gameConfig: GameConfigService;
  let opsEvents: OpsEventRepository;
  let baseUrl: string;
  let close: () => Promise<void>;
  let cookie: string;
  let csrfToken: string;

  beforeEach(async () => {
    database = openPokerDatabase(':memory:');
    gameConfig = new GameConfigService(new GameConfigRepository(database), {
      logger: { warn: vi.fn() },
      clock: () => NOW,
    });
    opsEvents = new OpsEventRepository(database);
    // 프로덕션 배선(index.ts)과 동일한 영속 싱크 — config-change 감사 기록 검증용
    eventLog.setPersistentSink(event => {
      if (shouldPersistOpsEvent(event)) opsEvents.record(event);
    });
    const server = createServer(createHttpRequestHandler((_req, res) => {
      res.writeHead(404);
      res.end();
    }, {
      database,
      debugToken: TOKEN,
      opsEvents,
      gameConfig,
      production: false,
      now: () => NOW,
    }));
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    close = () => new Promise(resolve => server.close(() => resolve()));
    const login = await fetch(`${baseUrl}/api/admin/session`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        origin: baseUrl,
      },
      body: JSON.stringify({ token: TOKEN }),
    });
    expect(login.status).toBe(201);
    cookie = login.headers.get('set-cookie')!.split(';', 1)[0];
    csrfToken = (await login.json()).csrfToken;
  });

  afterEach(async () => {
    eventLog.setPersistentSink(null);
    resetGameConfigForTest();
    await close();
    database.close();
  });

  const configUrl = () => `${baseUrl}/api/admin/config`;

  const post = (body: unknown, auth = true) =>
    fetch(configUrl(), {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        origin: baseUrl,
        ...(auth ? { cookie, 'x-csrf-token': csrfToken } : {}),
      },
      body: JSON.stringify(body),
    });

  it('rejects requests without a valid admin session', async () => {
    expect((await fetch(configUrl())).status).toBe(401);
    expect((await fetch(`${configUrl()}?token=${TOKEN}`)).status).toBe(401);
    expect((await post({ updates: { 'economy.dailyGrant': 1 } }, false)).status)
      .toBe(401);
  });

  it('returns only the opaque session view and rate-limits login by canonical client address', async () => {
    const session = await fetch(`${baseUrl}/api/admin/session`, {
      headers: { cookie },
    });
    expect(session.status).toBe(200);
    const sessionPayload = await session.json();
    expect(sessionPayload).toMatchObject({
      principal: { kind: 'backoffice-admin', id: expect.stringMatching(/^admin_/) },
      csrfToken: expect.any(String),
      expiresAt: NOW + 2 * 60 * 60 * 1_000,
    });
    expect(JSON.stringify(sessionPayload)).not.toContain(TOKEN);

    for (let attempt = 0; attempt < 5; attempt += 1) {
      const denied = await fetch(`${baseUrl}/api/admin/session`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          origin: baseUrl,
          'x-forwarded-for': `spoof-${attempt}, 203.0.113.90`,
        },
        body: JSON.stringify({ token: 'wrong' }),
      });
      expect(denied.status).toBe(401);
    }
    const limited = await fetch(`${baseUrl}/api/admin/session`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        origin: baseUrl,
        'x-forwarded-for': 'different-spoof, 203.0.113.90',
      },
      body: JSON.stringify({ token: TOKEN }),
    });
    expect(limited.status).toBe(429);
    expect(limited.headers.get('retry-after')).toBe('600');
  });

  it('rejects cross-origin login before credential verification', async () => {
    const response = await fetch(`${baseUrl}/api/admin/session`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        origin: 'https://evil.example.test',
      },
      body: JSON.stringify({ token: TOKEN }),
    });
    expect(response.status).toBe(403);
    expect(response.headers.get('set-cookie')).toBeNull();
  });

  it('serves registry metadata with current values on GET', async () => {
    const response = await fetch(configUrl(), { headers: { cookie } });
    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.groupLabels.economy).toBe('경제');
    const entry = payload.entries.find(
      (item: { key: string }) => item.key === 'economy.dailyGrant',
    );
    expect(entry).toMatchObject({
      label: '일일 무료 칩',
      group: 'economy',
      applyMode: 'immediate',
      value: 1_000,
      effectiveDefault: 1_000,
      overridden: false,
      updatedAt: null,
    });
    expect(typeof entry.min).toBe('number');
    expect(typeof entry.max).toBe('number');
  });

  it('applies updates on POST, returns the diff, and records the audit event', async () => {
    const response = await post({
      updates: {
        'economy.dailyGrant': 2_000,
        'economy.rescueDailyLimit': 5,
      },
    });
    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.changes).toEqual(expect.arrayContaining([
      { key: 'economy.dailyGrant', from: 1_000, to: 2_000 },
      { key: 'economy.rescueDailyLimit', from: 3, to: 5 },
    ]));

    // 같은 인스턴스를 읽는 게임 경로에 즉시 반영
    expect(gameConfig.get('economy.dailyGrant')).toBe(2_000);

    // GET에도 오버라이드 상태 반영
    const listed = await (await fetch(configUrl(), { headers: { cookie } })).json();
    const entry = listed.entries.find(
      (item: { key: string }) => item.key === 'economy.dailyGrant',
    );
    expect(entry).toMatchObject({ value: 2_000, overridden: true });

    // 감사 기록 — ops_event 영속 (config-change 화이트리스트)
    const audit = opsEvents.recent({ type: 'config-change' });
    expect(audit).toHaveLength(1);
    expect(audit[0].data.changes).toEqual(expect.arrayContaining([
      { key: 'economy.dailyGrant', from: 1_000, to: 2_000 },
    ]));
  });

  it('resets an override with null and skips audit for no-op posts', async () => {
    await post({ updates: { 'economy.dailyGrant': 2_000 } });
    const reset = await post({ updates: { 'economy.dailyGrant': null } });
    expect(reset.status).toBe(200);
    expect((await reset.json()).changes).toEqual([
      { key: 'economy.dailyGrant', from: 2_000, to: 1_000 },
    ]);
    expect(gameConfig.get('economy.dailyGrant')).toBe(1_000);

    const auditBefore = opsEvents.recent({ type: 'config-change' }).length;
    const noop = await post({ updates: { 'economy.rescueTarget': null } });
    expect(noop.status).toBe(200);
    expect((await noop.json()).changes).toEqual([]);
    expect(opsEvents.recent({ type: 'config-change' })).toHaveLength(auditBefore);
  });

  it('rejects invalid updates atomically with korean error messages', async () => {
    const outOfRange = await post({
      updates: {
        'economy.dailyGrant': 5_000,
        'economy.rescueDailyLimit': 999,
      },
    });
    expect(outOfRange.status).toBe(400);
    const payload = await outOfRange.json();
    expect(payload.error).toBe('validation');
    expect(payload.errors[0].key).toBe('economy.rescueDailyLimit');
    expect(gameConfig.get('economy.dailyGrant')).toBe(1_000);

    const unknownKey = await post({ updates: { 'ghost.key': 1 } });
    expect(unknownKey.status).toBe(400);

    const crossCheck = await post({ updates: { 'economy.rescueTarget': 500 } });
    expect(crossCheck.status).toBe(400);
  });

  it('rejects malformed bodies and wrong methods', async () => {
    const badShape = await post({ updates: {} });
    expect(badShape.status).toBe(400);
    const badValue = await post({ updates: { 'economy.dailyGrant': 'much' } });
    expect(badValue.status).toBe(400);
    const noJson = await fetch(configUrl(), {
      method: 'POST',
      headers: {
        cookie,
        'content-type': 'text/plain',
        origin: baseUrl,
        'x-csrf-token': csrfToken,
      },
      body: 'hello',
    });
    expect(noJson.status).toBe(400);

    const put = await fetch(configUrl(), {
      method: 'PUT',
      headers: { cookie, origin: baseUrl, 'x-csrf-token': csrfToken },
    });
    expect(put.status).toBe(405);

    // 조회 전용 라우트에 POST → 405
    const overviewPost = await fetch(
      `${baseUrl}/api/admin/overview`,
      {
        method: 'POST',
        headers: { cookie, origin: baseUrl, 'x-csrf-token': csrfToken },
      },
    );
    expect(overviewPost.status).toBe(405);
  });

  it('requires exact origin and csrf before an admin mutation', async () => {
    const missingCsrf = await fetch(configUrl(), {
      method: 'POST',
      headers: { cookie, 'content-type': 'application/json', origin: baseUrl },
      body: JSON.stringify({ updates: { 'economy.dailyGrant': 2_000 } }),
    });
    expect(missingCsrf.status).toBe(403);

    const crossOrigin = await fetch(configUrl(), {
      method: 'POST',
      headers: {
        cookie,
        'content-type': 'application/json',
        origin: 'https://evil.example.test',
        'x-csrf-token': csrfToken,
      },
      body: JSON.stringify({ updates: { 'economy.dailyGrant': 2_000 } }),
    });
    expect(crossOrigin.status).toBe(403);
    expect(gameConfig.get('economy.dailyGrant')).toBe(1_000);
  });

  it('serves session-authenticated feedback while retaining the debug endpoint elsewhere', async () => {
    database.db.prepare(`
      INSERT INTO feedback (profile_id, alias, category, message, created_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(null, '테스터', 'idea', '관리자 피드백 테스트', NOW);

    const response = await fetch(`${baseUrl}/api/admin/feedback?limit=10`, {
      headers: { cookie },
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      count: 1,
      items: [{ alias: '테스터', message: '관리자 피드백 테스트' }],
    });
  });

  it('logs out and rejects the expired admin cookie', async () => {
    const response = await fetch(`${baseUrl}/api/admin/session`, {
      method: 'DELETE',
      headers: { cookie, origin: baseUrl, 'x-csrf-token': csrfToken },
    });
    expect(response.status).toBe(204);
    expect(response.headers.get('set-cookie')).toContain('Max-Age=0');
    expect((await fetch(configUrl(), { headers: { cookie } })).status).toBe(401);
  });
});
