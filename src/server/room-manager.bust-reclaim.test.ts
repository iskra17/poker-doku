import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { RoomManager } from './room-manager';
import { BUST_RECLAIM_MS } from './sitout';
import { Player, RoomConfig } from '../lib/poker/types';

/**
 * 캐시 파산(0칩) 좌석 회수 계약 (2026-07-21 운영 로그에서 확인된 방치 문제):
 * - 파산 좌석은 미납 BB 정리(trackMissedBlinds)가 chips<=0을 건너뛰어 대상이 아니다.
 *   핸드 종료 시점에 리바이 유예(BUST_RECLAIM_MS, 30초)를 걸어 방치되면 회수한다 —
 *   빠른 세션 회전을 위해 자리비움 방치(5분)보다 훨씬 짧다.
 * - 유예는 이후 핸드 종료마다 재무장하지 않는다 (재무장하면 영영 만료되지 않는다).
 *   단, 파산 전에 걸린 더 긴 자리비움 유예(5분)는 30초로 교체된다.
 * - 리바이 재입장(handleSeatRejoin)은 유예와 카운트다운(bustReclaimDeadline)을 해제한다.
 * - 접속 끊김 grace 만료 시 캐시 파산 좌석은 자리비움 상태라도 즉시 회수한다 (SnG는 무조건 보존).
 */

function makeConfig(overrides: Partial<RoomConfig> = {}): RoomConfig {
  return {
    name: '파산 회수 테스트 방',
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

/**
 * 진행 중 핸드의 첫 액터를 "올인 패배로 파산"시키고(폴드 직전 칩 0) 폴드 연쇄로 핸드를
 * 끝낸다 — handleCompletedHand가 파산 좌석을 보고 리바이 유예를 걸어야 하는 시점.
 */
function bustLoserAndEndHand(manager: RoomManager, roomId: string): Player {
  const st = manager.getRoom(roomId)!.engine.state;
  expect(st.isHandInProgress).toBe(true);
  const loser = st.players[st.activePlayerIndex];
  loser.chips = 0;
  let guard = 0;
  while (st.isHandInProgress && guard++ < 12) {
    const actor = st.players[st.activePlayerIndex];
    manager.processPlayerAction(roomId, actor.id, 'fold');
  }
  expect(st.isHandInProgress).toBe(false);
  expect(loser.chips).toBe(0);
  return loser;
}

type BustReclaimAccess = { scheduleBustReclaims(roomId: string): void };

describe('캐시 파산 좌석 회수', () => {
  let manager: RoomManager;

  beforeEach(() => {
    vi.useFakeTimers();
    manager = new RoomManager(() => {}, () => {});
  });

  afterEach(() => {
    manager.shutdown();
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  function setupHeadsUp(): string {
    const roomId = manager.createRoom(makeConfig());
    manager.joinRoom(roomId, makeHuman('p1', 0));
    manager.joinRoom(roomId, makeHuman('p2', 1));
    vi.advanceTimersByTime(2500);
    return roomId;
  }

  it('파산 좌석은 핸드 종료 시 30초 유예가 걸리고(카운트다운 노출), 리바이 없으면 회수된다', () => {
    const roomId = setupHeadsUp();
    const loser = bustLoserAndEndHand(manager, roomId);
    expect(manager.getRuntimeStats().sitOutTimers).toBe(1);
    expect(loser.bustReclaimDeadline).toBe(Date.now() + BUST_RECLAIM_MS);

    vi.advanceTimersByTime(BUST_RECLAIM_MS + 1000);
    const st = manager.getRoom(roomId)!.engine.state;
    expect(st.players.some(p => p.id === loser.id)).toBe(false);
    expect(
      manager.getChatHistory(roomId).some(m => m.message.includes('리바이 없이')),
    ).toBe(true);
  });

  it('유예 중 리바이 재입장(handleSeatRejoin)은 유예와 카운트다운을 해제한다', () => {
    const roomId = setupHeadsUp();
    const loser = bustLoserAndEndHand(manager, roomId);
    expect(manager.getRuntimeStats().sitOutTimers).toBe(1);

    manager.handleSeatRejoin(roomId, loser.id);
    loser.chips = 2000; // 새 바이인 리바이
    expect(manager.getRuntimeStats().sitOutTimers).toBe(0);
    expect(loser.bustReclaimDeadline).toBeUndefined();

    vi.advanceTimersByTime(BUST_RECLAIM_MS + 1000);
    const st = manager.getRoom(roomId)!.engine.state;
    expect(st.players.some(p => p.id === loser.id)).toBe(true);
  });

  it('이후 핸드 종료가 유예를 재무장하지 않는다 — 최초 파산 시점 기준으로 만료된다', () => {
    const roomId = setupHeadsUp();
    const loser = bustLoserAndEndHand(manager, roomId);

    // 20초 뒤 다른 좌석의 핸드가 또 끝났다고 가정 — 유예가 리셋되면 안 된다
    vi.advanceTimersByTime(20_000);
    (manager as unknown as BustReclaimAccess).scheduleBustReclaims(roomId);

    // 최초 시점 기준 잔여 10초만 지나면 회수돼야 한다 (리셋됐다면 아직 남아 있음)
    vi.advanceTimersByTime(10_000 + 1000);
    const st = manager.getRoom(roomId)!.engine.state;
    expect(st.players.some(p => p.id === loser.id)).toBe(false);
  });

  it('파산과 자리비움 이탈이 겹쳐도 30초 유예가 유지된다 (5분 방치 유예가 덮어쓰지 않음)', () => {
    const roomId = setupHeadsUp();
    const st = manager.getRoom(roomId)!.engine.state;
    const loser = st.players[st.activePlayerIndex];
    loser.chips = 0; // 올인 패배 직전 상태
    // 본인 턴에 '자리비움 하고 나가기' → 자동 폴드로 핸드 종료 → 파산 30초 유예 무장 →
    // 이어지는 5분 방치 유예 예약이 30초 유예를 늘리면 안 된다
    manager.sitOutAndLeave(roomId, loser.id);
    expect(st.isHandInProgress).toBe(false);
    expect(loser.chips).toBe(0);

    vi.advanceTimersByTime(BUST_RECLAIM_MS + 1000);
    expect(st.players.some(p => p.id === loser.id)).toBe(false);
  });

  it('grace 만료 시 캐시 파산 좌석은 자리비움 상태라도 즉시 회수된다', () => {
    const roomId = setupHeadsUp();
    const loser = bustLoserAndEndHand(manager, roomId);
    loser.status = 'sitting-out'; // 파산 + 자리비움 분류 (운영 로그에서 관찰된 상태)

    const kept = manager.handleGraceExpired(roomId, loser.id);
    expect(kept).toBe(false);
    const st = manager.getRoom(roomId)!.engine.state;
    expect(st.players.some(p => p.id === loser.id)).toBe(false);
  });

  it('SnG 좌석은 grace 만료에도 무조건 보존된다 (기존 계약 유지)', () => {
    const roomId = manager.createRoom(makeConfig({ gameMode: 'sng' }));
    manager.joinRoom(roomId, makeHuman('p1', 0));
    manager.joinRoom(roomId, makeHuman('p2', 1));

    const kept = manager.handleGraceExpired(roomId, 'p1');
    expect(kept).toBe(true);
    const st = manager.getRoom(roomId)!.engine.state;
    expect(st.players.some(p => p.id === 'p1')).toBe(true);
  });
});
