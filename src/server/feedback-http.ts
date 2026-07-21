import type { IncomingMessage, ServerResponse } from 'node:http';
import type { PublicProfile } from '@/lib/profile/types';
import {
  isFeedbackCategory,
  normalizeFeedbackMessage,
  type FeedbackCategory,
} from '@/lib/feedback/rules';
import { clientAddress } from './client-address';
import type { TransientHttpRateLimiter } from './http-rate-limit';
import type { PokerDatabase } from './persistence/database';
import { readProfileCredentialCookie } from './profile-http';

const MAX_JSON_BODY_BYTES = 8 * 1_024;
const DAILY_LIMIT_PER_PROFILE = 10;
const DAY_MS = 24 * 60 * 60 * 1_000;
const MAX_LIST_LIMIT = 200;

export interface FeedbackRecord {
  id: number;
  profileId: string | null;
  alias: string;
  category: FeedbackCategory;
  message: string;
  createdAt: number;
}

interface FeedbackRow {
  id: unknown;
  profile_id: unknown;
  alias: unknown;
  category: unknown;
  message: unknown;
  created_at: unknown;
}

export class FeedbackRepository {
  readonly #database: PokerDatabase;

  constructor(database: PokerDatabase) {
    this.#database = database;
  }

  insert(input: {
    profileId: string;
    alias: string;
    category: FeedbackCategory;
    message: string;
    createdAt: number;
  }): void {
    this.#database.db.prepare(`
      INSERT INTO feedback (profile_id, alias, category, message, created_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(
      input.profileId,
      input.alias,
      input.category,
      input.message,
      input.createdAt,
    );
  }

  countRecentByProfile(profileId: string, since: number): number {
    const row = this.#database.db.prepare(`
      SELECT COUNT(*) AS count FROM feedback
      WHERE profile_id = ? AND created_at >= ?
    `).get(profileId, since) as unknown as { count: number };
    return row.count;
  }

  list(limit: number, beforeId?: number): FeedbackRecord[] {
    const rows = (beforeId === undefined
      ? this.#database.db.prepare(`
          SELECT id, profile_id, alias, category, message, created_at
          FROM feedback ORDER BY id DESC LIMIT ?
        `).all(limit)
      : this.#database.db.prepare(`
          SELECT id, profile_id, alias, category, message, created_at
          FROM feedback WHERE id < ? ORDER BY id DESC LIMIT ?
        `).all(beforeId, limit)) as unknown as FeedbackRow[];
    return rows.map(row => ({
      id: Number(row.id),
      profileId: row.profile_id === null ? null : String(row.profile_id),
      alias: String(row.alias),
      category: String(row.category) as FeedbackCategory,
      message: String(row.message),
      createdAt: Number(row.created_at),
    }));
  }
}

export interface FeedbackHttpOptions {
  manager: {
    authenticateCredential(credential: string): Promise<PublicProfile | null>;
  };
  repository: FeedbackRepository;
  rateLimiter: TransientHttpRateLimiter;
  production: boolean;
  debugToken?: string;
  now?: () => number;
}

export function createFeedbackHttpHandler(options: FeedbackHttpOptions): (
  request: IncomingMessage,
  response: ServerResponse,
  pathname: string | null,
  query: Record<string, string | string[] | undefined>,
) => Promise<boolean> {
  const now = options.now ?? Date.now;
  return async (request, response, pathname, query) => {
    if (pathname === '/api/feedback') {
      if (request.method !== 'POST') {
        drain(request);
        sendError(response, 405, 'METHOD_NOT_ALLOWED', '허용되지 않는 요청 방식입니다.', {
          allow: 'POST',
        });
        return true;
      }
      await handleSubmit(request, response, options, now());
      return true;
    }
    if (pathname === '/api/debug/feedback') {
      if (request.method !== 'GET') {
        drain(request);
        sendError(response, 405, 'METHOD_NOT_ALLOWED', '허용되지 않는 요청 방식입니다.', {
          allow: 'GET',
        });
        return true;
      }
      handleOperatorList(response, options, query);
      return true;
    }
    return false;
  };
}

async function handleSubmit(
  request: IncomingMessage,
  response: ServerResponse,
  options: FeedbackHttpOptions,
  at: number,
): Promise<void> {
  const remote = clientAddress(request);
  if (!options.rateLimiter.allow('feedback', remote)) {
    drain(request);
    sendError(response, 429, 'FEEDBACK_RATE_LIMITED', '요청이 너무 많습니다. 잠시 후 다시 시도해주세요.');
    return;
  }
  const credential = readProfileCredentialCookie(request.headers.cookie);
  if (!credential) {
    drain(request);
    sendError(response, 401, 'PROFILE_REQUIRED', '프로필 인증이 필요합니다.');
    return;
  }
  const profile = await options.manager.authenticateCredential(credential);
  if (!profile) {
    drain(request);
    sendError(response, 401, 'PROFILE_REQUIRED', '프로필 인증이 필요합니다.');
    return;
  }
  let body: unknown;
  try {
    body = await readJson(request);
  } catch {
    sendError(response, 400, 'FEEDBACK_INVALID', '요청 본문이 올바르지 않습니다.');
    return;
  }
  const category = (body as { category?: unknown } | null)?.category;
  const message = normalizeFeedbackMessage(
    (body as { message?: unknown } | null)?.message,
  );
  if (!isFeedbackCategory(category) || message === null) {
    sendError(response, 400, 'FEEDBACK_INVALID', '분류와 내용(5~500자)을 확인해주세요.');
    return;
  }
  if (
    options.repository.countRecentByProfile(profile.id, at - DAY_MS)
      >= DAILY_LIMIT_PER_PROFILE
  ) {
    sendError(response, 429, 'FEEDBACK_DAILY_LIMIT', '오늘 보낼 수 있는 의견을 모두 보냈어요. 내일 다시 부탁드려요.');
    return;
  }
  options.repository.insert({
    profileId: profile.id,
    alias: profile.alias,
    category,
    message,
    createdAt: at,
  });
  sendJson(response, 201, { ok: true });
}

function handleOperatorList(
  response: ServerResponse,
  options: FeedbackHttpOptions,
  query: Record<string, string | string[] | undefined>,
): void {
  const token = one(query.token);
  if (!options.debugToken || token !== options.debugToken) {
    sendError(response, 403, 'FORBIDDEN', 'forbidden');
    return;
  }
  const limitRaw = Number(one(query.limit) ?? '50');
  const limit = Number.isSafeInteger(limitRaw)
    ? Math.min(Math.max(limitRaw, 1), MAX_LIST_LIMIT)
    : 50;
  const beforeRaw = one(query.before);
  const before = beforeRaw === undefined ? undefined : Number(beforeRaw);
  const items = options.repository.list(
    limit,
    before !== undefined && Number.isSafeInteger(before) ? before : undefined,
  );
  sendJson(response, 200, { count: items.length, items });
}

function one(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function drain(request: IncomingMessage): void {
  request.resume();
}

async function readJson(request: IncomingMessage): Promise<unknown> {
  const contentType = request.headers['content-type'];
  if (
    typeof contentType !== 'string'
    || !/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(contentType)
  ) {
    drain(request);
    throw new Error('FEEDBACK_MEDIA_TYPE');
  }
  const chunks: Buffer[] = [];
  let bytes = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    bytes += buffer.length;
    if (bytes > MAX_JSON_BODY_BYTES) {
      drain(request);
      throw new Error('FEEDBACK_TOO_LARGE');
    }
    chunks.push(buffer);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
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
