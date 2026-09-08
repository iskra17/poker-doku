import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createHttpRequestHandler } from './http-handler';
import { openPokerDatabase, type PokerDatabase } from './persistence/database';
import { ProfileManager } from './profile-manager';
import { ProfileRepository } from './profile-repository';
import { EconomyService } from './economy-service';
import { EconomyRepository } from './economy-repository';
import { OpsEventRepository } from './ops-log';
import { TransientHttpRateLimiter } from './http-rate-limit';

describe('new-user QA account switching', () => {
  let db: PokerDatabase;
  let server: Server;
  let base: string;
  let csrf: string;
  let limiter: TransientHttpRateLimiter;
  const cookies = new Map<string, string>();
  const cookieHeader = () => [...cookies].map(([k, v]) => `${k}=${v}`).join('; ');
  async function request(path: string, method = 'GET', body?: unknown, headers = {}) {
    const response = await fetch(base + path, {
      method,
      headers: { cookie: cookieHeader(), origin: base, 'x-csrf-token': csrf,
        'content-type': 'application/json', ...headers },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    for (const raw of response.headers.getSetCookie()) {
      const [pair] = raw.split(';');
      const i = pair.indexOf('=');
      if (/Max-Age=0(?:;|$)/u.test(raw)) cookies.delete(pair.slice(0, i));
      else cookies.set(pair.slice(0, i), pair.slice(i + 1));
    }
    return response;
  }
  async function createProfile() {
    const response = await request('/api/profile/create', 'POST', { avatarId: 'sakura', adultConfirmed: true });
    expect(response.status).toBe(201);
    return (await response.json()).profile;
  }
  async function profileSession() {
    return (await request('/api/profile/session')).json();
  }
  beforeEach(async () => {
    cookies.clear(); csrf = '';
    db = openPokerDatabase(':memory:');
    limiter = new TransientHttpRateLimiter();
    server = createServer(createHttpRequestHandler((_req, res) => { res.writeHead(404); res.end(); }, {
      database: db, debugToken: 'local-qa-test-admin', production: false,
      profileManager: new ProfileManager(new ProfileRepository(db)),
      profileRateLimiter: limiter,
      economyService: new EconomyService(new EconomyRepository(db)),
      opsEvents: new OpsEventRepository(db),
    }));
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const login = await request('/api/admin/session', 'POST', { token: 'local-qa-test-admin' });
    expect(login.status).toBe(201);
    csrf = (await login.json()).csrfToken;
  });
  afterEach(async () => {
    await new Promise<void>(resolve => server.close(() => resolve()));
    db.close();
    limiter.close();
  });
  it('requires the existing admin session and CSRF before changing any cookies', async () => {
    for (const method of ['GET', 'POST', 'DELETE']) {
      const response = await request('/api/admin/qa', method, undefined, { cookie: '' });
      expect(response.status).toBe(401);
      expect(response.headers.getSetCookie()).toEqual([]);
    }
    const rejected = await request('/api/admin/qa', 'POST', undefined, { 'x-csrf-token': '' });
    expect(rejected.status).toBe(403);
    expect(rejected.headers.getSetCookie()).toEqual([]);
  });
  it('restarts onboarding with distinct real profiles and restores the original identity and wallet', async () => {
    const original = await createProfile();
    const originalCookie = cookies.get('poker_doku_profile')!;
    const adminCookie = cookies.get('poker_doku_admin');
    expect(await (await request('/api/admin/qa')).json()).toEqual({ active: false });
    const start = await request('/api/admin/qa', 'POST');
    expect(start.status).toBe(200);
    expect(await start.json()).toEqual({ active: true });
    const backup = start.headers.getSetCookie().find(c => c.startsWith('poker_doku_qa_original='))!;
    expect(backup).toContain('HttpOnly');
    expect(backup).toContain('SameSite=Strict');
    expect(backup).toContain('Path=/api/admin');
    expect(await profileSession()).toEqual({ state: 'anonymous' });
    const first = await createProfile();
    expect(first.id).not.toBe(original.id);
    const reset = await request('/api/admin/qa', 'POST');
    expect(reset.status).toBe(200);
    expect(cookies.get('poker_doku_qa_original')).toBe(originalCookie);
    expect(await profileSession()).toEqual({ state: 'anonymous' });
    const second = await createProfile();
    expect(new Set([original.id, first.id, second.id]).size).toBe(3);
    expect((await request('/api/admin/qa', 'DELETE')).status).toBe(200);
    expect((await profileSession()).profile).toEqual(original);
    expect(cookies.get('poker_doku_profile')).toBe(originalCookie);
    expect(cookies.get('poker_doku_admin')).toBe(adminCookie);
    expect(cookies.has('poker_doku_qa_original')).toBe(false);
    // Retried exit must not clear the restored profile.
    await request('/api/admin/qa', 'DELETE');
    expect((await profileSession()).profile.id).toBe(original.id);
  });
  it('returns to the anonymous state when testing began without a game account', async () => {
    expect((await request('/api/admin/qa', 'POST')).status).toBe(200);
    await createProfile();
    expect((await request('/api/admin/qa', 'DELETE')).status).toBe(200);
    expect(await profileSession()).toEqual({ state: 'anonymous' });
  });
  it('does not overwrite an invalid or ambiguous backup', async () => {
    await createProfile();
    for (const suffix of ['poker_doku_qa_original=bad', 'poker_doku_qa_original=-; poker_doku_qa_original=-']) {
      const response = await request('/api/admin/qa', 'POST', undefined, { cookie: `${cookieHeader()}; ${suffix}` });
      expect(response.status).toBe(409);
      expect(response.headers.getSetCookie()).toEqual([]);
    }
  });
});
