import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { RoomManager } from './room-manager';
import { Player, RoomConfig } from '../lib/poker/types';

/**
 * 나가기 예약 계약 (leave-room mode:'reserve-*', 캐시 전용):
 * - 'hand': 이번 핸드 종료(정산 확정) 시 자동 퇴장. 진행 중 핸드에 딜인돼 있지 않으면
 *   기다릴 핸드가 없으므로 'leave-now' — 호출부(socket-handler)가 즉시 exit 처리.
 * - 'bb': 핸드 종료 시마다 predictNextBigBlindId로 판정해 다음 핸드 BB 차례인 좌석만 퇴장.
 *   핸드 사이에 이미 다음 BB로 예측되면 'leave-now'.
 * - 취소(null)는 예약 플래그를 지우고 좌석을 유지한다.
 * - SnG/아레나는 기권·순위 규칙과 얽혀 'rejected'.
 * - 서버 실행 퇴장은 onSeatReclaimed(message)로 클라이언트를 로비로 돌려보낸다.
 */

function makeConfig(overrides: Partial<RoomConfig> = {}): RoomConfig {
  return {
    name: '나가기 예약 테스트 방',
    smallBlind: 10,
    bigBlind: 20,
    minBuyIn: 800,
    maxBuyIn: 4000,
    maxPlayers: 6,
    turnTime: 8,
    gameMode: 'cash',
    botCount: 0,
    tableType: 'humans',
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

/** 진행 중 핸드를 폴드 연쇄로 종료 — handleCompletedHand(예약 실행 지점)까지 동기 진행 */
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

describe('나가기 예약 — setLeaveReservation/processLeaveReservations', () => {
  let manager: RoomManager;
  let reclaimed: Array<{ roomId: string; playerId: string; message?: string }>;

  beforeEach(() => {
    vi.useFakeTimers();
    reclaimed = [];
    manager = new RoomManager(() => {}, () => {}, undefined, {
      onSeatReclaimed: (roomId, playerId, message) => {
        reclaimed.push({ roomId, playerId, message });
      },
    });
  });

  afterEach(() => {
    manager.shutdown();
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  function setupCash(playerIds: string[]): string {
    const roomId = manager.createRoom(makeConfig());
    playerIds.forEach((id, i) => manager.joinRoom(roomId, makeHuman(id, i)));
    vi.advanceTimersByTime(2500); // 핸드 시작 타이머
    return roomId;
  }

  it("'hand' 예약: 진행 중 핸드가 끝나면 자동 퇴장 + room-lost 안내", () => {
    const roomId = setupCash(['p1', 'p2', 'p3']);
    expect(manager.setLeaveReservation(roomId, 'p1', 'hand')).toBe('reserved');
    const st = manager.getRoom(roomId)!.engine.state;
    expect(st.players.find(p => p.id === 'p1')!.leaveReservation).toBe('hand');

    foldOutHand(manager, roomId);

    expect(manager.getRoom(roomId)!.engine.state.players.some(p => p.id === 'p1')).toBe(false);
    expect(reclaimed).toHaveLength(1);
    expect(reclaimed[0].playerId).toBe('p1');
    expect(reclaimed[0].message).toContain('핸드 종료');
    // 남은 2인 게임은 계속된다 (핸드 종료 후 다음 핸드는 승리 연출 뒤 6.5초)
    vi.advanceTimersByTime(7000);
    expect(manager.getRoom(roomId)!.engine.state.isHandInProgress).toBe(true);
  });

  it("'hand' 예약: 핸드에 딜인돼 있지 않으면 'leave-now' (기다릴 핸드가 없다)", () => {
    const roomId = manager.createRoom(makeConfig());
    manager.joinRoom(roomId, makeHuman('solo', 0));
    // 1인 방 — 핸드 미진행
    expect(manager.setLeaveReservation(roomId, 'solo', 'hand')).toBe('leave-now');
  });

  it("'bb' 예약: 다음 핸드 BB가 아닌 동안은 남고, BB 차례가 오기 직전 핸드 종료 시 퇴장한다", () => {
    const roomId = setupCash(['p1', 'p2', 'p3']);
    // 첫 핸드: BTN p2, SB p3, BB p1 → 다음 핸드 BB는 p2, 그다음 p3
    const engine = manager.getRoom(roomId)!.engine;
    expect(manager.setLeaveReservation(roomId, 'p3', 'bb')).toBe('reserved');

    foldOutHand(manager, roomId);
    // 핸드1 종료: 다음 BB는 p2 — p3는 아직 남는다
    expect(engine.state.players.some(p => p.id === 'p3')).toBe(true);
    expect(reclaimed).toHaveLength(0);

    vi.advanceTimersByTime(7000); // 핸드 종료 후 다음 핸드는 6.5초 뒤
    foldOutHand(manager, roomId);
    // 핸드2 종료: 다음 BB는 p3 — 블라인드를 새로 내기 직전에 퇴장
    expect(engine.state.players.some(p => p.id === 'p3')).toBe(false);
    expect(reclaimed).toHaveLength(1);
    expect(reclaimed[0].playerId).toBe('p3');
    expect(reclaimed[0].message).toContain('빅블라인드');
  });

  it("'bb' 예약: 핸드 사이에 이미 다음 BB로 예측되면 'leave-now'", () => {
    const roomId = setupCash(['p1', 'p2', 'p3']);
    foldOutHand(manager, roomId);
    // 핸드 사이 — 다음 핸드 BB로 예측되는 좌석의 예약은 즉시 퇴장 신호
    const nextBb = manager.getRoom(roomId)!.engine.predictNextBigBlindId();
    expect(nextBb).not.toBeNull();
    expect(manager.setLeaveReservation(roomId, nextBb!, 'bb')).toBe('leave-now');
  });

  it('예약 취소는 플래그를 지우고 좌석을 유지한다', () => {
    const roomId = setupCash(['p1', 'p2', 'p3']);
    expect(manager.setLeaveReservation(roomId, 'p1', 'hand')).toBe('reserved');
    expect(manager.setLeaveReservation(roomId, 'p1', null)).toBe('cleared');
    const st = manager.getRoom(roomId)!.engine.state;
    expect(st.players.find(p => p.id === 'p1')!.leaveReservation).toBeUndefined();

    foldOutHand(manager, roomId);
    expect(st.players.some(p => p.id === 'p1')).toBe(true);
    expect(reclaimed).toHaveLength(0);
  });

  it('SnG 방은 나가기 예약을 지원하지 않는다', () => {
    const roomId = manager.createRoom(makeConfig({
      gameMode: 'sng',
      economyMode: 'practice',
      startingStack: 1500,
      tableType: 'mixed',
    }));
    manager.joinRoom(roomId, makeHuman('p1', 0));
    expect(manager.setLeaveReservation(roomId, 'p1', 'hand')).toBe('rejected');
    expect(manager.setLeaveReservation(roomId, 'p1', 'bb')).toBe('rejected');
  });

  it('예약 퇴장 실패(방 없음/미착석)는 rejected', () => {
    const roomId = setupCash(['p1', 'p2']);
    expect(manager.setLeaveReservation('no-such-room', 'p1', 'hand')).toBe('rejected');
    expect(manager.setLeaveReservation(roomId, 'ghost', 'hand')).toBe('rejected');
  });
});
