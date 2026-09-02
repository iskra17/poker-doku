import type { PokerDatabase } from './persistence/database';
import { StoryPersistenceError } from './story-repository';

/**
 * 수련 스토리 보상 영수증 영속 (마이그레이션 v32 `story_rewards`).
 *
 * 계약:
 * - 행 = (profile, item) 1회 지급 캡. 자격 판정은 여기 없다 — `StoryRewardService.reconcile`이
 *   durable 상태(story_progress·story_flags)에서 `listStoryRewardsDue`로 계산해 누락분만 넣는다.
 * - 칩 외 보상의 인벤토리 마커는 DB 트리거(`sync_story_reward_inventory`)가 같은 문장에서 만든다 —
 *   이 리포지토리는 `inventory_items`를 직접 만지지 않는다. 칩은 chip_ledger가 소유(호출자 몫).
 * - 카탈로그 행은 마이그레이션 시드가 단일 소스(`story_reward_catalog`, TS 사본은 catalog.ts) —
 *   미등록 item_id는 INSERT 전에 'STORY_VALUE_INVALID'로 거절한다.
 * - `grantInTransaction`은 호출자가 연 PokerDatabase 트랜잭션 안에서만 — 지급과 칩 원장이 함께 커밋/롤백돼야 한다.
 */

export interface StoryRewardGrantRow {
  itemId: string;
  sourceKey: string;
  grantedAt: number;
}

export type StoryRewardGrantOutcome = 'granted' | 'duplicate';

const MAX_TIMESTAMP = 253_402_300_799_999;
const ITEM_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;

interface StoryRewardDbRow {
  item_id: unknown;
  source_key: unknown;
  granted_at: unknown;
}

export class StoryRewardRepository {
  readonly #database: PokerDatabase;

  constructor(database: PokerDatabase) {
    this.#database = database;
  }

  /** 지급 영수증 전부 (지급 순) */
  listGranted(profileId: string): StoryRewardGrantRow[] {
    assertProfileId(profileId);
    const rows = this.#database.db.prepare(`
      SELECT item_id, source_key, granted_at
      FROM story_rewards
      WHERE profile_id = ?
      ORDER BY granted_at ASC, item_id ASC
    `).all(profileId) as unknown as StoryRewardDbRow[];
    return rows.map(row => ({
      itemId: String(row.item_id),
      sourceKey: String(row.source_key),
      grantedAt: Number(row.granted_at),
    }));
  }

  listGrantedIds(profileId: string): Set<string> {
    return new Set(this.listGranted(profileId).map(row => row.itemId));
  }

  /**
   * 영수증 1건 — 이미 있으면 'duplicate'(변경 없음). Must be called inside a caller-owned
   * PokerDatabase transaction.
   */
  grantInTransaction(
    profileId: string,
    itemId: string,
    sourceKey: string,
    now: number,
  ): StoryRewardGrantOutcome {
    this.#assertTransaction();
    assertProfileId(profileId);
    assertItemId(itemId);
    assertSourceKey(sourceKey);
    assertTimestamp(now);
    this.#assertProfileExists(profileId);
    this.#assertCatalogItem(itemId);
    try {
      const result = this.#database.db.prepare(`
        INSERT INTO story_rewards (profile_id, item_id, source_key, granted_at)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(profile_id, item_id) DO NOTHING
      `).run(profileId, itemId, sourceKey, now);
      return Number(result.changes) === 1 ? 'granted' : 'duplicate';
    } catch (error) {
      if (error instanceof StoryPersistenceError) throw error;
      throw new StoryPersistenceError('STORY_PERSISTENCE_INVALID');
    }
  }

  #assertCatalogItem(itemId: string): void {
    const row = this.#database.db.prepare(
      'SELECT 1 FROM story_reward_catalog WHERE item_id = ?',
    ).get(itemId);
    if (row === undefined) {
      throw new StoryPersistenceError('STORY_VALUE_INVALID');
    }
  }

  #assertProfileExists(profileId: string): void {
    const row = this.#database.db.prepare(
      'SELECT 1 FROM profiles WHERE id = ?',
    ).get(profileId);
    if (row === undefined) {
      throw new StoryPersistenceError('STORY_PROFILE_NOT_FOUND');
    }
  }

  #assertTransaction(): void {
    try {
      this.#database.assertTransactionActive();
    } catch {
      throw new StoryPersistenceError('STORY_TRANSACTION_REQUIRED');
    }
  }
}

function assertProfileId(value: string): void {
  if (typeof value !== 'string' || value.length < 1 || value.length > 128) {
    throw new StoryPersistenceError('STORY_VALUE_INVALID');
  }
}

function assertItemId(value: string): void {
  if (typeof value !== 'string' || !ITEM_ID_PATTERN.test(value)) {
    throw new StoryPersistenceError('STORY_VALUE_INVALID');
  }
}

function assertSourceKey(value: string): void {
  if (typeof value !== 'string' || value.length < 1 || value.length > 128) {
    throw new StoryPersistenceError('STORY_VALUE_INVALID');
  }
}

function assertTimestamp(value: number): void {
  if (!Number.isSafeInteger(value) || value < 0 || value > MAX_TIMESTAMP) {
    throw new StoryPersistenceError('STORY_TIME_INVALID');
  }
}
