import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  RoomManager,
  type RoomDisposeReason,
  type RoomHandHistoryHooks,
  type StoryRoomHooks,
} from './room-manager';
import type { RoomProgressionHooks } from './progression-runtime';
import type { ChatMessage, Player, RoomConfig } from '../lib/poker/types';
import type { PokerEngine } from '../lib/poker/engine';
import { createBotWithCharacter } from '../lib/bot/bot-manager';
import { RiggedDeck, cards } from '../lib/poker/test-helpers';

/**
 * 수련 스토리 라이브 스텝 훅 회귀 (Phase 1b · 태스크 1b.0 — 기획 B3(d) 삽입점 #1~#14).
 *
 * 핵심 계약 두 줄:
 *  ① `isStoryRoom(room)` 가드 밖(캐시/SnG/MTT/아레나)의 실행 경로는 훅 주입 여부와 무관하게 불변이다.
 *  ② 스토리 방은 히어로 좌석을 서버 타이머로 회수하지 않는다 — 부재는 `beforeHand` hold,
 *     이탈은 `abandon-story` 단일 경로. 회수가 일어나면 빈 방 즉시 dispose로 런이 조용히 죽는다.
 */

const STORY_CHAPTER = 'act1-ch01';
const BOT_CHARACTERS = ['sakura', 'ara', 'hana', 'chloe', 'vivian'] as const;

function storyConfig(overrides: Partial<RoomConfig> = {}): RoomConfig {
  return {
    name: '스토리',
    smallBlind: 10,
    bigBlind: 20,
    minBuyIn: 2000,
    maxBuyIn: 2000,
    maxPlayers: 6,
    economyMode: 'practice',
    turnTime: 90,
    gameMode: 'cash',
    botCount: 2,
    tableType: 'bots',
    storyChapterId: STORY_CHAPTER,
    storyRunId: 'run-1',
    storyHandTag: 'practice',
    botThinkScale: 1,
    ...overrides,
  };
}

/**
 * 스토리 필드만 없는 대조군 방 — 훅이 붙어 있어도 기존 캐시 경로가 그대로 돌아야 한다.
 * 기본 botCount는 0: 라인업을 테스트가 명시해 스토리 방과 인원을 맞춘다
 * (자동 충원 자체를 보는 케이스만 botCount를 되돌린다).
 */
function plainConfig(overrides: Partial<RoomConfig> = {}): RoomConfig {
  return {
    name: '대조',
    smallBlind: 10,
    bigBlind: 20,
    minBuyIn: 2000,
    maxBuyIn: 2000,
    maxPlayers: 6,
    economyMode: 'practice',
    turnTime: 90,
    gameMode: 'cash',
    botCount: 0,
    tableType: 'bots',
    ...overrides,
  };
}

function makeHero(id = 'hero'): Player {
  return {
    id,
    name: '히어로',
    type: 'human',
    avatar: 'player',
    chips: 2000,
    seatIndex: 0,
    holeCards: [],
    currentBet: 0,
    totalContributed: 0,
    status: 'waiting',
    hasActed: false,
  };
}

type BeforeHandVerdict = 'deal' | 'hold';
type HandVerdict = 'continue' | 'hold' | 'gone';

interface StoryHookState {
  held: boolean;
  beforeHand: BeforeHandVerdict;
  skipProgression: boolean;
  verdict: HandVerdict;
  /** beforeHand 진입 순간의 좌석 상태를 검사·조작하기 위한 훅 (계약 검증용) */
  onBeforeHand?: (roomId: string, engine: PokerEngine) => void;
  onHandComplete?: (roomId: string) => void;
}

function makeStoryHooks() {
  const state: StoryHookState = {
    held: false,
    beforeHand: 'deal',
    skipProgression: false,
    verdict: 'continue',
  };
  const spies = {
    isHeld: vi.fn<(roomId: string) => boolean>(() => state.held),
    beforeHand: vi.fn<(roomId: string, engine: PokerEngine) => BeforeHandVerdict>(
      (roomId, engine) => {
        state.onBeforeHand?.(roomId, engine);
        return state.beforeHand;
      },
    ),
    skipHandProgression: vi.fn<(roomId: string) => boolean>(() => state.skipProgression),
    onHandComplete: vi.fn<(roomId: string) => HandVerdict>(roomId => {
      state.onHandComplete?.(roomId);
      return state.verdict;
    }),
    onBotActed: vi.fn<StoryRoomHooks['onBotActed']>(),
    onPlayerLeave: vi.fn<StoryRoomHooks['onPlayerLeave']>(),
    onRoomDisposed: vi.fn<NonNullable<StoryRoomHooks['onRoomDisposed']>>(),
  };
  const hooks: StoryRoomHooks = spies;
  return { state, spies, hooks };
}

type RecordedHand = Parameters<RoomHandHistoryHooks['recordCompletedHand']>[0];

type SeatReclaimedFn = (roomId: string, playerId: string, message?: string) => void;
type RoomDisposedFn = (
  roomId: string,
  playerIds: string[],
  reason: RoomDisposeReason,
  arenaMatchId?: string,
) => void;
interface PumpOptions {
  maxMs?: number;
  step?: number;
  autoHero?: boolean;
  /** 매 스텝 시작에 실행 — 봇 스택 보정 등 결정론 보조 */
  onStep?: () => void;
}
type SeatReclaimedSpy = ReturnType<typeof vi.fn<SeatReclaimedFn>>;
type RoomDisposedSpy = ReturnType<typeof vi.fn<RoomDisposedFn>>;
type RoomUpdateFn = (roomId: string, engine: PokerEngine) => void;
type RoomChatFn = (roomId: string, message: ChatMessage) => void;

describe('RoomManager 수련 스토리 훅 (1b.0)', () => {
  let manager: RoomManager;
  let story: ReturnType<typeof makeStoryHooks>;
  let progression: {
    captureHandStart: ReturnType<typeof vi.fn>;
    confirmHandStart: ReturnType<typeof vi.fn>;
    cancelHand: ReturnType<typeof vi.fn>;
    completeHand: ReturnType<typeof vi.fn>;
    completeSng: ReturnType<typeof vi.fn>;
    disposeRoom: ReturnType<typeof vi.fn>;
  };
  let recordCompletedHand: ReturnType<typeof vi.fn>;
  let onSeatReclaimed: SeatReclaimedSpy;
  let onRoomDisposed: RoomDisposedSpy;
  let onUpdate: ReturnType<typeof vi.fn<RoomUpdateFn>>;
  let onChat: ReturnType<typeof vi.fn<RoomChatFn>>;

  beforeEach(() => {
    vi.useFakeTimers();
    onUpdate = vi.fn<RoomUpdateFn>();
    onChat = vi.fn<RoomChatFn>();
    story = makeStoryHooks();
    progression = {
      captureHandStart: vi.fn(),
      confirmHandStart: vi.fn(),
      cancelHand: vi.fn(),
      completeHand: vi.fn(),
      completeSng: vi.fn(),
      disposeRoom: vi.fn(),
    };
    recordCompletedHand = vi.fn();
    onSeatReclaimed = vi.fn<SeatReclaimedFn>();
    onRoomDisposed = vi.fn<RoomDisposedFn>();
    manager = new RoomManager(onUpdate, onChat, undefined, {
      progression: progression as unknown as RoomProgressionHooks,
      handHistory: { recordCompletedHand } as unknown as RoomHandHistoryHooks,
      onSeatReclaimed,
      onRoomDisposed,
    });
    manager.setStoryHooks(story.hooks);
  });

  afterEach(() => {
    manager.shutdown();
    // 누수 가드 — 종료 후 어떤 타이머도 남지 않아야 한다
    const stats = manager.getRuntimeStats();
    expect(stats.botTimers).toBe(0);
    expect(stats.pendingStartTimers).toBe(0);
    expect(stats.turnTimers).toBe(0);
    expect(stats.sitOutTimers).toBe(0);
    expect(stats.finishedRoomTimers).toBe(0);
    expect(stats.deadlines).toBe(0);
    vi.clearAllTimers();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  // --- 헬퍼 -------------------------------------------------------------

  const tick = (ms: number) => vi.advanceTimersByTimeAsync(ms);

  function stateOf(roomId: string) {
    return manager.getRoom(roomId)?.engine.state;
  }

  function hero(roomId: string, heroId: string): Player | undefined {
    return stateOf(roomId)?.players.find(p => p.id === heroId);
  }

  /**
   * 방 생성 + 착석. 히어로(0번 좌석)를 먼저 앉힌 뒤 봇을 앉힌다 — 봇을 먼저 앉히면
   * 대조군 방의 `refreshCashBots` 자동 충원이 0번 좌석을 채워 히어로 입장이 거절된다.
   */
  function seatRoom(
    config: RoomConfig,
    botCount: number,
    options: { deck?: RiggedDeck; heroId?: string } = {},
  ): { roomId: string; heroId: string; botIds: string[] } {
    const roomId = options.deck
      ? manager.createRoom(config, false, undefined, options.deck)
      : manager.createRoom(config);
    const heroPlayer = makeHero(options.heroId ?? 'hero');
    expect(manager.joinRoom(roomId, heroPlayer)).toBe(true);
    const botIds: string[] = [];
    for (let i = 0; i < botCount; i++) {
      const bot = createBotWithCharacter(i + 1, 2000, BOT_CHARACTERS[i], 'easy');
      expect(bot).not.toBeNull();
      expect(manager.joinRoom(roomId, bot as Player)).toBe(true);
      botIds.push((bot as Player).id);
    }
    return { roomId, heroId: heroPlayer.id, botIds };
  }

  /**
   * 핸드 사이에 봇 스택을 원위치 — 봇이 파산해 "칩 보유 2인 미만"으로 방이 멈추면
   * 테스트가 봇 랜덤성에 의존하게 된다 (실제 어댑터도 beforeHand에서 라인업 스택을 보정한다).
   */
  function topUpBots(roomId: string, chips = 2000): void {
    const st = stateOf(roomId);
    if (!st || st.isHandInProgress) return;
    for (const player of st.players) {
      if (player.type === 'bot') player.chips = chips;
    }
  }

  /** 히어로 턴이면 체크(가능하면)/폴드로 즉시 넘긴다 — 봇만 남기고 핸드를 흘려보내기 위한 자동 조종 */
  function autoPilotHero(roomId: string): void {
    for (let guard = 0; guard < 8; guard++) {
      const st = stateOf(roomId);
      if (!st || !st.isHandInProgress) return;
      const active = st.players[st.activePlayerIndex];
      if (
        !active
        || active.type !== 'human'
        || active.sitOutNext
        || active.isDisconnected
      ) return;
      const canCheck = active.currentBet >= st.currentBet;
      if (!manager.processPlayerAction(roomId, active.id, canCheck ? 'check' : 'fold')) return;
    }
  }

  /**
   * 조건이 만족될 때까지 fake timer를 밀어 방을 진행시킨다.
   * autoHero=false면 히어로 턴을 대신 눌러주지 않는다 (턴 타임아웃 계약 검증용).
   */
  async function pumpUntil(
    roomId: string,
    done: () => boolean,
    options: PumpOptions = {},
  ): Promise<boolean> {
    const { maxMs = 300_000, step = 250, autoHero = true, onStep } = options;
    const steps = Math.ceil(maxMs / step);
    for (let i = 0; i < steps; i++) {
      onStep?.();
      if (done()) return true;
      if (autoHero) autoPilotHero(roomId);
      if (done()) return true;
      await tick(step);
    }
    return done();
  }

  /** handNumber가 target에 도달하고 그 핸드가 끝날 때까지 진행 */
  async function playHands(
    roomId: string,
    target: number,
    options: PumpOptions = {},
  ): Promise<void> {
    const reached = await pumpUntil(
      roomId,
      () => {
        const st = stateOf(roomId);
        return !st || (st.handNumber >= target && !st.isHandInProgress);
      },
      { maxMs: 120_000 * target, step: 400, ...options },
    );
    expect(reached).toBe(true);
  }

  function everyStorySpy(): ReturnType<typeof vi.fn>[] {
    return Object.values(story.spies) as unknown as ReturnType<typeof vi.fn>[];
  }

  // --- 케이스 1 ---------------------------------------------------------

  it('#1 비스토리 캐시 방은 스토리 훅을 한 번도 호출하지 않는다 (spy 0)', async () => {
    const { roomId, heroId } = seatRoom(plainConfig(), 2);

    await playHands(roomId, 1);
    expect(stateOf(roomId)!.handNumber).toBeGreaterThanOrEqual(1);

    manager.leaveRoom(roomId, heroId);

    for (const spy of everyStorySpy()) expect(spy).not.toHaveBeenCalled();
    // 대조 — 같은 방에서 기존 진행도(핸드 XP) 경로는 정상 동작한다
    expect(progression.captureHandStart).toHaveBeenCalled();
    expect(progression.completeHand).toHaveBeenCalled();
  });

  // --- 케이스 2 ---------------------------------------------------------

  it('#2 isHeld hold 중에는 시작 예약조차 잡지 않고, resumeRoom으로만 재개된다', async () => {
    story.state.held = true;
    const { roomId } = seatRoom(storyConfig(), 2);

    await tick(3_000);
    expect(stateOf(roomId)!.handNumber).toBe(0);
    expect(stateOf(roomId)!.isHandInProgress).toBe(false);
    expect(manager.getRuntimeStats().pendingStartTimers).toBe(0);
    expect(story.spies.isHeld).toHaveBeenCalledWith(roomId);
    expect(story.spies.beforeHand).not.toHaveBeenCalled();

    story.state.held = false;
    manager.resumeRoom(roomId);
    await tick(2_100);

    expect(stateOf(roomId)!.isHandInProgress).toBe(true);
    expect(stateOf(roomId)!.handNumber).toBe(1);
  });

  it('#2b 예약이 잡힌 뒤 걸린 hold는 startNewHand 재확인이 막는다', async () => {
    const { roomId } = seatRoom(storyConfig(), 2);
    expect(manager.getRuntimeStats().pendingStartTimers).toBe(1);

    await tick(1_000);
    story.state.held = true; // 예약(2초) 만료 전에 인터럽트 씬 진입
    await tick(1_500);

    expect(stateOf(roomId)!.handNumber).toBe(0);
    expect(stateOf(roomId)!.isHandInProgress).toBe(false);
    expect(story.spies.beforeHand).not.toHaveBeenCalled();
  });

  // --- 케이스 3 ---------------------------------------------------------

  it("#3 beforeHand 'hold'는 딜을 취소하고, 'deal'+resumeRoom이 재개한다", async () => {
    story.state.beforeHand = 'hold';
    const { roomId } = seatRoom(storyConfig(), 2);

    await tick(2_500);

    expect(stateOf(roomId)!.handNumber).toBe(0);
    expect(stateOf(roomId)!.isHandInProgress).toBe(false);
    expect(story.spies.beforeHand).toHaveBeenCalledTimes(1);
    expect(story.spies.beforeHand).toHaveBeenCalledWith(
      roomId,
      manager.getRoom(roomId)!.engine,
    );
    expect(manager.getRuntimeStats().pendingStartTimers).toBe(0);

    story.state.beforeHand = 'deal';
    manager.resumeRoom(roomId);
    await tick(2_100);

    expect(stateOf(roomId)!.isHandInProgress).toBe(true);
    expect(story.spies.beforeHand).toHaveBeenCalledTimes(2);
  });

  // --- 케이스 4 ---------------------------------------------------------

  it('#4 스토리 라인업은 고정 — 자동 봇 충원도, 파산 봇 회수도 하지 않는다', async () => {
    const story1 = seatRoom(storyConfig(), 1);
    await tick(2_100);
    expect(stateOf(story1.roomId)!.players).toHaveLength(2); // 히어로 + 봇 1

    // 대조 — 같은 botCount(2)의 캐시 방은 히어로 한 명만 앉아도 3명까지 자동 충원된다
    const control = seatRoom(plainConfig({ name: '대조-충원', botCount: 2 }), 0);
    await tick(2_100);
    expect(stateOf(control.roomId)!.players).toHaveLength(3);

    // 스토리: 핸드 사이에 파산한 봇 좌석도 회수하지 않는다 (리필/교체는 어댑터 beforeHand 소관)
    await playHands(story1.roomId, 1);
    const bustedBotId = story1.botIds[0];
    stateOf(story1.roomId)!.players.find(p => p.id === bustedBotId)!.chips = 0;
    // 히어로+봇 1명(0칩)이면 다음 핸드를 못 시작하므로 봇을 한 명 더 앉혀 진행만 시킨다
    const extra = createBotWithCharacter(2, 2000, BOT_CHARACTERS[1], 'easy') as Player;
    manager.joinRoom(story1.roomId, extra);
    await playHands(story1.roomId, 2);

    expect(stateOf(story1.roomId)!.players.map(p => p.id)).toContain(bustedBotId);
  });

  // --- 케이스 5 ---------------------------------------------------------

  it('#5 히어로가 나가면 스토리 방은 즉시 dispose된다 (캐시 유저 방은 보존)', async () => {
    const { roomId, heroId } = seatRoom(storyConfig(), 2);
    await playHands(roomId, 1);
    expect(manager.getRuntimeStats().pendingStartTimers).toBe(1); // 'continue' 재예약

    let seatedAtLeave: string[] = [];
    story.spies.onPlayerLeave.mockImplementation((rid: string) => {
      seatedAtLeave = stateOf(rid)?.players.map(p => p.id) ?? [];
    });

    manager.leaveRoom(roomId, heroId);

    expect(story.spies.onPlayerLeave).toHaveBeenCalledTimes(1);
    expect(story.spies.onPlayerLeave).toHaveBeenCalledWith(roomId, heroId);
    expect(seatedAtLeave).toContain(heroId); // 좌석 제거 '직전'에 호출된다
    expect(manager.getRoom(roomId)).toBeUndefined();
    expect(story.spies.onRoomDisposed).toHaveBeenCalledWith(roomId, 'empty');
    // 좌석은 processLeave가 이미 뺐으므로 옵션 훅의 playerIds는 빈 배열이다 (사유만 계약)
    const disposeCall = onRoomDisposed.mock.calls.find(call => call[0] === roomId);
    expect(disposeCall).toBeDefined();
    expect(disposeCall![2]).toBe('empty');
    expect(disposeCall![1]).toEqual([]);

    const stats = manager.getRuntimeStats();
    expect(stats.botTimers).toBe(0);
    expect(stats.pendingStartTimers).toBe(0);
    expect(stats.turnTimers).toBe(0);
    expect(stats.sitOutTimers).toBe(0);

    // 대조 — 캐시 유저 방은 마지막 휴먼이 나가도 10분 보존된다
    const control = seatRoom(plainConfig({ name: '대조-보존' }), 2);
    await playHands(control.roomId, 1);
    manager.leaveRoom(control.roomId, control.heroId);
    expect(manager.getRoom(control.roomId)).toBeDefined();
  });

  // --- 케이스 6 ---------------------------------------------------------

  it('#6 스토리 방은 로비 방 목록에 노출되지 않는다', () => {
    const { roomId } = seatRoom(storyConfig(), 2);
    const controlId = manager.createRoom(plainConfig({ name: '대조-목록' }));

    const ids = manager.getRoomList().map(item => item.id);
    expect(ids).not.toContain(roomId);
    expect(ids).toContain(controlId);
    expect(manager.getRoomList('hero').map(item => item.id)).not.toContain(roomId);
  });

  // --- 케이스 7 ---------------------------------------------------------

  it('#7 프리셋 덱 주입은 스토리 practice 방에서만 허용된다', async () => {
    expect(() => manager.createRoom(
      plainConfig(),
      false,
      undefined,
      new RiggedDeck('As Kd'),
    )).toThrow(/story practice rooms/);

    expect(() => manager.createRoom(
      storyConfig({ economyMode: 'wallet' }),
      false,
      undefined,
      new RiggedDeck('As Kd'),
    )).toThrow(/story practice rooms/);

    // 3인자(덱 없음) 호출은 그대로 동작한다
    expect(typeof manager.createRoom(plainConfig({ name: '대조-3인자' }))).toBe('string');

    const deck = new RiggedDeck('As Kd 2c 3c 4c 5c');
    const { roomId, heroId } = seatRoom(storyConfig(), 2, { deck });
    await tick(2_100);

    expect(stateOf(roomId)!.isHandInProgress).toBe(true);
    expect(hero(roomId, heroId)!.holeCards).toEqual(cards('As Kd'));
  });

  // --- 케이스 8 ---------------------------------------------------------

  it('#8 턴 타임아웃 뒤에도 히어로를 딜아웃하지 않고 beforeHand가 hold로 잡는다', async () => {
    const { roomId, heroId } = seatRoom(storyConfig({ turnTime: 3 }), 2);

    // 히어로 차례가 올 때까지 대신 눌러주지 않고 기다린다
    const gotTurn = await pumpUntil(
      roomId,
      () => {
        const st = stateOf(roomId);
        return !!st && st.isHandInProgress
          && st.players[st.activePlayerIndex]?.id === heroId;
      },
      { maxMs: 120_000, step: 200, autoHero: false, onStep: () => topUpBots(roomId) },
    );
    expect(gotTurn).toBe(true);

    await tick(3_500); // 턴 타이머 만료 → 자동 폴드 + sitOutAuto 마킹
    expect(hero(roomId, heroId)!.sitOutNext).toBe(true);
    expect(hero(roomId, heroId)!.sitOutAuto).toBe(true);

    // 다음 핸드 진입 시점의 좌석 상태를 훅 안에서 검사하고, 계약대로 마킹을 해제한 뒤 hold.
    // (1번 핸드 시작 때 이미 한 번 불렸으므로 호출 수 스냅샷 기준으로 '새 호출'을 기다린다)
    const beforeHandCallsAtTimeout = story.spies.beforeHand.mock.calls.length;
    let markingSeenInHook: { sitOutNext?: boolean; sitOutAuto?: boolean } | null = null;
    story.state.beforeHand = 'hold';
    story.state.onBeforeHand = (rid, engine) => {
      const seat = engine.state.players.find(p => p.id === heroId);
      if (!seat) return;
      markingSeenInHook = { sitOutNext: seat.sitOutNext, sitOutAuto: seat.sitOutAuto };
      seat.sitOutNext = undefined;
      seat.sitOutAuto = undefined;
      expect(rid).toBe(roomId);
    };

    // 봇들끼리 남은 핸드를 마치고 6.5초 재예약이 만료될 때까지
    const reEntered = await pumpUntil(
      roomId,
      () => story.spies.beforeHand.mock.calls.length > beforeHandCallsAtTimeout,
      { maxMs: 120_000, step: 400, autoHero: false, onStep: () => topUpBots(roomId) },
    );

    expect(reEntered).toBe(true);
    expect(markingSeenInHook).toEqual({ sitOutNext: true, sitOutAuto: true });
    expect(stateOf(roomId)!.isHandInProgress).toBe(false);
    expect(hero(roomId, heroId)!.status).not.toBe('sitting-out');
    expect(manager.getRuntimeStats().pendingStartTimers).toBe(0);

    // [계속하기] → resume → 히어로가 다시 딜인된다
    story.state.beforeHand = 'deal';
    story.state.onBeforeHand = undefined;
    topUpBots(roomId);
    manager.resumeRoom(roomId);
    await tick(2_100);

    expect(stateOf(roomId)!.isHandInProgress).toBe(true);
    expect(hero(roomId, heroId)!.holeCards).toHaveLength(2);
    expect(hero(roomId, heroId)!.status).not.toBe('sitting-out');
  });

  it('#8b 대조 — 캐시 방은 타임아웃 다음 핸드에서 히어로를 딜아웃한다', async () => {
    const { roomId, heroId } = seatRoom(plainConfig({ turnTime: 3 }), 2);

    const gotTurn = await pumpUntil(
      roomId,
      () => {
        const st = stateOf(roomId);
        return !!st && st.isHandInProgress
          && st.players[st.activePlayerIndex]?.id === heroId;
      },
      { maxMs: 120_000, step: 200, autoHero: false, onStep: () => topUpBots(roomId) },
    );
    expect(gotTurn).toBe(true);

    await tick(3_500);
    expect(hero(roomId, heroId)!.sitOutNext).toBe(true);

    const startedHand = stateOf(roomId)!.handNumber;
    const cardsBeforeDealOut = [...hero(roomId, heroId)!.holeCards];
    const dealt = await pumpUntil(
      roomId,
      () => (stateOf(roomId)?.handNumber ?? 0) > startedHand,
      { maxMs: 120_000, step: 400, autoHero: false, onStep: () => topUpBots(roomId) },
    );

    expect(dealt).toBe(true);
    expect(hero(roomId, heroId)!.status).toBe('sitting-out');
    // 딜아웃 좌석은 새 카드를 받지 않는다 — 엔진은 딜인 좌석의 holeCards만 초기화하므로
    // 지난 핸드 카드가 그대로 남는다 (길이 0이 아니라 '변하지 않음'이 계약)
    expect(hero(roomId, heroId)!.holeCards).toEqual(cardsBeforeDealOut);
  });

  // --- 케이스 9 ---------------------------------------------------------

  it('#9 스토리 방은 미납 빅블라인드로 히어로 좌석을 회수하지 않는다', async () => {
    const { roomId, heroId } = seatRoom(storyConfig(), 3);
    const seat = hero(roomId, heroId)!;
    seat.sitOutNext = true;
    seat.status = 'sitting-out';
    seat.sitOutSinceHand = 0;
    seat.sitOutSinceMs = Date.now() - 10 * 60_000;

    await playHands(roomId, 8, { autoHero: false, onStep: () => topUpBots(roomId) });

    expect(stateOf(roomId)!.handNumber).toBeGreaterThanOrEqual(8);
    expect(stateOf(roomId)!.players.map(p => p.id)).toContain(heroId);
    expect(onSeatReclaimed).not.toHaveBeenCalled();
    expect(story.spies.onPlayerLeave).not.toHaveBeenCalled();
  });

  it('#9b 대조 — 캐시 방은 같은 조건에서 히어로 좌석을 회수한다', async () => {
    const { roomId, heroId } = seatRoom(plainConfig(), 3);
    const seat = hero(roomId, heroId)!;
    seat.sitOutNext = true;
    seat.status = 'sitting-out';
    seat.sitOutSinceHand = 0;
    seat.sitOutSinceMs = Date.now() - 10 * 60_000;

    const reclaimed = await pumpUntil(
      roomId,
      () => onSeatReclaimed.mock.calls.length > 0,
      { maxMs: 600_000, step: 400, autoHero: false, onStep: () => topUpBots(roomId) },
    );

    expect(reclaimed).toBe(true);
    expect(onSeatReclaimed).toHaveBeenCalledWith(roomId, heroId);
    expect(stateOf(roomId)?.players.map(p => p.id) ?? []).not.toContain(heroId);
  });

  // --- 케이스 10 --------------------------------------------------------

  it("#10 skipHandProgression=true면 핸드 XP 경로를 타지 않고 story_tag만 남는다", async () => {
    story.state.skipProgression = true;
    const { roomId } = seatRoom(storyConfig(), 2);

    await playHands(roomId, 1);

    expect(progression.captureHandStart).not.toHaveBeenCalled();
    expect(progression.completeHand).not.toHaveBeenCalled();

    const recorded = recordCompletedHand.mock.calls
      .map(call => call[0] as RecordedHand)
      .filter(input => input.roomId === roomId);
    expect(recorded).toHaveLength(1);
    expect(recorded[0]).toMatchObject({ gameMode: 'cash', storyTag: 'practice' });
  });

  it('#10b skipHandProgression=false면 스토리 방도 핸드 XP를 적립한다', async () => {
    story.state.skipProgression = false;
    const { roomId } = seatRoom(storyConfig(), 2);

    await playHands(roomId, 1);

    expect(progression.captureHandStart).toHaveBeenCalledTimes(1);
    expect(progression.completeHand).toHaveBeenCalledTimes(1);
    expect(progression.completeHand.mock.calls[0][0]).toMatchObject({
      roomId,
      handNumber: 1,
    });
  });

  it('#10c 대조 — 비스토리 방의 핸드 히스토리는 story_tag가 null이다', async () => {
    const { roomId } = seatRoom(plainConfig(), 2);
    await playHands(roomId, 1);

    const recorded = recordCompletedHand.mock.calls
      .map(call => call[0] as RecordedHand)
      .filter(input => input.roomId === roomId);
    expect(recorded).toHaveLength(1);
    expect(recorded[0].storyTag).toBeNull();
  });

  // --- 케이스 11 --------------------------------------------------------

  it("#11 onHandComplete 'continue'는 다음 핸드를 예약한다", async () => {
    story.state.verdict = 'continue';
    const { roomId } = seatRoom(storyConfig(), 2);

    await playHands(roomId, 1);
    expect(story.spies.onHandComplete).toHaveBeenCalledWith(roomId);
    expect(manager.getRuntimeStats().pendingStartTimers).toBe(1);

    await tick(6_600);
    expect(stateOf(roomId)!.handNumber).toBe(2);
  });

  it("#11b onHandComplete 'hold'는 예약도 회수 부수효과도 만들지 않는다", async () => {
    story.state.verdict = 'hold';
    const { roomId, heroId } = seatRoom(storyConfig(), 2);

    await playHands(roomId, 1);

    expect(manager.getRuntimeStats().pendingStartTimers).toBe(0);
    expect(manager.getRuntimeStats().sitOutTimers).toBe(0);
    expect(hero(roomId, heroId)!.bustReclaimDeadline).toBeUndefined();
    expect(hero(roomId, heroId)!.leaveReservation).toBeUndefined();

    await tick(20_000);
    expect(stateOf(roomId)!.handNumber).toBe(1); // 여전히 보류 중
  });

  it("#11c onHandComplete 'gone' — 훅 안에서 방을 해체해도 예외 없이 끝난다", async () => {
    story.state.verdict = 'gone';
    const { roomId } = seatRoom(storyConfig(), 2);
    story.state.onHandComplete = rid => {
      manager.disposeRoom(rid, 'story-end');
    };

    await playHands(roomId, 1);

    expect(manager.getRoom(roomId)).toBeUndefined();
    expect(story.spies.onRoomDisposed).toHaveBeenCalledWith(roomId, 'story-end');
    expect(manager.getRuntimeStats().pendingStartTimers).toBe(0);
  });

  // --- 케이스 12 --------------------------------------------------------

  it('#12 자리비움·나가기 예약은 스토리 방에서 거절된다 (이탈은 abandon-story 단일 경로)', async () => {
    story.state.held = true; // 핸드 사이 상태 고정
    const { roomId, heroId } = seatRoom(storyConfig(), 2);
    await tick(2_500);

    expect(manager.toggleSitOut(roomId, heroId)).toBe(false);
    expect(hero(roomId, heroId)!.sitOutNext).toBeFalsy();

    expect(manager.setLeaveReservation(roomId, heroId, 'hand')).toBe('rejected');
    expect(manager.setLeaveReservation(roomId, heroId, 'bb')).toBe('rejected');
    expect(hero(roomId, heroId)!.leaveReservation).toBeUndefined();

    manager.sitOutAndLeave(roomId, heroId);
    expect(hero(roomId, heroId)!.sitOutNext).toBeFalsy();
    expect(hero(roomId, heroId)!.status).not.toBe('sitting-out');
    expect(manager.getRuntimeStats().sitOutTimers).toBe(0);
    expect(manager.getRoom(roomId)).toBeDefined();
  });

  // --- 케이스 13 --------------------------------------------------------

  it('#13 grace 만료는 스토리 좌석을 회수하고 빈 방을 즉시 정리한다', async () => {
    story.state.held = true;
    const { roomId, heroId } = seatRoom(storyConfig(), 2);
    await tick(2_500);

    manager.handleDisconnect(roomId, heroId, Date.now() + 60_000);
    const kept = manager.handleGraceExpired(roomId, heroId);

    expect(kept).toBe(false);
    expect(manager.getRoom(roomId)).toBeUndefined();
    expect(story.spies.onPlayerLeave).toHaveBeenCalledWith(roomId, heroId);
    expect(story.spies.onRoomDisposed).toHaveBeenCalledWith(roomId, 'empty');
  });

  it('#13b 자리비움 마킹된 스토리 좌석도 grace 만료로 회수된다 (캐시와 다른 지점)', async () => {
    story.state.held = true;
    const storyRoom = seatRoom(storyConfig(), 2);
    await tick(2_500);
    hero(storyRoom.roomId, storyRoom.heroId)!.sitOutNext = true;

    manager.handleDisconnect(storyRoom.roomId, storyRoom.heroId, Date.now() + 60_000);
    expect(manager.handleGraceExpired(storyRoom.roomId, storyRoom.heroId)).toBe(false);
    expect(manager.getRoom(storyRoom.roomId)).toBeUndefined();

    // 대조 — 캐시 자리비움 좌석은 grace 만료에도 보존된다
    const control = seatRoom(plainConfig({ name: '대조-grace' }), 2, { heroId: 'hero-2' });
    manager.toggleSitOut(control.roomId, control.heroId);
    manager.handleDisconnect(control.roomId, control.heroId, Date.now() + 60_000);
    expect(manager.handleGraceExpired(control.roomId, control.heroId)).toBe(true);
    expect(manager.getRoom(control.roomId)).toBeDefined();
  });

  // --- 케이스 14 --------------------------------------------------------

  it('#14 봇이 액션할 때마다 onBotActed로 결정과 속마음이 전달된다', async () => {
    const observed: {
      roomId: string;
      playerId: string;
      action: string;
      explanation?: { code: string; text: string };
      matchesLastAction: boolean;
    }[] = [];
    story.spies.onBotActed.mockImplementation((rid, pid, decision, explanation) => {
      const last = stateOf(rid)?.lastAction;
      observed.push({
        roomId: rid,
        playerId: pid,
        action: decision.action,
        explanation,
        matchesLastAction: last?.playerId === pid && last?.type === decision.action,
      });
    });

    const { roomId, botIds } = seatRoom(storyConfig(), 2);
    await playHands(roomId, 1);

    expect(observed.length).toBeGreaterThan(0);
    for (const call of observed) {
      expect(call.roomId).toBe(roomId);
      expect(botIds).toContain(call.playerId);
      expect(['fold', 'check', 'call', 'raise', 'all-in']).toContain(call.action);
      expect(typeof call.explanation?.code).toBe('string');
      expect(typeof call.explanation?.text).toBe('string');
    }
    // 결정이 거부돼 강제 체크/폴드로 대체되는 예외를 빼면 엔진 lastAction과 일치해야 한다
    expect(observed.some(call => call.matchesLastAction)).toBe(true);

    // 대조 — 비스토리 방의 봇 액션은 훅을 부르지 않는다.
    // 스토리 방을 먼저 해체한다 (fake timer는 전역이라 그대로 두면 스토리 방 다음 핸드가
    // 함께 돌아 훅이 다시 불린다) + 호출 수 스냅샷으로 이중 방어.
    manager.disposeRoom(roomId, 'story-end');
    const botActsBeforeControl = story.spies.onBotActed.mock.calls.length;
    const control = seatRoom(plainConfig({ name: '대조-봇' }), 2, { heroId: 'hero-2' });
    await playHands(control.roomId, 1, { onStep: () => topUpBots(control.roomId) });
    expect(story.spies.onBotActed.mock.calls.length).toBe(botActsBeforeControl);
  });

  // --- 케이스 15 --------------------------------------------------------

  it('#15 히어로 파산은 30초 회수 유예를 걸지 않는다 (어댑터의 실패 분기 소관)', async () => {
    const { roomId, heroId } = seatRoom(storyConfig(), 3);
    await playHands(roomId, 1, { onStep: () => topUpBots(roomId) });

    // 핸드 사이에 히어로만 0칩으로 — 다음 핸드는 봇끼리 돌고, 종료 시 파산 회수 경로가 갈린다
    topUpBots(roomId);
    hero(roomId, heroId)!.chips = 0;
    await playHands(roomId, 2, { autoHero: false });

    expect(stateOf(roomId)!.handNumber).toBeGreaterThanOrEqual(2);
    expect(hero(roomId, heroId)!.chips).toBe(0);
    expect(hero(roomId, heroId)!.bustReclaimDeadline).toBeUndefined();
    expect(manager.getRuntimeStats().sitOutTimers).toBe(0);
    expect(stateOf(roomId)!.players.map(p => p.id)).toContain(heroId);
  });

  it('#15b 대조 — 캐시 방의 파산 좌석에는 리바이 유예가 무장된다', async () => {
    const { roomId, heroId } = seatRoom(plainConfig(), 3);
    await playHands(roomId, 1, { onStep: () => topUpBots(roomId) });

    topUpBots(roomId);
    hero(roomId, heroId)!.chips = 0;
    await playHands(roomId, 2, { autoHero: false });

    expect(stateOf(roomId)!.handNumber).toBeGreaterThanOrEqual(2);
    expect(hero(roomId, heroId)!.bustReclaimDeadline).toBeDefined();
    expect(manager.getRuntimeStats().sitOutTimers).toBe(1);
  });
  it('스토리 봇 공개는 name/avatar만 바꾸고 한 번 브로드캐스트한다', () => {
    const roomId = manager.createRoom(storyConfig());
    const bot = createBotWithCharacter(1, 2_000, 'sakura', 'easy', {
      name: '수상한 도전자', characterId: 'story-mask',
    })!;
    expect(manager.joinRoom(roomId, makeHero())).toBe(true);
    expect(manager.joinRoom(roomId, bot)).toBe(true);
    const before = { id: bot.id, personalityId: bot.personalityId };
    onUpdate.mockClear();

    expect(manager.updateStoryBotDisplayIdentity(roomId, bot.id, {
      name: '사쿠라', characterId: 'sakura',
    })).toBe(true);

    expect(bot).toMatchObject({
      ...before,
      name: '사쿠라',
      avatar: 'sakura',
    });
    expect(onUpdate).toHaveBeenCalledTimes(1);
  });

  it('가면 봇은 실제 캐릭터 AI를 호출하지 않고 채팅의 당시 표시 identity를 보존한다', async () => {
    // 채팅만 보는 테스트 — 어댑터 hold로 핸드 시작(딜러 멘트)이 마지막 메시지를 덮지 않게 한다
    story.state.held = true;
    const roomId = manager.createRoom(storyConfig());
    const bot = createBotWithCharacter(1, 2_000, 'sakura', 'easy', {
      name: '수상한 도전자', characterId: 'story-mask',
    })!;
    expect(manager.joinRoom(roomId, makeHero())).toBe(true);
    expect(manager.joinRoom(roomId, bot)).toBe(true);
    const dialogue = (manager as unknown as {
      dialogue: { getLine: (...args: string[]) => Promise<string | null> };
    }).dialogue;
    const getLine = vi.spyOn(dialogue, 'getLine').mockResolvedValue('사쿠라 전용 대사');
    vi.spyOn(Math, 'random').mockReturnValue(0);

    manager.reactToThrowableHit(roomId, bot.id, '히어로', '종이비행기');
    await tick(1_000);

    expect(getLine).not.toHaveBeenCalled();
    expect(manager.getChatHistory(roomId).at(-1)).toMatchObject({
      playerId: bot.id,
      playerName: '수상한 도전자',
      characterId: 'story-mask',
      type: 'bot',
    });
    const maskedMessage = manager.getChatHistory(roomId).at(-1)!;

    expect(manager.updateStoryBotDisplayIdentity(roomId, bot.id, {
      name: '사쿠라', characterId: 'sakura',
    })).toBe(true);
    manager.reactToThrowableHit(roomId, bot.id, '히어로', '종이비행기');
    await tick(1_000);

    expect(getLine).toHaveBeenCalledWith(roomId, 'sakura', 'throwable-hit', expect.any(String));
    expect(maskedMessage).toMatchObject({
      playerName: '수상한 도전자', characterId: 'story-mask',
    });
    expect(manager.getChatHistory(roomId).at(-1)).toMatchObject({
      playerName: '사쿠라', characterId: 'sakura',
    });
  });
});
