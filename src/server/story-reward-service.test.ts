import { STORY_REWARD_CATALOG } from '@/lib/story/rewards/catalog';
import { STORY_CHAPTERS } from '@/lib/story/chapters';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { makeChapterChain } from '@/lib/story/test-fixtures';
import { PERFECT_SET_FLAG } from '@/lib/story/unlocks';
import { EconomyRepository } from './economy-repository';
import { EconomyService } from './economy-service';
import { openPokerDatabase, type PokerDatabase } from './persistence/database';
import { ProgressionPersistenceError, ProgressionRepository } from './progression-repository';
import { ProgressionService } from './progression-service';
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

  it('3막 첫/S 보상과 갈색 펠트는 DB·인벤토리·장착 뷰에서 멱등이다', () => {
    const economyRepository = new EconomyRepository(database);
    service = new StoryRewardService({ database, storyRepository: stories, rewardRepository: new StoryRewardRepository(database), economyRepository,
      economyService: new EconomyService(economyRepository, () => T0), chapters: STORY_CHAPTERS });
    stories.recordCompletion(HERO, 'act3-ch08', 'A', T0);
    expect(service.reconcile(HERO, T0)).toMatchObject({ chips: 500, granted: [{ id: 'story-title-bluff-catcher' }] });
    expect(service.reconcile(HERO, T0 + 1)).toEqual({ chips: 0, granted: [] });
    stories.recordCompletion(HERO, 'act3-ch08', 'S', T0 + 2);
    expect(service.reconcile(HERO, T0 + 2)).toEqual({ chips: 300, granted: [] });
    stories.recordCompletion(HERO, 'act3-ch09', 'S', T0 + 3);
    const ch9 = service.reconcile(HERO, T0 + 3);
    expect(ch9.chips).toBe(800);
    expect(ch9.granted.map(item => item.id)).toEqual(['story-title-shadow-reader', 'story-cg-act3-luna-analysis', 'story-cg-act3-elena-snow']);
    expect(inventoryIds()).not.toContain('story-felt-brown-belt');
    stories.recordCompletion(HERO, 'act3-ch07', 'A', T0 + 4);
    const act3 = service.reconcile(HERO, T0 + 4);
    expect(act3.chips).toBe(1500);
    expect(inventoryIds()).toContain('story-felt-brown-belt');
    database.db.prepare(`INSERT INTO profile_cosmetics(profile_id, slot, item_id, updated_at) VALUES (?, 'felt', 'story-felt-brown-belt', ?)`).run(HERO, T0 + 5);
    expect(database.db.prepare(`SELECT item_id FROM profile_cosmetics WHERE profile_id = ? AND slot = 'felt'`).get(HERO)).toEqual({ item_id: 'story-felt-brown-belt' });
    expect(service.preview(HERO).find(item => item.id === 'story-felt-brown-belt')).toMatchObject({ granted: true, kind: 'felt' });
    expect(service.reconcile(HERO, T0 + 6)).toEqual({ chips: 0, granted: [] });
    expect(ledger().filter(row => row.ref_id === 'story-chips-act3-ch08-first')).toHaveLength(1);
    expect(ledger().filter(row => row.ref_id === 'story-chips-act3-ch08-s')).toHaveLength(1);
  });

  it('previews the whole catalog with granted flags from receipts', () => {
    stories.recordCompletion(HERO, 'act1-ch01', 'A', T0);
    service.reconcile(HERO, T0);
    const preview = service.preview(HERO);
    expect(preview.map(item => item.id)).toHaveLength(STORY_REWARD_CATALOG.length);
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

/**
 * 보너스 CG(v39) — 레벨 트리거 reconcile.
 * 자격 입력은 progression 스냅샷(도장 레벨·인연 레벨)이며 같은 트랜잭션 안에서 읽는다.
 * 리포지토리를 주입하지 않거나 progression 프로필이 없으면 레벨 0 = 미지급.
 */
describe('StoryRewardService — 보너스 CG 레벨 트리거', () => {
  let database: PokerDatabase;
  let progressionRepository: ProgressionRepository;

  function makeService(
    withLevels: boolean,
    override?: Pick<ProgressionRepository, 'getSnapshotInTransaction'>,
  ): StoryRewardService {
    const economyRepository = new EconomyRepository(database);
    return new StoryRewardService({
      database,
      storyRepository: new StoryRepository(database),
      rewardRepository: new StoryRewardRepository(database),
      economyRepository,
      economyService: new EconomyService(economyRepository, () => T0),
      ...(withLevels ? { progressionRepository: override ?? progressionRepository } : {}),
      chapters: CHAPTERS,
    });
  }

  function bonusIds(result: { granted: Array<{ id: string }> }): string[] {
    return result.granted.map(item => item.id).filter(id => id.startsWith('story-bonus-cg-'));
  }

  /** progression 행을 만들고 도장·인연 레벨을 원하는 값으로 맞춘다 (스키마 CHECK: 도장 1~50 · 인연 1~20) */
  function setLevels(profileId: string, dojoLevel: number, affinity: Record<string, number> = {}): void {
    new ProgressionService(database, progressionRepository).getSnapshot(profileId, 'sakura', T0);
    database.db.prepare('UPDATE progression_profiles SET dojo_level = ? WHERE profile_id = ?').run(dojoLevel, profileId);
    for (const [characterId, level] of Object.entries(affinity)) {
      database.db.prepare(`
        INSERT INTO character_affinity (profile_id, character_id, level, xp_milli) VALUES (?, ?, ?, 0)
        ON CONFLICT(profile_id, character_id) DO UPDATE SET level = excluded.level
      `).run(profileId, characterId, level);
    }
  }

  beforeEach(() => {
    database = openPokerDatabase(':memory:');
    progressionRepository = new ProgressionRepository(database);
    database.db.prepare(`
      INSERT INTO profiles (
        id, credential_hash, credential_lookup, recovery_hash, recovery_lookup,
        alias, avatar_id, adult_confirmed_at, created_at, updated_at
      ) VALUES (?, 'h', 'l', 'rh', 'rl', 'alias', 'sakura', 1, 1, 1)
    `).run(HERO);
    database.db.prepare('INSERT INTO wallets (profile_id, balance, updated_at) VALUES (?, 1000, 1)').run(HERO);
  });

  afterEach(() => {
    database.close();
  });

  it('progression 스냅샷이 없으면 레벨 0 — 보너스 CG를 주지 않는다', () => {
    // 리포지토리 미주입
    expect(bonusIds(makeService(false).reconcile(HERO, T0))).toEqual([]);
    // 주입했지만 progression 프로필이 아직 없다
    expect(bonusIds(makeService(true).reconcile(HERO, T0))).toEqual([]);
  });

  it('프로필 부재가 아닌 스냅샷 오류는 삼키지 않고 그대로 던진다', () => {
    // 손상된 스냅샷까지 레벨 0으로 흡수하면 보너스가 조용히 빠진 채 reconcile이 "성공"으로 끝나
    // 결산의 실패·재시도 경로를 건너뛴다(Astra 구현 검토 P2)
    const broken = {
      getSnapshotInTransaction: () => {
        throw new ProgressionPersistenceError('PROGRESSION_PERSISTENCE_INVALID');
      },
    } as unknown as Pick<ProgressionRepository, 'getSnapshotInTransaction'>;
    const service = makeService(true, broken);
    new StoryRepository(database).setFlags(HERO, { [PERFECT_SET_FLAG]: '1' }, T0);

    expect(() => service.reconcile(HERO, T0)).toThrow(ProgressionPersistenceError);
    // 롤백 — 같은 트랜잭션의 기존 보상도 남지 않는다
    expect(database.db.prepare('SELECT COUNT(*) AS count FROM story_rewards WHERE profile_id = ?').get(HERO))
      .toEqual({ count: 0 });

    // progression 프로필만 없는 경우는 기존대로 레벨 0 — 보너스만 빠지고 나머지는 정상 지급된다
    const healthy = makeService(true);
    expect(healthy.reconcile(HERO, T0).granted.map(item => item.id)).toEqual(['story-title-perfect']);
  });

  it('인연 레벨 경계에서만 히로인 CG를 열고, 재실행은 무변경(영수증 1회)', () => {
    const service = makeService(true);
    setLevels(HERO, 1, { sakura: 7 });
    expect(bonusIds(service.reconcile(HERO, T0))).toEqual(['story-bonus-cg-sakura-casual']);

    setLevels(HERO, 1, { sakura: 8 });
    expect(bonusIds(service.reconcile(HERO, T0 + 1))).toEqual(['story-bonus-cg-sakura-sing']);

    // 멱등 — 재실행은 새 지급 없음
    expect(bonusIds(service.reconcile(HERO, T0 + 2))).toEqual([]);
    const receipts = database.db.prepare(`
      SELECT item_id, source_key FROM story_rewards
      WHERE profile_id = ? AND item_id LIKE 'story-bonus-cg-%' ORDER BY item_id
    `).all(HERO) as Array<{ item_id: string; source_key: string }>;
    expect(receipts).toEqual([
      { item_id: 'story-bonus-cg-sakura-casual', source_key: 'story-affinity:sakura:4' },
      { item_id: 'story-bonus-cg-sakura-sing', source_key: 'story-affinity:sakura:8' },
    ]);
    // 인벤토리 마커도 아이템당 1개
    const inventory = database.db.prepare(`
      SELECT item_id, quantity FROM inventory_items
      WHERE profile_id = ? AND item_id LIKE 'story-bonus-cg-%' ORDER BY item_id
    `).all(HERO) as Array<{ item_id: string; quantity: number }>;
    expect(inventory).toEqual([
      { item_id: 'story-bonus-cg-sakura-casual', quantity: 1 },
      { item_id: 'story-bonus-cg-sakura-sing', quantity: 1 },
    ]);
    // 칩 원장은 늘지 않는다 — 보너스 CG는 칩 보상이 아니다
    expect(database.db.prepare('SELECT COUNT(*) AS count FROM chip_ledger WHERE profile_id = ?').get(HERO))
      .toEqual({ count: 0 });
  });

  it('도장 레벨은 비히로인 4명분만 한꺼번에 연다', () => {
    const service = makeService(true);
    setLevels(HERO, 20);
    expect(bonusIds(service.reconcile(HERO, T0)).sort()).toEqual([
      'story-bonus-cg-ingrid-casual', 'story-bonus-cg-ingrid-sing',
      'story-bonus-cg-lin-casual', 'story-bonus-cg-lin-sing',
      'story-bonus-cg-miyako-casual', 'story-bonus-cg-miyako-sing',
      'story-bonus-cg-yuzuki-casual', 'story-bonus-cg-yuzuki-sing',
    ]);
    // 도장 레벨은 히로인 인연 CG를 열지 않는다
    expect(database.db.prepare(`
      SELECT COUNT(*) AS count FROM story_rewards
      WHERE profile_id = ? AND item_id LIKE 'story-bonus-cg-sakura-%'
    `).get(HERO)).toEqual({ count: 0 });
    // character_id가 NULL이어도 v32 인벤토리 sync 트리거는 그대로 마커를 만든다
    expect(database.db.prepare(`
      SELECT COUNT(*) AS count FROM inventory_items
      WHERE profile_id = ? AND item_id LIKE 'story-bonus-cg-%'
    `).get(HERO)).toEqual({ count: 8 });
    expect(bonusIds(service.reconcile(HERO, T0 + 1))).toEqual([]);
  });
});
