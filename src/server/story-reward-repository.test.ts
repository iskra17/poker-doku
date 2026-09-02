import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openPokerDatabase, type PokerDatabase } from './persistence/database';
import { ProfileRepository } from './profile-repository';
import { StoryPersistenceError } from './story-repository';
import { StoryRewardRepository } from './story-reward-repository';

/**
 * 수련 스토리 보상 영수증(v32) 회귀:
 * - 영수증 1회 캡(duplicate) · 칩 외 보상만 인벤토리 sync(수량 1, 시각 = 영수증 시각)
 * - 미등록 item_id·트랜잭션 밖 호출·입력 검증 거절
 * - 영수증·인벤토리 마커 동결(update/delete) — 프로필 삭제 CASCADE만 허용
 * - 프로필 삭제 시 영수증·마커·코스메틱 장착 전부 CASCADE + foreign_key_check 빈 결과
 */

const T0 = Date.parse('2026-09-03T12:00:00+09:00');
const HERO = 'story-hero';

describe('StoryRewardRepository', () => {
  let database: PokerDatabase;
  let repository: StoryRewardRepository;

  beforeEach(() => {
    database = openPokerDatabase(':memory:');
    repository = new StoryRewardRepository(database);
    insertProfile(database, HERO);
  });

  afterEach(() => {
    database.close();
  });

  function grant(
    itemId: string,
    sourceKey = 'story-chapter:act1-ch01:first',
    now = T0,
    profileId = HERO,
  ): 'granted' | 'duplicate' {
    return database.transaction(() => repository.grantInTransaction(profileId, itemId, sourceKey, now));
  }

  function inventoryRow(itemId: string): unknown {
    return database.db.prepare(`
      SELECT quantity, granted_at, updated_at FROM inventory_items
      WHERE profile_id = ? AND item_id = ?
    `).get(HERO, itemId);
  }

  function expectCode(work: () => unknown, code: StoryPersistenceError['code']): void {
    try {
      work();
    } catch (error) {
      expect(error).toBeInstanceOf(StoryPersistenceError);
      expect((error as StoryPersistenceError).code).toBe(code);
      return;
    }
    throw new Error(`expected ${code}`);
  }

  it('grants once, syncs a non-chip item into the inventory, and reports duplicates', () => {
    expect(grant('story-title-white-belt')).toBe('granted');
    expect(grant('story-title-white-belt', 'story-chapter:act1-ch01:first', T0 + 1)).toBe('duplicate');

    expect(repository.listGranted(HERO)).toEqual([
      { itemId: 'story-title-white-belt', sourceKey: 'story-chapter:act1-ch01:first', grantedAt: T0 },
    ]);
    expect(repository.listGrantedIds(HERO)).toEqual(new Set(['story-title-white-belt']));
    expect(inventoryRow('story-title-white-belt')).toEqual({ quantity: 1, granted_at: T0, updated_at: T0 });
    expect(rowCount(database, 'story_rewards')).toBe(1);
  });

  it('records chip rewards as receipts only — never as inventory markers', () => {
    expect(grant('story-chips-act1-ch01-first')).toBe('granted');
    expect(repository.listGrantedIds(HERO).has('story-chips-act1-ch01-first')).toBe(true);
    expect(inventoryRow('story-chips-act1-ch01-first')).toBeUndefined();
    expect(rowCount(database, 'inventory_items')).toBe(0);
  });

  it('rejects unknown items, out-of-transaction calls, and invalid inputs without writing', () => {
    expectCode(() => grant('not-a-story-item'), 'STORY_VALUE_INVALID');
    expectCode(() => grant('dojo-frame-cherry-blossom'), 'STORY_VALUE_INVALID');
    expectCode(
      () => repository.grantInTransaction(HERO, 'story-title-white-belt', 'key', T0),
      'STORY_TRANSACTION_REQUIRED',
    );
    expectCode(() => grant('story-title-white-belt', ''), 'STORY_VALUE_INVALID');
    expectCode(() => grant('story-title-white-belt', 'key', -1), 'STORY_TIME_INVALID');
    expectCode(() => grant('story-title-white-belt', 'key', T0, 'ghost'), 'STORY_PROFILE_NOT_FOUND');
    expect(rowCount(database, 'story_rewards')).toBe(0);
    expect(rowCount(database, 'inventory_items')).toBe(0);
  });

  it('freezes receipts and protects their inventory markers from update and delete', () => {
    grant('story-cardback-dojo-crest');
    expect(() => database.db.prepare(`
      UPDATE story_rewards SET source_key = 'tampered' WHERE profile_id = ? AND item_id = 'story-cardback-dojo-crest'
    `).run(HERO)).toThrow(/immutable/);
    expect(() => database.db.prepare(`
      DELETE FROM story_rewards WHERE profile_id = ? AND item_id = 'story-cardback-dojo-crest'
    `).run(HERO)).toThrow(/immutable/);
    expect(() => database.db.prepare(`
      UPDATE inventory_items SET updated_at = updated_at + 1
      WHERE profile_id = ? AND item_id = 'story-cardback-dojo-crest'
    `).run(HERO)).toThrow(/immutable story reward inventory/);
    expect(() => database.db.prepare(`
      DELETE FROM inventory_items WHERE profile_id = ? AND item_id = 'story-cardback-dojo-crest'
    `).run(HERO)).toThrow(/immutable story reward inventory/);
    expect(inventoryRow('story-cardback-dojo-crest')).toEqual({ quantity: 1, granted_at: T0, updated_at: T0 });
  });

  it('cascades receipts, markers and equipped cosmetics with the profile', () => {
    grant('story-outfit-sakura-dojo', 'story-chapter:act1-ch02:first');
    grant('story-felt-yellow-belt', 'story-act:1');
    grant('story-chips-act1-ch02-first', 'story-chapter:act1-ch02:first');
    database.db.prepare(`
      INSERT INTO profile_character_outfits (profile_id, character_id, item_id, updated_at)
      VALUES (?, 'sakura', 'story-outfit-sakura-dojo', ?)
    `).run(HERO, T0);
    database.db.prepare(`
      INSERT INTO profile_cosmetics (profile_id, slot, item_id, updated_at)
      VALUES (?, 'felt', 'story-felt-yellow-belt', ?)
    `).run(HERO, T0);
    // 장착 검증: 슬롯 불일치·미소유·히로인 불일치는 트리거가 거절한다
    expect(() => database.db.prepare(`
      INSERT INTO profile_cosmetics (profile_id, slot, item_id, updated_at)
      VALUES (?, 'card-back', 'story-felt-yellow-belt', ?)
    `).run(HERO, T0)).toThrow(/invalid profile cosmetic/);
    expect(() => database.db.prepare(`
      UPDATE profile_character_outfits SET character_id = 'hana' WHERE profile_id = ?
    `).run(HERO)).toThrow(/invalid character outfit/);

    expect(new ProfileRepository(database).deleteProfile(HERO)).toBe('deleted');

    for (const table of ['story_rewards', 'inventory_items', 'profile_cosmetics', 'profile_character_outfits']) {
      expect(rowCount(database, table)).toBe(0);
    }
    expect(database.db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
  });
});

function rowCount(database: PokerDatabase, table: string): number {
  const row = database.db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as { count: number };
  return Number(row.count);
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
