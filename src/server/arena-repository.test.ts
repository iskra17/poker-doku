import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openPokerDatabase, type PokerDatabase } from './persistence/database';
import {
  ArenaPersistenceError,
  ArenaRepository,
} from './arena-repository';

describe('ArenaRepository', () => {
  let database: PokerDatabase;
  let repository: ArenaRepository;

  beforeEach(() => {
    database = openPokerDatabase(':memory:');
    repository = new ArenaRepository(database);
    insertProfile(database, 'profile-a');
    insertProfile(database, 'profile-b');
  });

  afterEach(() => database.close());

  it('atomically creates a season profile and returns a redacted public snapshot', () => {
    repository.transaction(tx => {
      tx.insertSeason(season());
      tx.insertProfile(arenaProfile('profile-a'));
    });

    expect(repository.getPublicSnapshot('season-0', 'profile-a')).toEqual({
      season: {
        preseason: true,
        startsAt: 1_000,
        endsAt: 2_000,
      },
      profile: {
        availableTickets: 2,
        placementGames: 0,
        placementPoints: 0,
        tier: null,
      },
    });
    expect(Object.keys(repository.getPublicSnapshot(
      'season-0',
      'profile-a',
    )?.profile ?? {})).toEqual([
      'availableTickets', 'placementGames', 'placementPoints', 'tier',
    ]);
    const serialized = JSON.stringify(repository.getPublicSnapshot(
      'season-0',
      'profile-a',
    ));
    for (const forbidden of [
      'mmr', 'profile-a', 'season-0', 'credential', 'recovery', 'token',
    ]) {
      expect(serialized).not.toContain(forbidden);
    }
  });

  it('maps complete internal season and profile rows for server-only rules', () => {
    repository.createSeason(season());
    repository.createProfile(arenaProfile('profile-a'));

    expect(repository.requireSeason('season-0')).toEqual(season());
    expect(repository.requireProfile('season-0', 'profile-a')).toEqual(
      arenaProfile('profile-a'),
    );
  });

  it('writes and maps forming matches entries and active ticket escrows', () => {
    repository.createSeason(season());
    repository.createProfile(arenaProfile('profile-a'));
    repository.createProfile(arenaProfile('profile-b'));
    repository.transaction(tx => {
      tx.insertMatch(match());
      tx.insertEntry(entry('profile-a'));
      tx.insertEntry(entry('profile-b'));
      tx.insertTicketEscrow({
        matchId: 'match-a',
        profileId: 'profile-a',
        status: 'escrow',
        createdAt: 1_100,
        settledAt: null,
      });
    });

    expect(repository.requireMatch('match-a')).toEqual(match());
    expect(repository.listMatchEntries('match-a')).toEqual([
      entry('profile-a'), entry('profile-b'),
    ]);
    expect(repository.findActiveTicketEscrow('profile-a')).toEqual({
      matchId: 'match-a',
      profileId: 'profile-a',
      status: 'escrow',
      createdAt: 1_100,
      settledAt: null,
    });
  });

  it('rolls back all typed transaction writes when work throws', () => {
    expect(() => repository.transaction(tx => {
      tx.insertSeason(season());
      tx.insertProfile(arenaProfile('profile-a'));
      throw new Error('rollback');
    })).toThrowError('rollback');

    expect(repository.findSeason('season-0')).toBeNull();
    expect(repository.findProfile('season-0', 'profile-a')).toBeNull();
  });

  it('fails closed when a persisted tier or match status is unknown', () => {
    repository.createSeason(season());
    repository.createProfile(arenaProfile('profile-a'));
    repository.createMatch(match());
    database.db.exec('PRAGMA ignore_check_constraints=ON');
    database.db.prepare(`
      UPDATE arena_profiles SET tier = 'legend', placement_games = 5
      WHERE season_id = 'season-0' AND profile_id = 'profile-a'
    `).run();
    const matchUpdateTrigger = database.db.prepare(`
      SELECT sql FROM sqlite_schema
      WHERE type = 'trigger' AND name = 'protect_arena_match_update'
    `).get() as { sql: string };
    database.db.exec('DROP TRIGGER protect_arena_match_update');
    database.db.prepare(`
      UPDATE arena_matches SET status = 'corrupt'
      WHERE id = 'match-a'
    `).run();
    database.db.exec(matchUpdateTrigger.sql);
    database.db.exec('PRAGMA ignore_check_constraints=OFF');

    expectErrorCode(
      () => repository.requireProfile('season-0', 'profile-a'),
      'ARENA_PERSISTENCE_INVALID',
    );
    expectErrorCode(
      () => repository.requireMatch('match-a'),
      'ARENA_PERSISTENCE_INVALID',
    );
  });

  it('rejects unsafe timestamps and malformed typed writes before persistence', () => {
    expectErrorCode(
      () => repository.createSeason({ ...season(), endsAt: Number.NaN }),
      'ARENA_INPUT_INVALID',
    );
    repository.createSeason(season());
    expectErrorCode(
      () => repository.createProfile({
        ...arenaProfile('profile-a'),
        lastDailyGrantDate: '2026-02-30',
      }),
      'ARENA_INPUT_INVALID',
    );
    expectErrorCode(
      () => repository.createMatch({ ...match(), status: 'finished' }),
      'ARENA_INPUT_INVALID',
    );
    expect(repository.findProfile('season-0', 'profile-a')).toBeNull();
    expect(repository.findMatch('match-a')).toBeNull();
  });

  it('maps weekly groups and members without exposing storage access', () => {
    repository.createSeason(season());
    repository.createProfile(arenaProfile('profile-a'));
    repository.transaction(tx => {
      tx.insertGroup({
        id: 'group-a',
        seasonId: 'season-0',
        weekKey: '2026-W30',
        tier: 'bronze',
        status: 'open',
        createdAt: 1_100,
        settledAt: null,
      });
      tx.insertGroupMember({
        groupId: 'group-a',
        seasonId: 'season-0',
        weekKey: '2026-W30',
        profileId: 'profile-a',
        points: 0,
        wins: 0,
        top3: 0,
        placeSum: 0,
        matches: 0,
        scoreReachedAt: 1_100,
        joinedAt: 1_100,
        updatedAt: 1_100,
      });
    });

    expect(repository.requireGroup('group-a')).toMatchObject({
      tier: 'bronze', status: 'open', weekKey: '2026-W30',
    });
    expect(repository.listGroupMembers('group-a')).toEqual([
      expect.objectContaining({
        profileId: 'profile-a', points: 0, matches: 0,
      }),
    ]);
    expect('db' in repository).toBe(false);
    expect('database' in repository).toBe(false);
  });

  it('provides typed profile match and escrow updates for atomic lifecycle work', () => {
    repository.createSeason(season());
    repository.createProfile(arenaProfile('profile-a'));
    repository.transaction(tx => {
      tx.insertMatch(match());
      tx.insertTicketEscrow({
        matchId: 'match-a', profileId: 'profile-a', status: 'escrow',
        createdAt: 1_100, settledAt: null,
      });
    });

    repository.transaction(tx => {
      tx.updateProfile({
        ...arenaProfile('profile-a'), availableTickets: 1, updatedAt: 1_200,
      });
      tx.updateMatch({
        ...match(), status: 'playing', startedAt: 1_200,
      });
      tx.updateTicketEscrow({
        matchId: 'match-a', profileId: 'profile-a', status: 'consumed',
        createdAt: 1_100, settledAt: 1_200,
      });
    });

    expect(repository.requireProfile('season-0', 'profile-a'))
      .toMatchObject({ availableTickets: 1, updatedAt: 1_200 });
    expect(repository.requireMatch('match-a'))
      .toMatchObject({ status: 'playing', startedAt: 1_200 });
    expect(repository.requireTicketEscrow('match-a', 'profile-a'))
      .toMatchObject({ status: 'consumed', settledAt: 1_200 });
    expect(repository.findActiveTicketEscrow('profile-a')).toBeNull();
    expect(repository.listUnfinishedMatches()).toEqual([
      expect.objectContaining({ id: 'match-a', status: 'playing' }),
    ]);
  });

  it('writes idempotency markers and season rewards through typed transactions', () => {
    repository.createSeason(season());
    repository.createProfile(arenaProfile('profile-a'));
    repository.transaction(tx => {
      tx.insertGroup({
        id: 'group-a', seasonId: 'season-0', weekKey: '2026-W30',
        tier: 'bronze', status: 'settled', createdAt: 1_100,
        settledAt: 1_300,
      });
      tx.insertWeeklySettlement({
        seasonId: 'season-0', weekKey: '2026-W30', groupId: 'group-a',
        settledAt: 1_300,
      });
      tx.insertSeasonReward({
        seasonId: 'season-0', profileId: 'profile-a',
        itemId: 'arena-season-0-emblem', grantedAt: 1_400,
      });
    });

    expect(repository.findWeeklySettlement(
      'season-0', '2026-W30', 'group-a',
    )).toEqual({
      seasonId: 'season-0', weekKey: '2026-W30', groupId: 'group-a',
      settledAt: 1_300,
    });
    expect(repository.listSeasonRewards('season-0', 'profile-a')).toEqual([{
      seasonId: 'season-0', profileId: 'profile-a',
      itemId: 'arena-season-0-emblem', grantedAt: 1_400,
    }]);
  });
});

function compileTimeTransactionContract(repository: ArenaRepository): void {
  // @ts-expect-error Arena persistence transactions must remain synchronous.
  repository.transaction(async () => undefined);
}

void compileTimeTransactionContract;

function season() {
  return {
    id: 'season-0',
    ordinal: 0,
    configVersion: 1,
    preseason: true,
    startsAt: 1_000,
    endsAt: 2_000,
    createdAt: 900,
  } as const;
}

function arenaProfile(profileId: string) {
  return {
    seasonId: 'season-0',
    profileId,
    availableTickets: 2,
    lastDailyGrantDate: '2026-07-20',
    placementGames: 0,
    placementPoints: 0,
    tier: null,
    mmr: 1_000,
    createdAt: 1_000,
    updatedAt: 1_000,
  } as const;
}

function match() {
  return {
    id: 'match-a',
    seasonId: 'season-0',
    configVersion: 1,
    botVersion: 'arena-v1-hard',
    botMmr: 1_000,
    humanCount: 2,
    botCount: 4,
    status: 'forming',
    createdAt: 1_100,
    startedAt: null,
    finishedAt: null,
  } as const;
}

function entry(profileId: string) {
  return {
    matchId: 'match-a',
    profileId,
    place: null,
    points: null,
    mmrBefore: 1_000,
    mmrAfter: null,
    resultKey: null,
    createdAt: 1_100,
    settledAt: null,
  } as const;
}

function expectErrorCode(
  work: () => unknown,
  code: ArenaPersistenceError['code'],
): void {
  try {
    work();
    throw new Error('expected ArenaPersistenceError');
  } catch (error) {
    expect(error).toBeInstanceOf(ArenaPersistenceError);
    expect((error as ArenaPersistenceError).code).toBe(code);
  }
}

function insertProfile(database: PokerDatabase, id: string): void {
  database.db.prepare(`
    INSERT INTO profiles (
      id, credential_hash, credential_lookup, recovery_hash, recovery_lookup,
      alias, avatar_id, adult_confirmed_at, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, 'sakura', 1, 1, 1)
  `).run(
    id,
    `credential-hash-${id}`,
    `credential-lookup-${id}`,
    `recovery-hash-${id}`,
    `recovery-lookup-${id}`,
    `alias-${id}`,
  );
}
