import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it, vi, type Mock } from 'vitest';
import type { PublicProfile } from '@/lib/profile/types';
import {
  createHttpRequestHandler,
  type NextRequestHandler,
} from './http-handler';
import {
  TransientHttpConcurrencyGate,
  TransientHttpRateLimiter,
} from './http-rate-limit';
import { openPokerDatabase, type PokerDatabase } from './persistence/database';
import {
  ProfileDomainError,
  ProfileManager,
} from './profile-manager';
import {
  PROFILE_COOKIE_NAME,
  type ProfileHttpManager,
} from './profile-http';
import { ProfileRepository } from './profile-repository';

const PROFILE_COOKIE = PROFILE_COOKIE_NAME;

interface RunningServer {
  baseUrl: string;
  database: PokerDatabase;
  manager: ProfileManager;
  stop: () => Promise<void>;
}

const running: RunningServer[] = [];

afterEach(async () => {
  await Promise.all(running.splice(0).map(server => server.stop()));
});

async function startServer(options: {
  production?: boolean;
  manager?: ProfileHttpManager;
  limiter?: TransientHttpRateLimiter;
  gate?: TransientHttpConcurrencyGate;
  nextHandler?: Mock<NextRequestHandler>;
} = {}): Promise<RunningServer & { nextHandler: Mock<NextRequestHandler> }> {
  const database = openPokerDatabase(':memory:');
  const manager = new ProfileManager(new ProfileRepository(database));
  const limiter = options.limiter ?? new TransientHttpRateLimiter();
  const nextHandler = options.nextHandler ?? vi.fn<NextRequestHandler>((_req, res) => {
    res.writeHead(200, { 'content-type': 'text/plain' });
    res.end('next');
  });
  const server = createServer(createHttpRequestHandler(nextHandler, {
    database,
    profileManager: options.manager ?? manager,
    profileRateLimiter: limiter,
    profileConcurrencyGate: options.gate,
    production: options.production ?? false,
  }));
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  const result = {
    baseUrl: `http://127.0.0.1:${port}`,
    database,
    manager,
    nextHandler,
    stop: async () => {
      await new Promise<void>(resolve => server.close(() => resolve()));
      limiter.close();
      database.close();
    },
  };
  running.push(result);
  return result;
}

function cookiePair(response: Response): string {
  const setCookie = response.headers.get('set-cookie');
  expect(setCookie).toBeTruthy();
  return setCookie!.split(';', 1)[0];
}

function cookieCredential(response: Response): string {
  return cookiePair(response).slice(`${PROFILE_COOKIE}=`.length);
}

async function createProfile(
  server: RunningServer,
): Promise<{ response: Response; body: Record<string, unknown>; cookie: string }> {
  const response = await fetch(`${server.baseUrl}/api/profile/create`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ avatarId: 'sakura', adultConfirmed: true }),
  });
  const body = await response.json() as Record<string, unknown>;
  return { response, body, cookie: cookiePair(response) };
}

function expectNoStore(response: Response): void {
  expect(response.headers.get('cache-control')).toBe('no-store');
  expect(response.headers.get('content-type')).toBe('application/json; charset=utf-8');
}

describe('profile HTTP lifecycle', () => {
  it('returns an anonymous no-store session without a cookie', async () => {
    const server = await startServer();

    const response = await fetch(`${server.baseUrl}/api/profile/session`);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ state: 'anonymous' });
    expectNoStore(response);
    expect(server.nextHandler).not.toHaveBeenCalled();
  });

  it('creates a profile and returns each secret through only its allowed channel', async () => {
    const server = await startServer();

    const { response, body } = await createProfile(server);
    const responseText = JSON.stringify(body);
    const credential = cookieCredential(response);
    const stored = server.database.db.prepare(`
      SELECT credential_hash, recovery_hash FROM profiles
    `).get() as { credential_hash: string; recovery_hash: string };

    expect(response.status).toBe(201);
    expect(Object.keys(body).sort()).toEqual(['profile', 'recoveryWords']);
    expect(typeof body.recoveryWords).toBe('string');
    expect(responseText.split(body.recoveryWords as string)).toHaveLength(2);
    expect(credential).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(responseText).not.toContain(credential);
    expect(responseText).not.toContain(stored.credential_hash);
    expect(responseText).not.toContain(stored.recovery_hash);
    expect(responseText).not.toContain('127.0.0.1');
    expect(response.headers.get('set-cookie')).toContain('Path=/');
    expect(response.headers.get('set-cookie')).toContain('HttpOnly');
    expect(response.headers.get('set-cookie')).toContain('SameSite=Lax');
    expect(response.headers.get('set-cookie')).toContain('Max-Age=31536000');
    expect(response.headers.get('set-cookie')).not.toContain('Secure');
    expectNoStore(response);
  });

  it('adds Secure to issued and cleared cookies only in production', async () => {
    const development = await startServer();
    const production = await startServer({ production: true });
    const developmentCreated = await createProfile(development);
    const productionCreated = await createProfile(production);

    const developmentDelete = await fetch(`${development.baseUrl}/api/profile`, {
      method: 'DELETE',
      headers: {
        cookie: developmentCreated.cookie,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ confirmation: '삭제' }),
    });
    const productionDelete = await fetch(`${production.baseUrl}/api/profile`, {
      method: 'DELETE',
      headers: {
        cookie: productionCreated.cookie,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ confirmation: '삭제' }),
    });

    expect(developmentCreated.response.headers.get('set-cookie')).not.toContain('Secure');
    expect(developmentDelete.headers.get('set-cookie')).not.toContain('Secure');
    expect(productionCreated.response.headers.get('set-cookie')).toContain('Secure');
    expect(productionDelete.headers.get('set-cookie')).toContain('Secure');
    expect(productionDelete.headers.get('set-cookie')).toContain('Max-Age=0');
  });

  it('authenticates a valid cookie and clears an invalid or revoked cookie', async () => {
    const server = await startServer();
    const created = await createProfile(server);

    const valid = await fetch(`${server.baseUrl}/api/profile/session`, {
      headers: { cookie: created.cookie },
    });
    const invalid = await fetch(`${server.baseUrl}/api/profile/session`, {
      headers: { cookie: `${PROFILE_COOKIE}=invalid` },
    });
    const empty = await fetch(`${server.baseUrl}/api/profile/session`, {
      headers: { cookie: `${PROFILE_COOKIE}=` },
    });
    await fetch(`${server.baseUrl}/api/profile`, {
      method: 'DELETE',
      headers: { cookie: created.cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ confirmation: '삭제' }),
    });
    const revoked = await fetch(`${server.baseUrl}/api/profile/session`, {
      headers: { cookie: created.cookie },
    });

    expect(valid.status).toBe(200);
    expect(await valid.json()).toMatchObject({ state: 'ready', profile: created.body.profile });
    for (const response of [invalid, empty, revoked]) {
      expect(response.status).toBe(401);
      expect(await response.json()).toMatchObject({
        error: { code: 'PROFILE_AUTH_INVALID' },
      });
      expect(response.headers.get('set-cookie')).toContain('Max-Age=0');
      expectNoStore(response);
    }
  });

  it('rejects malformed, oversized, and inexact request bodies', async () => {
    const server = await startServer();
    const malformed = await fetch(`${server.baseUrl}/api/profile/create`, {
      method: 'POST',
      body: '{',
    });
    const oversized = await fetch(`${server.baseUrl}/api/profile/create`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ payload: 'x'.repeat(8 * 1_024) }),
    });
    const inexact = await fetch(`${server.baseUrl}/api/profile/create`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        avatarId: 'sakura',
        adultConfirmed: true,
        credential: 'must-not-be-accepted',
      }),
    });

    expect(malformed.status).toBe(400);
    expect(oversized.status).toBe(413);
    expect(inexact.status).toBe(400);
    for (const response of [malformed, oversized, inexact]) expectNoStore(response);
  });

  it('recovers a profile by rotating both secrets exactly once', async () => {
    const server = await startServer();
    const created = await createProfile(server);
    const oldCredential = cookieCredential(created.response);

    const recovered = await fetch(`${server.baseUrl}/api/profile/recover`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ recoveryWords: created.body.recoveryWords }),
    });
    const recoveredText = await recovered.text();
    const recoveredBody = JSON.parse(recoveredText) as Record<string, unknown>;
    const newCookie = cookiePair(recovered);
    const newCredential = cookieCredential(recovered);
    const oldSession = await fetch(`${server.baseUrl}/api/profile/session`, {
      headers: { cookie: created.cookie },
    });
    const newSession = await fetch(`${server.baseUrl}/api/profile/session`, {
      headers: { cookie: newCookie },
    });
    const replay = await fetch(`${server.baseUrl}/api/profile/recover`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ recoveryWords: created.body.recoveryWords }),
    });

    expect(recovered.status).toBe(200);
    expect(Object.keys(recoveredBody).sort()).toEqual(['profile', 'recoveryWords']);
    expect(recoveredBody.recoveryWords).not.toBe(created.body.recoveryWords);
    expect(recoveredText.split(recoveredBody.recoveryWords as string)).toHaveLength(2);
    expect(newCredential).not.toBe(oldCredential);
    expect(recoveredText).not.toContain(newCredential);
    expect(oldSession.status).toBe(401);
    expect(newSession.status).toBe(200);
    expect(replay.status).toBe(401);
    expectNoStore(recovered);
  });

  it('rotates recovery words for an authenticated profile', async () => {
    const server = await startServer();
    const created = await createProfile(server);

    const response = await fetch(`${server.baseUrl}/api/profile/recovery/rotate`, {
      method: 'POST',
      headers: { cookie: created.cookie },
    });
    const body = await response.json() as Record<string, unknown>;

    expect(response.status).toBe(200);
    expect(Object.keys(body)).toEqual(['recoveryWords']);
    expect(body.recoveryWords).not.toBe(created.body.recoveryWords);
    expect(JSON.stringify(body)).not.toContain(cookieCredential(created.response));
    expectNoStore(response);
  });

  it('maps secret rotation conflicts to 409', async () => {
    const profile: PublicProfile = {
      id: 'p_conflict',
      alias: '충돌테스트#0001',
      avatarId: 'sakura',
      wallet: { balance: 10_000, activeEscrow: 0 },
    };
    const manager: ProfileHttpManager = {
      create: vi.fn(),
      authenticateCredential: async () => profile,
      recover: vi.fn(),
      rotateRecovery: async () => {
        throw new ProfileDomainError('PROFILE_SECRET_CONFLICT');
      },
      deleteProfile: vi.fn(),
    };
    const server = await startServer({ manager });

    const response = await fetch(`${server.baseUrl}/api/profile/recovery/rotate`, {
      method: 'POST',
      headers: { cookie: `${PROFILE_COOKIE}=${'a'.repeat(43)}` },
    });

    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({
      error: { code: 'PROFILE_SECRET_CONFLICT' },
    });
    expectNoStore(response);
  });

  it('requires exact delete confirmation, blocks active escrow, and clears on success', async () => {
    const server = await startServer();
    const created = await createProfile(server);
    const profile = created.body.profile as PublicProfile;
    const wrong = await fetch(`${server.baseUrl}/api/profile`, {
      method: 'DELETE',
      headers: { cookie: created.cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ confirmation: '삭제', extra: true }),
    });
    server.database.db.prepare(`
      INSERT INTO seat_escrows (
        id, profile_id, room_id, mode, amount,
        checkpoint_amount, checkpoint_hand, status, updated_at
      ) VALUES (?, ?, ?, 'cash', 100, 100, 0, 'active', ?)
    `).run('escrow-http-test', profile.id, 'room-http-test', Date.now());
    const blocked = await fetch(`${server.baseUrl}/api/profile`, {
      method: 'DELETE',
      headers: { cookie: created.cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ confirmation: '삭제' }),
    });
    server.database.db.prepare(`
      UPDATE seat_escrows SET status = 'settled' WHERE id = ?
    `).run('escrow-http-test');
    const deleted = await fetch(`${server.baseUrl}/api/profile`, {
      method: 'DELETE',
      headers: { cookie: created.cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ confirmation: '삭제' }),
    });

    expect(wrong.status).toBe(400);
    expect(blocked.status).toBe(409);
    expect(await blocked.json()).toMatchObject({
      error: { code: 'PROFILE_HAS_ACTIVE_ESCROW' },
    });
    expect(deleted.status).toBe(200);
    expect(await deleted.json()).toEqual({ ok: true });
    expect(deleted.headers.get('set-cookie')).toContain(`${PROFILE_COOKIE}=`);
    expect(deleted.headers.get('set-cookie')).toContain('Max-Age=0');
    expectNoStore(deleted);
  });

  it('returns JSON no-store errors and Allow for method mismatches', async () => {
    const server = await startServer();

    const response = await fetch(`${server.baseUrl}/api/profile/create`);

    expect(response.status).toBe(405);
    expect(response.headers.get('allow')).toBe('POST');
    expect(await response.json()).toMatchObject({
      error: { code: 'METHOD_NOT_ALLOWED' },
    });
    expectNoStore(response);
  });

  it('delegates unknown paths to Next exactly once', async () => {
    const server = await startServer();

    const response = await fetch(`${server.baseUrl}/not-a-profile-route`);

    expect(response.status).toBe(200);
    expect(await response.text()).toBe('next');
    expect(server.nextHandler).toHaveBeenCalledOnce();
  });

  it('applies the shared auth limit before credential authentication', async () => {
    const authenticateCredential = vi.fn(async () => null);
    const manager: ProfileHttpManager = {
      create: vi.fn(),
      authenticateCredential,
      recover: vi.fn(),
      rotateRecovery: vi.fn(),
      deleteProfile: vi.fn(),
    };
    const limiter = new TransientHttpRateLimiter({
      profileCreate: { limit: 20, windowMs: 60_000 },
      profileRecover: { limit: 5, windowMs: 60_000 },
      profileAuth: { limit: 1, windowMs: 60_000 },
    });
    const server = await startServer({ manager, limiter });

    const first = await fetch(`${server.baseUrl}/api/profile/session`, {
      headers: { cookie: `${PROFILE_COOKIE}=invalid` },
    });
    const limited = await fetch(`${server.baseUrl}/api/profile/session`, {
      headers: { cookie: `${PROFILE_COOKIE}=invalid` },
    });

    expect(first.status).toBe(401);
    expect(limited.status).toBe(429);
    expect(authenticateCredential).toHaveBeenCalledOnce();
    expect(JSON.stringify(await limited.json())).not.toContain('127.0.0.1');
  });

  it('rejects excess authenticated KDF requests and releases capacity', async () => {
    let release!: () => void;
    const profile: PublicProfile = {
      id: 'p_concurrency',
      alias: '테스트#0001',
      avatarId: 'sakura',
      wallet: { balance: 10_000, activeEscrow: 0 },
    };
    const authenticateCredential = vi.fn(() => new Promise<PublicProfile>(resolve => {
      release = () => resolve(profile);
    }));
    const manager = {
      create: vi.fn(),
      authenticateCredential,
      recover: vi.fn(),
      rotateRecovery: vi.fn(),
      deleteProfile: vi.fn(),
    } as unknown as ProfileHttpManager;
    const server = await startServer({
      manager,
      gate: new TransientHttpConcurrencyGate(1),
    });
    const firstPromise = fetch(`${server.baseUrl}/api/profile/session`, {
      headers: { cookie: `${PROFILE_COOKIE}=${'a'.repeat(43)}` },
    });
    for (let attempt = 0; attempt < 100 && authenticateCredential.mock.calls.length === 0; attempt += 1) {
      await new Promise(resolve => setTimeout(resolve, 1));
    }
    expect(authenticateCredential).toHaveBeenCalledOnce();

    const limited = await fetch(`${server.baseUrl}/api/profile/session`, {
      headers: { cookie: `${PROFILE_COOKIE}=${'b'.repeat(43)}` },
    });
    expect(limited.status).toBe(429);

    release();
    const first = await firstPromise;
    expect(first.status).toBe(200);
    authenticateCredential.mockResolvedValueOnce(profile);
    const afterRelease = await fetch(`${server.baseUrl}/api/profile/session`, {
      headers: { cookie: `${PROFILE_COOKIE}=${'c'.repeat(43)}` },
    });
    expect(afterRelease.status).toBe(200);
  });
});
