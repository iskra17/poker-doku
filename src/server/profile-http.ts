import type { IncomingMessage, ServerResponse } from 'node:http';
import type { PublicProfile } from '@/lib/profile/types';
import { clientAddress } from './client-address';
import { eventLog } from './event-log';
import {
  EconomyDomainError,
  type EconomyService,
} from './economy-service';
import {
  HttpConcurrencyLimitError,
  TransientHttpConcurrencyGate,
  TransientHttpRateLimiter,
} from './http-rate-limit';
import {
  ProfileDomainError,
  type ProfileManager,
} from './profile-manager';

export const PROFILE_COOKIE_NAME = 'poker_doku_profile';
const PROFILE_COOKIE_MAX_AGE_SECONDS = 365 * 24 * 60 * 60;
const MAX_JSON_BODY_BYTES = 8 * 1_024;

type ProfileCredentialCookie =
  | { state: 'absent' }
  | { state: 'invalid' }
  | { state: 'present'; credential: string };

export type ProfileHttpManager = Pick<
  ProfileManager,
  | 'create'
  | 'authenticateCredential'
  | 'recover'
  | 'rotateRecovery'
  | 'deleteProfile'
  | 'changeAvatar'
>;

export type EconomyHttpService = Pick<
  EconomyService,
  'claimDaily' | 'claimRescue' | 'getStatus'
>;

export interface ProfileHttpOptions {
  manager: ProfileHttpManager;
  economyService: EconomyHttpService;
  rateLimiter: TransientHttpRateLimiter;
  concurrencyGate?: TransientHttpConcurrencyGate;
  production: boolean;
  remoteAddress?: (request: IncomingMessage) => string;
  onProfileRevoked?: (profileId: string) => void | Promise<void>;
  /** 아바타 변경 전파 — 라이브 소켓/좌석 아바타 즉시 갱신용. 실패해도 프로필 갱신에는 영향 없음 */
  onAvatarChanged?: (profileId: string, avatarId: string) => void;
  /** 아바타 해금 판정용 현재 도장 레벨 — 미주입 시 1(스타터만 선택 가능) */
  dojoLevel?: (profileId: string) => number;
}

interface ErrorBody {
  error: {
    code: string;
    message: string;
  };
}

class RequestBodyError extends Error {
  constructor(readonly kind: 'malformed' | 'too-large') {
    super(kind === 'too-large' ? 'HTTP_BODY_TOO_LARGE' : 'HTTP_BODY_MALFORMED');
    this.name = 'RequestBodyError';
  }
}

const PROFILE_ROUTES = new Map<string, string>([
  ['/api/profile/session', 'GET'],
  ['/api/profile/create', 'POST'],
  ['/api/profile/recover', 'POST'],
  ['/api/profile/recovery/rotate', 'POST'],
  ['/api/profile/avatar', 'POST'],
  ['/api/profile', 'DELETE'],
  ['/api/economy/daily', 'POST'],
  ['/api/economy/rescue', 'POST'],
]);

export function isProfileHttpPath(pathname: string | null): boolean {
  return pathname !== null && PROFILE_ROUTES.has(pathname);
}

function cookieAttributes(production: boolean, maxAge: number): string {
  return [
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${maxAge}`,
    ...(production ? ['Secure'] : []),
  ].join('; ');
}

function issuedCookie(credential: string, production: boolean): string {
  return `${PROFILE_COOKIE_NAME}=${credential}; ${cookieAttributes(
    production,
    PROFILE_COOKIE_MAX_AGE_SECONDS,
  )}`;
}

function clearedCookie(production: boolean): string {
  return `${PROFILE_COOKIE_NAME}=; ${cookieAttributes(production, 0)}`;
}

function inspectProfileCredentialCookie(
  header: string | undefined,
): ProfileCredentialCookie {
  if (!header) return { state: 'absent' };
  const matches: string[] = [];
  let targetSeen = false;
  for (const rawPart of header.split(';')) {
    const part = rawPart.trim();
    const separator = part.indexOf('=');
    const rawName = separator < 0 ? part : part.slice(0, separator);
    if (rawName.trim() !== PROFILE_COOKIE_NAME) continue;
    targetSeen = true;
    if (separator < 0 || rawName !== PROFILE_COOKIE_NAME) {
      return { state: 'invalid' };
    }
    matches.push(part.slice(separator + 1));
  }
  if (!targetSeen) return { state: 'absent' };
  if (matches.length !== 1) return { state: 'invalid' };
  const credential = matches[0];
  return credential
    ? { state: 'present', credential }
    : { state: 'invalid' };
}

export function readProfileCredentialCookie(
  header: string | undefined,
): string | null {
  const inspected = inspectProfileCredentialCookie(header);
  return inspected.state === 'present' ? inspected.credential : null;
}

function readCredentialCookie(request: IncomingMessage): string | null {
  return readProfileCredentialCookie(request.headers.cookie);
}

function sendJson(
  response: ServerResponse,
  status: number,
  body: unknown,
  headers: Record<string, string> = {},
): void {
  if (response.writableEnded) return;
  response.writeHead(status, {
    'cache-control': 'no-store',
    'content-type': 'application/json; charset=utf-8',
    ...headers,
  });
  response.end(JSON.stringify(body));
}

function sendError(
  response: ServerResponse,
  status: number,
  code: string,
  message: string,
  headers: Record<string, string> = {},
): void {
  const body: ErrorBody = { error: { code, message } };
  sendJson(response, status, body, headers);
}

function notifyProfileRevoked(
  options: ProfileHttpOptions,
  profileId: string,
): void {
  if (!options.onProfileRevoked) return;
  try {
    void Promise.resolve(options.onProfileRevoked(profileId)).catch(() => undefined);
  } catch {
    // The credential rotation/deletion response is already committed.
  }
}

function drainRequest(request: IncomingMessage): void {
  request.on('error', () => undefined);
  request.resume();
}

function readRequestBody(request: IncomingMessage): Promise<string> {
  const contentLength = request.headers['content-length'];
  if (contentLength !== undefined) {
    const parsedLength = Number(contentLength);
    if (!Number.isSafeInteger(parsedLength) || parsedLength < 0) {
      drainRequest(request);
      return Promise.reject(new RequestBodyError('malformed'));
    }
    if (parsedLength > MAX_JSON_BODY_BYTES) {
      drainRequest(request);
      return Promise.reject(new RequestBodyError('too-large'));
    }
  }

  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let rejected = false;
    const rejectOnce = (error: RequestBodyError): void => {
      if (rejected) return;
      rejected = true;
      chunks.length = 0;
      reject(error);
    };
    request.on('data', (chunk: Buffer | string) => {
      if (rejected) return;
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      size += buffer.length;
      if (size > MAX_JSON_BODY_BYTES) {
        rejectOnce(new RequestBodyError('too-large'));
        return;
      }
      chunks.push(buffer);
    });
    request.on('end', () => {
      if (!rejected) resolve(Buffer.concat(chunks).toString('utf8'));
    });
    request.on('aborted', () => rejectOnce(new RequestBodyError('malformed')));
    request.on('error', () => rejectOnce(new RequestBodyError('malformed')));
  });
}

async function readJson(
  request: IncomingMessage,
  allowEmpty = false,
): Promise<unknown> {
  const text = await readRequestBody(request);
  if (text.trim() === '') {
    if (allowEmpty) return {};
    throw new RequestBodyError('malformed');
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new RequestBodyError('malformed');
  }
}

function hasExactKeys(
  value: unknown,
  expectedKeys: readonly string[],
): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  const actualKeys = Object.keys(value).sort();
  const expected = [...expectedKeys].sort();
  return actualKeys.length === expected.length
    && actualKeys.every((key, index) => key === expected[index]);
}

function remoteAddress(
  request: IncomingMessage,
  options: ProfileHttpOptions,
): string {
  return options.remoteAddress?.(request)
    ?? clientAddress(request);
}

// 429 관측 로그 스로틀 — 종류당 10초에 1건만 남긴다 (거절 폭주가 로그를 증폭하지 않게).
// 2026-07-21 접속 장애가 로그에 전혀 안 남아 원인 추적이 어려웠던 사각지대 해소.
const rejectLogAt = new Map<string, number>();
function logHttpReject(kind: string, detail: Record<string, unknown>): void {
  const now = Date.now();
  if (now - (rejectLogAt.get(kind) ?? 0) < 10_000) return;
  rejectLogAt.set(kind, now);
  eventLog.log('http-reject', { data: { kind, ...detail } });
}

function allowOperation(
  request: IncomingMessage,
  response: ServerResponse,
  options: ProfileHttpOptions,
  operation:
    | 'profileCreate'
    | 'profileRecover'
    | 'profileAuth'
    | 'daily'
    | 'rescue',
): boolean {
  const address = remoteAddress(request, options);
  if (options.rateLimiter.allow(operation, address)) {
    return true;
  }
  logHttpReject('rate-limited', { operation, address });
  drainRequest(request);
  sendError(
    response,
    429,
    'PROFILE_RATE_LIMITED',
    '요청이 너무 많습니다. 잠시 후 다시 시도해 주세요.',
  );
  return false;
}

function sendEconomyDomainError(
  response: ServerResponse,
  error: EconomyDomainError,
  production: boolean,
): void {
  if (error.code === 'PROFILE_NOT_FOUND') {
    invalidAuthentication(response, production);
    return;
  }

  const messages: Partial<Record<typeof error.code, string>> = {
    DAILY_ALREADY_CLAIMED: '오늘의 무료 칩을 이미 받았습니다.',
    RESCUE_ACTIVE_ESCROW: '참가 중인 게임 칩을 먼저 정산해 주세요.',
    RESCUE_NOT_ELIGIBLE: '현재 잔액은 구제 칩 지급 대상이 아닙니다.',
    RESCUE_DAILY_LIMIT: '오늘의 구제 칩 지급 횟수를 모두 사용했습니다.',
    RESCUE_COOLDOWN: '구제 칩을 다시 받으려면 조금 더 기다려 주세요.',
  };
  const message = messages[error.code];
  if (!message) {
    sendError(response, 500, 'INTERNAL_ERROR', '요청을 처리하지 못했습니다.');
    return;
  }

  const timed = error.code === 'DAILY_ALREADY_CLAIMED'
    || error.code === 'RESCUE_DAILY_LIMIT'
    || error.code === 'RESCUE_COOLDOWN';
  if (timed) {
    if (
      !Number.isSafeInteger(error.availableAt)
      || (error.availableAt as number) < 0
    ) {
      sendError(response, 500, 'INTERNAL_ERROR', '요청을 처리하지 못했습니다.');
      return;
    }
    sendJson(response, 409, {
      error: {
        code: error.code,
        message,
        availableAt: error.availableAt,
      },
    });
    return;
  }
  sendError(response, 409, error.code, message);
}

function invalidAuthentication(
  response: ServerResponse,
  production: boolean,
): void {
  sendError(
    response,
    401,
    'PROFILE_AUTH_INVALID',
    '프로필 인증 정보가 유효하지 않습니다.',
    { 'set-cookie': clearedCookie(production) },
  );
}

async function authenticate(
  request: IncomingMessage,
  response: ServerResponse,
  options: ProfileHttpOptions,
): Promise<PublicProfile | null> {
  const credential = readCredentialCookie(request);
  if (!credential) {
    invalidAuthentication(response, options.production);
    return null;
  }
  if (!allowOperation(request, response, options, 'profileAuth')) return null;
  const profile = await options.manager.authenticateCredential(credential);
  if (!profile) invalidAuthentication(response, options.production);
  return profile;
}

function sendDomainError(
  response: ServerResponse,
  error: ProfileDomainError,
  production: boolean,
): void {
  switch (error.code) {
    case 'ADULT_CONFIRMATION_REQUIRED':
      sendError(response, 400, error.code, '성인 확인이 필요합니다.');
      return;
    case 'INVALID_AVATAR':
      sendError(response, 400, error.code, '선택할 수 없는 아바타입니다.');
      return;
    case 'AVATAR_LOCKED':
      sendError(response, 403, error.code, '아직 해금되지 않은 캐릭터예요. 도장 레벨을 올려 주세요.');
      return;
    case 'PROFILE_SECRET_CONFLICT':
      sendError(response, 409, error.code, '프로필 비밀 정보가 이미 변경되었습니다.');
      return;
    case 'PROFILE_HAS_ACTIVE_ESCROW':
      sendError(response, 409, error.code, '참가 중인 게임의 칩을 먼저 정산해 주세요.');
      return;
    case 'PROFILE_NOT_FOUND':
      invalidAuthentication(response, production);
      return;
    default:
      sendError(response, 500, 'INTERNAL_ERROR', '요청을 처리하지 못했습니다.');
  }
}

async function runKdfRequest<T>(
  options: ProfileHttpOptions,
  work: () => Promise<T>,
): Promise<T> {
  const gate = options.concurrencyGate ?? new TransientHttpConcurrencyGate();
  return gate.run(work);
}

async function handleSession(
  request: IncomingMessage,
  response: ServerResponse,
  options: ProfileHttpOptions,
): Promise<void> {
  if (inspectProfileCredentialCookie(request.headers.cookie).state === 'absent') {
    sendJson(response, 200, { state: 'anonymous' });
    return;
  }
  await runKdfRequest(options, async () => {
    const profile = await authenticate(request, response, options);
    if (profile) {
      const status = options.economyService.getStatus(profile.id);
      sendJson(response, 200, {
        state: 'ready',
        profile: status.profile,
        economy: status.economy,
      });
    }
  });
}

async function handleCreate(
  request: IncomingMessage,
  response: ServerResponse,
  options: ProfileHttpOptions,
): Promise<void> {
  if (!allowOperation(request, response, options, 'profileCreate')) return;
  const body = await readJson(request);
  if (
    !hasExactKeys(body, ['avatarId', 'adultConfirmed'])
    || typeof body.avatarId !== 'string'
    || typeof body.adultConfirmed !== 'boolean'
  ) {
    sendError(response, 400, 'BAD_REQUEST', '요청 본문이 올바르지 않습니다.');
    return;
  }
  await runKdfRequest(options, async () => {
    const created = await options.manager.create({
      avatarId: body.avatarId as string,
      adultConfirmed: body.adultConfirmed as boolean,
    });
    sendJson(
      response,
      201,
      { profile: created.profile, recoveryWords: created.recoveryWords },
      { 'set-cookie': issuedCookie(created.credential, options.production) },
    );
  });
}

async function handleAvatarChange(
  request: IncomingMessage,
  response: ServerResponse,
  options: ProfileHttpOptions,
): Promise<void> {
  const body = await readJson(request);
  if (
    !hasExactKeys(body, ['avatarId'])
    || typeof body.avatarId !== 'string'
  ) {
    sendError(response, 400, 'BAD_REQUEST', '요청 본문이 올바르지 않습니다.');
    return;
  }
  await runKdfRequest(options, async () => {
    const profile = await authenticate(request, response, options);
    if (!profile) return;
    // 도장 레벨 조회 실패는 잠금 실패(스타터만)로 강등 — 아바타 변경이 진행도 장애에 좌우되지 않게
    let dojoLevel = 1;
    try {
      dojoLevel = options.dojoLevel?.(profile.id) ?? 1;
    } catch {
      dojoLevel = 1;
    }
    const updated = options.manager.changeAvatar(
      profile.id,
      body.avatarId as string,
      dojoLevel,
    );
    try {
      options.onAvatarChanged?.(profile.id, updated.avatarId);
    } catch {
      // 전파 실패는 프로필 갱신 성공에 영향을 주지 않는다
    }
    sendJson(response, 200, { profile: updated });
  });
}

async function handleRecover(
  request: IncomingMessage,
  response: ServerResponse,
  options: ProfileHttpOptions,
): Promise<void> {
  if (!allowOperation(request, response, options, 'profileRecover')) return;
  const body = await readJson(request);
  if (
    !hasExactKeys(body, ['recoveryWords'])
    || typeof body.recoveryWords !== 'string'
  ) {
    sendError(response, 400, 'BAD_REQUEST', '요청 본문이 올바르지 않습니다.');
    return;
  }
  await runKdfRequest(options, async () => {
    const recovered = await options.manager.recover(body.recoveryWords as string);
    if (!recovered) {
      sendError(
        response,
        401,
        'PROFILE_RECOVERY_INVALID',
        '복구 문구가 유효하지 않습니다.',
      );
      return;
    }
    sendJson(
      response,
      200,
      { profile: recovered.profile, recoveryWords: recovered.recoveryWords },
      { 'set-cookie': issuedCookie(recovered.credential, options.production) },
    );
    notifyProfileRevoked(options, recovered.profile.id);
  });
}

async function handleRotate(
  request: IncomingMessage,
  response: ServerResponse,
  options: ProfileHttpOptions,
): Promise<void> {
  const body = await readJson(request, true);
  if (!hasExactKeys(body, [])) {
    sendError(response, 400, 'BAD_REQUEST', '요청 본문이 올바르지 않습니다.');
    return;
  }
  await runKdfRequest(options, async () => {
    const profile = await authenticate(request, response, options);
    if (!profile) return;
    const recoveryWords = await options.manager.rotateRecovery(profile.id);
    sendJson(response, 200, { recoveryWords });
  });
}

async function handleDelete(
  request: IncomingMessage,
  response: ServerResponse,
  options: ProfileHttpOptions,
): Promise<void> {
  const body = await readJson(request);
  if (
    !hasExactKeys(body, ['confirmation'])
    || body.confirmation !== '삭제'
  ) {
    sendError(response, 400, 'DELETE_CONFIRMATION_REQUIRED', '삭제 확인 문구가 필요합니다.');
    return;
  }
  await runKdfRequest(options, async () => {
    const profile = await authenticate(request, response, options);
    if (!profile) return;
    options.manager.deleteProfile(profile.id);
    sendJson(
      response,
      200,
      { ok: true },
      { 'set-cookie': clearedCookie(options.production) },
    );
    notifyProfileRevoked(options, profile.id);
  });
}

async function handleEconomyClaim(
  request: IncomingMessage,
  response: ServerResponse,
  options: ProfileHttpOptions,
  operation: 'daily' | 'rescue',
): Promise<void> {
  if (!allowOperation(request, response, options, operation)) return;
  const body = await readJson(request, true);
  if (!hasExactKeys(body, [])) {
    sendError(response, 400, 'BAD_REQUEST', '요청 본문은 빈 객체여야 합니다.');
    return;
  }
  await runKdfRequest(options, async () => {
    const profile = await authenticate(request, response, options);
    if (!profile) return;
    const result = operation === 'daily'
      ? options.economyService.claimDaily(profile.id)
      : options.economyService.claimRescue(profile.id);
    const status = options.economyService.getStatus(profile.id);
    sendJson(response, 200, {
      profile: status.profile,
      economy: status.economy,
      transaction: {
        reason: result.transaction.reason,
        delta: result.transaction.delta,
      },
    });
  });
}

export function createProfileHttpHandler(options: ProfileHttpOptions): (
  request: IncomingMessage,
  response: ServerResponse,
  pathname: string | null,
) => Promise<boolean> {
  const concurrencyGate = options.concurrencyGate
    ?? new TransientHttpConcurrencyGate();
  const resolvedOptions = { ...options, concurrencyGate };

  return async (request, response, pathname) => {
    const allowedMethod = pathname === null ? undefined : PROFILE_ROUTES.get(pathname);
    if (!allowedMethod) return false;
    if (request.method !== allowedMethod) {
      drainRequest(request);
      sendError(
        response,
        405,
        'METHOD_NOT_ALLOWED',
        '허용되지 않은 요청 방식입니다.',
        { allow: allowedMethod },
      );
      return true;
    }

    try {
      switch (pathname) {
        case '/api/profile/session':
          await handleSession(request, response, resolvedOptions);
          break;
        case '/api/profile/create':
          await handleCreate(request, response, resolvedOptions);
          break;
        case '/api/profile/recover':
          await handleRecover(request, response, resolvedOptions);
          break;
        case '/api/profile/recovery/rotate':
          await handleRotate(request, response, resolvedOptions);
          break;
        case '/api/profile/avatar':
          await handleAvatarChange(request, response, resolvedOptions);
          break;
        case '/api/profile':
          await handleDelete(request, response, resolvedOptions);
          break;
        case '/api/economy/daily':
          await handleEconomyClaim(request, response, resolvedOptions, 'daily');
          break;
        case '/api/economy/rescue':
          await handleEconomyClaim(request, response, resolvedOptions, 'rescue');
          break;
      }
    } catch (error) {
      if (response.writableEnded) return true;
      if (error instanceof RequestBodyError) {
        sendError(
          response,
          error.kind === 'too-large' ? 413 : 400,
          error.kind === 'too-large' ? 'PAYLOAD_TOO_LARGE' : 'BAD_REQUEST',
          error.kind === 'too-large'
            ? '요청 본문이 너무 큽니다.'
            : '요청 본문이 올바른 JSON이 아닙니다.',
        );
      } else if (error instanceof HttpConcurrencyLimitError) {
        logHttpReject('kdf-busy', { path: request.url ?? '' });
        sendError(
          response,
          429,
          'PROFILE_BUSY',
          '처리 중인 요청이 많습니다. 잠시 후 다시 시도해 주세요.',
        );
      } else if (error instanceof ProfileDomainError) {
        sendDomainError(response, error, options.production);
      } else if (error instanceof EconomyDomainError) {
        sendEconomyDomainError(response, error, options.production);
      } else {
        sendError(response, 500, 'INTERNAL_ERROR', '요청을 처리하지 못했습니다.');
      }
    }
    return true;
  };
}
