import {
  createHmac,
  timingSafeEqual,
} from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { ArenaTier } from '@/lib/arena/types';
import { ARENA_CONFIG_V1 } from '@/lib/arena/config';
import { rankWeeklyStandings } from '@/lib/arena/rules';
import {
  getCollectionItemDefinition,
  type CollectionItemKind,
} from '@/lib/collection/catalog';
import type { PublicProfile } from '@/lib/profile/types';
import {
  type ArenaGroupMemberRecord,
  type ArenaPublicIdentity,
  type ArenaSeasonStanding,
  ArenaRepository,
} from './arena-repository';
import { ArenaService, getArenaKstWeekKey } from './arena-service';
import { PROFILE_COOKIE_NAME, readProfileCredentialCookie } from './profile-http';

const PAGE_SIZE = 50;
const CURSOR_VERSION = 1;
const CURSOR_TTL_MS = 5 * 60_000;

export interface ArenaPublicCosmetics {
  readonly titleId: string | null;
  readonly frameId: string | null;
}

export interface ArenaHttpLeaderboardRow {
  /** Private cursor anchor. It is never serialized in an API response. */
  readonly stableId: string;
  readonly alias: string;
  readonly avatarId: string;
  readonly cosmetics: ArenaPublicCosmetics;
  readonly place: number;
  readonly score: number;
  readonly matches: number;
  readonly tier: ArenaTier | null;
  readonly isSelf?: boolean;
}

export interface ArenaHttpSnapshot {
  readonly season: {
    readonly startsAt: number;
    readonly endsAt: number;
    readonly remainingMs: number;
    readonly preseason: boolean;
    readonly preseasonScarceRewardsSuppressed: boolean;
  };
  readonly profile: {
    readonly availableTickets: number;
    readonly placementGames: number;
    readonly placementMatches: number;
    readonly placementPoints: number;
    readonly tier: ArenaTier | null;
  };
  readonly weekly: {
    readonly groupAssigned: boolean;
    readonly rank: number | null;
    readonly score: number;
    readonly matches: number;
    readonly memberCount: number;
    readonly tier: ArenaTier | null;
  };
}

export interface ArenaHttpService {
  getSnapshot(profileId: string, at: number): ArenaHttpSnapshot;
  getGroupLeaderboard(profileId: string, at: number): {
    readonly contextId: string;
    readonly tier: ArenaTier | null;
    readonly smallGroup: boolean;
    readonly promotionGamesRequired: number;
    readonly rows: readonly ArenaHttpLeaderboardRow[];
  };
  getGlobalLeaderboard(at: number): {
    readonly contextId: string;
    readonly season: {
      readonly startsAt: number;
      readonly endsAt: number;
    };
    readonly rows: readonly ArenaHttpLeaderboardRow[];
  };
  getRewards(at: number): {
    readonly season: {
      readonly id: string;
      readonly preseason: boolean;
      readonly preseasonScarceRewardsSuppressed: boolean;
    };
    readonly items: readonly {
      readonly rewardKey: string;
      readonly name: string;
      readonly description: string;
      readonly kind: CollectionItemKind;
    }[];
  };
}

export class ArenaHttpDataService implements ArenaHttpService {
  constructor(
    private readonly arena: ArenaService,
    private readonly repository: ArenaRepository,
  ) {}

  getSnapshot(profileId: string, at: number): ArenaHttpSnapshot {
    const snapshot = this.arena.getSnapshot(profileId, at);
    const window = this.arena.reconcile(at);
    const member = this.repository.findGroupMember(
      window.id,
      getArenaKstWeekKey(at),
      profileId,
    );
    const group = member ? this.repository.requireGroup(member.groupId) : null;
    const ranked = member
      ? rankWeeklyStandings(this.repository.listGroupMembers(member.groupId))
      : [];
    const rank = member
      ? ranked.findIndex(row => row.profileId === profileId) + 1
      : null;
    return {
      season: {
        ...snapshot.season,
        remainingMs: Math.max(0, snapshot.season.endsAt - at),
      },
      profile: {
        ...snapshot.profile,
        placementMatches: ARENA_CONFIG_V1.placementMatches,
      },
      weekly: {
        groupAssigned: member !== null,
        rank,
        score: member?.points ?? 0,
        matches: member?.matches ?? 0,
        memberCount: ranked.length,
        tier: group?.tier ?? snapshot.profile.tier,
      },
    };
  }

  getGroupLeaderboard(profileId: string, at: number): ReturnType<
    ArenaHttpService['getGroupLeaderboard']
  > {
    this.arena.getSnapshot(profileId, at);
    const window = this.arena.reconcile(at);
    const weekKey = getArenaKstWeekKey(at);
    const member = this.repository.findGroupMember(
      window.id,
      weekKey,
      profileId,
    );
    if (!member) {
      return {
        contextId: `${window.id}:${weekKey}:unassigned:${profileId}`,
        tier: this.repository.requireProfile(window.id, profileId).tier,
        smallGroup: true,
        promotionGamesRequired: ARENA_CONFIG_V1.promotionGamesRequired,
        rows: [],
      };
    }
    const group = this.repository.requireGroup(member.groupId);
    const members = this.repository.listGroupMembers(member.groupId);
    const byProfileId = new Map(
      members.map(row => [row.profileId, row] as const),
    );
    const ranked = rankWeeklyStandings(members).map(row => {
      const complete = byProfileId.get(row.profileId);
      if (!complete) throw new Error('ARENA_GROUP_STANDING_INVALID');
      return complete;
    });
    return {
      contextId: `${window.id}:${weekKey}:${member.groupId}`,
      tier: group.tier,
      smallGroup: ranked.length < 5,
      promotionGamesRequired: ARENA_CONFIG_V1.promotionGamesRequired,
      rows: this.toRows(ranked, profileId),
    };
  }

  getGlobalLeaderboard(at: number): ReturnType<
    ArenaHttpService['getGlobalLeaderboard']
  > {
    const window = this.arena.reconcile(at);
    const ranked = this.repository.listSeasonStandings(window.id);
    return {
      contextId: window.id,
      season: {
        startsAt: window.startsAt,
        endsAt: window.endsAt,
      },
      rows: this.toRows(ranked),
    };
  }

  getRewards(at: number): ReturnType<ArenaHttpService['getRewards']> {
    const window = this.arena.reconcile(at);
    const catalog = this.repository.listSeasonCatalog(window.id);
    const visible = window.preseason
      ? catalog.filter(item => item.rewardKey === 'participation-emblem')
      : catalog;
    return {
      season: {
        id: window.id,
        preseason: window.preseason,
        preseasonScarceRewardsSuppressed: window.preseason,
      },
      items: visible.map(item => {
        const definition = getCollectionItemDefinition(item.itemId);
        if (!definition) throw new Error('ARENA_REWARD_METADATA_INVALID');
        return {
          rewardKey: item.rewardKey,
          name: definition.name,
          description: definition.description,
          kind: definition.kind,
        };
      }),
    };
  }

  private toRows(
    ranked: readonly (ArenaGroupMemberRecord | ArenaSeasonStanding)[],
    selfProfileId?: string,
  ): ArenaHttpLeaderboardRow[] {
    const identities = new Map(
      this.repository.listPublicIdentities(
        ranked.map(row => row.profileId),
      ).map(identity => [identity.profileId, identity] as const),
    );
    return ranked.map((row, index) => {
      const identity = identities.get(row.profileId);
      if (!identity) throw new Error('ARENA_PUBLIC_IDENTITY_INVALID');
      return leaderboardRow(
        row,
        identity,
        index + 1,
        selfProfileId === undefined ? undefined : row.profileId === selfProfileId,
      );
    });
  }
}

function leaderboardRow(
  standing: ArenaGroupMemberRecord | ArenaSeasonStanding,
  identity: ArenaPublicIdentity,
  place: number,
  isSelf?: boolean,
): ArenaHttpLeaderboardRow {
  return {
    stableId: standing.profileId,
    alias: identity.alias,
    avatarId: identity.avatarId,
    cosmetics: {
      titleId: identity.titleId,
      frameId: identity.frameId,
    },
    place,
    score: standing.points,
    matches: standing.matches,
    tier: 'finalTier' in standing ? standing.finalTier : null,
    ...(isSelf === undefined ? {} : { isSelf }),
  };
}

export interface ArenaHttpOptions {
  readonly enabled: () => boolean;
  readonly manager: {
    authenticateCredential(credential: string): Promise<PublicProfile | null>;
  };
  readonly service?: ArenaHttpService;
  readonly production: boolean;
  readonly cursorSecret: string;
  readonly now?: () => number;
}

type Route = 'snapshot' | 'group' | 'global' | 'rewards';

const ROUTES = new Map<string, Route>([
  ['/api/arena', 'snapshot'],
  ['/api/arena/leaderboard/group', 'group'],
  ['/api/arena/leaderboard/global', 'global'],
  ['/api/arena/rewards', 'rewards'],
]);

export function createArenaHttpHandler(options: ArenaHttpOptions): (
  request: IncomingMessage,
  response: ServerResponse,
  url: URL,
) => Promise<boolean> {
  if (options.cursorSecret.length < 16) {
    throw new Error('ARENA_CURSOR_SECRET_INVALID');
  }
  const now = options.now ?? Date.now;
  return async (request, response, url) => {
    const route = ROUTES.get(url.pathname);
    if (!route) return false;
    if (request.method !== 'GET') {
      drain(request);
      sendError(response, 405, 'METHOD_NOT_ALLOWED', 'GET 요청만 사용할 수 있습니다.', {
        allow: 'GET',
      });
      return true;
    }
    if (hasUnexpectedQuery(url, route)) {
      sendError(response, 400, 'ARENA_CURSOR_INVALID', '페이지 정보가 올바르지 않습니다.');
      return true;
    }

    const privateRoute = route === 'snapshot' || route === 'group';
    let profile: PublicProfile | null = null;
    if (privateRoute) {
      profile = await authenticate(request, response, options);
      if (!profile) return true;
    }

    if (!options.enabled()) {
      if (route === 'snapshot') {
        sendJson(response, 200, { enabled: false }, 'no-store');
      } else if (route === 'rewards') {
        sendJson(response, 200, { enabled: false, items: [] }, 'public, max-age=30');
      } else {
        sendJson(response, 200, {
          enabled: false,
          items: [],
          nextCursor: null,
        }, route === 'group' ? 'private, max-age=5' : 'public, max-age=30');
      }
      return true;
    }
    if (!options.service) {
      sendError(response, 503, 'ARENA_UNAVAILABLE', '포커 아레나를 불러올 수 없습니다.');
      return true;
    }

    try {
      const at = now();
      if (route === 'snapshot') {
        sendJson(response, 200, {
          enabled: true,
          ...options.service.getSnapshot(profile!.id, at),
        }, 'no-store');
        return true;
      }
      if (route === 'rewards') {
        sendJson(response, 200, {
          enabled: true,
          ...options.service.getRewards(at),
        }, 'public, max-age=30');
        return true;
      }
      if (route === 'group') {
        const board = options.service.getGroupLeaderboard(profile!.id, at);
        sendJson(response, 200, paginate(
          board.rows,
          url.searchParams.get('cursor'),
          'group',
          board.contextId,
          options.cursorSecret,
          at,
          {
            enabled: true,
            tier: board.tier,
            smallGroup: board.smallGroup,
            promotionGamesRequired: board.promotionGamesRequired,
          },
        ), 'private, max-age=5');
        return true;
      }
      const board = options.service.getGlobalLeaderboard(at);
      sendJson(response, 200, paginate(
        board.rows,
        url.searchParams.get('cursor'),
        'global',
        board.contextId,
        options.cursorSecret,
        at,
        {
          enabled: true,
          season: board.season,
        },
      ), 'public, max-age=30');
    } catch (error) {
      if (error instanceof CursorError) {
        sendError(response, 400, 'ARENA_CURSOR_INVALID', '페이지 정보가 만료되었거나 올바르지 않습니다.');
      } else {
        sendError(response, 500, 'INTERNAL_ERROR', '포커 아레나 정보를 불러오지 못했습니다.');
      }
    }
    return true;
  };
}

function paginate(
  rows: readonly ArenaHttpLeaderboardRow[],
  encodedCursor: string | null,
  scope: 'group' | 'global',
  contextId: string,
  secret: string,
  now: number,
  metadata: Record<string, unknown>,
): Record<string, unknown> {
  const offset = encodedCursor === null
    ? 0
    : decodeCursor(encodedCursor, scope, contextId, rows, secret, now);
  const page = rows.slice(offset, offset + PAGE_SIZE);
  const nextOffset = offset + page.length;
  const nextCursor = nextOffset < rows.length
    ? encodeCursor({
      v: CURSOR_VERSION,
      scope,
      contextId: cursorDigest(`context:${scope}:${contextId}`, secret),
      offset: nextOffset,
      anchor: cursorDigest(
        `anchor:${scope}:${contextId}:${page.at(-1)!.stableId}`,
        secret,
      ),
      expiresAt: now + CURSOR_TTL_MS,
    }, secret)
    : null;
  return {
    ...metadata,
    items: page.map(publicRow),
    nextCursor,
  };
}

function publicRow(row: ArenaHttpLeaderboardRow): Record<string, unknown> {
  return {
    alias: row.alias,
    avatarId: row.avatarId,
    cosmetics: row.cosmetics,
    place: row.place,
    score: row.score,
    matches: row.matches,
    tier: row.tier,
    ...(row.isSelf === undefined ? {} : { isSelf: row.isSelf }),
  };
}

interface CursorPayload {
  readonly v: number;
  readonly scope: string;
  readonly contextId: string;
  readonly offset: number;
  readonly anchor: string;
  readonly expiresAt: number;
}

class CursorError extends Error {}

function encodeCursor(payload: CursorPayload, secret: string): string {
  const data = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signature = sign(data, secret);
  return `${data}.${signature}`;
}

function decodeCursor(
  encoded: string,
  scope: string,
  contextId: string,
  rows: readonly ArenaHttpLeaderboardRow[],
  secret: string,
  now: number,
): number {
  const parts = encoded.split('.');
  if (parts.length !== 2 || !parts[0] || !parts[1]) throw new CursorError();
  const expected = Buffer.from(sign(parts[0], secret));
  const actual = Buffer.from(parts[1]);
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
    throw new CursorError();
  }
  let value: unknown;
  try {
    value = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8'));
  } catch {
    throw new CursorError();
  }
  if (!isCursorPayload(value)) throw new CursorError();
  if (
    value.v !== CURSOR_VERSION
    || value.scope !== scope
    || value.contextId !== cursorDigest(`context:${scope}:${contextId}`, secret)
    || value.expiresAt <= now
    || value.offset < 1
    || value.offset > rows.length
    || cursorDigest(
      `anchor:${scope}:${contextId}:${rows[value.offset - 1]?.stableId ?? ''}`,
      secret,
    ) !== value.anchor
  ) throw new CursorError();
  return value.offset;
}

function sign(data: string, secret: string): string {
  return createHmac('sha256', secret).update(data).digest('base64url');
}

function cursorDigest(value: string, secret: string): string {
  return createHmac('sha256', secret).update(value).digest('base64url');
}

function isCursorPayload(value: unknown): value is CursorPayload {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const cursor = value as Partial<CursorPayload>;
  return Object.keys(cursor).length === 6
    && Number.isSafeInteger(cursor.v)
    && typeof cursor.scope === 'string'
    && typeof cursor.contextId === 'string'
    && Number.isSafeInteger(cursor.offset)
    && typeof cursor.anchor === 'string'
    && Number.isSafeInteger(cursor.expiresAt);
}

function hasUnexpectedQuery(url: URL, route: Route): boolean {
  const entries = [...url.searchParams.keys()];
  if (route === 'snapshot' || route === 'rewards') return entries.length !== 0;
  return entries.some(key => key !== 'cursor')
    || url.searchParams.getAll('cursor').length > 1;
}

async function authenticate(
  request: IncomingMessage,
  response: ServerResponse,
  options: ArenaHttpOptions,
): Promise<PublicProfile | null> {
  const credential = readProfileCredentialCookie(request.headers.cookie);
  const profile = credential
    ? await options.manager.authenticateCredential(credential)
    : null;
  if (profile) return profile;
  sendError(response, 401, 'PROFILE_AUTH_INVALID', '프로필 인증 정보가 유효하지 않습니다.', {
    'set-cookie': `${PROFILE_COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${
      options.production ? '; Secure' : ''
    }`,
  });
  return null;
}

function drain(request: IncomingMessage): void {
  request.on('error', () => undefined);
  request.resume();
}

function sendJson(
  response: ServerResponse,
  status: number,
  body: unknown,
  cacheControl = 'no-store',
  headers: Record<string, string> = {},
): void {
  if (response.writableEnded) return;
  response.writeHead(status, {
    'cache-control': cacheControl,
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
  sendJson(response, status, { error: { code, message } }, 'no-store', headers);
}
