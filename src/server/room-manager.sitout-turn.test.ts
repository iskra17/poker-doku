import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { RoomManager } from './room-manager';
import { Player, RoomConfig, GameMode } from '../lib/poker/types';

/**
 * 자리비움 턴 처리 계약 — 자리에 없는 사람을 테이블이 기다리지 않는다.
 * 회귀: 캐시 게임에서 내 턴에 자리비움을 누르면 턴 타이머+타임뱅크가 모두 소진될 때까지
 * (최대 38초) 게임이 멈추던 버그. startPlayerLoop의 autoAct가 SnG로 한정돼 있던 것이 원인.
 */

function makeConfig(gameMode: GameMode = 'cash'): RoomConfig {
  return {
    name: '턴 테스트 방',
    smallBlind: 10,
    bigBlind: 20,
    minBuyIn: 800,
    maxBuyIn: 4000,
    maxPlayers: 6,
    turnTime: 8,
    gameMode,
    botCount: 0, // 봇 루프 배제 — 휴먼만으로 턴 흐름 검증
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

/**
 * 첫 핸드가 시작될 때까지 진행 (tryStartGame의 2초 예약 소화).
 * SnG는 6인이 모두 모여야 시작하므로 좌석을 가득 채운다.
 */
function startedRoom(manager: RoomManager, gameMode: GameMode = 'cash'): string {
  const roomId = manager.createRoom(makeConfig(gameMode));
  const seats = gameMode === 'sng' ? 6 : 3;
  for (let i = 0; i < seats; i++) {
    manager.joinRoom(roomId, makeHuman(`p${i + 1}`, i));
  }
  vi.advanceTimersByTime(2500);
  return roomId;
}

describe('자리비움 — 턴을 붙잡지 않는다', () => {
  let manager: RoomManager;

  beforeEach(() => {
    vi.useFakeTimers();
    manager = new RoomManager(() => {}, () => {});
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it('캐시: 내 턴에 자리비움을 누르면 타이머를 기다리지 않고 즉시 턴이 넘어간다', () => {
    const roomId = startedRoom(manager);
    const st = manager.getRoom(roomId)!.engine.state;
    expect(st.isHandInProgress).toBe(true);

    const actorId = st.players[st.activePlayerIndex].id;
    const applied = manager.toggleSitOut(roomId, actorId);

    // 타이머를 전혀 advance하지 않아도(=동기적으로) 턴이 넘어가 있어야 한다
    expect(applied).toBe(true);
    const stillMyTurn = st.isHandInProgress && st.players[st.activePlayerIndex].id === actorId;
    expect(stillMyTurn).toBe(false);
  });

  it('본인 턴의 타임칩 사용은 성공을 반환하고 칩을 소비해 30초 연장한다', () => {
    const roomId = startedRoom(manager);
    const st = manager.getRoom(roomId)!.engine.state;
    const activePlayer = st.players[st.activePlayerIndex];
    activePlayer.timeBankChips = 1;
    const remainingBefore = manager.getTurnTimeRemaining(roomId);

    const applied = manager.useTimeBank(roomId, activePlayer.id);

    expect(applied).toBe(true);
    expect(activePlayer.timeBankChips).toBe(0);
    expect(manager.getTurnTimeRemaining(roomId)).toBe(remainingBefore + 30_000);
  });

  it('캐시: 내 턴이 아닐 때 비운 자리도, 턴이 돌아오면 자동 처리되어 테이블이 멈추지 않는다', () => {
    const roomId = startedRoom(manager);
    const st = manager.getRoom(roomId)!.engine.state;

    // 바로 다음 액터를 미리 자리비움시킨다 (누르는 시점엔 본인 턴이 아니다 — 즉시 처리 경로가 아님)
    const actor = st.players[st.activePlayerIndex];
    const waiter = st.players[(st.activePlayerIndex + 1) % st.players.length];
    manager.toggleSitOut(roomId, waiter.id);
    expect(waiter.sitOutNext).toBe(true);
    expect(st.players[st.activePlayerIndex].id).toBe(actor.id); // 아직 턴은 그대로

    // 액터가 폴드해 waiter에게 턴이 넘어오면, 자동 처리 지연(1초) 안에 정리되어야 한다.
    // 버그 시절엔 여기서 일반 턴 타이머(8초)+타임뱅크(30초)가 붙어 테이블이 멈췄다.
    manager.processPlayerAction(roomId, actor.id, 'fold');
    vi.advanceTimersByTime(2000);

    const stuck = st.isHandInProgress && st.players[st.activePlayerIndex].id === waiter.id;
    expect(stuck).toBe(false);
  });

  it('SnG: 내 턴 자리비움도 동일하게 즉시 처리된다 (기존 동작 유지)', () => {
    const roomId = startedRoom(manager, 'sng');
    const st = manager.getRoom(roomId)!.engine.state;
    expect(st.isHandInProgress).toBe(true);

    const actorId = st.players[st.activePlayerIndex].id;
    manager.toggleSitOut(roomId, actorId);

    const stillMyTurn = st.isHandInProgress && st.players[st.activePlayerIndex].id === actorId;
    expect(stillMyTurn).toBe(false);
  });

  it('자리비움 → 복귀를 누르면 sitOutNext가 풀려 다시 정상 참여한다', () => {
    const roomId = startedRoom(manager);
    const room = manager.getRoom(roomId)!;
    const st = room.engine.state;

    const actorId = st.players[st.activePlayerIndex].id;
    const player = st.players.find(p => p.id === actorId)!;
    manager.toggleSitOut(roomId, actorId);
    expect(player.sitOutNext).toBe(true);

    manager.toggleSitOut(roomId, actorId);
    expect(player.sitOutNext).toBe(false);
    expect(player.status).not.toBe('sitting-out');
  });
});
