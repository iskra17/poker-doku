import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { getCollectionItemDefinition } from '@/lib/collection/catalog';
import { pointsForPlace } from '@/lib/arena/rules';
import type { ArenaTier } from '@/lib/arena/types';
import { ArenaRepository } from './arena-repository';
import {
  ArenaService,
  getArenaKstWeekKey,
} from './arena-service';
import { openPokerDatabase, type PokerDatabase } from './persistence/database';
import { ProfileRepository } from './profile-repository';
import { ProgressionRepository } from './progression-repository';

const EPOCH = Date.parse('2026-07-20T00:00:00+09:00');
const DAY = 24 * 60 * 60 * 1_000;
const BOUNDARY = EPOCH + 28 * DAY;
const SEASON_ID = 'arena-v1-0';
const NEXT_SEASON_ID = 'arena-v1-1';

describe('Arena season settlement and rewards', () => {
  let database: PokerDatabase;
  let repository: ArenaRepository;
  let progression: ProgressionRepository;
  let service: ArenaService;

  beforeEach(() => {
    database = openPokerDatabase(':memory:');
    repository = new ArenaRepository(database);
    progression = new ProgressionRepository(database);
    service = arenaService(repository, 0);
  });

  afterEach(() => database.close());

  it('ranks every official human including placement and enforces 100/10/1 boundaries', () => {
    service.reconcile(EPOCH);
    const profileIds = Array.from(
      { length: 102 },
      (_, index) => `rank-${String(index + 1).padStart(3, '0')}`,
    );
    for (const [index, profileId] of profileIds.entries()) {
      addProfile(
        database,
        progression,
        repository,
        profileId,
        index === 0 ? null : 'bronze',
        1_000,
      );
    }
    addProfile(
      database,
      progression,
      repository,
      'training-only',
      'master',
      1_500,
    );
    for (let index = 0; index < profileIds.length; index += 2) {
      seedFinishedOfficialMatch(
        database,
        `ranking-${index / 2}`,
        [
          [profileIds[index], 1],
          [profileIds[index + 1], 2],
        ],
        EPOCH + index + 1,
      );
    }

    const ranked = repository.listSeasonStandings(SEASON_ID);
    expect(ranked).toHaveLength(102);
    expect(ranked.some(row => row.profileId === profileIds[0])).toBe(true);
    expect(ranked.some(row => row.profileId === 'training-only')).toBe(false);

    service.reconcile(BOUNDARY);

    const results = repository.listSeasonResults(SEASON_ID);
    expect(results.map(result => result.profileId))
      .toEqual(ranked.map(result => result.profileId));
    expect(results.map(result => result.finalRank))
      .toEqual(Array.from({ length: 102 }, (_, index) => index + 1));
    const atRank = (rank: number) => results[rank - 1].profileId;
    expect(rewardKeys(repository, atRank(100))).toEqual([
      'top100-chroma',
      'top100-title',
    ]);
    expect(rewardKeys(repository, atRank(101))).toEqual([]);
    expect(rewardKeys(repository, atRank(10))).toEqual([
      'rank-10-title',
      'top100-chroma',
      'top100-title',
    ]);
    expect(rewardKeys(repository, atRank(11))).toEqual([
      'top100-chroma',
      'top100-title',
    ]);
    expect(rewardKeys(repository, atRank(1))).toEqual([
      'champion-aura',
      'champion-trophy',
      'rank-1-title',
      'top100-chroma',
      'top100-title',
    ]);
    expect(rewardKeys(repository, atRank(2))).toEqual([
      'rank-2-title',
      'top100-chroma',
      'top100-title',
    ]);
    expect(repository.findHallOfFame(SEASON_ID)).toMatchObject({
      profileId: atRank(1),
      finalRank: 1,
    });
    expect(repository.listSeasonRewards(SEASON_ID, 'training-only')).toEqual([]);
  });

  it('awards cumulative match and final-tier cosmetics then soft-resets once', () => {
    service.reconcile(EPOCH);
    const profiles: Array<[string, ArenaTier, number]> = [
      ['tier-silver', 'silver', 900],
      ['tier-gold', 'gold', 1_100],
      ['tier-platinum', 'platinum', 1_200],
      ['tier-diamond', 'diamond', 1_300],
      ['tier-master', 'master', 1_401],
      ['tier-bronze', 'bronze', 800],
    ];
    for (const [profileId, tier, mmr] of profiles) {
      addProfile(database, progression, repository, profileId, tier, mmr);
    }
    for (let round = 0; round < 10; round += 1) {
      seedFinishedOfficialMatch(database, `tier-a-${round}`, [
        ['tier-silver', 1],
        ['tier-gold', 2],
      ], EPOCH + round + 1);
      seedFinishedOfficialMatch(database, `tier-b-${round}`, [
        ['tier-platinum', 3],
        ['tier-diamond', 4],
      ], EPOCH + round + 20);
      seedFinishedOfficialMatch(database, `tier-c-${round}`, [
        ['tier-master', 5],
        ['tier-bronze', 6],
      ], EPOCH + round + 40);
    }
    const oldMaster = repository.requireProfile(SEASON_ID, 'tier-master');

    service.reconcile(BOUNDARY);

    expect(rewardKeys(repository, 'tier-silver')).toContain(
      'participation-emblem',
    );
    expect(rewardKeys(repository, 'tier-silver')).not.toContain('gold-frame');
    expect(rewardKeys(repository, 'tier-gold')).toEqual(expect.arrayContaining([
      'participation-emblem',
      'gold-frame',
    ]));
    expect(rewardKeys(repository, 'tier-platinum')).toEqual(
      expect.arrayContaining(['participation-emblem', 'gold-frame']),
    );
    expect(rewardKeys(repository, 'tier-diamond')).toEqual(
      expect.arrayContaining([
        'participation-emblem',
        'gold-frame',
        'diamond-featured-skin',
      ]),
    );
    expect(rewardKeys(repository, 'tier-master')).toEqual(
      expect.arrayContaining([
        'participation-emblem',
        'gold-frame',
        'diamond-featured-skin',
        'master-cutin',
      ]),
    );
    expect(repository.requireProfile(SEASON_ID, 'tier-master'))
      .toEqual(oldMaster);
    expect(repository.requireProfile(NEXT_SEASON_ID, 'tier-master'))
      .toMatchObject({
        placementGames: 5,
        placementPoints: 0,
        tier: 'diamond',
        mmr: 1_201,
      });
    const rewardCount = countRows(database, 'arena_season_rewards');
    const inventoryCount = countArenaInventory(database);
    service.reconcile(BOUNDARY + 1);
    expect(countRows(database, 'arena_season_rewards')).toBe(rewardCount);
    expect(countArenaInventory(database)).toBe(inventoryCount);

    service.reserveMatchTickets(
      'next-season-first',
      ['tier-master', 'tier-diamond'],
      BOUNDARY + 2,
    );
    service.markMatchPlaying('next-season-first', BOUNDARY + 2);
    service.settleOfficialMatch(
      'next-season-first',
      sixSeatResult([
        ['tier-master', 1],
        ['tier-diamond', 2],
      ]),
      BOUNDARY + 3,
    );
    expect(repository.findGroupMember(
      NEXT_SEASON_ID,
      getArenaKstWeekKey(BOUNDARY + 3),
      'tier-master',
    )).not.toBeNull();
  });

  it('suppresses every scarce preseason reward and exposes the preview flag', () => {
    service = arenaService(repository, 1);
    service.reconcile(EPOCH);
    for (const profileId of ['pre-a', 'pre-b']) {
      addProfile(
        database,
        progression,
        repository,
        profileId,
        'master',
        1_400,
      );
    }
    expect(service.getSnapshot('pre-a', EPOCH).season)
      .toMatchObject({ preseasonScarceRewardsSuppressed: true });
    for (let round = 0; round < 10; round += 1) {
      seedFinishedOfficialMatch(database, `pre-${round}`, [
        ['pre-a', 1],
        ['pre-b', 2],
      ], EPOCH + round + 1);
    }

    service.reconcile(BOUNDARY);

    expect(rewardKeys(repository, 'pre-a')).toEqual([
      'participation-emblem',
    ]);
    expect(rewardKeys(repository, 'pre-b')).toEqual([
      'participation-emblem',
    ]);
    expect(repository.findHallOfFame(SEASON_ID)).toBeNull();
    expect(service.getSnapshot('pre-a', EPOCH).season)
      .toMatchObject({ preseasonScarceRewardsSuppressed: true });
  });

  it('rolls reward, ranking, marker, and reset back together then retries safely', () => {
    service.reconcile(EPOCH);
    for (const profileId of ['atomic-a', 'atomic-b']) {
      addProfile(
        database,
        progression,
        repository,
        profileId,
        'gold',
        1_200,
      );
    }
    for (let round = 0; round < 10; round += 1) {
      seedFinishedOfficialMatch(database, `atomic-${round}`, [
        ['atomic-a', 1],
        ['atomic-b', 2],
      ], EPOCH + round + 1);
    }
    const badItemId = `${SEASON_ID}-participation-emblem`;
    database.db.prepare(`
      INSERT INTO inventory_items (
        profile_id, item_id, quantity, granted_at, updated_at
      ) VALUES (?, ?, 1, ?, ?)
    `).run('atomic-a', badItemId, EPOCH, EPOCH);

    expect(() => service.reconcile(BOUNDARY))
      .toThrowError(/arena reward inventory mismatch/u);
    expect(repository.findSeasonSettlement(SEASON_ID)).toBeNull();
    expect(repository.listSeasonResults(SEASON_ID)).toEqual([]);
    expect(repository.listSeasonRewards(SEASON_ID, 'atomic-a')).toEqual([]);
    expect(repository.findProfile(NEXT_SEASON_ID, 'atomic-a')).toBeNull();
    database.db.prepare(`
      DELETE FROM inventory_items WHERE profile_id = ? AND item_id = ?
    `).run('atomic-a', badItemId);

    service.reconcile(BOUNDARY + 1);
    expect(repository.findSeasonSettlement(SEASON_ID)).not.toBeNull();
    expect(repository.listSeasonResults(SEASON_ID)).toHaveLength(2);
    expect(repository.findProfile(NEXT_SEASON_ID, 'atomic-a')).not.toBeNull();

    const restarted = arenaService(repository, 0);
    restarted.reconcile(BOUNDARY + 2);
    expect(repository.listSeasonResults(SEASON_ID)).toHaveLength(2);
    expect(repository.listSeasonRewards(SEASON_ID, 'atomic-a').length)
      .toBe(countArenaInventoryForProfile(database, 'atomic-a'));
  });

  it('settles week four before snapshotting rewards and the reset tier', () => {
    service.reconcile(EPOCH);
    addProfile(
      database,
      progression,
      repository,
      'ordered-a',
      'silver',
      1_100,
    );
    addProfile(
      database,
      progression,
      repository,
      'ordered-b',
      'bronze',
      900,
    );
    const weekFourAt = EPOCH + 21 * DAY;
    const weekKey = getArenaKstWeekKey(weekFourAt);
    repository.transaction(tx => {
      tx.insertGroup({
        id: 'ordered-week-four',
        seasonId: SEASON_ID,
        weekKey,
        tier: 'silver',
        status: 'open',
        createdAt: weekFourAt,
        settledAt: null,
      });
      tx.insertGroupMember({
        groupId: 'ordered-week-four',
        seasonId: SEASON_ID,
        weekKey,
        profileId: 'ordered-a',
        points: 100,
        wins: 1,
        top3: 3,
        placeSum: 6,
        matches: 3,
        scoreReachedAt: weekFourAt,
        joinedAt: weekFourAt,
        updatedAt: weekFourAt,
      });
    });
    seedFinishedOfficialMatch(database, 'ordered-official', [
      ['ordered-a', 1],
      ['ordered-b', 2],
    ], weekFourAt + 1);

    service.reconcile(BOUNDARY);

    expect(repository.requireGroup('ordered-week-four').status).toBe('settled');
    expect(repository.listSeasonResults(SEASON_ID)
      .find(result => result.profileId === 'ordered-a')?.finalTier).toBe('gold');
    expect(rewardKeys(repository, 'ordered-a')).toContain('gold-frame');
    expect(repository.requireProfile(NEXT_SEASON_ID, 'ordered-a').tier)
      .toBe('silver');
  });

  it('settles and resets before a boundary snapshot can create a fresh profile', () => {
    service.reconcile(EPOCH);
    addProfile(
      database,
      progression,
      repository,
      'boundary-first',
      'master',
      1_400,
    );

    const snapshot = service.getSnapshot('boundary-first', BOUNDARY);

    expect(repository.findSeasonSettlement(SEASON_ID)).not.toBeNull();
    expect(repository.requireProfile(NEXT_SEASON_ID, 'boundary-first'))
      .toMatchObject({
        placementGames: 5,
        placementPoints: 0,
        tier: 'diamond',
        mmr: 1_200,
      });
    expect(snapshot.profile).toMatchObject({
      placementGames: 5,
      placementPoints: 0,
      tier: 'diamond',
    });
  });

  it('cascades a deleted champion while preserving unrelated season history', () => {
    service.reconcile(EPOCH);
    for (const profileId of ['deleted-champion', 'kept-champion']) {
      addProfile(
        database,
        progression,
        repository,
        profileId,
        'master',
        1_400,
      );
    }
    for (let round = 0; round < 10; round += 1) {
      seedFinishedOfficialMatch(database, `delete-${round}`, [
        ['deleted-champion', 1],
        ['kept-champion', 2],
      ], EPOCH + round + 1);
    }
    service.reconcile(BOUNDARY);
    seedFinishedOfficialMatch(
      database,
      'kept-next-championship',
      [
        ['kept-champion', 1],
        ['deleted-champion', 2],
      ],
      BOUNDARY + 1,
      NEXT_SEASON_ID,
    );
    const secondBoundary = BOUNDARY + 28 * DAY;
    service.reconcile(secondBoundary);
    expect(repository.findHallOfFame(SEASON_ID)?.profileId)
      .toBe('deleted-champion');
    expect(repository.findHallOfFame(NEXT_SEASON_ID)?.profileId)
      .toBe('kept-champion');
    expect(() => database.db.prepare(`
      DELETE FROM arena_season_results
      WHERE season_id = ? AND profile_id = ?
    `).run(SEASON_ID, 'deleted-champion'))
      .toThrowError('arena season result is immutable');

    expect(new ProfileRepository(database).deleteProfile('deleted-champion'))
      .toBe('deleted');

    expect(countOwnedRows(database, 'profiles', 'id', 'deleted-champion'))
      .toBe(0);
    for (const table of [
      'arena_profiles',
      'arena_season_results',
      'arena_season_rewards',
      'inventory_items',
    ]) {
      expect(countOwnedRows(
        database,
        table,
        'profile_id',
        'deleted-champion',
      )).toBe(0);
    }
    expect(repository.findHallOfFame(SEASON_ID)).toBeNull();
    expect(repository.findSeasonSettlement(SEASON_ID)).not.toBeNull();
    expect(countOwnedRows(database, 'profiles', 'id', 'kept-champion'))
      .toBe(1);
    expect(countOwnedRows(
      database,
      'arena_season_results',
      'profile_id',
      'kept-champion',
    )).toBe(2);
    expect(countOwnedRows(
      database,
      'arena_season_rewards',
      'profile_id',
      'kept-champion',
    )).toBeGreaterThan(0);
    expect(countOwnedRows(
      database,
      'inventory_items',
      'profile_id',
      'kept-champion',
    )).toBeGreaterThan(0);
    expect(repository.findHallOfFame(NEXT_SEASON_ID)?.profileId)
      .toBe('kept-champion');
    expect(database.db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
  });
});

function arenaService(
  repository: ArenaRepository,
  preseasonCount: number,
): ArenaService {
  return new ArenaService(repository, {
    epochMs: EPOCH,
    preseasonCount,
    clock: () => EPOCH,
    isProfileInNonArenaSeat: () => false,
  });
}

function addProfile(
  database: PokerDatabase,
  progression: ProgressionRepository,
  repository: ArenaRepository,
  profileId: string,
  tier: ArenaTier | null,
  mmr: number,
): void {
  database.db.prepare(`
    INSERT INTO profiles (
      id, credential_hash, credential_lookup, recovery_hash, recovery_lookup,
      alias, avatar_id, adult_confirmed_at, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, 'sakura', 1, 1, 1)
  `).run(
    profileId,
    `ch-${profileId}`,
    `cl-${profileId}`,
    `rh-${profileId}`,
    `rl-${profileId}`,
    `alias-${profileId}`,
  );
  progression.getOrCreate(profileId, 'sakura', EPOCH);
  repository.createProfile({
    seasonId: SEASON_ID,
    profileId,
    availableTickets: 2,
    lastDailyGrantDate: '2026-07-20',
    placementGames: tier === null ? 0 : 5,
    placementPoints: tier === null ? 0 : 175,
    tier,
    mmr,
    createdAt: EPOCH,
    updatedAt: EPOCH,
  });
}

function seedFinishedOfficialMatch(
  database: PokerDatabase,
  matchId: string,
  results: readonly [profileId: string, place: number][],
  settledAt: number,
  seasonId = SEASON_ID,
): void {
  database.db.prepare(`
    INSERT INTO arena_matches (
      id, season_id, config_version, bot_version, bot_mmr,
      human_count, bot_count, status, created_at, started_at, finished_at
    ) VALUES (?, ?, 1, 'arena-v1-hard', 1000, ?, ?, 'finished', ?, ?, ?)
  `).run(
    matchId,
    seasonId,
    results.length,
    6 - results.length,
    settledAt - 2,
    settledAt - 1,
    settledAt,
  );
  const insert = database.db.prepare(`
    INSERT INTO arena_entries (
      match_id, season_id, profile_id, place, points, mmr_before, mmr_after,
      result_key, created_at, settled_at
    ) VALUES (?, ?, ?, ?, ?, 1000, 1000, ?, ?, ?)
  `);
  for (const [profileId, place] of results) {
    insert.run(
      matchId,
      seasonId,
      profileId,
      place,
      pointsForPlace(place),
      `${matchId}:${profileId}`,
      settledAt - 2,
      settledAt,
    );
  }
}

function rewardKeys(
  repository: ArenaRepository,
  profileId: string,
): string[] {
  return repository.listSeasonRewards(SEASON_ID, profileId)
    .map(reward => getCollectionItemDefinition(reward.itemId)?.source)
    .flatMap(source =>
      source?.kind === 'arena-season' ? [source.rewardKey] : [],
    )
    .sort();
}

function sixSeatResult(
  humans: readonly [profileId: string, place: number][],
) {
  const humanPlaces = new Set(humans.map(([, place]) => place));
  const remainingPlaces = [1, 2, 3, 4, 5, 6]
    .filter(place => !humanPlaces.has(place));
  return [
    ...humans.map(([playerId, place]) => ({
      playerId,
      place,
      type: 'human' as const,
    })),
    ...remainingPlaces.map((place, index) => ({
      playerId: `bot-${index}`,
      place,
      type: 'bot' as const,
    })),
  ];
}

function countRows(database: PokerDatabase, table: string): number {
  return (database.db.prepare(`
    SELECT COUNT(*) AS count FROM ${table}
  `).get() as { count: number }).count;
}

function countOwnedRows(
  database: PokerDatabase,
  table: string,
  ownerColumn: string,
  profileId: string,
): number {
  return (database.db.prepare(`
    SELECT COUNT(*) AS count FROM ${table} WHERE ${ownerColumn} = ?
  `).get(profileId) as { count: number }).count;
}

function countArenaInventory(database: PokerDatabase): number {
  return (database.db.prepare(`
    SELECT COUNT(*) AS count FROM inventory_items
    WHERE item_id LIKE 'arena-v1-%'
  `).get() as { count: number }).count;
}

function countArenaInventoryForProfile(
  database: PokerDatabase,
  profileId: string,
): number {
  return (database.db.prepare(`
    SELECT COUNT(*) AS count FROM inventory_items
    WHERE profile_id = ? AND item_id LIKE 'arena-v1-%'
  `).get(profileId) as { count: number }).count;
}
