import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChatMessage, Player, RoomConfig } from '../lib/poker/types';
import type { RoomEconomyHooks } from './economy-runtime';
import { eventLog } from './event-log';
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

function makeWalletConfig(): RoomConfig {
  return { ...makeConfig(), economyMode: 'wallet' };
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

  it('disposeRoom은 방별 상태와 모든 예약 타이머를 지우며 반복 호출에도 안전하다', () => {
    const disposed: Array<{ roomId: string; playerIds: string[]; reason: string }> = [];
    manager.shutdown();
    manager = new RoomManager(
      () => {},
      () => {},
      undefined,
      {
        onRoomDisposed: (roomId, playerIds, reason) => {
          disposed.push({ roomId, playerIds, reason });
        },
      },
    );
    const roomId = manager.createRoom(makeConfig());
    manager.joinRoom(roomId, makeHuman('p1', 0));
    manager.joinRoom(roomId, makeHuman('p2', 1));
    manager.sitOutAndLeave(roomId, 'p1');
    manager.addChatMessage(roomId, 'p2', '휴먼-p2', '정리될 채팅');
    expect(manager.getRuntimeStats()).toMatchObject({
      rooms: 1,
      chatRooms: 1,
      pendingStartTimers: 1,
      sitOutTimers: 1,
    });

    expect(manager.disposeRoom(roomId)).toBe(true);
    expect(manager.disposeRoom(roomId)).toBe(false);

    expect(manager.getRoom(roomId)).toBeUndefined();
    expect(manager.getChatHistory(roomId)).toEqual([]);
    expect(manager.getRuntimeStats()).toEqual({
      rooms: 0,
      chatRooms: 0,
      botTimers: 0,
      pendingStartTimers: 0,
      turnTimers: 0,
      sitOutTimers: 0,
      finishedRoomTimers: 0,
      deadlines: 0,
      epochs: 0,
      tournamentClocks: 0,
    });
    expect(disposed).toEqual([{ roomId, playerIds: ['p1', 'p2'], reason: 'manual' }]);
  });

  it('종료 SnG 보존 타이머는 한 번만 예약되고 만료 시 방을 dispose한다', () => {
    manager.shutdown();
    manager = new RoomManager(() => {}, () => {}, undefined, { sngRetentionMs: 50 });
    const roomId = manager.createRoom({
      ...makeConfig(),
      name: '종료 SnG',
      gameMode: 'sng',
      startingStack: 1500,
      minBuyIn: 1500,
      maxBuyIn: 1500,
      tableType: 'mixed',
    });
    const tournament = manager.getRoom(roomId)!.engine.state.tournament!;
    tournament.finished = true;

    expect(manager.retainFinishedTournament(roomId)).toBe(true);
    expect(manager.retainFinishedTournament(roomId)).toBe(true);
    expect(manager.getRuntimeStats().finishedRoomTimers).toBe(1);
    vi.advanceTimersByTime(51);

    expect(manager.getRoom(roomId)).toBeUndefined();
    expect(manager.getRuntimeStats().finishedRoomTimers).toBe(0);
  });
});

describe('RoomManager wallet cash persistence hooks', () => {
  let manager: RoomManager;

  afterEach(() => {
    manager.shutdown();
    vi.useRealTimers();
  });

  function hooks(overrides: Partial<RoomEconomyHooks> = {}): RoomEconomyHooks {
    return {
      beforeHand: vi.fn(),
      afterHand: vi.fn(() => ({ paidTotal: 0, rake: 0 })),
      settleExit: vi.fn(),
      voidRoom: vi.fn(),
      ...overrides,
    };
  }

  it('does not deal or mutate a hand when its pre-hand checkpoint fails', () => {
    vi.useFakeTimers();
    const economy = hooks({
      beforeHand: vi.fn(() => { throw new Error('database unavailable'); }),
    });
    manager = new RoomManager(() => {}, () => {}, undefined, { economy });
    const roomId = manager.createRoom(makeWalletConfig());
    manager.joinRoom(roomId, makeHuman('p1', 0));
    manager.joinRoom(roomId, makeHuman('p2', 1));

    vi.advanceTimersByTime(2_001);

    const state = manager.getRoom(roomId)!.engine.state;
    expect(economy.beforeHand).toHaveBeenCalledOnce();
    expect(state.handNumber).toBe(0);
    expect(state.isHandInProgress).toBe(false);
    expect(state.players.every(player => player.holeCards.length === 0)).toBe(true);
    expect(manager.getChatHistory(roomId).at(-1)?.message)
      .toBe('저장 연결을 확인 중이에요');
  });

  it('persists a completed hand before settling a player who left during it', () => {
    vi.useFakeTimers();
    const order: string[] = [];
    const economy = hooks({
      beforeHand: vi.fn(),
      afterHand: vi.fn(() => {
        order.push('after-hand');
        return { paidTotal: 3_980, rake: 20 };
      }),
      settleExit: vi.fn((_roomId, player) => {
        order.push(`exit:${player.id}`);
      }),
    });
    manager = new RoomManager(() => {}, () => {}, undefined, { economy });
    const roomId = manager.createRoom(makeWalletConfig());
    manager.joinRoom(roomId, makeHuman('p1', 0));
    manager.joinRoom(roomId, makeHuman('p2', 1));
    vi.advanceTimersByTime(2_001);
    const room = manager.getRoom(roomId)!;
    const leaver = room.engine.state.players[room.engine.state.activePlayerIndex];

    manager.leaveRoom(roomId, leaver.id);

    expect(order).toEqual(['after-hand', `exit:${leaver.id}`]);
    expect(economy.afterHand).toHaveBeenCalledOnce();
    expect(economy.settleExit).toHaveBeenCalledOnce();
    expect(room.engine.state.isHandInProgress).toBe(false);
  });

  it('preserves escrow on disconnect and settles between-hands exits and room disposal once', () => {
    vi.useFakeTimers();
    const economy = hooks();
    manager = new RoomManager(() => {}, () => {}, undefined, { economy });
    const exitRoom = manager.createRoom(makeWalletConfig());
    manager.joinRoom(exitRoom, makeHuman('p1'));

    manager.handleDisconnect(exitRoom, 'p1');
    expect(economy.settleExit).not.toHaveBeenCalled();
    manager.handleReconnect(exitRoom, 'p1');
    manager.leaveRoom(exitRoom, 'p1');
    expect(economy.settleExit).toHaveBeenCalledOnce();

    const disposedRoom = manager.createRoom(makeWalletConfig());
    manager.joinRoom(disposedRoom, makeHuman('p2'));
    expect(manager.disposeRoom(disposedRoom)).toBe(true);
    expect(manager.disposeRoom(disposedRoom)).toBe(false);
    expect(vi.mocked(economy.voidRoom).mock.calls)
      .toEqual([[exitRoom], [disposedRoom]]);
  });

  it('keeps the completed snapshot and blocks the next hand when post-hand persistence fails', () => {
    vi.useFakeTimers();
    const economy = hooks({
      afterHand: vi.fn(() => { throw new Error('write failed'); }),
    });
    manager = new RoomManager(() => {}, () => {}, undefined, { economy });
    const roomId = manager.createRoom(makeWalletConfig());
    manager.joinRoom(roomId, makeHuman('p1', 0));
    manager.joinRoom(roomId, makeHuman('p2', 1));
    vi.advanceTimersByTime(2_001);
    const room = manager.getRoom(roomId)!;
    const leaver = room.engine.state.players[room.engine.state.activePlayerIndex];

    manager.leaveRoom(roomId, leaver.id);
    const completedState = room.engine.getPublicState();
    vi.advanceTimersByTime(20_000);

    expect(economy.afterHand).toHaveBeenCalledOnce();
    expect(room.engine.getPublicState()).toEqual(completedState);
    expect(room.engine.state.handNumber).toBe(1);
    expect(room.engine.state.isHandInProgress).toBe(false);
    expect(eventLog.recent({ roomId, type: 'hand-end', limit: 1 })[0]?.data)
      .toMatchObject({
        rake: expect.any(Number),
        paidTotal: expect.any(Number),
        settlementOk: false,
      });
  });

  it('refuses to dispose an active wallet hand before its persisted settlement', () => {
    vi.useFakeTimers();
    const economy = hooks();
    manager = new RoomManager(() => {}, () => {}, undefined, { economy });
    const roomId = manager.createRoom(makeWalletConfig());
    manager.joinRoom(roomId, makeHuman('p1', 0));
    manager.joinRoom(roomId, makeHuman('p2', 1));
    vi.advanceTimersByTime(2_001);

    expect(manager.getRoom(roomId)!.engine.state.isHandInProgress).toBe(true);
    expect(manager.disposeRoom(roomId)).toBe(false);
    expect(manager.getRoom(roomId)).toBeDefined();
    expect(economy.voidRoom).not.toHaveBeenCalled();
  });
});
