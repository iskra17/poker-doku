import { mkdtempSync, rmSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createHttpRequestHandler } from './http-handler';
import { OpsEventRepository } from './ops-log';
import { openPokerDatabase, type PokerDatabase } from './persistence/database';

const NOW = Date.parse('2026-09-08T12:00:00+09:00');
const NINETY_DAYS_MS = 90 * 24 * 60 * 60 * 1_000;
const TOKEN = 'admin-secret-source-token';

interface Instance {
  readonly baseUrl: string;
  readonly close: () => Promise<void>;
}

describe('admin trusted device HTTP API', () => {
  let directory: string;
  let databasePath: string;
  let database: PokerDatabase;
  let instance: Instance;
  let currentTime = NOW;
  const servers: Server[] = [];
  const databases: PokerDatabase[] = [];

  function open(): PokerDatabase {
    const opened = openPokerDatabase(databasePath);
    databases.push(opened);
    return opened;
  }

  async function start(target: PokerDatabase): Promise<Instance> {
    const server = createServer(createHttpRequestHandler((_req, res) => {
      res.writeHead(404);
      res.end();
    }, {
      database: target,
      debugToken: TOKEN,
      opsEvents: new OpsEventRepository(target),
      production: false,
      now: () => currentTime,
    }));
    servers.push(server);
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    return {
      baseUrl: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
      close: () => new Promise<void>(resolve => server.close(() => resolve())),
    };
  }

  beforeEach(async () => {
    currentTime = NOW;
    directory = mkdtempSync(join(tmpdir(), 'admin-devices-http-'));
    databasePath = join(directory, 'poker.db');
    database = open();
    instance = await start(database);
  });

  afterEach(async () => {
    for (const server of servers.splice(0)) {
      await new Promise<void>(resolve => server.close(() => resolve()));
    }
    for (const opened of databases.splice(0)) {
      try {
        opened.close();
      } catch {
        // 장애 시나리오에서 이미 닫힌 DB는 무시한다.
      }
    }
    rmSync(directory, { recursive: true, force: true });
  });

  async function login(
    body: Record<string, unknown>,
    options: { baseUrl?: string; clientHop?: string; cookie?: string } = {},
  ) {
    const baseUrl = options.baseUrl ?? instance.baseUrl;
    return fetch(`${baseUrl}/api/admin/session`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        origin: baseUrl,
        ...(options.clientHop ? { 'x-forwarded-for': options.clientHop } : {}),
        ...(options.cookie ? { cookie: options.cookie } : {}),
      },
      body: JSON.stringify({ token: TOKEN, ...body }),
    });
  }

  function cookieOf(response: Response): string {
    return response.headers.get('set-cookie')!.split(';', 1)[0];
  }

  async function remember(
    options: { deviceName?: string; clientHop?: string; cookie?: string } = {},
  ) {
    const response = await login(
      {
        rememberDevice: true,
        ...(options.deviceName === undefined
          ? {}
          : { deviceName: options.deviceName }),
      },
      {
        ...(options.clientHop === undefined ? {} : { clientHop: options.clientHop }),
        ...(options.cookie === undefined ? {} : { cookie: options.cookie }),
      },
    );
    expect(response.status).toBe(201);
    return { cookie: cookieOf(response), body: await response.json(), response };
  }

  it('issues a ninety day opt-in cookie without leaking it into the JSON body', async () => {
    const { cookie, body, response } = await remember({ deviceName: '내 노트북' });

    expect(body).toMatchObject({
      principal: { kind: 'backoffice-admin', id: expect.stringMatching(/^admin_/) },
      csrfToken: expect.any(String),
      expiresAt: NOW + NINETY_DAYS_MS,
      remembered: true,
    });
    expect(body).not.toHaveProperty('setCookie');
    const setCookie = response.headers.get('set-cookie')!;
    expect(setCookie).toContain(`Max-Age=${NINETY_DAYS_MS / 1_000}`);
    expect(setCookie).toContain('HttpOnly');
    expect(setCookie).toContain('SameSite=Strict');
    expect(setCookie).toContain('Path=/api/admin');
    expect(JSON.stringify(body)).not.toContain(TOKEN);
    expect(JSON.stringify(body)).not.toContain(cookie.split('=').slice(1).join('='));
  });

  it('keeps the plain two hour contract when the box stays unchecked', async () => {
    const response = await login({});
    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body.remembered).toBe(false);
    expect(body.expiresAt).toBe(NOW + 2 * 60 * 60 * 1_000);
    expect(response.headers.get('set-cookie')).toContain('Max-Age=7200');

    const session = await fetch(`${instance.baseUrl}/api/admin/session`, {
      headers: { cookie: cookieOf(response) },
    });
    expect(session.status).toBe(200);
    expect(await session.json()).toMatchObject({ remembered: false });
    expect(session.headers.get('set-cookie')).toBeNull();
  });

  it('restores the session on a fresh server process and renews the expiry', async () => {
    const { cookie } = await remember();
    await instance.close();
    database.close();

    const restarted = await start(open());
    currentTime = NOW + 89 * 24 * 3_600_000;
    const session = await fetch(`${restarted.baseUrl}/api/admin/session`, {
      headers: { cookie },
    });
    expect(session.status).toBe(200);
    const body = await session.json();
    expect(body).toMatchObject({
      remembered: true,
      expiresAt: currentTime + NINETY_DAYS_MS,
    });
    expect(session.headers.get('set-cookie')).toContain(
      `Max-Age=${NINETY_DAYS_MS / 1_000}`,
    );
    expect(JSON.stringify(body)).not.toContain(TOKEN);

    currentTime += NINETY_DAYS_MS - 1;
    expect((await fetch(`${restarted.baseUrl}/api/admin/overview`, {
      headers: { cookie },
    })).status).toBe(200);
    currentTime += 1;
    expect((await fetch(`${restarted.baseUrl}/api/admin/overview`, {
      headers: { cookie },
    })).status).toBe(401);
  });

  it('lists registered devices with the current flag and hides secrets', async () => {
    const first = await remember({ deviceName: '데스크톱' });
    const second = await remember({
      deviceName: '노트북',
      clientHop: '203.0.113.31',
    });

    const listed = await fetch(`${instance.baseUrl}/api/admin/devices`, {
      headers: { cookie: second.cookie },
    });
    expect(listed.status).toBe(200);
    const payload = await listed.json();
    expect(payload.devices).toHaveLength(2);
    expect(payload.devices).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: '데스크톱', current: false }),
      expect.objectContaining({
        name: '노트북',
        current: true,
        createdAt: NOW,
        lastUsedAt: NOW,
        expiresAt: NOW + NINETY_DAYS_MS,
      }),
    ]));
    const serialized = JSON.stringify(payload);
    expect(serialized).not.toContain(TOKEN);
    expect(serialized).not.toContain(first.cookie.split('=').slice(1).join('='));
    expect(serialized).not.toContain(second.body.csrfToken);
  });

  it('revokes another device immediately and the current device with a cookie reset', async () => {
    const first = await remember({ deviceName: '데스크톱' });
    const second = await remember({
      deviceName: '노트북',
      clientHop: '203.0.113.32',
    });
    const listed = await (await fetch(`${instance.baseUrl}/api/admin/devices`, {
      headers: { cookie: second.cookie },
    })).json();
    const other = listed.devices.find(
      (device: { current: boolean }) => !device.current,
    );

    const revoked = await fetch(
      `${instance.baseUrl}/api/admin/devices?id=${encodeURIComponent(other.id)}`,
      {
        method: 'DELETE',
        headers: {
          cookie: second.cookie,
          origin: instance.baseUrl,
          'x-csrf-token': second.body.csrfToken,
        },
      },
    );
    expect(revoked.status).toBe(204);
    expect(revoked.headers.get('set-cookie')).toBeNull();
    expect((await fetch(`${instance.baseUrl}/api/admin/overview`, {
      headers: { cookie: first.cookie },
    })).status).toBe(401);

    const current = listed.devices.find(
      (device: { current: boolean }) => device.current,
    );
    const self = await fetch(
      `${instance.baseUrl}/api/admin/devices?id=${encodeURIComponent(current.id)}`,
      {
        method: 'DELETE',
        headers: {
          cookie: second.cookie,
          origin: instance.baseUrl,
          'x-csrf-token': second.body.csrfToken,
        },
      },
    );
    expect(self.status).toBe(204);
    expect(self.headers.get('set-cookie')).toContain('Max-Age=0');
    expect((await fetch(`${instance.baseUrl}/api/admin/devices`, {
      headers: { cookie: second.cookie },
    })).status).toBe(401);
  });

  it('protects the device routes with authentication, origin, and csrf', async () => {
    const { cookie, body } = await remember();
    const id = (await (await fetch(`${instance.baseUrl}/api/admin/devices`, {
      headers: { cookie },
    })).json()).devices[0].id;
    const target = `${instance.baseUrl}/api/admin/devices?id=${encodeURIComponent(id)}`;

    expect((await fetch(`${instance.baseUrl}/api/admin/devices`)).status).toBe(401);
    expect((await fetch(target, {
      method: 'DELETE',
      headers: { origin: instance.baseUrl, 'x-csrf-token': body.csrfToken },
    })).status).toBe(401);
    expect((await fetch(target, {
      method: 'DELETE',
      headers: { cookie, origin: instance.baseUrl },
    })).status).toBe(403);
    expect((await fetch(target, {
      method: 'DELETE',
      headers: {
        cookie,
        origin: 'https://evil.example.test',
        'x-csrf-token': body.csrfToken,
      },
    })).status).toBe(403);
    expect((await fetch(`${instance.baseUrl}/api/admin/devices`, {
      method: 'DELETE',
      headers: { cookie, origin: instance.baseUrl, 'x-csrf-token': body.csrfToken },
    })).status).toBe(400);
    expect((await fetch(`${instance.baseUrl}/api/admin/devices?id=ghost`, {
      method: 'DELETE',
      headers: { cookie, origin: instance.baseUrl, 'x-csrf-token': body.csrfToken },
    })).status).toBe(404);
    expect((await fetch(`${instance.baseUrl}/api/admin/devices`, {
      method: 'POST',
      headers: { cookie, origin: instance.baseUrl, 'x-csrf-token': body.csrfToken },
    })).status).toBe(405);

    // 실패한 해제 시도들이 현재 자격을 건드리지 않았다.
    expect((await fetch(`${instance.baseUrl}/api/admin/devices`, {
      headers: { cookie },
    })).status).toBe(200);
  });

  it('rejects malformed remember input before touching the store', async () => {
    for (const body of [
      { rememberDevice: 'yes' },
      { rememberDevice: true, deviceName: 42 },
      { rememberDevice: true, deviceName: 'x'.repeat(81) },
      { rememberDevice: true, deviceName: 'bad\u0000name' },
    ]) {
      const response = await login(body, { clientHop: '203.0.113.33' });
      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({ error: 'invalid-body' });
      expect(response.headers.get('set-cookie')).toBeNull();
    }
    expect(database.db
      .prepare('SELECT COUNT(*) AS n FROM admin_trusted_devices')
      .get()).toEqual({ n: 0 });
  });

  it('answers 409 once twenty devices are registered for the source token', async () => {
    for (let index = 0; index < 20; index += 1) {
      await remember({ clientHop: `203.0.113.${100 + index}` });
    }
    const refused = await login(
      { rememberDevice: true },
      { clientHop: '203.0.113.200' },
    );
    expect(refused.status).toBe(409);
    expect(await refused.json()).toEqual({ error: 'device-limit' });
    expect(refused.headers.get('set-cookie')).toBeNull();
  });

  it('logs out the persistent credential and clears the cookie', async () => {
    const { cookie, body } = await remember();
    const response = await fetch(`${instance.baseUrl}/api/admin/session`, {
      method: 'DELETE',
      headers: {
        cookie,
        origin: instance.baseUrl,
        'x-csrf-token': body.csrfToken,
      },
    });
    expect(response.status).toBe(204);
    expect(response.headers.get('set-cookie')).toContain('Max-Age=0');
    expect((await fetch(`${instance.baseUrl}/api/admin/session`, {
      headers: { cookie },
    })).status).toBe(401);
    expect(database.db
      .prepare('SELECT COUNT(*) AS n FROM admin_trusted_devices')
      .get()).toEqual({ n: 0 });
  });

  it('reports 503 instead of a false success when the store is unavailable', async () => {
    const { cookie, body } = await remember();
    database.close();

    expect((await login({ rememberDevice: true }, { clientHop: '203.0.113.34' }))
      .status).toBe(503);
    expect((await fetch(`${instance.baseUrl}/api/admin/session`, {
      headers: { cookie },
    })).status).toBe(503);
    expect((await fetch(`${instance.baseUrl}/api/admin/devices`, {
      headers: { cookie },
    })).status).toBe(503);
    const logout = await fetch(`${instance.baseUrl}/api/admin/session`, {
      method: 'DELETE',
      headers: {
        cookie,
        origin: instance.baseUrl,
        'x-csrf-token': body.csrfToken,
      },
    });
    expect(logout.status).toBe(503);
    expect(logout.headers.get('set-cookie')).toBeNull();
  });
});
