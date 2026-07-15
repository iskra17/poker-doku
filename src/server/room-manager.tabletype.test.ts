import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { RoomManager } from './room-manager';
import { Player, RoomConfig, TableType } from '../lib/poker/types';

/**
 * 테이블 인원 구성(tableType) 계약 —
 * bots(봇 전용)는 휴먼 1명만 착석 가능하고, 로비 목록에 구성이 노출된다.
 */

function makeConfig(tableType?: TableType, botCount?: number): RoomConfig {
  return {
    name: '구성 테스트 방',
    smallBlind: 10,
    bigBlind: 20,
    minBuyIn: 800,
    maxBuyIn: 4000,
    maxPlayers: 6,
    turnTime: 8,
    gameMode: 'cash',
    tableType,
    botCount: botCount ?? 0, // 기본 0 — 봇 충원/핸드 시작 없이 정적 검증
  };
}

function makeHuman(id: string, seatIndex = 0): Player {
  return {
    id,
    name: `휴먼-${id}`,
    type: 'human',
    avatar: 'player',
    chips: 2000,
    seatIndex,
    holeCards: [],
    currentBet: 0,
    totalContributed: 0,
    status: 'waiting',
    hasActed: false,
  };
}

describe('tableType — 봇 전용/봇+사람/사람만 구성', () => {
  let manager: RoomManager;

  beforeEach(() => {
    vi.useFakeTimers();
    manager = new RoomManager(() => {}, () => {});
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it('봇 전용(bots) 방은 두 번째 휴먼의 착석을 거절한다', () => {
    const roomId = manager.createRoom(makeConfig('bots'));
    expect(manager.joinRoom(roomId, makeHuman('p1', 0))).toBe(true);
    expect(manager.joinRoom(roomId, makeHuman('p2', 1))).toBe(false);
    // 방에는 여전히 p1만 앉아 있다
    const humans = manager.getRoom(roomId)!.engine.state.players.filter(p => p.type === 'human');
    expect(humans.map(p => p.id)).toEqual(['p1']);
  });

  it('혼합(mixed) 방은 여러 휴먼이 앉을 수 있다', () => {
    const roomId = manager.createRoom(makeConfig('mixed'));
    expect(manager.joinRoom(roomId, makeHuman('p1', 0))).toBe(true);
    expect(manager.joinRoom(roomId, makeHuman('p2', 1))).toBe(true);
  });

  it('getRoomList가 tableType을 노출한다 (명시 설정 + 구방 botCount 유도)', () => {
    const botsId = manager.createRoom(makeConfig('bots'));
    const humansDerivedId = manager.createRoom(makeConfig(undefined, 0)); // 구방: botCount 0 → humans
    const mixedDerivedId = manager.createRoom(makeConfig(undefined, 2)); // 구방: botCount 2 → mixed

    const list = manager.getRoomList();
    expect(list.find(r => r.id === botsId)?.tableType).toBe('bots');
    expect(list.find(r => r.id === humansDerivedId)?.tableType).toBe('humans');
    expect(list.find(r => r.id === mixedDerivedId)?.tableType).toBe('mixed');
  });
});
