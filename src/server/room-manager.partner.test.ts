import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { RoomManager } from './room-manager';
import { Player, RoomConfig } from '../lib/poker/types';

/**
 * 파트너 우선 착석(ensurePartnerBot) 계약 —
 * 혼자 연습(bots) 방에서 인연 파트너 캐릭터를 테이블에 보장한다.
 * 빈 좌석이 있으면 추가, 만석이면 봇 하나가 양보, 이미 있으면 no-op,
 * bots 외 구성/핸드 진행 중에는 동작하지 않는다.
 * 휴먼 아바타와 같은 캐릭터는 앉히지 않는다 (2026-10-18 플레이테스트 — 같은 얼굴 중복).
 * join-room 경로는 2026-10-19부터 이 함수를 부르지 않는다(파트너 = 훈수 담당).
 */

function makeConfig(overrides: Partial<RoomConfig> = {}): RoomConfig {
  return {
    name: '파트너 테스트 방',
    smallBlind: 10,
    bigBlind: 20,
    minBuyIn: 800,
    maxBuyIn: 4000,
    maxPlayers: 6,
    turnTime: 8,
    gameMode: 'cash',
    tableType: 'bots',
    botCount: 0,
    ...overrides,
  };
}

function makeHuman(id: string, seatIndex = 0, avatar = 'player'): Player {
  return {
    id,
    name: `휴먼-${id}`,
    type: 'human',
    avatar,
    chips: 2000,
    seatIndex,
    holeCards: [],
    currentBet: 0,
    totalContributed: 0,
    status: 'waiting',
    hasActed: false,
  };
}

function seatedCharacters(manager: RoomManager, roomId: string): string[] {
  return manager.getRoom(roomId)!.engine.state.players
    .filter(p => p.type === 'bot')
    .map(p => p.personalityId || p.avatar || '');
}

describe('ensurePartnerBot — 파트너 우선 착석', () => {
  let manager: RoomManager;

  beforeEach(() => {
    vi.useFakeTimers();
    manager = new RoomManager(() => {}, () => {});
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it('빈 좌석이 있으면 파트너 봇을 추가한다', () => {
    const roomId = manager.createRoom(makeConfig());
    manager.joinRoom(roomId, makeHuman('p1', 0));

    expect(manager.ensurePartnerBot(roomId, 'sakura')).toBe(true);
    expect(seatedCharacters(manager, roomId)).toContain('sakura');
  });

  it('이미 파트너가 앉아 있으면 구성을 바꾸지 않는다', () => {
    const roomId = manager.createRoom(makeConfig());
    manager.joinRoom(roomId, makeHuman('p1', 0));
    manager.ensurePartnerBot(roomId, 'sakura');
    const before = manager.getRoom(roomId)!.engine.state.players.length;

    expect(manager.ensurePartnerBot(roomId, 'sakura')).toBe(true);
    expect(manager.getRoom(roomId)!.engine.state.players.length).toBe(before);
    expect(seatedCharacters(manager, roomId).filter(id => id === 'sakura')).toHaveLength(1);
  });

  it('만석이면 봇 하나가 자리를 양보한다 (총원 유지)', () => {
    const roomId = manager.createRoom(makeConfig({ botCount: 5 }));
    const room = manager.getRoom(roomId)!;
    manager.joinRoom(roomId, makeHuman('p1', 0));
    // botCount만큼 즉시 충원되지 않았다면 테스트 셋업으로 직접 채움
    while (room.engine.state.players.length < 6) {
      manager.ensurePartnerBot(roomId, 'nonexistent'); // no-op (미지 캐릭터)
      break;
    }
    // 남은 좌석을 파트너 아닌 봇으로 채우기 위해 mixed 캐릭터를 순차 보장
    for (const filler of ['hana', 'chloe', 'vivian', 'elena', 'ara']) {
      if (room.engine.state.players.length >= 6) break;
      manager.ensurePartnerBot(roomId, filler);
    }
    expect(room.engine.state.players.length).toBe(6);
    // 자동 충원은 랜덤 캐릭터라 특정 캐릭터 부재를 단정할 수 없다 — 봇 5석이므로
    // 스타터 6명 중 최소 1명은 반드시 비어 있고, 그 캐릭터를 파트너로 쓴다 (flaky 방지)
    const partner = ['sakura', 'ara', 'hana', 'chloe', 'vivian', 'elena']
      .find(id => !seatedCharacters(manager, roomId).includes(id))!;
    expect(seatedCharacters(manager, roomId)).not.toContain(partner);

    expect(manager.ensurePartnerBot(roomId, partner)).toBe(true);
    expect(room.engine.state.players.length).toBe(6);
    expect(seatedCharacters(manager, roomId)).toContain(partner);
    // 휴먼 좌석은 그대로
    expect(room.engine.state.players.some(p => p.id === 'p1')).toBe(true);
  });

  it('휴먼 아바타가 파트너와 같은 캐릭터면 파트너 봇을 앉히지 않는다', () => {
    const roomId = manager.createRoom(makeConfig());
    manager.joinRoom(roomId, makeHuman('p1', 0, 'sakura'));
    const before = manager.getRoom(roomId)!.engine.state.players.length;

    expect(manager.ensurePartnerBot(roomId, 'sakura')).toBe(false);
    expect(seatedCharacters(manager, roomId)).not.toContain('sakura');
    expect(manager.getRoom(roomId)!.engine.state.players.length).toBe(before);
    // 다른 캐릭터는 그대로 앉힐 수 있다
    expect(manager.ensurePartnerBot(roomId, 'hana')).toBe(true);
  });

  it('bots 외 구성과 미지 캐릭터는 거절한다', () => {
    const mixedId = manager.createRoom(makeConfig({ tableType: 'mixed' }));
    expect(manager.ensurePartnerBot(mixedId, 'sakura')).toBe(false);

    const botsId = manager.createRoom(makeConfig());
    manager.joinRoom(botsId, makeHuman('p1', 0));
    expect(manager.ensurePartnerBot(botsId, 'dealer')).toBe(false);
    expect(manager.ensurePartnerBot(botsId, 'unknown-character')).toBe(false);
  });
});

/**
 * 훈수 파트너 제외(excludePartnerFromBots) 계약 — 사용자 결정 2026-10-19:
 * 혼자 연습(bots) 방에서 파트너는 훈수 담당이고 상대석에 앉지 않는다.
 * 랜덤 충원이 파트너를 고르지 않고, 이미 앉은 파트너 봇은 핸드 경계에서만 교체되며,
 * 제외 규칙은 방 리셋 뒤 다음 방문자에게 새지 않는다. bots 외 구성은 영향 없음.
 */
describe('excludePartnerFromBots — 훈수 파트너는 상대석에 앉지 않는다', () => {
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

  /** 진행 중 핸드를 폴드 연쇄로 종료 */
  function foldOutHand(roomId: string): void {
    const st = manager.getRoom(roomId)!.engine.state;
    expect(st.isHandInProgress).toBe(true);
    let guard = 0;
    while (st.isHandInProgress && guard++ < 12) {
      manager.processPlayerAction(roomId, st.players[st.activePlayerIndex].id, 'fold');
    }
    expect(st.isHandInProgress).toBe(false);
  }

  it('bots 방의 랜덤 봇 충원은 파트너를 고르지 않는다', () => {
    // 제외가 없으면 봇 5석 중 파트너가 나올 확률이 방마다 약 5/16 — 30방이면 사실상 반드시 걸린다
    for (let i = 0; i < 30; i++) {
      const roomId = manager.createRoom(makeConfig({ botCount: 5 }));
      expect(manager.excludePartnerFromBots(roomId, 'sakura', 'p1')).toBe(true);
      expect(manager.joinRoom(roomId, makeHuman('p1', 0))).toBe(true);
      const bots = seatedCharacters(manager, roomId);
      expect(bots).toHaveLength(5);
      expect(bots).not.toContain('sakura');
    }
  });

  it('이미 앉은 파트너 봇은 진행 중 핸드엔 그대로 두고 다음 핸드 경계에서 다른 캐릭터로 바꾼다', () => {
    const roomId = manager.createRoom(makeConfig({ botCount: 5 }));
    const room = manager.getRoom(roomId)!;
    manager.joinRoom(roomId, makeHuman('p1', 0));
    // 제외 규칙 전에 파트너 봇이 앉아 있던 상황 (예: 이전 구성·다른 경로)
    expect(manager.ensurePartnerBot(roomId, 'sakura')).toBe(true);
    expect(room.engine.state.players).toHaveLength(6);

    vi.advanceTimersByTime(2000);
    expect(room.engine.state.isHandInProgress).toBe(true);

    expect(manager.excludePartnerFromBots(roomId, 'sakura', 'p1')).toBe(true);
    // 진행 중 핸드의 좌석·팟 회계에는 손대지 않는다
    expect(seatedCharacters(manager, roomId)).toContain('sakura');
    expect(room.engine.state.players).toHaveLength(6);

    foldOutHand(roomId);
    vi.advanceTimersByTime(10_000);

    expect(seatedCharacters(manager, roomId)).not.toContain('sakura');
    expect(room.engine.state.players.filter(p => p.type === 'bot')).toHaveLength(5);
    expect(room.engine.state.players.some(p => p.id === 'p1')).toBe(true);
    // 제외 중에는 ensurePartnerBot도 파트너를 다시 앉히지 않는다
    expect(manager.ensurePartnerBot(roomId, 'sakura')).toBe(false);
  });

  it('휴먼이 떠나 방이 리셋되면 제외 규칙도 사라진다', () => {
    const roomId = manager.createRoom(makeConfig());
    manager.excludePartnerFromBots(roomId, 'sakura', 'p1');
    manager.joinRoom(roomId, makeHuman('p1', 0));
    expect(manager.ensurePartnerBot(roomId, 'sakura')).toBe(false);

    expect(manager.leaveRoom(roomId, 'p1')).toBe(true);
    // 같은 휴먼이 제외 등록 없이 다시 앉으면 이전 규칙이 남아 있지 않다
    expect(manager.joinRoom(roomId, makeHuman('p1', 0))).toBe(true);
    expect(manager.ensurePartnerBot(roomId, 'sakura')).toBe(true);
  });

  it('다른 휴먼이 앉은 bots 방에서는 거절될 입장자의 규칙으로 덮어쓰지 않는다', () => {
    const roomId = manager.createRoom(makeConfig());
    manager.excludePartnerFromBots(roomId, 'sakura', 'p1');
    manager.joinRoom(roomId, makeHuman('p1', 0));

    expect(manager.excludePartnerFromBots(roomId, 'hana', 'p2')).toBe(false);
    expect(manager.ensurePartnerBot(roomId, 'sakura')).toBe(false);
  });

  it('bots 외 구성(mixed)은 제외 규칙을 받지 않고 충원도 바뀌지 않는다', () => {
    const roomId = manager.createRoom(makeConfig({ tableType: 'mixed', botCount: 2 }));
    expect(manager.excludePartnerFromBots(roomId, 'sakura', 'p1')).toBe(false);
    manager.joinRoom(roomId, makeHuman('p1', 0));
    expect(seatedCharacters(manager, roomId)).toHaveLength(2);
  });
});
