import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RoomManager, type StoryRoomHooks } from './room-manager';
import { GRADUATION_LEVEL_MS, GRADUATION_STARTING_STACK, resolveSngStructure } from './sng-structures';
import { parseCreateRoomRequest } from './socket-payload';
import { SNG_LEVEL_DURATION_MS, SNG_STARTING_STACK } from '../lib/poker/blind-schedule';
import { createBotWithCharacter } from '../lib/bot/bot-manager';
import type { ChatMessage, Player, RoomConfig } from '../lib/poker/types';
import type { PokerEngine } from '../lib/poker/engine';

/**
 * 졸업 SnG 구조(1,000칩 · 2분)와 일반 SnG(1,500 · 3분) 불변 회귀.
 *
 * 계약:
 *  ① 구조는 방 레코드가 소유하고 시작 공지·레벨 시계·봇 스택이 같은 값을 읽는다.
 *  ② `sngStructureId`는 서버 전용 — create-room payload 파서가 필드를 **제거**한다.
 *  ③ 스토리 SnG는 일반 SnG 진행도(completeSng)·봇 충원·자리비움 시작을 쓰지 않고,
 *     좌석은 grace 만료에도 보존한다(SnG 계약 공유).
 */

const GRAD_BOTS = ['paeng', 'luna', 'vivian', 'elena', 'ingrid'] as const;

function storySngConfig(overrides: Partial<RoomConfig> = {}): RoomConfig {
  return {
    name: '수련 · 졸업 시험',
    smallBlind: 10,
    bigBlind: 20,
    minBuyIn: GRADUATION_STARTING_STACK,
    maxBuyIn: GRADUATION_STARTING_STACK,
    maxPlayers: 6,
    economyMode: 'practice',
    turnTime: 30,
    gameMode: 'sng',
    startingStack: GRADUATION_STARTING_STACK,
    sngStructureId: 'graduation',
    botCount: 0,
    tableType: 'bots',
    storyChapterId: 'act4-ch12',
    storyRunId: 'run-grad',
    storyHandTag: 'sparring',
    botThinkScale: 0.5,
    ...overrides,
  };
}

function plainSngConfig(overrides: Partial<RoomConfig> = {}): RoomConfig {
  return {
    name: '일반 SnG',
    smallBlind: 10,
    bigBlind: 20,
    minBuyIn: SNG_STARTING_STACK,
    maxBuyIn: SNG_STARTING_STACK,
    maxPlayers: 6,
    economyMode: 'practice',
    turnTime: 30,
    gameMode: 'sng',
    startingStack: SNG_STARTING_STACK,
    botCount: 0,
    tableType: 'mixed',
    ...overrides,
  };
}

function makeHero(id: string, chips: number): Player {
  return {
    id,
    name: '수련생',
    type: 'human',
    avatar: 'player',
    chips,
    seatIndex: 0,
    holeCards: [],
    currentBet: 0,
    totalContributed: 0,
    status: 'waiting',
    hasActed: false,
    timeBankChips: 1,
  };
}

function storyHooks(): StoryRoomHooks {
  return {
    isHeld: () => false,
    beforeHand: () => 'deal',
    skipHandProgression: () => true,
    onHandComplete: () => 'hold',
    onBotActed: () => {},
    onPlayerLeave: () => {},
    onRoomDisposed: () => {},
  };
}

describe('Sit & Go 구조 레지스트리', () => {
  it('표준과 졸업 구조는 시작 스택·레벨 길이만 다르고 블라인드 표를 공유한다', () => {
    const standard = resolveSngStructure();
    const graduation = resolveSngStructure('graduation');
    expect(standard.startingStack).toBe(SNG_STARTING_STACK);
    expect(standard.levelMs).toBe(SNG_LEVEL_DURATION_MS);
    expect(graduation.startingStack).toBe(GRADUATION_STARTING_STACK);
    expect(graduation.levelMs).toBe(GRADUATION_LEVEL_MS);
    expect(graduation.levels).toBe(standard.levels);
    expect(graduation.levels[0]).toEqual({ smallBlind: 10, bigBlind: 20 });
  });

  it('SNG_LEVEL_MS로 졸업 레벨 길이를 단축할 수 있다', () => {
    vi.stubEnv('SNG_LEVEL_MS', '1500');
    try {
      expect(resolveSngStructure('graduation').levelMs).toBe(1500);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it('create-room payload는 sngStructureId를 버린다(서버 전용 필드)', () => {
    const parsed = parseCreateRoomRequest({
      name: '침투 시도',
      bigBlind: 20,
      turnTime: 15,
      botCount: 2,
      gameMode: 'sng',
      difficulty: 'normal',
      tableType: 'mixed',
      economyMode: 'practice',
      sngStructureId: 'graduation',
    });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect('sngStructureId' in parsed.value).toBe(false);
  });
});

describe('RoomManager 졸업 SnG', () => {
  let manager: RoomManager;
  let chat: ChatMessage[];
  let completeSng: ReturnType<typeof vi.fn>;

  function seatTable(roomId: string, stack: number): void {
    manager.joinRoom(roomId, makeHero('hero', stack));
    GRAD_BOTS.forEach((characterId, index) => {
      const bot = createBotWithCharacter(index + 1, stack, characterId, 'normal');
      expect(bot).toBeTruthy();
      expect(manager.joinRoom(roomId, bot!)).toBe(true);
    });
  }

  beforeEach(() => {
    vi.useFakeTimers();
    chat = [];
    completeSng = vi.fn();
    manager = new RoomManager(
      () => {},
      (_roomId: string, message: ChatMessage) => { chat.push(message); },
      undefined,
      {
        progression: {
          captureHandStart: () => {},
          confirmHandStart: () => {},
          cancelHand: () => {},
          completeHand: () => {},
          completeSng: completeSng as unknown as (input: { roomId: string; roomRunId: string; results: Array<{ profileId: string; place: number }> }) => void,
          disposeRoom: () => {},
        },
      },
    );
    manager.setStoryHooks(storyHooks());
  });

  afterEach(() => {
    manager.shutdown();
    vi.useRealTimers();
  });

  it('졸업 구조는 스토리 방에서만 열린다', () => {
    expect(() => manager.createRoom(plainSngConfig({ sngStructureId: 'graduation' }))).toThrow(/story room/);
    expect(() => manager.createRoom(storySngConfig({ sngStructureId: 'nope' as never }))).toThrow(/Unknown Sit & Go structure/);
    const roomId = manager.createRoom(storySngConfig());
    expect(manager.getRoom(roomId)).toBeTruthy();
  });

  it('졸업 SnG는 1,000칩·2분 시계로 시작하고 일반 SnG는 1,500·3분 그대로다', () => {
    const gradRoom = manager.createRoom(storySngConfig());
    seatTable(gradRoom, GRADUATION_STARTING_STACK);
    vi.advanceTimersByTime(2_000);
    const startedAt = Date.now();
    const grad = manager.getRoom(gradRoom)!.engine.state.tournament!;
    expect(grad.entrants).toBe(6);
    expect(grad.levelEndsAt - startedAt).toBe(GRADUATION_LEVEL_MS);
    expect(grad.nextSmallBlind).toBe(15);
    expect(grad.nextBigBlind).toBe(30);
    expect(manager.getRoom(gradRoom)!.engine.state.players.every(p => p.chips + p.totalContributed === GRADUATION_STARTING_STACK)).toBe(true);
    expect(chat.some(message => message.message.includes('2분마다 인상'))).toBe(true);

    chat = [];
    const plainRoom = manager.createRoom(plainSngConfig());
    seatTable(plainRoom, SNG_STARTING_STACK);
    vi.advanceTimersByTime(2_000);
    const plainStartedAt = Date.now();
    const plain = manager.getRoom(plainRoom)!.engine.state.tournament!;
    expect(plain.levelEndsAt - plainStartedAt).toBe(SNG_LEVEL_DURATION_MS);
    expect(chat.some(message => message.message.includes(`${SNG_LEVEL_DURATION_MS / 60000}분마다 인상`))).toBe(true);
  });

  it('스토리 SnG는 일반 SnG 진행도(completeSng)를 적립하지 않는다', () => {
    const roomId = manager.createRoom(storySngConfig());
    seatTable(roomId, GRADUATION_STARTING_STACK);
    vi.advanceTimersByTime(2_000);
    const engine = manager.getRoom(roomId)!.engine;
    // 우승 확정 상태를 만든 뒤 방을 닫는다 (dispose 경로가 정산을 확정한다)
    forceWinner(engine, 'hero');
    expect(manager.disposeRoom(roomId, 'story-end')).toBe(true);
    expect(completeSng).not.toHaveBeenCalled();
  });

  it('일반 SnG는 completeSng를 그대로 적립한다', () => {
    const roomId = manager.createRoom(plainSngConfig());
    seatTable(roomId, SNG_STARTING_STACK);
    vi.advanceTimersByTime(2_000);
    const engine = manager.getRoom(roomId)!.engine;
    forceWinner(engine, 'hero');
    expect(manager.disposeRoom(roomId, 'manual')).toBe(true);
    expect(completeSng).toHaveBeenCalledTimes(1);
  });

  it('스토리 방은 봇 충원 요청을 거절한다', () => {
    const roomId = manager.createRoom(storySngConfig());
    manager.joinRoom(roomId, makeHero('hero', GRADUATION_STARTING_STACK));
    expect(manager.fillWithBots(roomId, 'hero')).toBe(false);
    expect(manager.getRoom(roomId)!.engine.state.players).toHaveLength(1);
  });

  it('스토리 SnG는 자리비움 시작은 막고 [게임 복귀]만 허용한다', () => {
    const roomId = manager.createRoom(storySngConfig());
    seatTable(roomId, GRADUATION_STARTING_STACK);
    vi.advanceTimersByTime(2_000);
    const engine = manager.getRoom(roomId)!.engine;
    const hero = engine.state.players.find(p => p.id === 'hero')!;

    expect(manager.toggleSitOut(roomId, 'hero')).toBe(false);
    expect(hero.sitOutNext).toBeFalsy();

    // 서버가 부재로 마킹한 좌석(턴 타임아웃)만 복귀할 수 있다 — 진행 중 상태는 보존한다
    hero.sitOutNext = true;
    hero.sitOutAuto = true;
    const statusBefore = hero.status;
    expect(manager.toggleSitOut(roomId, 'hero')).toBe(true);
    expect(hero.sitOutNext).toBe(false);
    expect(hero.sitOutAuto).toBeUndefined();
    if (statusBefore === 'active' || statusBefore === 'all-in') expect(hero.status).toBe(statusBefore);
  });

  it('스토리 SnG 좌석은 grace 만료에도 보존된다', () => {
    const roomId = manager.createRoom(storySngConfig());
    seatTable(roomId, GRADUATION_STARTING_STACK);
    vi.advanceTimersByTime(2_000);
    manager.handleDisconnect(roomId, 'hero');
    expect(manager.handleGraceExpired(roomId, 'hero')).toBe(true);
    expect(manager.getRoom(roomId)!.engine.state.players.some(p => p.id === 'hero')).toBe(true);
  });
});

/** 히어로 1인 생존 상태로 만들고 순위를 확정한다 (핸드 밖 조작 — 정산 경로 검증용) */
function forceWinner(engine: PokerEngine, winnerId: string): void {
  const state = engine.state;
  state.isHandInProgress = false;
  const tournament = state.tournament!;
  let place = state.players.length;
  for (const player of state.players) {
    if (player.id === winnerId) continue;
    player.chips = 0;
    player.finishPlace = place;
    tournament.results.push({ playerId: player.id, name: player.name, place, prize: 0 });
    place -= 1;
  }
  const winner = state.players.find(player => player.id === winnerId)!;
  winner.chips = state.players.length * 1_000;
  winner.finishPlace = 1;
  tournament.results.push({ playerId: winner.id, name: winner.name, place: 1, prize: tournament.prizes[0] ?? 0 });
  tournament.finished = true;
}
