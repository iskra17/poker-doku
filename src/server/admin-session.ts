import {
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto';
import {
  AdminDeviceLimitError,
  type AdminDeviceCredential,
  type AdminDeviceRepository,
} from './admin-device-repository';

export const ADMIN_SESSION_COOKIE = 'poker_doku_admin';

const SESSION_TTL_MS = 2 * 60 * 60 * 1_000;
/** 등록 기기 유지 기간 — 접속할 때마다 이 값으로 다시 채운다 (2026-09-08 확정). */
export const ADMIN_DEVICE_TTL_MS = 90 * 24 * 60 * 60 * 1_000;
const LOGIN_WINDOW_MS = 10 * 60 * 1_000;
const LOGIN_LIMIT = 5;
const MUTATION_WINDOW_MS = 60 * 1_000;
const MUTATION_LIMIT = 30;
/**
 * 영속 자격 쿠키 접두사 — 이 값이 붙은 쿠키는 **절대** 메모리 세션 Map을 거치지 않고
 * 매 요청 DB를 확인한다. 원격 해제·만료가 다음 요청부터 바로 먹히게 하는 장치다.
 */
const DEVICE_CREDENTIAL_PREFIX = 'pdv1.';
const DEVICE_LOOKUP_INFO = 'poker-doku/admin-trusted-device/lookup/v1';
const DEVICE_SCOPE_INFO = 'poker-doku/admin-trusted-device/scope/v1';
const DEFAULT_DEVICE_NAME = '등록된 브라우저';
const MAX_DEVICE_NAME_LENGTH = 80;
const MAX_DEVICE_ID_LENGTH = 128;
const DEVICE_NAME_FORBIDDEN = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u;

export interface AdminPrincipal {
  readonly kind: 'backoffice-admin';
  readonly id: string;
  readonly expiresAt: number;
}

export type AdminLoginFailureReason =
  | 'invalid-credentials'
  | 'rate-limited'
  | 'unavailable'
  | 'device-limit'
  | 'invalid-device-name';

export type AdminLoginResult =
  | {
    readonly ok: true;
    readonly principal: AdminPrincipal;
    readonly csrfToken: string;
    readonly expiresAt: number;
    /** HTTP Set-Cookie 헤더 전용 — JSON 응답이나 로그에 담지 않는다. */
    readonly setCookie: string;
    readonly remembered: boolean;
  }
  | {
    readonly ok: false;
    readonly reason: AdminLoginFailureReason;
    readonly retryAfterMs?: number;
  };

export interface AdminSessionView {
  readonly principal: AdminPrincipal;
  readonly csrfToken: string;
  readonly expiresAt: number;
  readonly remembered: boolean;
}

export type AdminAuthFailureReason = 'unauthenticated' | 'unavailable';

export type AdminSessionResult =
  | {
    readonly ok: true;
    readonly view: AdminSessionView;
    /** 등록 기기의 만료 연장분 — 쿠키 값은 그대로 두고 수명만 다시 채운다. */
    readonly setCookie?: string;
  }
  | { readonly ok: false; readonly reason: AdminAuthFailureReason };

export type AdminAuthResult =
  | { readonly ok: true; readonly principal: AdminPrincipal }
  | { readonly ok: false; readonly reason: AdminAuthFailureReason };

export interface AdminDeviceView {
  readonly id: string;
  readonly name: string;
  readonly createdAt: number;
  readonly lastUsedAt: number;
  readonly expiresAt: number;
  readonly current: boolean;
}

export type AdminDeviceListResult =
  | { readonly ok: true; readonly devices: readonly AdminDeviceView[] }
  | { readonly ok: false; readonly reason: AdminAuthFailureReason };

export type AdminDeviceRevokeResult =
  | { readonly ok: true; readonly current: boolean }
  | {
    readonly ok: false;
    readonly reason: AdminAuthFailureReason | 'not-found';
  };

export type AdminLogoutResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: 'unavailable' };

export type AdminSessionErrorKind =
  | 'unauthenticated'
  | 'origin'
  | 'csrf'
  | 'rate-limited'
  | 'unavailable';

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
  /**
   * 등록 기기 저장소. 프로덕션(index.ts)과 http-handler 기본 생성자 **둘 다** 연결해야
   * 90일 유지 기능이 조용히 사라지지 않는다.
   */
  devices?: AdminDeviceRepository;
}

export interface AdminLoginOptions {
  readonly rememberDevice?: boolean;
  readonly deviceName?: string;
  /** 로그인 요청이 들고 온 쿠키 — 같은 브라우저의 옛 자격을 폐기/교체하는 데만 쓴다. */
  readonly cookieHeader?: string;
}

type ResolvedAdminSession =
  | { readonly kind: 'memory'; readonly record: AdminSessionRecord }
  | {
    readonly kind: 'device';
    readonly credential: AdminDeviceCredential;
    readonly lookupKey: string;
    readonly rawCredential: string;
  };

type ResolvedAdminSessionResult =
  | { readonly ok: true; readonly session: ResolvedAdminSession }
  | { readonly ok: false; readonly reason: AdminAuthFailureReason };

/**
 * 등록 기기 이름 정규화 — 인증 요소가 아니라 표시용이다.
 * trim 후 제어/서식 문자를 거부하고 80자를 넘으면 거절, 빈 값은 한국어 기본 이름.
 */
export function normalizeAdminDeviceName(raw: string | undefined): string | null {
  if (raw === undefined) return DEFAULT_DEVICE_NAME;
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (trimmed.length === 0) return DEFAULT_DEVICE_NAME;
  if (trimmed.length > MAX_DEVICE_NAME_LENGTH) return null;
  if (DEVICE_NAME_FORBIDDEN.test(trimmed)) return null;
  return trimmed;
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
  /** 원본 운영 토큰에서 파생한 조회 키 재료 — 토큰 원문은 보관하지 않는다. */
  readonly #deviceLookupSecret: Buffer | null;
  /** 현재 원본 토큰 세대를 가리키는 스코프 — 목록/상한/해제를 이 안으로 가둔다. */
  readonly #sourceScope: string | null;
  readonly #production: boolean;
  readonly #randomSecret: () => string;
  readonly #devices: AdminDeviceRepository | null;
  readonly #sessions = new Map<string, AdminSessionRecord>();
  readonly #loginAttempts = new Map<string, number[]>();
  /** 영속 자격은 세션 Map에 담지 않으므로 변경 레이트리밋만 따로 센다. */
  readonly #deviceMutationAttempts = new Map<string, number[]>();

  constructor(options: AdminSessionManagerOptions) {
    this.#sourceTokenDigest = options.sourceToken
      ? digest(options.sourceToken)
      : null;
    this.#deviceLookupSecret = options.sourceToken
      ? createHmac('sha256', options.sourceToken)
        .update(DEVICE_LOOKUP_INFO)
        .digest()
      : null;
    this.#sourceScope = options.sourceToken
      ? createHmac('sha256', options.sourceToken)
        .update(DEVICE_SCOPE_INFO)
        .digest('hex')
      : null;
    this.#production = options.production;
    this.#randomSecret = options.randomSecret
      ?? (() => randomBytes(32).toString('base64url'));
    this.#devices = options.devices ?? null;
  }

  login(
    rawToken: string,
    clientKey: string,
    now: number,
    options: AdminLoginOptions = {},
  ): AdminLoginResult {
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

    // 자격 검증을 통과한 뒤에만 기존 쿠키를 손댄다 — 실패한 로그인은 아무것도 폐기하지 않는다.
    const presented = readSessionToken(options.cookieHeader);
    const presentedLookupKey = presented !== null
      && presented.startsWith(DEVICE_CREDENTIAL_PREFIX)
      ? this.#lookupKey(presented)
      : null;

    if (options.rememberDevice !== true) {
      if (presented !== null && presentedLookupKey === null) {
        this.#sessions.delete(presented);
      }
      if (presentedLookupKey !== null) {
        if (!this.#devices || !this.#sourceScope) {
          return { ok: false, reason: 'unavailable' };
        }
        try {
          this.#devices.revokeByLookupKey(presentedLookupKey, this.#sourceScope);
        } catch {
          return { ok: false, reason: 'unavailable' };
        }
      }
      return this.#issueMemorySession(now);
    }

    if (!this.#devices || !this.#sourceScope) {
      return { ok: false, reason: 'unavailable' };
    }
    const name = normalizeAdminDeviceName(options.deviceName);
    if (name === null) return { ok: false, reason: 'invalid-device-name' };

    const credential = `${DEVICE_CREDENTIAL_PREFIX}${this.#randomSecret()}`;
    const expiresAt = now + ADMIN_DEVICE_TTL_MS;
    const principalId = `admin_${this.#randomSecret()}`;
    try {
      const record = this.#devices.register({
        id: `device_${this.#randomSecret()}`,
        lookupKey: this.#lookupKey(credential)!,
        sourceScope: this.#sourceScope,
        csrfToken: this.#randomSecret(),
        principalId,
        name,
        createdAt: now,
        expiresAt,
        ...(presentedLookupKey === null
          ? {}
          : { replacesLookupKey: presentedLookupKey }),
      });
      if (presented !== null && presentedLookupKey === null) {
        this.#sessions.delete(presented);
      }
      return {
        ok: true,
        principal: devicePrincipal(record),
        csrfToken: record.csrfToken,
        expiresAt: record.expiresAt,
        setCookie: this.#deviceCookie(credential),
        remembered: true,
      };
    } catch (error) {
      if (error instanceof AdminDeviceLimitError) {
        return { ok: false, reason: 'device-limit' };
      }
      return { ok: false, reason: 'unavailable' };
    }
  }

  authenticate(
    cookieHeader: string | undefined,
    now: number,
  ): AdminPrincipal | null {
    const result = this.authenticateSession(cookieHeader, now);
    return result.ok ? result.principal : null;
  }

  /** 저장소 장애를 401로 뭉개지 않기 위한 결과형 인증 — 조회 라우트가 쓴다. */
  authenticateSession(
    cookieHeader: string | undefined,
    now: number,
  ): AdminAuthResult {
    const resolved = this.#resolve(cookieHeader, now);
    if (!resolved.ok) return resolved;
    return { ok: true, principal: principalOf(resolved.session) };
  }

  /**
   * GET /api/admin/session — 등록 기기는 유효 행 조건부 UPDATE로만 만료를 연장한다.
   * 0행이면 미인증이고, 쿠키 값과 CSRF는 회전하지 않는다(다중 탭 안전).
   */
  getSession(
    cookieHeader: string | undefined,
    now: number,
  ): AdminSessionResult {
    const resolved = this.#resolve(cookieHeader, now);
    if (!resolved.ok) return resolved;
    if (resolved.session.kind === 'memory') {
      const record = resolved.session.record;
      return {
        ok: true,
        view: {
          principal: record.principal,
          csrfToken: record.csrfToken,
          expiresAt: record.expiresAt,
          remembered: false,
        },
      };
    }

    try {
      const renewed = this.#devices!.renew(
        resolved.session.lookupKey,
        this.#sourceScope!,
        now,
        now + ADMIN_DEVICE_TTL_MS,
      );
      if (!renewed) return { ok: false, reason: 'unauthenticated' };
      return {
        ok: true,
        view: {
          principal: devicePrincipal(renewed),
          csrfToken: renewed.csrfToken,
          expiresAt: renewed.expiresAt,
          remembered: true,
        },
        setCookie: this.#deviceCookie(resolved.session.rawCredential),
      };
    } catch {
      return { ok: false, reason: 'unavailable' };
    }
  }

  listDevices(
    cookieHeader: string | undefined,
    now: number,
  ): AdminDeviceListResult {
    const resolved = this.#resolve(cookieHeader, now);
    if (!resolved.ok) return resolved;
    if (!this.#devices || !this.#sourceScope) {
      return { ok: false, reason: 'unavailable' };
    }
    const currentId = resolved.session.kind === 'device'
      ? resolved.session.credential.id
      : null;
    try {
      return {
        ok: true,
        devices: this.#devices.list(this.#sourceScope, now).map(device => ({
          ...device,
          current: device.id === currentId,
        })),
      };
    } catch {
      return { ok: false, reason: 'unavailable' };
    }
  }

  /** 기기 해제 — 다른 기기는 그 기기의 다음 요청부터, 현재 기기는 쿠키까지 즉시 정리한다. */
  revokeDevice(
    cookieHeader: string | undefined,
    deviceId: string,
    now: number,
  ): AdminDeviceRevokeResult {
    const resolved = this.#resolve(cookieHeader, now);
    if (!resolved.ok) return resolved;
    if (!this.#devices || !this.#sourceScope) {
      return { ok: false, reason: 'unavailable' };
    }
    if (
      typeof deviceId !== 'string'
      || deviceId.length === 0
      || deviceId.length > MAX_DEVICE_ID_LENGTH
    ) {
      return { ok: false, reason: 'not-found' };
    }
    try {
      if (!this.#devices.revokeById(deviceId, this.#sourceScope)) {
        return { ok: false, reason: 'not-found' };
      }
    } catch {
      return { ok: false, reason: 'unavailable' };
    }
    this.#deviceMutationAttempts.delete(deviceId);
    return {
      ok: true,
      current: resolved.session.kind === 'device'
        && resolved.session.credential.id === deviceId,
    };
  }

  requireMutation(input: {
    cookieHeader?: string;
    csrfHeader?: string;
    origin?: string;
    requestOrigin?: string;
    now: number;
  }): AdminPrincipal {
    const resolved = this.#resolve(input.cookieHeader, input.now);
    if (!resolved.ok) throw new AdminSessionError(resolved.reason);
    const session = resolved.session;

    if (!isExactAdminOrigin(input.origin, input.requestOrigin)) {
      throw new AdminSessionError('origin');
    }
    const csrfToken = session.kind === 'memory'
      ? session.record.csrfToken
      : session.credential.csrfToken;
    if (
      typeof input.csrfHeader !== 'string'
      || !constantTimeSecretEqual(input.csrfHeader, csrfToken)
    ) {
      throw new AdminSessionError('csrf');
    }

    const attempts = this.#recentAttempts(
      session.kind === 'memory'
        ? session.record.mutationAttempts
        : this.#deviceMutationAttempts.get(session.credential.id) ?? [],
      input.now,
      MUTATION_WINDOW_MS,
    );
    if (session.kind === 'memory') session.record.mutationAttempts = attempts;
    else this.#deviceMutationAttempts.set(session.credential.id, attempts);
    if (attempts.length >= MUTATION_LIMIT) {
      throw new AdminSessionError(
        'rate-limited',
        Math.max(1, attempts[0] + MUTATION_WINDOW_MS - input.now),
      );
    }
    attempts.push(input.now);
    return principalOf(session);
  }

  /**
   * 로그아웃 — 영속 자격은 DB에서 실제로 지워야 성공이다. 저장소 실패를 성공처럼
   * 처리하면 쿠키만 사라지고 서버에는 자격이 남으므로 호출자가 503으로 알린다.
   */
  logout(cookieHeader: string | undefined): AdminLogoutResult {
    const token = readSessionToken(cookieHeader);
    if (token === null) return { ok: true };
    if (!token.startsWith(DEVICE_CREDENTIAL_PREFIX)) {
      this.#sessions.delete(token);
      return { ok: true };
    }
    if (!this.#devices || !this.#sourceScope) return { ok: true };
    try {
      this.#devices.revokeByLookupKey(this.#lookupKey(token)!, this.#sourceScope);
      return { ok: true };
    } catch {
      return { ok: false, reason: 'unavailable' };
    }
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
    this.#deviceMutationAttempts.clear();
  }

  #issueMemorySession(now: number): AdminLoginResult {
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
      remembered: false,
    };
  }

  /**
   * 쿠키 하나를 세션으로 해석한다. 영속 자격은 캐시 없이 매번 DB를 확인하므로
   * 원격 해제·만료·원본 토큰 회전이 바로 다음 요청에 반영된다.
   */
  #resolve(
    cookieHeader: string | undefined,
    now: number,
  ): ResolvedAdminSessionResult {
    const token = readSessionToken(cookieHeader);
    if (token === null) return { ok: false, reason: 'unauthenticated' };

    if (token.startsWith(DEVICE_CREDENTIAL_PREFIX)) {
      const lookupKey = this.#lookupKey(token);
      if (lookupKey === null || !this.#devices || !this.#sourceScope) {
        return { ok: false, reason: 'unauthenticated' };
      }
      let credential: AdminDeviceCredential | null;
      try {
        credential = this.#devices.findActive(
          lookupKey,
          this.#sourceScope,
          now,
        );
      } catch {
        return { ok: false, reason: 'unavailable' };
      }
      if (!credential) return { ok: false, reason: 'unauthenticated' };
      return {
        ok: true,
        session: { kind: 'device', credential, lookupKey, rawCredential: token },
      };
    }

    const record = this.#sessions.get(token);
    if (!record) return { ok: false, reason: 'unauthenticated' };
    if (record.expiresAt <= now) {
      this.#sessions.delete(token);
      return { ok: false, reason: 'unauthenticated' };
    }
    return { ok: true, session: { kind: 'memory', record } };
  }

  /** 원본 운영 토큰 세대에 묶인 조회 키 — 토큰이 없으면 어떤 영속 자격도 해석할 수 없다. */
  #lookupKey(credential: string): string | null {
    if (!this.#deviceLookupSecret) return null;
    return createHmac('sha256', this.#deviceLookupSecret)
      .update(credential)
      .digest('hex');
  }

  #sessionCookie(token: string): string {
    return this.#cookie(token, SESSION_TTL_MS);
  }

  #deviceCookie(credential: string): string {
    return this.#cookie(credential, ADMIN_DEVICE_TTL_MS);
  }

  #cookie(value: string, ttlMs: number): string {
    return [
      `${ADMIN_SESSION_COOKIE}=${value}`,
      'HttpOnly',
      'SameSite=Strict',
      'Path=/api/admin',
      `Max-Age=${Math.floor(ttlMs / 1_000)}`,
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
    for (const [deviceId, attempts] of this.#deviceMutationAttempts) {
      const recent = this.#recentAttempts(attempts, now, MUTATION_WINDOW_MS);
      if (recent.length === 0) this.#deviceMutationAttempts.delete(deviceId);
      else this.#deviceMutationAttempts.set(deviceId, recent);
    }
  }
}

function devicePrincipal(credential: AdminDeviceCredential): AdminPrincipal {
  return Object.freeze({
    kind: 'backoffice-admin' as const,
    id: credential.principalId,
    expiresAt: credential.expiresAt,
  });
}

function principalOf(session: ResolvedAdminSession): AdminPrincipal {
  return session.kind === 'memory'
    ? session.record.principal
    : devicePrincipal(session.credential);
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
