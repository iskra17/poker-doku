import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import { getArenaSeasonRewardItems } from '@/lib/collection/catalog';
import { ArenaRepository } from './arena-repository';
import { ArenaService } from './arena-service';
import { openPokerDatabase, type PokerDatabase } from './persistence/database';
import { migrations } from './persistence/migrations';

const EPOCH = Date.parse('2026-07-20T00:00:00+09:00');
const DAY = 24 * 60 * 60 * 1_000;
const BOUNDARY = EPOCH + 28 * DAY;
const SEASON_ID = 'arena-v1-0';
const NEXT_SEASON_ID = 'arena-v1-1';
const PROFILE_IDS = ['legacy-champion', 'legacy-rival'] as const;

describe('legacy Arena season catalog upgrades', () => {
  let database: PokerDatabase | undefined;
  const temporaryDirectories: string[] = [];

  afterEach(() => {
    database?.close();
    database = undefined;
    for (const directory of temporaryDirectories.splice(0)) {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('settles a V17 season through snapshot and leaves requests unblocked', () => {
    const opened = openLegacySeason(false);
    database = opened.database;
    const { repository, service } = opened;
    expect(repository.listSeasonCatalog(SEASON_ID)).toEqual([]);

    const snapshot = service.getSnapshot(PROFILE_IDS[0], BOUNDARY);

    expect(snapshot.profile).toMatchObject({
      placementGames: 5,
      placementPoints: 0,
      tier: 'diamond',
    });
    expect(repository.listSeasonCatalog(SEASON_ID)).toHaveLength(18);
    expect(repository.listSeasonResults(SEASON_ID)).toHaveLength(2);
    expect(repository.findHallOfFame(SEASON_ID)?.profileId)
      .toBe(PROFILE_IDS[0]);
    expect(repository.findSeasonSettlement(SEASON_ID)).toMatchObject({
      nextSeasonId: NEXT_SEASON_ID,
      participantCount: 2,
    });
    expect(repository.findProfile(NEXT_SEASON_ID, PROFILE_IDS[0]))
      .not.toBeNull();
    expect(countRows(database, `
      SELECT COUNT(*) AS count FROM arena_season_rewards
      WHERE season_id = ?
    `, SEASON_ID)).toBeGreaterThan(0);
    expect(countRows(database, `
      SELECT COUNT(*) AS count FROM inventory_items
      WHERE item_id LIKE ?
    `, `${SEASON_ID}-%`)).toBe(countRows(database, `
      SELECT COUNT(*) AS count FROM arena_season_rewards
      WHERE season_id = ?
    `, SEASON_ID));

    const resultCount = repository.listSeasonResults(SEASON_ID).length;
    const rewardCount = countRows(database, `
      SELECT COUNT(*) AS count FROM arena_season_rewards
      WHERE season_id = ?
    `, SEASON_ID);
    service.reconcile(BOUNDARY + 1);
    expect(repository.listSeasonResults(SEASON_ID)).toHaveLength(resultCount);
    expect(countRows(database, `
      SELECT COUNT(*) AS count FROM arena_season_rewards
      WHERE season_id = ?
    `, SEASON_ID)).toBe(rewardCount);

    expect(service.reserveMatchTickets(
      'legacy-next-request',
      PROFILE_IDS,
      BOUNDARY + 2,
      NEXT_SEASON_ID,
    )).toMatchObject({
      seasonId: NEXT_SEASON_ID,
      status: 'forming',
    });
    expect(database.db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
  });

  it('rolls back missing catalog seeds around malformed legacy metadata', () => {
    const opened = openLegacySeason(false);
    database = opened.database;
    const { repository, service } = opened;
    const definitions = getArenaSeasonRewardItems(SEASON_ID);
    insertCatalog(database, definitions[0]);
    database.db.prepare(`
      INSERT INTO arena_season_catalog (
        season_id, item_id, reward_key, kind, equip_slot, character_id
      ) VALUES (?, ?, 'gold-frame', 'title', 'title', NULL)
    `).run(SEASON_ID, `${SEASON_ID}-gold-frame`);

    expect(() => service.getSnapshot(PROFILE_IDS[0], BOUNDARY))
      .toThrowError('ARENA_PERSISTENCE_INVALID');
    expect(countRows(database, `
      SELECT COUNT(*) AS count FROM arena_season_catalog
      WHERE season_id = ?
    `, SEASON_ID)).toBe(2);
    expect(repository.listSeasonResults(SEASON_ID)).toEqual([]);
    expect(repository.findSeasonSettlement(SEASON_ID)).toBeNull();
    expect(repository.findSeason(NEXT_SEASON_ID)).toBeNull();
    expect(countRows(database, `
      SELECT COUNT(*) AS count FROM arena_season_rewards
      WHERE season_id = ?
    `, SEASON_ID)).toBe(0);
    expect(countRows(database, `
      SELECT COUNT(*) AS count FROM inventory_items
      WHERE item_id LIKE ?
    `, `${SEASON_ID}-%`)).toBe(0);

    deleteMalformedCatalogRow(database, `${SEASON_ID}-gold-frame`);
    expect(service.getSnapshot(PROFILE_IDS[0], BOUNDARY + 1).profile)
      .toMatchObject({ placementGames: 5, tier: 'diamond' });
    expect(repository.listSeasonCatalog(SEASON_ID)).toHaveLength(18);
    expect(repository.findSeasonSettlement(SEASON_ID)).not.toBeNull();
    expect(database.db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
  });

  it('seeds a legacy preseason catalog but grants only participation emblems', () => {
    const opened = openLegacySeason(true);
    database = opened.database;
    const { repository, service } = opened;

    service.getSnapshot(PROFILE_IDS[0], BOUNDARY);

    expect(repository.listSeasonCatalog(SEASON_ID)).toHaveLength(18);
    for (const profileId of PROFILE_IDS) {
      expect(repository.listSeasonRewards(SEASON_ID, profileId)
        .map(reward => reward.itemId)).toEqual([
        `${SEASON_ID}-participation-emblem`,
      ]);
    }
    expect(repository.findHallOfFame(SEASON_ID)).toBeNull();
    expect(repository.findSeasonSettlement(SEASON_ID)).not.toBeNull();
    expect(database.db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
  });

  function openLegacySeason(preseason: boolean): {
    database: PokerDatabase;
    repository: ArenaRepository;
    service: ArenaService;
  } {
    const directory = mkdtempSync(join(tmpdir(), 'poker-doku-arena-v17-'));
    temporaryDirectories.push(directory);
    const path = join(directory, 'poker.sqlite');
    createLegacyV17Season(path, preseason);
    const openedDatabase = openPokerDatabase(path);
    const repository = new ArenaRepository(openedDatabase);
    expect(openedDatabase.db.prepare(`
      SELECT MAX(version) AS version FROM schema_migrations
    `).get()).toEqual({ version: 20 });
    expect(repository.listSeasonCatalog(SEASON_ID)).toEqual([]);
    return {
      database: openedDatabase,
      repository,
      service: new ArenaService(repository, {
        epochMs: EPOCH,
        preseasonCount: preseason ? 1 : 0,
        clock: () => BOUNDARY,
        isProfileInNonArenaSeat: () => false,
      }),
    };
  }
});

function createLegacyV17Season(path: string, preseason: boolean): void {
  const rawDatabase = new DatabaseSync(path, {
    enableForeignKeyConstraints: true,
  });
  try {
    rawDatabase.exec(`
      CREATE TABLE schema_migrations (
        version INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        applied_at INTEGER NOT NULL
      ) STRICT;
    `);
    const recordMigration = rawDatabase.prepare(`
      INSERT INTO schema_migrations (version, name, applied_at)
      VALUES (?, ?, ?)
    `);
    for (const migration of migrations) {
      if (migration.version > 17) break;
      rawDatabase.exec('BEGIN IMMEDIATE');
      try {
        rawDatabase.exec(migration.sql);
        recordMigration.run(migration.version, migration.name, migration.version);
        rawDatabase.exec('COMMIT');
      } catch (error) {
        rawDatabase.exec('ROLLBACK');
        throw error;
      }
    }

    const insertProfile = rawDatabase.prepare(`
      INSERT INTO profiles (
        id, credential_hash, credential_lookup, recovery_hash, recovery_lookup,
        alias, avatar_id, adult_confirmed_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, 'sakura', ?, ?, ?)
    `);
    for (const profileId of PROFILE_IDS) {
      insertProfile.run(
        profileId,
        `credential-${profileId}`,
        `credential-lookup-${profileId}`,
        `recovery-${profileId}`,
        `recovery-lookup-${profileId}`,
        profileId,
        EPOCH,
        EPOCH,
        EPOCH,
      );
    }
    rawDatabase.prepare(`
      INSERT INTO arena_seasons (
        id, ordinal, config_version, preseason, starts_at, ends_at, created_at
      ) VALUES (?, 0, 1, ?, ?, ?, ?)
    `).run(SEASON_ID, preseason ? 1 : 0, EPOCH, BOUNDARY, EPOCH);
    const insertArenaProfile = rawDatabase.prepare(`
      INSERT INTO arena_profiles (
        season_id, profile_id, available_tickets, last_daily_grant_date,
        placement_games, placement_points, tier, mmr, created_at, updated_at
      ) VALUES (?, ?, 2, '2026-07-20', 5, 175, 'master', 1400, ?, ?)
    `);
    for (const profileId of PROFILE_IDS) {
      insertArenaProfile.run(SEASON_ID, profileId, EPOCH, EPOCH);
    }

    const insertMatch = rawDatabase.prepare(`
      INSERT INTO arena_matches (
        id, season_id, config_version, bot_version, bot_mmr,
        human_count, bot_count, status, created_at, started_at, finished_at
      ) VALUES (?, ?, 1, 'arena-v1-hard', 1000, 2, 4, 'finished', ?, ?, ?)
    `);
    const insertEntry = rawDatabase.prepare(`
      INSERT INTO arena_entries (
        match_id, season_id, profile_id, place, points, mmr_before, mmr_after,
        result_key, created_at, settled_at
      ) VALUES (?, ?, ?, ?, ?, 1400, 1400, ?, ?, ?)
    `);
    for (let round = 0; round < 10; round += 1) {
      const matchId = `legacy-finished-${round}`;
      const settledAt = EPOCH + round + 3;
      insertMatch.run(
        matchId,
        SEASON_ID,
        settledAt - 2,
        settledAt - 1,
        settledAt,
      );
      insertEntry.run(
        matchId,
        SEASON_ID,
        PROFILE_IDS[0],
        1,
        100,
        `${matchId}:${PROFILE_IDS[0]}`,
        settledAt - 2,
        settledAt,
      );
      insertEntry.run(
        matchId,
        SEASON_ID,
        PROFILE_IDS[1],
        2,
        60,
        `${matchId}:${PROFILE_IDS[1]}`,
        settledAt - 2,
        settledAt,
      );
    }
  } finally {
    rawDatabase.close();
  }
}

function insertCatalog(
  database: PokerDatabase,
  definition: ReturnType<typeof getArenaSeasonRewardItems>[number],
): void {
  database.db.prepare(`
    INSERT INTO arena_season_catalog (
      season_id, item_id, reward_key, kind, equip_slot, character_id
    ) VALUES (?, ?, ?, ?, ?, ?)
  `).run(
    definition.source.seasonId,
    definition.id,
    definition.source.rewardKey,
    definition.kind,
    definition.equipSlot,
    definition.characterId ?? null,
  );
}

function deleteMalformedCatalogRow(
  database: PokerDatabase,
  itemId: string,
): void {
  const trigger = database.db.prepare(`
    SELECT sql FROM sqlite_schema
    WHERE type = 'trigger' AND name = 'freeze_arena_season_catalog_delete'
  `).get() as { sql: string };
  database.db.exec('DROP TRIGGER freeze_arena_season_catalog_delete');
  try {
    database.db.prepare(`
      DELETE FROM arena_season_catalog WHERE item_id = ?
    `).run(itemId);
  } finally {
    database.db.exec(trigger.sql);
  }
}

function countRows(
  database: PokerDatabase,
  sql: string,
  parameter: string,
): number {
  return (database.db.prepare(sql).get(parameter) as { count: number }).count;
}
