import type { IncomingMessage, ServerResponse } from 'node:http';
import type { PublicProfile } from '@/lib/profile/types';
import type { StoryProgressView } from '@/lib/story/views';
import { clientAddress } from './client-address';
import type { TransientHttpRateLimiter } from './http-rate-limit';
import { readProfileCredentialCookie } from './profile-http';

/**
 * 스토리 허브 진행 요약 API — `GET /api/story`.
 * 소켓 `get-story-progress`와 같은 뷰(StoryProgressView)를 돌려준다. 로비 허브가 소켓 연결 전에도
 * 그릴 수 있게 HTTP를 두며, 인증은 프로필 쿠키(hand-history-http와 동일 계약)다.
 * 진행 뷰는 런타임(코디네이터)이 늦게 바인딩되므로 함수로 받는다 — 런타임 전이면 503.
 */
export interface StoryHttpOptions {
  manager: {
    authenticateCredential(credential: string): Promise<PublicProfile | null>;
  };
  rateLimiter: TransientHttpRateLimiter;
  progress: (profileId: string) => StoryProgressView | null;
}

export function createStoryHttpHandler(options: StoryHttpOptions): (
  request: IncomingMessage,
  response: ServerResponse,
  pathname: string | null,
) => Promise<boolean> {
  return async (request, response, pathname) => {
    if (pathname !== '/api/story') return false;

    if (request.method !== 'GET') {
      request.resume();
      sendError(response, 405, 'METHOD_NOT_ALLOWED', '허용되지 않는 요청 방식입니다.', {
        allow: 'GET',
      });
      return true;
    }

    const remote = clientAddress(request);
    if (!options.rateLimiter.allow('story', remote)) {
      sendError(response, 429, 'STORY_RATE_LIMITED', '요청이 너무 많습니다. 잠시 후 다시 시도해주세요.');
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

    let progress: StoryProgressView | null;
    try {
      progress = options.progress(profile.id);
    } catch {
      sendError(response, 500, 'STORY_UNAVAILABLE', '수련 기록을 불러오지 못했습니다.');
      return true;
    }
    if (!progress) {
      sendError(response, 503, 'STORY_NOT_READY', '수련 스토리를 준비 중입니다. 잠시 후 다시 시도해주세요.');
      return true;
    }
    response.writeHead(200, {
      'cache-control': 'no-store',
      'content-type': 'application/json; charset=utf-8',
    });
    response.end(JSON.stringify({ progress }));
    return true;
  };
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
