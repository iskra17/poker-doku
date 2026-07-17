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

/**
 * 시간 초과 자동 마킹(sitOutAuto) 계약 — 명시적 자리비움과 달리 같은 핸드 안에서는
 * 매 스트리트 기본 턴 시간을 그대로 준다. 회귀: 플랍에서 한 번 시간 초과로 자동 체크되면
 * 턴/리버에서도 1초 만에 즉시 체크돼 버리던 문제 (2026-07-18).
 */
describe('시간 초과 자동 마킹 — 같은 핸드에선 매 스트리트 기본 시간을 보장한다', () => {
  let manager: RoomManager;

  beforeEach(() => {
    vi.useFakeTimers();
    manager = new RoomManager(() => {}, () => {});
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  /** 현재 액터를 체크/콜로 진행 (무한 루프 방지 가드 포함) */
  function act(roomId: string): void {
    const st = manager.getRoom(roomId)!.engine.state;
    const p = st.players[st.activePlayerIndex];
    const ok = manager.processPlayerAction(
      roomId, p.id, p.currentBet >= st.currentBet ? 'check' : 'call',
    );
    expect(ok).toBe(true);
  }

  /** 현재 스트리트가 끝날 때까지 나머지 액터들을 체크/콜로 진행 */
  function finishStreet(roomId: string, street: string): void {
    const st = manager.getRoom(roomId)!.engine.state;
    for (let i = 0; i < 10 && st.isHandInProgress && st.street === street; i++) act(roomId);
  }

  /** 프리플랍을 콜/체크로 마감하고, 플랍 첫 액터를 8초 시간 초과시켜 자동 마킹 상태로 만든다 */
  function timeoutOnFlop(roomId: string): Player {
    const st = manager.getRoom(roomId)!.engine.state;
    finishStreet(roomId, 'preflop');
    expect(st.street).toBe('flop');

    const target = st.players[st.activePlayerIndex];
    vi.advanceTimersByTime(8100); // 기본 턴 시간(8초) 소진 → 자동 체크 + 자동 마킹
    expect(target.sitOutNext).toBe(true);
    expect(target.sitOutAuto).toBe(true);
    return target;
  }

  it('플랍 시간 초과 후에도 턴 스트리트에서 기본 턴 타이머가 다시 주어진다 (1초 자동 처리 아님)', () => {
    const roomId = startedRoom(manager);
    const st = manager.getRoom(roomId)!.engine.state;
    const target = timeoutOnFlop(roomId);

    finishStreet(roomId, 'flop');
    expect(st.street).toBe('turn');
    expect(st.players[st.activePlayerIndex].id).toBe(target.id);

    // 기본 턴 타이머(8초)가 돌아야 한다 — 즉시 자동 처리 경로는 deadline을 세팅하지 않는다
    expect(manager.getTurnTimeRemaining(roomId)).toBeGreaterThan(5000);

    // 2초가 지나도 여전히 본인 턴 (버그 시절엔 1초 만에 자동 체크로 턴이 넘어갔다)
    vi.advanceTimersByTime(2000);
    expect(st.players[st.activePlayerIndex].id).toBe(target.id);

    // 기본 시간을 다 쓰면 그제야 자동 체크
    vi.advanceTimersByTime(6200);
    const stillMyTurn = st.isHandInProgress && st.players[st.activePlayerIndex].id === target.id;
    expect(stillMyTurn).toBe(false);
  });

  it('자동 마킹 상태에서 본인이 액션하면 마킹이 풀려 자동 복귀한다', () => {
    const roomId = startedRoom(manager);
    const st = manager.getRoom(roomId)!.engine.state;
    const target = timeoutOnFlop(roomId);

    finishStreet(roomId, 'flop');
    expect(st.players[st.activePlayerIndex].id).toBe(target.id);

    manager.processPlayerAction(roomId, target.id, 'check');
    expect(target.sitOutNext).toBe(false);
    expect(target.sitOutAuto).toBeFalsy();
  });

  it('끝내 액션하지 않으면 다음 핸드부터 일반 자리비움으로 전환된다 (캐시: 딜인 제외)', () => {
    const roomId = startedRoom(manager);
    const target = timeoutOnFlop(roomId);

    // 턴/리버는 target 시간 초과 + 나머지 체크로 핸드를 끝까지 진행
    for (const street of ['flop', 'turn', 'river']) {
      finishStreet(roomId, street);
      const st = manager.getRoom(roomId)!.engine.state;
      if (!st.isHandInProgress) break;
      if (st.players[st.activePlayerIndex].id === target.id) vi.advanceTimersByTime(8100);
    }
    // 쇼다운 정산 + 다음 핸드 예약(승리 연출 6.5초) 소화
    vi.advanceTimersByTime(8000);

    const st = manager.getRoom(roomId)!.engine.state;
    const seat = st.players.find(p => p.id === target.id)!;
    expect(st.isHandInProgress).toBe(true); // 남은 2명으로 다음 핸드 진행
    expect(seat.status).toBe('sitting-out'); // 자동 마킹 → 일반 자리비움 전환으로 딜인 제외
    expect(seat.sitOutAuto).toBeFalsy();
  });
});
