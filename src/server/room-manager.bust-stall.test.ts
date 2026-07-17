import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { RoomManager } from './room-manager';
import type { RoomEconomyHooks } from './economy-runtime';
import { Player, RoomConfig } from '../lib/poker/types';

/**
 * 캐시 게임 파산 정지 계약 — 칩 보유 좌석이 2명 미만이 되면 방은 "오류"가 아니라
 * "대기 상태"다.
 * 회귀 1: 휴먼 헤즈업에서 한 명이 파산하면 둘 다 '다음 핸드 대기'로 영영 멈추고
 *   아무 안내도 없던 버그 — 정지 사유를 시스템 채팅으로 1회 안내하고, 재입장(리바이)이
 *   오면 다시 시작해야 한다.
 * 회귀 2: practice 캐시에서 인원 부족이 schedulePreHandRetry 소진 →
 *   economyBlockedRooms 영구 차단으로 빠져 방이 되살아나지 못하던 경로.
 * 회귀 3: 파산한 봇 좌석이 회수되지 않아 봇/혼합 방이 서서히 정지로 잠식되던 문제 —
 *   핸드 사이에 파산 봇을 내보내고 설정 수까지 새 봇으로 재충원한다.
 */

const STALL_NOTICE = '칩을 가진 플레이어가 2명 이상';

function makeConfig(overrides: Partial<RoomConfig> = {}): RoomConfig {
  return {
    name: '파산 정지 테스트 방',
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

function economyHooks(): RoomEconomyHooks {
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
  };
}

/** 현재 핸드를 폴드 연쇄로 종료시킨다 (마지막 생존자 승리) */
function foldOutHand(manager: RoomManager, roomId: string): void {
  const st = manager.getRoom(roomId)!.engine.state;
  let guard = 0;
  while (st.isHandInProgress && guard++ < 12) {
    const actor = st.players[st.activePlayerIndex];
    manager.processPlayerAction(roomId, actor.id, 'fold');
  }
  expect(st.isHandInProgress).toBe(false);
}

function stallNotices(manager: RoomManager, roomId: string): number {
  return manager.getChatHistory(roomId)
    .filter(m => m.message.includes(STALL_NOTICE)).length;
}

describe('캐시 파산 정지 — 안내와 복구', () => {
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

  it('휴먼 헤즈업(practice): 파산 정지 시 안내를 1회 보내고, 차단 없이 재입장으로 재개된다', () => {
    const roomId = manager.createRoom(makeConfig());
    manager.joinRoom(roomId, makeHuman('p1', 0));
    manager.joinRoom(roomId, makeHuman('p2', 1));
    vi.advanceTimersByTime(2500);

    const st = manager.getRoom(roomId)!.engine.state;
    expect(st.isHandInProgress).toBe(true);
    foldOutHand(manager, roomId);

    // 패자 파산 시뮬레이션 — 실전에선 올인 패배로 chips 0 + status 'all-in' 잔존
    const winnerId = st.winners![0].playerId;
    const loser = st.players.find(p => p.id !== winnerId)!;
    loser.chips = 0;
    loser.status = 'all-in';

    // 승리 연출(6.5s) 뒤 다음 핸드 예약이 정지 상태를 감지한다
    vi.advanceTimersByTime(7000);
    expect(st.isHandInProgress).toBe(false);
    expect(st.handNumber).toBe(1);
    expect(stallNotices(manager, roomId)).toBe(1);

    // 시간이 더 지나도 재시도 루프/중복 안내/영구 차단 없이 유휴 대기
    vi.advanceTimersByTime(30_000);
    expect(st.handNumber).toBe(1);
    expect(stallNotices(manager, roomId)).toBe(1);
    expect(manager.getRuntimeStats().pendingStartTimers).toBe(0);

    // 새 바이인 입장(리바이와 동일 경로)이 오면 다음 핸드가 시작된다
    manager.joinRoom(roomId, makeHuman('p3', 2));
    vi.advanceTimersByTime(2500);
    expect(st.handNumber).toBe(2);
    expect(st.isHandInProgress).toBe(true);
  });

  it('휴먼 헤즈업(wallet): 파산 정지 시 안내를 보내고, 나갔다 재입장하면 재개된다', () => {
    manager.shutdown();
    manager = new RoomManager(() => {}, () => {}, undefined, { economy: economyHooks() });
    const roomId = manager.createRoom(makeConfig({ economyMode: 'wallet' }));
    manager.joinRoom(roomId, makeHuman('p1', 0));
    manager.joinRoom(roomId, makeHuman('p2', 1));
    vi.advanceTimersByTime(2500);

    const st = manager.getRoom(roomId)!.engine.state;
    expect(st.isHandInProgress).toBe(true);
    foldOutHand(manager, roomId);

    const winnerId = st.winners![0].playerId;
    const loser = st.players.find(p => p.id !== winnerId)!;
    loser.chips = 0;
    loser.status = 'all-in';

    vi.advanceTimersByTime(7000);
    expect(st.handNumber).toBe(1);
    expect(stallNotices(manager, roomId)).toBe(1);

    // 파산자가 완전히 나간 뒤 새 바이인으로 다시 앉으면(리바이) 게임이 재개된다
    manager.leaveRoom(roomId, loser.id);
    manager.joinRoom(roomId, makeHuman(loser.id, 1));
    vi.advanceTimersByTime(2500);
    expect(st.handNumber).toBe(2);
    expect(st.isHandInProgress).toBe(true);
  });

  it('여러 명 중 한 명만 파산하면 게임은 계속되고 정지 안내는 없다', () => {
    const roomId = manager.createRoom(makeConfig());
    manager.joinRoom(roomId, makeHuman('p1', 0));
    manager.joinRoom(roomId, makeHuman('p2', 1));
    manager.joinRoom(roomId, makeHuman('p3', 2));
    vi.advanceTimersByTime(2500);

    const st = manager.getRoom(roomId)!.engine.state;
    foldOutHand(manager, roomId);

    const winnerId = st.winners![0].playerId;
    const loser = st.players.find(p => p.id !== winnerId)!;
    loser.chips = 0;
    loser.status = 'all-in';

    vi.advanceTimersByTime(7000);
    expect(st.handNumber).toBe(2);
    expect(st.isHandInProgress).toBe(true);
    expect(st.players.find(p => p.id === loser.id)!.status).toBe('sitting-out');
    expect(stallNotices(manager, roomId)).toBe(0);
  });

  it('파산한 봇은 핸드 사이에 회수되고 설정 수까지 새 봇으로 재충원된다', () => {
    const roomId = manager.createRoom(makeConfig({ tableType: 'mixed', botCount: 2 }));
    manager.joinRoom(roomId, makeHuman('p1', 0));

    const st = manager.getRoom(roomId)!.engine.state;
    const bots = st.players.filter(p => p.type === 'bot');
    expect(bots).toHaveLength(2);
    const bustedIds = bots.map(p => p.id);
    for (const bot of bots) bot.chips = 0;

    // 예약된 첫 핸드 시작(2s)이 파산 봇을 내보내고 새 봇으로 채운 뒤 시작해야 한다
    vi.advanceTimersByTime(2100);
    expect(st.isHandInProgress).toBe(true);
    const refreshed = st.players.filter(p => p.type === 'bot');
    expect(refreshed).toHaveLength(2);
    for (const bot of refreshed) {
      expect(bot.chips).toBeGreaterThan(0);
      expect(bustedIds).not.toContain(bot.id);
    }
    expect(
      manager.getChatHistory(roomId)
        .filter(m => m.message.includes('칩을 모두 잃어 자리에서 일어납니다')).length,
    ).toBe(2);
  });
});
