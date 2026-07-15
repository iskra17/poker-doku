import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChatMessage, Player, RoomConfig } from '../lib/poker/types';
import { RoomManager } from './room-manager';

function makeConfig(): RoomConfig {
  return {
    name: '수명주기 테스트 방',
    smallBlind: 10,
    bigBlind: 20,
    minBuyIn: 800,
    maxBuyIn: 4000,
    maxPlayers: 6,
    turnTime: 8,
    gameMode: 'cash',
    botCount: 0,
    tableType: 'humans',
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

describe('RoomManager 메모리 수명주기', () => {
  let manager: RoomManager;

  beforeEach(() => {
    vi.useFakeTimers();
    manager = new RoomManager(() => {}, () => {});
  });

  afterEach(() => {
    manager.shutdown();
    vi.useRealTimers();
  });

  it('플레이어·시스템·봇 메시지를 섞어도 최신 100개만 보존한다', () => {
    const roomId = manager.createRoom(makeConfig());
    const types: ChatMessage['type'][] = ['player', 'system', 'bot'];

    for (let index = 0; index < 150; index++) {
      manager.addChatMessage(
        roomId,
        `sender-${index}`,
        `발신자-${index}`,
        `메시지-${index}`,
        types[index % types.length],
      );
    }

    const history = manager.getChatHistory(roomId);
    expect(history).toHaveLength(100);
    expect(history[0].message).toBe('메시지-50');
    expect(history.at(-1)?.message).toBe('메시지-149');
    expect(new Set(history.map(message => message.type))).toEqual(new Set(types));
  });

  it('채팅 기록 조회 결과를 바꿔도 내부 배열은 변하지 않는다', () => {
    const roomId = manager.createRoom(makeConfig());
    manager.addChatMessage(roomId, 'p1', '한 명', '원본');
    const exposed = manager.getChatHistory(roomId);

    exposed.length = 0;

    expect(manager.getChatHistory(roomId).map(message => message.message)).toEqual(['원본']);
  });

  it('영속 방의 마지막 휴먼이 떠나면 채팅과 게임 카운터를 새 방처럼 초기화한다', () => {
    const roomId = manager.createRoom(makeConfig(), true);
    manager.joinRoom(roomId, makeHuman('p1'));
    manager.addChatMessage(roomId, 'p1', '휴먼-p1', '남으면 안 되는 메시지');
    const before = manager.getRoom(roomId)!.engine.state;
    before.handNumber = 14;
    before.actionSeq = 9;
    before.lastAction = { playerId: 'p1', type: 'raise', amount: 100 };
    before.lastAggressorId = 'p1';

    manager.leaveRoom(roomId, 'p1');

    const reset = manager.getRoom(roomId)!.engine.state;
    expect(reset.players).toEqual([]);
    expect(manager.getChatHistory(roomId)).toEqual([]);
    expect(reset.handNumber).toBe(0);
    expect(reset.actionSeq).toBe(0);
    expect(reset.lastAction).toBeNull();
    expect(reset.lastAggressorId).toBeUndefined();
  });
});
