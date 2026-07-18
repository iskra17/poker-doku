import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { RoomManager, type RoomHandHistoryHooks } from './room-manager';
import { Player, RoomConfig } from '../lib/poker/types';
import type { CompletedHandRecord } from '../lib/poker/hand-history';

/**
 * 핸드 히스토리 영속 훅 회귀 (2026-07-18):
 * 핸드가 끝날 때마다 handleCompletedHand가 엔진 레코드를 정확히 1회씩 훅에 넘긴다.
 */

function makeConfig(): RoomConfig {
  return {
    name: '히스토리 테스트 방',
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

function makeHuman(id: string, seatIndex: number): Player {
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

describe('RoomManager 핸드 히스토리 훅', () => {
  let manager: RoomManager;
  let recorded: {
    roomId: string;
    roomName: string;
    gameMode: string;
    record: CompletedHandRecord;
  }[];

  beforeEach(() => {
    vi.useFakeTimers();
    recorded = [];
    const handHistory: RoomHandHistoryHooks = {
      recordCompletedHand: input => {
        recorded.push(input);
      },
    };
    manager = new RoomManager(() => {}, () => {}, undefined, { handHistory });
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  function foldOutHand(roomId: string): void {
    const engine = manager.getRoom(roomId)!.engine;
    // 승자 1명 남을 때까지 현재 액터가 폴드
    for (let guard = 0; guard < 10 && engine.state.isHandInProgress; guard++) {
      const actorId = engine.state.players[engine.state.activePlayerIndex].id;
      manager.processPlayerAction(roomId, actorId, 'fold');
    }
    expect(engine.state.isHandInProgress).toBe(false);
  }

  it('핸드가 끝나면 방 정보와 함께 레코드를 1회 기록한다', () => {
    const roomId = manager.createRoom(makeConfig());
    for (let i = 0; i < 3; i++) {
      manager.joinRoom(roomId, makeHuman(`p${i + 1}`, i));
    }
    vi.advanceTimersByTime(2500); // 자동 핸드 시작

    foldOutHand(roomId);

    expect(recorded).toHaveLength(1);
    expect(recorded[0]).toMatchObject({
      roomId,
      roomName: '히스토리 테스트 방',
      gameMode: 'cash',
    });
    expect(recorded[0].record.handNumber).toBe(1);
    expect(recorded[0].record.players).toHaveLength(3);
    expect(recorded[0].record.showdown).toBe(false);
    expect(recorded[0].record.winners).toHaveLength(1);

    // 다음 핸드도 새로 1회 기록 (커서가 핸드 번호를 따라간다)
    vi.advanceTimersByTime(7000);
    foldOutHand(roomId);
    expect(recorded).toHaveLength(2);
    expect(recorded[1].record.handNumber).toBe(2);
  });

  it('훅이 던져도 게임 진행(다음 핸드 예약)은 막히지 않는다', () => {
    const throwing = new RoomManager(() => {}, () => {}, undefined, {
      handHistory: {
        recordCompletedHand: () => {
          throw new Error('db down');
        },
      },
    });
    const roomId = throwing.createRoom(makeConfig());
    for (let i = 0; i < 3; i++) {
      throwing.joinRoom(roomId, makeHuman(`p${i + 1}`, i));
    }
    vi.advanceTimersByTime(2500);

    const engine = throwing.getRoom(roomId)!.engine;
    for (let guard = 0; guard < 10 && engine.state.isHandInProgress; guard++) {
      const actorId = engine.state.players[engine.state.activePlayerIndex].id;
      throwing.processPlayerAction(roomId, actorId, 'fold');
    }
    expect(engine.state.isHandInProgress).toBe(false);

    // 다음 핸드가 정상 시작된다
    vi.advanceTimersByTime(7000);
    expect(engine.state.handNumber).toBe(2);
    expect(engine.state.isHandInProgress).toBe(true);
  });
});
