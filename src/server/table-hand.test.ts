import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { CompletedHandRecord } from '@/lib/poker/hand-history';
import { cards } from '@/lib/poker/test-helpers';
import {
  HandHistoryRepository,
  HandHistoryService,
  TableHandRepository,
} from './hand-history';
import { openPokerDatabase, type PokerDatabase } from './persistence/database';

/**
 * 테이블 정본 핸드 기록(v23 table_hand) 회귀:
 * - 전역 핸드 ID가 정본에 부여되고 개인(히어로 관점) 기록이 그 ID를 링크한다
 * - 정본 detail은 전체 홀카드 원본, 개인 detail은 여전히 마스킹된다
 * - 정본 저장 실패가 개인 기록을 막지 않는다
 */

const NOW = Date.parse('2026-07-21T21:00:00+09:00');
const HERO_ID = 'hero-profile';

function makeRecord(handNumber: number): CompletedHandRecord {
  return {
    handNumber,
    smallBlind: 10,
    bigBlind: 20,
    players: [
      {
        id: HERO_ID, name: '히어로', type: 'human', seatIndex: 0, position: 'BTN',
        startingChips: 1000, holeCards: cards('As Kd'), totalContributed: 0,
        won: 0, profit: 0, revealed: false, finalStatus: 'folded',
        handRank: null, handDescription: null,
      },
      {
        id: 'bot-sakura', name: '사쿠라', type: 'bot', seatIndex: 1, position: 'SB',
        startingChips: 1000, holeCards: cards('Qh Qd'), totalContributed: 10,
        won: 30, profit: 20, revealed: false, finalStatus: 'active',
        handRank: null, handDescription: null,
      },
      {
        id: 'bot-hana', name: '하나', type: 'bot', seatIndex: 2, position: 'BB',
        startingChips: 1000, holeCards: cards('2c 7d'), totalContributed: 20,
        won: 0, profit: -20, revealed: false, finalStatus: 'folded',
        handRank: null, handDescription: null,
      },
    ],
    actions: [
      { street: 'preflop', playerId: 'bot-sakura', kind: 'post-sb', amount: 10 },
      { street: 'preflop', playerId: 'bot-hana', kind: 'post-bb', amount: 20 },
      { street: 'preflop', playerId: HERO_ID, kind: 'fold', amount: 0 },
      { street: 'preflop', playerId: 'bot-hana', kind: 'fold', amount: 0 },
    ],
    board: [],
    winners: [{
      playerId: 'bot-sakura', amount: 30, handRank: null, handDescription: null, potIndex: 0,
    }],
    potTotal: 30,
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
  `).run(id, `hash-${id}`, `lookup-${id}`, `recovery-${id}`, `recovery-lookup-${id}`, `테스터-${id}`);
}

describe('TableHandRepository', () => {
  let database: PokerDatabase;
  let tableHands: TableHandRepository;

  beforeEach(() => {
    database = openPokerDatabase(':memory:');
    tableHands = new TableHandRepository(database);
  });

  afterEach(() => {
    database.close();
  });

  it('정본 기록에 전역 핸드 ID를 부여하고 목록/상세를 조회한다', () => {
    const first = tableHands.insert({
      roomId: 'room-1', roomName: '테스트 방', gameMode: 'cash',
      record: makeRecord(1), playedAt: NOW,
    });
    const second = tableHands.insert({
      roomId: 'room-1', roomName: '테스트 방', gameMode: 'cash',
      record: makeRecord(2), playedAt: NOW + 1000,
    });
    expect(second).toBeGreaterThan(first);

    const list = tableHands.list({ roomId: 'room-1' });
    expect(list).toHaveLength(2);
    expect(list[0].id).toBe(second); // 최신순
    expect(list[0].potTotal).toBe(30);
    expect(list[0].playerCount).toBe(3);
    expect(list[0].humanCount).toBe(1);
    expect(list[0].winners).toEqual([
      { playerId: 'bot-sakura', name: '사쿠라', amount: 30 },
    ]);

    // 상세는 마스킹 전 원본 — 폴드한 좌석의 홀카드도 그대로 (운영 전용 계약)
    const detail = tableHands.getDetail(first);
    expect(detail).not.toBeNull();
    expect(detail!.roomId).toBe('room-1');
    expect(detail!.players[0].holeCards).toEqual(cards('As Kd'));
    expect(detail!.players[2].holeCards).toEqual(cards('2c 7d'));
  });

  it('방 필터·커서 페이지네이션이 동작한다', () => {
    for (let i = 1; i <= 5; i++) {
      tableHands.insert({
        roomId: i % 2 === 0 ? 'room-even' : 'room-odd',
        roomName: '방', gameMode: 'cash',
        record: makeRecord(i), playedAt: NOW + i,
      });
    }
    const odd = tableHands.list({ roomId: 'room-odd' });
    expect(odd.map(h => h.handNumber)).toEqual([5, 3, 1]);

    const paged = tableHands.list({ roomId: 'room-odd', beforeId: odd[0].id, limit: 1 });
    expect(paged).toHaveLength(1);
    expect(paged[0].handNumber).toBe(3);
  });

  it('보존 상한 초과분을 오래된 것부터 정리한다', () => {
    for (let i = 1; i <= 6; i++) {
      tableHands.insert({
        roomId: 'room-1', roomName: '방', gameMode: 'cash',
        record: makeRecord(i), playedAt: NOW + i,
      });
    }
    tableHands.prune(3);
    const remaining = tableHands.list({});
    expect(remaining.map(h => h.handNumber)).toEqual([6, 5, 4]);
    expect(tableHands.count()).toBe(3);
  });

  it('statsSince가 기간 내 핸드 수·레이크·팟 합계를 집계한다', () => {
    tableHands.insert({
      roomId: 'room-1', roomName: '방', gameMode: 'cash',
      record: { ...makeRecord(1), rake: 5 }, playedAt: NOW - 10_000,
    });
    tableHands.insert({
      roomId: 'room-1', roomName: '방', gameMode: 'cash',
      record: { ...makeRecord(2), rake: 7 }, playedAt: NOW,
    });
    expect(tableHands.statsSince(NOW - 1_000)).toEqual({
      hands: 1, rake: 7, potTotal: 30,
    });
    expect(tableHands.statsSince(NOW - 60_000)).toEqual({
      hands: 2, rake: 12, potTotal: 60,
    });
  });
});

describe('HandHistoryService + 정본 통합', () => {
  let database: PokerDatabase;

  beforeEach(() => {
    database = openPokerDatabase(':memory:');
    insertProfile(database, HERO_ID);
  });

  afterEach(() => {
    database.close();
  });

  it('정본을 먼저 기록하고 개인 기록이 전역 핸드 ID를 링크한다', () => {
    const repository = new HandHistoryRepository(database);
    const tableHands = new TableHandRepository(database);
    const service = new HandHistoryService(repository, {
      now: () => NOW,
      tableHands,
    });
    service.recordCompletedHand({
      roomId: 'room-1', roomName: '테스트 방', gameMode: 'cash',
      record: makeRecord(1),
    });

    const canonical = tableHands.list({});
    expect(canonical).toHaveLength(1);

    const summaries = repository.listByProfile(HERO_ID, 10);
    expect(summaries).toHaveLength(1);
    const detail = repository.getDetail(summaries[0].id, HERO_ID);
    expect(detail!.tableHandId).toBe(canonical[0].id);
    // 개인 기록은 여전히 마스킹 — 비공개 상대 홀카드는 null
    expect(detail!.players[1].holeCards).toBeNull();

    const row = database.db.prepare(
      'SELECT table_hand_id FROM hand_history WHERE id = ?',
    ).get(summaries[0].id) as { table_hand_id: number | null };
    expect(row.table_hand_id).toBe(canonical[0].id);
  });

  it('정본 저장 실패에도 개인 기록은 남는다 (tableHandId=null)', () => {
    const repository = new HandHistoryRepository(database);
    const broken = new TableHandRepository(database);
    broken.insert = () => { throw new Error('db down'); };
    const service = new HandHistoryService(repository, {
      now: () => NOW,
      tableHands: broken,
    });
    service.recordCompletedHand({
      roomId: 'room-1', roomName: '테스트 방', gameMode: 'cash',
      record: makeRecord(1),
    });

    const summaries = repository.listByProfile(HERO_ID, 10);
    expect(summaries).toHaveLength(1);
    const detail = repository.getDetail(summaries[0].id, HERO_ID);
    expect(detail!.tableHandId).toBeNull();
  });

  it('휴먼 없는 핸드도 정본에는 남는다 (개인 기록은 없음)', () => {
    const repository = new HandHistoryRepository(database);
    const tableHands = new TableHandRepository(database);
    const service = new HandHistoryService(repository, {
      now: () => NOW,
      tableHands,
    });
    const record = makeRecord(1);
    record.players[0] = { ...record.players[0], id: 'bot-x', name: '봇X', type: 'bot' };
    service.recordCompletedHand({
      roomId: 'room-1', roomName: '테스트 방', gameMode: 'cash',
      record,
    });
    expect(tableHands.count()).toBe(1);
    expect(tableHands.list({})[0].humanCount).toBe(0);
    expect(repository.countByProfile(HERO_ID)).toBe(0);
  });
});
