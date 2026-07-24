import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createHttpRequestHandler } from './http-handler';
import { eventLog } from './event-log';
import {
  OpsEventRepository,
  shouldPersistOpsEvent,
} from './ops-log';
import { openPokerDatabase, type PokerDatabase } from './persistence/database';

const NOW = 1_800_000_000_000;
const TOKEN = 'fund-admin-secret';

describe('admin promotion fund HTTP API', () => {
  let database: PokerDatabase;
  let baseUrl: string;
  let close: () => Promise<void>;
  let cookie: string;
  let csrfToken: string;

  beforeEach(async () => {
    database = openPokerDatabase(':memory:');
    const opsEvents = new OpsEventRepository(database);
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
      production: false,
      now: () => NOW,
    }));
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    close = () => new Promise(resolve => server.close(() => resolve()));

    const login = await fetch(`${baseUrl}/api/admin/session`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: baseUrl },
      body: JSON.stringify({ token: TOKEN }),
    });
    cookie = login.headers.get('set-cookie')!.split(';', 1)[0];
    csrfToken = ((await login.json()) as { csrfToken: string }).csrfToken;
  });

  afterEach(async () => {
    eventLog.setPersistentSink(null);
    await close();
    database.close();
  });

  function adjust(body: unknown, headers: Record<string, string> = {}) {
    return fetch(`${baseUrl}/api/admin/promotion-fund/adjust`, {
      method: 'POST',
      headers: {
        cookie,
        'content-type': 'application/json',
        origin: baseUrl,
        'x-csrf-token': csrfToken,
        ...headers,
      },
      body: JSON.stringify(body),
    });
  }

  it('requires an admin session for fund pages and adjustments', async () => {
    expect((await fetch(`${baseUrl}/api/admin/promotion-fund`)).status).toBe(401);
    expect((await fetch(`${baseUrl}/api/admin/promotion-fund/adjust`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: baseUrl },
      body: JSON.stringify({
        requestId: randomUUID(),
        delta: 1,
        reason: 'Valid reason',
      }),
    })).status).toBe(401);
  });

  it('returns balance, reserved total and cursor-paginated ledger', async () => {
    for (const [delta, reason] of [
      [100, 'First funding adjustment'],
      [200, 'Second funding adjustment'],
      [300, 'Third funding adjustment'],
    ] as const) {
      expect((await adjust({ requestId: randomUUID(), delta, reason })).status)
        .toBe(200);
    }

    const firstResponse = await fetch(
      `${baseUrl}/api/admin/promotion-fund?limit=2`,
      { headers: { cookie } },
    );
    expect(firstResponse.status).toBe(200);
    const first = await firstResponse.json() as {
      availableBalance: number;
      reservedTotal: number;
      ledger: Array<{ delta: number }>;
      nextCursor: string | null;
    };
    expect(first).toMatchObject({
      availableBalance: 600,
      reservedTotal: 0,
      ledger: [{ delta: 300 }, { delta: 200 }],
      nextCursor: expect.any(String),
    });
    const second = await (await fetch(
      `${baseUrl}/api/admin/promotion-fund?limit=2&before=${encodeURIComponent(first.nextCursor!)}`,
      { headers: { cookie } },
    )).json() as { ledger: Array<{ delta: number }>; nextCursor: null };
    expect(second.ledger).toEqual([expect.objectContaining({ delta: 100 })]);
    expect(second.nextCursor).toBeNull();
  });

  it('uses csrf, exact origin and session mutation rate limits', async () => {
    const body = {
      requestId: randomUUID(),
      delta: 1,
      reason: 'Valid adjustment reason',
    };
    expect((await adjust(body, { 'x-csrf-token': '' })).status).toBe(403);
    expect((await adjust(body, { origin: 'https://evil.example.test' })).status)
      .toBe(403);

    for (let index = 0; index < 30; index += 1) {
      const response = await adjust({
        requestId: randomUUID(),
        delta: 1,
        reason: `Rate adjustment ${index}`,
      });
      expect(response.status).toBe(200);
    }
    expect((await adjust({
      requestId: randomUUID(),
      delta: 1,
      reason: 'Rate adjustment overflow',
    })).status).toBe(429);
  });

  it('returns promotion-insufficient without changing the ledger', async () => {
    const response = await adjust({
      requestId: randomUUID(),
      delta: -1,
      reason: 'Attempt an unavailable debit',
    });
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: 'promotion-insufficient' });
    const page = await (await fetch(
      `${baseUrl}/api/admin/promotion-fund`,
      { headers: { cookie } },
    )).json() as { availableBalance: number; ledger: unknown[] };
    expect(page).toMatchObject({ availableBalance: 0, ledger: [] });
  });

  it('rejects malformed bodies, reasons, and cursor parameters', async () => {
    expect((await adjust({
      requestId: 'not-a-uuid',
      delta: 1,
      reason: 'Valid reason',
    })).status).toBe(400);
    expect((await adjust({
      requestId: randomUUID(),
      delta: 0,
      reason: 'Valid reason',
    })).status).toBe(400);
    expect((await adjust({
      requestId: randomUUID(),
      delta: 1,
      reason: 'bad',
    })).status).toBe(400);
    expect((await fetch(
      `${baseUrl}/api/admin/promotion-fund?limit=101`,
      { headers: { cookie } },
    )).status).toBe(400);
    expect((await fetch(
      `${baseUrl}/api/admin/promotion-fund?before=not-a-cursor`,
      { headers: { cookie } },
    )).status).toBe(400);
  });

  it('records approved audit data without admin transport secrets', async () => {
    const requestId = randomUUID();
    expect((await adjust({
      requestId,
      delta: 50,
      reason: 'Audited fund adjustment',
    })).status).toBe(200);
    const events = new OpsEventRepository(database).recent({
      type: 'promotion-fund-adjust',
    });
    expect(events).toHaveLength(1);
    expect(events[0].data).toMatchObject({
      requestId,
      delta: 50,
      balanceAfter: 50,
      actorKind: 'backoffice-admin',
    });
    const serialized = JSON.stringify(events[0]);
    expect(serialized).not.toContain(TOKEN);
    expect(serialized).not.toContain(cookie);
    expect(serialized).not.toContain(csrfToken);
  });
});
