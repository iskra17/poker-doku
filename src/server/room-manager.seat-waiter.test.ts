import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { RoomManager, SeatWaiterCancelReason } from './room-manager';
import { Player, RoomConfig } from '../lib/poker/types';

/**
 * 착석 대기(seat waiter) 계약 — 만석(봇 포함) 방 입장 UX:
 * - 입장 거절/수동 재시도 대신 관전 대기로 등록하고, 양보 봇을 pendingRemoval+폴드로 마킹.
 * - 진행 중 핸드가 끝나면 봇 퇴장(t=5s) → 대기자 착석(t=6.2s)을 **순차** 브로드캐스트 —
 *   봇이 사람으로 한 프레임에 바뀌면 버그로 오인된다 (2026-07-23 유저 피드백).
 * - 착석은 다음 핸드에 자연 딜인. 대기 취소(이탈/끊김)는 양보 봇을 원복한다.
 * - 방 정리/엔진 교체는 대기열을 hooks(onCancelled)로 통지하며 일괄 취소.
 * - refreshCashBots는 대기자 몫 좌석을 재충원에서 제외한다.
 */

function makeConfig(overrides: Partial<RoomConfig> = {}): RoomConfig {
  return {
    name: '착석 대기 테스트 방',
    smallBlind: 10,
    bigBlind: 20,
    minBuyIn: 800,
    maxBuyIn: 4000,
    maxPlayers: 6,
    turnTime: 8,
    gameMode: 'cash',
    botCount: 0, // 자동 봇 충원 없이 좌석 구성을 테스트가 직접 제어
    tableType: 'mixed',
    ...overrides,
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

function makeBot(id: string, seatIndex: number): Player {
  return { ...makeHuman(id, seatIndex), name: `봇-${id}`, type: 'bot', avatar: 'bot' };
}

/** 진행 중 핸드를 폴드 연쇄로 종료 — handleCompletedHand(핸드오프 예약 지점)까지 동기 진행 */
function foldOutHand(manager: RoomManager, roomId: string): void {
  const st = manager.getRoom(roomId)!.engine.state;
  expect(st.isHandInProgress).toBe(true);
  let guard = 0;
  while (st.isHandInProgress && guard++ < 12) {
    const actor = st.players[st.activePlayerIndex];
    manager.processPlayerAction(roomId, actor.id, 'fold');
  }
  expect(st.isHandInProgress).toBe(false);
}

describe('착석 대기 — enqueueSeatWaiter/핸드오프/취소', () => {
  let manager: RoomManager;
  let chats: string[];

  beforeEach(() => {
    vi.useFakeTimers();
    chats = [];
    manager = new RoomManager(
      () => {},
      (_roomId, message) => { chats.push(JSON.stringify(message)); },
    );
  });

  afterEach(() => {
    manager.shutdown();
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  /** 휴먼 5 + 봇 1로 만석을 채우고 핸드를 시작한다 */
  function setupFullMixed(botIds: string[] = ['b1']): string {
    const roomId = manager.createRoom(makeConfig());
    const humanCount = 6 - botIds.length;
    for (let i = 0; i < humanCount; i++) {
      expect(manager.joinRoom(roomId, makeHuman(`p${i + 1}`, i))).toBe(true);
    }
    botIds.forEach((id, i) => {
      expect(manager.joinRoom(roomId, makeBot(id, humanCount + i))).toBe(true);
    });
    vi.advanceTimersByTime(2500); // 핸드 시작 타이머
    expect(manager.getRoom(roomId)!.engine.state.isHandInProgress).toBe(true);
    return roomId;
  }

  it('대기 등록 → 봇 양보 마킹 → 핸드 종료 후 봇 퇴장과 착석이 순차로 일어난다', () => {
    const roomId = setupFullMixed(['b1']);
    const st = manager.getRoom(roomId)!.engine.state;

    expect(manager.enqueueSeatWaiter(roomId, makeHuman('w1', -1))).toBe('waiting');
    expect(manager.isSeatWaiter(roomId, 'w1')).toBe(true);
    expect(manager.getSeatWaiterIds(roomId)).toEqual(['w1']);
    const bot = st.players.find(p => p.id === 'b1')!;
    expect(bot.pendingRemoval).toBe(true);
    expect(chats.join('\n')).toContain('자리를 비워줍니다');

    foldOutHand(manager, roomId);
    // 핸드 종료 직후에는 아직 봇 좌석 유지 + 대기자 미착석 (승리 연출 구간)
    expect(st.players.some(p => p.id === 'b1')).toBe(true);
    expect(st.players.some(p => p.id === 'w1')).toBe(false);

    // t=5s: 봇 퇴장 브로드캐스트 — 아직 착석 전 (순차 연출의 핵심)
    vi.advanceTimersByTime(5_000);
    const afterExit = manager.getRoom(roomId)!.engine.state;
    expect(afterExit.players.some(p => p.id === 'b1')).toBe(false);
    expect(afterExit.players.some(p => p.id === 'w1')).toBe(false);
    expect(chats.join('\n')).toContain('자리에서 일어났어요');

    // t=6.2s: 대기자 착석
    vi.advanceTimersByTime(1_200);
    const afterSeat = manager.getRoom(roomId)!.engine.state;
    const seated = afterSeat.players.find(p => p.id === 'w1');
    expect(seated).toBeDefined();
    expect(seated!.seatIndex).toBeGreaterThanOrEqual(0);
    expect(manager.isSeatWaiter(roomId, 'w1')).toBe(false);

    // 착석이 다음 핸드를 +2초로 재예약 — 새 핸드에 대기자가 딜인된다
    const prevHandNumber = afterSeat.handNumber;
    vi.advanceTimersByTime(2_100);
    const nextHand = manager.getRoom(roomId)!.engine.state;
    expect(nextHand.handNumber).toBe(prevHandNumber + 1);
    expect(nextHand.isHandInProgress).toBe(true);
    expect(nextHand.players.find(p => p.id === 'w1')!.status).not.toBe('sitting-out');
  });

  it('대기 취소(self-leave)는 양보 봇을 원복하고 hooks에 통지한다', () => {
    const roomId = setupFullMixed(['b1']);
    const st = manager.getRoom(roomId)!.engine.state;
    const cancelled: Array<{ reason: SeatWaiterCancelReason; message: string }> = [];

    manager.enqueueSeatWaiter(roomId, makeHuman('w1', -1), {
      onCancelled: (reason, message) => cancelled.push({ reason, message }),
    });
    expect(st.players.find(p => p.id === 'b1')!.pendingRemoval).toBe(true);

    expect(manager.cancelSeatWaiter(roomId, 'w1', 'self-leave')).toBe(true);
    expect(manager.isSeatWaiter(roomId, 'w1')).toBe(false);
    expect(st.players.find(p => p.id === 'b1')!.pendingRemoval).toBe(false);
    expect(cancelled).toEqual([
      { reason: 'self-leave', message: expect.stringContaining('취소') },
    ]);
    // 미등록 대기자 취소는 false (멱등)
    expect(manager.cancelSeatWaiter(roomId, 'w1', 'self-leave')).toBe(false);
  });

  it('방 정리(disposeRoom)는 대기열을 room-closed로 일괄 취소한다', () => {
    const roomId = setupFullMixed(['b1']);
    const cancelled: SeatWaiterCancelReason[] = [];
    manager.enqueueSeatWaiter(roomId, makeHuman('w1', -1), {
      onCancelled: reason => cancelled.push(reason),
    });

    expect(manager.disposeRoom(roomId, 'manual')).toBe(true);
    expect(cancelled).toEqual(['room-closed']);
  });

  it('양보할 봇이 없으면(사람만 만석) no-bot을 반환한다', () => {
    const roomId = setupFullMixed([]); // 6인 전원 휴먼
    expect(manager.enqueueSeatWaiter(roomId, makeHuman('w1', -1))).toBe('no-bot');
    expect(manager.isSeatWaiter(roomId, 'w1')).toBe(false);
  });

  it('이미 앉아 있거나 대기 중인 플레이어는 already를 반환한다', () => {
    const roomId = setupFullMixed(['b1', 'b2']);
    expect(manager.enqueueSeatWaiter(roomId, makeHuman('p1', -1))).toBe('already');
    expect(manager.enqueueSeatWaiter(roomId, makeHuman('w1', -1))).toBe('waiting');
    expect(manager.enqueueSeatWaiter(roomId, makeHuman('w1', -1))).toBe('already');
  });

  it('SnG 방은 착석 대기를 받지 않는다 (not-cash)', () => {
    const roomId = manager.createRoom(makeConfig({
      gameMode: 'sng',
      economyMode: 'practice',
      startingStack: 1500,
    }));
    expect(manager.enqueueSeatWaiter(roomId, makeHuman('w1', -1))).toBe('not-cash');
  });

  it('봇 재충원(refreshCashBots)이 대기자 몫 좌석을 도로 채우지 않는다', () => {
    // botCount 2 방: 첫 휴먼 입장 시 봇 2명이 자동 충원된다 — 남은 빈 좌석에 휴먼을 채워 만석
    const roomId = manager.createRoom(makeConfig({ botCount: 2 }));
    expect(manager.joinRoom(roomId, makeHuman('p1', 0))).toBe(true);
    const st0 = manager.getRoom(roomId)!.engine.state;
    const freeSeat = () => {
      const occupied = new Set(st0.players.map(p => p.seatIndex));
      for (let s = 0; s < 6; s++) if (!occupied.has(s)) return s;
      return -1;
    };
    for (const id of ['p2', 'p3', 'p4']) {
      expect(manager.joinRoom(roomId, makeHuman(id, freeSeat()))).toBe(true);
    }
    expect(st0.players).toHaveLength(6);
    expect(st0.players.filter(p => p.type === 'bot')).toHaveLength(2);
    vi.advanceTimersByTime(2500);
    expect(manager.getRoom(roomId)!.engine.state.isHandInProgress).toBe(true);

    expect(manager.enqueueSeatWaiter(roomId, makeHuman('w1', -1))).toBe('waiting');
    foldOutHand(manager, roomId);
    vi.advanceTimersByTime(5_000 + 1_200); // 봇 퇴장 + 착석
    const st = manager.getRoom(roomId)!.engine.state;
    expect(st.players.some(p => p.id === 'w1')).toBe(true);

    // 다음 핸드 시작(착석 +2초 재예약)까지 진행 — 봇이 6번째 좌석을 되채우면 만석 초과/착석 실패였다
    vi.advanceTimersByTime(2_100);
    const next = manager.getRoom(roomId)!.engine.state;
    expect(next.isHandInProgress).toBe(true);
    expect(next.players).toHaveLength(6);
    expect(next.players.filter(p => p.type === 'bot')).toHaveLength(1); // b1 양보 → 재충원 없음
    expect(next.players.filter(p => p.type === 'human')).toHaveLength(5);
  });

  it('마지막 착석 휴먼이 떠나도 대기자가 있으면 방을 리셋하지 않고 게임을 잇는다', async () => {
    // 휴먼 1 + 봇 5 만석 — 유일 휴먼이 핸드 중 떠나고, 대기자가 그 흐름을 이어받는다
    const roomId = manager.createRoom(makeConfig());
    expect(manager.joinRoom(roomId, makeHuman('p1', 0))).toBe(true);
    for (let i = 0; i < 5; i++) {
      expect(manager.joinRoom(roomId, makeBot(`b${i + 1}`, i + 1))).toBe(true);
    }
    vi.advanceTimersByTime(2500);
    expect(manager.getRoom(roomId)!.engine.state.isHandInProgress).toBe(true);

    expect(manager.enqueueSeatWaiter(roomId, makeHuman('w1', -1))).toBe('waiting');
    const handNumberBefore = manager.getRoom(roomId)!.engine.state.handNumber;
    expect(manager.leaveRoom(roomId, 'p1')).toBe(true);

    // 남은 봇들이 핸드를 마저 플레이한다 — 비동기 봇 루프라 async 타이머 전진 필요.
    // 어떻게 끝나든, 대기자 덕에 방이 disposeRoom/리셋되지 않아야 한다.
    await vi.advanceTimersByTimeAsync(60_000);
    const room = manager.getRoom(roomId);
    expect(room).toBeDefined();
    // 엔진이 교체되지 않았고(핸드 번호 보존/증가) 대기자는 착석했다
    expect(room!.engine.state.handNumber).toBeGreaterThanOrEqual(handNumberBefore);
    expect(room!.engine.state.players.some(p => p.id === 'w1')).toBe(true);
    expect(manager.isSeatWaiter(roomId, 'w1')).toBe(false);
  });
});
