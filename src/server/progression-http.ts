import type { IncomingMessage, ServerResponse } from 'node:http';
import type { PublicProfile } from '@/lib/profile/types';
import {
  HttpConcurrencyLimitError,
  TransientHttpConcurrencyGate,
  type TransientHttpRateLimiter,
} from './http-rate-limit';
import { PROFILE_COOKIE_NAME, readProfileCredentialCookie } from './profile-http';
import { ProgressionPersistenceError } from './progression-repository';
import {
  ProgressionServiceError,
  type ProgressionService,
} from './progression-service';
import { getKstDateKey } from './economy-service';
import type { ProgressionSnapshot } from '@/lib/progression/types';

const MAX_JSON_BODY_BYTES = 8 * 1024;
const ROUTES = new Map<string, 'GET' | 'POST'>([
  ['/api/progression', 'GET'],
  ['/api/progression/missions/reroll', 'POST'],
  ['/api/progression/character', 'POST'],
  ['/api/progression/equipment', 'POST'],
]);

export type ProgressionAuthManager = {
  authenticateCredential(credential: string): Promise<PublicProfile | null>;
};

export type ProgressionHttpService = Pick<
  ProgressionService,
  'getView' | 'rerollMission' | 'selectCharacter' | 'setEquipment'
>;

export interface ProgressionHttpOptions {
  manager: ProgressionAuthManager;
  service: ProgressionHttpService;
  rateLimiter: TransientHttpRateLimiter;
  concurrencyGate?: TransientHttpConcurrencyGate;
  production: boolean;
  now?: () => number;
  onPublicCosmeticsChanged?: (
    profileId: string,
    snapshot: ProgressionSnapshot,
  ) => void;
}

class BodyError extends Error {
  constructor(readonly kind: 'malformed' | 'too-large' | 'media-type') {
    super(kind);
  }
}

export function createProgressionHttpHandler(options: ProgressionHttpOptions): (
  request: IncomingMessage,
  response: ServerResponse,
  pathname: string | null,
) => Promise<boolean> {
  const gate = options.concurrencyGate ?? new TransientHttpConcurrencyGate();
  const now = options.now ?? Date.now;
  return async (request, response, pathname) => {
    const allowedMethod = pathname === null ? undefined : ROUTES.get(pathname);
    if (!allowedMethod) return false;
    if (request.method !== allowedMethod) {
      drain(request);
      sendError(response, 405, 'METHOD_NOT_ALLOWED', '허용되지 않는 요청 방식입니다.', {
        allow: allowedMethod,
      });
      return true;
    }

    try {
      const body = allowedMethod === 'POST'
        ? await readJson(request)
        : undefined;
      const profile = await gate.run(async () => authenticate(
        request,
        response,
        options,
      ));
      if (!profile) return true;
      const at = now();

      if (pathname === '/api/progression') {
        sendJson(response, 200, options.service.getView(
          profile.id,
          profile.avatarId,
          at,
        ));
        return true;
      }
      if (pathname === '/api/progression/missions/reroll') {
        if (!hasExactKeys(body, ['slot']) || !Number.isSafeInteger(body.slot)) {
          sendError(response, 400, 'BAD_REQUEST', '요청 본문이 올바르지 않습니다.');
          return true;
        }
        options.service.getView(profile.id, profile.avatarId, at);
        const missions = options.service.rerollMission(
          profile.id,
          getKstDateKey(at),
          body.slot as number,
          at,
        );
        sendJson(response, 200, { missions });
        return true;
      }
      if (pathname === '/api/progression/character') {
        if (!hasExactKeys(body, ['characterId']) || typeof body.characterId !== 'string') {
          sendError(response, 400, 'BAD_REQUEST', '요청 본문이 올바르지 않습니다.');
          return true;
        }
        const progression = options.service.selectCharacter(
          profile.id,
          body.characterId,
          at,
        );
        notifyPublicCosmetics(options, profile.id, progression);
        sendJson(response, 200, { progression });
        return true;
      }
      if (
        !hasExactKeys(body, ['slot', 'itemId'])
        || typeof body.slot !== 'string'
        || (body.itemId !== null && typeof body.itemId !== 'string')
      ) {
        sendError(response, 400, 'BAD_REQUEST', '요청 본문이 올바르지 않습니다.');
        return true;
      }
      options.service.getView(profile.id, profile.avatarId, at);
      const progression = options.service.setEquipment(
        profile.id,
        body.slot,
        body.itemId,
        at,
      );
      notifyPublicCosmetics(options, profile.id, progression);
      sendJson(response, 200, { progression });
    } catch (error) {
      if (response.writableEnded) return true;
      handleError(response, error, options.production);
    }
    return true;
  };
}

function notifyPublicCosmetics(
  options: ProgressionHttpOptions,
  profileId: string,
  snapshot: ProgressionSnapshot,
): void {
  try {
    options.onPublicCosmeticsChanged?.(profileId, snapshot);
  } catch {
    // The durable mutation already succeeded; a later room update/rejoin heals display state.
  }
}

async function authenticate(
  request: IncomingMessage,
  response: ServerResponse,
  options: ProgressionHttpOptions,
): Promise<PublicProfile | null> {
  const credential = readProfileCredentialCookie(request.headers.cookie);
  if (!credential) {
    invalidAuth(response, options.production);
    return null;
  }
  const remote = request.socket.remoteAddress ?? 'unknown';
  if (!options.rateLimiter.allow('profileAuth', remote)) {
    sendError(response, 429, 'PROFILE_RATE_LIMITED', '요청이 너무 많습니다.');
    return null;
  }
  const profile = await options.manager.authenticateCredential(credential);
  if (!profile) invalidAuth(response, options.production);
  return profile;
}

function invalidAuth(response: ServerResponse, production: boolean): void {
  sendError(response, 401, 'PROFILE_AUTH_INVALID', '프로필 인증 정보가 유효하지 않습니다.', {
    'set-cookie': `${PROFILE_COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${
      production ? '; Secure' : ''
    }`,
  });
}

function handleError(
  response: ServerResponse,
  error: unknown,
  production: boolean,
): void {
  if (error instanceof BodyError) {
    const status = error.kind === 'too-large' ? 413
      : error.kind === 'media-type' ? 415 : 400;
    sendError(response, status, status === 415 ? 'UNSUPPORTED_MEDIA_TYPE'
      : status === 413 ? 'PAYLOAD_TOO_LARGE' : 'BAD_REQUEST',
    '요청 본문이 올바르지 않습니다.');
    return;
  }
  if (error instanceof HttpConcurrencyLimitError) {
    sendError(response, 429, 'PROFILE_BUSY', '처리 중인 요청이 많습니다.');
    return;
  }
  if (error instanceof ProgressionServiceError) {
    if (error.code === 'PROGRESSION_INPUT_INVALID') {
      sendError(response, 400, error.code, '요청 값이 올바르지 않습니다.');
      return;
    }
    if (error.code === 'PROGRESSION_PROFILE_NOT_FOUND') {
      invalidAuth(response, production);
      return;
    }
    if (error.code === 'PROGRESSION_STORED_SUMMARY_INVALID'
      || error.code === 'PROGRESSION_COUNTER_OVERFLOW') {
      sendError(response, 500, 'INTERNAL_ERROR', '요청을 처리하지 못했습니다.');
      return;
    }
    sendError(response, 409, error.code, '현재 상태에서는 요청을 처리할 수 없습니다.');
    return;
  }
  if (error instanceof ProgressionPersistenceError) {
    if (error.code === 'PROGRESSION_PROFILE_NOT_FOUND') {
      invalidAuth(response, production);
      return;
    }
    sendError(response, 500, 'INTERNAL_ERROR', '요청을 처리하지 못했습니다.');
    return;
  }
  sendError(response, 500, 'INTERNAL_ERROR', '요청을 처리하지 못했습니다.');
}

function hasExactKeys(
  value: unknown,
  keys: readonly string[],
): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length
    && actual.every((key, index) => key === expected[index]);
}

async function readJson(request: IncomingMessage): Promise<unknown> {
  const contentType = request.headers['content-type'];
  if (
    typeof contentType !== 'string'
    || !/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(contentType)
  ) {
    drain(request);
    throw new BodyError('media-type');
  }
  const contentLength = request.headers['content-length'];
  if (contentLength !== undefined) {
    const parsed = Number(contentLength);
    if (!Number.isSafeInteger(parsed) || parsed < 0) throw new BodyError('malformed');
    if (parsed > MAX_JSON_BODY_BYTES) {
      drain(request);
      throw new BodyError('too-large');
    }
  }
  const chunks: Buffer[] = [];
  let bytes = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    bytes += buffer.length;
    if (bytes > MAX_JSON_BODY_BYTES) throw new BodyError('too-large');
    chunks.push(buffer);
  }
  try {
    const text = Buffer.concat(chunks).toString('utf8');
    if (text.trim() === '') throw new Error('empty');
    return JSON.parse(text) as unknown;
  } catch {
    throw new BodyError('malformed');
  }
}

function drain(request: IncomingMessage): void {
  request.on('error', () => undefined);
  request.resume();
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
  sendJson(response, status, { error: { code, message } }, headers);
}
