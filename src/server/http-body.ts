import type { IncomingMessage } from 'node:http';

/**
 * JSON 요청 본문 파싱 공용 유틸 — feedback/admin 등 커스텀 서버 직결 핸들러가 공유한다.
 * content-type 검증 + 크기 상한 + 스트리밍 수집. 실패는 HttpBodyError로 종류를 구분한다.
 */

export const MAX_JSON_BODY_BYTES = 8 * 1_024;

export type HttpBodyErrorKind = 'media-type' | 'too-large' | 'malformed';

export class HttpBodyError extends Error {
  constructor(readonly kind: HttpBodyErrorKind) {
    super(`HTTP_BODY_${kind.toUpperCase().replace('-', '_')}`);
    this.name = 'HttpBodyError';
  }
}

/** 남은 본문을 소비해 소켓이 응답 후에도 살아있게 한다 */
export function drainRequest(request: IncomingMessage): void {
  request.resume();
}

export async function readJsonBody(
  request: IncomingMessage,
  maxBytes: number = MAX_JSON_BODY_BYTES,
): Promise<unknown> {
  const contentType = request.headers['content-type'];
  if (
    typeof contentType !== 'string'
    || !/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(contentType)
  ) {
    drainRequest(request);
    throw new HttpBodyError('media-type');
  }
  const chunks: Buffer[] = [];
  let bytes = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    bytes += buffer.length;
    if (bytes > maxBytes) {
      drainRequest(request);
      throw new HttpBodyError('too-large');
    }
    chunks.push(buffer);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new HttpBodyError('malformed');
  }
}
