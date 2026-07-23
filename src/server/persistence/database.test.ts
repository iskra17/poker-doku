import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { openPokerDatabase, type PokerDatabase } from './database';
import { ProfileRepository } from '../profile-repository';
import { ProgressionRepository } from '../progression-repository';
import { ArenaRepository } from '../arena-repository';
import { COLLECTION_CATALOG } from '@/lib/collection/catalog';
import { parseProgressionRewardSummary } from '@/lib/progression/reward-summary';
import {
  type Migration,
  migrations,
  validateMigrations,
} from './migrations';

describe('PokerDatabase migrations', () => {
  let database: PokerDatabase | undefined;
  const temporaryDirectories: string[] = [];

  afterEach(() => {
    database?.close();
    database = undefined;
    vi.restoreAllMocks();
    for (const directory of temporaryDirectories.splice(0)) {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('adds the V18 immutable Arena season settlement proof schema', () => {
    database = openPokerDatabase(':memory:');

    expect(database.db.prepare(`
      SELECT MAX(version) AS version FROM schema_migrations
    `).get()).toEqual({ version: 24 });
    expect(database.tableNames()).toEqual(expect.arrayContaining([
      'arena_season_catalog',
      'arena_season_results',
      'arena_season_settlements',
      'arena_hall_of_fame',
    ]));
    const indexes = database.db.prepare(`
      SELECT name FROM sqlite_schema WHERE type = 'index'
    `).all().map(row => (row as { name: string }).name);
    expect(indexes).toEqual(expect.arrayContaining([
      'idx_arena_entries_season_final_rank',
      'idx_arena_season_results_rank',
    ]));
    const triggers = database.db.prepare(`
      SELECT name FROM sqlite_schema WHERE type = 'trigger'
    `).all().map(row => (row as { name: string }).name);
    expect(triggers).toEqual(expect.arrayContaining([
      'sync_arena_season_reward_inventory',
      'protect_arena_season_reward_inventory_update',
      'protect_arena_season_reward_inventory_delete',
      'freeze_arena_season_result_update',
      'freeze_arena_season_result_delete',
      'freeze_arena_season_settlement_update',
      'freeze_arena_season_settlement_delete',
      'freeze_arena_hall_of_fame_update',
      'freeze_arena_hall_of_fame_delete',
    ]));
  });

  it('upgrades V17 Arena data once and uses the final-ranking index', () => {
    const directory = mkdtempSync(join(tmpdir(), 'poker-doku-'));
    temporaryDirectories.push(directory);
    const path = join(directory, 'poker.sqlite');
    createV17Database(path);
    const rawDatabase = new DatabaseSync(path);
    insertV15CompleteArenaFixture(rawDatabase);
    rawDatabase.close();

    database = openPokerDatabase(path);
    const plan = database.db.prepare(`
      EXPLAIN QUERY PLAN
      SELECT
        entries.profile_id,
        SUM(entries.points) AS points,
        SUM(CASE WHEN entries.place = 1 THEN 1 ELSE 0 END) AS wins,
        SUM(CASE WHEN entries.place <= 3 THEN 1 ELSE 0 END) AS top3,
        SUM(entries.place) AS place_sum,
        COUNT(*) AS matches,
        COALESCE(
          MAX(CASE WHEN entries.points > 0 THEN entries.settled_at END),
          MIN(entries.settled_at)
        ) AS score_reached_at
      FROM arena_entries AS entries
      INNER JOIN arena_matches AS matches
        ON matches.id = entries.match_id
        AND matches.season_id = entries.season_id
      WHERE entries.season_id = ?
        AND matches.status = 'finished'
        AND entries.result_key IS NOT NULL
      GROUP BY entries.profile_id
    `).all('v14-season').map(row => (row as { detail: string }).detail);

    expect(database.db.prepare(`
      SELECT MAX(version) AS version FROM schema_migrations
    `).get()).toEqual({ version: 24 });
    expect(new ArenaRepository(database)
      .requireProfile('v14-season', 'v1-marker').mmr).toBe(1_000);
    expect(database.db.prepare(`
      SELECT COUNT(*) AS count FROM arena_season_rewards
      WHERE season_id = 'v14-season' AND profile_id = 'v1-marker'
    `).get()).toEqual({ count: 1 });
    expect(plan.some(detail =>
      detail.includes('idx_arena_entries_season_final_rank'),
    )).toBe(true);

    database.close();
    database = openPokerDatabase(path);
    expect(database.db.prepare(`
      SELECT COUNT(*) AS count FROM schema_migrations WHERE version = 18
    `).get()).toEqual({ count: 1 });
    expect(new ArenaRepository(database)
      .listGroupMembers('v15-open-group')).toHaveLength(1);
  });

  it('rolls back every V18 table and marker on a mid-migration failure', () => {
    const directory = mkdtempSync(join(tmpdir(), 'poker-doku-'));
    temporaryDirectories.push(directory);
    const path = join(directory, 'poker.sqlite');
    createV17Database(path);
    const rawDatabase = new DatabaseSync(path);
    insertV15CompleteArenaFixture(rawDatabase);
    rawDatabase.exec(`
      CREATE TABLE arena_hall_of_fame (sentinel INTEGER PRIMARY KEY) STRICT;
    `);
    rawDatabase.close();

    expect(() => openPokerDatabase(path)).toThrow();

    const verificationDatabase = new DatabaseSync(path);
    try {
      expect(verificationDatabase.prepare(`
        SELECT MAX(version) AS version FROM schema_migrations
      `).get()).toEqual({ version: 17 });
      for (const table of [
        'arena_season_catalog',
        'arena_season_results',
        'arena_season_settlements',
      ]) {
        expect(verificationDatabase.prepare(`
          SELECT name FROM sqlite_schema WHERE type = 'table' AND name = ?
        `).get(table)).toBeUndefined();
      }
      expect(verificationDatabase.prepare(`
        SELECT name FROM sqlite_schema
        WHERE type = 'table' AND name = 'arena_hall_of_fame'
      `).get()).toEqual({ name: 'arena_hall_of_fame' });
      expect(verificationDatabase.prepare(`
        SELECT status FROM arena_groups WHERE id = 'v15-open-group'
      `).get()).toEqual({ status: 'open' });
      expect(verificationDatabase.prepare(`
        SELECT COUNT(*) AS count FROM arena_season_rewards
        WHERE season_id = 'v14-season' AND profile_id = 'v1-marker'
      `).get()).toEqual({ count: 1 });
    } finally {
      verificationDatabase.close();
    }
  });

  it('adds V19 settlement-frozen weekly ranks to Arena entries', () => {
    database = openPokerDatabase(':memory:');

    const columns = database.db.prepare('PRAGMA table_info(arena_entries)')
      .all().map(column => (column as { name: string }).name);
    expect(columns).toEqual(expect.arrayContaining([
      'weekly_rank_before',
      'weekly_rank_after',
    ]));

    insertArenaFixture(database, 'arena-ranked');
    insertArenaMatch(database, 'rank-match', 'arena-ranked');
    database.db.exec(`
      UPDATE arena_matches SET status = 'playing', started_at = 20
      WHERE id = 'rank-match';
      UPDATE arena_matches SET status = 'finished', finished_at = 30
      WHERE id = 'rank-match';
    `);

    expect(() => database?.db.prepare(`
      INSERT INTO arena_entries VALUES (
        'rank-match', 'season-v1', 'arena-ranked',
        NULL, NULL, 1000, NULL, NULL, 10, NULL, NULL, 1
      )
    `).run()).toThrow();
    expect(() => database?.db.prepare(`
      INSERT INTO arena_entries VALUES (
        'rank-match', 'season-v1', 'arena-ranked',
        1, 100, 1000, 1016, 'rank-result', 10, 30, 2, NULL
      )
    `).run()).toThrow();

    database.db.exec(`
      INSERT INTO arena_entries VALUES (
        'rank-match', 'season-v1', 'arena-ranked',
        NULL, NULL, 1000, NULL, NULL, 10, NULL, NULL, NULL
      );
      UPDATE arena_entries
      SET place = 1, points = 100, mmr_after = 1016,
          result_key = 'rank-result', settled_at = 30,
          weekly_rank_before = 2, weekly_rank_after = 1
      WHERE match_id = 'rank-match' AND profile_id = 'arena-ranked';
    `);

    expect(database.db.prepare(`
      SELECT weekly_rank_before, weekly_rank_after FROM arena_entries
      WHERE match_id = 'rank-match' AND profile_id = 'arena-ranked'
    `).get()).toEqual({ weekly_rank_before: 2, weekly_rank_after: 1 });
    expect(() => database?.db.prepare(`
      UPDATE arena_entries SET weekly_rank_after = 5
      WHERE match_id = 'rank-match' AND profile_id = 'arena-ranked'
    `).run()).toThrow();
    expect(() => database?.db.prepare(`
      UPDATE arena_entries SET weekly_rank_before = NULL
      WHERE match_id = 'rank-match' AND profile_id = 'arena-ranked'
    `).run()).toThrow();
  });

  it('keeps legacy settled Arena entries rankless and frozen after V19', () => {
    const directory = mkdtempSync(join(tmpdir(), 'poker-doku-'));
    temporaryDirectories.push(directory);
    const path = join(directory, 'poker.sqlite');
    createV17Database(path);
    const rawDatabase = new DatabaseSync(path);
    insertV15CompleteArenaFixture(rawDatabase);
    rawDatabase.exec(`
      UPDATE arena_matches SET status = 'playing', started_at = 20
      WHERE id = 'v14-match';
      UPDATE arena_matches SET status = 'finished', finished_at = 30
      WHERE id = 'v14-match';
      UPDATE arena_entries
      SET place = 1, points = 100, mmr_after = 1016,
          result_key = 'v14-legacy-result', settled_at = 30
      WHERE match_id = 'v14-match' AND profile_id = 'v1-marker';
    `);
    rawDatabase.close();

    database = openPokerDatabase(path);

    expect(database.db.prepare(`
      SELECT weekly_rank_before, weekly_rank_after FROM arena_entries
      WHERE match_id = 'v14-match' AND profile_id = 'v1-marker'
    `).get()).toEqual({ weekly_rank_before: null, weekly_rank_after: null });
    expect(new ArenaRepository(database)
      .listMatchEntries('v14-match')).toEqual([
      expect.objectContaining({
        profileId: 'v1-marker',
        weeklyRankBefore: null,
        weeklyRankAfter: null,
      }),
    ]);
    expect(() => database?.db.prepare(`
      UPDATE arena_entries SET weekly_rank_after = 1
      WHERE match_id = 'v14-match' AND profile_id = 'v1-marker'
    `).run()).toThrow();
  });

  it('adds the V20 immutable anonymous feedback table', () => {
    database = openPokerDatabase(':memory:');
    insertProfile(database, 'feedback-owner');

    expect(database.tableNames()).toEqual(
      expect.arrayContaining(['feedback']),
    );
    expect(() => database?.db.prepare(`
      INSERT INTO feedback (profile_id, alias, category, message, created_at)
      VALUES ('feedback-owner', '단골손님', 'spam', '내용입니다', 10)
    `).run()).toThrow();
    expect(() => database?.db.prepare(`
      INSERT INTO feedback (profile_id, alias, category, message, created_at)
      VALUES ('feedback-owner', '단골손님', 'bug', ?, 10)
    `).run('a'.repeat(501))).toThrow();
    expect(() => database?.db.prepare(`
      INSERT INTO feedback (profile_id, alias, category, message, created_at)
      VALUES ('missing-profile', '단골손님', 'bug', '내용입니다', 10)
    `).run()).toThrow();

    database.db.prepare(`
      INSERT INTO feedback (profile_id, alias, category, message, created_at)
      VALUES ('feedback-owner', '단골손님', 'idea', '봇 난이도 선택 원해요', 10)
    `).run();
    expect(() => database?.db.prepare(`
      UPDATE feedback SET message = '수정된 내용' WHERE profile_id = 'feedback-owner'
    `).run()).toThrow();

    database.db.prepare(`
      DELETE FROM profiles WHERE id = 'feedback-owner'
    `).run();
    expect(database.db.prepare(`
      SELECT profile_id, alias, message FROM feedback
    `).get()).toEqual({
      profile_id: null,
      alias: '단골손님',
      message: '봇 난이도 선택 원해요',
    });
  });

  it('applies the initial schema migration', () => {
    database = openPokerDatabase(':memory:');

    const migration = database.db
      .prepare('SELECT MAX(version) AS version FROM schema_migrations')
      .get() as { version: number };
    const profileColumns = database.db
      .prepare('PRAGMA table_info(profiles)')
      .all()
      .map((column) => (column as { name: string }).name);

    const indexes = database.db.prepare(`
      SELECT name FROM sqlite_schema WHERE type = 'index'
    `).all().map(row => (row as { name: string }).name);

    const sngColumns = database.db
      .prepare('PRAGMA table_info(sng_entries)')
      .all()
      .map((column) => (column as { name: string }).name);

    expect(migration.version).toBe(24);
    expect(database.tableNames()).toEqual(
      expect.arrayContaining([
        'profiles',
        'wallets',
        'chip_ledger',
        'seat_escrows',
        'daily_claims',
        'rescue_claims',
        'sng_entries',
        'cash_hand_settlements',
        'progression_profiles',
        'character_affinity',
        'daily_missions',
        'streak_state',
        'inventory_items',
        'profile_equipment',
        'progression_events',
        'daily_mission_modes',
        'streak_daily_progress',
        'progression_item_grants',
        'permanent_progression_grants',
        'collection_catalog',
        'arena_seasons',
        'arena_profiles',
        'arena_ticket_escrows',
        'arena_matches',
        'arena_entries',
        'arena_groups',
        'arena_group_members',
        'arena_weekly_settlements',
        'arena_season_rewards',
        'game_config',
      ]),
    );
    expect(profileColumns).toEqual(
      expect.arrayContaining(['credential_lookup', 'recovery_lookup']),
    );
    expect(indexes).toContain('idx_rescue_claims_profile_claimed_at_desc');
    expect(indexes).toContain('one_active_sng_entry_per_profile');
    expect(sngColumns).toEqual(expect.arrayContaining([
      'id', 'tournament_id', 'room_id', 'profile_id', 'start_attempt',
    ]));
  });

  it('seeds durable collection metadata exactly from the TypeScript catalog', () => {
    database = openPokerDatabase(':memory:');
    const rows = database.db.prepare(`
      SELECT item_id, kind, stackable, source_kind, required_level,
             character_id, equip_slot
      FROM collection_catalog ORDER BY item_id
    `).all();
    const expected = COLLECTION_CATALOG.map(item => ({
      item_id: item.id,
      kind: item.kind,
      stackable: item.stackable ? 1 : 0,
      source_kind: item.source.kind,
      required_level: item.source.kind === 'streak' ? null : item.source.level,
      character_id: item.source.kind === 'affinity-level'
        ? item.source.characterId
        : null,
      equip_slot: item.equipSlot,
    })).sort((left, right) => left.item_id.localeCompare(right.item_id));

    expect(rows).toEqual(expected);
  });

  it('enforces catalog inventory, equipment slot, and selected skin invariants', () => {
    database = openPokerDatabase(':memory:');
    insertProfile(database, 'catalog-guard');
    insertProfile(database, 'equipment-without-progression');
    expect(() => database?.db.prepare(`
      INSERT INTO profile_equipment (profile_id, slot, item_id, updated_at)
      VALUES ('equipment-without-progression', 'title', NULL, 1)
    `).run()).toThrow();
    const repository = new ProgressionRepository(database);
    repository.getOrCreate('catalog-guard', 'sakura', 1);

    expect(() => database?.db.prepare(`
      INSERT INTO inventory_items VALUES (
        'catalog-guard', 'unknown-item', 1, 1, 1
      )
    `).run()).toThrow();
    expect(() => database?.db.prepare(`
      INSERT INTO inventory_items VALUES (
        'catalog-guard', 'dojo-frame-cherry-blossom', 2, 1, 1
      )
    `).run()).toThrow();
    database.db.prepare(`
      INSERT INTO inventory_items VALUES (
        'catalog-guard', 'dojo-frame-cherry-blossom', 1, 1, 1
      )
    `).run();
    expect(() => database?.db.prepare(`
      UPDATE profile_equipment SET item_id = 'dojo-frame-cherry-blossom'
      WHERE profile_id = 'catalog-guard' AND slot = 'title'
    `).run()).toThrow();

    database.db.prepare(`
      INSERT INTO inventory_items VALUES (
        'catalog-guard', 'affinity-sakura-skin', 1, 1, 1
      )
    `).run();
    database.db.prepare(`
      UPDATE profile_equipment SET item_id = 'affinity-sakura-skin'
      WHERE profile_id = 'catalog-guard' AND slot = 'skin'
    `).run();
    expect(() => database?.db.prepare(`
      UPDATE progression_profiles SET selected_character_id = 'ara'
      WHERE profile_id = 'catalog-guard'
    `).run()).toThrow();
    expect(() => database?.db.prepare(`
      UPDATE inventory_items SET quantity = 2
      WHERE profile_id = 'catalog-guard'
        AND item_id = 'dojo-frame-cherry-blossom'
    `).run()).toThrow();
    expect(() => database?.db.prepare(`
      DELETE FROM profile_equipment
      WHERE profile_id = 'catalog-guard' AND slot = 'title'
    `).run()).toThrow();
  });

  it('does not reapply migrations when reopening a file database', () => {
    const directory = mkdtempSync(join(tmpdir(), 'poker-doku-'));
    temporaryDirectories.push(directory);
    const path = join(directory, 'poker.sqlite');

    database = openPokerDatabase(path);
    database.close();
    database = openPokerDatabase(path);

    const result = database.db
      .prepare('SELECT COUNT(*) AS count FROM schema_migrations')
      .get() as { count: number };
    expect(result.count).toBe(24);
  });

  it('preserves V13 data while atomically adding the Arena schema', () => {
    const directory = mkdtempSync(join(tmpdir(), 'poker-doku-'));
    temporaryDirectories.push(directory);
    const path = join(directory, 'poker.sqlite');
    createV13Database(path);

    database = openPokerDatabase(path);

    expect(database.db.prepare(`
      SELECT alias FROM profiles WHERE id = 'v1-marker'
    `).get()).toEqual({ alias: 'v1-marker-alias' });
    expect(database.db.prepare(`
      SELECT version FROM schema_migrations ORDER BY version DESC LIMIT 1
    `).get()).toEqual({ version: 24 });
    expect(database.tableNames()).toEqual(expect.arrayContaining([
      'arena_seasons', 'arena_profiles', 'arena_ticket_escrows',
      'arena_matches', 'arena_entries', 'arena_groups',
      'arena_group_members', 'arena_weekly_settlements',
      'arena_season_rewards',
    ]));
  });

  it('preserves valid V14 Arena data while adding V15 guards', () => {
    const directory = mkdtempSync(join(tmpdir(), 'poker-doku-'));
    temporaryDirectories.push(directory);
    const path = join(directory, 'poker.sqlite');
    createV14Database(path);
    const rawDatabase = new DatabaseSync(path);
    insertV14ArenaFixture(rawDatabase);
    rawDatabase.exec(`
      INSERT INTO arena_entries VALUES (
        'v14-match', 'v14-season', 'v1-marker',
        1, 100, 1000, 1016, 'v14-result', 10, 20
      );
      INSERT INTO arena_groups VALUES (
        'v14-group', 'v14-season', '2020-W53',
        'bronze', 'open', 10, NULL
      );
    `);
    rawDatabase.close();

    database = openPokerDatabase(path);

    expect(database.db.prepare(`
      SELECT MAX(version) AS version FROM schema_migrations
    `).get()).toEqual({ version: 24 });
    expect(database.db.prepare(`
      SELECT place, points, result_key FROM arena_entries
    `).get()).toEqual({ place: 1, points: 100, result_key: 'v14-result' });
    expect(database.db.prepare(`
      SELECT name FROM sqlite_schema
      WHERE type = 'index' AND name = 'one_arena_finisher_per_place'
    `).get()).toEqual({ name: 'one_arena_finisher_per_place' });
  });

  it.each([
    {
      label: 'mismatched placement points',
      corruption: `INSERT INTO arena_entries VALUES (
        'v14-match', 'v14-season', 'v1-marker',
        1, 60, 1000, 1010, 'bad-points', 10, 20
      )`,
    },
    {
      label: 'nonexistent ISO week 53',
      corruption: `INSERT INTO arena_groups VALUES (
        'bad-week-group', 'v14-season', '2021-W53',
        'bronze', 'open', 10, NULL
      )`,
    },
    {
      label: 'unsafe season ordinal',
      corruption: `UPDATE arena_seasons
        SET ordinal = 9007199254740992 WHERE id = 'v14-season'`,
    },
    {
      label: 'unsafe weekly counter',
      corruption: `
        INSERT INTO arena_groups VALUES (
          'unsafe-counter-group', 'v14-season', '2020-W53',
          'bronze', 'open', 10, NULL
        );
        INSERT INTO arena_group_members VALUES (
          'unsafe-counter-group', 'v14-season', '2020-W53', 'v1-marker',
          9007199254740992, 0, 0, 0, 0, 10, 10, 10
        )`,
    },
  ])('atomically rejects V14 $label during V15 upgrade', ({ corruption }) => {
    const directory = mkdtempSync(join(tmpdir(), 'poker-doku-'));
    temporaryDirectories.push(directory);
    const path = join(directory, 'poker.sqlite');
    createV14Database(path);
    const rawDatabase = new DatabaseSync(path);
    insertV14ArenaFixture(rawDatabase);
    rawDatabase.exec(corruption);
    rawDatabase.close();

    expectOpenDatabaseToThrow(path);

    const reopened = new DatabaseSync(path);
    try {
      expect(reopened.prepare(`
        SELECT MAX(version) AS version FROM schema_migrations
      `).get()).toEqual({ version: 14 });
      expect(reopened.prepare(`
        SELECT 1 FROM sqlite_schema
        WHERE type = 'index' AND name = 'one_arena_finisher_per_place'
      `).get()).toBeUndefined();
    } finally {
      reopened.close();
    }
  });

  it('rejects V14 Arena timestamps corrupted past legacy checks', () => {
    const directory = mkdtempSync(join(tmpdir(), 'poker-doku-'));
    temporaryDirectories.push(directory);
    const path = join(directory, 'poker.sqlite');
    createV14Database(path);
    const rawDatabase = new DatabaseSync(path);
    insertV14ArenaFixture(rawDatabase);
    rawDatabase.exec('PRAGMA ignore_check_constraints=ON');
    rawDatabase.exec(`
      UPDATE arena_seasons SET starts_at = -1 WHERE id = 'v14-season'
    `);
    rawDatabase.exec('PRAGMA ignore_check_constraints=OFF');
    rawDatabase.close();

    expectOpenDatabaseToThrow(path);

    const reopened = new DatabaseSync(path);
    try {
      expect(reopened.prepare(`
        SELECT MAX(version) AS version FROM schema_migrations
      `).get()).toEqual({ version: 14 });
      expect(reopened.prepare(`
        SELECT starts_at FROM arena_seasons WHERE id = 'v14-season'
      `).get()).toEqual({ starts_at: -1 });
    } finally {
      reopened.close();
    }
  });

  it('rolls V15 back when V16 rejects a corrupt V14 Arena entry', () => {
    const directory = mkdtempSync(join(tmpdir(), 'poker-doku-'));
    temporaryDirectories.push(directory);
    const path = join(directory, 'poker.sqlite');
    createV14Database(path);
    const rawDatabase = new DatabaseSync(path);
    insertV14ArenaFixture(rawDatabase);
    rawDatabase.exec(`
      INSERT INTO arena_entries VALUES (
        'v14-match', 'v14-season', 'v1-marker',
        NULL, NULL, 1000, NULL, NULL, 10, NULL
      )
    `);
    corruptIgnoringChecks(
      rawDatabase,
      `UPDATE arena_entries SET mmr_before = 9007199254740992
       WHERE match_id = 'v14-match' AND profile_id = 'v1-marker'`,
      'protect_arena_entry_update',
    );
    rawDatabase.close();

    expectOpenDatabaseToThrow(path);

    const reopened = new DatabaseSync(path);
    try {
      expect(reopened.prepare(`
        SELECT MAX(version) AS version FROM schema_migrations
      `).get()).toEqual({ version: 14 });
      expect(reopened.prepare(`
        SELECT 1 FROM sqlite_schema
        WHERE type = 'index' AND name = 'one_arena_finisher_per_place'
      `).get()).toBeUndefined();
    } finally {
      reopened.close();
    }
  });

  it.each([
    ['season timestamp', (db: DatabaseSync) => corruptIgnoringChecks(
      db,
      `UPDATE arena_seasons SET starts_at = -1 WHERE id = 'v14-season'`,
    )],
    ['profile MMR', (db: DatabaseSync) => corruptIgnoringChecks(
      db,
      `UPDATE arena_profiles SET mmr = 9007199254740992
       WHERE season_id = 'v14-season' AND profile_id = 'v1-marker'`,
    )],
    ['match timestamp', (db: DatabaseSync) => corruptIgnoringChecks(
      db,
      `UPDATE arena_matches SET created_at = -1 WHERE id = 'v14-match'`,
      'protect_arena_match_update',
    )],
    ['escrow timestamp', (db: DatabaseSync) => corruptIgnoringChecks(
      db,
      `UPDATE arena_ticket_escrows SET created_at = -1
       WHERE match_id = 'v14-match' AND profile_id = 'v1-marker'`,
      'protect_arena_ticket_escrow_update',
    )],
    ['entry MMR', (db: DatabaseSync) => corruptIgnoringChecks(
      db,
      `UPDATE arena_entries SET mmr_before = 9007199254740992
       WHERE match_id = 'v14-match' AND profile_id = 'v1-marker'`,
      'protect_arena_entry_update',
    )],
    ['entry result tuple', (db: DatabaseSync) => corruptIgnoringChecks(
      db,
      `UPDATE arena_entries SET result_key = 'partial-result'
       WHERE match_id = 'v14-match' AND profile_id = 'v1-marker'`,
    )],
    ['entry place', (db: DatabaseSync) => corruptIgnoringChecks(
      db,
      `UPDATE arena_entries
       SET place = 7, points = 100, mmr_after = 1016,
           result_key = 'invalid-place', settled_at = 20
       WHERE match_id = 'v14-match' AND profile_id = 'v1-marker'`,
      'validate_arena_entry_points_update',
    )],
    ['group timestamp', (db: DatabaseSync) => corruptIgnoringChecks(
      db,
      `UPDATE arena_groups SET created_at = -1 WHERE id = 'v15-open-group'`,
      'protect_arena_group_update',
    )],
    ['group-member counter', (db: DatabaseSync) => corruptIgnoringChecks(
      db,
      `UPDATE arena_group_members SET points = 9007199254740992
       WHERE group_id = 'v15-open-group' AND profile_id = 'v1-marker'`,
      'validate_arena_group_counters_update',
    )],
    ['weekly-settlement timestamp', (db: DatabaseSync) => corruptIgnoringChecks(
      db,
      `UPDATE arena_weekly_settlements SET settled_at = -1
       WHERE group_id = 'v15-settled-group'`,
      'freeze_arena_weekly_settlement_update',
    )],
    ['season-reward timestamp', (db: DatabaseSync) => corruptIgnoringChecks(
      db,
      `UPDATE arena_season_rewards SET granted_at = -1
       WHERE item_id = 'v15-reward'`,
      'freeze_arena_season_reward_update',
    )],
    ['cross-table reference', (db: DatabaseSync) => {
      db.exec('PRAGMA foreign_keys=OFF');
      bypassTrigger(db, 'freeze_arena_season_reward_update', `
        UPDATE arena_season_rewards SET profile_id = 'missing-profile'
        WHERE item_id = 'v15-reward'
      `);
    }],
  ])('atomically rejects corrupt V15 Arena %s before V16 is recorded', (
    _label,
    corrupt,
  ) => {
    const directory = mkdtempSync(join(tmpdir(), 'poker-doku-'));
    temporaryDirectories.push(directory);
    const path = join(directory, 'poker.sqlite');
    createV15Database(path);
    const rawDatabase = new DatabaseSync(path);
    insertV15CompleteArenaFixture(rawDatabase);
    corrupt(rawDatabase);
    rawDatabase.close();

    expectOpenDatabaseToThrow(path);

    const reopened = new DatabaseSync(path);
    try {
      expect(reopened.prepare(`
        SELECT MAX(version) AS version FROM schema_migrations
      `).get()).toEqual({ version: 15 });
    } finally {
      reopened.close();
    }
  });

  it('preserves valid V15 Arena rows and maps every row after V16 audit', () => {
    const directory = mkdtempSync(join(tmpdir(), 'poker-doku-'));
    temporaryDirectories.push(directory);
    const path = join(directory, 'poker.sqlite');
    createV15Database(path);
    const rawDatabase = new DatabaseSync(path);
    insertV15CompleteArenaFixture(rawDatabase);
    rawDatabase.close();

    database = openPokerDatabase(path);
    const arena = new ArenaRepository(database);

    expect(database.db.prepare(`
      SELECT MAX(version) AS version FROM schema_migrations
    `).get()).toEqual({ version: 24 });
    expect(arena.requireSeason('v14-season').id).toBe('v14-season');
    expect(arena.requireProfile('v14-season', 'v1-marker').mmr).toBe(1000);
    expect(arena.requireMatch('v14-match').status).toBe('forming');
    expect(arena.listMatchEntries('v14-match')).toHaveLength(1);
    expect(arena.requireTicketEscrow('v14-match', 'v1-marker').status)
      .toBe('escrow');
    expect(arena.requireGroup('v15-open-group').status).toBe('open');
    expect(arena.listGroupMembers('v15-open-group')).toHaveLength(1);
    expect(arena.findWeeklySettlement(
      'v14-season', '2020-W53', 'v15-settled-group',
    )).not.toBeNull();
    expect(arena.listSeasonRewards('v14-season', 'v1-marker')).toHaveLength(1);
  });

  it('upgrades V16 Arena rows once and indexes due groups without a temp sort', () => {
    const directory = mkdtempSync(join(tmpdir(), 'poker-doku-'));
    temporaryDirectories.push(directory);
    const path = join(directory, 'poker.sqlite');
    createV16Database(path);
    const rawDatabase = new DatabaseSync(path);
    insertV15CompleteArenaFixture(rawDatabase);
    rawDatabase.close();

    database = openPokerDatabase(path);
    const arena = new ArenaRepository(database);
    const plan = database.db.prepare(`
      EXPLAIN QUERY PLAN
      SELECT id, season_id, week_key, tier, status, created_at, settled_at
      FROM arena_groups
      WHERE status = 'open' AND week_key < ?
      ORDER BY week_key, season_id, created_at, id
    `).all('2021-W01').map(row => (row as { detail: string }).detail);
    const profilePlan = database.db.prepare(`
      EXPLAIN QUERY PLAN
      SELECT DISTINCT
        groups.id,
        groups.season_id,
        groups.week_key,
        groups.tier,
        groups.status,
        groups.created_at,
        groups.settled_at
      FROM arena_group_members AS members
      INNER JOIN arena_groups AS groups ON groups.id = members.group_id
      WHERE members.profile_id IN (?)
        AND members.season_id = ?
        AND members.week_key < ?
        AND groups.status = 'open'
      ORDER BY groups.week_key, groups.created_at, groups.id
    `).all('v1-marker', 'v14-season', '2021-W01')
      .map(row => (row as { detail: string }).detail);

    expect(database.db.prepare(`
      SELECT MAX(version) AS version FROM schema_migrations
    `).get()).toEqual({ version: 24 });
    expect(arena.requireGroup('v15-open-group').status).toBe('open');
    expect(arena.listGroupMembers('v15-open-group')).toHaveLength(1);
    expect(database.db.prepare(`
      SELECT name FROM sqlite_schema
      WHERE type = 'index' AND name = 'idx_arena_groups_open_week_order'
    `).get()).toEqual({ name: 'idx_arena_groups_open_week_order' });
    expect(database.db.prepare(`
      SELECT name FROM sqlite_schema
      WHERE type = 'index'
        AND name = 'idx_arena_group_members_profile_due_week'
    `).get()).toEqual({
      name: 'idx_arena_group_members_profile_due_week',
    });
    expect(plan.some(detail =>
      detail.includes('idx_arena_groups_open_week_order'),
    )).toBe(true);
    expect(plan.some(detail => detail.includes('USE TEMP B-TREE'))).toBe(false);
    expect(profilePlan.some(detail =>
      detail.includes('idx_arena_group_members_profile_due_week'),
    )).toBe(true);

    database.close();
    database = openPokerDatabase(path);
    expect(database.db.prepare(`
      SELECT COUNT(*) AS count FROM schema_migrations WHERE version = 17
    `).get()).toEqual({ count: 1 });
    expect(new ArenaRepository(database)
      .listGroupMembers('v15-open-group')).toHaveLength(1);
  });

  it('rolls back the V17 indexes and marker together on migration failure', () => {
    const directory = mkdtempSync(join(tmpdir(), 'poker-doku-'));
    temporaryDirectories.push(directory);
    const path = join(directory, 'poker.sqlite');
    createV16Database(path);
    const rawDatabase = new DatabaseSync(path);
    insertV15CompleteArenaFixture(rawDatabase);
    rawDatabase.exec(`
      CREATE INDEX idx_arena_group_members_profile_due_week
        ON arena_group_members(group_id);
    `);
    rawDatabase.close();

    expect(() => openPokerDatabase(path)).toThrow();

    const verificationDatabase = new DatabaseSync(path);
    try {
      expect(verificationDatabase.prepare(`
        SELECT MAX(version) AS version FROM schema_migrations
      `).get()).toEqual({ version: 16 });
      expect(verificationDatabase.prepare(`
        SELECT name FROM sqlite_schema
        WHERE type = 'index' AND name = 'idx_arena_groups_open_week_order'
      `).get()).toBeUndefined();
      expect(verificationDatabase.prepare(`
        SELECT name FROM sqlite_schema
        WHERE type = 'index'
          AND name = 'idx_arena_group_members_profile_due_week'
      `).get()).toEqual({
        name: 'idx_arena_group_members_profile_due_week',
      });
      expect(verificationDatabase.prepare(`
        SELECT status FROM arena_groups WHERE id = 'v15-open-group'
      `).get()).toEqual({ status: 'open' });
      expect(verificationDatabase.prepare(`
        SELECT COUNT(*) AS count
        FROM arena_group_members WHERE group_id = 'v15-open-group'
      `).get()).toEqual({ count: 1 });
    } finally {
      verificationDatabase.close();
    }
  });

  it('rejects a second active Arena ticket escrow for one profile', () => {
    database = openPokerDatabase(':memory:');
    insertArenaFixture(database, 'arena-active');
    insertArenaMatch(database, 'match-a', 'arena-active');
    insertArenaMatch(database, 'match-b', 'arena-active');
    const insert = database.db.prepare(`
      INSERT INTO arena_ticket_escrows (
        match_id, season_id, profile_id, status, created_at, settled_at
      ) VALUES (?, 'season-v1', 'arena-active', 'escrow', 10, NULL)
    `);
    insert.run('match-a');

    expect(() => insert.run('match-b')).toThrow();
  });

  it('rejects duplicate Arena result keys and malformed result tuples', () => {
    database = openPokerDatabase(':memory:');
    insertArenaFixture(database, 'arena-result-a');
    insertArenaFixture(database, 'arena-result-b');
    insertArenaMatch(database, 'result-match', 'arena-result-a');
    const insert = database.db.prepare(`
      INSERT INTO arena_entries (
        match_id, season_id, profile_id, place, points, mmr_before, mmr_after,
        result_key, created_at, settled_at
      ) VALUES ('result-match', 'season-v1', ?, ?, ?, 1000, ?, ?, 10, ?)
    `);
    insert.run('arena-result-a', 1, 100, 1016, 'same-result', 20);

    expect(() => insert.run(
      'arena-result-b', 2, 60, 1010, 'same-result', 20,
    )).toThrow();
    expect(() => database?.db.prepare(`
      INSERT INTO arena_entries (
        match_id, season_id, profile_id, place, points, mmr_before, mmr_after,
        result_key, created_at, settled_at
      ) VALUES (
        'result-match', 'season-v1', 'arena-result-b', 2, 60, 1000, NULL,
        'partial-result', 10, 20
      )
    `).run()).toThrow();
  });

  it('enforces Arena ownership foreign keys and cascades profile-owned rows', () => {
    database = openPokerDatabase(':memory:');
    insertArenaFixture(database, 'arena-owner');
    insertArenaMatch(database, 'owner-match', 'arena-owner');
    database.db.prepare(`
      INSERT INTO arena_ticket_escrows VALUES (
        'owner-match', 'season-v1', 'arena-owner', 'escrow', 10, NULL
      )
    `).run();
    database.db.prepare(`
      INSERT INTO arena_entries VALUES (
        'owner-match', 'season-v1', 'arena-owner',
        NULL, NULL, 1000, NULL, NULL, 10, NULL, NULL, NULL
      )
    `).run();

    expect(() => database?.db.prepare(`
      INSERT INTO arena_profiles VALUES (
        'season-v1', 'missing', 2, '2026-07-20', 0, 0, NULL,
        1000, 10, 10
      )
    `).run()).toThrow();

    database.db.prepare(`DELETE FROM profiles WHERE id = 'arena-owner'`).run();
    for (const table of [
      'arena_profiles', 'arena_ticket_escrows', 'arena_entries',
    ]) {
      expect(database.db.prepare(
        `SELECT COUNT(*) AS count FROM ${table}`,
      ).get()).toEqual({ count: 0 });
    }
    expect(database.db.prepare(`
      SELECT COUNT(*) AS count FROM arena_matches
    `).get()).toEqual({ count: 1 });
  });

  it('rejects Arena children whose profile does not belong to the match season', () => {
    database = openPokerDatabase(':memory:');
    insertArenaFixture(database, 'arena-member');
    insertProfile(database, 'profile-only');
    insertArenaMatch(database, 'season-match', 'arena-member');
    database.db.prepare(`
      INSERT INTO arena_groups (
        id, season_id, week_key, tier, status, created_at, settled_at
      ) VALUES (
        'season-group', 'season-v1', '2026-W30', 'bronze', 'open', 10, NULL
      )
    `).run();

    expect(() => database?.db.prepare(`
      INSERT INTO arena_ticket_escrows (
        match_id, season_id, profile_id, status, created_at, settled_at
      ) VALUES (
        'season-match', 'season-v1', 'profile-only', 'escrow', 10, NULL
      )
    `).run()).toThrow();
    expect(() => database?.db.prepare(`
      INSERT INTO arena_entries (
        match_id, season_id, profile_id, place, points, mmr_before, mmr_after,
        result_key, created_at, settled_at
      ) VALUES (
        'season-match', 'season-v1', 'profile-only',
        NULL, NULL, 1000, NULL, NULL, 10, NULL
      )
    `).run()).toThrow();
    expect(() => database?.db.prepare(`
      INSERT INTO arena_group_members VALUES (
        'season-group', 'season-v1', '2026-W30', 'profile-only',
        0, 0, 0, 0, 0, 10, 10, 10
      )
    `).run()).toThrow();
    expect(() => database?.db.prepare(`
      INSERT INTO arena_season_rewards VALUES (
        'season-v1', 'profile-only', 'arena-item', 10
      )
    `).run()).toThrow();
  });

  it('blocks profile deletion while an Arena ticket is actively escrowed', () => {
    database = openPokerDatabase(':memory:');
    insertArenaFixture(database, 'arena-delete');
    insertArenaMatch(database, 'delete-match', 'arena-delete');
    database.db.prepare(`
      INSERT INTO arena_ticket_escrows VALUES (
        'delete-match', 'season-v1', 'arena-delete', 'escrow', 10, NULL
      )
    `).run();
    const profiles = new ProfileRepository(database);

    expect(profiles.deleteProfile('arena-delete')).toBe('active-escrow');
    expect(database.db.prepare(`
      SELECT COUNT(*) AS count FROM profiles WHERE id = 'arena-delete'
    `).get()).toEqual({ count: 1 });

    database.db.prepare(`
      UPDATE arena_ticket_escrows
      SET status = 'refunded', settled_at = 20
      WHERE profile_id = 'arena-delete'
    `).run();
    expect(profiles.deleteProfile('arena-delete')).toBe('deleted');
    expect(database.db.prepare(`
      SELECT COUNT(*) AS count FROM arena_ticket_escrows
      WHERE profile_id = 'arena-delete'
    `).get()).toEqual({ count: 0 });
  });

  it('keeps terminal Arena rows terminal and timestamps monotonic', () => {
    database = openPokerDatabase(':memory:');
    insertArenaFixture(database, 'arena-terminal');
    insertArenaMatch(database, 'terminal-match', 'arena-terminal');
    database.db.exec(`
      UPDATE arena_profiles SET updated_at = 20
      WHERE season_id = 'season-v1' AND profile_id = 'arena-terminal';
      UPDATE arena_matches SET status = 'playing', started_at = 20
      WHERE id = 'terminal-match';
      UPDATE arena_matches SET status = 'finished', finished_at = 30
      WHERE id = 'terminal-match';
      INSERT INTO arena_ticket_escrows VALUES (
        'terminal-match', 'season-v1', 'arena-terminal',
        'escrow', 10, NULL
      );
      UPDATE arena_ticket_escrows SET status = 'consumed', settled_at = 30
      WHERE match_id = 'terminal-match' AND profile_id = 'arena-terminal';
      INSERT INTO arena_entries VALUES (
        'terminal-match', 'season-v1', 'arena-terminal',
        NULL, NULL, 1000, NULL, NULL, 10, NULL, NULL, NULL
      );
      UPDATE arena_entries
      SET place = 1, points = 100, mmr_after = 1016,
          result_key = 'terminal-result', settled_at = 30
      WHERE match_id = 'terminal-match' AND profile_id = 'arena-terminal';
    `);

    expect(() => database?.db.prepare(`
      UPDATE arena_profiles SET updated_at = 15
      WHERE season_id = 'season-v1' AND profile_id = 'arena-terminal'
    `).run()).toThrow();
    expect(() => database?.db.prepare(`
      UPDATE arena_matches
      SET status = 'forming', started_at = NULL, finished_at = NULL
      WHERE id = 'terminal-match'
    `).run()).toThrow();
    expect(() => database?.db.prepare(`
      UPDATE arena_ticket_escrows
      SET status = 'escrow', settled_at = NULL
      WHERE match_id = 'terminal-match' AND profile_id = 'arena-terminal'
    `).run()).toThrow();
    expect(() => database?.db.prepare(`
      UPDATE arena_entries SET place = 2, points = 60, mmr_after = 1010
      WHERE match_id = 'terminal-match' AND profile_id = 'arena-terminal'
    `).run()).toThrow();
  });

  it('enforces weekly settlement and season reward idempotency keys', () => {
    database = openPokerDatabase(':memory:');
    insertArenaFixture(database, 'arena-idempotent');
    database.db.exec(`
      INSERT INTO arena_groups VALUES (
        'idempotent-group', 'season-v1', '2026-W30', 'bronze',
        'open', 10, NULL
      );
      UPDATE arena_groups SET status = 'settled', settled_at = 20
      WHERE id = 'idempotent-group';
      INSERT INTO arena_weekly_settlements VALUES (
        'season-v1', '2026-W30', 'idempotent-group', 20
      );
      INSERT INTO arena_season_rewards VALUES (
        'season-v1', 'arena-idempotent', 'season-item', 20
      );
    `);

    expect(() => database?.db.prepare(`
      INSERT INTO arena_weekly_settlements VALUES (
        'season-v1', '2026-W30', 'idempotent-group', 21
      )
    `).run()).toThrow();
    expect(() => database?.db.prepare(`
      INSERT INTO arena_season_rewards VALUES (
        'season-v1', 'arena-idempotent', 'season-item', 21
      )
    `).run()).toThrow();
  });

  it('creates a weekly settlement marker only after its group is settled', () => {
    database = openPokerDatabase(':memory:');
    insertArenaFixture(database, 'arena-weekly-order');
    database.db.prepare(`
      INSERT INTO arena_groups VALUES (
        'weekly-order-group', 'season-v1', '2026-W30', 'bronze',
        'open', 10, NULL
      )
    `).run();

    expect(() => database?.db.prepare(`
      INSERT INTO arena_weekly_settlements VALUES (
        'season-v1', '2026-W30', 'weekly-order-group', 20
      )
    `).run()).toThrow();
    database.db.prepare(`
      UPDATE arena_groups SET status = 'settled', settled_at = 20
      WHERE id = 'weekly-order-group'
    `).run();
    expect(() => database?.db.prepare(`
      INSERT INTO arena_weekly_settlements VALUES (
        'season-v1', '2026-W30', 'weekly-order-group', 19
      )
    `).run()).toThrow();
    database.db.prepare(`
      INSERT INTO arena_weekly_settlements VALUES (
        'season-v1', '2026-W30', 'weekly-order-group', 20
      )
    `).run();
  });

  it('enforces exact Arena place points and one finisher per place', () => {
    database = openPokerDatabase(':memory:');
    insertArenaFixture(database, 'arena-place-a');
    insertArenaFixture(database, 'arena-place-b');
    insertArenaMatch(database, 'place-match', 'arena-place-a');

    expect(() => database?.db.prepare(`
      INSERT INTO arena_entries VALUES (
        'place-match', 'season-v1', 'arena-place-a',
        1, 60, 1000, 1010, 'wrong-points', 10, 20, NULL, NULL
      )
    `).run()).toThrow();
    database.db.prepare(`
      INSERT INTO arena_entries VALUES (
        'place-match', 'season-v1', 'arena-place-a',
        1, 100, 1000, 1016, 'place-a', 10, 20, NULL, NULL
      )
    `).run();
    expect(() => database?.db.prepare(`
      INSERT INTO arena_entries VALUES (
        'place-match', 'season-v1', 'arena-place-b',
        1, 100, 1000, 1016, 'place-b', 10, 20, NULL, NULL
      )
    `).run()).toThrow();

    database.db.prepare(`
      INSERT INTO arena_entries VALUES (
        'place-match', 'season-v1', 'arena-place-b',
        NULL, NULL, 1000, NULL, NULL, 10, NULL, NULL, NULL
      )
    `).run();
    expect(() => database?.db.prepare(`
      UPDATE arena_entries
      SET place = 2, points = 35, mmr_after = 1010,
          result_key = 'wrong-update', settled_at = 20
      WHERE match_id = 'place-match' AND profile_id = 'arena-place-b'
    `).run()).toThrow();
  });

  it('allows only monotonic legal placement and daily grant evolution', () => {
    database = openPokerDatabase(':memory:');
    insertArenaFixture(database, 'arena-evolution');
    database.db.prepare(`
      UPDATE arena_profiles
      SET placement_games = 1, placement_points = 60, updated_at = 20
      WHERE season_id = 'season-v1' AND profile_id = 'arena-evolution'
    `).run();

    for (const statement of [
      `UPDATE arena_profiles
       SET last_daily_grant_date = '2026-07-19', updated_at = 21
       WHERE season_id = 'season-v1' AND profile_id = 'arena-evolution'`,
      `UPDATE arena_profiles
       SET placement_games = 0, placement_points = 0, updated_at = 21
       WHERE season_id = 'season-v1' AND profile_id = 'arena-evolution'`,
      `UPDATE arena_profiles
       SET placement_points = 35, updated_at = 21
       WHERE season_id = 'season-v1' AND profile_id = 'arena-evolution'`,
      `UPDATE arena_profiles
       SET placement_points = 100, updated_at = 21
       WHERE season_id = 'season-v1' AND profile_id = 'arena-evolution'`,
    ]) {
      expect(() => database?.db.exec(statement)).toThrow();
    }

    database.db.exec(`
      UPDATE arena_profiles
      SET placement_games = 2, placement_points = 160, updated_at = 21
      WHERE season_id = 'season-v1' AND profile_id = 'arena-evolution';
      UPDATE arena_profiles
      SET placement_games = 3, placement_points = 195, updated_at = 22
      WHERE season_id = 'season-v1' AND profile_id = 'arena-evolution';
      UPDATE arena_profiles
      SET placement_games = 4, placement_points = 210, updated_at = 23
      WHERE season_id = 'season-v1' AND profile_id = 'arena-evolution';
      UPDATE arena_profiles
      SET placement_games = 5, placement_points = 215, tier = 'silver',
          updated_at = 24
      WHERE season_id = 'season-v1' AND profile_id = 'arena-evolution';
      UPDATE arena_profiles
      SET tier = 'gold', mmr = 1032, updated_at = 25
      WHERE season_id = 'season-v1' AND profile_id = 'arena-evolution';
    `);
    expect(() => database?.db.exec(`
      UPDATE arena_profiles
      SET placement_games = 4, placement_points = 210, tier = NULL,
          updated_at = 26
      WHERE season_id = 'season-v1' AND profile_id = 'arena-evolution'
    `)).toThrow();
  });

  it('freezes weekly standings and settlement and reward receipts after settlement', () => {
    database = openPokerDatabase(':memory:');
    insertArenaFixture(database, 'arena-frozen');
    database.db.exec(`
      INSERT INTO arena_groups VALUES (
        'frozen-group', 'season-v1', '2020-W53', 'bronze', 'open', 10, NULL
      );
      INSERT INTO arena_group_members VALUES (
        'frozen-group', 'season-v1', '2020-W53', 'arena-frozen',
        100, 1, 1, 1, 1, 10, 10, 10
      );
      UPDATE arena_groups SET status = 'settled', settled_at = 20
      WHERE id = 'frozen-group';
      INSERT INTO arena_weekly_settlements VALUES (
        'season-v1', '2020-W53', 'frozen-group', 20
      );
      INSERT INTO arena_season_rewards VALUES (
        'season-v1', 'arena-frozen', 'frozen-item', 20
      );
    `);

    for (const statement of [
      `UPDATE arena_group_members SET points = 200, updated_at = 21
       WHERE group_id = 'frozen-group' AND profile_id = 'arena-frozen'`,
      `DELETE FROM arena_group_members
       WHERE group_id = 'frozen-group' AND profile_id = 'arena-frozen'`,
      `UPDATE arena_weekly_settlements SET settled_at = 21
       WHERE group_id = 'frozen-group'`,
      `DELETE FROM arena_weekly_settlements WHERE group_id = 'frozen-group'`,
      `UPDATE arena_season_rewards SET granted_at = 21
       WHERE item_id = 'frozen-item'`,
      `DELETE FROM arena_season_rewards WHERE item_id = 'frozen-item'`,
    ]) {
      expect(() => database?.db.exec(statement)).toThrow();
    }
  });

  it('blocks direct Arena profile deletion but permits owner profile cascade', () => {
    database = openPokerDatabase(':memory:');
    insertArenaFixture(database, 'arena-owned-delete');
    database.db.exec(`
      INSERT INTO arena_groups VALUES (
        'delete-group', 'season-v1', '2020-W53', 'bronze', 'open', 10, NULL
      );
      INSERT INTO arena_group_members VALUES (
        'delete-group', 'season-v1', '2020-W53', 'arena-owned-delete',
        0, 0, 0, 0, 0, 10, 10, 10
      );
      UPDATE arena_groups SET status = 'settled', settled_at = 20
      WHERE id = 'delete-group';
      INSERT INTO arena_weekly_settlements VALUES (
        'season-v1', '2020-W53', 'delete-group', 20
      );
      INSERT INTO arena_season_rewards VALUES (
        'season-v1', 'arena-owned-delete', 'delete-item', 20
      );
    `);

    expect(() => database?.db.exec(`
      DELETE FROM arena_profiles
      WHERE season_id = 'season-v1' AND profile_id = 'arena-owned-delete'
    `)).toThrow();
    expect(new ProfileRepository(database).deleteProfile('arena-owned-delete'))
      .toBe('deleted');
    for (const table of [
      'arena_profiles', 'arena_group_members', 'arena_season_rewards',
    ]) {
      expect(database.db.prepare(
        `SELECT COUNT(*) AS count FROM ${table}`,
      ).get()).toEqual({ count: 0 });
    }
    expect(database.db.prepare(`
      SELECT COUNT(*) AS count FROM arena_weekly_settlements
    `).get()).toEqual({ count: 1 });
  });

  it('accepts only canonical ISO week keys in Arena groups and settlements', () => {
    database = openPokerDatabase(':memory:');
    insertArenaFixture(database, 'arena-week-key');

    expect(() => database?.db.exec(`
      INSERT INTO arena_groups VALUES (
        'bad-week', 'season-v1', '2021-W53', 'bronze', 'open', 10, NULL
      )
    `)).toThrow();
    database.db.exec(`
      INSERT INTO arena_groups VALUES (
        'good-week', 'season-v1', '2020-W53', 'bronze', 'open', 10, NULL
      );
      UPDATE arena_groups SET status = 'settled', settled_at = 20
      WHERE id = 'good-week';
    `);
    expect(() => database?.db.exec(`
      UPDATE arena_groups SET week_key = '2021-W53' WHERE id = 'good-week'
    `)).toThrow();
  });

  it('bounds Arena season ordinals and weekly counters to safe integers', () => {
    database = openPokerDatabase(':memory:');
    insertArenaFixture(database, 'arena-safe-counter');
    expect(() => database?.db.exec(`
      INSERT INTO arena_seasons VALUES (
        'unsafe-season', 9007199254740992, 1, 0, 1, 100, 1
      )
    `)).toThrow();
    database.db.exec(`
      INSERT INTO arena_groups VALUES (
        'counter-group', 'season-v1', '2020-W53', 'bronze', 'open', 10, NULL
      )
    `);
    expect(() => database?.db.exec(`
      INSERT INTO arena_group_members VALUES (
        'counter-group', 'season-v1', '2020-W53', 'arena-safe-counter',
        9007199254740992, 0, 0, 0, 0, 10, 10, 10
      )
    `)).toThrow();
  });

  it('rolls back all of V14 when an Arena table conflicts', () => {
    const directory = mkdtempSync(join(tmpdir(), 'poker-doku-'));
    temporaryDirectories.push(directory);
    const path = join(directory, 'poker.sqlite');
    createV13Database(path);
    const rawDatabase = new DatabaseSync(path);
    rawDatabase.exec(`CREATE TABLE arena_entries (marker TEXT) STRICT;`);
    rawDatabase.close();

    expectOpenDatabaseToThrow(path);

    const reopened = new DatabaseSync(path);
    try {
      expect(reopened.prepare(`
        SELECT MAX(version) AS version FROM schema_migrations
      `).get()).toEqual({ version: 13 });
      expect(reopened.prepare(`PRAGMA table_info(arena_entries)`).all())
        .toEqual([expect.objectContaining({ name: 'marker' })]);
      expect(reopened.prepare(`
        SELECT 1 FROM sqlite_schema
        WHERE type = 'table' AND name = 'arena_seasons'
      `).get()).toBeUndefined();
    } finally {
      reopened.close();
    }
  });

  it('keeps the SQL reward-source validator equivalent to the shared parser', () => {
    database = openPokerDatabase(':memory:');
    insertProfile(database, 'canonical-summary');
    const fixtures = [
      validPermanentSummary('canonical-valid', {
        dojoLevelsGained: [5],
        grantedItemIds: ['dojo-frame-cherry-blossom'],
      }),
      { dojoLevelsGained: [5], grantedItemIds: ['dojo-frame-cherry-blossom'] },
      validPermanentSummary('wrong-event-id', { eventId: 'other-event' }),
      validPermanentSummary('unsafe-summary', {
        dojoXpMilli: Number.MAX_SAFE_INTEGER + 1,
      }),
      validPermanentSummary('unknown-character', { characterId: 'miyako' }),
      validPermanentSummary('duplicate-level', { dojoLevelsGained: [5, 5] }),
      validPermanentSummary('duplicate-item', {
        grantedItemIds: [
          'dojo-frame-cherry-blossom',
          'dojo-frame-cherry-blossom',
        ],
      }),
      validPermanentSummary('bad-mission', {
        dojoXpMilli: 100_000,
        missionCompletions: [{
          missionId: 'COMPLETE_ONE_SNG',
          slot: 0,
          dojoXpMilli: 99_999,
        }],
      }),
      validPermanentSummary('bad-streak', {
        streak: { previousStreak: 3, currentStreak: 5, restPassUsed: false },
      }),
    ];

    for (const [index, summary] of fixtures.entries()) {
      const eventId = typeof summary.eventId === 'string'
        ? summary.eventId
        : `partial-${index}`;
      database.db.prepare(`
        INSERT INTO progression_events (
          idempotency_key, profile_id, event_type, balance_version,
          summary_json, created_at
        ) VALUES (?, 'canonical-summary', 'completed-hand', 1, ?, ?)
      `).run(eventId, JSON.stringify(summary), index + 1);
      const sqlAccepted = database.db.prepare(`
        SELECT 1 FROM canonical_progression_reward_source_events
        WHERE idempotency_key = ?
      `).get(eventId) !== undefined;
      expect(sqlAccepted).toBe(
        parseProgressionRewardSummary(summary, eventId, 1) !== null,
      );
    }
  });

  it('rejects partial and unsupported-balance permanent sources in both orders', () => {
    database = openPokerDatabase(':memory:');
    insertProfile(database, 'source-proof-runtime');
    const repository = new ProgressionRepository(database);
    repository.getOrCreate('source-proof-runtime', 'sakura', 1);
    database.db.prepare(`
      UPDATE progression_profiles SET dojo_level = 5, dojo_xp_milli = 0
      WHERE profile_id = 'source-proof-runtime'
    `).run();

    for (const [eventId, balanceVersion, summary] of [
      [
        'partial-existing',
        1,
        { dojoLevelsGained: [5], grantedItemIds: ['dojo-frame-cherry-blossom'] },
      ],
      [
        'balance-two-existing',
        2,
        validPermanentSummary('balance-two-existing', {
          dojoLevelsGained: [5],
          grantedItemIds: ['dojo-frame-cherry-blossom'],
        }),
      ],
    ] as const) {
      database.db.prepare(`
        INSERT INTO progression_events VALUES (
          ?, 'source-proof-runtime', 'completed-hand', ?, ?, 10
        )
      `).run(eventId, balanceVersion, JSON.stringify(summary));
      expect(() => database?.db.prepare(`
        INSERT INTO permanent_progression_grants (
          profile_id, item_id, source_event_id, source_kind,
          source_level, source_character_id, granted_at
        ) VALUES (
          'source-proof-runtime', 'dojo-frame-cherry-blossom', ?,
          'dojo-level', 5, NULL, 10
        )
      `).run(eventId)).toThrow();
    }

    expect(() => database?.transaction(() => {
      database?.db.prepare(`
        INSERT INTO permanent_progression_grants (
          profile_id, item_id, source_event_id, source_kind,
          source_level, source_character_id, granted_at
        ) VALUES (
          'source-proof-runtime', 'dojo-frame-cherry-blossom',
          'partial-later', 'dojo-level', 5, NULL, 11
        )
      `).run();
      database?.db.prepare(`
        INSERT INTO progression_events VALUES (
          'partial-later', 'source-proof-runtime', 'completed-hand', 1,
          '{"dojoLevelsGained":[5],"grantedItemIds":["dojo-frame-cherry-blossom"]}',
          11
        )
      `).run();
    })).toThrow();
    expect(database.db.prepare(`
      SELECT COUNT(*) AS count FROM permanent_progression_grants
      WHERE profile_id = 'source-proof-runtime'
    `).get()).toEqual({ count: 0 });
  });

  it('enforces bounded inventory and equipment times plus immutable row identities', () => {
    database = openPokerDatabase(':memory:');
    insertProfile(database, 'runtime-shape-a');
    insertProfile(database, 'runtime-shape-b');
    const repository = new ProgressionRepository(database);
    repository.getOrCreate('runtime-shape-a', 'sakura', 1);
    repository.getOrCreate('runtime-shape-b', 'sakura', 1);

    expect(() => database?.db.prepare(`
      INSERT INTO inventory_items VALUES (
        'runtime-shape-a', 'dojo-frame-cherry-blossom', 1,
        253402300800000, 253402300800000
      )
    `).run()).toThrow();
    database.db.prepare(`
      INSERT INTO inventory_items VALUES (
        'runtime-shape-a', 'dojo-frame-cherry-blossom', 1, 2, 2
      )
    `).run();
    expect(() => database?.db.prepare(`
      UPDATE inventory_items SET item_id = 'dojo-title-steady-trainee'
      WHERE profile_id = 'runtime-shape-a'
        AND item_id = 'dojo-frame-cherry-blossom'
    `).run()).toThrow();
    expect(() => database?.db.prepare(`
      UPDATE inventory_items SET granted_at = 3, updated_at = 2
      WHERE profile_id = 'runtime-shape-a'
        AND item_id = 'dojo-frame-cherry-blossom'
    `).run()).toThrow();
    expect(() => database?.db.prepare(`
      UPDATE profile_equipment SET updated_at = 253402300800000
      WHERE profile_id = 'runtime-shape-a' AND slot = 'title'
    `).run()).toThrow();

    bypassTrigger(database.db, 'reject_catalog_equipment_delete', `
      DELETE FROM profile_equipment
      WHERE profile_id = 'runtime-shape-b' AND slot = 'frame'
    `);
    expect(() => database?.db.prepare(`
      UPDATE profile_equipment
      SET profile_id = 'runtime-shape-b', slot = 'frame'
      WHERE profile_id = 'runtime-shape-a' AND slot = 'title'
    `).run()).toThrow();
  });

  it('upgrades a V10 preowned cosmetic without inventing a grant receipt', () => {
    const directory = mkdtempSync(join(tmpdir(), 'poker-doku-v10-cosmetic-'));
    temporaryDirectories.push(directory);
    const path = join(directory, 'poker.sqlite');
    createV10Database(path);
    const raw = new DatabaseSync(path);
    try {
      raw.exec(`
        INSERT INTO progression_profiles VALUES (
          'v1-marker', 1, 1, 0, 'sakura', NULL,
          0, 0, 0, 0, 0, 0, 1, 1
        );
        INSERT INTO character_affinity VALUES ('v1-marker', 'sakura', 1, 0);
        INSERT INTO profile_equipment VALUES
          ('v1-marker', 'title', NULL, 1),
          ('v1-marker', 'frame', NULL, 1),
          ('v1-marker', 'skin', NULL, 1),
          ('v1-marker', 'cutin', NULL, 1);
        INSERT INTO inventory_items VALUES (
          'v1-marker', 'dojo-frame-cherry-blossom', 1, 1, 1
        );
      `);
    } finally {
      raw.close();
    }

    database = openPokerDatabase(path);

    expect(database.db.prepare(`
      SELECT quantity, granted_at, updated_at FROM inventory_items
      WHERE profile_id = 'v1-marker'
        AND item_id = 'dojo-frame-cherry-blossom'
    `).get()).toEqual({ quantity: 1, granted_at: 1, updated_at: 1 });
    expect(database.db.prepare(`
      SELECT COUNT(*) AS count FROM permanent_progression_grants
    `).get()).toEqual({ count: 0 });
  });

  it.each([
    ['unknown inventory', `
      INSERT INTO inventory_items VALUES (
        'v1-marker', 'unknown-item', 1, 1, 1
      );
    `],
    ['nonstackable quantity', `
      INSERT INTO inventory_items VALUES (
        'v1-marker', 'dojo-frame-cherry-blossom', 2, 1, 1
      );
    `],
    ['wrong equipment slot', `
      INSERT INTO inventory_items VALUES (
        'v1-marker', 'dojo-frame-cherry-blossom', 1, 1, 1
      );
      UPDATE profile_equipment SET item_id = 'dojo-frame-cherry-blossom'
      WHERE profile_id = 'v1-marker' AND slot = 'title';
    `],
    ['wrong character skin', `
      INSERT INTO inventory_items VALUES (
        'v1-marker', 'affinity-ara-skin', 1, 1, 1
      );
      UPDATE profile_equipment SET item_id = 'affinity-ara-skin'
      WHERE profile_id = 'v1-marker' AND slot = 'skin';
    `],
    ['orphan permanent receipt', `
      UPDATE progression_profiles SET dojo_level = 5, dojo_xp_milli = 0
      WHERE profile_id = 'v1-marker';
      INSERT INTO permanent_progression_grants (
        profile_id, item_id, source_event_id, source_kind,
        source_level, source_character_id, granted_at
      ) VALUES (
        'v1-marker', 'dojo-frame-cherry-blossom', 'missing-event',
        'dojo-level', 5, NULL, 1
      );
    `],
    ['fake source level proof', `
      INSERT INTO progression_events VALUES (
        'fake-level-event', 'v1-marker', 'completed-hand', 1,
        '{"eventId":"fake-level-event","dojoXpMilli":0,"dojoLevelsGained":[50],"characterId":"sakura","affinityMilli":0,"affinityLevelsGained":[],"missionCompletions":[],"grantedItemIds":["dojo-frame-master"]}',
        1
      );
      INSERT INTO permanent_progression_grants (
        profile_id, item_id, source_event_id, source_kind,
        source_level, source_character_id, granted_at
      ) VALUES (
        'v1-marker', 'dojo-frame-master', 'fake-level-event',
        'dojo-level', 50, NULL, 1
      );
    `],
    ['permanent receipt inventory mismatch', `
      UPDATE progression_profiles SET dojo_level = 5, dojo_xp_milli = 0
      WHERE profile_id = 'v1-marker';
      INSERT INTO progression_events VALUES (
        'valid-level-event', 'v1-marker', 'completed-hand', 1,
        '{"eventId":"valid-level-event","dojoXpMilli":0,"dojoLevelsGained":[5],"characterId":"sakura","affinityMilli":0,"affinityLevelsGained":[],"missionCompletions":[],"grantedItemIds":["dojo-frame-cherry-blossom"]}',
        1
      );
      INSERT INTO permanent_progression_grants (
        profile_id, item_id, source_event_id, source_kind,
        source_level, source_character_id, granted_at
      ) VALUES (
        'v1-marker', 'dojo-frame-cherry-blossom', 'valid-level-event',
        'dojo-level', 5, NULL, 1
      );
      DROP TRIGGER protect_permanent_inventory_update;
      UPDATE inventory_items SET updated_at = 2
      WHERE profile_id = 'v1-marker'
        AND item_id = 'dojo-frame-cherry-blossom';
    `],
    ['missing equipment slot', `
      DELETE FROM profile_equipment
      WHERE profile_id = 'v1-marker' AND slot = 'cutin';
    `],
    ['inventory timestamp outside canonical range', `
      INSERT INTO inventory_items VALUES (
        'v1-marker', 'dojo-frame-cherry-blossom', 1,
        253402300800000, 253402300800000
      );
    `],
    ['equipment timestamp outside canonical range', `
      UPDATE profile_equipment SET updated_at = 253402300800000
      WHERE profile_id = 'v1-marker' AND slot = 'title';
    `],
  ])('atomically rejects corrupt V11 %s during V12 upgrade', (_label, mutation) => {
    const directory = mkdtempSync(join(tmpdir(), 'poker-doku-v11-invalid-'));
    temporaryDirectories.push(directory);
    const path = join(directory, 'poker.sqlite');
    createV11Database(path);
    const raw = new DatabaseSync(path);
    try {
      raw.exec('PRAGMA foreign_keys=OFF;');
      raw.exec(mutation);
    } finally {
      raw.close();
    }

    expectOpenDatabaseToThrow(path);

    const after = new DatabaseSync(path);
    try {
      expect(after.prepare(`
        SELECT MAX(version) AS version FROM schema_migrations
      `).get()).toEqual({ version: 11 });
      expect(after.prepare(`
        SELECT COUNT(*) AS count FROM sqlite_schema
        WHERE type = 'table' AND name = 'collection_catalog'
      `).get()).toEqual({ count: 0 });
    } finally {
      after.close();
    }
  });

  it.each([
    ['missing equipment slot', `
      DROP TRIGGER reject_catalog_equipment_delete;
      DELETE FROM profile_equipment
      WHERE profile_id = 'v1-marker' AND slot = 'cutin';
    `],
    ['inventory timestamp outside canonical range', `
      INSERT INTO inventory_items VALUES (
        'v1-marker', 'dojo-frame-cherry-blossom', 1,
        253402300800000, 253402300800000
      );
    `],
    ['equipment timestamp outside canonical range', `
      UPDATE profile_equipment SET updated_at = 253402300800000
      WHERE profile_id = 'v1-marker' AND slot = 'title';
    `],
    ['partial permanent source summary', `
      UPDATE progression_profiles SET dojo_level = 5, dojo_xp_milli = 0
      WHERE profile_id = 'v1-marker';
      INSERT INTO progression_events VALUES (
        'v12-partial-source', 'v1-marker', 'completed-hand', 1,
        '{"dojoLevelsGained":[5],"grantedItemIds":["dojo-frame-cherry-blossom"]}',
        1
      );
      INSERT INTO permanent_progression_grants VALUES (
        'v1-marker', 'dojo-frame-cherry-blossom', 'v12-partial-source',
        'dojo-level', 5, NULL, 1
      );
    `],
    ['unsupported-balance permanent source', `
      UPDATE progression_profiles SET dojo_level = 5, dojo_xp_milli = 0
      WHERE profile_id = 'v1-marker';
      INSERT INTO progression_events VALUES (
        'v12-balance-source', 'v1-marker', 'completed-hand', 2,
        '{"eventId":"v12-balance-source","dojoXpMilli":10000,"dojoLevelsGained":[5],"characterId":"sakura","affinityMilli":2000,"affinityLevelsGained":[],"missionCompletions":[],"grantedItemIds":["dojo-frame-cherry-blossom"]}',
        1
      );
      INSERT INTO permanent_progression_grants VALUES (
        'v1-marker', 'dojo-frame-cherry-blossom', 'v12-balance-source',
        'dojo-level', 5, NULL, 1
      );
    `],
  ])('atomically rejects corrupt V12 %s during V13 upgrade', (_label, mutation) => {
    const directory = mkdtempSync(join(tmpdir(), 'poker-doku-v12-invalid-'));
    temporaryDirectories.push(directory);
    const path = join(directory, 'poker.sqlite');
    createV12Database(path);
    const raw = new DatabaseSync(path);
    try {
      raw.exec(mutation);
    } finally {
      raw.close();
    }

    expectOpenDatabaseToThrow(path);

    const after = new DatabaseSync(path);
    try {
      expect(after.prepare(`
        SELECT MAX(version) AS version FROM schema_migrations
      `).get()).toEqual({ version: 12 });
      expect(after.prepare(`
        SELECT COUNT(*) AS count FROM sqlite_schema
        WHERE type = 'view'
          AND name = 'canonical_progression_reward_source_events'
      `).get()).toEqual({ count: 0 });
    } finally {
      after.close();
    }
  });

  it('upgrades an existing V1 database through the latest schema once while preserving data', () => {
    const directory = mkdtempSync(join(tmpdir(), 'poker-doku-'));
    temporaryDirectories.push(directory);
    const path = join(directory, 'poker.sqlite');
    createV1Database(path);

    database = openPokerDatabase(path);
    database.close();
    database = openPokerDatabase(path);

    const versions = database.db.prepare(`
      SELECT version FROM schema_migrations ORDER BY version
    `).all();
    const marker = database.db.prepare(`
      SELECT alias FROM profiles WHERE id = 'v1-marker'
    `).get();
    const index = database.db.prepare(`
      SELECT name FROM sqlite_schema
      WHERE type = 'index' AND name = 'idx_rescue_claims_profile_claimed_at_desc'
    `).get();

    expect(versions).toEqual([
      { version: 1 }, { version: 2 }, { version: 3 }, { version: 4 },
      { version: 5 }, { version: 6 }, { version: 7 }, { version: 8 },
      { version: 9 },
      { version: 10 }, { version: 11 }, { version: 12 }, { version: 13 },
      { version: 14 },
      { version: 15 },
      { version: 16 }, { version: 17 }, { version: 18 },
      { version: 19 }, { version: 20 }, { version: 21 }, { version: 22 },
      { version: 23 }, { version: 24 },
    ]);
    expect(marker).toEqual({ alias: 'v1-marker-alias' });
    expect(index).toEqual({
      name: 'idx_rescue_claims_profile_claimed_at_desc',
    });
  });

  it('atomically upgrades an existing V2 database to the durable V3 cash identity schema', () => {
    const directory = mkdtempSync(join(tmpdir(), 'poker-doku-'));
    temporaryDirectories.push(directory);
    const path = join(directory, 'poker.sqlite');
    createV2Database(path);

    database = openPokerDatabase(path);

    expect(database.db.prepare(`
      SELECT version FROM schema_migrations ORDER BY version
    `).all()).toEqual([
      { version: 1 }, { version: 2 }, { version: 3 }, { version: 4 },
      { version: 5 }, { version: 6 }, { version: 7 }, { version: 8 },
      { version: 9 },
      { version: 10 }, { version: 11 }, { version: 12 }, { version: 13 },
      { version: 14 },
      { version: 15 },
      { version: 16 }, { version: 17 }, { version: 18 },
      { version: 19 }, { version: 20 }, { version: 21 }, { version: 22 },
      { version: 23 }, { version: 24 },
    ]);
    expect(database.tableNames()).toContain('cash_hand_settlements');
    expect(database.db.prepare(`
      SELECT alias FROM profiles WHERE id = 'v1-marker'
    `).get()).toEqual({ alias: 'v1-marker-alias' });
  });

  it('atomically upgrades V3 SNG rows to collision-safe tournament identities', () => {
    const directory = mkdtempSync(join(tmpdir(), 'poker-doku-'));
    temporaryDirectories.push(directory);
    const path = join(directory, 'poker.sqlite');
    createV3Database(path);
    const rawDatabase = new DatabaseSync(path);
    rawDatabase.exec(`
      INSERT INTO sng_entries (
        room_id, profile_id, buy_in, fee, status, place, prize,
        created_at, updated_at
      ) VALUES ('legacy-room', 'v1-marker', 1500, 150, 'reserved', NULL, 0, 3, 3);
    `);
    rawDatabase.close();

    database = openPokerDatabase(path);

    expect(database.db.prepare(`
      SELECT id, tournament_id, room_id, profile_id, start_attempt, status
      FROM sng_entries
    `).get()).toEqual({
      id: 'legacy:legacy-room:v1-marker',
      tournament_id: 'legacy:legacy-room',
      room_id: 'legacy-room',
      profile_id: 'v1-marker',
      start_attempt: 0,
      status: 'reserved',
    });
    expect(database.db.prepare(`
      SELECT version FROM schema_migrations ORDER BY version
    `).all()).toEqual([
      { version: 1 }, { version: 2 }, { version: 3 }, { version: 4 },
      { version: 5 }, { version: 6 }, { version: 7 }, { version: 8 },
      { version: 9 },
      { version: 10 }, { version: 11 }, { version: 12 }, { version: 13 },
      { version: 14 },
      { version: 15 },
      { version: 16 }, { version: 17 }, { version: 18 },
      { version: 19 }, { version: 20 }, { version: 21 }, { version: 22 },
      { version: 23 }, { version: 24 },
    ]);
  });

  it('upgrades V4 data through V5 exactly once without rewriting prior migrations', () => {
    const directory = mkdtempSync(join(tmpdir(), 'poker-doku-'));
    temporaryDirectories.push(directory);
    const path = join(directory, 'poker.sqlite');
    createV4Database(path);
    const rawDatabase = new DatabaseSync(path);
    rawDatabase.exec(`
      INSERT INTO cash_hand_settlements (
        room_id, settlement_seq, engine_hand_number, start_fingerprint,
        settlement_fingerprint, status, updated_at
      ) VALUES (
        'v4-room', 1, 1,
        'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        NULL, 'prepared', 4
      );
      INSERT INTO sng_entries (
        id, tournament_id, room_id, profile_id, buy_in, fee, status,
        place, prize, start_attempt, created_at, updated_at
      ) VALUES (
        'v4-entry', 'v4-tournament', 'v4-sng-room', 'v1-marker',
        1500, 150, 'reserved', NULL, 0, 0, 4, 4
      );
    `);
    rawDatabase.close();

    database = openPokerDatabase(path);
    database.close();
    database = openPokerDatabase(path);

    expect(database.db.prepare(`
      SELECT version FROM schema_migrations ORDER BY version
    `).all()).toEqual([
      { version: 1 }, { version: 2 }, { version: 3 }, { version: 4 },
      { version: 5 }, { version: 6 }, { version: 7 }, { version: 8 },
      { version: 9 },
      { version: 10 }, { version: 11 }, { version: 12 }, { version: 13 },
      { version: 14 },
      { version: 15 },
      { version: 16 }, { version: 17 }, { version: 18 },
      { version: 19 }, { version: 20 }, { version: 21 }, { version: 22 },
      { version: 23 }, { version: 24 },
    ]);
    expect(database.db.prepare(`
      SELECT alias FROM profiles WHERE id = 'v1-marker'
    `).get()).toEqual({ alias: 'v1-marker-alias' });
    expect(database.db.prepare(`
      SELECT status FROM cash_hand_settlements WHERE room_id = 'v4-room'
    `).get()).toEqual({ status: 'prepared' });
    expect(database.db.prepare(`
      SELECT status FROM sng_entries WHERE id = 'v4-entry'
    `).get()).toEqual({ status: 'reserved' });
  });

  it('creates constrained STRICT progression tables with useful indexes', () => {
    database = openPokerDatabase(':memory:');

    const tableSql = database.db.prepare(`
      SELECT name, sql FROM sqlite_schema
      WHERE type = 'table' AND name IN (
        'progression_profiles', 'character_affinity', 'daily_missions',
        'streak_state', 'inventory_items', 'profile_equipment',
        'progression_events'
      )
      ORDER BY name
    `).all() as Array<{ name: string; sql: string }>;
    const foreignKeys = database.db.prepare(`
      PRAGMA foreign_key_list(progression_profiles)
    `).all() as Array<{ table: string; on_delete: string }>;
    const equipmentForeignKeys = database.db.prepare(`
      PRAGMA foreign_key_list(profile_equipment)
    `).all() as Array<{
      table: string;
      from: string;
      to: string;
      on_update: string;
      on_delete: string;
    }>;
    const indexes = database.db.prepare(`
      SELECT name FROM sqlite_schema
      WHERE type = 'index' AND name LIKE 'idx_progression_%'
      ORDER BY name
    `).all().map(row => (row as { name: string }).name);

    expect(tableSql).toHaveLength(7);
    expect(tableSql.every(table => table.sql.endsWith('STRICT'))).toBe(true);
    expect(foreignKeys).toEqual(expect.arrayContaining([
      expect.objectContaining({ table: 'profiles', on_delete: 'CASCADE' }),
    ]));
    expect(equipmentForeignKeys).toEqual(expect.arrayContaining([
      expect.objectContaining({
        table: 'inventory_items',
        from: 'profile_id',
        to: 'profile_id',
        on_update: 'CASCADE',
        on_delete: 'NO ACTION',
      }),
      expect.objectContaining({
        table: 'inventory_items',
        from: 'item_id',
        to: 'item_id',
        on_update: 'CASCADE',
        on_delete: 'NO ACTION',
      }),
    ]));
    expect(tableSql.find(table => table.name === 'profile_equipment')?.sql)
      .toContain('DEFERRABLE INITIALLY DEFERRED');
    expect(indexes).toEqual(expect.arrayContaining([
      'idx_progression_daily_date_profile',
      'idx_progression_events_profile_created_at_desc',
      'idx_progression_inventory_item_profile',
    ]));

    insertProfile(database, 'progression-constraints');
    expect(() => database?.db.prepare(`
      INSERT INTO progression_profiles (
        profile_id, balance_version, dojo_level, dojo_xp_milli,
        selected_character_id, practice_date, practice_hands,
        completed_hands, cash_hands, practice_hands_total, sng_completions,
        best_streak, created_at, updated_at
      ) VALUES (?, 1, 51, 0, 'sakura', NULL, 0, 0, 0, 0, 0, 0, 1, 1)
    `).run('progression-constraints')).toThrow();
    expect(() => database?.db.prepare(`
      INSERT INTO profile_equipment (profile_id, slot, item_id, updated_at)
      VALUES (?, 'weapon', NULL, 1)
    `).run('progression-constraints')).toThrow();
  });

  it('enforces same-profile equipment ownership while allowing null slots', () => {
    database = openPokerDatabase(':memory:');
    const db = database.db;
    insertProfile(database, 'equipment-owner');
    insertProfile(database, 'equipment-other');
    const progression = new ProgressionRepository(database);
    progression.getOrCreate('equipment-owner', 'sakura', 1);
    progression.getOrCreate('equipment-other', 'sakura', 1);
    db.prepare(`
      INSERT INTO inventory_items (
        profile_id, item_id, quantity, granted_at, updated_at
      ) VALUES ('equipment-owner', 'dojo-title-sprout-challenger', 1, 1, 1)
    `).run();

    expect(db.prepare(`
      SELECT slot, item_id FROM profile_equipment
      WHERE profile_id = 'equipment-owner' ORDER BY slot
    `).all()).toEqual([
      { slot: 'cutin', item_id: null },
      { slot: 'frame', item_id: null },
      { slot: 'skin', item_id: null },
      { slot: 'title', item_id: null },
    ]);
    expect(() => db.prepare(`
      UPDATE profile_equipment SET item_id = 'missing-item'
      WHERE profile_id = 'equipment-owner' AND slot = 'frame'
    `).run()).toThrow();
    expect(() => db.prepare(`
      UPDATE profile_equipment SET item_id = 'dojo-title-sprout-challenger'
      WHERE profile_id = 'equipment-other' AND slot = 'title'
    `).run()).toThrow();

    db.prepare(`
      UPDATE profile_equipment SET item_id = 'dojo-title-sprout-challenger'
      WHERE profile_id = 'equipment-owner' AND slot = 'title'
    `).run();
    expect(db.prepare(`
      SELECT item_id FROM profile_equipment
      WHERE profile_id = 'equipment-owner' AND slot = 'title'
    `).get()).toEqual({ item_id: 'dojo-title-sprout-challenger' });
    expect(() => db.prepare(`
      UPDATE inventory_items SET item_id = 'dojo-frame-cherry-blossom'
      WHERE profile_id = 'equipment-owner'
        AND item_id = 'dojo-title-sprout-challenger'
    `).run()).toThrow();
    expect(db.prepare(`
      SELECT item_id FROM profile_equipment
      WHERE profile_id = 'equipment-owner' AND slot = 'title'
    `).get()).toEqual({ item_id: 'dojo-title-sprout-challenger' });
    expect(() => db.prepare(`
      DELETE FROM inventory_items
      WHERE profile_id = 'equipment-owner'
        AND item_id = 'dojo-title-sprout-challenger'
    `).run()).toThrow();
  });

  it('enforces max-level XP and real canonical progression dates in V5', () => {
    database = openPokerDatabase(':memory:');
    const db = database.db;
    insertProfile(database, 'durable-constraints');
    db.prepare(`
      INSERT INTO progression_profiles (
        profile_id, balance_version, dojo_level, dojo_xp_milli,
        selected_character_id, practice_date, practice_hands,
        completed_hands, cash_hands, practice_hands_total, sng_completions,
        best_streak, created_at, updated_at
      ) VALUES (?, 1, 1, 0, 'sakura', '2024-02-29', 1, 0, 0, 0, 0, 0, 1, 1)
    `).run('durable-constraints');
    db.prepare(`
      INSERT INTO character_affinity VALUES (
        'durable-constraints', 'sakura', 1, 0
      )
    `).run();
    db.prepare(`
      INSERT INTO daily_missions (
        profile_id, mission_date, slot, mission_id, target, progress,
        balance_version, reroll_count, assigned_at, completed_at, rewarded_at
      ) VALUES (
        'durable-constraints', '2024-02-29', 0, 'COMPLETE_ONE_SNG', 1, 0,
        1, 0, 1, NULL, NULL
      )
    `).run();
    db.prepare(`
      UPDATE streak_state
      SET rest_passes = 1, last_week_key = '2026-W53'
      WHERE profile_id = 'durable-constraints'
    `).run();
    db.prepare(`
      UPDATE streak_state
      SET current_streak = 1, last_qualified_date = '2024-02-29'
      WHERE profile_id = 'durable-constraints'
    `).run();

    for (const invalidDate of [
      '2026-02-30',
      '2026-99-01',
      '2026-01-00',
      '0000-01-01',
    ]) {
      expect(() => db.prepare(`
        UPDATE progression_profiles SET practice_date = ?
        WHERE profile_id = 'durable-constraints'
      `).run(invalidDate)).toThrow();
      expect(() => db.prepare(`
        UPDATE daily_missions SET mission_date = ?
        WHERE profile_id = 'durable-constraints'
      `).run(invalidDate)).toThrow();
      expect(() => db.prepare(`
        UPDATE streak_state SET last_qualified_date = ?
        WHERE profile_id = 'durable-constraints'
      `).run(invalidDate)).toThrow();
    }
    for (const invalidWeek of [
      '2026-W00', '2026-W54', '2026-W1', 'not-a-week', '0000-W01',
    ]) {
      expect(() => db.prepare(`
        UPDATE streak_state SET last_week_key = ?
        WHERE profile_id = 'durable-constraints'
      `).run(invalidWeek)).toThrow();
    }
    expect(() => db.prepare(`
      UPDATE progression_profiles SET dojo_level = 50, dojo_xp_milli = 1
      WHERE profile_id = 'durable-constraints'
    `).run()).toThrow();
    expect(() => db.prepare(`
      UPDATE character_affinity SET level = 20, xp_milli = 1
      WHERE profile_id = 'durable-constraints' AND character_id = 'sakura'
    `).run()).toThrow();
    expect(() => db.prepare(`
      UPDATE progression_profiles SET dojo_level = 1, dojo_xp_milli = 100000
      WHERE profile_id = 'durable-constraints'
    `).run()).toThrow();
    expect(() => db.prepare(`
      UPDATE progression_profiles SET dojo_level = 49, dojo_xp_milli = 1300000
      WHERE profile_id = 'durable-constraints'
    `).run()).toThrow();
    expect(() => db.prepare(`
      UPDATE character_affinity SET level = 1, xp_milli = 40000
      WHERE profile_id = 'durable-constraints' AND character_id = 'sakura'
    `).run()).toThrow();
    expect(() => db.prepare(`
      UPDATE character_affinity SET level = 19, xp_milli = 310000
      WHERE profile_id = 'durable-constraints' AND character_id = 'sakura'
    `).run()).toThrow();
    expect(() => db.prepare(`
      UPDATE progression_profiles SET balance_version = 2
      WHERE profile_id = 'durable-constraints'
    `).run()).toThrow();

    db.prepare(`
      UPDATE progression_profiles SET dojo_level = 50, dojo_xp_milli = 0
      WHERE profile_id = 'durable-constraints'
    `).run();
    db.prepare(`
      UPDATE character_affinity SET level = 20, xp_milli = 0
      WHERE profile_id = 'durable-constraints' AND character_id = 'sakura'
    `).run();
    expect(db.prepare(`
      SELECT dojo_level, dojo_xp_milli FROM progression_profiles
      WHERE profile_id = 'durable-constraints'
    `).get()).toEqual({ dojo_level: 50, dojo_xp_milli: 0 });
  });

  it('rolls back all V5 tables and its version when a middle object conflicts', () => {
    const directory = mkdtempSync(join(tmpdir(), 'poker-doku-'));
    temporaryDirectories.push(directory);
    const path = join(directory, 'poker.sqlite');
    createV4Database(path);
    const rawDatabase = new DatabaseSync(path);
    rawDatabase.exec(`CREATE TABLE daily_missions (id TEXT) STRICT;`);
    rawDatabase.close();

    let unexpectedlyOpened: PokerDatabase | undefined;
    try {
      expect(() => {
        unexpectedlyOpened = openPokerDatabase(path);
      }).toThrowError('table daily_missions already exists');
    } finally {
      unexpectedlyOpened?.close();
    }
    const reopened = new DatabaseSync(path);
    try {
      expect(reopened.prepare(`
        SELECT version FROM schema_migrations ORDER BY version
      `).all()).toEqual([
        { version: 1 }, { version: 2 }, { version: 3 }, { version: 4 },
      ]);
      const tables = reopened.prepare(`
        SELECT name FROM sqlite_schema
        WHERE type = 'table' AND name LIKE 'progression_%'
      `).all().map(row => (row as { name: string }).name);
      expect(tables).toEqual([]);
      expect(reopened.prepare(`
        SELECT name FROM sqlite_schema
        WHERE type = 'table' AND name = 'character_affinity'
      `).get()).toBeUndefined();
    } finally {
      reopened.close();
    }
  });

  it('atomically upgrades V5 with durable distinct daily mission modes', () => {
    const directory = mkdtempSync(join(tmpdir(), 'poker-doku-'));
    temporaryDirectories.push(directory);
    const path = join(directory, 'poker.sqlite');
    createV5Database(path);
    const rawDatabase = new DatabaseSync(path);
    insertValidV5MissionDay(rawDatabase);
    rawDatabase.close();

    database = openPokerDatabase(path);

    expect(database.db.prepare(`
      SELECT version FROM schema_migrations ORDER BY version
    `).all()).toEqual([
      { version: 1 }, { version: 2 }, { version: 3 }, { version: 4 },
      { version: 5 }, { version: 6 }, { version: 7 }, { version: 8 },
      { version: 9 },
      { version: 10 }, { version: 11 }, { version: 12 }, { version: 13 },
      { version: 14 },
      { version: 15 },
      { version: 16 }, { version: 17 }, { version: 18 },
      { version: 19 }, { version: 20 }, { version: 21 }, { version: 22 },
      { version: 23 }, { version: 24 },
    ]);
    const table = database.db.prepare(`
      SELECT sql FROM sqlite_schema
      WHERE type = 'table' AND name = 'daily_mission_modes'
    `).get() as { sql: string };
    expect(table.sql).toContain('STRICT');
    expect(database.db.prepare(`
      SELECT alias FROM profiles WHERE id = 'v1-marker'
    `).get()).toEqual({ alias: 'v1-marker-alias' });
    expect(database.db.prepare(`
      SELECT slot, mission_id, target FROM daily_missions
      WHERE profile_id = 'v1-marker' AND mission_date = '2026-07-17'
      ORDER BY slot
    `).all()).toEqual([
      { slot: 0, mission_id: 'COMPLETE_HANDS_ANY_10', target: 10 },
      { slot: 1, mission_id: 'COMPLETE_HANDS_CASH_10', target: 10 },
      { slot: 2, mission_id: 'COMPLETE_ONE_SNG', target: 1 },
    ]);
  });

  it('rolls back every V6 object and version when its table conflicts', () => {
    const directory = mkdtempSync(join(tmpdir(), 'poker-doku-'));
    temporaryDirectories.push(directory);
    const path = join(directory, 'poker.sqlite');
    createV5Database(path);
    const rawDatabase = new DatabaseSync(path);
    rawDatabase.exec('CREATE TABLE daily_mission_modes (id TEXT) STRICT;');
    rawDatabase.close();

    expect(() => openPokerDatabase(path)).toThrowError(
      'table daily_mission_modes already exists',
    );

    const reopened = new DatabaseSync(path);
    try {
      expect(reopened.prepare(`
        SELECT version FROM schema_migrations ORDER BY version
      `).all()).toEqual([
        { version: 1 }, { version: 2 }, { version: 3 }, { version: 4 },
        { version: 5 },
      ]);
      expect(reopened.prepare(`
        SELECT name FROM sqlite_schema
        WHERE type = 'trigger' AND name LIKE 'validate_daily_mission_%'
      `).all()).toEqual([]);
    } finally {
      reopened.close();
    }
  });

  it.each([
    [
      'unknown catalog id',
      `UPDATE daily_missions
       SET mission_id = 'COMPLETE_FAKE_MISSION'
       WHERE slot = 0`,
    ],
    [
      'catalog target mismatch',
      `UPDATE daily_missions SET target = 11 WHERE slot = 0`,
    ],
    [
      'unsupported balance version',
      `UPDATE daily_missions SET balance_version = 2 WHERE slot = 0`,
    ],
    [
      'more than one reroll in a day',
      `UPDATE daily_missions SET reroll_count = 1 WHERE slot IN (0, 1)`,
    ],
    [
      'invalid per-row reroll count',
      `UPDATE daily_missions SET reroll_count = 2 WHERE slot = 0`,
    ],
    [
      'partial three-slot day',
      `DELETE FROM daily_missions WHERE slot = 2`,
    ],
    [
      'progress beyond target',
      `UPDATE daily_missions SET progress = target + 1 WHERE slot = 0`,
    ],
    [
      'incomplete reward timestamps',
      `UPDATE daily_missions
       SET progress = target, completed_at = 2, rewarded_at = NULL
       WHERE slot = 0`,
    ],
  ])('atomically rejects V5 mission data with %s during V6 upgrade', (
    _label,
    corruption,
  ) => {
    const directory = mkdtempSync(join(tmpdir(), 'poker-doku-'));
    temporaryDirectories.push(directory);
    const path = join(directory, 'poker.sqlite');
    createV5Database(path);
    const rawDatabase = new DatabaseSync(path);
    insertValidV5MissionDay(rawDatabase);
    rawDatabase.exec(corruption);
    rawDatabase.close();

    let unexpectedlyOpened: PokerDatabase | undefined;
    try {
      expect(() => {
        unexpectedlyOpened = openPokerDatabase(path);
      }).toThrow();
    } finally {
      unexpectedlyOpened?.close();
    }

    const reopened = new DatabaseSync(path);
    try {
      expect(reopened.prepare(`
        SELECT version FROM schema_migrations ORDER BY version
      `).all()).toEqual([
        { version: 1 }, { version: 2 }, { version: 3 }, { version: 4 },
        { version: 5 },
      ]);
      expect(reopened.prepare(`
        SELECT name FROM sqlite_schema
        WHERE name IN (
          'v6_daily_mission_validation',
          'daily_mission_modes', 'validate_daily_mission_insert',
          'validate_daily_mission_update'
        )
      `).all()).toEqual([]);
    } finally {
      reopened.close();
    }
  });

  it('enforces mission catalog, reward, and one-reroll invariants in V6', () => {
    database = openPokerDatabase(':memory:');
    insertProfile(database, 'mission-v6-constraints');
    const insert = database.db.prepare(`
      INSERT INTO daily_missions (
        profile_id, mission_date, slot, mission_id, target, progress,
        balance_version, reroll_count, assigned_at, completed_at, rewarded_at
      ) VALUES (?, '2026-07-17', ?, ?, ?, 0, 1, 0, 1, NULL, NULL)
    `);
    insert.run(
      'mission-v6-constraints', 0, 'COMPLETE_HANDS_ANY_10', 10,
    );
    insert.run(
      'mission-v6-constraints', 1, 'COMPLETE_HANDS_CASH_10', 10,
    );
    insert.run(
      'mission-v6-constraints', 2, 'COMPLETE_ONE_SNG', 1,
    );

    expect(() => database?.db.prepare(`
      UPDATE daily_missions SET target = 11
      WHERE profile_id = 'mission-v6-constraints' AND slot = 0
    `).run()).toThrowError('invalid daily mission');
    expect(() => database?.db.prepare(`
      UPDATE daily_missions SET progress = target, completed_at = 2
      WHERE profile_id = 'mission-v6-constraints' AND slot = 0
    `).run()).toThrowError('invalid daily mission');
    database.db.prepare(`
      UPDATE daily_missions
      SET mission_id = 'COMPLETE_HANDS_PRACTICE_10', reroll_count = 1
      WHERE profile_id = 'mission-v6-constraints' AND slot = 0
    `).run();
    expect(() => database?.db.prepare(`
      UPDATE daily_missions SET reroll_count = 0
      WHERE profile_id = 'mission-v6-constraints' AND slot = 0
    `).run()).toThrowError('invalid daily mission');
    expect(() => database?.db.prepare(`
      UPDATE daily_missions
      SET mission_id = 'COMPLETE_HANDS_ANY_20', target = 20
      WHERE profile_id = 'mission-v6-constraints' AND slot = 0
    `).run()).toThrowError('invalid daily mission');
    expect(() => database?.db.prepare(`
      UPDATE daily_missions SET assigned_at = 2
      WHERE profile_id = 'mission-v6-constraints' AND slot = 0
    `).run()).toThrowError('invalid daily mission');
    database.db.prepare(`
      UPDATE daily_missions SET progress = 1
      WHERE profile_id = 'mission-v6-constraints' AND slot = 0
    `).run();
    expect(() => database?.db.prepare(`
      UPDATE daily_missions SET progress = 0
      WHERE profile_id = 'mission-v6-constraints' AND slot = 0
    `).run()).toThrowError('invalid daily mission');
    database.db.prepare(`
      UPDATE daily_missions
      SET progress = target, completed_at = 3, rewarded_at = 3
      WHERE profile_id = 'mission-v6-constraints' AND slot = 0
    `).run();
    expect(() => database?.db.prepare(`
      UPDATE daily_missions SET completed_at = 4, rewarded_at = 4
      WHERE profile_id = 'mission-v6-constraints' AND slot = 0
    `).run()).toThrowError('invalid daily mission');
    expect(() => database?.db.prepare(`
      UPDATE daily_missions
      SET progress = 0, completed_at = NULL, rewarded_at = NULL
      WHERE profile_id = 'mission-v6-constraints' AND slot = 0
    `).run()).toThrowError('invalid daily mission');
    expect(database.db.prepare(`
      SELECT mission_id, reroll_count, assigned_at, progress,
             completed_at, rewarded_at
      FROM daily_missions
      WHERE profile_id = 'mission-v6-constraints' AND slot = 0
    `).get()).toEqual({
      mission_id: 'COMPLETE_HANDS_PRACTICE_10',
      reroll_count: 1,
      assigned_at: 1,
      progress: 10,
      completed_at: 3,
      rewarded_at: 3,
    });
    expect(() => database?.db.prepare(`
      UPDATE daily_missions
      SET mission_id = 'COMPLETE_HANDS_ANY_20', target = 20, reroll_count = 1
      WHERE profile_id = 'mission-v6-constraints' AND slot = 1
    `).run()).toThrowError('invalid daily mission');
    expect(() => database?.db.prepare(`
      INSERT INTO daily_mission_modes VALUES (
        'mission-v6-constraints', '2026-07-17', 'ranked', 1
      )
    `).run()).toThrow();
  });

  it('atomically upgrades V6 with durable streak daily progress', () => {
    const directory = mkdtempSync(join(tmpdir(), 'poker-doku-'));
    temporaryDirectories.push(directory);
    const path = join(directory, 'poker.sqlite');
    createV6Database(path);
    const rawDatabase = new DatabaseSync(path);
    rawDatabase.exec(`
      INSERT INTO progression_profiles VALUES (
        'v1-marker', 1, 1, 0, 'sakura', NULL,
        0, 0, 0, 0, 0, 3, 1, 1
      );
      INSERT INTO profile_equipment VALUES
        ('v1-marker', 'title', NULL, 1),
        ('v1-marker', 'frame', NULL, 1),
        ('v1-marker', 'skin', NULL, 1),
        ('v1-marker', 'cutin', NULL, 1);
      INSERT INTO streak_state VALUES (
        'v1-marker', 3, 1, '2026-07-17', '2026-W29', 1, 1
      );
    `);
    rawDatabase.close();

    database = openPokerDatabase(path);

    expect(database.db.prepare(`
      SELECT version FROM schema_migrations ORDER BY version
    `).all()).toEqual([
      { version: 1 }, { version: 2 }, { version: 3 }, { version: 4 },
      { version: 5 }, { version: 6 }, { version: 7 }, { version: 8 },
      { version: 9 },
      { version: 10 }, { version: 11 }, { version: 12 }, { version: 13 },
      { version: 14 },
      { version: 15 },
      { version: 16 }, { version: 17 }, { version: 18 },
      { version: 19 }, { version: 20 }, { version: 21 }, { version: 22 },
      { version: 23 }, { version: 24 },
    ]);
    const table = database.db.prepare(`
      SELECT sql FROM sqlite_schema
      WHERE type = 'table' AND name = 'streak_daily_progress'
    `).get() as { sql: string };
    expect(table.sql).toContain('STRICT');
    expect(database.db.prepare(`
      SELECT current_streak, rest_passes, last_qualified_date, last_week_key
      FROM streak_state WHERE profile_id = 'v1-marker'
    `).get()).toEqual({
      current_streak: 3,
      rest_passes: 1,
      last_qualified_date: '2026-07-17',
      last_week_key: '2026-W29',
    });
  });

  it('rolls back every V7 object and version when its table conflicts', () => {
    const directory = mkdtempSync(join(tmpdir(), 'poker-doku-'));
    temporaryDirectories.push(directory);
    const path = join(directory, 'poker.sqlite');
    createV6Database(path);
    const rawDatabase = new DatabaseSync(path);
    rawDatabase.exec('CREATE TABLE streak_daily_progress (id TEXT) STRICT;');
    rawDatabase.close();

    expect(() => openPokerDatabase(path)).toThrowError(
      'table streak_daily_progress already exists',
    );

    const reopened = new DatabaseSync(path);
    try {
      expect(reopened.prepare(`
        SELECT version FROM schema_migrations ORDER BY version
      `).all()).toEqual([
        { version: 1 }, { version: 2 }, { version: 3 }, { version: 4 },
        { version: 5 }, { version: 6 },
      ]);
      expect(reopened.prepare(`
        SELECT name FROM sqlite_schema
        WHERE name IN (
          'v7_streak_validation',
          'validate_streak_state_insert', 'validate_streak_state_update'
        )
      `).all()).toEqual([]);
    } finally {
      reopened.close();
    }
  });

  it('rejects inconsistent legacy streak state before applying V7', () => {
    const directory = mkdtempSync(join(tmpdir(), 'poker-doku-'));
    temporaryDirectories.push(directory);
    const path = join(directory, 'poker.sqlite');
    createV6Database(path);
    const rawDatabase = new DatabaseSync(path);
    rawDatabase.exec(`
      INSERT INTO progression_profiles VALUES (
        'v1-marker', 1, 1, 0, 'sakura', NULL,
        0, 0, 0, 0, 0, 2, 1, 1
      );
      INSERT INTO streak_state VALUES (
        'v1-marker', 2, 0, NULL, NULL, 1, 1
      );
    `);
    rawDatabase.close();

    expect(() => openPokerDatabase(path)).toThrow();
    const reopened = new DatabaseSync(path);
    try {
      expect(reopened.prepare(`
        SELECT MAX(version) AS version FROM schema_migrations
      `).get()).toEqual({ version: 6 });
      expect(reopened.prepare(`
        SELECT name FROM sqlite_schema
        WHERE name = 'streak_daily_progress'
      `).get()).toBeUndefined();
    } finally {
      reopened.close();
    }
  });

  it('rejects a non-existent ISO week from legacy V6 before applying V7', () => {
    const directory = mkdtempSync(join(tmpdir(), 'poker-doku-'));
    temporaryDirectories.push(directory);
    const path = join(directory, 'poker.sqlite');
    createV6Database(path);
    const rawDatabase = new DatabaseSync(path);
    rawDatabase.exec(`
      INSERT INTO progression_profiles VALUES (
        'v1-marker', 1, 1, 0, 'sakura', NULL,
        0, 0, 0, 0, 0, 0, 1, 1
      );
      INSERT INTO streak_state VALUES (
        'v1-marker', 0, 0, NULL, '2021-W53', 1, 1
      );
    `);
    rawDatabase.close();

    expect(() => openPokerDatabase(path)).toThrow();
    const reopened = new DatabaseSync(path);
    try {
      expect(reopened.prepare(`
        SELECT MAX(version) AS version FROM schema_migrations
      `).get()).toEqual({ version: 6 });
    } finally {
      reopened.close();
    }
  });

  it('rejects a legacy progression profile without its one-to-one streak row', () => {
    const directory = mkdtempSync(join(tmpdir(), 'poker-doku-'));
    temporaryDirectories.push(directory);
    const path = join(directory, 'poker.sqlite');
    createV6Database(path);
    const rawDatabase = new DatabaseSync(path);
    rawDatabase.exec(`
      INSERT INTO progression_profiles VALUES (
        'v1-marker', 1, 1, 0, 'sakura', NULL,
        0, 0, 0, 0, 0, 0, 1, 1
      );
    `);
    rawDatabase.close();

    expect(() => openPokerDatabase(path)).toThrow();
    const reopened = new DatabaseSync(path);
    try {
      expect(reopened.prepare(`
        SELECT MAX(version) AS version FROM schema_migrations
      `).get()).toEqual({ version: 6 });
    } finally {
      reopened.close();
    }
  });

  it('enforces canonical bounded qualification rows and monotonic streak state in V7', () => {
    database = openPokerDatabase(':memory:');
    insertProfile(database, 'streak-v7-constraints');
    database.db.exec(`
      INSERT INTO progression_profiles VALUES (
        'streak-v7-constraints', 1, 1, 0, 'sakura', NULL,
        0, 0, 0, 0, 0, 0, 1, 1
      );
    `);

    expect(() => database?.db.prepare(`
      INSERT INTO streak_daily_progress VALUES (
        'streak-v7-constraints', '2026-02-30', 0, 0, NULL
      )
    `).run()).toThrow();
    expect(() => database?.db.prepare(`
      INSERT INTO streak_daily_progress VALUES (
        'streak-v7-constraints', '2026-07-17', 9, 0, 2
      )
    `).run()).toThrow();
    database.db.prepare(`
      INSERT INTO streak_daily_progress VALUES (
        'streak-v7-constraints', '2026-07-17', 0, 1,
        ${Date.parse('2026-07-17T12:00:00+09:00')}
      )
    `).run();
    expect(() => database?.db.prepare(`
      UPDATE streak_daily_progress SET hands = 9
      WHERE profile_id = 'streak-v7-constraints'
    `).run()).toThrow();
    database.db.prepare(`
      UPDATE streak_state
      SET last_week_key = '2026-W29', rest_passes = 1
      WHERE profile_id = 'streak-v7-constraints'
    `).run();
    database.db.prepare(`
      UPDATE streak_state
      SET current_streak = 1, last_qualified_date = '2026-07-17'
      WHERE profile_id = 'streak-v7-constraints'
    `).run();
    expect(() => database?.db.prepare(`
      UPDATE streak_state SET last_qualified_date = '2026-07-16'
      WHERE profile_id = 'streak-v7-constraints'
    `).run()).toThrowError('invalid streak state');
    expect(() => database?.db.prepare(`
      UPDATE streak_state SET last_week_key = '2026-W28'
      WHERE profile_id = 'streak-v7-constraints'
    `).run()).toThrowError('invalid streak state');
    expect(() => database?.db.prepare(`
      UPDATE streak_state SET last_week_key = NULL
      WHERE profile_id = 'streak-v7-constraints'
    `).run()).toThrowError('invalid streak state');
    expect(() => database?.db.prepare(`
      UPDATE streak_state SET current_streak = 3
      WHERE profile_id = 'streak-v7-constraints'
    `).run()).toThrowError('invalid streak state');
    expect(() => database?.db.prepare(`
      UPDATE streak_state
      SET current_streak = 0, last_qualified_date = NULL
      WHERE profile_id = 'streak-v7-constraints'
    `).run()).toThrowError('invalid streak state');
    expect(() => database?.db.prepare(`
      UPDATE streak_state
      SET current_streak = 2, rest_passes = 0,
          last_qualified_date = '2026-07-18'
      WHERE profile_id = 'streak-v7-constraints'
    `).run()).toThrowError('invalid streak state');
    expect(() => database?.db.prepare(`
      UPDATE streak_state
      SET current_streak = 2, rest_passes = 1,
          last_qualified_date = '2026-07-19'
      WHERE profile_id = 'streak-v7-constraints'
    `).run()).toThrowError('invalid streak state');
    expect(() => database?.db.prepare(`
      UPDATE streak_state
      SET current_streak = 2, rest_passes = 1,
          last_qualified_date = '2026-07-20'
      WHERE profile_id = 'streak-v7-constraints'
    `).run()).toThrowError('invalid streak state');

    database.db.prepare(`
      UPDATE streak_state
      SET current_streak = 2, rest_passes = 0,
          last_qualified_date = '2026-07-19', updated_at = 2
      WHERE profile_id = 'streak-v7-constraints'
    `).run();
    expect(() => database?.db.prepare(`
      UPDATE streak_state SET last_week_key = '2026-W30'
      WHERE profile_id = 'streak-v7-constraints'
    `).run()).toThrowError('invalid streak state');
    database.db.prepare(`
      UPDATE streak_state
      SET rest_passes = 1, last_week_key = '2026-W30', updated_at = 3
      WHERE profile_id = 'streak-v7-constraints'
    `).run();
    expect(() => database?.db.prepare(`
      UPDATE streak_state SET last_week_key = '2027-W53', updated_at = 4
      WHERE profile_id = 'streak-v7-constraints'
    `).run()).toThrowError('invalid streak state');
  });

  it('upgrades valid V7 rows to progression-owned V8 streak tables', () => {
    const directory = mkdtempSync(join(tmpdir(), 'poker-doku-'));
    temporaryDirectories.push(directory);
    const path = join(directory, 'poker.sqlite');
    createV7Database(path);
    const rawDatabase = new DatabaseSync(path);
    rawDatabase.exec(`
      INSERT INTO progression_profiles VALUES (
        'v1-marker', 1, 1, 0, 'sakura', NULL,
        0, 0, 0, 0, 0, 1, 10, 10
      );
      INSERT INTO profile_equipment VALUES
        ('v1-marker', 'title', NULL, 10),
        ('v1-marker', 'frame', NULL, 10),
        ('v1-marker', 'skin', NULL, 10),
        ('v1-marker', 'cutin', NULL, 10);
      INSERT INTO streak_state VALUES (
        'v1-marker', 1, 1, '2026-07-17', '2026-W29', 10, 10
      );
      INSERT INTO streak_daily_progress VALUES (
        'v1-marker', '2026-07-17', 0, 1,
        ${Date.parse('2026-07-17T12:00:00+09:00')}
      );
    `);
    rawDatabase.close();

    database = openPokerDatabase(path);

    expect(database.db.prepare(`
      SELECT MAX(version) AS version FROM schema_migrations
    `).get()).toEqual({ version: 24 });
    expect(database.db.prepare(`
      SELECT "table", "from", "to", on_delete
      FROM pragma_foreign_key_list('streak_state')
    `).all()).toContainEqual({
      table: 'progression_profiles',
      from: 'profile_id',
      to: 'profile_id',
      on_delete: 'CASCADE',
    });
    expect(database.db.prepare(`
      SELECT "table", "from", "to", on_delete
      FROM pragma_foreign_key_list('streak_daily_progress')
    `).all()).toContainEqual({
      table: 'progression_profiles',
      from: 'profile_id',
      to: 'profile_id',
      on_delete: 'CASCADE',
    });
    expect(database.db.prepare(`
      SELECT hands, sngs, qualified_at FROM streak_daily_progress
      WHERE profile_id = 'v1-marker'
    `).get()).toEqual({
      hands: 0,
      sngs: 1,
      qualified_at: Date.parse('2026-07-17T12:00:00+09:00'),
    });
  });

  it('enforces progression ownership and one-to-one streak lifecycle in V8', () => {
    database = openPokerDatabase(':memory:');
    insertProfile(database, 'v8-owned');
    expect(() => database?.db.prepare(`
      INSERT INTO streak_daily_progress VALUES (
        'v8-owned', '2026-07-17', 1, 0, NULL
      )
    `).run()).toThrow();

    database.db.exec(`
      INSERT INTO progression_profiles VALUES (
        'v8-owned', 1, 1, 0, 'sakura', NULL,
        0, 0, 0, 0, 0, 0, 1, 1
      );
    `);
    expect(database.db.prepare(`
      SELECT current_streak, rest_passes FROM streak_state
      WHERE profile_id = 'v8-owned'
    `).get()).toEqual({ current_streak: 0, rest_passes: 0 });
    expect(() => database?.db.prepare(`
      INSERT INTO progression_item_grants (
        idempotency_key, profile_id, item_id, source, source_ref,
        source_date, quantity, granted_at
      ) VALUES (
        'streak-fragment:v8-owned:2026-07-17', 'v8-owned',
        'streak-fragment', 'streak', 'missing-main-event',
        '2026-07-17', 1, ?
      )
    `).run(Date.parse('2026-07-17T12:00:00+09:00'))).toThrow();
    database.db.prepare(`
      DELETE FROM streak_state WHERE profile_id = 'v8-owned'
    `).run();
    expect(database.db.prepare(`
      SELECT COUNT(*) AS count FROM progression_profiles
      WHERE profile_id = 'v8-owned'
    `).get()).toEqual({ count: 1 });

    database.db.prepare(`
      INSERT INTO streak_daily_progress VALUES (
        'v8-owned', '2026-07-17', 1, 0, NULL
      )
    `).run();
    expect(() => database?.db.prepare(`
      DELETE FROM progression_profiles WHERE profile_id = 'v8-owned'
    `).run()).toThrowError('delete progression through profile owner');
    database.db.prepare(`
      DELETE FROM profiles WHERE id = 'v8-owned'
    `).run();
    expect(database.db.prepare(`
      SELECT COUNT(*) AS count FROM progression_profiles
      WHERE profile_id = 'v8-owned'
    `).get()).toEqual({ count: 0 });
    expect(database.db.prepare(`
      SELECT COUNT(*) AS count FROM streak_state WHERE profile_id = 'v8-owned'
    `).get()).toEqual({ count: 0 });
    expect(database.db.prepare(`
      SELECT COUNT(*) AS count FROM streak_daily_progress
      WHERE profile_id = 'v8-owned'
    `).get()).toEqual({ count: 0 });
  });

  it('accepts only one real hand or first-SNG transition per V8 daily write', () => {
    database = openPokerDatabase(':memory:');
    insertProfile(database, 'v8-transition');
    database.db.exec(`
      INSERT INTO progression_profiles VALUES (
        'v8-transition', 1, 1, 0, 'sakura', NULL,
        0, 0, 0, 0, 0, 0, 1, 1
      );
    `);
    const tenthAt = Date.parse('2026-07-17T12:00:00+09:00');

    expect(() => database?.db.prepare(`
      INSERT INTO streak_daily_progress VALUES (
        'v8-transition', '2026-07-17', 10, 0, ?
      )
    `).run(tenthAt)).toThrowError('invalid streak daily transition');
    database.db.prepare(`
      INSERT INTO streak_daily_progress VALUES (
        'v8-transition', '2026-07-17', 1, 0, NULL
      )
    `).run();
    expect(() => database?.db.prepare(`
      UPDATE streak_daily_progress SET hands = 10, qualified_at = ?
      WHERE profile_id = 'v8-transition' AND kst_date = '2026-07-17'
    `).run(tenthAt)).toThrowError('invalid streak daily transition');
    for (let hands = 2; hands <= 9; hands += 1) {
      database.db.prepare(`
        UPDATE streak_daily_progress SET hands = ?
        WHERE profile_id = 'v8-transition' AND kst_date = '2026-07-17'
      `).run(hands);
    }
    expect(() => database?.db.prepare(`
      UPDATE streak_daily_progress SET hands = 10, qualified_at = ?
      WHERE profile_id = 'v8-transition' AND kst_date = '2026-07-17'
    `).run(Number.MAX_SAFE_INTEGER + 1)).toThrow();
    expect(() => database?.db.prepare(`
      UPDATE streak_daily_progress SET hands = 10, qualified_at = ?
      WHERE profile_id = 'v8-transition' AND kst_date = '2026-07-17'
    `).run(Date.parse('2026-07-18T00:00:00+09:00'))).toThrow();
    database.db.prepare(`
      UPDATE streak_daily_progress SET hands = 10, qualified_at = ?
      WHERE profile_id = 'v8-transition' AND kst_date = '2026-07-17'
    `).run(tenthAt);

    database.db.prepare(`
      INSERT INTO streak_daily_progress VALUES (
        'v8-transition', '2026-07-18', 0, 1, ?
      )
    `).run(Date.parse('2026-07-18T12:00:00+09:00'));
  });

  it('rejects unsafe legacy V7 timestamps atomically before V8', () => {
    const directory = mkdtempSync(join(tmpdir(), 'poker-doku-'));
    temporaryDirectories.push(directory);
    const path = join(directory, 'poker.sqlite');
    createV7Database(path);
    const rawDatabase = new DatabaseSync(path);
    rawDatabase.exec(`
      INSERT INTO progression_profiles VALUES (
        'v1-marker', 1, 1, 0, 'sakura', NULL,
        0, 0, 0, 0, 0, 0, 1, 1
      );
      INSERT INTO streak_state VALUES (
        'v1-marker', 0, 0, NULL, '2026-W29', 1, 9007199254740992
      );
    `);
    rawDatabase.close();

    expect(() => openPokerDatabase(path)).toThrow();
    const reopened = new DatabaseSync(path);
    try {
      expect(reopened.prepare(`
        SELECT MAX(version) AS version FROM schema_migrations
      `).get()).toEqual({ version: 7 });
      expect(reopened.prepare(`
        SELECT name FROM sqlite_schema
        WHERE name = 'progression_item_grants'
      `).get()).toBeUndefined();
    } finally {
      reopened.close();
    }
  });

  it('rejects a V7 progression profile whose streak row was deleted', () => {
    const directory = mkdtempSync(join(tmpdir(), 'poker-doku-'));
    temporaryDirectories.push(directory);
    const path = join(directory, 'poker.sqlite');
    createV7Database(path);
    const rawDatabase = new DatabaseSync(path);
    rawDatabase.exec(`
      INSERT INTO progression_profiles VALUES (
        'v1-marker', 1, 1, 0, 'sakura', NULL,
        0, 0, 0, 0, 0, 0, 1, 1
      );
      INSERT INTO streak_state VALUES (
        'v1-marker', 0, 0, NULL, NULL, 1, 1
      );
      DELETE FROM streak_state WHERE profile_id = 'v1-marker';
    `);
    rawDatabase.close();

    expect(() => openPokerDatabase(path)).toThrow();
    const reopened = new DatabaseSync(path);
    try {
      expect(reopened.prepare(`
        SELECT MAX(version) AS version FROM schema_migrations
      `).get()).toEqual({ version: 7 });
    } finally {
      reopened.close();
    }
  });

  it('converts valid V7 fragment events into dedicated V8 grant receipts', () => {
    const directory = mkdtempSync(join(tmpdir(), 'poker-doku-'));
    temporaryDirectories.push(directory);
    const path = join(directory, 'poker.sqlite');
    createV7Database(path);
    const rawDatabase = new DatabaseSync(path);
    insertValidV7FragmentGrant(rawDatabase, 1);
    rawDatabase.close();

    database = openPokerDatabase(path);

    expect(database.db.prepare(`
      SELECT idempotency_key, profile_id, item_id, source, source_ref,
             source_date, quantity
      FROM progression_item_grants
    `).get()).toEqual({
      idempotency_key: 'streak-fragment:v1-marker:2026-07-17',
      profile_id: 'v1-marker',
      item_id: 'streak-fragment',
      source: 'streak',
      source_ref: 'streak-fragment:v1-marker:2026-07-17',
      source_date: '2026-07-17',
      quantity: 1,
    });
    expect(database.db.prepare(`
      SELECT quantity FROM inventory_items
      WHERE profile_id = 'v1-marker' AND item_id = 'streak-fragment'
    `).get()).toEqual({ quantity: 1 });
  });

  it('rejects a legacy fragment event and inventory quantity mismatch', () => {
    const directory = mkdtempSync(join(tmpdir(), 'poker-doku-'));
    temporaryDirectories.push(directory);
    const path = join(directory, 'poker.sqlite');
    createV7Database(path);
    const rawDatabase = new DatabaseSync(path);
    insertValidV7FragmentGrant(rawDatabase, 2);
    rawDatabase.close();

    expect(() => openPokerDatabase(path)).toThrow();
    const reopened = new DatabaseSync(path);
    try {
      expect(reopened.prepare(`
        SELECT MAX(version) AS version FROM schema_migrations
      `).get()).toEqual({ version: 7 });
      expect(reopened.prepare(`
        SELECT name FROM sqlite_schema
        WHERE name = 'progression_item_grants'
      `).get()).toBeUndefined();
    } finally {
      reopened.close();
    }
  });

  it('rejects a legacy fragment receipt whose inventory row is missing', () => {
    const directory = mkdtempSync(join(tmpdir(), 'poker-doku-'));
    temporaryDirectories.push(directory);
    const path = join(directory, 'poker.sqlite');
    createV7Database(path);
    const rawDatabase = new DatabaseSync(path);
    insertValidV7FragmentGrant(rawDatabase, 1);
    rawDatabase.exec(`
      DELETE FROM inventory_items
      WHERE profile_id = 'v1-marker' AND item_id = 'streak-fragment';
    `);
    rawDatabase.close();

    expect(() => openPokerDatabase(path)).toThrow();
    const reopened = new DatabaseSync(path);
    try {
      expect(reopened.prepare(`
        SELECT MAX(version) AS version FROM schema_migrations
      `).get()).toEqual({ version: 7 });
    } finally {
      reopened.close();
    }
  });

  it('rejects unsafe legacy fragment inventory timestamps', () => {
    const directory = mkdtempSync(join(tmpdir(), 'poker-doku-'));
    temporaryDirectories.push(directory);
    const path = join(directory, 'poker.sqlite');
    createV7Database(path);
    const rawDatabase = new DatabaseSync(path);
    insertValidV7FragmentGrant(rawDatabase, 1);
    rawDatabase.exec(`
      UPDATE inventory_items SET updated_at = 9007199254740992
      WHERE profile_id = 'v1-marker' AND item_id = 'streak-fragment';
    `);
    rawDatabase.close();

    expect(() => openPokerDatabase(path)).toThrow();
    const reopened = new DatabaseSync(path);
    try {
      expect(reopened.prepare(`
        SELECT MAX(version) AS version FROM schema_migrations
      `).get()).toEqual({ version: 7 });
    } finally {
      reopened.close();
    }
  });

  it('rolls every V8 object and rebuild back when the grant table conflicts', () => {
    const directory = mkdtempSync(join(tmpdir(), 'poker-doku-'));
    temporaryDirectories.push(directory);
    const path = join(directory, 'poker.sqlite');
    createV7Database(path);
    const rawDatabase = new DatabaseSync(path);
    rawDatabase.exec('CREATE TABLE progression_item_grants (id TEXT) STRICT;');
    rawDatabase.close();

    expect(() => openPokerDatabase(path)).toThrowError(
      'table progression_item_grants already exists',
    );
    const reopened = new DatabaseSync(path);
    try {
      expect(reopened.prepare(`
        SELECT MAX(version) AS version FROM schema_migrations
      `).get()).toEqual({ version: 7 });
      expect(reopened.prepare(`
        SELECT "table" FROM pragma_foreign_key_list('streak_state')
      `).all()).toContainEqual({ table: 'profiles' });
    } finally {
      reopened.close();
    }
  });

  it('upgrades V8 grant sources to canonical V9 references without data loss', () => {
    const directory = mkdtempSync(join(tmpdir(), 'poker-doku-'));
    temporaryDirectories.push(directory);
    const path = join(directory, 'poker.sqlite');
    createV7Database(path);
    const rawDatabase = new DatabaseSync(path);
    insertValidV7FragmentGrant(rawDatabase, 1);
    rawDatabase.close();
    applyV8Migration(path);

    database = openPokerDatabase(path);

    expect(database.db.prepare(`
      SELECT MAX(version) AS version FROM schema_migrations
    `).get()).toEqual({ version: 24 });
    expect(database.db.prepare(`
      SELECT source_ref, source_event_id, source_date, granted_at
      FROM progression_item_grants
    `).get()).toEqual({
      source_ref: 'streak-fragment:v1-marker:2026-07-17',
      source_event_id: 'sng-finish:legacy-main',
      source_date: '2026-07-17',
      granted_at: Date.parse('2026-07-17T12:00:00+09:00'),
    });
  });

  it.each([
    {
      corruption: 'with no inventory row',
      apply: (db: DatabaseSync) => {
        db.exec(`
          DELETE FROM inventory_items
          WHERE profile_id = 'v1-marker' AND item_id = 'streak-fragment';
        `);
      },
    },
    {
      corruption: 'with a quantity mismatch',
      apply: (db: DatabaseSync) => {
        bypassTrigger(db, 'validate_fragment_inventory_update', `
          UPDATE inventory_items SET quantity = 2
          WHERE profile_id = 'v1-marker' AND item_id = 'streak-fragment';
        `);
      },
    },
    {
      corruption: 'with a granted-time mismatch',
      apply: (db: DatabaseSync) => {
        bypassTrigger(db, 'validate_fragment_inventory_update', `
          UPDATE inventory_items SET granted_at = granted_at - 1
          WHERE profile_id = 'v1-marker' AND item_id = 'streak-fragment';
        `);
      },
    },
    {
      corruption: 'with an updated-time mismatch',
      apply: (db: DatabaseSync) => {
        bypassTrigger(db, 'validate_fragment_inventory_update', `
          UPDATE inventory_items SET updated_at = updated_at + 1
          WHERE profile_id = 'v1-marker' AND item_id = 'streak-fragment';
        `);
      },
    },
  ])('rejects V8 fragment inventory $corruption atomically', ({ apply }) => {
    const directory = mkdtempSync(join(tmpdir(), 'poker-doku-'));
    temporaryDirectories.push(directory);
    const path = join(directory, 'poker.sqlite');
    createV8FragmentDatabase(path);
    const rawDatabase = new DatabaseSync(path);
    apply(rawDatabase);
    rawDatabase.close();

    expectOpenDatabaseToThrow(path);
    const reopened = new DatabaseSync(path);
    try {
      expect(reopened.prepare(`
        SELECT MAX(version) AS version FROM schema_migrations
      `).get()).toEqual({ version: 8 });
      expect(reopened.prepare(`
        SELECT name FROM pragma_table_info('progression_item_grants')
      `).all().map(row => (row as { name: string }).name))
        .not.toContain('source_event_id');
      expect(reopened.prepare(`
        SELECT COUNT(*) AS count FROM progression_item_grants
      `).get()).toEqual({ count: 1 });
    } finally {
      reopened.close();
    }
  });

  it('rejects an invalid existing V9 fragment inventory in additive V10', () => {
    const directory = mkdtempSync(join(tmpdir(), 'poker-doku-'));
    temporaryDirectories.push(directory);
    const path = join(directory, 'poker.sqlite');
    createV8FragmentDatabase(path);
    applyV9Migration(path);
    const rawDatabase = new DatabaseSync(path);
    bypassTrigger(rawDatabase, 'validate_fragment_inventory_delete', `
      DELETE FROM inventory_items
      WHERE profile_id = 'v1-marker' AND item_id = 'streak-fragment';
    `);
    rawDatabase.close();

    expectOpenDatabaseToThrow(path);
    const reopened = new DatabaseSync(path);
    try {
      expect(reopened.prepare(`
        SELECT MAX(version) AS version FROM schema_migrations
      `).get()).toEqual({ version: 9 });
    } finally {
      reopened.close();
    }
  });

  it.each([
    {
      corruption: 'empty object',
      mutate: () => ({}),
    },
    {
      corruption: 'non-milestone streak',
      mutate: (summary: Record<string, unknown>) => ({
        ...summary,
        streak: {
          previousStreak: 7,
          currentStreak: 8,
          restPassUsed: false,
        },
      }),
    },
    {
      corruption: 'duplicate fragment claim',
      mutate: (summary: Record<string, unknown>) => ({
        ...summary,
        grantedItemIds: ['streak-fragment', 'streak-fragment'],
      }),
    },
    {
      corruption: 'unknown item claim',
      mutate: (summary: Record<string, unknown>) => ({
        ...summary,
        grantedItemIds: ['streak-fragment', 'unknown-cosmetic'],
      }),
    },
  ])('rejects a V8 fragment source summary with $corruption atomically', ({
    mutate,
  }) => {
    const directory = mkdtempSync(join(tmpdir(), 'poker-doku-'));
    temporaryDirectories.push(directory);
    const path = join(directory, 'poker.sqlite');
    createV8FragmentDatabase(path);
    const rawDatabase = new DatabaseSync(path);
    const source = rawDatabase.prepare(`
      SELECT summary_json FROM progression_events
      WHERE idempotency_key = 'sng-finish:legacy-main'
    `).get() as { summary_json: string };
    rawDatabase.prepare(`
      UPDATE progression_events SET summary_json = ?
      WHERE idempotency_key = 'sng-finish:legacy-main'
    `).run(JSON.stringify(mutate(JSON.parse(source.summary_json))));
    rawDatabase.close();

    expectOpenDatabaseToThrow(path);
    const reopened = new DatabaseSync(path);
    try {
      expect(reopened.prepare(`
        SELECT MAX(version) AS version FROM schema_migrations
      `).get()).toEqual({ version: 8 });
      expect(reopened.prepare(`
        SELECT COUNT(*) AS count FROM progression_item_grants
      `).get()).toEqual({ count: 1 });
    } finally {
      reopened.close();
    }
  });

  it('rejects an invalid existing V9 fragment source summary in additive V10', () => {
    const directory = mkdtempSync(join(tmpdir(), 'poker-doku-'));
    temporaryDirectories.push(directory);
    const path = join(directory, 'poker.sqlite');
    createV8FragmentDatabase(path);
    applyV9Migration(path);
    const rawDatabase = new DatabaseSync(path);
    bypassTrigger(rawDatabase, 'reject_fragment_source_event_update', `
      UPDATE progression_events SET summary_json = '{}'
      WHERE idempotency_key = 'sng-finish:legacy-main';
    `);
    rawDatabase.close();

    expectOpenDatabaseToThrow(path);
    const reopened = new DatabaseSync(path);
    try {
      expect(reopened.prepare(`
        SELECT MAX(version) AS version FROM schema_migrations
      `).get()).toEqual({ version: 9 });
    } finally {
      reopened.close();
    }
  });

  it.each([
    {
      corruption: 'unsafe dojo XP',
      mutate: (json: string) => json.replace(
        '"dojoXpMilli":30000',
        '"dojoXpMilli":9007199254740992',
      ),
    },
    {
      corruption: 'unsafe affinity XP',
      mutate: (json: string) => json.replace(
        '"affinityMilli":8000',
        '"affinityMilli":9007199254740992',
      ),
    },
    {
      corruption: 'unsafe streak counters',
      mutate: (json: string) => json
        .replace('"previousStreak":6', '"previousStreak":9007199254740994')
        .replace('"currentStreak":7', '"currentStreak":9007199254740995'),
    },
    {
      corruption: 'duplicate summary keys',
      mutate: (json: string) => json.replace(
        '"dojoXpMilli":30000',
        '"dojoXpMilli":30000,"dojoXpMilli":30000',
      ),
    },
    {
      corruption: 'duplicate streak keys',
      mutate: (json: string) => json.replace(
        '"previousStreak":6',
        '"previousStreak":6,"previousStreak":6',
      ),
    },
  ])('rejects an existing V9 source with $corruption atomically', ({
    mutate,
  }) => {
    const directory = mkdtempSync(join(tmpdir(), 'poker-doku-'));
    temporaryDirectories.push(directory);
    const path = join(directory, 'poker.sqlite');
    createV8FragmentDatabase(path);
    applyV9Migration(path);
    const rawDatabase = new DatabaseSync(path);
    const corrupted = mutate(fragmentSourceSummaryJson('sng-finish:legacy-main'));
    bypassTrigger(rawDatabase, 'reject_fragment_source_event_update', `
      UPDATE progression_events SET summary_json = '${corrupted}'
      WHERE idempotency_key = 'sng-finish:legacy-main';
    `);
    rawDatabase.close();

    expectOpenDatabaseToThrow(path);
    const reopened = new DatabaseSync(path);
    try {
      expect(reopened.prepare(`
        SELECT MAX(version) AS version FROM schema_migrations
      `).get()).toEqual({ version: 9 });
    } finally {
      reopened.close();
    }
  });

  it.each([
    {
      corruption: 'unsafe dojo XP',
      mutate: (json: string) => json.replace(
        '"dojoXpMilli":30000',
        '"dojoXpMilli":9007199254740992',
      ),
    },
    {
      corruption: 'unsafe affinity XP',
      mutate: (json: string) => json.replace(
        '"affinityMilli":8000',
        '"affinityMilli":9007199254740992',
      ),
    },
    {
      corruption: 'unsafe streak counters',
      mutate: (json: string) => json
        .replace('"previousStreak":6', '"previousStreak":9007199254740994')
        .replace('"currentStreak":7', '"currentStreak":9007199254740995'),
    },
    {
      corruption: 'duplicate summary keys',
      mutate: (json: string) => json.replace(
        '"dojoXpMilli":30000',
        '"dojoXpMilli":30000,"dojoXpMilli":30000',
      ),
    },
    {
      corruption: 'duplicate streak keys',
      mutate: (json: string) => json.replace(
        '"previousStreak":6',
        '"previousStreak":6,"previousStreak":6',
      ),
    },
  ])('rejects a current raw source with $corruption before inventory', ({
    mutate,
  }) => {
    database = openPokerDatabase(':memory:');
    insertProfile(database, 'unsafe-current-source');
    const at = Date.parse('2026-07-17T12:00:00+09:00');
    database.db.prepare(`
      INSERT INTO progression_profiles VALUES (
        'unsafe-current-source', 1, 1, 0, 'sakura', NULL,
        0, 0, 0, 0, 0, 7, ?, ?
      )
    `).run(at, at);
    database.db.prepare(`
      INSERT INTO streak_daily_progress VALUES (
        'unsafe-current-source', '2026-07-17', 0, 1, ?
      )
    `).run(at);
    database.db.prepare(`
      INSERT INTO progression_events VALUES (
        'unsafe-current-main', 'unsafe-current-source',
        'sng-finish', 1, ?, ?
      )
    `).run(mutate(fragmentSourceSummaryJson('unsafe-current-main')), at);

    expect(() => database?.db.prepare(`
      INSERT INTO progression_item_grants (
        idempotency_key, profile_id, item_id, source, source_ref,
        source_event_id, source_date, quantity, granted_at
      ) VALUES (
        'streak-fragment:unsafe-current-source:2026-07-17',
        'unsafe-current-source', 'streak-fragment', 'streak',
        'streak-fragment:unsafe-current-source:2026-07-17',
        'unsafe-current-main', '2026-07-17', 1, ?
      )
    `).run(at)).toThrowError('invalid progression item grant source');
    expect(database.db.prepare(`
      SELECT COUNT(*) AS count FROM progression_item_grants
      WHERE profile_id = 'unsafe-current-source'
    `).get()).toEqual({ count: 0 });
    expect(database.db.prepare(`
      SELECT COUNT(*) AS count FROM inventory_items
      WHERE profile_id = 'unsafe-current-source'
    `).get()).toEqual({ count: 0 });
  });

  it('accepts max-safe canonical source integers at the current boundary', () => {
    database = openPokerDatabase(':memory:');
    insertProfile(database, 'max-safe-current-source');
    const at = Date.parse('2026-07-17T12:00:00+09:00');
    database.db.prepare(`
      INSERT INTO progression_profiles VALUES (
        'max-safe-current-source', 1, 1, 0, 'sakura', NULL,
        0, 0, 0, 0, 0, 7, ?, ?
      )
    `).run(at, at);
    database.db.prepare(`
      INSERT INTO streak_daily_progress VALUES (
        'max-safe-current-source', '2026-07-17', 0, 1, ?
      )
    `).run(at);
    const summary = fragmentSourceSummaryJson('max-safe-current-main')
      .replace('"dojoXpMilli":30000', '"dojoXpMilli":9007199254740991')
      .replace('"affinityMilli":8000', '"affinityMilli":9007199254740991')
      .replace('"previousStreak":6', '"previousStreak":9007199254740987')
      .replace('"currentStreak":7', '"currentStreak":9007199254740988');
    database.db.prepare(`
      INSERT INTO progression_events VALUES (
        'max-safe-current-main', 'max-safe-current-source',
        'sng-finish', 1, ?, ?
      )
    `).run(summary, at);
    database.db.prepare(`
      INSERT INTO progression_item_grants (
        idempotency_key, profile_id, item_id, source, source_ref,
        source_event_id, source_date, quantity, granted_at
      ) VALUES (
        'streak-fragment:max-safe-current-source:2026-07-17',
        'max-safe-current-source', 'streak-fragment', 'streak',
        'streak-fragment:max-safe-current-source:2026-07-17',
        'max-safe-current-main', '2026-07-17', 1, ?
      )
    `).run(at);

    expect(database.db.prepare(`
      SELECT quantity FROM inventory_items
      WHERE profile_id = 'max-safe-current-source'
        AND item_id = 'streak-fragment'
    `).get()).toEqual({ quantity: 1 });
  });

  it('rejects a current raw mission with missing reward and duplicate slot keys', () => {
    database = openPokerDatabase(':memory:');
    insertProfile(database, 'duplicate-mission-current');
    const at = Date.parse('2026-07-17T12:00:00+09:00');
    database.db.prepare(`
      INSERT INTO progression_profiles VALUES (
        'duplicate-mission-current', 1, 1, 0, 'sakura', NULL,
        0, 0, 0, 0, 0, 7, ?, ?
      )
    `).run(at, at);
    database.db.prepare(`
      INSERT INTO streak_daily_progress VALUES (
        'duplicate-mission-current', '2026-07-17', 0, 1, ?
      )
    `).run(at);
    const summary = fragmentSourceSummaryJson('duplicate-mission-main').replace(
      '"missionCompletions":[]',
      '"missionCompletions":[{' +
        '"missionId":"COMPLETE_ONE_SNG","slot":0,"slot":0}]',
    );
    database.db.prepare(`
      INSERT INTO progression_events VALUES (
        'duplicate-mission-main', 'duplicate-mission-current',
        'sng-finish', 1, ?, ?
      )
    `).run(summary, at);

    expect(() => database?.db.prepare(`
      INSERT INTO progression_item_grants (
        idempotency_key, profile_id, item_id, source, source_ref,
        source_event_id, source_date, quantity, granted_at
      ) VALUES (
        'streak-fragment:duplicate-mission-current:2026-07-17',
        'duplicate-mission-current', 'streak-fragment', 'streak',
        'streak-fragment:duplicate-mission-current:2026-07-17',
        'duplicate-mission-main', '2026-07-17', 1, ?
      )
    `).run(at)).toThrowError('invalid progression item grant source');
    expect(database.db.prepare(`
      SELECT COUNT(*) AS count FROM progression_item_grants
      WHERE profile_id = 'duplicate-mission-current'
    `).get()).toEqual({ count: 0 });
    expect(database.db.prepare(`
      SELECT COUNT(*) AS count FROM inventory_items
      WHERE profile_id = 'duplicate-mission-current'
    `).get()).toEqual({ count: 0 });
  });

  it('rejects a V9 mission with missing reward and duplicate slot atomically', () => {
    const directory = mkdtempSync(join(tmpdir(), 'poker-doku-'));
    temporaryDirectories.push(directory);
    const path = join(directory, 'poker.sqlite');
    createV8FragmentDatabase(path);
    applyV9Migration(path);
    const rawDatabase = new DatabaseSync(path);
    const summary = fragmentSourceSummaryJson('sng-finish:legacy-main').replace(
      '"missionCompletions":[]',
      '"missionCompletions":[{' +
        '"missionId":"COMPLETE_ONE_SNG","slot":0,"slot":0}]',
    );
    bypassTrigger(rawDatabase, 'reject_fragment_source_event_update', `
      UPDATE progression_events SET summary_json = '${summary}'
      WHERE idempotency_key = 'sng-finish:legacy-main';
    `);
    rawDatabase.close();

    expectOpenDatabaseToThrow(path);
    const reopened = new DatabaseSync(path);
    try {
      expect(reopened.prepare(`
        SELECT MAX(version) AS version FROM schema_migrations
      `).get()).toEqual({ version: 9 });
    } finally {
      reopened.close();
    }
  });

  it('rejects a fragment grant whose source summary does not prove the claim', () => {
    database = openPokerDatabase(':memory:');
    insertProfile(database, 'invalid-source-summary');
    const at = Date.parse('2026-07-17T12:00:00+09:00');
    database.db.prepare(`
      INSERT INTO progression_profiles VALUES (
        'invalid-source-summary', 1, 1, 0, 'sakura', NULL,
        0, 0, 0, 0, 0, 7, ?, ?
      )
    `).run(at, at);
    database.db.prepare(`
      INSERT INTO streak_daily_progress VALUES (
        'invalid-source-summary', '2026-07-17', 0, 1, ?
      )
    `).run(at);
    database.db.prepare(`
      INSERT INTO progression_events VALUES (
        'invalid-summary-source', 'invalid-source-summary',
        'sng-finish', 1, '{}', ?
      )
    `).run(at);

    expect(() => database?.db.prepare(`
      INSERT INTO progression_item_grants (
        idempotency_key, profile_id, item_id, source, source_ref,
        source_event_id, source_date, quantity, granted_at
      ) VALUES (
        'streak-fragment:invalid-source-summary:2026-07-17',
        'invalid-source-summary', 'streak-fragment', 'streak',
        'streak-fragment:invalid-source-summary:2026-07-17',
        'invalid-summary-source', '2026-07-17', 1, ?
      )
    `).run(at)).toThrowError('invalid progression item grant source');
    expect(database.db.prepare(`
      SELECT COUNT(*) AS count FROM progression_item_grants
      WHERE profile_id = 'invalid-source-summary'
    `).get()).toEqual({ count: 0 });
    expect(database.db.prepare(`
      SELECT COUNT(*) AS count FROM inventory_items
      WHERE profile_id = 'invalid-source-summary'
    `).get()).toEqual({ count: 0 });
  });

  it('rejects V8 timestamps outside the service Date range atomically', () => {
    const directory = mkdtempSync(join(tmpdir(), 'poker-doku-'));
    temporaryDirectories.push(directory);
    const path = join(directory, 'poker.sqlite');
    createV8Database(path);
    const rawDatabase = new DatabaseSync(path);
    rawDatabase.exec(`
      INSERT INTO progression_profiles VALUES (
        'v1-marker', 1, 1, 0, 'sakura', NULL,
        0, 0, 0, 0, 0, 0, 300000000000000, 300000000000000
      );
    `);
    rawDatabase.close();

    expect(() => openPokerDatabase(path)).toThrow();
    const reopened = new DatabaseSync(path);
    try {
      expect(reopened.prepare(`
        SELECT MAX(version) AS version FROM schema_migrations
      `).get()).toEqual({ version: 8 });
    } finally {
      reopened.close();
    }
  });

  it('rolls V9 grant rebuild and version back on a middle-name conflict', () => {
    const directory = mkdtempSync(join(tmpdir(), 'poker-doku-'));
    temporaryDirectories.push(directory);
    const path = join(directory, 'poker.sqlite');
    createV8Database(path);
    const rawDatabase = new DatabaseSync(path);
    rawDatabase.exec(`
      CREATE TABLE progression_item_grants_v8_backup (id TEXT) STRICT;
    `);
    rawDatabase.close();

    expect(() => openPokerDatabase(path)).toThrow();
    const reopened = new DatabaseSync(path);
    try {
      expect(reopened.prepare(`
        SELECT MAX(version) AS version FROM schema_migrations
      `).get()).toEqual({ version: 8 });
      expect(reopened.prepare(`
        SELECT name FROM pragma_table_info('progression_item_grants')
      `).all().map(row => (row as { name: string }).name))
        .not.toContain('source_event_id');
    } finally {
      reopened.close();
    }
  });

  it('rejects cross-profile, non-game, and noncanonical V9 grant sources', () => {
    database = openPokerDatabase(':memory:');
    insertProfile(database, 'grant-source-a');
    insertProfile(database, 'grant-source-b');
    const at = Date.parse('2026-07-17T12:00:00+09:00');
    for (const profileId of ['grant-source-a', 'grant-source-b']) {
      database.db.prepare(`
        INSERT INTO progression_profiles VALUES (
          ?, 1, 1, 0, 'sakura', NULL, 0, 0, 0, 0, 0, 1, ?, ?
        )
      `).run(profileId, at, at);
      database.db.prepare(`
        INSERT INTO streak_daily_progress VALUES (
          ?, '2026-07-17', 0, 1, ?
        )
      `).run(profileId, at);
    }
    database.db.prepare(`
      INSERT INTO progression_events VALUES (
        'source-a-game', 'grant-source-a', 'sng-finish', 1, '{}', ?
      )
    `).run(at);
    database.db.prepare(`
      INSERT INTO progression_events VALUES (
        'source-b-game', 'grant-source-b', 'sng-finish', 1, '{}', ?
      )
    `).run(at);
    database.db.prepare(`
      INSERT INTO progression_events VALUES (
        'source-a-test', 'grant-source-a', 'test', 1, '{}', ?
      )
    `).run(at);
    database.db.prepare(`
      INSERT INTO progression_events VALUES (
        'source-a-wrong-time', 'grant-source-a', 'sng-finish', 1, '{}', ?
      )
    `).run(at - 1);

    const insertGrant = database.db.prepare(`
      INSERT INTO progression_item_grants (
        idempotency_key, profile_id, item_id, source, source_ref,
        source_event_id, source_date, quantity, granted_at
      ) VALUES (?, 'grant-source-a', 'streak-fragment', 'streak', ?, ?,
                '2026-07-17', 1, ?)
    `);
    expect(() => insertGrant.run(
      'wrong-ref',
      'wrong-ref',
      'source-a-game',
      at,
    )).toThrow();
    expect(() => insertGrant.run(
      'streak-fragment:grant-source-a:2026-07-17',
      'streak-fragment:grant-source-a:2026-07-17',
      'source-b-game',
      at,
    )).toThrow();
    expect(() => insertGrant.run(
      'streak-fragment:grant-source-a:2026-07-17',
      'streak-fragment:grant-source-a:2026-07-17',
      'source-a-test',
      at,
    )).toThrow();
    expect(() => insertGrant.run(
      'streak-fragment:grant-source-a:2026-07-17',
      'streak-fragment:grant-source-a:2026-07-17',
      'source-a-wrong-time',
      at,
    )).toThrow();

    database.db.prepare(`
      DELETE FROM streak_daily_progress
      WHERE profile_id = 'grant-source-a' AND kst_date = '2026-07-17'
    `).run();
    database.db.prepare(`
      INSERT INTO streak_daily_progress VALUES (
        'grant-source-a', '2026-07-17', 0, 1, ?
      )
    `).run(at - 1);
    expect(() => insertGrant.run(
      'streak-fragment:grant-source-a:2026-07-17',
      'streak-fragment:grant-source-a:2026-07-17',
      'source-a-game',
      at,
    )).toThrow();
  });

  it('cascades profile deletion through every progression table', () => {
    database = openPokerDatabase(':memory:');
    insertProfile(database, 'progression-cascade');
    database.db.exec(`
      INSERT INTO progression_profiles VALUES (
        'progression-cascade', 1, 1, 0, 'sakura', NULL,
        0, 0, 0, 0, 0, 0, 1, 1
      );
      INSERT INTO character_affinity VALUES (
        'progression-cascade', 'sakura', 1, 0
      );
      INSERT INTO daily_missions (
        profile_id, mission_date, slot, mission_id, target, progress,
        balance_version, reroll_count, assigned_at, completed_at, rewarded_at
      ) VALUES (
        'progression-cascade', '2026-07-17', 0, 'COMPLETE_HANDS_ANY_10', 10, 0,
        1, 0, 1, NULL, NULL
      );
      INSERT INTO inventory_items VALUES (
        'progression-cascade', 'dojo-frame-cherry-blossom', 1, 1, 1
      );
      INSERT INTO profile_equipment VALUES (
        'progression-cascade', 'frame', 'dojo-frame-cherry-blossom', 1
      );
      INSERT INTO progression_events VALUES (
        'event-a', 'progression-cascade', 'test', 1, '{}', 1
      );
      INSERT INTO daily_mission_modes VALUES (
        'progression-cascade', '2026-07-17', 'cash', 1
      );
      INSERT INTO streak_daily_progress VALUES (
        'progression-cascade', '2026-07-17', 1, 0, NULL
      );
      DELETE FROM profiles WHERE id = 'progression-cascade';
    `);

    for (const table of [
      'progression_profiles', 'character_affinity', 'daily_missions',
      'streak_state', 'inventory_items', 'profile_equipment',
      'progression_events',
      'daily_mission_modes',
      'streak_daily_progress',
      'progression_item_grants',
      'permanent_progression_grants',
    ]) {
      const row = database.db.prepare(
        `SELECT COUNT(*) AS count FROM ${table}`,
      ).get() as { count: number };
      expect(row.count).toBe(0);
    }
  });

  it('rejects direct progression root deletion but allows the base-profile cascade', () => {
    database = openPokerDatabase(':memory:');
    insertProfile(database, 'progression-delete-boundary');
    database.db.exec(`
      INSERT INTO progression_profiles VALUES (
        'progression-delete-boundary', 1, 1, 0, 'sakura', NULL,
        0, 0, 0, 0, 0, 0, 1, 1
      );
      INSERT INTO character_affinity VALUES (
        'progression-delete-boundary', 'sakura', 1, 0
      );
      INSERT INTO profile_equipment VALUES
        ('progression-delete-boundary', 'title', NULL, 1),
        ('progression-delete-boundary', 'frame', NULL, 1),
        ('progression-delete-boundary', 'skin', NULL, 1),
        ('progression-delete-boundary', 'cutin', NULL, 1);
      INSERT INTO streak_daily_progress VALUES (
        'progression-delete-boundary', '2026-07-17', 1, 0, NULL
      );
      INSERT INTO progression_events VALUES (
        'delete-boundary-event', 'progression-delete-boundary',
        'completed-hand', 1, '{}', 1
      );
    `);

    expect(() => database?.db.prepare(`
      DELETE FROM progression_profiles
      WHERE profile_id = 'progression-delete-boundary'
    `).run()).toThrowError('delete progression through profile owner');
    expect(database.db.prepare(`
      SELECT COUNT(*) AS count FROM progression_profiles
      WHERE profile_id = 'progression-delete-boundary'
    `).get()).toEqual({ count: 1 });

    expect(new ProfileRepository(database).deleteProfile(
      'progression-delete-boundary',
    )).toBe('deleted');
    for (const table of [
      'profiles', 'progression_profiles', 'character_affinity',
      'profile_equipment', 'streak_state', 'streak_daily_progress',
      'progression_events',
    ]) {
      const row = database.db.prepare(
        `SELECT COUNT(*) AS count FROM ${table} WHERE ${
          table === 'profiles' ? 'id' : 'profile_id'
        } = ?`,
      ).get('progression-delete-boundary') as { count: number };
      expect(row.count).toBe(0);
    }
  });

  it('rolls back the V4 SNG table replacement and version when migration conflicts', () => {
    const directory = mkdtempSync(join(tmpdir(), 'poker-doku-'));
    temporaryDirectories.push(directory);
    const path = join(directory, 'poker.sqlite');
    createV3Database(path);
    const rawDatabase = new DatabaseSync(path);
    rawDatabase.exec('CREATE TABLE sng_entries_v1_backup (id TEXT) STRICT;');
    rawDatabase.close();

    expect(() => openPokerDatabase(path)).toThrowError(
      'there is already another table or index with this name: sng_entries_v1_backup',
    );
    const reopened = new DatabaseSync(path);
    try {
      expect(reopened.prepare(`
        SELECT version FROM schema_migrations ORDER BY version
      `).all()).toEqual([{ version: 1 }, { version: 2 }, { version: 3 }]);
      expect(reopened.prepare('PRAGMA table_info(sng_entries)').all()
        .map(row => (row as { name: string }).name)).not.toContain('tournament_id');
    } finally {
      reopened.close();
    }
  });

  it('rolls back the V3 version record when its durable identity table conflicts', () => {
    const directory = mkdtempSync(join(tmpdir(), 'poker-doku-'));
    temporaryDirectories.push(directory);
    const path = join(directory, 'poker.sqlite');
    createV2Database(path);
    const rawDatabase = new DatabaseSync(path);
    rawDatabase.exec(`CREATE TABLE cash_hand_settlements (id TEXT) STRICT;`);
    rawDatabase.close();

    expect(() => openPokerDatabase(path)).toThrowError(
      'table cash_hand_settlements already exists',
    );
    const reopened = new DatabaseSync(path);
    try {
      expect(reopened.prepare(`
        SELECT version FROM schema_migrations ORDER BY version
      `).all()).toEqual([{ version: 1 }, { version: 2 }]);
    } finally {
      reopened.close();
    }
  });

  it('rolls back the V2 version record when its index creation fails', () => {
    const directory = mkdtempSync(join(tmpdir(), 'poker-doku-'));
    temporaryDirectories.push(directory);
    const path = join(directory, 'poker.sqlite');
    createV1Database(path);
    const rawDatabase = new DatabaseSync(path);
    rawDatabase.exec(`
      CREATE INDEX idx_rescue_claims_profile_claimed_at_desc
      ON rescue_claims(claimed_at)
    `);
    rawDatabase.close();

    let unexpectedlyOpened: PokerDatabase | undefined;
    try {
      expect(() => {
        unexpectedlyOpened = openPokerDatabase(path);
      }).toThrowError(
        'index idx_rescue_claims_profile_claimed_at_desc already exists',
      );
    } finally {
      unexpectedlyOpened?.close();
    }

    const reopened = new DatabaseSync(path);
    const versions = reopened.prepare(`
      SELECT version FROM schema_migrations ORDER BY version
    `).all();
    reopened.close();
    expect(versions).toEqual([{ version: 1 }]);
  });

  it('uses the rescue claimed-at index for the latest-claim query', () => {
    database = openPokerDatabase(':memory:');

    const plan = database.db.prepare(`
      EXPLAIN QUERY PLAN
      SELECT claimed_at
      FROM rescue_claims
      WHERE profile_id = ?
      ORDER BY claimed_at DESC
      LIMIT 1
    `).all('profile-1') as Array<{ detail: string }>;

    expect(plan.map(row => row.detail).join('\n'))
      .toContain('idx_rescue_claims_profile_claimed_at_desc');
  });

  it('rejects migration versions unknown to this binary', () => {
    const directory = mkdtempSync(join(tmpdir(), 'poker-doku-'));
    temporaryDirectories.push(directory);
    const path = join(directory, 'poker.sqlite');
    const rawDatabase = new DatabaseSync(path);
    rawDatabase.exec(`
      CREATE TABLE schema_migrations (
        version INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        applied_at INTEGER NOT NULL
      ) STRICT;
      INSERT INTO schema_migrations (version, name, applied_at)
      VALUES (999, 'future', 0);
    `);
    rawDatabase.close();

    let unexpectedlyOpened: PokerDatabase | undefined;
    try {
      expect(() => {
        unexpectedlyOpened = openPokerDatabase(path);
      }).toThrowError('Unknown applied migration version: 999');
    } finally {
      unexpectedlyOpened?.close();
    }
  });

  it('closes a file handle when database initialization fails', () => {
    const directory = mkdtempSync(join(tmpdir(), 'poker-doku-'));
    temporaryDirectories.push(directory);
    const path = join(directory, 'poker.sqlite');
    createConflictingV1Database(path);
    const closeSpy = vi.spyOn(DatabaseSync.prototype, 'close');

    expect(() => openPokerDatabase(path)).toThrowError(
      'table profiles already exists',
    );
    expect(closeSpy).toHaveBeenCalledOnce();
    closeSpy.mockRestore();

    const reopened = new DatabaseSync(path);
    const result = reopened
      .prepare('SELECT COUNT(*) AS count FROM schema_migrations')
      .get() as { count: number };
    reopened.close();
    expect(result.count).toBe(0);
  });

  it('rolls back the whole migration when a V1 statement fails', () => {
    const directory = mkdtempSync(join(tmpdir(), 'poker-doku-'));
    temporaryDirectories.push(directory);
    const path = join(directory, 'poker.sqlite');
    const rawDatabase = new DatabaseSync(path);
    rawDatabase.exec(`
      CREATE TABLE schema_migrations (
        version INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        applied_at INTEGER NOT NULL
      ) STRICT;
      CREATE TABLE chip_ledger (id TEXT PRIMARY KEY) STRICT;
    `);
    rawDatabase.close();

    let unexpectedlyOpened: PokerDatabase | undefined;
    try {
      expect(() => {
        unexpectedlyOpened = openPokerDatabase(path);
      }).toThrowError('table chip_ledger already exists');
    } finally {
      unexpectedlyOpened?.close();
    }

    const reopened = new DatabaseSync(path);
    let migrationCount = -1;
    let tableNames: string[] = [];
    try {
      migrationCount = (
        reopened
          .prepare('SELECT COUNT(*) AS count FROM schema_migrations')
          .get() as { count: number }
      ).count;
      tableNames = reopened
        .prepare(`
          SELECT name FROM sqlite_schema
          WHERE type = 'table' AND name NOT LIKE 'sqlite_%'
          ORDER BY name
        `)
        .all()
        .map(row => (row as { name: string }).name);
    } finally {
      reopened.close();
    }

    expect(migrationCount).toBe(0);
    expect(tableNames).toContain('chip_ledger');
    expect(tableNames).not.toContain('profiles');
  });

  it.each([
    { label: 'duplicate', versions: [1, 1] },
    { label: 'out-of-order', versions: [2, 1] },
  ])('rejects $label migration definitions', ({ versions }) => {
    const definitions = versions.map<Migration>(version => ({
      version,
      name: `migration-${version}`,
      sql: '',
    }));

    expect(() => validateMigrations(definitions)).toThrowError(
      'Migration versions must be unique and strictly increasing',
    );
  });

  it('rejects rows that violate a foreign key', () => {
    database = openPokerDatabase(':memory:');

    expect(() => {
      database?.db
        .prepare(
          'INSERT INTO wallets (profile_id, balance, updated_at) VALUES (?, ?, ?)',
        )
        .run('missing-profile', 100, Date.now());
    }).toThrow();
  });

  it('rejects a negative wallet balance', () => {
    database = openPokerDatabase(':memory:');
    insertProfile(database, 'negative-wallet');

    expect(() => {
      database?.db
        .prepare(
          'INSERT INTO wallets (profile_id, balance, updated_at) VALUES (?, ?, ?)',
        )
        .run('negative-wallet', -1, Date.now());
    }).toThrow();
  });

  it('rejects more than one active seat escrow for a profile', () => {
    database = openPokerDatabase(':memory:');
    insertProfile(database, 'active-escrow');
    const insertEscrow = database.db.prepare(`
      INSERT INTO seat_escrows (
        id,
        profile_id,
        room_id,
        mode,
        amount,
        checkpoint_amount,
        checkpoint_hand,
        status,
        updated_at
      ) VALUES (?, ?, ?, 'cash', 100, 100, 0, 'active', ?)
    `);
    insertEscrow.run('escrow-1', 'active-escrow', 'room-1', Date.now());

    expect(() => {
      insertEscrow.run('escrow-2', 'active-escrow', 'room-2', Date.now());
    }).toThrow();
  });

  it('rejects duplicate chip ledger idempotency keys', () => {
    database = openPokerDatabase(':memory:');
    insertProfile(database, 'ledger-idempotency');
    const insertLedger = database.db.prepare(`
      INSERT INTO chip_ledger (
        id,
        profile_id,
        account,
        delta,
        reason,
        ref_id,
        idempotency_key,
        created_at
      ) VALUES (?, ?, 'wallet', 100, 'TEST', NULL, ?, ?)
    `);
    insertLedger.run(
      'ledger-1',
      'ledger-idempotency',
      'same-key',
      Date.now(),
    );

    expect(() => {
      insertLedger.run(
        'ledger-2',
        'ledger-idempotency',
        'same-key',
        Date.now(),
      );
    }).toThrow();
  });

  it('rejects values with the wrong type in STRICT tables', () => {
    database = openPokerDatabase(':memory:');
    insertProfile(database, 'strict-wallet');

    expect(() => {
      database?.db
        .prepare(
          'INSERT INTO wallets (profile_id, balance, updated_at) VALUES (?, ?, ?)',
        )
        .run('strict-wallet', 'not-an-integer', Date.now());
    }).toThrow();
  });

  it('configures durable file-backed SQLite pragmas', () => {
    const directory = mkdtempSync(join(tmpdir(), 'poker-doku-'));
    temporaryDirectories.push(directory);
    database = openPokerDatabase(join(directory, 'poker.sqlite'));

    const journal = database.db.prepare('PRAGMA journal_mode').get() as {
      journal_mode: string;
    };
    const synchronous = database.db.prepare('PRAGMA synchronous').get() as {
      synchronous: number;
    };
    const busyTimeout = database.db.prepare('PRAGMA busy_timeout').get() as {
      timeout: number;
    };
    const foreignKeys = database.db.prepare('PRAGMA foreign_keys').get() as {
      foreign_keys: number;
    };

    expect(journal.journal_mode).toBe('wal');
    expect(synchronous.synchronous).toBe(2);
    expect(busyTimeout.timeout).toBe(5_000);
    expect(foreignKeys.foreign_keys).toBe(1);
  });

  it('rolls back a transaction when its work throws', () => {
    database = openPokerDatabase(':memory:');

    expect(() => {
      database?.transaction(() => {
        insertProfile(database as PokerDatabase, 'rolled-back');
        throw new Error('boom');
      });
    }).toThrowError('boom');

    const result = database.db
      .prepare('SELECT COUNT(*) AS count FROM profiles')
      .get() as { count: number };
    expect(result.count).toBe(0);
  });

  it('rejects nested transactions without corrupting transaction state', () => {
    database = openPokerDatabase(':memory:');

    expect(() => {
      database?.transaction(() => {
        database?.transaction(() => undefined);
      });
    }).toThrowError('Nested transactions are not supported');

    expect(database.transaction(() => 'available')).toBe('available');
  });

  it('rejects PromiseLike transaction results synchronously and rolls back work', () => {
    database = openPokerDatabase(':memory:');
    let thenCalled = false;
    const castedWork = (() => {
      insertProfile(database as PokerDatabase, 'promise-like');
      return {
        then: () => {
          thenCalled = true;
        },
      };
    }) as unknown as () => void;

    expect(() => database?.transaction(castedWork)).toThrowError(
      'PokerDatabase transactions must be synchronous',
    );

    const result = database.db
      .prepare('SELECT COUNT(*) AS count FROM profiles')
      .get() as { count: number };
    expect(result.count).toBe(0);
    expect(thenCalled).toBe(false);
  });

  it('does not invoke a casted native async transaction callback', () => {
    database = openPokerDatabase(':memory:');
    let invoked = false;
    const castedWork = (async () => {
      invoked = true;
    }) as unknown as () => void;

    expect(() => database?.transaction(castedWork)).toThrowError(
      'PokerDatabase transactions must be synchronous',
    );
    expect(invoked).toBe(false);
  });
});

function compileTimeTransactionContract(database: PokerDatabase): void {
  // @ts-expect-error PokerDatabase transactions intentionally reject async callbacks.
  database.transaction(async () => undefined);
}

void compileTimeTransactionContract;

function createConflictingV1Database(path: string): void {
  const rawDatabase = new DatabaseSync(path);
  rawDatabase.exec(`
    CREATE TABLE schema_migrations (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at INTEGER NOT NULL
    ) STRICT;
    CREATE TABLE profiles (id TEXT PRIMARY KEY) STRICT;
  `);
  rawDatabase.close();
}

function createV1Database(path: string): void {
  const rawDatabase = new DatabaseSync(path);
  try {
    rawDatabase.exec(`
      CREATE TABLE schema_migrations (
        version INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        applied_at INTEGER NOT NULL
      ) STRICT;
      BEGIN IMMEDIATE;
      ${migrations[0].sql}
      INSERT INTO schema_migrations (version, name, applied_at)
      VALUES (1, 'anonymous_progression_foundation', 1);
      INSERT INTO profiles (
        id, credential_hash, credential_lookup, recovery_hash, recovery_lookup,
        alias, avatar_id, adult_confirmed_at, created_at, updated_at
      ) VALUES (
        'v1-marker', 'v1-credential-hash', 'v1-credential-lookup',
        'v1-recovery-hash', 'v1-recovery-lookup', 'v1-marker-alias',
        'sakura', 1, 1, 1
      );
      COMMIT;
    `);
  } finally {
    rawDatabase.close();
  }
}

function createV2Database(path: string): void {
  createV1Database(path);
  const rawDatabase = new DatabaseSync(path);
  try {
    rawDatabase.exec(`
      BEGIN IMMEDIATE;
      ${migrations[1].sql}
      INSERT INTO schema_migrations (version, name, applied_at)
      VALUES (2, 'index_rescue_claims_by_profile_and_latest_claim', 2);
      COMMIT;
    `);
  } finally {
    rawDatabase.close();
  }
}

function createV3Database(path: string): void {
  createV2Database(path);
  const rawDatabase = new DatabaseSync(path);
  try {
    rawDatabase.exec(`
      BEGIN IMMEDIATE;
      ${migrations[2].sql}
      INSERT INTO schema_migrations (version, name, applied_at)
      VALUES (3, 'durable_cash_hand_settlement_identity', 3);
      COMMIT;
    `);
  } finally {
    rawDatabase.close();
  }
}

function createV4Database(path: string): void {
  createV3Database(path);
  const rawDatabase = new DatabaseSync(path);
  try {
    rawDatabase.exec(`
      BEGIN IMMEDIATE;
      ${migrations[3].sql}
      INSERT INTO schema_migrations (version, name, applied_at)
      VALUES (4, 'durable_sng_tournament_incarnations', 4);
      COMMIT;
    `);
  } finally {
    rawDatabase.close();
  }
}

function createV5Database(path: string): void {
  createV4Database(path);
  const rawDatabase = new DatabaseSync(path);
  try {
    rawDatabase.exec(`
      BEGIN IMMEDIATE;
      ${migrations[4].sql}
      INSERT INTO schema_migrations (version, name, applied_at)
      VALUES (5, 'progression_persistence_schema', 5);
      COMMIT;
    `);
  } finally {
    rawDatabase.close();
  }
}

function createV6Database(path: string): void {
  createV5Database(path);
  const rawDatabase = new DatabaseSync(path);
  try {
    rawDatabase.exec(`
      BEGIN IMMEDIATE;
      ${migrations[5].sql}
      INSERT INTO schema_migrations (version, name, applied_at)
      VALUES (6, 'durable_daily_mission_mode_sets', 6);
      COMMIT;
    `);
  } finally {
    rawDatabase.close();
  }
}

function createV7Database(path: string): void {
  createV6Database(path);
  const rawDatabase = new DatabaseSync(path);
  try {
    rawDatabase.exec(`
      BEGIN IMMEDIATE;
      ${migrations[6].sql}
      INSERT INTO schema_migrations (version, name, applied_at)
      VALUES (7, 'durable_streak_daily_progress', 7);
      COMMIT;
    `);
  } finally {
    rawDatabase.close();
  }
}

function createV8Database(path: string): void {
  createV7Database(path);
  applyV8Migration(path);
}

function createV10Database(path: string): void {
  createV8Database(path);
  applyV9Migration(path);
  const rawDatabase = new DatabaseSync(path);
  try {
    rawDatabase.exec(`
      BEGIN IMMEDIATE;
      ${migrations[9].sql}
      INSERT INTO schema_migrations (version, name, applied_at)
      VALUES (10, 'prove_fragment_sources_and_protect_progression_root', 10);
      COMMIT;
    `);
  } finally {
    rawDatabase.close();
  }
}

function createV11Database(path: string): void {
  createV10Database(path);
  const rawDatabase = new DatabaseSync(path);
  try {
    rawDatabase.exec(`
      BEGIN IMMEDIATE;
      ${migrations[10].sql}
      INSERT INTO schema_migrations (version, name, applied_at)
      VALUES (11, 'add_permanent_progression_reward_receipts', 11);
      COMMIT;
      INSERT INTO progression_profiles VALUES (
        'v1-marker', 1, 1, 0, 'sakura', NULL,
        0, 0, 0, 0, 0, 0, 1, 1
      );
      INSERT INTO character_affinity VALUES ('v1-marker', 'sakura', 1, 0);
      INSERT INTO profile_equipment VALUES
        ('v1-marker', 'title', NULL, 1),
        ('v1-marker', 'frame', NULL, 1),
        ('v1-marker', 'skin', NULL, 1),
        ('v1-marker', 'cutin', NULL, 1);
    `);
  } finally {
    rawDatabase.close();
  }
}

function createV12Database(path: string): void {
  createV11Database(path);
  const rawDatabase = new DatabaseSync(path);
  try {
    rawDatabase.exec(`
      BEGIN IMMEDIATE;
      ${migrations[11].sql}
      INSERT INTO schema_migrations (version, name, applied_at)
      VALUES (12, 'enforce_durable_collection_catalog_and_reward_proofs', 12);
      COMMIT;
    `);
  } finally {
    rawDatabase.close();
  }
}

function createV13Database(path: string): void {
  createV12Database(path);
  const rawDatabase = new DatabaseSync(path);
  try {
    rawDatabase.exec(`
      BEGIN IMMEDIATE;
      ${migrations[12].sql}
      INSERT INTO schema_migrations (version, name, applied_at)
      VALUES (13, 'canonicalize_permanent_sources_and_collection_rows', 13);
      COMMIT;
    `);
  } finally {
    rawDatabase.close();
  }
}

function createV14Database(path: string): void {
  createV13Database(path);
  const rawDatabase = new DatabaseSync(path);
  try {
    rawDatabase.exec(`
      BEGIN IMMEDIATE;
      ${migrations[13].sql}
      INSERT INTO schema_migrations (version, name, applied_at)
      VALUES (14, 'poker_arena_persistence_schema', 14);
      COMMIT;
    `);
  } finally {
    rawDatabase.close();
  }
}

function createV15Database(path: string): void {
  createV14Database(path);
  const rawDatabase = new DatabaseSync(path);
  try {
    rawDatabase.exec(`
      BEGIN IMMEDIATE;
      ${migrations[14].sql}
      INSERT INTO schema_migrations (version, name, applied_at)
      VALUES (15, 'harden_poker_arena_lifecycle_invariants', 15);
      COMMIT;
    `);
  } finally {
    rawDatabase.close();
  }
}

function createV16Database(path: string): void {
  createV15Database(path);
  const rawDatabase = new DatabaseSync(path);
  try {
    rawDatabase.exec(`
      BEGIN IMMEDIATE;
      ${migrations[15].sql}
      INSERT INTO schema_migrations (version, name, applied_at)
      VALUES (16, 'audit_legacy_arena_persistence_rows', 16);
      COMMIT;
    `);
  } finally {
    rawDatabase.close();
  }
}

function createV17Database(path: string): void {
  createV16Database(path);
  const rawDatabase = new DatabaseSync(path);
  try {
    rawDatabase.exec(`
      BEGIN IMMEDIATE;
      ${migrations[16].sql}
      INSERT INTO schema_migrations (version, name, applied_at)
      VALUES (17, 'index_due_arena_weekly_groups', 17);
      COMMIT;
    `);
  } finally {
    rawDatabase.close();
  }
}

function insertV14ArenaFixture(database: DatabaseSync): void {
  database.exec(`
    INSERT INTO arena_seasons VALUES (
      'v14-season', 0, 1, 1, 1, 100000, 1
    );
    INSERT INTO arena_profiles VALUES (
      'v14-season', 'v1-marker', 2, '2026-07-20',
      0, 0, NULL, 1000, 10, 10
    );
    INSERT INTO arena_matches VALUES (
      'v14-match', 'v14-season', 1, 'arena-v1-hard', 1000,
      2, 4, 'forming', 10, NULL, NULL
    );
  `);
}

function insertV15CompleteArenaFixture(database: DatabaseSync): void {
  insertV14ArenaFixture(database);
  database.exec(`
    INSERT INTO arena_ticket_escrows VALUES (
      'v14-match', 'v14-season', 'v1-marker', 'escrow', 10, NULL
    );
    INSERT INTO arena_entries VALUES (
      'v14-match', 'v14-season', 'v1-marker',
      NULL, NULL, 1000, NULL, NULL, 10, NULL
    );
    INSERT INTO arena_groups VALUES (
      'v15-open-group', 'v14-season', '2020-W53',
      'bronze', 'open', 10, NULL
    );
    INSERT INTO arena_group_members VALUES (
      'v15-open-group', 'v14-season', '2020-W53', 'v1-marker',
      0, 0, 0, 0, 0, 10, 10, 10
    );
    INSERT INTO arena_groups VALUES (
      'v15-settled-group', 'v14-season', '2020-W53',
      'bronze', 'settled', 10, 20
    );
    INSERT INTO arena_weekly_settlements VALUES (
      'v14-season', '2020-W53', 'v15-settled-group', 20
    );
    INSERT INTO arena_season_rewards VALUES (
      'v14-season', 'v1-marker', 'v15-reward', 20
    );
  `);
}

function corruptIgnoringChecks(
  database: DatabaseSync,
  statement: string,
  triggerName?: string,
): void {
  database.exec('PRAGMA ignore_check_constraints=ON');
  try {
    if (triggerName) bypassTrigger(database, triggerName, statement);
    else database.exec(statement);
  } finally {
    database.exec('PRAGMA ignore_check_constraints=OFF');
  }
}

function expectOpenDatabaseToThrow(path: string): void {
  let opened: PokerDatabase | undefined;
  let thrown: unknown;
  try {
    opened = openPokerDatabase(path);
  } catch (error) {
    thrown = error;
  } finally {
    opened?.close();
  }
  expect(thrown).toBeDefined();
}

function bypassTrigger(
  database: DatabaseSync,
  triggerName: string,
  statement: string,
): void {
  const trigger = database.prepare(`
    SELECT sql FROM sqlite_schema WHERE type = 'trigger' AND name = ?
  `).get(triggerName) as { sql: string } | undefined;
  if (!trigger) throw new Error(`missing trigger: ${triggerName}`);
  database.exec(`DROP TRIGGER "${triggerName}";`);
  try {
    database.exec(statement);
  } finally {
    database.exec(trigger.sql);
  }
}

function createV8FragmentDatabase(path: string): void {
  createV7Database(path);
  const rawDatabase = new DatabaseSync(path);
  insertValidV7FragmentGrant(rawDatabase, 1);
  rawDatabase.close();
  applyV8Migration(path);
}

function applyV8Migration(path: string): void {
  const rawDatabase = new DatabaseSync(path);
  try {
    rawDatabase.exec(`
      BEGIN IMMEDIATE;
      ${migrations[7].sql}
      INSERT INTO schema_migrations (version, name, applied_at)
      VALUES (8, 'harden_streak_ownership_and_grant_receipts', 8);
      COMMIT;
    `);
  } finally {
    rawDatabase.close();
  }
}

function applyV9Migration(path: string): void {
  const rawDatabase = new DatabaseSync(path);
  try {
    rawDatabase.exec(`
      BEGIN IMMEDIATE;
      ${migrations[8].sql}
      INSERT INTO schema_migrations (version, name, applied_at)
      VALUES (9, 'repair_streak_children_and_canonicalize_grant_sources', 9);
      COMMIT;
    `);
  } finally {
    rawDatabase.close();
  }
}

function insertValidV5MissionDay(database: DatabaseSync): void {
  database.exec(`
    INSERT INTO daily_missions (
      profile_id, mission_date, slot, mission_id, target, progress,
      balance_version, reroll_count, assigned_at, completed_at, rewarded_at
    ) VALUES
      (
        'v1-marker', '2026-07-17', 0, 'COMPLETE_HANDS_ANY_10', 10, 0,
        1, 0, 1, NULL, NULL
      ),
      (
        'v1-marker', '2026-07-17', 1, 'COMPLETE_HANDS_CASH_10', 10, 0,
        1, 0, 1, NULL, NULL
      ),
      (
        'v1-marker', '2026-07-17', 2, 'COMPLETE_ONE_SNG', 1, 0,
        1, 0, 1, NULL, NULL
      );
  `);
}

function insertValidV7FragmentGrant(
  database: DatabaseSync,
  inventoryQuantity: number,
): void {
  const grantedAt = Date.parse('2026-07-17T12:00:00+09:00');
  const sourceRef = 'sng-finish:legacy-main';
  database.exec(`
    INSERT INTO progression_profiles VALUES (
      'v1-marker', 1, 1, 0, 'sakura', NULL,
      0, 0, 0, 0, 0, 7, 10, 10
    );
    INSERT INTO profile_equipment VALUES
      ('v1-marker', 'title', NULL, 10),
      ('v1-marker', 'frame', NULL, 10),
      ('v1-marker', 'skin', NULL, 10),
      ('v1-marker', 'cutin', NULL, 10);
    INSERT INTO streak_state VALUES (
      'v1-marker', 7, 1, '2026-07-17', '2026-W29', 10, 10
    );
    INSERT INTO streak_daily_progress VALUES (
      'v1-marker', '2026-07-17', 0, 1, ${grantedAt}
    );
    INSERT INTO inventory_items VALUES (
      'v1-marker', 'streak-fragment', ${inventoryQuantity},
      ${grantedAt}, ${grantedAt}
    );
  `);
  database.prepare(`
    INSERT INTO progression_events VALUES (?, 'v1-marker', ?, 1, ?, ?)
  `).run(
    'streak-fragment:v1-marker:2026-07-17',
    'streak-fragment',
    JSON.stringify({ itemId: 'streak-fragment', quantity: 1 }),
    grantedAt,
  );
  database.prepare(`
    INSERT INTO progression_events VALUES (?, 'v1-marker', ?, 1, ?, ?)
  `).run(
    sourceRef,
    'sng-finish',
    JSON.stringify({
      eventId: sourceRef,
      dojoXpMilli: 30_000,
      dojoLevelsGained: [],
      characterId: 'sakura',
      affinityMilli: 8_000,
      affinityLevelsGained: [],
      missionCompletions: [],
      streak: {
        previousStreak: 6,
        currentStreak: 7,
        restPassUsed: false,
      },
      grantedItemIds: ['streak-fragment'],
    }),
    grantedAt,
  );
}

function fragmentSourceSummaryJson(eventId: string): string {
  return JSON.stringify({
    eventId,
    dojoXpMilli: 30_000,
    dojoLevelsGained: [],
    characterId: 'sakura',
    affinityMilli: 8_000,
    affinityLevelsGained: [],
    missionCompletions: [],
    streak: {
      previousStreak: 6,
      currentStreak: 7,
      restPassUsed: false,
    },
    grantedItemIds: ['streak-fragment'],
  });
}

function validPermanentSummary(
  eventId: string,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    eventId,
    dojoXpMilli: 10_000,
    dojoLevelsGained: [],
    characterId: 'sakura',
    affinityMilli: 2_000,
    affinityLevelsGained: [],
    missionCompletions: [],
    grantedItemIds: [],
    ...overrides,
  };
}

function insertProfile(database: PokerDatabase, id: string): void {
  database.db
    .prepare(`
      INSERT INTO profiles (
        id,
        credential_hash,
        credential_lookup,
        recovery_hash,
        recovery_lookup,
        alias,
        avatar_id,
        adult_confirmed_at,
        created_at,
        updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)
    .run(
      id,
      `credential-hash-${id}`,
      `credential-lookup-${id}`,
      `recovery-hash-${id}`,
      `recovery-lookup-${id}`,
      `alias-${id}`,
      'sakura',
      Date.now(),
      Date.now(),
      Date.now(),
    );
}

function insertArenaFixture(database: PokerDatabase, profileId: string): void {
  insertProfile(database, profileId);
  database.db.prepare(`
    INSERT OR IGNORE INTO arena_seasons (
      id, ordinal, config_version, preseason, starts_at, ends_at, created_at
    ) VALUES ('season-v1', 0, 1, 1, 1, 100000, 1)
  `).run();
  database.db.prepare(`
    INSERT INTO arena_profiles (
      season_id, profile_id, available_tickets, last_daily_grant_date,
      placement_games, placement_points, tier, mmr, created_at, updated_at
    ) VALUES (
      'season-v1', ?, 2, '2026-07-20', 0, 0, NULL, 1000, 10, 10
    )
  `).run(profileId);
}

function insertArenaMatch(
  database: PokerDatabase,
  matchId: string,
  profileId: string,
): void {
  void profileId;
  database.db.prepare(`
    INSERT INTO arena_matches (
      id, season_id, config_version, bot_version, bot_mmr,
      human_count, bot_count, status, created_at, started_at, finished_at
    ) VALUES (?, 'season-v1', 1, 'arena-v1-hard', 1000,
      2, 4, 'forming', 10, NULL, NULL)
  `).run(matchId);
}
