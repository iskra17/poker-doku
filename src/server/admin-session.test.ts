import { describe, expect, it } from 'vitest';
import {
  ADMIN_SESSION_COOKIE,
  AdminSessionError,
  AdminSessionManager,
} from './admin-session';

const SOURCE_TOKEN = 'a-source-token-that-must-never-leak';
const NOW = Date.parse('2026-07-25T12:00:00+09:00');
const TWO_HOURS_MS = 2 * 60 * 60 * 1_000;

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
      host: 'admin.example.test',
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
      host: 'admin.example.test',
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
