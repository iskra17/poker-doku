import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { RoomManager } from './room-manager';
import { Player, RoomConfig } from '../lib/poker/types';

/**
 * 캐시 칩 추가(바이인 탑업) 계약:
 * - 살아 있는 좌석만 대상 — 0칩은 리바이 경로가 소유한다 (겹치면 지갑 이중 차감).
 * - 목표는 현재 스택보다 크고 테이블 맥시멈(maxBuyIn) 이하여야 한다.
 * - **핸드 중에는 즉시 올리지 않고 예약**한다. 핸드 시작 스택이 정산 fingerprint로
 *   굳어 있어 중간에 칩이 늘면 검증이 깨진다. 예약은 핸드 종료 시 반영된다.
 * - 지갑 방은 에스크로가 성공해야만 칩이 는다 (선 정산·후 반영).
 * - 무료(practice) 방은 지갑이 없으므로 훅 없이 바로 오른다.
 */

function makeConfig(overrides: Partial<RoomConfig> = {}): RoomConfig {
  return {
    name: '칩 추가 테스트 방',
    smallBlind: 10,
    bigBlind: 20,
    minBuyIn: 800,
    maxBuyIn: 4_000,
    maxPlayers: 6,
    turnTime: 8,
    gameMode: 'cash',
    botCount: 0,
    tableType: 'humans',
    economyMode: 'wallet',
    ...overrides,
  };
}

function makeHuman(id: string, seatIndex: number, chips = 1_200): Player {
  return {
    id,
    name: `휴먼-${id}`,
    type: 'human',
    avatar: 'player',
    chips,
    seatIndex,
    holeCards: [],
    currentBet: 0,
    totalContributed: 0,
    status: 'waiting',
    hasActed: false,
  };
}

describe('RoomManager cash top-up', () => {
  let manager: RoomManager;
  let topUpSeat: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.useFakeTimers();
    topUpSeat = vi.fn(() => true);
    manager = new RoomManager(() => {}, () => {}, undefined, {
      economy: { topUpSeat } as never,
    });
  });

  afterEach(() => {
    manager.shutdown();
    vi.useRealTimers();
  });

  function seatedRoom(configOverrides: Partial<RoomConfig> = {}): {
    roomId: string;
    player: Player;
  } {
    const roomId = manager.createRoom(makeConfig(configOverrides));
    manager.joinRoom(roomId, makeHuman('hero', 0));
    const player = manager.getRoom(roomId)!.engine.state.players
      .find(p => p.id === 'hero')!;
    return { roomId, player };
  }

  it('fills a short stack to the target between hands', () => {
    const { roomId, player } = seatedRoom();

    expect(manager.requestCashTopUp(roomId, 'hero', 4_000))
      .toEqual({ status: 'applied', chips: 4_000 });

    expect(player.chips).toBe(4_000);
    expect(topUpSeat).toHaveBeenCalledWith(roomId, 'hero', 4_000);
  });

  it('leaves the stack alone when the wallet declines', () => {
    const { roomId, player } = seatedRoom();
    topUpSeat.mockReturnValue(false);

    expect(manager.requestCashTopUp(roomId, 'hero', 4_000))
      .toEqual({ status: 'declined' });

    expect(player.chips).toBe(1_200);
  });

  it('queues a mid-hand request and applies it once the hand ends', () => {
    const { roomId, player } = seatedRoom();
    const room = manager.getRoom(roomId)!;
    room.engine.state.isHandInProgress = true;

    expect(manager.requestCashTopUp(roomId, 'hero', 4_000))
      .toEqual({ status: 'queued', target: 4_000 });
    // 핸드 중에는 칩이 오르지 않는다 — 정산 fingerprint 보호
    expect(player.chips).toBe(1_200);
    expect(topUpSeat).not.toHaveBeenCalled();

    room.engine.state.isHandInProgress = false;
    manager.applyPendingTopUps(roomId);

    expect(player.chips).toBe(4_000);
    expect(player.pendingTopUpTarget).toBeUndefined();
  });

  it('drops a queued top-up when the hand left the seat busted', () => {
    const { roomId, player } = seatedRoom();
    const room = manager.getRoom(roomId)!;
    room.engine.state.isHandInProgress = true;
    manager.requestCashTopUp(roomId, 'hero', 4_000);

    // 그 핸드에서 올인해 파산 — 이제 리바이 경로 소관이다
    player.chips = 0;
    room.engine.state.isHandInProgress = false;
    manager.applyPendingTopUps(roomId);

    expect(player.chips).toBe(0);
    expect(topUpSeat).not.toHaveBeenCalled();
    expect(player.pendingTopUpTarget).toBeUndefined();
  });

  it('drops a queued top-up the hand already overtook', () => {
    const { roomId, player } = seatedRoom();
    const room = manager.getRoom(roomId)!;
    room.engine.state.isHandInProgress = true;
    manager.requestCashTopUp(roomId, 'hero', 2_000);

    player.chips = 3_000; // 큰 팟을 이겨 목표를 넘었다
    room.engine.state.isHandInProgress = false;
    manager.applyPendingTopUps(roomId);

    expect(player.chips).toBe(3_000);
    expect(topUpSeat).not.toHaveBeenCalled();
  });

  it('rejects a busted seat, an over-cap target and a non-raising target', () => {
    const { roomId, player } = seatedRoom();

    expect(manager.requestCashTopUp(roomId, 'hero', 4_001))
      .toEqual({ status: 'invalid', maxTarget: 4_000 });
    expect(manager.requestCashTopUp(roomId, 'hero', 1_200))
      .toEqual({ status: 'invalid', maxTarget: 4_000 });
    expect(manager.requestCashTopUp(roomId, 'hero', 1.5))
      .toEqual({ status: 'invalid', maxTarget: 4_000 });

    player.chips = 0;
    expect(manager.requestCashTopUp(roomId, 'hero', 4_000))
      .toEqual({ status: 'busted' });
    expect(topUpSeat).not.toHaveBeenCalled();
  });

  it('refuses tournament seats outright', () => {
    const { roomId } = seatedRoom({ gameMode: 'sng' });

    expect(manager.requestCashTopUp(roomId, 'hero', 4_000))
      .toEqual({ status: 'not-cash' });
    expect(topUpSeat).not.toHaveBeenCalled();
  });

  it('tops up a free practice table without any wallet hook', () => {
    const { roomId, player } = seatedRoom({ economyMode: 'practice' });

    expect(manager.requestCashTopUp(roomId, 'hero', 4_000))
      .toEqual({ status: 'applied', chips: 4_000 });
    expect(player.chips).toBe(4_000);
    expect(topUpSeat).not.toHaveBeenCalled();
  });

  it('cancels a queued top-up on request', () => {
    const { roomId, player } = seatedRoom();
    const room = manager.getRoom(roomId)!;
    room.engine.state.isHandInProgress = true;
    manager.requestCashTopUp(roomId, 'hero', 4_000);

    expect(manager.cancelCashTopUp(roomId, 'hero')).toBe(true);
    expect(player.pendingTopUpTarget).toBeUndefined();
    expect(manager.cancelCashTopUp(roomId, 'hero')).toBe(false);
  });
});
