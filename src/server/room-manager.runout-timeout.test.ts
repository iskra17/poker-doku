import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { RoomManager } from './room-manager';
import { Player, RoomConfig, GameMode } from '../lib/poker/types';

/**
 * 신규 계약 회귀 테스트 (2026-07-17):
 * 1. 올인 런아웃 단계 연출 — 베팅이 닫히면 핸드를 먼저 공개하고 스트리트를 시간차로 깐다.
 * 2. 완전 타임아웃(타임뱅크 소진 포함) → 자동 체크/폴드 + 자리비움 마킹.
 * 3. 접속 끊김 회수 카운트다운 — grace 만료로 좌석이 제거되는 경우에만 deadline 노출.
 */

function makeConfig(gameMode: GameMode = 'cash'): RoomConfig {
  return {
    name: '런아웃 테스트 방',
    smallBlind: 10,
    bigBlind: 20,
    minBuyIn: 800,
    maxBuyIn: 4000,
    maxPlayers: 6,
    turnTime: 8,
    gameMode,
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

function startedRoom(manager: RoomManager, gameMode: GameMode = 'cash'): string {
  const roomId = manager.createRoom(makeConfig(gameMode));
  const seats = gameMode === 'sng' ? 6 : 3;
  for (let i = 0; i < seats; i++) {
    manager.joinRoom(roomId, makeHuman(`p${i + 1}`, i));
  }
  vi.advanceTimersByTime(2500);
  return roomId;
}

describe('올인 런아웃 단계 연출', () => {
  let manager: RoomManager;

  beforeEach(() => {
    vi.useFakeTimers();
    manager = new RoomManager(() => {}, () => {});
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it('전원 올인 시 즉시 런아웃하지 않고 핸드 공개 후 스트리트를 시간차로 깐다', () => {
    const roomId = startedRoom(manager);
    const engine = manager.getRoom(roomId)!.engine;
    const st = engine.state;

    // 프리플랍 전원 올인
    manager.processPlayerAction(roomId, st.players[st.activePlayerIndex].id, 'all-in');
    manager.processPlayerAction(roomId, st.players[st.activePlayerIndex].id, 'call');
    manager.processPlayerAction(roomId, st.players[st.activePlayerIndex].id, 'call');

    // 런아웃 모드 진입 — 보드는 아직 깔리지 않았고 핸드는 진행 중
    expect(st.allInRunout).toBe(true);
    expect(st.isHandInProgress).toBe(true);
    expect(st.communityCards).toHaveLength(0);
    expect(st.activePlayerIndex).toBe(-1);

    // 런아웃 중 생존자 홀카드는 관전 시점에도 공개된다 (표준 룰: 올인 확정 시 핸드 오픈)
    const publicState = engine.getPublicState('observer');
    for (const p of publicState.players) {
      if (p.status === 'all-in') {
        expect(p.revealed).toBe(true);
      }
    }

    // 스트리트 시간차 딜: 플랍 → 턴 → 리버 → 쇼다운
    vi.advanceTimersByTime(1700);
    expect(st.communityCards).toHaveLength(3);
    expect(st.isHandInProgress).toBe(true);

    vi.advanceTimersByTime(1700);
    expect(st.communityCards).toHaveLength(4);

    vi.advanceTimersByTime(1700);
    expect(st.communityCards).toHaveLength(5);
    expect(st.isHandInProgress).toBe(true); // 리버 후 쇼다운까지 한 박자 더

    vi.advanceTimersByTime(1700);
    expect(st.isHandInProgress).toBe(false);
    expect(st.street).toBe('showdown');
    expect(st.winners).not.toBeNull();
  });

  it('런아웃 도중 이탈해도 딜 체인이 교착 없이 핸드를 끝낸다', () => {
    const roomId = startedRoom(manager);
    const engine = manager.getRoom(roomId)!.engine;
    const st = engine.state;

    manager.processPlayerAction(roomId, st.players[st.activePlayerIndex].id, 'all-in');
    manager.processPlayerAction(roomId, st.players[st.activePlayerIndex].id, 'call');
    manager.processPlayerAction(roomId, st.players[st.activePlayerIndex].id, 'call');
    expect(st.allInRunout).toBe(true);

    vi.advanceTimersByTime(1700); // 플랍까지 깐 상태에서
    manager.leaveRoom(roomId, 'p2'); // 올인 좌석 하나가 떠난다 (폴드 + pendingRemoval)

    // 남은 두 좌석으로 런아웃이 계속되어 핸드가 끝나야 한다
    vi.advanceTimersByTime(1700 * 4);
    expect(engine.state.isHandInProgress).toBe(false);
    expect(engine.state.winners).not.toBeNull();
  });
});

describe('완전 타임아웃 → 자동 폴드 + 자리비움', () => {
  let manager: RoomManager;

  beforeEach(() => {
    vi.useFakeTimers();
    manager = new RoomManager(() => {}, () => {});
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it('타임뱅크가 없으면 턴 시간 초과 시 자동 폴드/체크 + 자리비움 마킹된다', () => {
    const roomId = startedRoom(manager);
    const st = manager.getRoom(roomId)!.engine.state;
    const actor = st.players[st.activePlayerIndex];
    expect(actor.timeBankChips ?? 0).toBe(0);

    vi.advanceTimersByTime(8_100);

    expect(actor.sitOutNext).toBe(true);
    const stillMyTurn = st.isHandInProgress && st.players[st.activePlayerIndex]?.id === actor.id;
    expect(stillMyTurn).toBe(false);
  });

  it('타임뱅크가 있으면 먼저 자동 사용해 연장하고, 다 쓴 뒤에야 자리비움 처리된다', () => {
    const roomId = startedRoom(manager);
    const st = manager.getRoom(roomId)!.engine.state;
    const actor = st.players[st.activePlayerIndex];
    actor.timeBankChips = 1;

    vi.advanceTimersByTime(8_100); // 기본 시간 초과 → 타임칩 자동 사용 (+30초)
    expect(actor.timeBankChips).toBe(0);
    expect(actor.sitOutNext).toBeFalsy();
    expect(st.players[st.activePlayerIndex]?.id).toBe(actor.id); // 아직 본인 턴

    vi.advanceTimersByTime(30_100); // 연장분도 소진 → 폴드 + 자리비움
    expect(actor.sitOutNext).toBe(true);
    const stillMyTurn = st.isHandInProgress && st.players[st.activePlayerIndex]?.id === actor.id;
    expect(stillMyTurn).toBe(false);
  });
});

describe('접속 끊김 회수 카운트다운 노출', () => {
  let manager: RoomManager;

  beforeEach(() => {
    vi.useFakeTimers();
    manager = new RoomManager(() => {}, () => {});
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it('캐시 비자리비움 좌석: deadline이 스냅샷에 실리고 재접속 시 해제된다', () => {
    const roomId = startedRoom(manager);
    const st = manager.getRoom(roomId)!.engine.state;
    const target = st.players.find(p => p.id !== st.players[st.activePlayerIndex]?.id)!;
    const deadline = Date.now() + 60_000;

    manager.handleDisconnect(roomId, target.id, deadline);
    expect(target.isDisconnected).toBe(true);
    expect(target.disconnectGraceDeadline).toBe(deadline);

    manager.handleReconnect(roomId, target.id);
    expect(target.isDisconnected).toBe(false);
    expect(target.disconnectGraceDeadline).toBeUndefined();
  });

  it('SnG 좌석은 grace 만료에도 보존되므로 deadline을 노출하지 않는다', () => {
    const roomId = startedRoom(manager, 'sng');
    const st = manager.getRoom(roomId)!.engine.state;
    const target = st.players.find(p => p.id !== st.players[st.activePlayerIndex]?.id)!;

    manager.handleDisconnect(roomId, target.id, Date.now() + 60_000);
    expect(target.isDisconnected).toBe(true);
    expect(target.disconnectGraceDeadline).toBeUndefined();
  });

  it('캐시 자리비움 좌석: grace 만료로 좌석을 지키면 deadline이 해제된다', () => {
    const roomId = startedRoom(manager);
    const st = manager.getRoom(roomId)!.engine.state;
    const target = st.players.find(p => p.id !== st.players[st.activePlayerIndex]?.id)!;
    target.sitOutNext = true;

    manager.handleDisconnect(roomId, target.id, Date.now() + 60_000);
    // 자리비움 좌석은 grace 만료에도 유지되므로 처음부터 deadline이 실리지 않는다
    expect(target.disconnectGraceDeadline).toBeUndefined();

    const kept = manager.handleGraceExpired(roomId, target.id);
    expect(kept).toBe(true);
    expect(target.disconnectGraceDeadline).toBeUndefined();
  });
});
