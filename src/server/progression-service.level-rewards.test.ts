import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { getBalance } from '@/lib/progression/balance';
import { getKstDateKey } from './economy-service';
import { openPokerDatabase, type PokerDatabase } from './persistence/database';
import { ProgressionRepository } from './progression-repository';
import { ProgressionService } from './progression-service';
import { migrations } from './persistence/migrations';

const AT = 1_700_000_000_000;

describe('authoritative progression level rewards', () => {
  let database: PokerDatabase;
  let repository: ProgressionRepository;
  let service: ProgressionService;
  const directories: string[] = [];
  beforeEach(() => {
    database = openPokerDatabase(':memory:');
    repository = new ProgressionRepository(database);
    service = new ProgressionService(database, repository);
  });
  afterEach(() => {
    vi.restoreAllMocks(); database.close();
    for (const directory of directories.splice(0)) rmSync(directory,{recursive:true,force:true});
  });

  function seed(id = 'profile-a') {
    database.db.prepare(`INSERT INTO profiles (
      id, credential_hash, credential_lookup, recovery_hash, recovery_lookup,
      alias, avatar_id, adult_confirmed_at, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, 'sakura', 1, 1, 1)`)
      .run(id,`hash-${id}`,`lookup-${id}`,`recovery-${id}`,`recover-lookup-${id}`,id);
    service.selectCharacter(id, 'ara', AT - 1000);
  }
  function story(milli = 1) {
    return { profileId:'profile-a', chapterId:'act1-ch01', runId:'run',
      firstClear:true, grade:'A' as const, dojoXpMilli:milli,
      affinity:[{characterId:'ara' as const,milli:0},{characterId:'hana' as const,milli}],
      completedAt:AT };
  }
  function nearBoundary() {
    const balance = getBalance(1);
    database.db.prepare('UPDATE progression_profiles SET dojo_xp_milli=? WHERE profile_id=?')
      .run(balance.dojoXpForNextLevel(1)-1,'profile-a');
    database.db.prepare(`INSERT INTO character_affinity(profile_id,character_id,level,xp_milli)
      VALUES ('profile-a','hana',4,?)`).run(balance.affinityForNextLevel(4)-1);
  }
  function rows(table: string) { return database.db.prepare(`SELECT * FROM ${table}`).all(); }

  it.each([1,2])('does not read unrelated streak state when reconciling dojo level %i', level => {
    seed();
    database.db.prepare('UPDATE progression_profiles SET dojo_level=?').run(level);
    database.db.exec('DELETE FROM streak_state');
    expect(service.reconcileLevelRewards('profile-a',AT))
      .toEqual(level === 2 ? ['dojo-title-sprout-challenger'] : []);
    expect(rows('streak_state')).toEqual([]);
  });

  it('keeps the missing progression profile error during reconciliation', () => {
    expect(() => service.reconcileLevelRewards('missing-profile',AT))
      .toThrow('PROGRESSION_PROFILE_NOT_FOUND');
  });

  it.each([0,1])('awards exact dojo and second heroine boundaries for %i milli', milli => {
    seed(); nearBoundary();
    const result = service.recordStoryChapterComplete(story(milli));
    expect(result.summary.grantedItemIds).toEqual(milli === 1
      ? ['affinity-hana-dialogue-pack','dojo-title-sprout-challenger'] : []);
    expect(result.snapshot.profile.dojoLevel).toBe(milli === 1 ? 2 : 1);
    expect(result.snapshot.affinities.find(a => a.characterId === 'hana')?.level).toBe(milli === 1 ? 5 : 4);
  });

  it('replays a multi heroine grant using the exact persisted receipt set', () => {
    seed(); nearBoundary();
    const first = service.recordStoryChapterComplete(story());
    expect(first.summary.grantedItemIds).toHaveLength(2);
    expect(service.recordStoryChapterComplete(story())).toMatchObject({duplicate:true,summary:first.summary});
    expect(rows('progression_level_reward_grants')).toHaveLength(2);
  });

  it('backfills all current heroine levels while preserving past events and XP', () => {
    seed();
    const input = story(0);
    const first = service.recordStoryChapterComplete(input);
    const events = rows('progression_events');
    database.db.prepare(`UPDATE character_affinity SET level=20,xp_milli=0 WHERE character_id='hana'`).run();
    database.db.prepare(`INSERT INTO character_affinity(profile_id,character_id,level,xp_milli)
      VALUES ('profile-a','elena',5,0)`).run();
    const affinities = rows('character_affinity');
    expect(service.reconcileLevelRewards('profile-a',AT+1)).toEqual([
      'affinity-elena-dialogue-pack','affinity-hana-aura','affinity-hana-cutin',
      'affinity-hana-dialogue-pack','affinity-hana-skin',
    ]);
    expect(service.reconcileLevelRewards('profile-a',AT+2)).toEqual([]);
    expect(rows('progression_events')).toEqual(events);
    expect(rows('character_affinity')).toEqual(affinities);
    expect(service.recordStoryChapterComplete(input)).toMatchObject({duplicate:true,summary:first.summary});
  });

  it('rolls back all XP, event and inventory when granting fails after insertion', () => {
    seed(); nearBoundary();
    const tables = ['progression_profiles','character_affinity','progression_events','inventory_items'];
    const before = tables.map(rows);
    const original = repository.grantLevelRewardsInTransaction.bind(repository);
    vi.spyOn(repository,'grantLevelRewardsInTransaction').mockImplementation((...args) => {
      original(...args); throw new Error('injected grant failure');
    });
    expect(() => service.recordStoryChapterComplete(story())).toThrow('injected grant failure');
    expect(tables.map(rows)).toEqual(before);
    expect(rows('progression_level_reward_grants')).toEqual([]);
  });

  it('blocks inventory replacement when recursive triggers are off', () => {
    seed(); nearBoundary(); service.recordStoryChapterComplete(story());
    database.db.exec('PRAGMA recursive_triggers=OFF');
    const before = rows('inventory_items');
    expect(() => database.db.prepare(`INSERT OR REPLACE INTO inventory_items
      (profile_id,item_id,quantity,granted_at,updated_at)
      VALUES ('profile-a','affinity-hana-dialogue-pack',1,?,?)`).run(AT+1,AT+1))
      .toThrow(/immutable level reward inventory/);
    expect(rows('inventory_items')).toEqual(before);
  });

  it('resumes interrupted backfill without duplicating the earlier profile', () => {
    seed('profile-a'); seed('profile-b');
    database.db.exec('UPDATE progression_profiles SET dojo_level=5');
    const original = repository.grantLevelRewardsInTransaction.bind(repository);
    const fault = vi.spyOn(repository,'grantLevelRewardsInTransaction').mockImplementation((...args) => {
      const result = original(...args);
      if (args[0] === 'profile-b') throw new Error('interrupted');
      return result;
    });
    expect(() => service.reconcileAllLevelRewards(AT)).toThrow('interrupted');
    expect(rows('progression_level_reward_grants')).toHaveLength(2);
    fault.mockRestore();
    expect(service.reconcileAllLevelRewards(AT+1)).toEqual({profiles:2,granted:2});
    expect(service.reconcileAllLevelRewards(AT+2)).toEqual({profiles:2,granted:0});
    expect(rows('inventory_items')).toHaveLength(4);
  });

  it('reconciles profiles across the keyset page boundary', () => {
    for (let i=0;i<102;i++) seed(`profile-${String(i).padStart(3,'0')}`);
    database.db.exec('UPDATE progression_profiles SET dojo_level=2');
    expect(service.reconcileAllLevelRewards(AT)).toEqual({profiles:102,granted:102});
    expect(service.reconcileAllLevelRewards(AT+1)).toEqual({profiles:102,granted:0});
  });

  it('grants daily affinity without dojo XP and validates a duplicate daily receipt', () => {
    seed(); nearBoundary();
    const before = rows('progression_profiles');
    const input = {profileId:'profile-a',teacherId:'hana' as const,kstDate:getKstDateKey(AT),completedAt:AT};
    const result = service.recordStoryDailyDrills(input);
    expect(result.summary.grantedItemIds).toEqual(['affinity-hana-dialogue-pack']);
    expect(rows('progression_profiles').map(row => row.dojo_xp_milli))
      .toEqual(before.map(row => row.dojo_xp_milli));
    expect(service.recordStoryDailyDrills(input)).toMatchObject({duplicate:true,summary:result.summary});
  });

  it('rejects forged stored story item claims without matching new receipts', () => {
    seed();
    const result = service.recordStoryChapterComplete(story(0));
    database.db.prepare('UPDATE progression_events SET summary_json=? WHERE idempotency_key=?')
      .run(JSON.stringify({...result.summary,grantedItemIds:['dojo-title-sprout-challenger']}),result.summary.eventId);
    expect(() => service.recordStoryChapterComplete(story(0)))
      .toThrow('PROGRESSION_STORED_SUMMARY_INVALID');
    expect(rows('inventory_items')).toEqual([]);
  });

  it('uses the current level catalog to reject direct SQL forged entitlements', () => {
    seed();
    database.db.exec('UPDATE progression_profiles SET dojo_level=2');
    const insert = database.db.prepare(`INSERT INTO progression_level_reward_grants
      (profile_id,item_id,source_kind,required_level,character_id,balance_version,
       observed_level,observed_xp_milli,reason,source_event_id,granted_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?)`);
    const valid = ['profile-a','dojo-title-sprout-challenger','dojo-level',2,null,1,2,0,'reconcile-v34',null,AT];
    for (const [index,value] of [
      [0,'missing-profile'],[1,'dojo-frame-cherry-blossom'],[1,'streak-fragment'],
      [1,'story-title-white-belt'],[2,'affinity-level'],[3,1],[4,'hana'],[5,2],
      [6,5],[7,1],[8,'anything'],[9,'arbitrary-event'],
    ] as Array<[number,string|number]>) {
      const forged = [...valid]; forged[index] = value;
      expect(() => insert.run(...forged)).toThrow();
    }
    expect(rows('progression_level_reward_grants')).toEqual([]);
    insert.run(...valid);
    expect(rows('inventory_items')).toHaveLength(1);
    expect(() => insert.run(...valid)).toThrow();
    expect(() => database.db.exec('UPDATE progression_level_reward_grants SET granted_at=1'))
      .toThrow(/immutable level reward grant/);
    expect(() => database.db.exec('DELETE FROM progression_level_reward_grants'))
      .toThrow(/immutable level reward grant/);
    expect(() => database.db.exec('DELETE FROM inventory_items'))
      .toThrow(/immutable level reward inventory/);
    database.db.exec("DELETE FROM profiles WHERE id='profile-a'");
    expect(rows('progression_level_reward_grants')).toEqual([]);
  });

  it('freezes new source events and prevents a second legacy receipt', () => {
    seed(); nearBoundary();
    const result = service.recordStoryChapterComplete(story());
    expect(() => database.db.prepare('UPDATE progression_events SET summary_json=? WHERE idempotency_key=?')
      .run('{}',result.summary.eventId)).toThrow(/immutable level reward source event/);
    expect(() => database.db.prepare('DELETE FROM progression_events WHERE idempotency_key=?')
      .run(result.summary.eventId)).toThrow();
    expect(() => database.db.prepare(`INSERT INTO permanent_progression_grants
      (profile_id,item_id,source_event_id,source_kind,source_level,source_character_id,granted_at)
      VALUES ('profile-a','dojo-title-sprout-challenger',?,'dojo-level',2,NULL,?)`)
      .run(result.summary.eventId,AT)).toThrow();
  });

  it('upgrades v33 and reopens without rewriting historical events or earlier guards', () => {
    seed(); service.recordStoryChapterComplete(story(0));
    database.db.exec(`UPDATE progression_profiles SET dojo_level=5;
      UPDATE character_affinity SET level=20 WHERE character_id='hana';
      INSERT INTO character_affinity VALUES ('profile-a','elena',5,0);
      INSERT INTO inventory_items VALUES ('profile-a','dojo-title-sprout-challenger',1,1,1);`);
    const directory = mkdtempSync(join(tmpdir(),'poker-level-v33-'));
    directories.push(directory);
    const path = join(directory,'poker.sqlite');
    const raw = new DatabaseSync(path);
    let previousGuards: unknown;
    try {
      raw.exec(`PRAGMA foreign_keys=ON;
        CREATE TABLE schema_migrations(version INTEGER PRIMARY KEY,name TEXT NOT NULL,applied_at INTEGER NOT NULL) STRICT;`);
      for (const migration of migrations.filter(m => m.version <= 33)) {
        raw.exec(migration.sql);
        raw.prepare('INSERT INTO schema_migrations VALUES(?,?,?)').run(migration.version,migration.name,AT);
      }
      // progression_profiles INSERT already creates streak_state through the v8 trigger.
      for (const table of ['profiles','progression_profiles','character_affinity','profile_equipment','progression_events','inventory_items']) {
        for (const row of rows(table)) {
          raw.prepare(`INSERT INTO ${table} (${Object.keys(row).join(',')})
            VALUES (${Object.keys(row).map(() => '?').join(',')})`).run(...Object.values(row));
        }
      }
      raw.exec(`INSERT INTO story_rewards(profile_id,item_id,source_key,granted_at)
        VALUES ('profile-a','story-title-white-belt','old-story',1);`);
      previousGuards = raw.prepare("SELECT type,name,sql FROM sqlite_schema WHERE type IN ('view','trigger') ORDER BY name").all();
    } finally { raw.close(); }
    const events = rows('progression_events');
    const progression = rows('progression_profiles');
    const affinities = rows('character_affinity');
    database.close();
    database = openPokerDatabase(path);
    repository = new ProgressionRepository(database);
    service = new ProgressionService(database,repository);
    const oldGuardNames = new Set((previousGuards as Array<{name:string}>).map(row => row.name));
    expect(database.db.prepare("SELECT type,name,sql FROM sqlite_schema WHERE type IN ('view','trigger') ORDER BY name")
      .all().filter(row => oldGuardNames.has(row.name as string))).toEqual(previousGuards);
    const earlierStoryRewards = rows('story_rewards');
    expect(service.reconcileAllLevelRewards(AT)).toEqual({profiles:1,granted:6});
    expect(rows('progression_events')).toEqual(events);
    expect(rows('progression_profiles')).toEqual(progression);
    expect(rows('character_affinity')).toEqual(affinities);
    expect(rows('story_rewards')).toEqual(earlierStoryRewards);
    const receipts = rows('progression_level_reward_grants');
    const inventory = rows('inventory_items');
    database.close();
    database = openPokerDatabase(path);
    service = new ProgressionService(database);
    expect(service.reconcileAllLevelRewards(AT+1)).toEqual({profiles:1,granted:0});
    expect(rows('progression_level_reward_grants')).toEqual(receipts);
    expect(rows('inventory_items')).toEqual(inventory);
    expect(service.setEquipment('profile-a','frame','dojo-frame-cherry-blossom',AT+1).equipment.frame)
      .toBe('dojo-frame-cherry-blossom');
  });

  it('rejects replacing an existing source event with recursive triggers off', () => {
    seed(); nearBoundary();
    const result = service.recordStoryChapterComplete(story());
    database.db.exec('PRAGMA recursive_triggers=OFF');
    const before = rows('progression_events');
    expect(() => database.db.prepare(`INSERT OR REPLACE INTO progression_events
      (idempotency_key,profile_id,event_type,balance_version,summary_json,created_at)
      VALUES (?,'profile-a','story-chapter',1,?,?)`)
      .run(result.summary.eventId,JSON.stringify({...result.summary,grantedItemIds:[]}),AT))
      .toThrow(/immutable level reward source event/);
    expect(rows('progression_events')).toEqual(before);
  });

  it.each(['cash-first','story-first'] as const)('preserves receipts for mixed XP: %s', order => {
    seed(); nearBoundary();
    const hand = {profileId:'profile-a',roomId:'cash-room',handNumber:1,mode:'cash' as const,
      selectedCharacterId:'ara',completedAt:AT};
    if (order === 'cash-first') service.recordCompletedHand(hand);
    const result = service.recordStoryChapterComplete(story());
    const before = rows('inventory_items');
    const legacy = rows('permanent_progression_grants');
    if (order === 'story-first') service.recordCompletedHand(hand);
    expect(rows('inventory_items')).toEqual(before);
    expect(rows('permanent_progression_grants')).toEqual(legacy);
    expect(service.reconcileLevelRewards('profile-a',AT+1)).toEqual([]);
    expect(service.recordStoryChapterComplete(story())).toMatchObject({duplicate:true,summary:result.summary});
    expect(service.recordCompletedHand(hand)).toEqual(service.recordCompletedHand(hand));
    expect(result.summary.grantedItemIds).toEqual(order === 'cash-first'
      ? ['affinity-hana-dialogue-pack'] : ['affinity-hana-dialogue-pack','dojo-title-sprout-challenger']);
  });

  it('reconciles all six heroines at different levels and preserves max level XP', () => {
    seed();
    const levels = {sakura:5,ara:10,hana:15,chloe:20,vivian:4,elena:19};
    const upsert = database.db.prepare(`INSERT INTO character_affinity VALUES ('profile-a',?,?,0)
      ON CONFLICT(profile_id,character_id) DO UPDATE SET level=excluded.level,xp_milli=0`);
    for (const [character,level] of Object.entries(levels)) upsert.run(character,level);
    expect(service.reconcileLevelRewards('profile-a',AT)).toHaveLength(13);
    const before = rows('inventory_items');
    const result = service.recordStoryChapterComplete({...story(),dojoXpMilli:0,
      affinity:[{characterId:'chloe',milli:500_000}]});
    expect(result.snapshot.affinities.find(a => a.characterId === 'chloe')).toMatchObject({level:20,xpMilli:0});
    expect(rows('inventory_items')).toEqual(before);
    expect(result.summary.grantedItemIds).toEqual([]);
  });

  it.each([5,10,15,20])('awards the heroine level %i boundary', level => {
    seed();
    database.db.prepare(`INSERT INTO character_affinity VALUES ('profile-a','hana',?,?)`)
      .run(level-1,getBalance(1).affinityForNextLevel(level-1)-1);
    service.reconcileLevelRewards('profile-a',AT-1);
    const result = service.recordStoryChapterComplete({...story(),dojoXpMilli:0});
    expect(result.summary.grantedItemIds).toEqual([
      `affinity-hana-${({5:'dialogue-pack',10:'aura',15:'cutin',20:'skin'} as Record<number,string>)[level]}`,
    ]);
  });

  it('grants every crossed reward when one chapter jumps several levels', () => {
    seed();
    const result = service.recordStoryChapterComplete({...story(),dojoXpMilli:5_000_000,
      affinity:[{characterId:'sakura',milli:500_000},{characterId:'hana',milli:500_000}]});
    expect(result.snapshot.profile.dojoLevel).toBe(17);
    expect(result.summary.grantedItemIds).toEqual([
      'affinity-hana-dialogue-pack','affinity-sakura-dialogue-pack',
      'dojo-emote-miyako-cheer','dojo-frame-cherry-blossom',
      'dojo-title-sprout-challenger','dojo-title-steady-trainee',
    ]);
    expect(service.recordStoryChapterComplete({...story(),dojoXpMilli:0}))
      .toMatchObject({duplicate:true,summary:result.summary});
  });

  it('rejects a story receipt whose audit event grant claim is not an array', () => {
    seed(); database.db.exec('UPDATE progression_profiles SET dojo_level=2');
    database.db.prepare(`INSERT INTO progression_events VALUES ('malformed-story','profile-a','story-chapter',1,?,?)`)
      .run(JSON.stringify({eventId:'malformed-story',grantedItemIds:'dojo-title-sprout-challenger'}),AT);
    expect(() => database.transaction(() => repository.grantLevelRewardsInTransaction(
      'profile-a',repository.getMissingLevelRewardsInTransaction('profile-a'),
      {reason:'story',sourceEventId:'malformed-story'},AT,
    ))).toThrow();
    expect(rows('inventory_items')).toEqual([]);
  });

  it.each(['profile','type','time','balance','missing','claim'])(
    'rejects a mismatched story audit source: %s', mismatch => {
      seed(); seed('profile-b');
      database.db.exec("UPDATE progression_profiles SET dojo_level=2 WHERE profile_id='profile-a'");
      const sourceId = 'audit-source';
      if (mismatch !== 'missing') {
        database.db.prepare('INSERT INTO progression_events VALUES (?,?,?,?,?,?)').run(
          sourceId,mismatch === 'profile' ? 'profile-b' : 'profile-a',
          mismatch === 'type' ? 'completed-hand' : 'story-chapter',
          mismatch === 'balance' ? 2 : 1,
          JSON.stringify({eventId:sourceId,grantedItemIds:mismatch === 'claim' ? [] : ['dojo-title-sprout-challenger']}),
          mismatch === 'time' ? AT+1 : AT,
        );
      }
      expect(() => database.transaction(() => repository.grantLevelRewardsInTransaction(
        'profile-a',repository.getMissingLevelRewardsInTransaction('profile-a'),
        {reason:'story',sourceEventId:sourceId},AT,
      ))).toThrow();
      expect(rows('inventory_items')).toEqual([]);
    },
  );
});
