import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it, vi, type Mock } from 'vitest';
import type { PublicProfile } from '@/lib/profile/types';
import {
  EconomyDomainError,
  EconomyService,
} from './economy-service';
import { EconomyRepository } from './economy-repository';
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
  createProfileHttpHandler,
  readProfileCredentialCookie,
  type ProfileHttpManager,
} from './profile-http';
import { ProfileRepository } from './profile-repository';

const PROFILE_COOKIE = PROFILE_COOKIE_NAME;

interface RunningServer {
  baseUrl: string;
  database: PokerDatabase;
  manager: ProfileManager;
  economyRepository: EconomyRepository;
  economyService: Pick<EconomyService, 'claimDaily' | 'claimRescue' | 'getStatus'>;
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
  onProfileRevoked?: (profileId: string) => void | Promise<void>;
  economyClock?: () => number;
  economyService?: Pick<EconomyService, 'claimDaily' | 'claimRescue' | 'getStatus'>;
} = {}): Promise<RunningServer & { nextHandler: Mock<NextRequestHandler> }> {
  const database = openPokerDatabase(':memory:');
  const manager = new ProfileManager(new ProfileRepository(database));
  const economyRepository = new EconomyRepository(database);
  const economyService = options.economyService
    ?? new EconomyService(economyRepository, options.economyClock);
  const limiter = options.limiter ?? new TransientHttpRateLimiter();
  const nextHandler = options.nextHandler ?? vi.fn<NextRequestHandler>((_req, res) => {
    res.writeHead(200, { 'content-type': 'text/plain' });
    res.end('next');
  });
  const server = createServer(createHttpRequestHandler(nextHandler, {
    database,
    profileManager: options.manager ?? manager,
    economyService,
    profileRateLimiter: limiter,
    profileConcurrencyGate: options.gate,
    onProfileRevoked: options.onProfileRevoked,
    production: options.production ?? false,
  }));
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  const result = {
    baseUrl: `http://127.0.0.1:${port}`,
    database,
    manager,
    economyRepository,
    economyService,
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
  it('rejects empty, exact duplicate, and malformed duplicate profile cookies', () => {
    expect(readProfileCredentialCookie(undefined)).toBeNull();
    expect(readProfileCredentialCookie(`${PROFILE_COOKIE}=`)).toBeNull();
    expect(readProfileCredentialCookie(
      `${PROFILE_COOKIE}=first; ${PROFILE_COOKIE}=second`,
    )).toBeNull();
    expect(readProfileCredentialCookie(
      `${PROFILE_COOKIE}=first; ${PROFILE_COOKIE} =second`,
    )).toBeNull();
    expect(readProfileCredentialCookie(
      `theme=dark; ${PROFILE_COOKIE}=credential; locale=ko`,
    )).toBe('credential');
  });

  it('revokes realtime ownership after full recovery and delete only without changing committed responses', async () => {
    const onProfileRevoked = vi.fn(() => {
      throw new Error('realtime unavailable');
    });
    const server = await startServer({ onProfileRevoked });
    const recovering = await createProfile(server);
    const recoveringProfile = recovering.body.profile as PublicProfile;

    const rotatedOnly = await fetch(`${server.baseUrl}/api/profile/recovery/rotate`, {
      method: 'POST',
      headers: { cookie: recovering.cookie },
    });
    expect(rotatedOnly.status).toBe(200);
    const rotatedBody = await rotatedOnly.json() as { recoveryWords: string };
    expect(onProfileRevoked).not.toHaveBeenCalled();

    const recovered = await fetch(`${server.baseUrl}/api/profile/recover`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ recoveryWords: rotatedBody.recoveryWords }),
    });
    expect(recovered.status).toBe(200);
    expect(onProfileRevoked).toHaveBeenCalledTimes(1);
    expect(onProfileRevoked).toHaveBeenLastCalledWith(recoveringProfile.id);

    const deleting = await createProfile(server);
    const deletingProfile = deleting.body.profile as PublicProfile;
    const deleted = await fetch(`${server.baseUrl}/api/profile`, {
      method: 'DELETE',
      headers: {
        'content-type': 'application/json',
        cookie: deleting.cookie,
      },
      body: JSON.stringify({ confirmation: '삭제' }),
    });
    expect(deleted.status).toBe(200);
    expect(await deleted.json()).toEqual({ ok: true });
    expect(onProfileRevoked).toHaveBeenCalledTimes(2);
    expect(onProfileRevoked).toHaveBeenLastCalledWith(deletingProfile.id);
  });

  it('returns an anonymous no-store session without a cookie', async () => {
    const server = await startServer();

    const response = await fetch(`${server.baseUrl}/api/profile/session`);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ state: 'anonymous' });
    expectNoStore(response);
    expect(server.nextHandler).not.toHaveBeenCalled();
  });

  it('returns authoritative read-only economy status with a ready session', async () => {
    const now = Date.parse('2026-07-15T15:00:00.000Z');
    const server = await startServer({ economyClock: () => now });
    const created = await createProfile(server);
    const before = server.database.db.prepare(`
      SELECT (SELECT balance FROM wallets) AS balance,
             (SELECT COUNT(*) FROM daily_claims) AS daily_count,
             (SELECT COUNT(*) FROM rescue_claims) AS rescue_count,
             (SELECT COUNT(*) FROM chip_ledger) AS ledger_count
    `).get();

    const response = await fetch(`${server.baseUrl}/api/profile/session`, {
      headers: { cookie: created.cookie },
    });
    const body = await response.json() as Record<string, unknown>;

    expect(response.status).toBe(200);
    expect(body).toEqual({
      state: 'ready',
      profile: created.body.profile,
      economy: {
        hasActiveSeat: false,
        daily: {
          claimed: false,
          grantAmount: 1_000,
          availableAt: Date.parse('2026-07-15T15:00:00.000Z'),
        },
        rescue: {
          eligible: false,
          grantAmount: 0,
          remainingToday: 3,
          availableAt: null,
          reason: 'balance-threshold',
        },
      },
    });
    expect(server.database.db.prepare(`
      SELECT (SELECT balance FROM wallets) AS balance,
             (SELECT COUNT(*) FROM daily_claims) AS daily_count,
             (SELECT COUNT(*) FROM rescue_claims) AS rescue_count,
             (SELECT COUNT(*) FROM chip_ledger) AS ledger_count
    `).get()).toEqual(before);
    expectNoStore(response);
  });

  it.each(['cash', 'sng'] as const)('exposes a zero-chip active %s seat on session and claim responses', async mode => {
    const now = Date.parse('2026-07-15T15:00:00.000Z');
    const server = await startServer({ economyClock: () => now });
    const created = await createProfile(server);
    const profile = created.body.profile as PublicProfile;
    server.database.db.prepare(`
      INSERT INTO seat_escrows (
        id, profile_id, room_id, mode, amount,
        checkpoint_amount, checkpoint_hand, status, updated_at
      ) VALUES (?, ?, ?, ?, 0, 0, 0, 'active', ?)
    `).run(`zero-${mode}`, profile.id, `room-${mode}`, mode, now);

    const session = await fetch(`${server.baseUrl}/api/profile/session`, {
      headers: { cookie: created.cookie },
    });
    const daily = await fetch(`${server.baseUrl}/api/economy/daily`, {
      method: 'POST',
      headers: { cookie: created.cookie },
    });

    expect(await session.json()).toMatchObject({
      state: 'ready',
      profile: { wallet: { activeEscrow: 0 } },
      economy: { hasActiveSeat: true },
    });
    expect(await daily.json()).toMatchObject({
      profile: { wallet: { activeEscrow: 0 } },
      economy: { hasActiveSeat: true },
    });
  });

  it('treats malformed target cookies as invalid while ignoring unrelated cookies', async () => {
    const server = await startServer();
    const created = await createProfile(server);

    const malformed = await Promise.all([
      fetch(`${server.baseUrl}/api/profile/session`, {
        headers: { cookie: `${PROFILE_COOKIE} =bogus` },
      }),
      fetch(`${server.baseUrl}/api/profile/session`, {
        headers: { cookie: PROFILE_COOKIE },
      }),
    ]);
    const unrelated = await fetch(`${server.baseUrl}/api/profile/session`, {
      headers: { cookie: 'theme=dark; locale=ko' },
    });
    const validWithOthers = await fetch(`${server.baseUrl}/api/profile/session`, {
      headers: { cookie: `theme=dark; ${created.cookie}; locale=ko` },
    });

    for (const response of malformed) {
      expect(response.status).toBe(401);
      expect(await response.json()).toMatchObject({
        error: { code: 'PROFILE_AUTH_INVALID' },
      });
      expect(response.headers.get('set-cookie')).toContain('Max-Age=0');
    }
    expect(unrelated.status).toBe(200);
    expect(await unrelated.json()).toEqual({ state: 'anonymous' });
    expect(validWithOthers.status).toBe(200);
    expect(await validWithOthers.json()).toMatchObject({
      state: 'ready',
      profile: created.body.profile,
    });
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
    const economyService = {
      claimDaily: vi.fn(),
      claimRescue: vi.fn(),
      getStatus: vi.fn(() => ({
        profile,
        economy: {
          hasActiveSeat: false,
          daily: { claimed: false, grantAmount: 1_000, availableAt: 1 },
          rescue: {
            eligible: false,
            grantAmount: 0,
            remainingToday: 3,
            availableAt: null,
            reason: 'balance-threshold' as const,
          },
        },
      })),
    };
    const server = await startServer({
      manager,
      economyService,
      // 대기열 0 — 즉시 거절 계약을 검증 (운영 기본값은 대기열로 버스트 흡수)
      gate: new TransientHttpConcurrencyGate(1, 0),
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

  it('claims the daily grant over authenticated HTTP with an exact safe response', async () => {
    const now = Date.parse('2026-07-15T14:59:59.999Z');
    const server = await startServer({ economyClock: () => now });
    const created = await createProfile(server);

    const granted = await fetch(`${server.baseUrl}/api/economy/daily`, {
      method: 'POST',
      headers: { cookie: created.cookie },
    });
    const grantedBody = await granted.json() as Record<string, unknown>;
    const repeated = await fetch(`${server.baseUrl}/api/economy/daily`, {
      method: 'POST',
      headers: {
        cookie: created.cookie,
        'content-type': 'application/json',
      },
      body: '{}',
    });
    const repeatedBody = await repeated.json() as {
      error: Record<string, unknown>;
    };

    expect(granted.status).toBe(200);
    expect(grantedBody).toEqual({
      profile: {
        ...(created.body.profile as PublicProfile),
        wallet: { balance: 11_000, activeEscrow: 0 },
      },
      economy: {
        hasActiveSeat: false,
        daily: {
          claimed: true,
          grantAmount: 1_000,
          availableAt: Date.parse('2026-07-15T15:00:00.000Z'),
        },
        rescue: {
          eligible: false,
          grantAmount: 0,
          remainingToday: 3,
          availableAt: null,
          reason: 'balance-threshold',
        },
      },
      transaction: { reason: 'DAILY_GRANT', delta: 1_000 },
    });
    expect(Object.keys(grantedBody).sort()).toEqual(['economy', 'profile', 'transaction']);
    const safeText = JSON.stringify(grantedBody);
    expect(safeText).not.toContain(cookieCredential(created.response));
    expect(safeText).not.toContain('127.0.0.1');
    expect(granted.headers.get('set-cookie')).toBeNull();
    expectNoStore(granted);

    expect(repeated.status).toBe(409);
    expect(Object.keys(repeatedBody)).toEqual(['error']);
    expect(Object.keys(repeatedBody.error).sort())
      .toEqual(['availableAt', 'code', 'message']);
    expect(repeatedBody.error).toMatchObject({
      code: 'DAILY_ALREADY_CLAIMED',
      availableAt: Date.parse('2026-07-15T15:00:00.000Z'),
    });
    expect(Number.isSafeInteger(repeatedBody.error.availableAt)).toBe(true);
    expectNoStore(repeated);
  });

  it('claims rescue and exposes only a safe cooldown timestamp on conflict', async () => {
    let now = Date.parse('2026-07-15T15:00:00.000Z');
    const server = await startServer({ economyClock: () => now });
    const created = await createProfile(server);
    const profile = created.body.profile as PublicProfile;
    server.economyRepository.applyWalletDelta(
      profile.id, -9_201, 'TEST_DRAIN', 'http-rescue-drain-1', undefined, now - 1,
    );

    const granted = await fetch(`${server.baseUrl}/api/economy/rescue`, {
      method: 'POST',
      headers: {
        cookie: created.cookie,
        'content-type': 'application/json',
      },
      body: '{}',
    });
    const grantedBody = await granted.json() as Record<string, unknown>;
    server.economyRepository.applyWalletDelta(
      profile.id, -1_201, 'TEST_DRAIN', 'http-rescue-drain-2', undefined, now + 1,
    );
    now += 60 * 60 * 1_000;
    const cooldown = await fetch(`${server.baseUrl}/api/economy/rescue`, {
      method: 'POST',
      headers: { cookie: created.cookie },
    });
    const cooldownBody = await cooldown.json() as {
      error: Record<string, unknown>;
    };

    expect(granted.status).toBe(200);
    expect(grantedBody).toEqual({
      profile: {
        ...profile,
        wallet: { balance: 2_000, activeEscrow: 0 },
      },
      economy: {
        hasActiveSeat: false,
        daily: {
          claimed: false,
          grantAmount: 1_000,
          availableAt: Date.parse('2026-07-15T15:00:00.000Z'),
        },
        rescue: {
          eligible: false,
          grantAmount: 0,
          remainingToday: 2,
          availableAt: null,
          reason: 'balance-threshold',
        },
      },
      transaction: { reason: 'RESCUE_GRANT', delta: 1_201 },
    });
    expectNoStore(granted);
    expect(cooldown.status).toBe(409);
    expect(Object.keys(cooldownBody.error).sort())
      .toEqual(['availableAt', 'code', 'message']);
    expect(cooldownBody.error).toMatchObject({
      code: 'RESCUE_COOLDOWN',
      availableAt: Date.parse('2026-07-15T19:00:00.000Z'),
    });
    expect(JSON.stringify(cooldownBody)).not.toContain('127.0.0.1');
    expectNoStore(cooldown);
  });

  it('maps rescue eligibility and active escrow failures to safe 409 responses', async () => {
    const now = Date.parse('2026-07-15T15:00:00.000Z');
    const server = await startServer({ economyClock: () => now });
    const ineligible = await createProfile(server);
    const ineligibleResponse = await fetch(`${server.baseUrl}/api/economy/rescue`, {
      method: 'POST',
      headers: { cookie: ineligible.cookie },
    });
    const active = await createProfile(server);
    const activeProfile = active.body.profile as PublicProfile;
    server.economyRepository.applyWalletDelta(
      activeProfile.id, -9_201, 'TEST_DRAIN', 'http-active-drain', undefined, now - 1,
    );
    server.database.db.prepare(`
      INSERT INTO seat_escrows (
        id, profile_id, room_id, mode, amount,
        checkpoint_amount, checkpoint_hand, status, updated_at
      ) VALUES (?, ?, 'room-http-economy', 'cash', 0, 0, 0, 'active', ?)
    `).run('escrow-http-economy', activeProfile.id, now);
    const activeResponse = await fetch(`${server.baseUrl}/api/economy/rescue`, {
      method: 'POST',
      headers: { cookie: active.cookie },
    });

    expect(ineligibleResponse.status).toBe(409);
    expect(await ineligibleResponse.json()).toMatchObject({
      error: { code: 'RESCUE_NOT_ELIGIBLE' },
    });
    expect(activeResponse.status).toBe(409);
    expect(await activeResponse.json()).toMatchObject({
      error: { code: 'RESCUE_ACTIVE_ESCROW' },
    });
  });

  it('requires authentication for both economy operations', async () => {
    const server = await startServer();

    for (const operation of ['daily', 'rescue']) {
      const response = await fetch(`${server.baseUrl}/api/economy/${operation}`, {
        method: 'POST',
      });
      expect(response.status).toBe(401);
      expect(await response.json()).toMatchObject({
        error: { code: 'PROFILE_AUTH_INVALID' },
      });
      expect(response.headers.get('set-cookie')).toContain('Max-Age=0');
      expectNoStore(response);
    }
  });

  it('applies the operation limiter before the shared authentication KDF', async () => {
    const authenticateCredential = vi.fn(async () => null);
    const manager: ProfileHttpManager = {
      create: vi.fn(),
      authenticateCredential,
      recover: vi.fn(),
      rotateRecovery: vi.fn(),
      deleteProfile: vi.fn(),
    };
    const economyService = {
      claimDaily: vi.fn(),
      claimRescue: vi.fn(),
      getStatus: vi.fn(),
    } as unknown as Pick<EconomyService, 'claimDaily' | 'claimRescue' | 'getStatus'>;
    const limiter = new TransientHttpRateLimiter({
      profileCreate: { limit: 20, windowMs: 60_000 },
      profileRecover: { limit: 5, windowMs: 60_000 },
      profileAuth: { limit: 10, windowMs: 60_000 },
      daily: { limit: 1, windowMs: 60_000 },
      rescue: { limit: 30, windowMs: 60_000 },
    });
    const server = await startServer({ manager, economyService, limiter });

    const first = await fetch(`${server.baseUrl}/api/economy/daily`, {
      method: 'POST',
      headers: { cookie: `${PROFILE_COOKIE}=invalid` },
    });
    const limited = await fetch(`${server.baseUrl}/api/economy/daily`, {
      method: 'POST',
      headers: { cookie: `${PROFILE_COOKIE}=invalid` },
    });

    expect(first.status).toBe(401);
    expect(limited.status).toBe(429);
    expect(authenticateCredential).toHaveBeenCalledOnce();
    expect(economyService.claimDaily).not.toHaveBeenCalled();
    expect(JSON.stringify(await limited.json())).not.toContain('127.0.0.1');
  });

  it('drains a rate-limited economy request body before returning', async () => {
    const resume = vi.fn();
    const request = {
      method: 'POST',
      headers: {},
      socket: { remoteAddress: '127.0.0.1' },
      on: vi.fn(),
      resume,
    } as unknown as IncomingMessage;
    const response = {
      writableEnded: false,
      writeHead: vi.fn(),
      end: vi.fn(),
    } as unknown as ServerResponse;
    const manager: ProfileHttpManager = {
      create: vi.fn(),
      authenticateCredential: vi.fn(),
      recover: vi.fn(),
      rotateRecovery: vi.fn(),
      deleteProfile: vi.fn(),
    };
    const economyService = {
      claimDaily: vi.fn(),
      claimRescue: vi.fn(),
      getStatus: vi.fn(),
    } as unknown as Pick<EconomyService, 'claimDaily' | 'claimRescue' | 'getStatus'>;
    const rateLimiter = {
      allow: vi.fn(() => false),
    } as unknown as TransientHttpRateLimiter;
    const handler = createProfileHttpHandler({
      manager,
      economyService,
      rateLimiter,
      production: false,
    });

    expect(await handler(request, response, '/api/economy/daily')).toBe(true);
    expect(resume).toHaveBeenCalledOnce();
    expect(manager.authenticateCredential).not.toHaveBeenCalled();
    expect(economyService.claimDaily).not.toHaveBeenCalled();
  });

  it('accepts only an empty object and never accepts client-controlled time', async () => {
    const server = await startServer();
    const created = await createProfile(server);
    const requests = await Promise.all([
      fetch(`${server.baseUrl}/api/economy/daily`, {
        method: 'POST',
        headers: {
          cookie: created.cookie,
          'content-type': 'application/json',
        },
        body: JSON.stringify({ at: 0 }),
      }),
      fetch(`${server.baseUrl}/api/economy/rescue`, {
        method: 'POST',
        headers: {
          cookie: created.cookie,
          'content-type': 'application/json',
        },
        body: '{',
      }),
      fetch(`${server.baseUrl}/api/economy/rescue`, {
        method: 'POST',
        headers: {
          cookie: created.cookie,
          'content-type': 'application/json',
        },
        body: JSON.stringify({ payload: 'x'.repeat(8 * 1_024) }),
      }),
    ]);

    expect(requests.map(response => response.status)).toEqual([400, 400, 413]);
    for (const response of requests) expectNoStore(response);
    expect((server.database.db.prepare(`
      SELECT balance FROM wallets WHERE profile_id = ?
    `).get((created.body.profile as PublicProfile).id) as { balance: number }).balance)
      .toBe(10_000);
  });

  it('clears authentication safely when a profile disappears before the grant', async () => {
    const profile: PublicProfile = {
      id: 'deleted-profile',
      alias: 'deleted-alias',
      avatarId: 'sakura',
      wallet: { balance: 799, activeEscrow: 0 },
    };
    const manager: ProfileHttpManager = {
      create: vi.fn(),
      authenticateCredential: vi.fn(async () => profile),
      recover: vi.fn(),
      rotateRecovery: vi.fn(),
      deleteProfile: vi.fn(),
    };
    const economyService = {
      claimDaily: vi.fn(() => {
        throw new EconomyDomainError('PROFILE_NOT_FOUND');
      }),
      claimRescue: vi.fn(() => {
        throw new EconomyDomainError('PROFILE_NOT_FOUND');
      }),
      getStatus: vi.fn(() => {
        throw new EconomyDomainError('PROFILE_NOT_FOUND');
      }),
    };
    const server = await startServer({ manager, economyService });

    const response = await fetch(`${server.baseUrl}/api/economy/daily`, {
      method: 'POST',
      headers: { cookie: `${PROFILE_COOKIE}=${'a'.repeat(43)}` },
    });

    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({
      error: { code: 'PROFILE_AUTH_INVALID' },
    });
    expect(response.headers.get('set-cookie')).toContain('Max-Age=0');
    expectNoStore(response);
  });

  it('maps an invalid server economy clock to a safe 500 without mutation', async () => {
    const server = await startServer({ economyClock: () => -1 });
    const created = await createProfile(server);
    const profile = created.body.profile as PublicProfile;

    const response = await fetch(`${server.baseUrl}/api/economy/daily`, {
      method: 'POST',
      headers: { cookie: created.cookie },
    });
    const body = await response.json() as Record<string, unknown>;
    const wallet = server.database.db.prepare(`
      SELECT balance FROM wallets WHERE profile_id = ?
    `).get(profile.id);
    const grants = server.database.db.prepare(`
      SELECT COUNT(*) AS count FROM daily_claims WHERE profile_id = ?
    `).get(profile.id);
    const grantLedger = server.database.db.prepare(`
      SELECT COUNT(*) AS count FROM chip_ledger
      WHERE profile_id = ? AND reason = 'DAILY_GRANT'
    `).get(profile.id);

    expect(response.status).toBe(500);
    expect(body).toEqual({
      error: {
        code: 'INTERNAL_ERROR',
        message: '요청을 처리하지 못했습니다.',
      },
    });
    expect(JSON.stringify(body)).not.toContain('SQLite');
    expect(JSON.stringify(body)).not.toContain('127.0.0.1');
    expect(JSON.stringify(body)).not.toContain(cookieCredential(created.response));
    expect(wallet).toEqual({ balance: 10_000 });
    expect(grants).toEqual({ count: 0 });
    expect(grantLedger).toEqual({ count: 0 });
    expectNoStore(response);
  });
});
