import type { IncomingMessage, ServerResponse } from 'node:http';
import type { PublicProfile } from '@/lib/profile/types';
import type { HandHistoryRepository } from './hand-history';
import type { TransientHttpRateLimiter } from './http-rate-limit';
import { readProfileCredentialCookie } from './profile-http';

const DEFAULT_LIST_LIMIT = 20;
const MAX_LIST_LIMIT = 50;

/**
 * 본인 핸드 히스토리 조회 API (GGPoker PokerCraft의 Game History 축소판).
 * - GET /api/hands           목록 (커서 페이지네이션: ?limit=&before=)
 * - GET /api/hands/:id       상세 (본인 소유만 — 아니면 404, 존재 여부 비노출)
 * 인증은 프로필 쿠키 (feedback-http와 동일 계약).
 */
export interface HandHistoryHttpOptions {
  manager: {
    authenticateCredential(credential: string): Promise<PublicProfile | null>;
  };
  repository: HandHistoryRepository;
  rateLimiter: TransientHttpRateLimiter;
}

export function createHandHistoryHttpHandler(options: HandHistoryHttpOptions): (
  request: IncomingMessage,
  response: ServerResponse,
  pathname: string | null,
  query: Record<string, string | string[] | undefined>,
) => Promise<boolean> {
  return async (request, response, pathname, query) => {
    if (pathname === null || !/^\/api\/hands(?:\/|$)/.test(pathname)) return false;

    if (request.method !== 'GET') {
      drain(request);
      sendError(response, 405, 'METHOD_NOT_ALLOWED', '허용되지 않는 요청 방식입니다.', {
        allow: 'GET',
      });
      return true;
    }

    const remote = request.socket.remoteAddress ?? 'unknown';
    if (!options.rateLimiter.allow('handHistory', remote)) {
      sendError(response, 429, 'HANDS_RATE_LIMITED', '요청이 너무 많습니다. 잠시 후 다시 시도해주세요.');
      return true;
    }

    const credential = readProfileCredentialCookie(request.headers.cookie);
    const profile = credential
      ? await options.manager.authenticateCredential(credential)
      : null;
    if (!profile) {
      sendError(response, 401, 'PROFILE_REQUIRED', '프로필 인증이 필요합니다.');
      return true;
    }

    if (pathname === '/api/hands') {
      handleList(response, options, profile.id, query);
      return true;
    }

    const idMatch = /^\/api\/hands\/(\d{1,15})$/.exec(pathname);
    if (!idMatch) {
      sendError(response, 404, 'HAND_NOT_FOUND', '핸드를 찾을 수 없습니다.');
      return true;
    }
    handleDetail(response, options, profile.id, Number(idMatch[1]));
    return true;
  };
}

function handleList(
  response: ServerResponse,
  options: HandHistoryHttpOptions,
  profileId: string,
  query: Record<string, string | string[] | undefined>,
): void {
  const limitRaw = Number(one(query.limit) ?? String(DEFAULT_LIST_LIMIT));
  const limit = Number.isSafeInteger(limitRaw)
    ? Math.min(Math.max(limitRaw, 1), MAX_LIST_LIMIT)
    : DEFAULT_LIST_LIMIT;
  const beforeRaw = one(query.before);
  const before = beforeRaw === undefined ? undefined : Number(beforeRaw);
  const items = options.repository.listByProfile(
    profileId,
    limit,
    before !== undefined && Number.isSafeInteger(before) && before > 0
      ? before
      : undefined,
  );
  sendJson(response, 200, {
    items,
    // 마지막 페이지 판별용 — limit보다 적게 오면 더 없음
    nextBefore: items.length === limit ? items[items.length - 1].id : null,
  });
}

function handleDetail(
  response: ServerResponse,
  options: HandHistoryHttpOptions,
  profileId: string,
  id: number,
): void {
  const hand = options.repository.getDetail(id, profileId);
  if (!hand) {
    sendError(response, 404, 'HAND_NOT_FOUND', '핸드를 찾을 수 없습니다.');
    return;
  }
  sendJson(response, 200, { hand });
}

function one(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function drain(request: IncomingMessage): void {
  request.resume();
}

function sendJson(
  response: ServerResponse,
  status: number,
  payload: unknown,
): void {
  response.writeHead(status, {
    'cache-control': 'no-store',
    'content-type': 'application/json; charset=utf-8',
  });
  response.end(JSON.stringify(payload));
}

function sendError(
  response: ServerResponse,
  status: number,
  code: string,
  message: string,
  headers: Record<string, string> = {},
): void {
  response.writeHead(status, {
    'cache-control': 'no-store',
    'content-type': 'application/json; charset=utf-8',
    ...headers,
  });
  response.end(JSON.stringify({ error: { code, message } }));
}
