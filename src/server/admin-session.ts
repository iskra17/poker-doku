import {
  createHash,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto';

export const ADMIN_SESSION_COOKIE = 'poker_doku_admin';

const SESSION_TTL_MS = 2 * 60 * 60 * 1_000;
const LOGIN_WINDOW_MS = 10 * 60 * 1_000;
const LOGIN_LIMIT = 5;
const MUTATION_WINDOW_MS = 60 * 1_000;
const MUTATION_LIMIT = 30;

export interface AdminPrincipal {
  readonly kind: 'backoffice-admin';
  readonly id: string;
  readonly expiresAt: number;
}

export type AdminLoginResult =
  | {
    readonly ok: true;
    readonly principal: AdminPrincipal;
    readonly csrfToken: string;
    readonly expiresAt: number;
    readonly setCookie: string;
  }
  | {
    readonly ok: false;
    readonly reason: 'invalid-credentials' | 'rate-limited' | 'unavailable';
    readonly retryAfterMs?: number;
  };

export interface AdminSessionView {
  readonly principal: AdminPrincipal;
  readonly csrfToken: string;
  readonly expiresAt: number;
}

export type AdminSessionErrorKind =
  | 'unauthenticated'
  | 'origin'
  | 'csrf'
  | 'rate-limited';

export class AdminSessionError extends Error {
  readonly kind: AdminSessionErrorKind;
  readonly retryAfterMs?: number;

  constructor(kind: AdminSessionErrorKind, retryAfterMs?: number) {
    super(`ADMIN_SESSION_${kind.toUpperCase().replace('-', '_')}`);
    this.name = 'AdminSessionError';
    this.kind = kind;
    this.retryAfterMs = retryAfterMs;
  }
}

interface AdminSessionRecord {
  readonly token: string;
  readonly csrfToken: string;
  readonly principal: AdminPrincipal;
  readonly expiresAt: number;
  mutationAttempts: number[];
}

export interface AdminSessionManagerOptions {
  sourceToken?: string;
  production: boolean;
  randomSecret?: () => string;
}

export interface AdminOriginRequest {
  readonly headers: {
    readonly host?: string | string[];
    readonly 'x-forwarded-proto'?: string | string[];
  };
  readonly socket?: {
    readonly encrypted?: boolean;
    readonly remoteAddress?: string;
  };
}

/**
 * Backoffice authentication is intentionally separate from player profiles and
 * their tournament-operator capability. The source credential is accepted only
 * by login; requests after that point carry an opaque, process-local session.
 */
export class AdminSessionManager {
  readonly #sourceTokenDigest: Buffer | null;
  readonly #production: boolean;
  readonly #randomSecret: () => string;
  readonly #sessions = new Map<string, AdminSessionRecord>();
  readonly #loginAttempts = new Map<string, number[]>();

  constructor(options: AdminSessionManagerOptions) {
    this.#sourceTokenDigest = options.sourceToken
      ? digest(options.sourceToken)
      : null;
    this.#production = options.production;
    this.#randomSecret = options.randomSecret
      ?? (() => randomBytes(32).toString('base64url'));
  }

  login(rawToken: string, clientKey: string, now: number): AdminLoginResult {
    this.#prune(now);
    const attempts = this.#recentAttempts(
      this.#loginAttempts.get(clientKey) ?? [],
      now,
      LOGIN_WINDOW_MS,
    );
    this.#loginAttempts.set(clientKey, attempts);
    if (attempts.length >= LOGIN_LIMIT) {
      return {
        ok: false,
        reason: 'rate-limited',
        retryAfterMs: Math.max(1, attempts[0] + LOGIN_WINDOW_MS - now),
      };
    }
    attempts.push(now);

    if (!this.#sourceTokenDigest) {
      return { ok: false, reason: 'unavailable' };
    }
    if (!constantTimeMatchesDigest(rawToken, this.#sourceTokenDigest)) {
      return { ok: false, reason: 'invalid-credentials' };
    }

    const token = this.#uniqueSecret();
    const csrfToken = this.#uniqueSecret();
    const expiresAt = now + SESSION_TTL_MS;
    const principal: AdminPrincipal = Object.freeze({
      kind: 'backoffice-admin',
      id: `admin_${this.#uniqueSecret()}`,
      expiresAt,
    });
    this.#sessions.set(token, {
      token,
      csrfToken,
      principal,
      expiresAt,
      mutationAttempts: [],
    });
    return {
      ok: true,
      principal,
      csrfToken,
      expiresAt,
      setCookie: this.#sessionCookie(token),
    };
  }

  authenticate(
    cookieHeader: string | undefined,
    now: number,
  ): AdminPrincipal | null {
    const record = this.#session(cookieHeader, now);
    return record?.principal ?? null;
  }

  getSessionView(
    cookieHeader: string | undefined,
    now: number,
  ): AdminSessionView | null {
    const record = this.#session(cookieHeader, now);
    if (!record) return null;
    return {
      principal: record.principal,
      csrfToken: record.csrfToken,
      expiresAt: record.expiresAt,
    };
  }

  requireMutation(input: {
    cookieHeader?: string;
    csrfHeader?: string;
    origin?: string;
    requestOrigin?: string;
    now: number;
  }): AdminPrincipal {
    const record = this.#session(input.cookieHeader, input.now);
    if (!record) throw new AdminSessionError('unauthenticated');

    if (!isExactAdminOrigin(input.origin, input.requestOrigin)) {
      throw new AdminSessionError('origin');
    }
    if (
      typeof input.csrfHeader !== 'string'
      || !constantTimeSecretEqual(input.csrfHeader, record.csrfToken)
    ) {
      throw new AdminSessionError('csrf');
    }

    record.mutationAttempts = this.#recentAttempts(
      record.mutationAttempts,
      input.now,
      MUTATION_WINDOW_MS,
    );
    if (record.mutationAttempts.length >= MUTATION_LIMIT) {
      throw new AdminSessionError(
        'rate-limited',
        Math.max(
          1,
          record.mutationAttempts[0] + MUTATION_WINDOW_MS - input.now,
        ),
      );
    }
    record.mutationAttempts.push(input.now);
    return record.principal;
  }

  logout(cookieHeader: string | undefined): void {
    const token = readSessionToken(cookieHeader);
    if (token) this.#sessions.delete(token);
  }

  clearCookie(): string {
    return [
      `${ADMIN_SESSION_COOKIE}=`,
      'HttpOnly',
      'SameSite=Strict',
      'Path=/api/admin',
      'Max-Age=0',
      ...(this.#production ? ['Secure'] : []),
    ].join('; ');
  }

  stats(): { sessions: number; loginBuckets: number } {
    return {
      sessions: this.#sessions.size,
      loginBuckets: this.#loginAttempts.size,
    };
  }

  close(): void {
    this.#sessions.clear();
    this.#loginAttempts.clear();
  }

  #session(
    cookieHeader: string | undefined,
    now: number,
  ): AdminSessionRecord | null {
    const token = readSessionToken(cookieHeader);
    if (!token) return null;
    const record = this.#sessions.get(token);
    if (!record) return null;
    if (record.expiresAt <= now) {
      this.#sessions.delete(token);
      return null;
    }
    return record;
  }

  #sessionCookie(token: string): string {
    return [
      `${ADMIN_SESSION_COOKIE}=${token}`,
      'HttpOnly',
      'SameSite=Strict',
      'Path=/api/admin',
      `Max-Age=${Math.floor(SESSION_TTL_MS / 1_000)}`,
      ...(this.#production ? ['Secure'] : []),
    ].join('; ');
  }

  #uniqueSecret(): string {
    let candidate = this.#randomSecret();
    while (this.#sessions.has(candidate)) candidate = this.#randomSecret();
    return candidate;
  }

  #recentAttempts(
    attempts: readonly number[],
    now: number,
    windowMs: number,
  ): number[] {
    const cutoff = now - windowMs;
    return attempts.filter(at => at > cutoff && at <= now);
  }

  #prune(now: number): void {
    for (const [token, session] of this.#sessions) {
      if (session.expiresAt <= now) this.#sessions.delete(token);
    }
    for (const [clientKey, attempts] of this.#loginAttempts) {
      const recent = this.#recentAttempts(attempts, now, LOGIN_WINDOW_MS);
      if (recent.length === 0) this.#loginAttempts.delete(clientKey);
      else this.#loginAttempts.set(clientKey, recent);
    }
  }
}

function digest(value: string): Buffer {
  return createHash('sha256').update(value, 'utf8').digest();
}

function constantTimeMatchesDigest(value: string, expected: Buffer): boolean {
  return timingSafeEqual(digest(value), expected);
}

function constantTimeSecretEqual(left: string, right: string): boolean {
  return timingSafeEqual(digest(left), digest(right));
}

function readSessionToken(cookieHeader: string | undefined): string | null {
  if (!cookieHeader) return null;
  const matches: string[] = [];
  for (const part of cookieHeader.split(';')) {
    const separator = part.indexOf('=');
    if (separator < 0) continue;
    if (part.slice(0, separator).trim() !== ADMIN_SESSION_COOKIE) continue;
    const value = part.slice(separator + 1).trim();
    if (value) matches.push(value);
  }
  return matches.length === 1 ? matches[0] : null;
}

export function isExactAdminOrigin(
  origin: string | undefined,
  requestOrigin: string | undefined,
): boolean {
  if (!origin || !requestOrigin) return false;
  try {
    const parsed = new URL(origin);
    const request = new URL(requestOrigin);
    return (
      (parsed.protocol === 'http:' || parsed.protocol === 'https:')
      && parsed.username === ''
      && parsed.password === ''
      && parsed.pathname === '/'
      && parsed.search === ''
      && parsed.hash === ''
      && (request.protocol === 'http:' || request.protocol === 'https:')
      && request.username === ''
      && request.password === ''
      && request.pathname === '/'
      && request.search === ''
      && request.hash === ''
      && parsed.origin === request.origin
    );
  } catch {
    return false;
  }
}

/**
 * Reconstructs the request origin behind the trusted production proxy.
 * Only the appended final X-Forwarded-Proto hop selects the scheme, while
 * every hop must still be a well-formed http/https token.
 */
export function resolveAdminRequestOrigin(
  request: AdminOriginRequest,
  production: boolean,
): string | null {
  const hostValue = request.headers.host;
  if (
    typeof hostValue !== 'string'
    || hostValue.length === 0
    || hostValue !== hostValue.trim()
  ) {
    return null;
  }

  let scheme: 'http' | 'https';
  const forwarded = request.headers['x-forwarded-proto'];
  if (production && forwarded !== undefined) {
    const combined = Array.isArray(forwarded)
      ? forwarded.join(',')
      : forwarded;
    const hops = combined.split(',').map(hop => hop.trim().toLowerCase());
    if (
      hops.length === 0
      || hops.some(hop => hop !== 'http' && hop !== 'https')
    ) {
      return null;
    }
    scheme = hops[hops.length - 1] as 'http' | 'https';
  } else if (request.socket?.encrypted === true) {
    scheme = 'https';
  } else {
    scheme = production ? 'https' : 'http';
  }

  try {
    const parsed = new URL(`${scheme}://${hostValue}`);
    if (
      parsed.protocol !== `${scheme}:`
      || parsed.username !== ''
      || parsed.password !== ''
      || parsed.pathname !== '/'
      || parsed.search !== ''
      || parsed.hash !== ''
    ) {
      return null;
    }
    return parsed.origin;
  } catch {
    return null;
  }
}
