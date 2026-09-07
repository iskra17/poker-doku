import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { AdminDeviceRepository } from './admin-device-repository';
import {
  ADMIN_SESSION_COOKIE,
  AdminSessionError,
  AdminSessionManager,
  isExactAdminOrigin,
  resolveAdminRequestOrigin,
} from './admin-session';
import { openPokerDatabase, type PokerDatabase } from './persistence/database';

const SOURCE_TOKEN = 'a-source-token-that-must-never-leak';
const NOW = Date.parse('2026-07-25T12:00:00+09:00');
const TWO_HOURS_MS = 2 * 60 * 60 * 1_000;
const NINETY_DAYS_MS = 90 * 24 * 60 * 60 * 1_000;

function cookieHeader(setCookie: string): string {
  return setCookie.split(';', 1)[0];
}

describe('AdminSessionManager', () => {
  it('issues a two-hour opaque HttpOnly Strict admin cookie', () => {
    const manager = new AdminSessionManager({
      sourceToken: SOURCE_TOKEN,
      production: false,
    });

    const result = manager.login(SOURCE_TOKEN, '198.51.100.1', NOW);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.expiresAt).toBe(NOW + TWO_HOURS_MS);
    expect(result.setCookie).toContain(`${ADMIN_SESSION_COOKIE}=`);
    expect(result.setCookie).toContain('HttpOnly');
    expect(result.setCookie).toContain('SameSite=Strict');
    expect(result.setCookie).toContain('Path=/api/admin');
    expect(result.setCookie).toContain('Max-Age=7200');
    expect(result.setCookie).not.toContain('Secure');
    expect(result.setCookie).not.toContain(SOURCE_TOKEN);
    expect(result.csrfToken).not.toBe(SOURCE_TOKEN);

    const principal = manager.authenticate(cookieHeader(result.setCookie), NOW);
    expect(principal).toMatchObject({
      id: result.principal.id,
      expiresAt: NOW + TWO_HOURS_MS,
    });
    expect(JSON.stringify(result)).not.toContain(SOURCE_TOKEN);
  });

  it('adds Secure in production and expires sessions after two hours', () => {
    const manager = new AdminSessionManager({
      sourceToken: SOURCE_TOKEN,
      production: true,
    });
    const result = manager.login(SOURCE_TOKEN, '198.51.100.2', NOW);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.setCookie).toContain('Secure');
    const cookie = cookieHeader(result.setCookie);
    expect(manager.authenticate(cookie, NOW + TWO_HOURS_MS - 1)).not.toBeNull();
    expect(manager.authenticate(cookie, NOW + TWO_HOURS_MS)).toBeNull();
  });

  it('uses fixed-length verification and never creates a session for a bad source token', () => {
    const manager = new AdminSessionManager({
      sourceToken: SOURCE_TOKEN,
      production: false,
    });

    expect(manager.login('x', '198.51.100.3', NOW)).toEqual({
      ok: false,
      reason: 'invalid-credentials',
    });
    expect(manager.login('b'.repeat(SOURCE_TOKEN.length), '198.51.100.4', NOW))
      .toEqual({ ok: false, reason: 'invalid-credentials' });
    expect(manager.stats()).toEqual({ sessions: 0, loginBuckets: 2 });
  });

  it('requires exact same-origin and csrf for every authenticated mutation', () => {
    const manager = new AdminSessionManager({
      sourceToken: SOURCE_TOKEN,
      production: false,
    });
    const result = manager.login(SOURCE_TOKEN, '198.51.100.5', NOW);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const cookie = cookieHeader(result.setCookie);
    const input = {
      cookieHeader: cookie,
      csrfHeader: result.csrfToken,
      origin: 'https://admin.example.test',
      requestOrigin: 'https://admin.example.test',
      now: NOW,
    };

    expect(manager.requireMutation(input).id).toBe(result.principal.id);
    expect(() => manager.requireMutation({ ...input, csrfHeader: 'wrong' }))
      .toThrowError(expect.objectContaining({ kind: 'csrf' }));
    expect(() => manager.requireMutation({
      ...input,
      origin: 'https://evil.example.test',
    })).toThrowError(expect.objectContaining({ kind: 'origin' }));
    expect(() => manager.requireMutation({
      ...input,
      origin: 'https://admin.example.test.evil.test',
    })).toThrowError(expect.objectContaining({ kind: 'origin' }));
    expect(() => manager.requireMutation({ ...input, origin: undefined }))
      .toThrowError(expect.objectContaining({ kind: 'origin' }));
  });

  it('compares scheme host and effective default or non-default port', () => {
    expect(isExactAdminOrigin(
      'https://admin.example.test:443',
      'https://admin.example.test',
    )).toBe(true);
    expect(isExactAdminOrigin(
      'http://admin.example.test:80',
      'http://admin.example.test',
    )).toBe(true);
    expect(isExactAdminOrigin(
      'http://admin.example.test',
      'https://admin.example.test',
    )).toBe(false);
    expect(isExactAdminOrigin(
      'https://admin.example.test',
      'https://admin.example.test:8443',
    )).toBe(false);
    expect(isExactAdminOrigin(
      'https://admin.example.test:8443',
      'https://admin.example.test:8443',
    )).toBe(true);
  });

  it('resolves the trusted effective request scheme in one place', () => {
    const request = (
      host: string,
      forwardedProto: string | undefined,
      encrypted: boolean,
    ) => ({
      headers: {
        host,
        ...(forwardedProto === undefined
          ? {}
          : { 'x-forwarded-proto': forwardedProto }),
      },
      socket: { encrypted },
    });

    expect(resolveAdminRequestOrigin(
      request('admin.example.test', 'http, https', false),
      true,
    )).toBe('https://admin.example.test');
    expect(resolveAdminRequestOrigin(
      request('admin.example.test:8443', undefined, true),
      true,
    )).toBe('https://admin.example.test:8443');
    expect(resolveAdminRequestOrigin(
      request('admin.example.test', undefined, false),
      true,
    )).toBe('https://admin.example.test');
    expect(resolveAdminRequestOrigin(
      request('admin.example.test', 'https', false),
      false,
    )).toBe('http://admin.example.test');
    expect(resolveAdminRequestOrigin(
      request('admin.example.test', 'http, ftp', false),
      true,
    )).toBeNull();
    expect(resolveAdminRequestOrigin(
      request('admin.example.test', 'https, ', false),
      true,
    )).toBeNull();
  });

  it('limits login by canonical client key to five attempts per ten minutes', () => {
    const manager = new AdminSessionManager({
      sourceToken: SOURCE_TOKEN,
      production: false,
    });
    for (let attempt = 0; attempt < 5; attempt += 1) {
      expect(manager.login('wrong', '203.0.113.7', NOW + attempt)).toEqual({
        ok: false,
        reason: 'invalid-credentials',
      });
    }
    expect(manager.login(SOURCE_TOKEN, '203.0.113.7', NOW + 5)).toEqual({
      ok: false,
      reason: 'rate-limited',
      retryAfterMs: 10 * 60 * 1_000 - 5,
    });
    expect(manager.login(SOURCE_TOKEN, '203.0.113.8', NOW + 5).ok).toBe(true);
    expect(manager.login(SOURCE_TOKEN, '203.0.113.7', NOW + 10 * 60 * 1_000).ok)
      .toBe(true);
  });

  it('limits mutations per session to thirty attempts per minute', () => {
    const manager = new AdminSessionManager({
      sourceToken: SOURCE_TOKEN,
      production: false,
    });
    const result = manager.login(SOURCE_TOKEN, '198.51.100.8', NOW);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const input = {
      cookieHeader: cookieHeader(result.setCookie),
      csrfHeader: result.csrfToken,
      origin: 'https://admin.example.test',
      requestOrigin: 'https://admin.example.test',
      now: NOW,
    };
    for (let attempt = 0; attempt < 30; attempt += 1) {
      expect(manager.requireMutation({ ...input, now: NOW + attempt }).id)
        .toBe(result.principal.id);
    }
    expect(() => manager.requireMutation({ ...input, now: NOW + 30 }))
      .toThrowError(expect.objectContaining({
        kind: 'rate-limited',
        retryAfterMs: 60_000 - 30,
      }));
    expect(manager.requireMutation({ ...input, now: NOW + 60_000 }).id)
      .toBe(result.principal.id);
  });

  it('does not let rejected origin or csrf attempts consume mutation quota', () => {
    const manager = new AdminSessionManager({
      sourceToken: SOURCE_TOKEN,
      production: false,
    });
    const result = manager.login(SOURCE_TOKEN, '198.51.100.12', NOW);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const valid = {
      cookieHeader: cookieHeader(result.setCookie),
      csrfHeader: result.csrfToken,
      origin: 'https://admin.example.test',
      requestOrigin: 'https://admin.example.test',
      now: NOW,
    };

    for (let attempt = 0; attempt < 40; attempt += 1) {
      expect(() => manager.requireMutation({
        ...valid,
        origin: 'https://evil.example.test',
        now: NOW + attempt,
      })).toThrowError(expect.objectContaining({ kind: 'origin' }));
      expect(() => manager.requireMutation({
        ...valid,
        csrfHeader: 'wrong',
        now: NOW + attempt,
      })).toThrowError(expect.objectContaining({ kind: 'csrf' }));
    }
    for (let attempt = 0; attempt < 30; attempt += 1) {
      expect(manager.requireMutation({ ...valid, now: NOW + attempt }).id)
        .toBe(result.principal.id);
    }
    expect(() => manager.requireMutation({ ...valid, now: NOW + 30 }))
      .toThrowError(expect.objectContaining({ kind: 'rate-limited' }));
  });

  it('logs out only the selected opaque session and emits an expired cookie', () => {
    const manager = new AdminSessionManager({
      sourceToken: SOURCE_TOKEN,
      production: false,
    });
    const first = manager.login(SOURCE_TOKEN, '198.51.100.9', NOW);
    const second = manager.login(SOURCE_TOKEN, '198.51.100.10', NOW);
    expect(first.ok && second.ok).toBe(true);
    if (!first.ok || !second.ok) return;

    manager.logout(cookieHeader(first.setCookie));

    expect(manager.authenticate(cookieHeader(first.setCookie), NOW)).toBeNull();
    expect(manager.authenticate(cookieHeader(second.setCookie), NOW)).not.toBeNull();
    expect(manager.clearCookie()).toContain('Max-Age=0');
  });

  it('keeps backoffice principals distinct from profile tournament operators', () => {
    const manager = new AdminSessionManager({
      sourceToken: SOURCE_TOKEN,
      production: false,
    });
    const result = manager.login(SOURCE_TOKEN, '198.51.100.11', NOW);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.principal).toEqual({
      kind: 'backoffice-admin',
      id: expect.stringMatching(/^admin_/),
      expiresAt: NOW + TWO_HOURS_MS,
    });
    expect(result.principal).not.toHaveProperty('profileId');
    expect(AdminSessionError).toBeDefined();
  });
});

describe('AdminSessionManager trusted devices', () => {
  const directories: string[] = [];
  const databases: PokerDatabase[] = [];

  afterEach(() => {
    for (const database of databases.splice(0)) {
      try {
        database.close();
      } catch {
        // 이미 닫힌 DB(장애 시나리오)는 무시한다.
      }
    }
    for (const directory of directories.splice(0)) {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  function openFileDatabase(): { path: string; database: PokerDatabase } {
    const directory = mkdtempSync(join(tmpdir(), 'admin-session-devices-'));
    directories.push(directory);
    const path = join(directory, 'poker.db');
    return { path, database: reopen(path) };
  }

  function reopen(path: string): PokerDatabase {
    const database = openPokerDatabase(path);
    databases.push(database);
    return database;
  }

  function manager(
    database: PokerDatabase,
    options: { sourceToken?: string | undefined; production?: boolean } = {},
  ): AdminSessionManager {
    return new AdminSessionManager({
      sourceToken: 'sourceToken' in options ? options.sourceToken : SOURCE_TOKEN,
      production: options.production ?? false,
      devices: new AdminDeviceRepository(database),
    });
  }

  let clientKeySequence = 0;

  function loginRemembered(
    instance: AdminSessionManager,
    at = NOW,
    options: { deviceName?: string; cookieHeader?: string } = {},
  ) {
    clientKeySequence += 1;
    const result = instance.login(SOURCE_TOKEN, `client-${clientKeySequence}`, at, {
      rememberDevice: true,
      ...options,
    });
    if (!result.ok) throw new Error(`login failed: ${result.reason}`);
    return result;
  }

  it('restores a remembered browser after a server restart while plain sessions die', () => {
    const { path, database } = openFileDatabase();
    const first = manager(database);
    const remembered = loginRemembered(first, NOW, { deviceName: '내 노트북' });
    const plain = first.login(SOURCE_TOKEN, '198.51.100.21', NOW);
    expect(plain.ok).toBe(true);
    if (!plain.ok) return;
    expect(remembered.remembered).toBe(true);
    expect(plain.remembered).toBe(false);
    expect(remembered.expiresAt).toBe(NOW + NINETY_DAYS_MS);
    expect(remembered.setCookie).toContain(`Max-Age=${NINETY_DAYS_MS / 1_000}`);
    expect(remembered.setCookie).toContain('HttpOnly');
    expect(remembered.setCookie).toContain('SameSite=Strict');
    expect(remembered.setCookie).toContain('Path=/api/admin');
    expect(remembered.setCookie).not.toContain(SOURCE_TOKEN);
    database.close();

    const restarted = manager(reopen(path));
    expect(restarted.authenticate(
      cookieHeader(remembered.setCookie),
      NOW + 3 * 3_600_000,
    )).not.toBeNull();
    expect(restarted.authenticate(
      cookieHeader(plain.setCookie),
      NOW + 3 * 3_600_000,
    )).toBeNull();
  });

  it('keeps the public principal id stable across restarts and hides raw credentials', () => {
    const { path, database } = openFileDatabase();
    const remembered = loginRemembered(manager(database));
    const rawCredential = cookieHeader(remembered.setCookie)
      .slice(ADMIN_SESSION_COOKIE.length + 1);
    const rows = database.db.prepare('SELECT * FROM admin_trusted_devices').all();
    expect(rows).toHaveLength(1);
    expect(JSON.stringify(rows)).not.toContain(rawCredential);
    expect(JSON.stringify(rows)).not.toContain(SOURCE_TOKEN);
    expect(rawCredential.length).toBeGreaterThanOrEqual(32);
    database.close();

    const restarted = manager(reopen(path));
    const session = restarted.getSession(
      cookieHeader(remembered.setCookie),
      NOW + 3_600_000,
    );
    expect(session.ok).toBe(true);
    if (!session.ok) return;
    expect(session.view.principal.id).toBe(remembered.principal.id);
    expect(session.view.csrfToken).toBe(remembered.csrfToken);
    expect(session.view.remembered).toBe(true);
  });

  it('expires exactly at ninety days and renews on a day eighty-nine visit', () => {
    const { database } = openFileDatabase();
    const instance = manager(database);
    const remembered = loginRemembered(instance);
    const cookie = cookieHeader(remembered.setCookie);

    expect(instance.authenticate(cookie, NOW + NINETY_DAYS_MS - 1)).not.toBeNull();

    const visitAt = NOW + 89 * 24 * 3_600_000;
    const renewed = instance.getSession(cookie, visitAt);
    expect(renewed.ok).toBe(true);
    if (!renewed.ok) return;
    expect(renewed.view.expiresAt).toBe(visitAt + NINETY_DAYS_MS);
    expect(renewed.view.csrfToken).toBe(remembered.csrfToken);
    expect(renewed.setCookie).toContain(cookie.split('=').slice(1).join('='));
    expect(renewed.setCookie).toContain(`Max-Age=${NINETY_DAYS_MS / 1_000}`);
    expect(instance.authenticate(cookie, visitAt + NINETY_DAYS_MS - 1))
      .not.toBeNull();
    expect(instance.authenticate(cookie, visitAt + NINETY_DAYS_MS)).toBeNull();

    // 만료 후 GET session은 행을 되살리지 않는다.
    expect(instance.getSession(cookie, visitAt + NINETY_DAYS_MS)).toEqual({
      ok: false,
      reason: 'unauthenticated',
    });
    expect(instance.listDevices(cookie, visitAt + NINETY_DAYS_MS)).toEqual({
      ok: false,
      reason: 'unauthenticated',
    });
  });

  it('applies a revoke from another server instance to the very next request', () => {
    const { path, database } = openFileDatabase();
    const first = manager(database);
    const remembered = loginRemembered(first);
    const cookie = cookieHeader(remembered.setCookie);
    expect(first.authenticate(cookie, NOW)).not.toBeNull();

    const listed = first.listDevices(cookie, NOW);
    expect(listed.ok).toBe(true);
    if (!listed.ok) return;
    expect(listed.devices).toEqual([{
      id: expect.any(String),
      name: '등록된 브라우저',
      createdAt: NOW,
      lastUsedAt: NOW,
      expiresAt: NOW + NINETY_DAYS_MS,
      current: true,
    }]);

    const second = manager(reopen(path));
    expect(second.revokeDevice(cookie, listed.devices[0].id, NOW)).toEqual({
      ok: true,
      current: true,
    });
    expect(first.authenticate(cookie, NOW)).toBeNull();
    expect(second.revokeDevice(cookie, listed.devices[0].id, NOW)).toEqual({
      ok: false,
      reason: 'unauthenticated',
    });
  });

  it('logs out the persistent credential and reports storage failures instead of pretending', () => {
    const { database } = openFileDatabase();
    const instance = manager(database);
    const remembered = loginRemembered(instance);
    const cookie = cookieHeader(remembered.setCookie);

    expect(instance.logout(cookie)).toEqual({ ok: true });
    expect(instance.authenticate(cookie, NOW)).toBeNull();

    const other = loginRemembered(instance, NOW + 1);
    database.close();
    expect(instance.logout(cookieHeader(other.setCookie))).toEqual({
      ok: false,
      reason: 'unavailable',
    });
  });

  it('invalidates persistent credentials when the source token rotates or disappears', () => {
    const { path, database } = openFileDatabase();
    const remembered = loginRemembered(manager(database));
    const cookie = cookieHeader(remembered.setCookie);
    database.close();

    const rotated = manager(reopen(path), { sourceToken: 'a-rotated-source' });
    expect(rotated.authenticate(cookie, NOW)).toBeNull();
    expect(rotated.listDevices(cookie, NOW)).toEqual({
      ok: false,
      reason: 'unauthenticated',
    });

    const unset = manager(reopen(path), { sourceToken: undefined });
    expect(unset.authenticate(cookie, NOW)).toBeNull();
    expect(unset.getSession(cookie, NOW)).toEqual({
      ok: false,
      reason: 'unauthenticated',
    });

    const restored = manager(reopen(path));
    expect(restored.authenticate(cookie, NOW)).not.toBeNull();
    // 회전된 토큰의 목록에는 이전 스코프 기기가 보이지 않는다.
    const rotatedLogin = rotated.login('a-rotated-source', '198.51.100.30', NOW, {
      rememberDevice: true,
    });
    expect(rotatedLogin.ok).toBe(true);
    if (!rotatedLogin.ok) return;
    const rotatedList = rotated.listDevices(
      cookieHeader(rotatedLogin.setCookie),
      NOW,
    );
    expect(rotatedList.ok && rotatedList.devices).toHaveLength(1);
  });

  it('caps registrations at twenty and keeps the presented credential on refusal', () => {
    const { database } = openFileDatabase();
    const instance = manager(database);
    const first = loginRemembered(instance);
    const cookie = cookieHeader(first.setCookie);
    for (let index = 1; index < 20; index += 1) {
      loginRemembered(instance, NOW + index);
    }

    const refused = instance.login(SOURCE_TOKEN, '198.51.100.40', NOW + 100, {
      rememberDevice: true,
    });
    expect(refused).toEqual({ ok: false, reason: 'device-limit' });
    expect(instance.authenticate(cookie, NOW + 100)).not.toBeNull();

    // 같은 브라우저의 교체 등록은 총량을 늘리지 않으므로 상한에서도 통과한다.
    const replaced = instance.login(SOURCE_TOKEN, '198.51.100.41', NOW + 101, {
      rememberDevice: true,
      cookieHeader: cookie,
    });
    expect(replaced.ok).toBe(true);
    if (!replaced.ok) return;
    expect(instance.authenticate(cookie, NOW + 101)).toBeNull();
    const listed = instance.listDevices(
      cookieHeader(replaced.setCookie),
      NOW + 101,
    );
    expect(listed.ok && listed.devices).toHaveLength(20);
  });

  it('replaces the credential of the same browser and revokes it on a plain re-login', () => {
    const { database } = openFileDatabase();
    const instance = manager(database);
    const first = loginRemembered(instance);
    const firstCookie = cookieHeader(first.setCookie);

    const second = loginRemembered(instance, NOW + 1_000, {
      cookieHeader: firstCookie,
      deviceName: '교체된 이름',
    });
    const secondCookie = cookieHeader(second.setCookie);
    expect(secondCookie).not.toBe(firstCookie);
    expect(instance.authenticate(firstCookie, NOW + 1_000)).toBeNull();
    expect(instance.authenticate(secondCookie, NOW + 1_000)).not.toBeNull();
    const listed = instance.listDevices(secondCookie, NOW + 1_000);
    expect(listed.ok && listed.devices).toHaveLength(1);
    expect(listed.ok && listed.devices[0].name).toBe('교체된 이름');

    const plain = instance.login(SOURCE_TOKEN, '198.51.100.42', NOW + 2_000, {
      rememberDevice: false,
      cookieHeader: secondCookie,
    });
    expect(plain.ok).toBe(true);
    if (!plain.ok) return;
    expect(plain.remembered).toBe(false);
    expect(plain.expiresAt).toBe(NOW + 2_000 + TWO_HOURS_MS);
    expect(instance.authenticate(secondCookie, NOW + 2_000)).toBeNull();
    expect(instance.authenticate(cookieHeader(plain.setCookie), NOW + 2_000))
      .not.toBeNull();
  });

  it('keeps the existing credential when the login itself fails', () => {
    const { database } = openFileDatabase();
    const instance = manager(database);
    const remembered = loginRemembered(instance);
    const cookie = cookieHeader(remembered.setCookie);

    expect(instance.login('wrong-token', '198.51.100.43', NOW + 10, {
      rememberDevice: true,
      cookieHeader: cookie,
    })).toEqual({ ok: false, reason: 'invalid-credentials' });
    expect(instance.authenticate(cookie, NOW + 10)).not.toBeNull();
  });

  it('validates the device name and falls back to the korean default', () => {
    const { database } = openFileDatabase();
    const instance = manager(database);

    for (const deviceName of ['a\u0000b', 'line\nbreak', 'x'.repeat(81)]) {
      expect(instance.login(SOURCE_TOKEN, '198.51.100.44', NOW, {
        rememberDevice: true,
        deviceName,
      })).toEqual({ ok: false, reason: 'invalid-device-name' });
    }

    const trimmed = loginRemembered(instance, NOW + 1, {
      deviceName: '   사무실 데스크톱   ',
    });
    const listed = instance.listDevices(
      cookieHeader(trimmed.setCookie),
      NOW + 1,
    );
    expect(listed.ok && listed.devices[0].name).toBe('사무실 데스크톱');

    const blank = loginRemembered(instance, NOW + 2, { deviceName: '   ' });
    const blankList = instance.listDevices(cookieHeader(blank.setCookie), NOW + 2);
    expect(blankList.ok && blankList.devices[0].name).toBe('등록된 브라우저');
  });

  it('rejects malformed or duplicated cookies and unknown credentials', () => {
    const { database } = openFileDatabase();
    const instance = manager(database);
    const remembered = loginRemembered(instance);
    const cookie = cookieHeader(remembered.setCookie);

    const listed = instance.listDevices(cookie, NOW);
    expect(listed.ok).toBe(true);
    if (!listed.ok) return;
    const publicId = listed.devices[0].id;

    expect(instance.authenticate(`${cookie}; ${cookie}`, NOW)).toBeNull();
    // 공개 기기 id는 인증 수단이 아니다.
    expect(instance.authenticate(`${ADMIN_SESSION_COOKIE}=${publicId}`, NOW))
      .toBeNull();
    expect(instance.authenticate(
      `${ADMIN_SESSION_COOKIE}=pdv1.${publicId}`,
      NOW,
    )).toBeNull();
    // 영속 자격은 메모리 세션 Map에 들어가지 않는다.
    expect(instance.stats().sessions).toBe(0);
    expect(instance.authenticate(`${ADMIN_SESSION_COOKIE}=pdv1.nope`, NOW))
      .toBeNull();
    expect(instance.authenticate(`${ADMIN_SESSION_COOKIE}=`, NOW)).toBeNull();
    expect(instance.authenticate(undefined, NOW)).toBeNull();
    expect(instance.revokeDevice(cookie, 'no-such-device', NOW)).toEqual({
      ok: false,
      reason: 'not-found',
    });
    expect(instance.revokeDevice(cookie, 'x'.repeat(200), NOW)).toEqual({
      ok: false,
      reason: 'not-found',
    });
  });

  it('still requires exact origin, csrf, and a mutation budget for remembered browsers', () => {
    const { database } = openFileDatabase();
    const instance = manager(database);
    const remembered = loginRemembered(instance);
    const input = {
      cookieHeader: cookieHeader(remembered.setCookie),
      csrfHeader: remembered.csrfToken,
      origin: 'https://admin.example.test',
      requestOrigin: 'https://admin.example.test',
      now: NOW,
    };

    expect(instance.requireMutation(input).id).toBe(remembered.principal.id);
    expect(() => instance.requireMutation({ ...input, csrfHeader: 'wrong' }))
      .toThrowError(expect.objectContaining({ kind: 'csrf' }));
    expect(() => instance.requireMutation({
      ...input,
      origin: 'https://evil.example.test',
    })).toThrowError(expect.objectContaining({ kind: 'origin' }));

    for (let attempt = 1; attempt < 30; attempt += 1) {
      expect(instance.requireMutation({ ...input, now: NOW + attempt }).id)
        .toBe(remembered.principal.id);
    }
    expect(() => instance.requireMutation({ ...input, now: NOW + 30 }))
      .toThrowError(expect.objectContaining({ kind: 'rate-limited' }));
    expect(instance.requireMutation({ ...input, now: NOW + 60_000 }).id)
      .toBe(remembered.principal.id);
  });

  it('fails closed with unavailable when the device store is broken', () => {
    const { database } = openFileDatabase();
    const instance = manager(database);
    const remembered = loginRemembered(instance);
    const cookie = cookieHeader(remembered.setCookie);
    database.close();

    expect(instance.login(SOURCE_TOKEN, '198.51.100.45', NOW, {
      rememberDevice: true,
    })).toEqual({ ok: false, reason: 'unavailable' });
    expect(instance.getSession(cookie, NOW)).toEqual({
      ok: false,
      reason: 'unavailable',
    });
    expect(instance.listDevices(cookie, NOW)).toEqual({
      ok: false,
      reason: 'unavailable',
    });
    expect(instance.revokeDevice(cookie, 'device', NOW)).toEqual({
      ok: false,
      reason: 'unavailable',
    });
    expect(instance.authenticate(cookie, NOW)).toBeNull();
    expect(() => instance.requireMutation({
      cookieHeader: cookie,
      csrfHeader: remembered.csrfToken,
      origin: 'https://admin.example.test',
      requestOrigin: 'https://admin.example.test',
      now: NOW,
    })).toThrowError(expect.objectContaining({ kind: 'unavailable' }));
  });

  it('refuses to remember a device without a configured store or source token', () => {
    const withoutStore = new AdminSessionManager({
      sourceToken: SOURCE_TOKEN,
      production: false,
    });
    expect(withoutStore.login(SOURCE_TOKEN, '198.51.100.46', NOW, {
      rememberDevice: true,
    })).toEqual({ ok: false, reason: 'unavailable' });
    expect(withoutStore.login(SOURCE_TOKEN, '198.51.100.47', NOW).ok).toBe(true);
  });

  it('adds Secure to the persistent cookie in production only', () => {
    const { database } = openFileDatabase();
    const secure = manager(database, { production: true });
    const result = secure.login(SOURCE_TOKEN, '198.51.100.48', NOW, {
      rememberDevice: true,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.setCookie).toContain('Secure');
    expect(secure.clearCookie()).toContain('Secure');
  });
});
