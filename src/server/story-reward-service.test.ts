import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { makeChapterChain } from '@/lib/story/test-fixtures';
import { PERFECT_SET_FLAG } from '@/lib/story/unlocks';
import { EconomyRepository } from './economy-repository';
import { EconomyService } from './economy-service';
import { openPokerDatabase, type PokerDatabase } from './persistence/database';
import { StoryRepository } from './story-repository';
import { StoryRewardRepository } from './story-reward-repository';
import { StoryRewardService, storyRewardSourceKey } from './story-reward-service';

/**
 * 보상 reconcile 회귀:
 * - 자격(완료·최고 등급·막 완주·플래그) − 영수증 = 누락분만 지급, 재실행은 무변경(멱등)
 * - 칩은 chip_ledger 'STORY_REWARD' 1행/아이템(길이 접두 키), 인벤토리엔 없음
 * - preview는 영수증 기준 granted 플래그 · grantDailyChips는 KST 날짜당 1회
 * - 칩 원장이 거절되면(지갑 없음) 영수증까지 같은 트랜잭션으로 롤백
 */

const T0 = Date.parse('2026-09-03T12:00:00+09:00');
const HERO = 'story-hero';
const CHAPTERS = makeChapterChain();

describe('StoryRewardService', () => {
  let database: PokerDatabase;
  let stories: StoryRepository;
  let service: StoryRewardService;

  beforeEach(() => {
    database = openPokerDatabase(':memory:');
    stories = new StoryRepository(database);
    const economyRepository = new EconomyRepository(database);
    service = new StoryRewardService({
      database,
      storyRepository: stories,
      rewardRepository: new StoryRewardRepository(database),
      economyRepository,
      economyService: new EconomyService(economyRepository, () => T0),
      chapters: CHAPTERS,
    });
    seedProfile(HERO, 1_000);
  });

  afterEach(() => {
    database.close();
  });

  function ledger(profileId = HERO): Array<Record<string, unknown>> {
    return database.db.prepare(`
      SELECT reason, delta, ref_id, idempotency_key FROM chip_ledger
      WHERE profile_id = ? ORDER BY created_at ASC, idempotency_key ASC
    `).all(profileId) as Array<Record<string, unknown>>;
  }

  function balance(profileId = HERO): number {
    const row = database.db.prepare('SELECT balance FROM wallets WHERE profile_id = ?').get(profileId) as { balance: number };
    return Number(row.balance);
  }

  function inventoryIds(profileId = HERO): string[] {
    return (database.db.prepare(
      'SELECT item_id FROM inventory_items WHERE profile_id = ? ORDER BY item_id',
    ).all(profileId) as Array<{ item_id: string }>).map(row => row.item_id);
  }

  it('grants only missing entitlements, writes the chip ledger once, and is idempotent on re-run', () => {
    expect(service.reconcile(HERO, T0)).toEqual({ granted: [], chips: 0 });

    stories.recordCompletion(HERO, 'act1-ch01', 'A', T0);
    const first = service.reconcile(HERO, T0);
    expect(first.granted.map(item => item.id)).toEqual(['story-title-white-belt', 'story-cg-act1-belt-white']);
    expect(first.granted[0]).toMatchObject({ kind: 'title', name: '백띠 수련생' });
    expect(first.granted[1]).toMatchObject({ kind: 'cg', art: '/assets/story/cg/act1-belt-white.webp' });
    expect(first.chips).toBe(500);
    expect(balance()).toBe(1_500);
    expect(ledger()).toEqual([{
      reason: 'STORY_REWARD',
      delta: 500,
      ref_id: 'story-chips-act1-ch01-first',
      idempotency_key: 'story-reward:10:story-hero:27:story-chips-act1-ch01-first',
    }]);
    expect(inventoryIds()).toEqual(['story-cg-act1-belt-white', 'story-title-white-belt']);
    expect(service.grantedIds(HERO)).toEqual(new Set([
      'story-title-white-belt', 'story-chips-act1-ch01-first', 'story-cg-act1-belt-white',
    ]));

    // 재실행 — 새 지급·원장 없음
    expect(service.reconcile(HERO, T0 + 1_000)).toEqual({ granted: [], chips: 0 });
    expect(ledger()).toHaveLength(1);
    expect(balance()).toBe(1_500);

    // 최고 등급이 S로 오르면 S 보상만 추가된다
    stories.recordCompletion(HERO, 'act1-ch01', 'S', T0 + 2_000);
    const graded = service.reconcile(HERO, T0 + 2_000);
    expect(graded.granted.map(item => item.id)).toEqual(['story-cardback-dojo-crest']);
    expect(graded.chips).toBe(300);
    expect(balance()).toBe(1_800);
    expect(ledger()).toHaveLength(2);
    expect(database.db.prepare(`
      SELECT item_id, source_key FROM story_rewards WHERE profile_id = ? ORDER BY granted_at, item_id
    `).all(HERO)).toEqual([
      { item_id: 'story-cg-act1-belt-white', source_key: 'story-chapter:act1-ch01:first' },
      { item_id: 'story-chips-act1-ch01-first', source_key: 'story-chapter:act1-ch01:first' },
      { item_id: 'story-title-white-belt', source_key: 'story-chapter:act1-ch01:first' },
      { item_id: 'story-cardback-dojo-crest', source_key: 'story-chapter:act1-ch01:grade-S' },
      { item_id: 'story-chips-act1-ch01-s', source_key: 'story-chapter:act1-ch01:grade-S' },
    ]);
  });

  it('grants act completion and flag rewards from durable state', () => {
    stories.recordCompletion(HERO, 'act1-ch01', 'B', T0);
    stories.recordCompletion(HERO, 'act1-ch02', 'B', T0);
    stories.recordCompletion(HERO, 'act1-ch03', 'B', T0);
    const result = service.reconcile(HERO, T0);
    expect(result.granted.map(item => item.id)).toEqual([
      'story-title-white-belt',
      'story-cg-act1-belt-white',
      'story-outfit-sakura-dojo',
      'throwable-bouquet',
      'story-cg-act1-draco-boss',
      'story-cardback-yellow-belt',
      'story-felt-yellow-belt',
      'story-cg-act1-belt-yellow',
    ]);
    // 500 × 3 (첫 완주) + 1,000 (1막 완주)
    expect(result.chips).toBe(2_500);
    expect(balance()).toBe(3_500);
    expect(ledger().every(row => row.reason === 'STORY_REWARD')).toBe(true);
    expect(ledger()).toHaveLength(4);

    stories.setFlags(HERO, { [PERFECT_SET_FLAG]: '1' }, T0);
    expect(service.reconcile(HERO, T0).granted.map(item => item.id)).toEqual(['story-title-perfect']);
    expect(database.db.prepare(
      'SELECT source_key FROM story_rewards WHERE profile_id = ? AND item_id = ?',
    ).get(HERO, 'story-title-perfect')).toEqual({ source_key: 'story-flag:badge:perfect-set' });
  });

  it('previews the whole catalog with granted flags from receipts', () => {
    stories.recordCompletion(HERO, 'act1-ch01', 'A', T0);
    service.reconcile(HERO, T0);
    const preview = service.preview(HERO);
    expect(preview.map(item => item.id)).toHaveLength(20);
    expect(preview.find(item => item.id === 'story-title-white-belt')).toMatchObject({
      granted: true,
      requirement: expect.stringContaining('첫 완주'),
      trigger: { kind: 'chapter-first-clear', chapterId: 'act1-ch01' },
    });
    expect(preview.find(item => item.id === 'story-cardback-dojo-crest')).toMatchObject({
      granted: false,
      requirement: expect.stringContaining('S등급'),
    });
    expect(preview.filter(item => item.granted).map(item => item.id)).toEqual([
      'story-title-white-belt', 'story-chips-act1-ch01-first', 'story-cg-act1-belt-white',
    ]);
  });

  it('grants daily chips once per KST date with the STORY_DAILY reason', () => {
    expect(service.grantDailyChips(HERO, '2026-09-03', T0)).toBe(100);
    expect(service.grantDailyChips(HERO, '2026-09-03', T0 + 5_000)).toBe(0);
    expect(balance()).toBe(1_100);
    expect(ledger()).toEqual([{
      reason: 'STORY_DAILY',
      delta: 100,
      ref_id: '2026-09-03',
      idempotency_key: 'story-daily:10:2026-09-03:10:story-hero',
    }]);
    expect(service.grantDailyChips(HERO, '2026-09-04', T0 + 86_400_000)).toBe(100);
    expect(balance()).toBe(1_200);
    expect(() => service.grantDailyChips(HERO, '2026-9-4', T0)).toThrow();
  });

  it('rolls the receipts back when the chip ledger cannot be written', () => {
    insertProfile('no-wallet');
    stories.recordCompletion('no-wallet', 'act1-ch01', 'A', T0);
    expect(() => service.reconcile('no-wallet', T0)).toThrow();
    expect(database.db.prepare(
      'SELECT COUNT(*) AS count FROM story_rewards WHERE profile_id = ?',
    ).get('no-wallet')).toEqual({ count: 0 });
    expect(inventoryIds('no-wallet')).toEqual([]);
    expect(ledger('no-wallet')).toEqual([]);
  });

  it('formats receipt source keys per trigger kind', () => {
    expect(storyRewardSourceKey({ kind: 'chapter-first-clear', chapterId: 'act1-ch02' })).toBe('story-chapter:act1-ch02:first');
    expect(storyRewardSourceKey({ kind: 'chapter-grade', chapterId: 'act1-ch02', grade: 'S' })).toBe('story-chapter:act1-ch02:grade-S');
    expect(storyRewardSourceKey({ kind: 'act-complete', act: 1 })).toBe('story-act:1');
    expect(storyRewardSourceKey({ kind: 'flag', key: 'badge:empty-note', label: '복습 노트 비우기' })).toBe('story-flag:badge:empty-note');
  });

  function insertProfile(profileId: string): void {
    database.db.prepare(`
      INSERT INTO profiles (
        id, credential_hash, credential_lookup, recovery_hash, recovery_lookup,
        alias, avatar_id, adult_confirmed_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, 'sakura', 1, 1, 1)
    `).run(
      profileId,
      `credential-hash:${profileId}`,
      `credential-lookup:${profileId}`,
      `recovery-hash:${profileId}`,
      `recovery-lookup:${profileId}`,
      `alias:${profileId}`,
    );
  }

  function seedProfile(profileId: string, walletBalance: number): void {
    insertProfile(profileId);
    database.db.prepare(`
      INSERT INTO wallets (profile_id, balance, updated_at) VALUES (?, ?, 1)
    `).run(profileId, walletBalance);
  }
});
