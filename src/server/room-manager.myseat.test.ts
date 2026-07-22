import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { RoomManager } from './room-manager';
import { SITOUT_ABANDON_MS } from './sitout';
import { Player, RoomConfig } from '../lib/poker/types';

/**
 * 로비 방 목록의 mySeat 계약 — 자리비움으로 떠난 좌석을 로비가 알아보고
 * 바이인/비밀번호 없이 '게임 복귀'를 띄우기 위한 개인화 필드.
 */

function makeConfig(): RoomConfig {
  return {
    name: '테스트 방',
    smallBlind: 10,
    bigBlind: 20,
    minBuyIn: 800,
    maxBuyIn: 4000,
    maxPlayers: 6,
    turnTime: 8,
    gameMode: 'cash',
    botCount: 0, // 봇 없음 + 1인 착석 → 핸드/타이머가 돌지 않는 정적 상태로 검증
  };
}

function makeHuman(id: string, chips = 2000): Player {
  return {
    id,
    name: `휴먼-${id}`,
    type: 'human',
    avatar: 'player',
    chips,
    seatIndex: 0,
    holeCards: [],
    currentBet: 0,
    totalContributed: 0,
    status: 'waiting',
    hasActed: false,
  };
}

describe('getRoomList mySeat — 보존 좌석의 로비 노출', () => {
  let manager: RoomManager;
  let roomsChanged: number;

  beforeEach(() => {
    vi.useFakeTimers();
    roomsChanged = 0;
    manager = new RoomManager(
      () => {},
      () => {},
      () => { roomsChanged++; },
    );
  });

  it('지갑/연습 경제 모드를 방 이름 추측 없이 공개한다', () => {
    const walletRoom = manager.createRoom({ ...makeConfig(), economyMode: 'wallet' });
    const practiceRoom = manager.createRoom({ ...makeConfig(), economyMode: 'practice' });

    expect(manager.getRoomList().find(room => room.id === walletRoom)?.economyMode)
      .toBe('wallet');
    expect(manager.getRoomList().find(room => room.id === practiceRoom)?.economyMode)
      .toBe('practice');
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it('착석 중인 플레이어에게만 mySeat이 실린다 (다른 플레이어/익명 조회는 없음)', () => {
    const roomId = manager.createRoom(makeConfig());
    manager.joinRoom(roomId, makeHuman('p1', 2000));

    const mine = manager.getRoomList('p1').find(r => r.id === roomId);
    expect(mine?.mySeat).toEqual({ chips: 2000, sittingOut: false });

    const other = manager.getRoomList('p2').find(r => r.id === roomId);
    expect(other?.mySeat).toBeUndefined();
    expect(manager.getRoomList().find(r => r.id === roomId)?.mySeat).toBeUndefined();
  });

  it('자리비움으로 떠나면 sittingOut=true, 재입장(handleSeatRejoin) 후에도 자리비움은 유지된다', () => {
    const roomId = manager.createRoom(makeConfig());
    manager.joinRoom(roomId, makeHuman('p1', 2000));

    manager.sitOutAndLeave(roomId, 'p1');
    expect(manager.getRoomList('p1').find(r => r.id === roomId)?.mySeat)
      .toEqual({ chips: 2000, sittingOut: true });

    // 재입장은 방치 회수 유예만 취소 — 복귀는 본인이 '게임 복귀'를 눌러야 한다
    manager.handleSeatRejoin(roomId, 'p1');
    vi.advanceTimersByTime(SITOUT_ABANDON_MS + 1000);
    expect(manager.getRoomList('p1').find(r => r.id === roomId)?.mySeat)
      .toEqual({ chips: 2000, sittingOut: true });
  });

  it('자리비움 이탈 좌석은 SITOUT_ABANDON_MS 후 자동 정리되고 onRoomsChanged가 불린다', () => {
    const roomId = manager.createRoom(makeConfig());
    manager.joinRoom(roomId, makeHuman('p1', 2000));

    manager.sitOutAndLeave(roomId, 'p1');
    expect(roomsChanged).toBe(0);

    vi.advanceTimersByTime(SITOUT_ABANDON_MS + 1000);
    // 좌석은 회수되지만 캐시 유저 방은 즉시 삭제하지 않고 보존된다 (재입장/초대 링크 여지)
    expect(manager.getRoomList('p1').find(r => r.id === roomId)?.mySeat).toBeUndefined();
    expect(roomsChanged).toBeGreaterThan(0);

    // 보존 시간(10분)까지 재입장이 없으면 그때 방이 삭제된다
    vi.advanceTimersByTime(10 * 60_000 + 1000);
    expect(manager.getRoomList('p1').find(r => r.id === roomId)).toBeUndefined();
  });

  it('pendingRemoval(정리 예약) 좌석은 mySeat으로 치지 않는다', () => {
    const roomId = manager.createRoom(makeConfig());
    manager.joinRoom(roomId, makeHuman('p1', 2000));

    const room = manager.getRoom(roomId)!;
    room.engine.state.players.find(p => p.id === 'p1')!.pendingRemoval = true;
    expect(manager.getRoomList('p1').find(r => r.id === roomId)?.mySeat).toBeUndefined();
  });
});
