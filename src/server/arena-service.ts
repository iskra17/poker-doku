import { ARENA_CONFIG_V1 } from '@/lib/arena/config';
import { calculateMmrDelta } from '@/lib/arena/mmr';
import { pointsForPlace, tierForPlacementTotal } from '@/lib/arena/rules';
import type {
  ArenaEntryRecord,
  ArenaMatchRecord,
  ArenaProfileRecord,
  ArenaSeasonRecord,
  ArenaTransaction,
  PublicArenaSnapshot,
} from './arena-repository';
import { ArenaRepository } from './arena-repository';

const KST_OFFSET_MS = 9 * 60 * 60 * 1_000;
const DAY_MS = 24 * 60 * 60 * 1_000;
const WEEK_MS = 7 * DAY_MS;
const SEASON_MS = ARENA_CONFIG_V1.seasonWeeks * WEEK_MS;
const MAX_TIMESTAMP = 253_402_300_799_999;

export const DEFAULT_ARENA_SEASON_EPOCH_KST =
  '2026-07-20T00:00:00+09:00';

export type ArenaDomainErrorCode =
  | 'ARENA_ENABLED_INVALID'
  | 'ARENA_SEASON_EPOCH_REQUIRED'
  | 'ARENA_SEASON_EPOCH_INVALID'
  | 'ARENA_PRESEASON_COUNT_INVALID'
  | 'ARENA_TIME_INVALID'
  | 'ARENA_SEASON_NOT_STARTED'
  | 'ARENA_SEASON_MISMATCH'
  | 'ARENA_PROFILE_LIST_INVALID'
  | 'ARENA_MATCH_EXISTS'
  | 'ARENA_TICKET_INSUFFICIENT'
  | 'ARENA_TICKET_ALREADY_ESCROWED'
  | 'ARENA_NON_ARENA_SEAT_ACTIVE'
  | 'ARENA_TICKET_TERMINAL'
  | 'ARENA_RESULT_INVALID'
  | 'ARENA_PERSISTENCE_INVALID';

export class ArenaDomainError extends Error {
  constructor(readonly code: ArenaDomainErrorCode) {
    super(code);
    this.name = 'ArenaDomainError';
  }
}

export interface ArenaSeasonConfig {
  readonly epochMs: number;
  readonly preseasonCount: number;
}

export interface ArenaServiceOptions extends ArenaSeasonConfig {
  readonly clock?: () => number;
  readonly isProfileInNonArenaSeat: (profileId: string) => boolean;
}

export interface ArenaSeasonWindow {
  readonly id: string;
  readonly ordinal: number;
  readonly preseason: boolean;
  readonly startsAt: number;
  readonly endsAt: number;
  readonly week: 1 | 2 | 3 | 4;
}

export interface ArenaOfficialResult {
  readonly playerId: string;
  readonly place: number;
  readonly type: 'human' | 'bot';
}

export interface ArenaOfficialSummary {
  readonly matchId: string;
  readonly finishedAt: number;
  readonly results: readonly {
    readonly profileId: string;
    readonly place: number;
    readonly points: number;
  }[];
}

export type ArenaRuntimeConfig =
  | { readonly enabled: false }
  | ({ readonly enabled: true } & ArenaSeasonConfig);

export function parseArenaRuntimeConfig(
  environment: Readonly<Record<string, string | undefined>>,
): ArenaRuntimeConfig {
  const enabledText = environment.ARENA_ENABLED ?? 'false';
  if (enabledText !== 'true' && enabledText !== 'false') {
    fail('ARENA_ENABLED_INVALID');
  }
  if (enabledText === 'false') return { enabled: false };

  const epochText = environment.ARENA_SEASON_EPOCH_KST;
  if (epochText === undefined) fail('ARENA_SEASON_EPOCH_REQUIRED');
  const epochMs = parseSeasonEpoch(epochText);
  const preseasonText = environment.ARENA_PRESEASON_COUNT ?? '1';
  if (!/^(0|[1-9]\d*)$/.test(preseasonText)) {
    fail('ARENA_PRESEASON_COUNT_INVALID');
  }
  const preseasonCount = Number(preseasonText);
  if (!Number.isSafeInteger(preseasonCount)) {
    fail('ARENA_PRESEASON_COUNT_INVALID');
  }
  return { enabled: true, epochMs, preseasonCount };
}

export function calculateArenaSeasonWindow(
  at: number,
  config: ArenaSeasonConfig,
): ArenaSeasonWindow {
  assertTimestamp(at);
  assertSeasonConfig(config);
  if (at < config.epochMs) fail('ARENA_SEASON_NOT_STARTED');
  const ordinal = Math.floor((at - config.epochMs) / SEASON_MS);
  const seasonOffset = ordinal * SEASON_MS;
  if (!Number.isSafeInteger(seasonOffset)) fail('ARENA_TIME_INVALID');
  const startsAt = safeTimestampAdd(
    config.epochMs,
    seasonOffset,
    'ARENA_TIME_INVALID',
  );
  const endsAt = safeTimestampAdd(
    startsAt,
    SEASON_MS,
    'ARENA_TIME_INVALID',
  );
  if (
    !Number.isSafeInteger(ordinal)
    || ordinal < 0
    || !validTimestamp(startsAt)
    || !validTimestamp(endsAt)
  ) {
    fail('ARENA_TIME_INVALID');
  }
  const week = Math.floor((at - startsAt) / WEEK_MS) + 1;
  if (week < 1 || week > 4) fail('ARENA_TIME_INVALID');
  return {
    id: `arena-v1-${ordinal}`,
    ordinal,
    preseason: ordinal < config.preseasonCount,
    startsAt,
    endsAt,
    week: week as 1 | 2 | 3 | 4,
  };
}

export function getArenaKstDate(at: number): string {
  assertTimestamp(at);
  const shiftedAt = at + KST_OFFSET_MS;
  if (!validTimestamp(shiftedAt)) fail('ARENA_TIME_INVALID');
  const shifted = new Date(shiftedAt);
  const year = shifted.getUTCFullYear();
  if (year < 1 || year > 9_999) fail('ARENA_TIME_INVALID');
  return [year, shifted.getUTCMonth() + 1, shifted.getUTCDate()]
    .map((value, index) => index === 0
      ? String(value).padStart(4, '0')
      : String(value).padStart(2, '0'))
    .join('-');
}

export function getArenaKstWeekKey(at: number): string {
  assertTimestamp(at);
  const shiftedAt = at + KST_OFFSET_MS;
  if (!validTimestamp(shiftedAt)) fail('ARENA_TIME_INVALID');
  const local = new Date(shiftedAt);
  const date = new Date(Date.UTC(
    local.getUTCFullYear(),
    local.getUTCMonth(),
    local.getUTCDate(),
  ));
  const day = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - day);
  const weekYear = date.getUTCFullYear();
  const yearStart = new Date(Date.UTC(weekYear, 0, 1));
  const week = Math.ceil(
    (((date.getTime() - yearStart.getTime()) / DAY_MS) + 1) / 7,
  );
  if (
    weekYear < 1
    || weekYear > 9_999
    || !Number.isInteger(week)
    || week < 1
    || week > 53
  ) fail('ARENA_TIME_INVALID');
  return `${String(weekYear).padStart(4, '0')}-W${String(week).padStart(2, '0')}`;
}

export class ArenaService {
  readonly #repository: ArenaRepository;
  readonly #config: ArenaSeasonConfig;
  readonly #clock: () => number;
  readonly #isProfileInNonArenaSeat: (profileId: string) => boolean;

  constructor(repository: ArenaRepository, options: ArenaServiceOptions) {
    assertSeasonConfig(options);
    this.#repository = repository;
    this.#config = {
      epochMs: options.epochMs,
      preseasonCount: options.preseasonCount,
    };
    this.#clock = options.clock ?? Date.now;
    this.#isProfileInNonArenaSeat = options.isProfileInNonArenaSeat;
  }

  getSnapshot(profileId: string, at = this.#clock()): PublicArenaSnapshot {
    const window = calculateArenaSeasonWindow(at, this.#config);
    return this.#repository.transaction(tx => {
      this.#ensureSeason(tx, window, at);
      this.#ensureProfile(tx, window, profileId, at);
      const snapshot = this.#repository.getPublicSnapshot(window.id, profileId);
      if (!snapshot) fail('ARENA_PERSISTENCE_INVALID');
      return snapshot;
    });
  }

  getMatchmakingProfile(profileId: string, at = this.#clock()): {
    seasonId: string;
    availableTickets: number;
    mmr: number;
    activeArenaEscrow: boolean;
  } {
    const window = calculateArenaSeasonWindow(at, this.#config);
    return this.#repository.transaction(tx => {
      this.#ensureSeason(tx, window, at);
      const profile = this.#ensureProfile(tx, window, profileId, at);
      return {
        seasonId: window.id,
        availableTickets: profile.availableTickets,
        mmr: profile.mmr,
        activeArenaEscrow:
          this.#repository.findActiveTicketEscrow(profileId) !== null,
      };
    });
  }

  reconcile(at = this.#clock()): ArenaSeasonWindow {
    const window = calculateArenaSeasonWindow(at, this.#config);
    this.#repository.transaction(tx => this.#ensureSeason(tx, window, at));
    return window;
  }

  getReservedMatch(matchId: string): {
    match: ArenaMatchRecord;
    entries: ArenaEntryRecord[];
  } {
    assertIdentifier(matchId, 'ARENA_MATCH_EXISTS');
    const match = this.#repository.findMatch(matchId);
    if (!match) fail('ARENA_MATCH_EXISTS');
    const entries = this.#repository.listMatchEntries(matchId);
    if (
      entries.length !== match.humanCount
      || entries.some(entry => entry.matchId !== match.id)
    ) fail('ARENA_PERSISTENCE_INVALID');
    return { match, entries };
  }

  markMatchPlaying(
    matchId: string,
    at = this.#clock(),
  ): ArenaMatchRecord {
    assertIdentifier(matchId, 'ARENA_MATCH_EXISTS');
    assertTimestamp(at);
    return this.#repository.transaction(tx => {
      const match = this.#repository.findMatch(matchId);
      if (!match) fail('ARENA_MATCH_EXISTS');
      if (match.status === 'playing') return match;
      if (match.status !== 'forming') fail('ARENA_TICKET_TERMINAL');
      const playing: ArenaMatchRecord = {
        ...match,
        status: 'playing',
        startedAt: at,
      };
      tx.updateMatch(playing);
      return playing;
    });
  }

  recoverUnfinishedMatches(at = this.#clock()): string[] {
    assertTimestamp(at);
    const matchIds = this.#repository.listUnfinishedMatches()
      .map(match => match.id);
    for (const matchId of matchIds) this.voidMatch(matchId, at);
    return matchIds;
  }

  settleOfficialMatch(
    matchId: string,
    results: readonly ArenaOfficialResult[],
    at = this.#clock(),
  ): ArenaOfficialSummary {
    assertIdentifier(matchId, 'ARENA_RESULT_INVALID');
    assertTimestamp(at);
    return this.#repository.transaction(tx => {
      const match = this.#repository.findMatch(matchId);
      if (!match) fail('ARENA_MATCH_EXISTS');
      const entries = this.#repository.listMatchEntries(matchId);
      if (match.status === 'finished') {
        return this.#settledSummary(match, entries);
      }
      if (
        match.status !== 'playing'
        || entries.length !== match.humanCount
        || match.startedAt === null
      ) fail('ARENA_RESULT_INVALID');
      const places = validateOfficialResults(
        results,
        entries,
        match.botCount,
      );
      const botMmrs = Array.from(
        { length: match.botCount },
        () => match.botMmr,
      );
      const weekKey = getArenaKstWeekKey(match.startedAt);

      for (const entry of entries) {
        const place = places.get(entry.profileId);
        if (place === undefined) fail('ARENA_RESULT_INVALID');
        const profile = this.#repository.requireProfile(
          match.seasonId,
          entry.profileId,
        );
        if (profile.mmr !== entry.mmrBefore) {
          fail('ARENA_PERSISTENCE_INVALID');
        }
        const opponentMmrs = [
          ...entries
            .filter(other => other.profileId !== entry.profileId)
            .map(other => other.mmrBefore),
          ...botMmrs,
        ];
        const mmrAfter = safeIntegerAdd(
          profile.mmr,
          calculateMmrDelta({
            playerMmr: profile.mmr,
            opponentMmrs,
            place,
            k: profile.placementGames < ARENA_CONFIG_V1.placementMatches
              ? ARENA_CONFIG_V1.placementMmrK
              : ARENA_CONFIG_V1.normalMmrK,
          }),
        );
        const points = pointsForPlace(place);
        const wasPlaced =
          profile.placementGames === ARENA_CONFIG_V1.placementMatches;
        const placementGames = wasPlaced
          ? profile.placementGames
          : profile.placementGames + 1;
        const placementPoints = wasPlaced
          ? profile.placementPoints
          : safeIntegerAdd(profile.placementPoints, points);
        const tier = placementGames === ARENA_CONFIG_V1.placementMatches
          ? (profile.tier ?? tierForPlacementTotal(placementPoints))
          : null;

        tx.updateEntry({
          ...entry,
          place,
          points,
          mmrAfter,
          resultKey: `${match.id}:${entry.profileId}`,
          settledAt: at,
        });
        tx.updateProfile({
          ...profile,
          placementGames,
          placementPoints,
          tier,
          mmr: mmrAfter,
          updatedAt: Math.max(profile.updatedAt, at),
        });
        if (wasPlaced) {
          const member = this.#repository.findGroupMember(
            match.seasonId,
            weekKey,
            entry.profileId,
          );
          if (member) {
            tx.updateGroupMember({
              ...member,
              points: safeIntegerAdd(member.points, points),
              wins: safeIntegerAdd(member.wins, place === 1 ? 1 : 0),
              top3: safeIntegerAdd(member.top3, place <= 3 ? 1 : 0),
              placeSum: safeIntegerAdd(member.placeSum, place),
              matches: safeIntegerAdd(member.matches, 1),
              scoreReachedAt: points === 0 ? member.scoreReachedAt : at,
              updatedAt: at,
            });
          }
        }
        const escrow = this.#repository.requireTicketEscrow(
          match.id,
          entry.profileId,
        );
        if (escrow.status !== 'escrow') fail('ARENA_TICKET_TERMINAL');
        tx.updateTicketEscrow({
          ...escrow,
          status: 'consumed',
          settledAt: at,
        });
      }
      const finished: ArenaMatchRecord = {
        ...match,
        status: 'finished',
        finishedAt: at,
      };
      tx.updateMatch(finished);
      return this.#settledSummary(
        finished,
        this.#repository.listMatchEntries(match.id),
      );
    });
  }

  reserveMatchTickets(
    matchId: string,
    profileIds: readonly string[],
    at = this.#clock(),
    expectedSeasonId?: string,
  ): ArenaMatchRecord {
    assertMatchRequest(matchId, profileIds);
    const window = calculateArenaSeasonWindow(at, this.#config);
    if (expectedSeasonId !== undefined && expectedSeasonId !== window.id) {
      fail('ARENA_SEASON_MISMATCH');
    }

    return this.#repository.transaction(tx => {
      for (const profileId of profileIds) {
        if (this.#isProfileInNonArenaSeat(profileId)) {
          fail('ARENA_NON_ARENA_SEAT_ACTIVE');
        }
      }
      this.#ensureSeason(tx, window, at);
      if (this.#repository.findMatch(matchId)) fail('ARENA_MATCH_EXISTS');
      const profiles = profileIds.map(profileId =>
        this.#ensureProfile(tx, window, profileId, at),
      );
      for (const profile of profiles) {
        if (this.#repository.findActiveTicketEscrow(profile.profileId)) {
          fail('ARENA_TICKET_ALREADY_ESCROWED');
        }
        if (profile.availableTickets < 1) fail('ARENA_TICKET_INSUFFICIENT');
      }

      const match: ArenaMatchRecord = {
        id: matchId,
        seasonId: window.id,
        configVersion: ARENA_CONFIG_V1.version,
        botVersion: ARENA_CONFIG_V1.botVersion,
        botMmr: snapshotBotMmr(profiles),
        humanCount: profiles.length,
        botCount: ARENA_CONFIG_V1.seats - profiles.length,
        status: 'forming',
        createdAt: at,
        startedAt: null,
        finishedAt: null,
      };
      tx.insertMatch(match);
      for (const profile of profiles) {
        tx.updateProfile({
          ...profile,
          availableTickets: profile.availableTickets - 1,
          updatedAt: Math.max(profile.updatedAt, at),
        });
        tx.insertEntry({
          matchId,
          profileId: profile.profileId,
          place: null,
          points: null,
          mmrBefore: profile.mmr,
          mmrAfter: null,
          resultKey: null,
          createdAt: at,
          settledAt: null,
        });
        tx.insertTicketEscrow({
          matchId,
          profileId: profile.profileId,
          status: 'escrow',
          createdAt: at,
          settledAt: null,
        });
      }
      return match;
    });
  }

  voidMatch(matchId: string, at = this.#clock()): ArenaMatchRecord {
    assertIdentifier(matchId, 'ARENA_MATCH_EXISTS');
    assertTimestamp(at);
    return this.#repository.transaction(tx => {
      const match = this.#repository.findMatch(matchId);
      if (!match) fail('ARENA_MATCH_EXISTS');
      const escrows = this.#escrowsForMatch(matchId);
      if (
        match.status === 'void'
        && escrows.every(escrow => escrow.status === 'refunded')
      ) return match;
      if (
        match.status === 'finished'
        || escrows.some(escrow => escrow.status !== 'escrow')
      ) fail('ARENA_TICKET_TERMINAL');

      const voided: ArenaMatchRecord = {
        ...match,
        status: 'void',
        finishedAt: at,
      };
      tx.updateMatch(voided);
      for (const escrow of escrows) {
        const profile = this.#repository.requireProfile(
          match.seasonId,
          escrow.profileId,
        );
        tx.updateProfile({
          ...profile,
          availableTickets: Math.min(
            ARENA_CONFIG_V1.ticketCap,
            profile.availableTickets + 1,
          ),
          updatedAt: Math.max(profile.updatedAt, at),
        });
        tx.updateTicketEscrow({ ...escrow, status: 'refunded', settledAt: at });
      }
      return voided;
    });
  }

  #ensureSeason(
    tx: ArenaTransaction,
    window: ArenaSeasonWindow,
    at: number,
  ): ArenaSeasonRecord {
    tx.insertSeasonIfAbsent({
      id: window.id,
      ordinal: window.ordinal,
      configVersion: ARENA_CONFIG_V1.version,
      preseason: window.preseason,
      startsAt: window.startsAt,
      endsAt: window.endsAt,
      createdAt: at,
    });
    const season = this.#repository.requireSeason(window.id);
    if (
      season.ordinal !== window.ordinal
      || season.configVersion !== ARENA_CONFIG_V1.version
      || season.preseason !== window.preseason
      || season.startsAt !== window.startsAt
      || season.endsAt !== window.endsAt
    ) fail('ARENA_PERSISTENCE_INVALID');
    return season;
  }

  #ensureProfile(
    tx: ArenaTransaction,
    window: ArenaSeasonWindow,
    profileId: string,
    at: number,
  ): ArenaProfileRecord {
    assertIdentifier(profileId, 'ARENA_PROFILE_LIST_INVALID');
    const today = getArenaKstDate(at);
    tx.insertProfileIfAbsent({
      seasonId: window.id,
      profileId,
      availableTickets: ARENA_CONFIG_V1.startingTickets,
      lastDailyGrantDate: today,
      placementGames: 0,
      placementPoints: 0,
      tier: null,
      mmr: ARENA_CONFIG_V1.initialMmr,
      createdAt: at,
      updatedAt: at,
    });
    const profile = this.#repository.requireProfile(window.id, profileId);
    if (profile.lastDailyGrantDate >= today) return profile;

    const activeEscrow = this.#repository.findActiveTicketEscrow(profileId);
    const total = profile.availableTickets + (activeEscrow ? 1 : 0);
    const grant = Math.min(
      ARENA_CONFIG_V1.dailyTickets,
      Math.max(0, ARENA_CONFIG_V1.ticketCap - total),
    );
    const updated: ArenaProfileRecord = {
      ...profile,
      availableTickets: profile.availableTickets + grant,
      lastDailyGrantDate: today,
      updatedAt: Math.max(profile.updatedAt, at),
    };
    tx.updateProfile(updated);
    return updated;
  }

  #escrowsForMatch(matchId: string) {
    const entries = this.#repository.listMatchEntries(matchId);
    if (entries.length < 2 || entries.length > ARENA_CONFIG_V1.seats) {
      fail('ARENA_PERSISTENCE_INVALID');
    }
    return entries.map(entry =>
      this.#repository.requireTicketEscrow(matchId, entry.profileId),
    );
  }

  #settledSummary(
    match: ArenaMatchRecord,
    entries: readonly ArenaEntryRecord[],
  ): ArenaOfficialSummary {
    for (const entry of entries) {
      const escrow = this.#repository.requireTicketEscrow(
        match.id,
        entry.profileId,
      );
      if (
        escrow.status !== 'consumed'
        || escrow.settledAt !== match.finishedAt
      ) fail('ARENA_PERSISTENCE_INVALID');
    }
    return settledSummary(match, entries);
  }
}

function parseSeasonEpoch(value: string): number {
  const match = /^(\d{4})-(\d{2})-(\d{2})T00:00:00\+09:00$/.exec(value);
  if (!match) fail('ARENA_SEASON_EPOCH_INVALID');
  const epochMs = Date.parse(value);
  if (!validTimestamp(epochMs)) fail('ARENA_SEASON_EPOCH_INVALID');
  const firstSeasonEnd = safeTimestampAdd(
    epochMs,
    SEASON_MS,
    'ARENA_SEASON_EPOCH_INVALID',
  );
  safeTimestampAdd(
    firstSeasonEnd,
    KST_OFFSET_MS,
    'ARENA_SEASON_EPOCH_INVALID',
  );
  const shifted = new Date(epochMs + KST_OFFSET_MS);
  if (
    shifted.getUTCFullYear() !== Number(match[1])
    || shifted.getUTCMonth() + 1 !== Number(match[2])
    || shifted.getUTCDate() !== Number(match[3])
    || shifted.getUTCDay() !== 1
  ) fail('ARENA_SEASON_EPOCH_INVALID');
  return epochMs;
}

function assertSeasonConfig(config: ArenaSeasonConfig): void {
  if (
    !validTimestamp(config.epochMs)
    || !Number.isSafeInteger(config.preseasonCount)
    || config.preseasonCount < 0
  ) fail('ARENA_SEASON_EPOCH_INVALID');
  const firstSeasonEnd = safeTimestampAdd(
    config.epochMs,
    SEASON_MS,
    'ARENA_SEASON_EPOCH_INVALID',
  );
  safeTimestampAdd(
    firstSeasonEnd,
    KST_OFFSET_MS,
    'ARENA_SEASON_EPOCH_INVALID',
  );
}

function assertMatchRequest(matchId: string, profileIds: readonly string[]): void {
  assertIdentifier(matchId, 'ARENA_PROFILE_LIST_INVALID');
  if (
    !Array.isArray(profileIds)
    || profileIds.length < ARENA_CONFIG_V1.minimumHumansForOfficial
    || profileIds.length > ARENA_CONFIG_V1.seats
  ) fail('ARENA_PROFILE_LIST_INVALID');
  const unique = new Set(profileIds);
  if (unique.size !== profileIds.length) fail('ARENA_PROFILE_LIST_INVALID');
  for (const profileId of profileIds) {
    assertIdentifier(profileId, 'ARENA_PROFILE_LIST_INVALID');
  }
}

function snapshotBotMmr(profiles: readonly ArenaProfileRecord[]): number {
  const average = profiles.reduce((total, profile) => total + profile.mmr, 0)
    / profiles.length;
  return Math.max(800, Math.min(1_400, Math.round(average / 50) * 50));
}

function validateOfficialResults(
  results: readonly ArenaOfficialResult[],
  entries: readonly ArenaEntryRecord[],
  expectedBotCount: number,
): Map<string, number> {
  if (!Array.isArray(results) || results.length !== ARENA_CONFIG_V1.seats) {
    fail('ARENA_RESULT_INVALID');
  }
  const playerIds = new Set<string>();
  const places = new Set<number>();
  const byPlayer = new Map<string, number>();
  const humanIds = new Set<string>();
  let botCount = 0;
  for (const result of results) {
    if (
      !result
      || typeof result.playerId !== 'string'
      || result.playerId.length === 0
      || !Number.isInteger(result.place)
      || result.place < 1
      || result.place > ARENA_CONFIG_V1.seats
      || (result.type !== 'human' && result.type !== 'bot')
      || playerIds.has(result.playerId)
      || places.has(result.place)
    ) fail('ARENA_RESULT_INVALID');
    playerIds.add(result.playerId);
    places.add(result.place);
    byPlayer.set(result.playerId, result.place);
    if (result.type === 'human') humanIds.add(result.playerId);
    else botCount += 1;
  }
  if (
    humanIds.size !== entries.length
    || botCount !== expectedBotCount
    || entries.some(entry => !humanIds.has(entry.profileId))
  ) fail('ARENA_RESULT_INVALID');
  return byPlayer;
}

function settledSummary(
  match: ArenaMatchRecord,
  entries: readonly ArenaEntryRecord[],
): ArenaOfficialSummary {
  if (
    match.status !== 'finished'
    || match.finishedAt === null
    || entries.length !== match.humanCount
    || entries.some(entry => (
      entry.place === null
      || entry.points === null
      || entry.resultKey === null
      || entry.mmrAfter === null
      || entry.settledAt !== match.finishedAt
    ))
  ) fail('ARENA_PERSISTENCE_INVALID');
  return {
    matchId: match.id,
    finishedAt: match.finishedAt,
    results: entries.map(entry => ({
      profileId: entry.profileId,
      place: entry.place as number,
      points: entry.points as number,
    })),
  };
}

function safeIntegerAdd(left: number, right: number): number {
  const result = left + right;
  if (!Number.isSafeInteger(result)) fail('ARENA_PERSISTENCE_INVALID');
  return result;
}

function assertIdentifier(value: string, code: ArenaDomainErrorCode): void {
  if (typeof value !== 'string' || value.length === 0) fail(code);
}

function assertTimestamp(value: number): void {
  if (!validTimestamp(value)) fail('ARENA_TIME_INVALID');
}

function validTimestamp(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0 && value <= MAX_TIMESTAMP;
}

function safeTimestampAdd(
  value: number,
  delta: number,
  code: ArenaDomainErrorCode,
): number {
  if (
    !validTimestamp(value)
    || !Number.isSafeInteger(delta)
    || delta < 0
    || value > MAX_TIMESTAMP - delta
  ) fail(code);
  const result = value + delta;
  if (!validTimestamp(result)) fail(code);
  return result;
}

function fail(code: ArenaDomainErrorCode): never {
  throw new ArenaDomainError(code);
}
