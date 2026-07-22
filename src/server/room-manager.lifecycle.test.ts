import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChatMessage, Player, RoomConfig } from '../lib/poker/types';
import type { RoomEconomyHooks } from './economy-runtime';
import type { RoomProgressionHooks } from './progression-runtime';
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

function makeWalletSngConfig(): RoomConfig {
  return {
    ...makeConfig(),
    name: '지갑 Sit & Go',
    gameMode: 'sng',
    economyMode: 'wallet',
    startingStack: 1_500,
    minBuyIn: 1_500,
    maxBuyIn: 1_500,
    entryBuyIn: 1_500,
    entryFee: 150,
    tableType: 'mixed',
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

function makeBot(id: string, seatIndex = 1): Player {
  return {
    ...makeHuman(id, seatIndex),
    name: `봇-${id}`,
    type: 'bot',
    avatar: 'bot',
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

  it('캐시 유저 방은 마지막 휴먼이 떠나도 보존되고, 재입장이 없으면 10분 뒤 정리된다', () => {
    const roomId = manager.createRoom(makeConfig());
    manager.joinRoom(roomId, makeHuman('p1'));
    manager.leaveRoom(roomId, 'p1');

    // 즉시 삭제되지 않는다 — 초대 링크/재입장 여지 (2026-07-22 QA)
    expect(manager.getRoom(roomId)).toBeDefined();

    // 보존 중 재입장하면 타이머가 취소되어 방이 유지된다
    manager.joinRoom(roomId, makeHuman('p2'));
    vi.advanceTimersByTime(11 * 60_000);
    expect(manager.getRoom(roomId)).toBeDefined();

    // 다시 비면 보존 시간 경과 후 정리된다
    manager.leaveRoom(roomId, 'p2');
    expect(manager.getRoom(roomId)).toBeDefined();
    vi.advanceTimersByTime(10 * 60_000);
    expect(manager.getRoom(roomId)).toBeUndefined();
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
      cancelPreparedHand: vi.fn(() => true),
      afterHand: vi.fn(() => ({ paidTotal: 0, rake: 0 })),
      settleExit: vi.fn(),
      voidRoom: vi.fn(),
      beforeTournament: vi.fn(),
      cancelTournamentStart: vi.fn(() => true),
      afterTournament: vi.fn(),
      cancelWaitingSng: vi.fn(),
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
    expect(manager.disposeRoom(roomId)).toBe(true);
    expect(economy.voidRoom).toHaveBeenCalledOnce();
  });

  it('keeps a partially mutated failed hand blocked without cancelling its checkpoint', () => {
    vi.useFakeTimers();
    const economy = hooks();
    manager = new RoomManager(() => {}, () => {}, undefined, { economy });
    const roomId = manager.createRoom(makeWalletConfig());
    manager.joinRoom(roomId, makeHuman('p1', 0));
    manager.joinRoom(roomId, makeHuman('p2', 1));
    const room = manager.getRoom(roomId)!;
    vi.spyOn(room.engine, 'startHand').mockImplementationOnce(() => {
      room.engine.state.handNumber += 1;
      throw new Error('failed after mutation');
    });

    vi.advanceTimersByTime(2_001);

    expect(economy.cancelPreparedHand).not.toHaveBeenCalled();
    expect(manager.getRuntimeStats().pendingStartTimers).toBe(0);
    manager.resumeRoom(roomId);
    vi.advanceTimersByTime(2_001);
    expect(room.engine.state.handNumber).toBe(1);
    expect(manager.getRuntimeStats().pendingStartTimers).toBe(0);
    expect(manager.disposeRoom(roomId)).toBe(false);
    expect(economy.voidRoom).not.toHaveBeenCalled();
  });

  it('keeps an unchanged failed hand blocked when exact checkpoint cancellation fails', () => {
    vi.useFakeTimers();
    const economy = hooks({
      cancelPreparedHand: vi.fn(() => false),
    });
    manager = new RoomManager(() => {}, () => {}, undefined, { economy });
    const roomId = manager.createRoom(makeWalletConfig());
    manager.joinRoom(roomId, makeHuman('p1', 0));
    manager.joinRoom(roomId, makeHuman('p2', 1));
    const room = manager.getRoom(roomId)!;
    vi.spyOn(room.engine, 'startHand').mockImplementationOnce(() => {
      throw new Error('failed before mutation');
    });

    vi.advanceTimersByTime(2_001);

    expect(economy.cancelPreparedHand).toHaveBeenCalledOnce();
    expect(manager.getRuntimeStats().pendingStartTimers).toBe(0);
    manager.resumeRoom(roomId);
    vi.advanceTimersByTime(2_001);
    expect(room.engine.state.handNumber).toBe(0);
    expect(manager.getRuntimeStats().pendingStartTimers).toBe(0);
    expect(manager.disposeRoom(roomId)).toBe(false);
    expect(economy.voidRoom).not.toHaveBeenCalled();
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
    expect(manager.disposeRoom(roomId)).toBe(false);
    manager.shutdown();
    expect(economy.voidRoom).not.toHaveBeenCalled();
    expect(manager.getRoom(roomId)).toBeDefined();
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

  it('preserves a persistent room when its last human exit completes an unresolved hand', () => {
    vi.useFakeTimers();
    const economy = hooks({
      afterHand: vi.fn(() => { throw new Error('write failed'); }),
    });
    manager = new RoomManager(() => {}, () => {}, undefined, { economy });
    const roomId = manager.createRoom(makeWalletConfig(), true);
    manager.joinRoom(roomId, makeHuman('p1', 0));
    manager.joinRoom(roomId, makeBot('b1', 1));
    vi.advanceTimersByTime(2_001);
    const originalEngine = manager.getRoom(roomId)!.engine;

    manager.leaveRoom(roomId, 'p1');
    const completedSnapshot = originalEngine.getPublicState();
    vi.advanceTimersByTime(20_000);

    expect(economy.afterHand).toHaveBeenCalledOnce();
    expect(economy.voidRoom).not.toHaveBeenCalled();
    expect(manager.getRoom(roomId)?.engine).toBe(originalEngine);
    expect(manager.getRoom(roomId)?.engine.getPublicState()).toEqual(completedSnapshot);
    expect(originalEngine.state.handNumber).toBe(1);
    expect(originalEngine.state.isHandInProgress).toBe(false);
    expect(manager.disposeRoom(roomId)).toBe(false);
  });

  it('still voids and resets a persistent wallet room when no settlement is unresolved', () => {
    vi.useFakeTimers();
    const economy = hooks();
    manager = new RoomManager(() => {}, () => {}, undefined, { economy });
    const roomId = manager.createRoom(makeWalletConfig(), true);
    manager.joinRoom(roomId, makeHuman('p1', 0));
    const originalEngine = manager.getRoom(roomId)!.engine;

    manager.leaveRoom(roomId, 'p1');

    expect(economy.settleExit).toHaveBeenCalledOnce();
    expect(economy.voidRoom).toHaveBeenCalledWith(roomId);
    expect(manager.getRoom(roomId)?.engine).not.toBe(originalEngine);
    expect(manager.getRoom(roomId)?.engine.state.players).toEqual([]);
  });
});

describe('RoomManager progression start recovery', () => {
  let manager: RoomManager;

  afterEach(() => {
    manager.shutdown();
    vi.useRealTimers();
  });

  function progressionHooks(
    overrides: Partial<RoomProgressionHooks> = {},
  ): RoomProgressionHooks {
    return {
      captureHandStart: vi.fn(),
      confirmHandStart: vi.fn(),
      cancelHand: vi.fn(),
      completeHand: vi.fn(),
      completeSng: vi.fn(),
      disposeRoom: vi.fn(),
      ...overrides,
    };
  }

  it('retries a transient pre-hand progression capture failure with one owned timer', () => {
    vi.useFakeTimers();
    const captureHandStart = vi.fn()
      .mockImplementationOnce(() => { throw new Error('progression unavailable'); });
    manager = new RoomManager(() => {}, () => {}, undefined, {
      progression: progressionHooks({ captureHandStart }),
    });
    const roomId = manager.createRoom(makeConfig());
    manager.joinRoom(roomId, makeHuman('p1', 0));
    manager.joinRoom(roomId, makeHuman('p2', 1));

    vi.advanceTimersByTime(2_001);

    expect(captureHandStart).toHaveBeenCalledOnce();
    expect(manager.getRoom(roomId)!.engine.state.handNumber).toBe(0);
    expect(manager.getRuntimeStats().pendingStartTimers).toBe(1);
    vi.advanceTimersByTime(998);
    expect(captureHandStart).toHaveBeenCalledOnce();
    vi.advanceTimersByTime(1);
    expect(captureHandStart).toHaveBeenCalledTimes(2);
    expect(manager.getRoom(roomId)!.engine.state.handNumber).toBe(1);
    expect(manager.getRuntimeStats().pendingStartTimers).toBe(0);
  });

  it('bounds repeated pre-hand failures and allows disposal of the blocked room', () => {
    vi.useFakeTimers();
    const captureHandStart = vi.fn(() => { throw new Error('progression unavailable'); });
    manager = new RoomManager(() => {}, () => {}, undefined, {
      progression: progressionHooks({ captureHandStart }),
    });
    const roomId = manager.createRoom(makeConfig());
    manager.joinRoom(roomId, makeHuman('p1', 0));
    manager.joinRoom(roomId, makeHuman('p2', 1));

    vi.advanceTimersByTime(5_001);

    expect(captureHandStart).toHaveBeenCalledTimes(4);
    expect(manager.getRuntimeStats().pendingStartTimers).toBe(0);
    manager.resumeRoom(roomId);
    vi.advanceTimersByTime(2_001);
    expect(captureHandStart).toHaveBeenCalledTimes(4);
    expect(manager.disposeRoom(roomId)).toBe(true);
  });

  it('cancels a pending progression retry when the room is disposed', () => {
    vi.useFakeTimers();
    const captureHandStart = vi.fn()
      .mockImplementationOnce(() => { throw new Error('progression unavailable'); });
    manager = new RoomManager(() => {}, () => {}, undefined, {
      progression: progressionHooks({ captureHandStart }),
    });
    const roomId = manager.createRoom(makeConfig());
    manager.joinRoom(roomId, makeHuman('p1', 0));
    manager.joinRoom(roomId, makeHuman('p2', 1));
    vi.advanceTimersByTime(2_001);

    expect(manager.getRuntimeStats().pendingStartTimers).toBe(1);
    expect(manager.disposeRoom(roomId)).toBe(true);
    vi.advanceTimersByTime(2_000);
    expect(captureHandStart).toHaveBeenCalledOnce();
    expect(manager.getRuntimeStats().pendingStartTimers).toBe(0);
  });

  it('retries a failed completed-hand delivery and clears its settlement barrier', () => {
    vi.useFakeTimers();
    const completeHand = vi.fn()
      .mockImplementationOnce(() => { throw new Error('delivery unavailable'); });
    manager = new RoomManager(() => {}, () => {}, undefined, {
      progression: progressionHooks({ completeHand }),
    });
    const roomId = manager.createRoom(makeConfig());
    manager.joinRoom(roomId, makeHuman('p1', 0));
    manager.joinRoom(roomId, makeHuman('p2', 1));
    const room = manager.getRoom(roomId)!;
    room.engine.state.handNumber = 1;
    room.engine.state.isHandInProgress = false;

    (manager as unknown as { handleCompletedHand(roomId: string): void })
      .handleCompletedHand(roomId);

    expect(completeHand).toHaveBeenCalledOnce();
    expect(manager.disposeRoom(roomId)).toBe(false);
    vi.advanceTimersByTime(1_000);
    expect(completeHand).toHaveBeenCalledTimes(2);
    expect(manager.disposeRoom(roomId)).toBe(true);
  });
});

describe('RoomManager private room generation identity', () => {
  let manager: RoomManager;

  afterEach(() => {
    manager.shutdown();
    vi.useRealTimers();
  });

  function runId(roomId: string): string {
    return (manager.getRoom(roomId) as unknown as { runId: string }).runId;
  }

  it('retries duplicate factory values and never reuses a disposed room generation', () => {
    const values = ['run-a', 'run-a', 'run-b'];
    const factory = vi.fn(() => values.shift() ?? 'run-c');
    manager = new RoomManager(() => {}, () => {}, undefined, {
      roomRunIdFactory: factory,
    });
    const firstRoomId = manager.createRoom(makeConfig());
    expect(runId(firstRoomId)).toBe('run-a');
    expect(manager.disposeRoom(firstRoomId)).toBe(true);

    const secondRoomId = manager.createRoom(makeConfig());
    expect(runId(secondRoomId)).toBe('run-b');
    expect(factory).toHaveBeenCalledTimes(3);
  });

  it('bounds a constant duplicate factory without replacing an existing room', () => {
    const factory = vi.fn(() => 'run-a');
    manager = new RoomManager(() => {}, () => {}, undefined, {
      roomRunIdFactory: factory,
    });
    const roomId = manager.createRoom(makeConfig());
    const engine = manager.getRoom(roomId)!.engine;

    expect(() => manager.createRoom(makeConfig())).toThrow('room run id');
    expect(factory).toHaveBeenCalledTimes(9);
    expect(manager.getRoom(roomId)!.engine).toBe(engine);
    expect(runId(roomId)).toBe('run-a');
    expect(manager.getRoomCount()).toBe(1);
  });

  it('starts hand one under a new id after duplicate values during persistent reset', () => {
    vi.useFakeTimers();
    const values = ['run-a', 'run-a', 'run-b'];
    const captureHandStart = vi.fn();
    manager = new RoomManager(() => {}, () => {}, undefined, {
      roomRunIdFactory: () => values.shift() ?? 'run-c',
      progression: {
        captureHandStart,
        confirmHandStart: vi.fn(),
        cancelHand: vi.fn(),
        completeHand: vi.fn(),
        completeSng: vi.fn(),
        disposeRoom: vi.fn(),
      },
    });
    const roomId = manager.createRoom(makeConfig(), true);
    manager.joinRoom(roomId, makeHuman('p1', 0));
    manager.joinRoom(roomId, makeHuman('p2', 1));
    vi.advanceTimersByTime(2_001);

    (manager as unknown as { resetRoomToIdle(roomId: string): void })
      .resetRoomToIdle(roomId);
    manager.joinRoom(roomId, makeHuman('p1', 0));
    manager.joinRoom(roomId, makeHuman('p2', 1));
    vi.advanceTimersByTime(2_001);

    expect(captureHandStart.mock.calls.map(call => ({
      runId: call[0].roomRunId,
      handNumber: call[0].handNumber,
    }))).toEqual([
      { runId: 'run-a', handNumber: 1 },
      { runId: 'run-b', handNumber: 1 },
    ]);
  });

  it('leaves the old persistent engine and progression context intact when reservation fails', () => {
    const factory = vi.fn()
      .mockReturnValueOnce('run-a')
      .mockReturnValue('not valid');
    const disposeRoom = vi.fn();
    manager = new RoomManager(() => {}, () => {}, undefined, {
      roomRunIdFactory: factory,
      progression: {
        captureHandStart: vi.fn(),
        confirmHandStart: vi.fn(),
        cancelHand: vi.fn(),
        completeHand: vi.fn(),
        completeSng: vi.fn(),
        disposeRoom,
      },
    });
    const roomId = manager.createRoom(makeConfig(), true);
    const before = manager.getRoom(roomId)!.engine;
    before.state.handNumber = 7;
    manager.addChatMessage(roomId, 'p1', 'p1', 'keep');

    expect(() => (
      manager as unknown as { resetRoomToIdle(roomId: string): void }
    ).resetRoomToIdle(roomId)).toThrow('room run id');

    expect(manager.getRoom(roomId)!.engine).toBe(before);
    expect(runId(roomId)).toBe('run-a');
    expect(manager.getRoom(roomId)!.engine.state.handNumber).toBe(7);
    expect(manager.getChatHistory(roomId).map(message => message.message)).toEqual(['keep']);
    expect(disposeRoom).not.toHaveBeenCalled();
    expect(factory).toHaveBeenCalledTimes(9);
  });
});

describe('RoomManager wallet Sit & Go persistence hooks', () => {
  let manager: RoomManager;

  afterEach(() => {
    manager.shutdown();
    vi.useRealTimers();
  });

  function hooks(overrides: Partial<RoomEconomyHooks> = {}): RoomEconomyHooks {
    return {
      beforeHand: vi.fn(),
      cancelPreparedHand: vi.fn(() => true),
      afterHand: vi.fn(() => ({ paidTotal: 0, rake: 0 })),
      settleExit: vi.fn(),
      voidRoom: vi.fn(),
      beforeTournament: vi.fn(),
      cancelTournamentStart: vi.fn(() => true),
      afterTournament: vi.fn(),
      cancelWaitingSng: vi.fn(),
      ...overrides,
    };
  }

  function seatSix(roomId: string): void {
    for (let index = 0; index < 6; index += 1) {
      manager.joinRoom(roomId, {
        ...makeHuman(`sng-${index + 1}`, index),
        chips: 1_500,
      });
    }
  }

  function progressionHooks(
    overrides: Partial<RoomProgressionHooks> = {},
  ): RoomProgressionHooks {
    return {
      captureHandStart: vi.fn(),
      confirmHandStart: vi.fn(),
      cancelHand: vi.fn(),
      completeHand: vi.fn(),
      completeSng: vi.fn(),
      disposeRoom: vi.fn(),
      ...overrides,
    };
  }

  it('settles and rewards an SnG that finishes from a between-hand leave before announcing', () => {
    vi.useFakeTimers();
    const order: string[] = [];
    const economy = hooks({
      afterTournament: vi.fn(() => { order.push('economy'); }),
    });
    const progression = progressionHooks({
      completeSng: vi.fn(() => { order.push('progression'); }),
    });
    manager = new RoomManager(() => {}, () => {}, undefined, {
      economy,
      progression,
      roomRunIdFactory: () => 'generation-a',
    });
    const roomId = manager.createRoom(makeWalletSngConfig());
    seatSix(roomId);
    vi.advanceTimersByTime(2_001);
    const room = manager.getRoom(roomId)!;
    room.engine.state.isHandInProgress = false;
    for (let index = 2; index < 6; index += 1) {
      const player = room.engine.state.players[index];
      player.chips = 0;
      player.finishPlace = 7 - index;
      room.engine.state.tournament!.results.push({
        playerId: player.id,
        name: player.name,
        place: player.finishPlace,
        prize: 0,
      });
    }

    expect(manager.leaveRoom(roomId, 'sng-2')).toBe(true);

    expect(room.engine.state.tournament).toMatchObject({ finished: true });
    expect(order).toEqual(['economy', 'progression']);
    expect(economy.afterTournament).toHaveBeenCalledOnce();
    expect(progression.completeSng).toHaveBeenCalledOnce();
    expect(progression.completeSng).toHaveBeenCalledWith(expect.objectContaining({
      roomId,
      roomRunId: 'generation-a',
      results: expect.arrayContaining([
        expect.objectContaining({ profileId: 'sng-1', place: 1 }),
        expect.objectContaining({ profileId: 'sng-2', place: 2 }),
      ]),
    }));
    expect(manager.getChatHistory(roomId).some(message => (
      message.message.includes('Sit & Go')
    ))).toBe(true);
  });

  it('retries a failed wallet SnG finalization and rearms full retention exactly once', () => {
    vi.useFakeTimers();
    const economy = hooks();
    const completeSng = vi.fn()
      .mockImplementationOnce(() => { throw new Error('progression unavailable'); });
    const progression = progressionHooks({ completeSng });
    manager = new RoomManager(() => {}, () => {}, undefined, {
      economy,
      progression,
      roomRunIdFactory: () => 'generation-a',
      sngRetentionMs: 50,
    });
    const roomId = manager.createRoom(makeWalletSngConfig());
    seatSix(roomId);
    vi.advanceTimersByTime(2_001);
    const room = manager.getRoom(roomId)!;
    room.engine.state.isHandInProgress = false;
    for (let index = 2; index < 6; index += 1) {
      const player = room.engine.state.players[index];
      player.chips = 0;
      player.finishPlace = 7 - index;
      room.engine.state.tournament!.results.push({
        playerId: player.id,
        name: player.name,
        place: player.finishPlace,
        prize: 0,
      });
    }

    expect(manager.leaveRoom(roomId, 'sng-2')).toBe(true);
    expect(economy.afterTournament).toHaveBeenCalledOnce();
    expect(completeSng).toHaveBeenCalledOnce();
    expect(manager.getRuntimeStats().finishedRoomTimers).toBe(1);

    vi.advanceTimersByTime(999);
    expect(economy.afterTournament).toHaveBeenCalledOnce();
    expect(manager.getRoom(roomId)).toBeDefined();
    vi.advanceTimersByTime(1);

    expect(economy.afterTournament).toHaveBeenCalledTimes(2);
    expect(completeSng).toHaveBeenCalledTimes(2);
    expect(manager.getRoom(roomId)).toBeDefined();
    expect(manager.getRuntimeStats().finishedRoomTimers).toBe(1);
    vi.advanceTimersByTime(49);
    expect(manager.getRoom(roomId)).toBeDefined();
    vi.advanceTimersByTime(1);
    expect(manager.getRoom(roomId)).toBeUndefined();
    expect(manager.getRuntimeStats().finishedRoomTimers).toBe(0);
  });

  it('rewards a casual SnG between-hand finish without an economy ledger', () => {
    vi.useFakeTimers();
    const progression = progressionHooks();
    manager = new RoomManager(() => {}, () => {}, undefined, {
      progression,
      roomRunIdFactory: () => 'generation-casual',
    });
    const roomId = manager.createRoom({
      ...makeWalletSngConfig(),
      economyMode: 'practice',
    });
    seatSix(roomId);
    vi.advanceTimersByTime(2_001);
    const room = manager.getRoom(roomId)!;
    room.engine.state.isHandInProgress = false;
    for (let index = 2; index < 6; index += 1) {
      const player = room.engine.state.players[index];
      player.chips = 0;
      player.finishPlace = 7 - index;
      room.engine.state.tournament!.results.push({
        playerId: player.id,
        name: player.name,
        place: player.finishPlace,
        prize: 0,
      });
    }

    expect(manager.leaveRoom(roomId, 'sng-2')).toBe(true);
    expect(progression.completeSng).toHaveBeenCalledOnce();
    expect(progression.completeSng).toHaveBeenCalledWith(expect.objectContaining({
      roomRunId: 'generation-casual',
    }));
  });

  it('retries a failed casual SnG finalization without accumulating timers', () => {
    vi.useFakeTimers();
    const completeSng = vi.fn()
      .mockImplementationOnce(() => { throw new Error('progression unavailable'); });
    const progression = progressionHooks({ completeSng });
    manager = new RoomManager(() => {}, () => {}, undefined, {
      progression,
      roomRunIdFactory: () => 'generation-casual',
      sngRetentionMs: 50,
    });
    const roomId = manager.createRoom({
      ...makeWalletSngConfig(),
      economyMode: 'practice',
    });
    seatSix(roomId);
    vi.advanceTimersByTime(2_001);
    const room = manager.getRoom(roomId)!;
    room.engine.state.isHandInProgress = false;
    for (let index = 2; index < 6; index += 1) {
      const player = room.engine.state.players[index];
      player.chips = 0;
      player.finishPlace = 7 - index;
      room.engine.state.tournament!.results.push({
        playerId: player.id,
        name: player.name,
        place: player.finishPlace,
        prize: 0,
      });
    }

    expect(manager.leaveRoom(roomId, 'sng-2')).toBe(true);
    expect(manager.getRuntimeStats().finishedRoomTimers).toBe(1);
    vi.advanceTimersByTime(1_000);
    expect(completeSng).toHaveBeenCalledTimes(2);
    expect(manager.getRuntimeStats().finishedRoomTimers).toBe(1);
    vi.advanceTimersByTime(50);
    expect(manager.getRoom(roomId)).toBeUndefined();
    expect(manager.getRuntimeStats().finishedRoomTimers).toBe(0);
  });

  it('commits six human reservations before starting the tournament and rejects bot fill', () => {
    vi.useFakeTimers();
    const economy = hooks();
    manager = new RoomManager(() => {}, () => {}, undefined, { economy });
    const roomId = manager.createRoom(makeWalletSngConfig());
    seatSix(roomId);

    expect(manager.fillWithBots(roomId, 'sng-1')).toBe(false);
    vi.advanceTimersByTime(2_001);

    const tournament = manager.getRoom(roomId)!.engine.state.tournament!;
    expect(economy.beforeTournament).toHaveBeenCalledOnce();
    expect(tournament.entrants).toBe(6);
    expect(tournament.prizes).toEqual([4_500, 2_700, 1_800]);
    expect(vi.mocked(economy.beforeTournament).mock.invocationCallOrder[0])
      .toBeLessThan(vi.mocked(economy.beforeHand).mock.invocationCallOrder[0] ?? Infinity);
  });

  it('does not start when storage commit fails and refunds only a pre-start leave', () => {
    vi.useFakeTimers();
    const economy = hooks({
      beforeTournament: vi.fn(() => { throw new Error('storage unavailable'); }),
    });
    const progression = progressionHooks();
    manager = new RoomManager(() => {}, () => {}, undefined, {
      economy,
      progression,
    });
    const roomId = manager.createRoom(makeWalletSngConfig());
    seatSix(roomId);

    vi.advanceTimersByTime(2_001);
    expect(manager.getRoom(roomId)!.engine.state.tournament?.entrants).toBe(0);
    expect(manager.getRoom(roomId)!.engine.state.handNumber).toBe(0);
    expect(progression.captureHandStart).toHaveBeenCalledOnce();
    expect(progression.cancelHand).toHaveBeenCalledOnce();
    expect(progression.confirmHandStart).not.toHaveBeenCalled();
    expect(vi.mocked(progression.captureHandStart).mock.invocationCallOrder[0])
      .toBeLessThan(vi.mocked(economy.beforeTournament).mock.invocationCallOrder[0]);
    expect(manager.getChatHistory(roomId).at(-1)?.message)
      .toBe('저장 연결을 확인 중이에요');

    manager.leaveRoom(roomId, 'sng-1');
    expect(economy.cancelWaitingSng).toHaveBeenCalledOnce();
  });

  it('reverts a durable start when engine start has no mutation and permits a retry', () => {
    vi.useFakeTimers();
    const economy = hooks();
    const progression = progressionHooks();
    manager = new RoomManager(() => {}, () => {}, undefined, {
      economy,
      progression,
    });
    const roomId = manager.createRoom(makeWalletSngConfig());
    const room = manager.getRoom(roomId)!;
    vi.spyOn(room.engine, 'startTournament').mockImplementationOnce(() => undefined);
    seatSix(roomId);

    vi.advanceTimersByTime(2_001);
    expect(economy.beforeTournament).toHaveBeenCalledOnce();
    expect(economy.cancelTournamentStart).toHaveBeenCalledOnce();
    expect(progression.captureHandStart).toHaveBeenCalledOnce();
    expect(progression.cancelHand).toHaveBeenCalledOnce();
    expect(room.engine.state.tournament?.entrants).toBe(0);

    manager.resumeRoom(roomId);
    vi.advanceTimersByTime(2_001);
    expect(economy.beforeTournament).toHaveBeenCalledTimes(2);
    expect(progression.captureHandStart).toHaveBeenCalledTimes(2);
    expect(progression.confirmHandStart).toHaveBeenCalledOnce();
    expect(room.engine.state.tournament?.entrants).toBe(6);
  });

  it('preserves and blocks a partially mutated start without reversing its durable fee commit', () => {
    vi.useFakeTimers();
    const economy = hooks();
    const progression = progressionHooks();
    manager = new RoomManager(() => {}, () => {}, undefined, {
      economy,
      progression,
    });
    const roomId = manager.createRoom(makeWalletSngConfig());
    const room = manager.getRoom(roomId)!;
    vi.spyOn(room.engine, 'startTournament').mockImplementationOnce(() => {
      room.engine.state.tournament!.entrants = 1;
      throw new Error('failed after mutation');
    });
    seatSix(roomId);

    vi.advanceTimersByTime(2_001);

    expect(economy.beforeTournament).toHaveBeenCalledOnce();
    expect(economy.cancelTournamentStart).not.toHaveBeenCalled();
    expect(progression.cancelHand).toHaveBeenCalledOnce();
    expect(room.engine.state.tournament?.entrants).toBe(1);
    expect(manager.disposeRoom(roomId)).toBe(false);
  });

  it('settles a finished snapshot before announcement and blocks cleanup when settlement fails', () => {
    vi.useFakeTimers();
    const updates = vi.fn();
    const economy = hooks({
      afterTournament: vi.fn(() => { throw new Error('settlement unavailable'); }),
    });
    manager = new RoomManager(updates, () => {}, undefined, { economy });
    const roomId = manager.createRoom(makeWalletSngConfig());
    seatSix(roomId);
    vi.advanceTimersByTime(2_001);
    const room = manager.getRoom(roomId)!;
    room.engine.state.isHandInProgress = false;
    room.engine.state.tournament!.finished = true;
    room.engine.state.tournament!.results = room.engine.state.players.map(
      (player, index) => ({
        playerId: player.id,
        name: player.name,
        place: index + 1,
        prize: [4_500, 2_700, 1_800, 0, 0, 0][index],
      }),
    );
    const announcedWinner = room.engine.state.players[0];
    announcedWinner.type = 'bot';
    announcedWinner.personalityId = 'sakura';
    room.engine.state.winners = [{
      playerId: announcedWinner.id,
      amount: 100,
      hand: null,
      potIndex: 0,
    }];
    const updatesBeforeFinish = updates.mock.calls.length;
    const messagesBeforeFinish = manager.getChatHistory(roomId).length;

    (manager as unknown as { handleCompletedHand(roomId: string): void })
      .handleCompletedHand(roomId);

    expect(economy.afterTournament).toHaveBeenCalledOnce();
    const completionMessages = manager.getChatHistory(roomId)
      .slice(messagesBeforeFinish);
    expect(completionMessages).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: 'system',
        message: '저장 연결을 확인 중이에요',
      }),
    ]));
    expect(completionMessages.some(message => (
      message.message.includes('칩을 획득했습니다')
      || message.message.includes('Sit & Go 종료')
      || message.type === 'bot'
    ))).toBe(false);
    expect(updates.mock.calls.length).toBeGreaterThan(updatesBeforeFinish);
    expect(manager.disposeRoom(roomId)).toBe(false);
    expect(manager.getRoom(roomId)).toBeDefined();
  });

  it('settles a finished snapshot before direct room disposal', () => {
    vi.useFakeTimers();
    const economy = hooks();
    manager = new RoomManager(() => {}, () => {}, undefined, { economy });
    const roomId = manager.createRoom(makeWalletSngConfig());
    seatSix(roomId);
    vi.advanceTimersByTime(2_001);
    const room = manager.getRoom(roomId)!;
    room.engine.state.isHandInProgress = false;
    room.engine.state.tournament!.finished = true;
    room.engine.state.tournament!.results = room.engine.state.players.map(
      (player, index) => ({
        playerId: player.id,
        name: player.name,
        place: index + 1,
        prize: [4_500, 2_700, 1_800, 0, 0, 0][index],
      }),
    );

    expect(manager.disposeRoom(roomId)).toBe(true);
    expect(economy.afterTournament).toHaveBeenCalledOnce();
    expect(economy.voidRoom).not.toHaveBeenCalled();
  });

  it('keeps winner and tournament announcements after successful final settlement', () => {
    vi.useFakeTimers();
    const economy = hooks();
    manager = new RoomManager(() => {}, () => {}, undefined, { economy });
    const roomId = manager.createRoom(makeWalletSngConfig());
    seatSix(roomId);
    vi.advanceTimersByTime(2_001);
    const room = manager.getRoom(roomId)!;
    room.engine.state.isHandInProgress = false;
    room.engine.state.tournament!.finished = true;
    room.engine.state.tournament!.results = room.engine.state.players.map(
      (player, index) => ({
        playerId: player.id,
        name: player.name,
        place: index + 1,
        prize: [4_500, 2_700, 1_800, 0, 0, 0][index],
      }),
    );
    room.engine.state.winners = [{
      playerId: room.engine.state.players[0].id,
      amount: 100,
      hand: null,
      potIndex: 0,
    }];

    (manager as unknown as { handleCompletedHand(roomId: string): void })
      .handleCompletedHand(roomId);

    const messages = manager.getChatHistory(roomId).map(message => message.message);
    expect(messages.some(message => message.includes('칩을 획득했습니다'))).toBe(true);
    expect(messages.some(message => message.includes('Sit & Go 종료'))).toBe(true);
    expect(manager.getRuntimeStats().finishedRoomTimers).toBe(1);
  });
});
