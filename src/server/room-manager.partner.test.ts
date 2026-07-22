import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { RoomManager } from './room-manager';
import { Player, RoomConfig } from '../lib/poker/types';

/**
 * 파트너 우선 착석(ensurePartnerBot) 계약 —
 * 혼자 연습(bots) 방에서 인연 파트너 캐릭터를 테이블에 보장한다.
 * 빈 좌석이 있으면 추가, 만석이면 봇 하나가 양보, 이미 있으면 no-op,
 * bots 외 구성/핸드 진행 중에는 동작하지 않는다.
 */

function makeConfig(overrides: Partial<RoomConfig> = {}): RoomConfig {
  return {
    name: '파트너 테스트 방',
    smallBlind: 10,
    bigBlind: 20,
    minBuyIn: 800,
    maxBuyIn: 4000,
    maxPlayers: 6,
    turnTime: 8,
    gameMode: 'cash',
    tableType: 'bots',
    botCount: 0,
    ...overrides,
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

function seatedCharacters(manager: RoomManager, roomId: string): string[] {
  return manager.getRoom(roomId)!.engine.state.players
    .filter(p => p.type === 'bot')
    .map(p => p.personalityId || p.avatar || '');
}

describe('ensurePartnerBot — 파트너 우선 착석', () => {
  let manager: RoomManager;

  beforeEach(() => {
    vi.useFakeTimers();
    manager = new RoomManager(() => {}, () => {});
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it('빈 좌석이 있으면 파트너 봇을 추가한다', () => {
    const roomId = manager.createRoom(makeConfig());
    manager.joinRoom(roomId, makeHuman('p1', 0));

    expect(manager.ensurePartnerBot(roomId, 'sakura')).toBe(true);
    expect(seatedCharacters(manager, roomId)).toContain('sakura');
  });

  it('이미 파트너가 앉아 있으면 구성을 바꾸지 않는다', () => {
    const roomId = manager.createRoom(makeConfig());
    manager.joinRoom(roomId, makeHuman('p1', 0));
    manager.ensurePartnerBot(roomId, 'sakura');
    const before = manager.getRoom(roomId)!.engine.state.players.length;

    expect(manager.ensurePartnerBot(roomId, 'sakura')).toBe(true);
    expect(manager.getRoom(roomId)!.engine.state.players.length).toBe(before);
    expect(seatedCharacters(manager, roomId).filter(id => id === 'sakura')).toHaveLength(1);
  });

  it('만석이면 봇 하나가 자리를 양보한다 (총원 유지)', () => {
    const roomId = manager.createRoom(makeConfig({ botCount: 5 }));
    const room = manager.getRoom(roomId)!;
    manager.joinRoom(roomId, makeHuman('p1', 0));
    // botCount만큼 즉시 충원되지 않았다면 테스트 셋업으로 직접 채움
    while (room.engine.state.players.length < 6) {
      manager.ensurePartnerBot(roomId, 'nonexistent'); // no-op (미지 캐릭터)
      break;
    }
    // 남은 좌석을 파트너 아닌 봇으로 채우기 위해 mixed 캐릭터를 순차 보장
    for (const filler of ['hana', 'chloe', 'vivian', 'elena', 'ara']) {
      if (room.engine.state.players.length >= 6) break;
      manager.ensurePartnerBot(roomId, filler);
    }
    expect(room.engine.state.players.length).toBe(6);
    expect(seatedCharacters(manager, roomId)).not.toContain('sakura');

    expect(manager.ensurePartnerBot(roomId, 'sakura')).toBe(true);
    expect(room.engine.state.players.length).toBe(6);
    expect(seatedCharacters(manager, roomId)).toContain('sakura');
    // 휴먼 좌석은 그대로
    expect(room.engine.state.players.some(p => p.id === 'p1')).toBe(true);
  });

  it('bots 외 구성과 미지 캐릭터는 거절한다', () => {
    const mixedId = manager.createRoom(makeConfig({ tableType: 'mixed' }));
    expect(manager.ensurePartnerBot(mixedId, 'sakura')).toBe(false);

    const botsId = manager.createRoom(makeConfig());
    manager.joinRoom(botsId, makeHuman('p1', 0));
    expect(manager.ensurePartnerBot(botsId, 'dealer')).toBe(false);
    expect(manager.ensurePartnerBot(botsId, 'unknown-character')).toBe(false);
  });
});
