import { ARENA_CONFIG_V1, ARENA_TIERS } from '@/lib/arena/config';
import { calculateMmrDelta } from '@/lib/arena/mmr';
import {
  pointsForPlace,
  rankWeeklyStandings,
  selectWeeklyMoves,
  softResetMmr,
  softResetTier,
  tierForPlacementTotal,
} from '@/lib/arena/rules';
import type { ArenaTier } from '@/lib/arena/types';
import {
  getArenaSeasonRewardItems,
  type ArenaSeasonRewardKey,
} from '@/lib/collection/catalog';
import type {
  ArenaEntryRecord,
  ArenaGroupMemberRecord,
  ArenaGroupRecord,
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

export interface ArenaPublicResultView {
  readonly placementGames: number;
  readonly placementMatches: number;
  readonly tier: ArenaTier | null;
  readonly weeklyRank: number | null;
}

export interface ArenaMatchResultView extends ArenaPublicResultView {
  readonly weeklyRankBefore: number | null;
  readonly weeklyRankAfter: number | null;
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
    const window = this.reconcile(at);
    return this.#repository.transaction(tx => {
      this.#ensureSeason(tx, window, at);
      this.#ensureProfile(tx, window, profileId, at);
      const snapshot = this.#repository.getPublicSnapshot(window.id, profileId);
      if (!snapshot) fail('ARENA_PERSISTENCE_INVALID');
      return snapshot;
    });
  }

  getPublicResultView(
    profileId: string,
    at = this.#clock(),
  ): ArenaPublicResultView {
    const snapshot = this.getSnapshot(profileId, at);
    const window = calculateArenaSeasonWindow(at, this.#config);
    const member = this.#repository.findGroupMember(
      window.id,
      getArenaKstWeekKey(at),
      profileId,
    );
    const ranked = member
      ? rankWeeklyStandings(this.#repository.listGroupMembers(member.groupId))
      : [];
    const index = ranked.findIndex(row => row.profileId === profileId);
    return {
      placementGames: snapshot.profile.placementGames,
      placementMatches: ARENA_CONFIG_V1.placementMatches,
      tier: snapshot.profile.tier,
      weeklyRank: index < 0 ? null : index + 1,
    };
  }

  getPublicResultViewForMatch(
    matchId: string,
    profileId: string,
  ): ArenaMatchResultView {
    const match = this.#repository.findMatch(matchId);
    if (!match || match.status !== 'finished' || match.finishedAt === null) {
      fail('ARENA_RESULT_INVALID');
    }
    const profile = this.#repository.requireProfile(
      match.seasonId,
      profileId,
    );
    const entry = this.#repository.listMatchEntries(match.id)
      .find(candidate => candidate.profileId === profileId);
    if (!entry?.resultKey || entry.settledAt === null) {
      fail('ARENA_RESULT_INVALID');
    }
    return {
      placementGames: profile.placementGames,
      placementMatches: ARENA_CONFIG_V1.placementMatches,
      tier: profile.tier,
      weeklyRank: entry.weeklyRankAfter,
      weeklyRankBefore: entry.weeklyRankBefore,
      weeklyRankAfter: entry.weeklyRankAfter,
    };
  }

  getMatchmakingProfile(profileId: string, at = this.#clock()): {
    seasonId: string;
    availableTickets: number;
    mmr: number;
    activeArenaEscrow: boolean;
  } {
    const window = this.reconcile(at);
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
    const currentWeekKey = getArenaKstWeekKey(at);
    const groups = this.#repository.listOpenGroupsBeforeWeek(currentWeekKey);
    for (const group of groups) this.#settleWeeklyGroup(group.id, at);
    while (true) {
      const endedSeasons =
        this.#repository.listUnsettledSeasonsEndingAtOrBefore(at);
      if (endedSeasons.length === 0) break;
      for (const season of endedSeasons) this.#settleSeason(season, at);
    }
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
    this.#settleDueWeeklyGroupsBeforeOfficialResult(
      matchId,
      results,
      at,
    );
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
      const completionWeekKey = weeklyCompletionKey(
        match.seasonId,
        at,
        this.#config,
      );
      const weeklyRankFor = (profileId: string): number | null => {
        if (completionWeekKey === null) return null;
        const member = this.#repository.findGroupMember(
          match.seasonId,
          completionWeekKey,
          profileId,
        );
        if (!member) return null;
        const ranked = rankWeeklyStandings(
          this.#repository.listGroupMembers(member.groupId),
        );
        const index = ranked.findIndex(row => row.profileId === profileId);
        return index < 0 ? null : index + 1;
      };
      const weeklyRanksBefore = new Map(entries.map(entry => [
        entry.profileId,
        weeklyRankFor(entry.profileId),
      ] as const));
      const settledEntries: ArenaEntryRecord[] = [];

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

        settledEntries.push({
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
        if (wasPlaced && completionWeekKey !== null) {
          const member = this.#assignWeeklyGroup(
            tx,
            profile,
            completionWeekKey,
            at,
          );
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
      for (const settled of settledEntries) {
        tx.updateEntry({
          ...settled,
          weeklyRankBefore: weeklyRanksBefore.get(settled.profileId) ?? null,
          weeklyRankAfter: weeklyRankFor(settled.profileId),
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
    const requestedWindow = calculateArenaSeasonWindow(at, this.#config);
    if (
      expectedSeasonId !== undefined
      && expectedSeasonId !== requestedWindow.id
    ) {
      fail('ARENA_SEASON_MISMATCH');
    }
    const window = this.reconcile(at);

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
          weeklyRankBefore: null,
          weeklyRankAfter: null,
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

  #settleDueWeeklyGroupsBeforeOfficialResult(
    matchId: string,
    results: readonly ArenaOfficialResult[],
    at: number,
  ): void {
    const match = this.#repository.findMatch(matchId);
    if (!match) fail('ARENA_MATCH_EXISTS');
    if (match.status === 'finished') return;
    const entries = this.#repository.listMatchEntries(match.id);
    if (
      match.status !== 'playing'
      || entries.length !== match.humanCount
      || match.startedAt === null
    ) fail('ARENA_RESULT_INVALID');
    validateOfficialResults(results, entries, match.botCount);
    const completionWeekKey = weeklyCompletionKey(
      match.seasonId,
      at,
      this.#config,
    );
    if (completionWeekKey === null) return;

    const placedProfileIds: string[] = [];
    for (const entry of entries) {
      const profile = this.#repository.requireProfile(
        match.seasonId,
        entry.profileId,
      );
      if (profile.mmr !== entry.mmrBefore) {
        fail('ARENA_PERSISTENCE_INVALID');
      }
      const escrow = this.#repository.requireTicketEscrow(
        match.id,
        entry.profileId,
      );
      if (escrow.status !== 'escrow') fail('ARENA_TICKET_TERMINAL');
      if (profile.placementGames === ARENA_CONFIG_V1.placementMatches) {
        placedProfileIds.push(profile.profileId);
      }
    }
    const groups = this.#repository.listOpenGroupsBeforeWeekForProfiles(
      match.seasonId,
      completionWeekKey,
      placedProfileIds,
    );
    for (const group of groups) this.#settleWeeklyGroup(group.id, at);
  }

  #assignWeeklyGroup(
    tx: ArenaTransaction,
    profile: ArenaProfileRecord,
    weekKey: string,
    at: number,
  ): ArenaGroupMemberRecord {
    if (
      profile.placementGames !== ARENA_CONFIG_V1.placementMatches
      || profile.tier === null
    ) fail('ARENA_PERSISTENCE_INVALID');
    const existingMember = this.#repository.findGroupMember(
      profile.seasonId,
      weekKey,
      profile.profileId,
    );
    if (existingMember) {
      const existingGroup = this.#repository.requireGroup(
        existingMember.groupId,
      );
      if (
        existingGroup.seasonId !== profile.seasonId
        || existingGroup.weekKey !== weekKey
        || existingGroup.tier !== profile.tier
        || existingGroup.status !== 'open'
      ) fail('ARENA_PERSISTENCE_INVALID');
      return existingMember;
    }

    const group = profile.tier === 'master'
      ? this.#ensureMasterGroup(tx, profile.seasonId, weekKey, at)
      : this.#ensureCappedGroup(
        tx,
        profile.seasonId,
        weekKey,
        profile.tier,
        at,
      );
    tx.insertGroupMember({
      groupId: group.id,
      seasonId: profile.seasonId,
      weekKey,
      profileId: profile.profileId,
      points: 0,
      wins: 0,
      top3: 0,
      placeSum: 0,
      matches: 0,
      scoreReachedAt: at,
      joinedAt: at,
      updatedAt: at,
    });
    const member = this.#repository.findGroupMember(
      profile.seasonId,
      weekKey,
      profile.profileId,
    );
    if (!member || member.groupId !== group.id) {
      fail('ARENA_PERSISTENCE_INVALID');
    }
    return member;
  }

  #ensureMasterGroup(
    tx: ArenaTransaction,
    seasonId: string,
    weekKey: string,
    at: number,
  ): ArenaGroupRecord {
    const groupId = `master-global:${seasonId}:${weekKey}`;
    const existing = this.#repository.findGroup(groupId);
    if (existing) {
      if (
        existing.seasonId !== seasonId
        || existing.weekKey !== weekKey
        || existing.tier !== 'master'
        || existing.status !== 'open'
      ) fail('ARENA_PERSISTENCE_INVALID');
      return existing;
    }
    const group: ArenaGroupRecord = {
      id: groupId,
      seasonId,
      weekKey,
      tier: 'master',
      status: 'open',
      createdAt: at,
      settledAt: null,
    };
    tx.insertGroup(group);
    return group;
  }

  #ensureCappedGroup(
    tx: ArenaTransaction,
    seasonId: string,
    weekKey: string,
    tier: Exclude<ArenaTier, 'master'>,
    at: number,
  ): ArenaGroupRecord {
    const oldest = this.#repository.findOldestOpenGroupBelowMemberCount(
      seasonId,
      weekKey,
      tier,
      ARENA_CONFIG_V1.targetGroupMax,
    );
    if (oldest) return oldest;

    const prefix = `weekly:${seasonId}:${weekKey}:${tier}:`;
    let ordinal = 1;
    let groupId = `${prefix}${ordinal}`;
    while (this.#repository.findGroup(groupId)) {
      ordinal += 1;
      if (!Number.isSafeInteger(ordinal)) fail('ARENA_PERSISTENCE_INVALID');
      groupId = `${prefix}${ordinal}`;
    }
    const group: ArenaGroupRecord = {
      id: groupId,
      seasonId,
      weekKey,
      tier,
      status: 'open',
      createdAt: at,
      settledAt: null,
    };
    tx.insertGroup(group);
    return group;
  }

  #settleWeeklyGroup(groupId: string, at: number): void {
    this.#repository.transaction(tx => {
      const group = this.#repository.requireGroup(groupId);
      const marker = this.#repository.findWeeklySettlement(
        group.seasonId,
        group.weekKey,
        group.id,
      );
      if (marker) return;
      if (group.status !== 'open' || group.settledAt !== null) {
        fail('ARENA_PERSISTENCE_INVALID');
      }
      const members = this.#repository.listGroupMembers(group.id);
      const moves = selectWeeklyMoves(group.tier, members);
      const movedIds = [
        ...moves.promotedProfileIds,
        ...moves.demotedProfileIds,
      ];
      if (new Set(movedIds).size !== movedIds.length) {
        fail('ARENA_PERSISTENCE_INVALID');
      }

      const profiles = new Map(members.map(member => {
        const profile = this.#repository.requireProfile(
          group.seasonId,
          member.profileId,
        );
        if (
          profile.placementGames !== ARENA_CONFIG_V1.placementMatches
          || profile.tier !== group.tier
        ) fail('ARENA_PERSISTENCE_INVALID');
        return [member.profileId, profile] as const;
      }));
      for (const profileId of moves.promotedProfileIds) {
        const profile = profiles.get(profileId);
        if (!profile) fail('ARENA_PERSISTENCE_INVALID');
        tx.updateProfile({
          ...profile,
          tier: adjacentTier(group.tier, 1),
          updatedAt: Math.max(profile.updatedAt, at),
        });
      }
      for (const profileId of moves.demotedProfileIds) {
        const profile = profiles.get(profileId);
        if (!profile) fail('ARENA_PERSISTENCE_INVALID');
        tx.updateProfile({
          ...profile,
          tier: adjacentTier(group.tier, -1),
          updatedAt: Math.max(profile.updatedAt, at),
        });
      }
      tx.updateGroup({
        ...group,
        status: 'settled',
        settledAt: at,
      });
      tx.insertWeeklySettlement({
        seasonId: group.seasonId,
        weekKey: group.weekKey,
        groupId: group.id,
        settledAt: at,
      });
    });
  }

  #settleSeason(season: ArenaSeasonRecord, at: number): void {
    this.#repository.transaction(tx => {
      if (this.#repository.findSeasonSettlement(season.id)) return;
      if (
        this.#repository.listUnfinishedMatchesForSeason(season.id).length > 0
      ) fail('ARENA_PERSISTENCE_INVALID');
      const sourceDefinitions = this.#ensureSeasonCatalog(tx, season.id);
      const nextWindow = calculateArenaSeasonWindow(
        season.endsAt,
        this.#config,
      );
      if (nextWindow.ordinal !== season.ordinal + 1) {
        fail('ARENA_PERSISTENCE_INVALID');
      }
      this.#ensureSeason(tx, nextWindow, at);
      const standings = this.#repository.listSeasonStandings(season.id);
      const profiles = this.#repository.listSeasonProfiles(season.id);
      const profileById = new Map(
        profiles.map(profile => [profile.profileId, profile] as const),
      );
      const rewards = new Map(
        sourceDefinitions.map(reward => [
          reward.source.rewardKey,
          reward,
        ] as const),
      );

      for (const [index, standing] of standings.entries()) {
        const finalRank = index + 1;
        const profile = profileById.get(standing.profileId);
        if (!profile || profile.tier !== standing.finalTier) {
          fail('ARENA_PERSISTENCE_INVALID');
        }
        tx.insertSeasonResult({
          ...standing,
          seasonId: season.id,
          finalRank,
          settledAt: at,
        });
        for (const rewardKey of seasonRewardKeys(
          season,
          standing.finalTier,
          standing.matches,
          finalRank,
        )) {
          const reward = rewards.get(rewardKey);
          if (!reward) fail('ARENA_PERSISTENCE_INVALID');
          tx.insertSeasonReward({
            seasonId: season.id,
            profileId: standing.profileId,
            itemId: reward.id,
            grantedAt: at,
          });
        }
      }

      if (!season.preseason && standings.length > 0) {
        const champion = standings[0];
        tx.insertHallOfFame({
          seasonId: season.id,
          profileId: champion.profileId,
          finalRank: 1,
          trophyItemId: `${season.id}-champion-trophy`,
          auraItemId: `${season.id}-champion-aura`,
          recordedAt: at,
        });
      }

      const nextDate = getArenaKstDate(nextWindow.startsAt);
      for (const profile of profiles) {
        tx.insertProfileIfAbsent({
          seasonId: nextWindow.id,
          profileId: profile.profileId,
          availableTickets: ARENA_CONFIG_V1.startingTickets,
          lastDailyGrantDate: nextDate,
          placementGames: ARENA_CONFIG_V1.placementMatches,
          placementPoints: 0,
          tier: softResetTier(profile.tier ?? 'bronze'),
          mmr: softResetMmr(profile.mmr),
          createdAt: at,
          updatedAt: at,
        });
        const reset = this.#repository.requireProfile(
          nextWindow.id,
          profile.profileId,
        );
        if (
          reset.placementGames !== ARENA_CONFIG_V1.placementMatches
          || reset.placementPoints !== 0
          || reset.tier !== softResetTier(profile.tier ?? 'bronze')
          || reset.mmr !== softResetMmr(profile.mmr)
        ) fail('ARENA_PERSISTENCE_INVALID');
      }
      tx.insertSeasonSettlement({
        seasonId: season.id,
        nextSeasonId: nextWindow.id,
        participantCount: standings.length,
        settledAt: at,
      });
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
    this.#ensureSeasonCatalog(tx, window.id);
    return season;
  }

  #ensureSeasonCatalog(
    tx: ArenaTransaction,
    seasonId: string,
  ): ReturnType<typeof getArenaSeasonRewardItems> {
    const definitions = getArenaSeasonRewardItems(seasonId);
    for (const definition of definitions) {
      tx.insertSeasonCatalogIfAbsent({
        seasonId,
        itemId: definition.id,
        rewardKey: definition.source.rewardKey,
        kind: definition.kind,
        equipSlot: definition.equipSlot,
        characterId: definition.characterId ?? null,
      });
    }
    const storedCatalog = this.#repository.listSeasonCatalog(seasonId);
    if (
      storedCatalog.length !== definitions.length
      || storedCatalog.some(stored => {
        const definition = definitions.find(item => item.id === stored.itemId);
        return !definition
          || stored.rewardKey !== definition.source.rewardKey
          || stored.kind !== definition.kind
          || stored.equipSlot !== definition.equipSlot
          || stored.characterId !== (definition.characterId ?? null);
      })
    ) fail('ARENA_PERSISTENCE_INVALID');
    return definitions;
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

function adjacentTier(tier: ArenaTier, direction: -1 | 1): ArenaTier {
  const index = ARENA_TIERS.indexOf(tier);
  const next = ARENA_TIERS[index + direction];
  if (!next) fail('ARENA_PERSISTENCE_INVALID');
  return next;
}

function seasonRewardKeys(
  season: ArenaSeasonRecord,
  finalTier: ArenaTier | null,
  matches: number,
  finalRank: number,
): ArenaSeasonRewardKey[] {
  const rewardKeys: ArenaSeasonRewardKey[] = [];
  if (matches >= 10) rewardKeys.push('participation-emblem');
  if (season.preseason) return rewardKeys;

  const tierIndex = finalTier === null ? -1 : ARENA_TIERS.indexOf(finalTier);
  if (tierIndex >= ARENA_TIERS.indexOf('gold')) {
    rewardKeys.push('gold-frame');
  }
  if (tierIndex >= ARENA_TIERS.indexOf('diamond')) {
    rewardKeys.push('diamond-featured-skin');
  }
  if (finalTier === 'master') rewardKeys.push('master-cutin');
  if (finalRank <= 100) {
    rewardKeys.push('top100-chroma', 'top100-title');
  }
  if (finalRank <= 10) {
    rewardKeys.push(
      `rank-${finalRank}-title` as ArenaSeasonRewardKey,
    );
  }
  if (finalRank === 1) {
    rewardKeys.push('champion-trophy', 'champion-aura');
  }
  return rewardKeys;
}

function weeklyCompletionKey(
  reservedSeasonId: string,
  completedAt: number,
  config: ArenaSeasonConfig,
): string | null {
  const completionSeason = calculateArenaSeasonWindow(completedAt, config);
  // The reserved season still owns the result/MMR/ticket settlement. Season
  // transition owns the next-season reset, so a cross-season match cannot
  // create a group under the closed season or an uninitialized new profile.
  return completionSeason.id === reservedSeasonId
    ? getArenaKstWeekKey(completedAt)
    : null;
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
