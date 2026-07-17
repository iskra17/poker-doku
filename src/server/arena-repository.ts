import type { ArenaTier } from '@/lib/arena/types';
import type { PokerDatabase } from './persistence/database';

const MAX_TIMESTAMP = 253_402_300_799_999;
const MAX_SAFE_INTEGER = 9_007_199_254_740_991;
const TIERS: readonly ArenaTier[] = [
  'bronze', 'silver', 'gold', 'platinum', 'diamond', 'master',
];
const MATCH_STATUSES = ['forming', 'playing', 'finished', 'void'] as const;
const ESCROW_STATUSES = ['escrow', 'consumed', 'refunded'] as const;
const GROUP_STATUSES = ['open', 'settled'] as const;

export type ArenaPersistenceErrorCode =
  | 'ARENA_INPUT_INVALID'
  | 'ARENA_NOT_FOUND'
  | 'ARENA_PERSISTENCE_INVALID';

export class ArenaPersistenceError extends Error {
  constructor(readonly code: ArenaPersistenceErrorCode) {
    super(code);
    this.name = 'ArenaPersistenceError';
  }
}

export interface ArenaSeasonRecord {
  id: string;
  ordinal: number;
  configVersion: number;
  preseason: boolean;
  startsAt: number;
  endsAt: number;
  createdAt: number;
}

export interface ArenaProfileRecord {
  seasonId: string;
  profileId: string;
  availableTickets: number;
  lastDailyGrantDate: string;
  placementGames: number;
  placementPoints: number;
  tier: ArenaTier | null;
  mmr: number;
  createdAt: number;
  updatedAt: number;
}

export type ArenaMatchStatus = typeof MATCH_STATUSES[number];

export interface ArenaMatchRecord {
  id: string;
  seasonId: string;
  configVersion: number;
  botVersion: string;
  botMmr: number;
  humanCount: number;
  botCount: number;
  status: ArenaMatchStatus;
  createdAt: number;
  startedAt: number | null;
  finishedAt: number | null;
}

export interface ArenaEntryRecord {
  matchId: string;
  profileId: string;
  place: number | null;
  points: number | null;
  mmrBefore: number;
  mmrAfter: number | null;
  resultKey: string | null;
  createdAt: number;
  settledAt: number | null;
}

export type ArenaTicketEscrowStatus = typeof ESCROW_STATUSES[number];

export interface ArenaTicketEscrowRecord {
  matchId: string;
  profileId: string;
  status: ArenaTicketEscrowStatus;
  createdAt: number;
  settledAt: number | null;
}

export type ArenaGroupStatus = typeof GROUP_STATUSES[number];

export interface ArenaGroupRecord {
  id: string;
  seasonId: string;
  weekKey: string;
  tier: ArenaTier;
  status: ArenaGroupStatus;
  createdAt: number;
  settledAt: number | null;
}

export interface ArenaGroupMemberRecord {
  groupId: string;
  seasonId: string;
  weekKey: string;
  profileId: string;
  points: number;
  wins: number;
  top3: number;
  placeSum: number;
  matches: number;
  scoreReachedAt: number;
  joinedAt: number;
  updatedAt: number;
}

export interface ArenaWeeklySettlementRecord {
  seasonId: string;
  weekKey: string;
  groupId: string;
  settledAt: number;
}

export interface ArenaSeasonRewardRecord {
  seasonId: string;
  profileId: string;
  itemId: string;
  grantedAt: number;
}

export interface PublicArenaSnapshot {
  season: {
    preseason: boolean;
    startsAt: number;
    endsAt: number;
  };
  profile: {
    availableTickets: number;
    placementGames: number;
    placementPoints: number;
    tier: ArenaTier | null;
  };
}

export interface ArenaTransaction {
  insertSeason(value: ArenaSeasonRecord): void;
  insertSeasonIfAbsent(value: ArenaSeasonRecord): void;
  insertProfile(value: ArenaProfileRecord): void;
  insertProfileIfAbsent(value: ArenaProfileRecord): void;
  insertMatch(value: ArenaMatchRecord): void;
  insertEntry(value: ArenaEntryRecord): void;
  insertTicketEscrow(value: ArenaTicketEscrowRecord): void;
  insertGroup(value: ArenaGroupRecord): void;
  insertGroupMember(value: ArenaGroupMemberRecord): void;
  updateProfile(value: ArenaProfileRecord): void;
  updateMatch(value: ArenaMatchRecord): void;
  updateEntry(value: ArenaEntryRecord): void;
  updateTicketEscrow(value: ArenaTicketEscrowRecord): void;
  updateGroup(value: ArenaGroupRecord): void;
  updateGroupMember(value: ArenaGroupMemberRecord): void;
  insertWeeklySettlement(value: ArenaWeeklySettlementRecord): void;
  insertSeasonReward(value: ArenaSeasonRewardRecord): void;
}

type SynchronousResult<T> = T extends PromiseLike<unknown> ? never : T;

interface SeasonRow {
  id: unknown;
  ordinal: unknown;
  config_version: unknown;
  preseason: unknown;
  starts_at: unknown;
  ends_at: unknown;
  created_at: unknown;
}

interface ProfileRow {
  season_id: unknown;
  profile_id: unknown;
  available_tickets: unknown;
  last_daily_grant_date: unknown;
  placement_games: unknown;
  placement_points: unknown;
  tier: unknown;
  mmr: unknown;
  created_at: unknown;
  updated_at: unknown;
}

interface MatchRow {
  id: unknown;
  season_id: unknown;
  config_version: unknown;
  bot_version: unknown;
  bot_mmr: unknown;
  human_count: unknown;
  bot_count: unknown;
  status: unknown;
  created_at: unknown;
  started_at: unknown;
  finished_at: unknown;
}

interface EntryRow {
  match_id: unknown;
  profile_id: unknown;
  place: unknown;
  points: unknown;
  mmr_before: unknown;
  mmr_after: unknown;
  result_key: unknown;
  created_at: unknown;
  settled_at: unknown;
}

interface EscrowRow {
  match_id: unknown;
  profile_id: unknown;
  status: unknown;
  created_at: unknown;
  settled_at: unknown;
}

interface GroupRow {
  id: unknown;
  season_id: unknown;
  week_key: unknown;
  tier: unknown;
  status: unknown;
  created_at: unknown;
  settled_at: unknown;
}

interface GroupMemberRow {
  group_id: unknown;
  season_id: unknown;
  week_key: unknown;
  profile_id: unknown;
  points: unknown;
  wins: unknown;
  top3: unknown;
  place_sum: unknown;
  matches: unknown;
  score_reached_at: unknown;
  joined_at: unknown;
  updated_at: unknown;
}

interface WeeklySettlementRow {
  season_id: unknown;
  week_key: unknown;
  group_id: unknown;
  settled_at: unknown;
}

interface SeasonRewardRow {
  season_id: unknown;
  profile_id: unknown;
  item_id: unknown;
  granted_at: unknown;
}

class ArenaTransactionImplementation implements ArenaTransaction {
  readonly #database: PokerDatabase;

  constructor(database: PokerDatabase) {
    this.#database = database;
  }

  insertSeason(value: ArenaSeasonRecord): void {
    assertSeason(value, 'ARENA_INPUT_INVALID');
    this.#database.assertTransactionActive();
    this.#database.db.prepare(`
      INSERT INTO arena_seasons (
        id, ordinal, config_version, preseason, starts_at, ends_at, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      value.id,
      value.ordinal,
      value.configVersion,
      value.preseason ? 1 : 0,
      value.startsAt,
      value.endsAt,
      value.createdAt,
    );
  }

  insertSeasonIfAbsent(value: ArenaSeasonRecord): void {
    assertSeason(value, 'ARENA_INPUT_INVALID');
    this.#database.assertTransactionActive();
    this.#database.db.prepare(`
      INSERT OR IGNORE INTO arena_seasons (
        id, ordinal, config_version, preseason, starts_at, ends_at, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      value.id,
      value.ordinal,
      value.configVersion,
      value.preseason ? 1 : 0,
      value.startsAt,
      value.endsAt,
      value.createdAt,
    );
  }

  insertProfile(value: ArenaProfileRecord): void {
    assertProfile(value, 'ARENA_INPUT_INVALID');
    this.#database.assertTransactionActive();
    this.#database.db.prepare(`
      INSERT INTO arena_profiles (
        season_id, profile_id, available_tickets, last_daily_grant_date,
        placement_games, placement_points, tier, mmr, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      value.seasonId,
      value.profileId,
      value.availableTickets,
      value.lastDailyGrantDate,
      value.placementGames,
      value.placementPoints,
      value.tier,
      value.mmr,
      value.createdAt,
      value.updatedAt,
    );
  }

  insertProfileIfAbsent(value: ArenaProfileRecord): void {
    assertProfile(value, 'ARENA_INPUT_INVALID');
    this.#database.assertTransactionActive();
    this.#database.db.prepare(`
      INSERT OR IGNORE INTO arena_profiles (
        season_id, profile_id, available_tickets, last_daily_grant_date,
        placement_games, placement_points, tier, mmr, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      value.seasonId,
      value.profileId,
      value.availableTickets,
      value.lastDailyGrantDate,
      value.placementGames,
      value.placementPoints,
      value.tier,
      value.mmr,
      value.createdAt,
      value.updatedAt,
    );
  }

  insertMatch(value: ArenaMatchRecord): void {
    assertMatch(value, 'ARENA_INPUT_INVALID');
    this.#database.assertTransactionActive();
    this.#database.db.prepare(`
      INSERT INTO arena_matches (
        id, season_id, config_version, bot_version, bot_mmr,
        human_count, bot_count, status, created_at, started_at, finished_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      value.id,
      value.seasonId,
      value.configVersion,
      value.botVersion,
      value.botMmr,
      value.humanCount,
      value.botCount,
      value.status,
      value.createdAt,
      value.startedAt,
      value.finishedAt,
    );
  }

  insertEntry(value: ArenaEntryRecord): void {
    assertEntry(value, 'ARENA_INPUT_INVALID');
    this.#database.assertTransactionActive();
    this.#database.db.prepare(`
      INSERT INTO arena_entries (
        match_id, season_id, profile_id, place, points, mmr_before, mmr_after,
        result_key, created_at, settled_at
      ) VALUES (
        ?, (SELECT season_id FROM arena_matches WHERE id = ?),
        ?, ?, ?, ?, ?, ?, ?, ?
      )
    `).run(
      value.matchId,
      value.matchId,
      value.profileId,
      value.place,
      value.points,
      value.mmrBefore,
      value.mmrAfter,
      value.resultKey,
      value.createdAt,
      value.settledAt,
    );
  }

  insertTicketEscrow(value: ArenaTicketEscrowRecord): void {
    assertEscrow(value, 'ARENA_INPUT_INVALID');
    this.#database.assertTransactionActive();
    this.#database.db.prepare(`
      INSERT INTO arena_ticket_escrows (
        match_id, season_id, profile_id, status, created_at, settled_at
      ) VALUES (
        ?, (SELECT season_id FROM arena_matches WHERE id = ?), ?, ?, ?, ?
      )
    `).run(
      value.matchId,
      value.matchId,
      value.profileId,
      value.status,
      value.createdAt,
      value.settledAt,
    );
  }

  insertGroup(value: ArenaGroupRecord): void {
    assertGroup(value, 'ARENA_INPUT_INVALID');
    this.#database.assertTransactionActive();
    this.#database.db.prepare(`
      INSERT INTO arena_groups (
        id, season_id, week_key, tier, status, created_at, settled_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      value.id,
      value.seasonId,
      value.weekKey,
      value.tier,
      value.status,
      value.createdAt,
      value.settledAt,
    );
  }

  insertGroupMember(value: ArenaGroupMemberRecord): void {
    assertGroupMember(value, 'ARENA_INPUT_INVALID');
    this.#database.assertTransactionActive();
    this.#database.db.prepare(`
      INSERT INTO arena_group_members (
        group_id, season_id, week_key, profile_id, points, wins, top3,
        place_sum, matches, score_reached_at, joined_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      value.groupId,
      value.seasonId,
      value.weekKey,
      value.profileId,
      value.points,
      value.wins,
      value.top3,
      value.placeSum,
      value.matches,
      value.scoreReachedAt,
      value.joinedAt,
      value.updatedAt,
    );
  }

  updateProfile(value: ArenaProfileRecord): void {
    assertProfile(value, 'ARENA_INPUT_INVALID');
    this.#database.assertTransactionActive();
    const currentRow = this.#database.db.prepare(`
      SELECT season_id, profile_id, available_tickets, last_daily_grant_date,
             placement_games, placement_points, tier, mmr, created_at, updated_at
      FROM arena_profiles WHERE season_id = ? AND profile_id = ?
    `).get(value.seasonId, value.profileId) as unknown as ProfileRow | undefined;
    if (!currentRow) fail('ARENA_NOT_FOUND');
    assertProfileTransition(mapProfile(currentRow), value);
    const result = this.#database.db.prepare(`
      UPDATE arena_profiles
      SET available_tickets = ?, last_daily_grant_date = ?,
          placement_games = ?, placement_points = ?, tier = ?, mmr = ?,
          updated_at = ?
      WHERE season_id = ? AND profile_id = ? AND created_at = ?
    `).run(
      value.availableTickets,
      value.lastDailyGrantDate,
      value.placementGames,
      value.placementPoints,
      value.tier,
      value.mmr,
      value.updatedAt,
      value.seasonId,
      value.profileId,
      value.createdAt,
    );
    requireOneChange(result.changes);
  }

  updateMatch(value: ArenaMatchRecord): void {
    assertMatch(value, 'ARENA_INPUT_INVALID');
    this.#database.assertTransactionActive();
    const current = this.#database.db.prepare(`
      SELECT status, created_at FROM arena_matches WHERE id = ?
    `).get(value.id) as { status: unknown; created_at: unknown } | undefined;
    if (!current) fail('ARENA_NOT_FOUND');
    const status = asEnum(current.status, MATCH_STATUSES);
    if (
      asNumber(current.created_at) !== value.createdAt
      || !allowedMatchTransition(status, value.status)
    ) fail('ARENA_INPUT_INVALID');
    const result = this.#database.db.prepare(`
      UPDATE arena_matches
      SET status = ?, started_at = ?, finished_at = ?
      WHERE id = ? AND season_id = ? AND config_version = ?
        AND bot_version = ? AND bot_mmr = ?
        AND human_count = ? AND bot_count = ? AND created_at = ?
    `).run(
      value.status,
      value.startedAt,
      value.finishedAt,
      value.id,
      value.seasonId,
      value.configVersion,
      value.botVersion,
      value.botMmr,
      value.humanCount,
      value.botCount,
      value.createdAt,
    );
    requireOneChange(result.changes);
  }

  updateEntry(value: ArenaEntryRecord): void {
    assertEntry(value, 'ARENA_INPUT_INVALID');
    this.#database.assertTransactionActive();
    const currentRow = this.#database.db.prepare(`
      SELECT match_id, profile_id, place, points, mmr_before, mmr_after,
             result_key, created_at, settled_at
      FROM arena_entries WHERE match_id = ? AND profile_id = ?
    `).get(value.matchId, value.profileId) as unknown as EntryRow | undefined;
    if (!currentRow) fail('ARENA_NOT_FOUND');
    const current = mapEntry(currentRow);
    if (
      current.createdAt !== value.createdAt
      || current.mmrBefore !== value.mmrBefore
      || current.resultKey !== null
    ) fail('ARENA_INPUT_INVALID');
    const result = this.#database.db.prepare(`
      UPDATE arena_entries
      SET place = ?, points = ?, mmr_after = ?, result_key = ?, settled_at = ?
      WHERE match_id = ? AND profile_id = ? AND result_key IS NULL
        AND created_at = ? AND mmr_before = ?
    `).run(
      value.place,
      value.points,
      value.mmrAfter,
      value.resultKey,
      value.settledAt,
      value.matchId,
      value.profileId,
      value.createdAt,
      value.mmrBefore,
    );
    requireOneChange(result.changes);
  }

  updateTicketEscrow(value: ArenaTicketEscrowRecord): void {
    assertEscrow(value, 'ARENA_INPUT_INVALID');
    this.#database.assertTransactionActive();
    const current = this.#database.db.prepare(`
      SELECT status, created_at FROM arena_ticket_escrows
      WHERE match_id = ? AND profile_id = ?
    `).get(value.matchId, value.profileId) as {
      status: unknown;
      created_at: unknown;
    } | undefined;
    if (!current) fail('ARENA_NOT_FOUND');
    const status = asEnum(current.status, ESCROW_STATUSES);
    if (
      asNumber(current.created_at) !== value.createdAt
      || !allowedEscrowTransition(status, value.status)
    ) fail('ARENA_INPUT_INVALID');
    const result = this.#database.db.prepare(`
      UPDATE arena_ticket_escrows SET status = ?, settled_at = ?
      WHERE match_id = ? AND profile_id = ? AND created_at = ?
    `).run(
      value.status,
      value.settledAt,
      value.matchId,
      value.profileId,
      value.createdAt,
    );
    requireOneChange(result.changes);
  }

  updateGroup(value: ArenaGroupRecord): void {
    assertGroup(value, 'ARENA_INPUT_INVALID');
    this.#database.assertTransactionActive();
    const currentRow = this.#database.db.prepare(`
      SELECT id, season_id, week_key, tier, status, created_at, settled_at
      FROM arena_groups WHERE id = ?
    `).get(value.id) as unknown as GroupRow | undefined;
    if (!currentRow) fail('ARENA_NOT_FOUND');
    const current = mapGroup(currentRow);
    assertGroupTransition(current, value);
    const result = this.#database.db.prepare(`
      UPDATE arena_groups SET status = ?, settled_at = ?
      WHERE id = ? AND season_id = ? AND week_key = ? AND tier = ?
        AND status = ? AND created_at = ? AND settled_at IS NULL
    `).run(
      value.status,
      value.settledAt,
      value.id,
      value.seasonId,
      value.weekKey,
      value.tier,
      current.status,
      value.createdAt,
    );
    requireOneChange(result.changes);
  }

  updateGroupMember(value: ArenaGroupMemberRecord): void {
    assertGroupMember(value, 'ARENA_INPUT_INVALID');
    this.#database.assertTransactionActive();
    const currentRow = this.#database.db.prepare(`
      SELECT group_id, season_id, week_key, profile_id, points, wins, top3,
             place_sum, matches, score_reached_at, joined_at, updated_at
      FROM arena_group_members WHERE group_id = ? AND profile_id = ?
    `).get(value.groupId, value.profileId) as unknown as
      GroupMemberRow | undefined;
    if (!currentRow) fail('ARENA_NOT_FOUND');
    const current = mapGroupMember(currentRow);
    assertGroupMemberTransition(current, value);
    const result = this.#database.db.prepare(`
      UPDATE arena_group_members
      SET points = ?, wins = ?, top3 = ?, place_sum = ?, matches = ?,
          score_reached_at = ?, updated_at = ?
      WHERE group_id = ? AND season_id = ? AND week_key = ?
        AND profile_id = ? AND joined_at = ?
    `).run(
      value.points,
      value.wins,
      value.top3,
      value.placeSum,
      value.matches,
      value.scoreReachedAt,
      value.updatedAt,
      value.groupId,
      value.seasonId,
      value.weekKey,
      value.profileId,
      value.joinedAt,
    );
    requireOneChange(result.changes);
  }

  insertWeeklySettlement(value: ArenaWeeklySettlementRecord): void {
    assertWeeklySettlement(value, 'ARENA_INPUT_INVALID');
    this.#database.assertTransactionActive();
    this.#database.db.prepare(`
      INSERT INTO arena_weekly_settlements (
        season_id, week_key, group_id, settled_at
      ) VALUES (?, ?, ?, ?)
    `).run(value.seasonId, value.weekKey, value.groupId, value.settledAt);
  }

  insertSeasonReward(value: ArenaSeasonRewardRecord): void {
    assertSeasonReward(value, 'ARENA_INPUT_INVALID');
    this.#database.assertTransactionActive();
    this.#database.db.prepare(`
      INSERT INTO arena_season_rewards (
        season_id, profile_id, item_id, granted_at
      ) VALUES (?, ?, ?, ?)
    `).run(value.seasonId, value.profileId, value.itemId, value.grantedAt);
  }
}

export class ArenaRepository {
  readonly #database: PokerDatabase;

  constructor(database: PokerDatabase) {
    this.#database = database;
  }

  transaction<T>(
    work: (transaction: ArenaTransaction) => SynchronousResult<T>,
  ): SynchronousResult<T> {
    const invoke = (): unknown => work(
      new ArenaTransactionImplementation(this.#database),
    );
    return this.#database.transaction(invoke) as SynchronousResult<T>;
  }

  createSeason(value: ArenaSeasonRecord): ArenaSeasonRecord {
    this.transaction(tx => tx.insertSeason(value));
    return this.requireSeason(value.id);
  }

  createProfile(value: ArenaProfileRecord): ArenaProfileRecord {
    this.transaction(tx => tx.insertProfile(value));
    return this.requireProfile(value.seasonId, value.profileId);
  }

  createMatch(value: ArenaMatchRecord): ArenaMatchRecord {
    this.transaction(tx => tx.insertMatch(value));
    return this.requireMatch(value.id);
  }

  findSeason(seasonId: string): ArenaSeasonRecord | null {
    const row = this.#database.db.prepare(`
      SELECT id, ordinal, config_version, preseason, starts_at, ends_at, created_at
      FROM arena_seasons WHERE id = ?
    `).get(seasonId) as unknown as SeasonRow | undefined;
    return row ? mapSeason(row) : null;
  }

  requireSeason(seasonId: string): ArenaSeasonRecord {
    const value = this.findSeason(seasonId);
    if (!value) throw new ArenaPersistenceError('ARENA_NOT_FOUND');
    return value;
  }

  findProfile(seasonId: string, profileId: string): ArenaProfileRecord | null {
    const row = this.#database.db.prepare(`
      SELECT season_id, profile_id, available_tickets, last_daily_grant_date,
             placement_games, placement_points, tier, mmr, created_at, updated_at
      FROM arena_profiles WHERE season_id = ? AND profile_id = ?
    `).get(seasonId, profileId) as unknown as ProfileRow | undefined;
    return row ? mapProfile(row) : null;
  }

  requireProfile(seasonId: string, profileId: string): ArenaProfileRecord {
    const value = this.findProfile(seasonId, profileId);
    if (!value) throw new ArenaPersistenceError('ARENA_NOT_FOUND');
    return value;
  }

  getPublicSnapshot(
    seasonId: string,
    profileId: string,
  ): PublicArenaSnapshot | null {
    const row = this.#database.db.prepare(`
      SELECT
        seasons.id, seasons.ordinal, seasons.config_version,
        seasons.preseason, seasons.starts_at, seasons.ends_at,
        seasons.created_at,
        profiles.season_id, profiles.profile_id,
        profiles.available_tickets, profiles.last_daily_grant_date,
        profiles.placement_games, profiles.placement_points,
        profiles.tier, profiles.mmr,
        profiles.created_at AS profile_created_at,
        profiles.updated_at
      FROM arena_profiles AS profiles
      JOIN arena_seasons AS seasons ON seasons.id = profiles.season_id
      WHERE profiles.season_id = ? AND profiles.profile_id = ?
    `).get(seasonId, profileId) as {
      id: unknown;
      ordinal: unknown;
      config_version: unknown;
      preseason: unknown;
      starts_at: unknown;
      ends_at: unknown;
      created_at: unknown;
      season_id: unknown;
      profile_id: unknown;
      available_tickets: unknown;
      last_daily_grant_date: unknown;
      placement_games: unknown;
      placement_points: unknown;
      tier: unknown;
      mmr: unknown;
      profile_created_at: unknown;
      updated_at: unknown;
    } | undefined;
    if (!row) return null;
    const season = mapSeason(row);
    const profile = mapProfile({
      ...row,
      created_at: row.profile_created_at,
    });
    return {
      season: {
        preseason: season.preseason,
        startsAt: season.startsAt,
        endsAt: season.endsAt,
      },
      profile: {
        availableTickets: profile.availableTickets,
        placementGames: profile.placementGames,
        placementPoints: profile.placementPoints,
        tier: profile.tier,
      },
    };
  }

  findMatch(matchId: string): ArenaMatchRecord | null {
    const row = this.#database.db.prepare(`
      SELECT id, season_id, config_version, bot_version, bot_mmr,
             human_count, bot_count, status, created_at, started_at, finished_at
      FROM arena_matches WHERE id = ?
    `).get(matchId) as unknown as MatchRow | undefined;
    return row ? mapMatch(row) : null;
  }

  requireMatch(matchId: string): ArenaMatchRecord {
    const value = this.findMatch(matchId);
    if (!value) throw new ArenaPersistenceError('ARENA_NOT_FOUND');
    return value;
  }

  listMatchEntries(matchId: string): ArenaEntryRecord[] {
    const rows = this.#database.db.prepare(`
      SELECT match_id, profile_id, place, points, mmr_before, mmr_after,
             result_key, created_at, settled_at
      FROM arena_entries WHERE match_id = ? ORDER BY profile_id
    `).all(matchId) as unknown as EntryRow[];
    return rows.map(mapEntry);
  }

  findActiveTicketEscrow(profileId: string): ArenaTicketEscrowRecord | null {
    const row = this.#database.db.prepare(`
      SELECT match_id, profile_id, status, created_at, settled_at
      FROM arena_ticket_escrows
      WHERE profile_id = ? AND status = 'escrow'
    `).get(profileId) as unknown as EscrowRow | undefined;
    return row ? mapEscrow(row) : null;
  }

  requireTicketEscrow(
    matchId: string,
    profileId: string,
  ): ArenaTicketEscrowRecord {
    const row = this.#database.db.prepare(`
      SELECT match_id, profile_id, status, created_at, settled_at
      FROM arena_ticket_escrows WHERE match_id = ? AND profile_id = ?
    `).get(matchId, profileId) as unknown as EscrowRow | undefined;
    if (!row) throw new ArenaPersistenceError('ARENA_NOT_FOUND');
    return mapEscrow(row);
  }

  listUnfinishedMatches(): ArenaMatchRecord[] {
    const rows = this.#database.db.prepare(`
      SELECT id, season_id, config_version, bot_version, bot_mmr,
             human_count, bot_count, status, created_at, started_at, finished_at
      FROM arena_matches WHERE status IN ('forming', 'playing')
      ORDER BY created_at, id
    `).all() as unknown as MatchRow[];
    return rows.map(mapMatch);
  }

  findGroup(groupId: string): ArenaGroupRecord | null {
    const row = this.#database.db.prepare(`
      SELECT id, season_id, week_key, tier, status, created_at, settled_at
      FROM arena_groups WHERE id = ?
    `).get(groupId) as unknown as GroupRow | undefined;
    return row ? mapGroup(row) : null;
  }

  requireGroup(groupId: string): ArenaGroupRecord {
    const value = this.findGroup(groupId);
    if (!value) throw new ArenaPersistenceError('ARENA_NOT_FOUND');
    return value;
  }

  findOldestOpenGroupBelowMemberCount(
    seasonId: string,
    weekKeyValue: string,
    tier: ArenaTier,
    maximumMembers: number,
  ): ArenaGroupRecord | null {
    const row = this.#database.db.prepare(`
      SELECT groups.id, groups.season_id, groups.week_key, groups.tier,
             groups.status, groups.created_at, groups.settled_at
      FROM arena_groups AS groups
      WHERE groups.season_id = ? AND groups.week_key = ?
        AND groups.tier = ? AND groups.status = 'open'
        AND (
          SELECT COUNT(*) FROM arena_group_members AS members
          WHERE members.group_id = groups.id
        ) < ?
      ORDER BY groups.created_at, groups.id
      LIMIT 1
    `).get(
      seasonId,
      weekKeyValue,
      tier,
      maximumMembers,
    ) as unknown as GroupRow | undefined;
    return row ? mapGroup(row) : null;
  }

  listOpenGroupsBeforeWeek(weekKeyExclusive: string): ArenaGroupRecord[] {
    const rows = this.#database.db.prepare(`
      SELECT id, season_id, week_key, tier, status, created_at, settled_at
      FROM arena_groups
      WHERE status = 'open' AND week_key < ?
      ORDER BY week_key, season_id, created_at, id
    `).all(weekKeyExclusive) as unknown as GroupRow[];
    return rows.map(mapGroup);
  }

  listOpenGroupsBeforeWeekForProfiles(
    seasonId: string,
    weekKeyExclusive: string,
    profileIds: readonly string[],
  ): ArenaGroupRecord[] {
    const uniqueProfileIds = [...new Set(profileIds)].sort(compareCodeUnits);
    if (uniqueProfileIds.length === 0) return [];
    const placeholders = uniqueProfileIds.map(() => '?').join(', ');
    const rows = this.#database.db.prepare(`
      SELECT DISTINCT groups.id, groups.season_id, groups.week_key,
             groups.tier, groups.status, groups.created_at, groups.settled_at
      FROM arena_group_members AS members
      JOIN arena_groups AS groups ON groups.id = members.group_id
      WHERE members.profile_id IN (${placeholders})
        AND members.season_id = ? AND members.week_key < ?
        AND groups.status = 'open'
      ORDER BY groups.week_key, groups.created_at, groups.id
    `).all(
      ...uniqueProfileIds,
      seasonId,
      weekKeyExclusive,
    ) as unknown as GroupRow[];
    return rows.map(mapGroup);
  }

  listGroupMembers(groupId: string): ArenaGroupMemberRecord[] {
    const rows = this.#database.db.prepare(`
      SELECT group_id, season_id, week_key, profile_id, points, wins, top3,
             place_sum, matches, score_reached_at, joined_at, updated_at
      FROM arena_group_members WHERE group_id = ? ORDER BY profile_id
    `).all(groupId) as unknown as GroupMemberRow[];
    return rows.map(mapGroupMember);
  }

  findGroupMember(
    seasonId: string,
    weekKeyValue: string,
    profileId: string,
  ): ArenaGroupMemberRecord | null {
    const row = this.#database.db.prepare(`
      SELECT members.group_id, members.season_id, members.week_key,
             members.profile_id, members.points, members.wins, members.top3,
             members.place_sum, members.matches, members.score_reached_at,
             members.joined_at, members.updated_at
      FROM arena_group_members AS members
      JOIN arena_groups AS groups ON groups.id = members.group_id
      WHERE members.season_id = ? AND members.week_key = ?
        AND members.profile_id = ? AND groups.status = 'open'
      ORDER BY groups.created_at, groups.id
      LIMIT 1
    `).get(seasonId, weekKeyValue, profileId) as unknown as
      GroupMemberRow | undefined;
    return row ? mapGroupMember(row) : null;
  }

  findWeeklySettlement(
    seasonId: string,
    weekKeyValue: string,
    groupId: string,
  ): ArenaWeeklySettlementRecord | null {
    const row = this.#database.db.prepare(`
      SELECT season_id, week_key, group_id, settled_at
      FROM arena_weekly_settlements
      WHERE season_id = ? AND week_key = ? AND group_id = ?
    `).get(seasonId, weekKeyValue, groupId) as unknown as
      WeeklySettlementRow | undefined;
    return row ? mapWeeklySettlement(row) : null;
  }

  listSeasonRewards(
    seasonId: string,
    profileId: string,
  ): ArenaSeasonRewardRecord[] {
    const rows = this.#database.db.prepare(`
      SELECT season_id, profile_id, item_id, granted_at
      FROM arena_season_rewards
      WHERE season_id = ? AND profile_id = ? ORDER BY item_id
    `).all(seasonId, profileId) as unknown as SeasonRewardRow[];
    return rows.map(mapSeasonReward);
  }
}

function mapSeason(row: SeasonRow): ArenaSeasonRecord {
  const value: ArenaSeasonRecord = {
    id: asString(row.id),
    ordinal: asNumber(row.ordinal),
    configVersion: asNumber(row.config_version),
    preseason: asBoolean(row.preseason),
    startsAt: asNumber(row.starts_at),
    endsAt: asNumber(row.ends_at),
    createdAt: asNumber(row.created_at),
  };
  assertSeason(value, 'ARENA_PERSISTENCE_INVALID');
  return value;
}

function mapProfile(row: ProfileRow): ArenaProfileRecord {
  const value: ArenaProfileRecord = {
    seasonId: asString(row.season_id),
    profileId: asString(row.profile_id),
    availableTickets: asNumber(row.available_tickets),
    lastDailyGrantDate: asString(row.last_daily_grant_date),
    placementGames: asNumber(row.placement_games),
    placementPoints: asNumber(row.placement_points),
    tier: asNullableTier(row.tier),
    mmr: asNumber(row.mmr),
    createdAt: asNumber(row.created_at),
    updatedAt: asNumber(row.updated_at),
  };
  assertProfile(value, 'ARENA_PERSISTENCE_INVALID');
  return value;
}

function mapMatch(row: MatchRow): ArenaMatchRecord {
  const value: ArenaMatchRecord = {
    id: asString(row.id),
    seasonId: asString(row.season_id),
    configVersion: asNumber(row.config_version),
    botVersion: asString(row.bot_version),
    botMmr: asNumber(row.bot_mmr),
    humanCount: asNumber(row.human_count),
    botCount: asNumber(row.bot_count),
    status: asEnum(row.status, MATCH_STATUSES),
    createdAt: asNumber(row.created_at),
    startedAt: asNullableNumber(row.started_at),
    finishedAt: asNullableNumber(row.finished_at),
  };
  assertMatch(value, 'ARENA_PERSISTENCE_INVALID');
  return value;
}

function mapEntry(row: EntryRow): ArenaEntryRecord {
  const value: ArenaEntryRecord = {
    matchId: asString(row.match_id),
    profileId: asString(row.profile_id),
    place: asNullableNumber(row.place),
    points: asNullableNumber(row.points),
    mmrBefore: asNumber(row.mmr_before),
    mmrAfter: asNullableNumber(row.mmr_after),
    resultKey: asNullableString(row.result_key),
    createdAt: asNumber(row.created_at),
    settledAt: asNullableNumber(row.settled_at),
  };
  assertEntry(value, 'ARENA_PERSISTENCE_INVALID');
  return value;
}

function mapEscrow(row: EscrowRow): ArenaTicketEscrowRecord {
  const value: ArenaTicketEscrowRecord = {
    matchId: asString(row.match_id),
    profileId: asString(row.profile_id),
    status: asEnum(row.status, ESCROW_STATUSES),
    createdAt: asNumber(row.created_at),
    settledAt: asNullableNumber(row.settled_at),
  };
  assertEscrow(value, 'ARENA_PERSISTENCE_INVALID');
  return value;
}

function mapGroup(row: GroupRow): ArenaGroupRecord {
  const value: ArenaGroupRecord = {
    id: asString(row.id),
    seasonId: asString(row.season_id),
    weekKey: asString(row.week_key),
    tier: asTier(row.tier),
    status: asEnum(row.status, GROUP_STATUSES),
    createdAt: asNumber(row.created_at),
    settledAt: asNullableNumber(row.settled_at),
  };
  assertGroup(value, 'ARENA_PERSISTENCE_INVALID');
  return value;
}

function mapGroupMember(row: GroupMemberRow): ArenaGroupMemberRecord {
  const value: ArenaGroupMemberRecord = {
    groupId: asString(row.group_id),
    seasonId: asString(row.season_id),
    weekKey: asString(row.week_key),
    profileId: asString(row.profile_id),
    points: asNumber(row.points),
    wins: asNumber(row.wins),
    top3: asNumber(row.top3),
    placeSum: asNumber(row.place_sum),
    matches: asNumber(row.matches),
    scoreReachedAt: asNumber(row.score_reached_at),
    joinedAt: asNumber(row.joined_at),
    updatedAt: asNumber(row.updated_at),
  };
  assertGroupMember(value, 'ARENA_PERSISTENCE_INVALID');
  return value;
}

function mapWeeklySettlement(
  row: WeeklySettlementRow,
): ArenaWeeklySettlementRecord {
  const value: ArenaWeeklySettlementRecord = {
    seasonId: asString(row.season_id),
    weekKey: asString(row.week_key),
    groupId: asString(row.group_id),
    settledAt: asNumber(row.settled_at),
  };
  assertWeeklySettlement(value, 'ARENA_PERSISTENCE_INVALID');
  return value;
}

function mapSeasonReward(row: SeasonRewardRow): ArenaSeasonRewardRecord {
  const value: ArenaSeasonRewardRecord = {
    seasonId: asString(row.season_id),
    profileId: asString(row.profile_id),
    itemId: asString(row.item_id),
    grantedAt: asNumber(row.granted_at),
  };
  assertSeasonReward(value, 'ARENA_PERSISTENCE_INVALID');
  return value;
}

function assertSeason(
  value: ArenaSeasonRecord,
  code: ArenaPersistenceErrorCode,
): void {
  if (
    !nonempty(value.id)
    || !nonnegative(value.ordinal)
    || value.configVersion !== 1
    || typeof value.preseason !== 'boolean'
    || !timestamp(value.startsAt)
    || !timestamp(value.endsAt)
    || value.endsAt <= value.startsAt
    || !timestamp(value.createdAt)
  ) fail(code);
}

function assertProfile(
  value: ArenaProfileRecord,
  code: ArenaPersistenceErrorCode,
): void {
  if (
    !nonempty(value.seasonId)
    || !nonempty(value.profileId)
    || !integerBetween(value.availableTickets, 0, 10)
    || !canonicalDate(value.lastDailyGrantDate)
    || !integerBetween(value.placementGames, 0, 5)
    || !integerBetween(
      value.placementPoints,
      0,
      value.placementGames * 100,
    )
    || !(
      (value.placementGames < 5 && value.tier === null)
      || (value.placementGames === 5 && isTier(value.tier))
    )
    || !safeInteger(value.mmr)
    || !timestamp(value.createdAt)
    || !timestamp(value.updatedAt)
    || value.updatedAt < value.createdAt
  ) fail(code);
}

function assertMatch(
  value: ArenaMatchRecord,
  code: ArenaPersistenceErrorCode,
): void {
  const timestampsValid =
    (value.status === 'forming'
      && value.startedAt === null && value.finishedAt === null)
    || (value.status === 'playing'
      && timestamp(value.startedAt) && value.finishedAt === null)
    || (value.status === 'finished'
      && timestamp(value.startedAt) && timestamp(value.finishedAt))
    || (value.status === 'void' && timestamp(value.finishedAt));
  if (
    !nonempty(value.id)
    || !nonempty(value.seasonId)
    || value.configVersion !== 1
    || !nonempty(value.botVersion)
    || !safeInteger(value.botMmr)
    || !integerBetween(value.humanCount, 2, 6)
    || !integerBetween(value.botCount, 0, 4)
    || value.humanCount + value.botCount !== 6
    || !MATCH_STATUSES.includes(value.status)
    || !timestamp(value.createdAt)
    || !timestampsValid
    || (value.startedAt !== null && value.startedAt < value.createdAt)
    || (value.finishedAt !== null
      && value.finishedAt < (value.startedAt ?? value.createdAt))
  ) fail(code);
}

function assertEntry(
  value: ArenaEntryRecord,
  code: ArenaPersistenceErrorCode,
): void {
  const unsettled = value.resultKey === null
    && value.place === null
    && value.points === null
    && value.mmrAfter === null
    && value.settledAt === null;
  const settled = nonempty(value.resultKey)
    && integerBetween(value.place, 1, 6)
    && value.points === pointsForArenaPlace(value.place as number)
    && safeInteger(value.mmrAfter)
    && timestamp(value.settledAt);
  if (
    !nonempty(value.matchId)
    || !nonempty(value.profileId)
    || !safeInteger(value.mmrBefore)
    || !timestamp(value.createdAt)
    || (!unsettled && !settled)
    || (value.settledAt !== null && value.settledAt < value.createdAt)
  ) fail(code);
}

function assertEscrow(
  value: ArenaTicketEscrowRecord,
  code: ArenaPersistenceErrorCode,
): void {
  if (
    !nonempty(value.matchId)
    || !nonempty(value.profileId)
    || !ESCROW_STATUSES.includes(value.status)
    || !timestamp(value.createdAt)
    || (value.status === 'escrow' && value.settledAt !== null)
    || (value.status !== 'escrow' && !timestamp(value.settledAt))
    || (value.settledAt !== null && value.settledAt < value.createdAt)
  ) fail(code);
}

function assertGroup(
  value: ArenaGroupRecord,
  code: ArenaPersistenceErrorCode,
): void {
  if (
    !nonempty(value.id)
    || !nonempty(value.seasonId)
    || !weekKey(value.weekKey)
    || !isTier(value.tier)
    || !GROUP_STATUSES.includes(value.status)
    || !timestamp(value.createdAt)
    || (value.status === 'open' && value.settledAt !== null)
    || (value.status === 'settled' && !timestamp(value.settledAt))
    || (value.settledAt !== null && value.settledAt < value.createdAt)
  ) fail(code);
}

function assertGroupMember(
  value: ArenaGroupMemberRecord,
  code: ArenaPersistenceErrorCode,
): void {
  if (
    !nonempty(value.groupId)
    || !nonempty(value.seasonId)
    || !weekKey(value.weekKey)
    || !nonempty(value.profileId)
    || !nonnegative(value.points)
    || !nonnegative(value.wins)
    || !nonnegative(value.top3)
    || !nonnegative(value.placeSum)
    || !nonnegative(value.matches)
    || value.wins > value.top3
    || value.top3 > value.matches
    || (value.matches === 0 && value.placeSum !== 0)
    || (value.matches > 0
      && !integerBetween(value.placeSum, value.matches, value.matches * 6))
    || !timestamp(value.scoreReachedAt)
    || !timestamp(value.joinedAt)
    || !timestamp(value.updatedAt)
    || value.joinedAt > value.scoreReachedAt
    || value.scoreReachedAt > value.updatedAt
  ) fail(code);
}

function assertWeeklySettlement(
  value: ArenaWeeklySettlementRecord,
  code: ArenaPersistenceErrorCode,
): void {
  if (
    !nonempty(value.seasonId)
    || !weekKey(value.weekKey)
    || !nonempty(value.groupId)
    || !timestamp(value.settledAt)
  ) fail(code);
}

function assertSeasonReward(
  value: ArenaSeasonRewardRecord,
  code: ArenaPersistenceErrorCode,
): void {
  if (
    !nonempty(value.seasonId)
    || !nonempty(value.profileId)
    || !nonempty(value.itemId)
    || !timestamp(value.grantedAt)
  ) fail(code);
}

function allowedMatchTransition(
  current: ArenaMatchStatus,
  next: ArenaMatchStatus,
): boolean {
  if (current === next) return true;
  if (current === 'forming') return next === 'playing' || next === 'void';
  if (current === 'playing') return next === 'finished' || next === 'void';
  return false;
}

function allowedEscrowTransition(
  current: ArenaTicketEscrowStatus,
  next: ArenaTicketEscrowStatus,
): boolean {
  return current === next
    || (current === 'escrow' && (next === 'consumed' || next === 'refunded'));
}

function requireOneChange(changes: number | bigint): void {
  if (changes !== 1 && changes !== BigInt(1)) fail('ARENA_NOT_FOUND');
}

function assertProfileTransition(
  current: ArenaProfileRecord,
  next: ArenaProfileRecord,
): void {
  const gamesDelta = next.placementGames - current.placementGames;
  const pointsDelta = next.placementPoints - current.placementPoints;
  if (
    next.seasonId !== current.seasonId
    || next.profileId !== current.profileId
    || next.createdAt !== current.createdAt
    || next.updatedAt < current.updatedAt
    || next.lastDailyGrantDate < current.lastDailyGrantDate
    || gamesDelta < 0
    || gamesDelta > 1
    || pointsDelta < 0
    || (gamesDelta === 0 && pointsDelta !== 0)
    || (gamesDelta === 1
      && ![0, 5, 15, 35, 60, 100].includes(pointsDelta))
    || (current.placementGames === 5
      && (gamesDelta !== 0 || pointsDelta !== 0))
  ) fail('ARENA_INPUT_INVALID');
}

function assertGroupMemberTransition(
  current: ArenaGroupMemberRecord,
  next: ArenaGroupMemberRecord,
): void {
  const pointsDelta = next.points - current.points;
  const matchDelta = next.matches - current.matches;
  const place = next.placeSum - current.placeSum;
  const winsDelta = next.wins - current.wins;
  const top3Delta = next.top3 - current.top3;
  if (
    next.groupId !== current.groupId
    || next.seasonId !== current.seasonId
    || next.weekKey !== current.weekKey
    || next.profileId !== current.profileId
    || next.joinedAt !== current.joinedAt
    || next.updatedAt < current.updatedAt
    || matchDelta !== 1
    || pointsDelta !== pointsForArenaPlace(place)
    || winsDelta !== (place === 1 ? 1 : 0)
    || top3Delta !== (place <= 3 ? 1 : 0)
    || (
      pointsDelta === 0
        ? next.scoreReachedAt !== current.scoreReachedAt
        : next.scoreReachedAt !== next.updatedAt
    )
  ) fail('ARENA_INPUT_INVALID');
}

function assertGroupTransition(
  current: ArenaGroupRecord,
  next: ArenaGroupRecord,
): void {
  if (
    next.id !== current.id
    || next.seasonId !== current.seasonId
    || next.weekKey !== current.weekKey
    || next.tier !== current.tier
    || next.createdAt !== current.createdAt
    || current.status !== 'open'
    || current.settledAt !== null
    || next.status !== 'settled'
    || next.settledAt === null
  ) fail('ARENA_INPUT_INVALID');
}

function pointsForArenaPlace(place: number): number {
  return [100, 60, 35, 15, 5, 0][place - 1] ?? -1;
}

function fail(code: ArenaPersistenceErrorCode): never {
  throw new ArenaPersistenceError(code);
}

function asString(value: unknown): string {
  if (typeof value !== 'string') fail('ARENA_PERSISTENCE_INVALID');
  return value;
}

function asNullableString(value: unknown): string | null {
  return value === null ? null : asString(value);
}

function asNumber(value: unknown): number {
  if (typeof value !== 'number') fail('ARENA_PERSISTENCE_INVALID');
  return value;
}

function asNullableNumber(value: unknown): number | null {
  return value === null ? null : asNumber(value);
}

function asBoolean(value: unknown): boolean {
  if (value !== 0 && value !== 1) fail('ARENA_PERSISTENCE_INVALID');
  return value === 1;
}

function asTier(value: unknown): ArenaTier {
  if (!isTier(value)) fail('ARENA_PERSISTENCE_INVALID');
  return value;
}

function asNullableTier(value: unknown): ArenaTier | null {
  return value === null ? null : asTier(value);
}

function asEnum<const TValues extends readonly string[]>(
  value: unknown,
  values: TValues,
): TValues[number] {
  if (typeof value !== 'string' || !values.includes(value)) {
    fail('ARENA_PERSISTENCE_INVALID');
  }
  return value;
}

function compareCodeUnits(left: string, right: string): number {
  if (left === right) return 0;
  return left < right ? -1 : 1;
}

function nonempty(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function safeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value)
    && (value as number) >= -MAX_SAFE_INTEGER
    && (value as number) <= MAX_SAFE_INTEGER;
}

function nonnegative(value: unknown): value is number {
  return safeInteger(value) && value >= 0;
}

function integerBetween(
  value: unknown,
  minimum: number,
  maximum: number,
): value is number {
  return safeInteger(value) && value >= minimum && value <= maximum;
}

function timestamp(value: unknown): value is number {
  return integerBetween(value, 0, MAX_TIMESTAMP);
}

function isTier(value: unknown): value is ArenaTier {
  return typeof value === 'string' && TIERS.includes(value as ArenaTier);
}

function canonicalDate(value: unknown): boolean {
  if (typeof value !== 'string') return false;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (year < 1 || year > 9_999 || month < 1 || month > 12) return false;
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return day >= 1 && day <= days[month - 1];
}

function weekKey(value: unknown): boolean {
  if (typeof value !== 'string') return false;
  const match = /^(\d{4})-W(\d{2})$/.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const week = Number(match[2]);
  if (year < 1 || year > 9_999 || week < 1 || week > 53) return false;
  if (week < 53) return true;
  const firstDay = new Date(0);
  firstDay.setUTCHours(0, 0, 0, 0);
  firstDay.setUTCFullYear(year, 0, 1);
  const weekday = firstDay.getUTCDay();
  const leap = year % 400 === 0 || (year % 4 === 0 && year % 100 !== 0);
  return weekday === 4 || (weekday === 3 && leap);
}
