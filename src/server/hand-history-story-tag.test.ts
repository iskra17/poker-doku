import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { CompletedHandRecord } from '@/lib/poker/hand-history';
import { cards } from '@/lib/poker/test-helpers';
import { HandHistoryRepository, HandHistoryService } from './hand-history';
import { openPokerDatabase, type PokerDatabase } from './persistence/database';

/**
 * 스토리 프리셋 핸드 태그(v30 `hand_history.story_tag`) 회귀:
 * - game_mode는 'cash'를 유지한다 — CHECK IN('cash','sng','mtt')라 'story-practice'는
 *   INSERT가 거부되고, 기록 실패는 삼켜지므로 히스토리가 조용히 사라진다.
 * - 목록/상세 조회가 태그를 노출해 클라 라벨('연습'/'대결') 판정의 소스가 된다.
 * - 태그를 주지 않은 일반 핸드는 null (기존 호출부 무변경).
 */

const NOW = Date.parse('2026-09-02T21:00:00+09:00');
const HERO_ID = 'story-hero-profile';

describe('hand history story_tag', () => {
  let database: PokerDatabase;
  let repository: HandHistoryRepository;

  beforeEach(() => {
    database = openPokerDatabase(':memory:');
    repository = new HandHistoryRepository(database);
    insertProfile(database, HERO_ID);
  });

  afterEach(() => {
    database.close();
  });

  it('stores and returns the tag while keeping game_mode cash', () => {
    const service = new HandHistoryService(repository, { now: () => NOW });

    service.recordCompletedHand({
      roomId: 'story-room',
      roomName: '수련 · 1장',
      gameMode: 'cash',
      record: makeRecord(1),
      storyTag: 'practice',
    });

    const [summary] = repository.listByProfile(HERO_ID, 10);
    expect(summary.storyTag).toBe('practice');
    expect(summary.gameMode).toBe('cash');

    const detail = repository.getDetail(summary.id, HERO_ID);
    expect(detail?.storyTag).toBe('practice');
    expect(detail?.gameMode).toBe('cash');
    expect(
      database.db
        .prepare('SELECT game_mode, story_tag FROM hand_history WHERE id = ?')
        .get(summary.id),
    ).toEqual({ game_mode: 'cash', story_tag: 'practice' });
  });

  it('tags sparring hands and leaves ordinary hands null', () => {
    const service = new HandHistoryService(repository, { now: () => NOW });

    service.recordCompletedHand({
      roomId: 'story-room',
      roomName: '수련 · 대결',
      gameMode: 'cash',
      record: makeRecord(1),
      storyTag: 'sparring',
    });
    service.recordCompletedHand({
      roomId: 'cash-room',
      roomName: '벚꽃 테이블',
      gameMode: 'cash',
      record: makeRecord(2),
    });

    const summaries = repository.listByProfile(HERO_ID, 10);
    expect(summaries.map(row => row.storyTag)).toEqual([null, 'sparring']);
    expect(repository.getDetail(summaries[0].id, HERO_ID)?.storyTag).toBeNull();
  });

  it('rejects a tag outside the CHECK list', () => {
    expect(() => repository.insert({
      profileId: HERO_ID,
      roomId: 'story-room',
      roomName: '수련 · 1장',
      gameMode: 'cash',
      handNumber: 1,
      bigBlind: 20,
      profit: 0,
      heroCards: cards('As Kd'),
      board: [],
      detail: {
        ...makeRecord(1),
        heroId: HERO_ID,
        roomName: '수련 · 1장',
        gameMode: 'cash',
        playedAt: NOW,
      },
      playedAt: NOW,
      storyTag: 'story-practice' as 'practice',
    })).toThrow();
    expect(repository.countByProfile(HERO_ID)).toBe(0);
  });
});

function makeRecord(handNumber: number): CompletedHandRecord {
  return {
    handNumber,
    smallBlind: 10,
    bigBlind: 20,
    players: [
      {
        id: HERO_ID, name: '히어로', type: 'human', seatIndex: 0, position: 'BTN',
        startingChips: 1000, holeCards: cards('As Kd'), totalContributed: 20,
        won: 50, profit: 30, revealed: false, finalStatus: 'active',
        handRank: null, handDescription: null,
      },
      {
        id: 'bot-miyako', name: '미야코', type: 'bot', seatIndex: 1, position: 'BB',
        startingChips: 1000, holeCards: cards('Qh Qd'), totalContributed: 20,
        won: 0, profit: -20, revealed: false, finalStatus: 'folded',
        handRank: null, handDescription: null,
      },
    ],
    actions: [
      { street: 'preflop', playerId: HERO_ID, kind: 'post-sb', amount: 10 },
      { street: 'preflop', playerId: 'bot-miyako', kind: 'post-bb', amount: 20 },
      { street: 'preflop', playerId: HERO_ID, kind: 'raise', amount: 20 },
      { street: 'preflop', playerId: 'bot-miyako', kind: 'fold', amount: 0 },
    ],
    board: [],
    winners: [{
      playerId: HERO_ID, amount: 50, handRank: null, handDescription: null, potIndex: 0,
    }],
    potTotal: 40,
    rake: 0,
    showdown: false,
  };
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
