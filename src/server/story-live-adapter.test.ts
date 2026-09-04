import { CH07 } from '../lib/story/chapters/act3/ch07-masquerade';
/**
 * LiveTableAdapter 통합 테스트 — RoomManager 실물 + fake timers.
 * 기획 Part C 1b.1: hold→ack→resume · 라인업 고정 · 프리셋 덱 · 타임아웃 hold · 파산 실패 분기 ·
 * room-lost 보존 후 이어하기 · hold 타임아웃 · 종료 시 방/타이머 0.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Player, RoomConfig } from '../lib/poker/types';
import type { Step } from '../lib/story/types';
import { CH01 } from '../lib/story/chapters/act1/ch01-dojo-gate';
import { RoomManager } from './room-manager';
import { LiveTableAdapter, type LiveEnterInput, type LiveStepSummary } from './story-live-adapter';

type LiveStep = Extract<Step, { kind: 'practice-table' | 'sparring' }>;

const PROFILE = 'hero-1';
const RUN = 'run-1';

function practiceStep(overrides: Partial<LiveStep['table']> = {}): Extract<Step, { kind: 'practice-table' }> {
  return {
    kind: 'practice-table',
    id: 'test:practice',
    tag: '연습',
    table: {
      blinds: { small: 10, big: 20 },
      heroSeat: 0,
      heroStackBB: 100,
      lineup: [
        { seatIndex: 1, characterId: 'partner', stackBB: 100, role: 'partner' },
        { seatIndex: 2, characterId: 'kapi', stackBB: 100, role: 'neighbor' },
        { seatIndex: 3, characterId: 'choco', stackBB: 100, role: 'neighbor' },
      ],
      difficulty: 'easy',
      turnTimeSec: 30,
      botThinkScale: 1,
      hints: 1,
      ...overrides,
    },
    scripts: [
      { hero: 'As Ks', board: 'Ah Kd 7c 2d 9s', villains: { 2: 'Qh Qd' } },
      { hero: '7d 2c' },
    ],
  };
}

function sparringStep(maxHands = 3): Extract<Step, { kind: 'sparring' }> {
  return {
    kind: 'sparring',
    id: 'test:sparring',
    tag: '대결',
    table: {
      blinds: { small: 10, big: 20 },
      heroSeat: 0,
      heroStackBB: 100,
      lineup: [
        { seatIndex: 1, characterId: 'partner', stackBB: 100, role: 'partner' },
        { seatIndex: 2, characterId: 'kapi', stackBB: 100, role: 'neighbor' },
        { seatIndex: 3, characterId: 'choco', stackBB: 100, role: 'neighbor' },
      ],
      difficulty: 'easy',
      turnTimeSec: 30,
      botThinkScale: 1,
      hints: 1,
    },
    maxHands,
    objectives: {
      primary: [{ id: 'played', kind: 'hands-played', label: '완주', target: maxHands }],
      bonus: [
        { id: 'win', kind: 'win-hands', label: '승리', target: 1 },
        { id: 'survive', kind: 'survive', label: '생존' },
      ],
    },
    interrupts: [
      { id: 'int-half', trigger: { kind: 'halfway' }, scene: { id: 'int-half', lines: [] } },
      { id: 'int-turn', trigger: { kind: 'first-my-turn' }, scene: { id: 'int-turn', lines: [] } },
    ],
  };
}

function makeHero(id: string, seat: { seatIndex: number; chips: number }): Player {
  return {
    id,
    name: '수련생',
    type: 'human',
    avatar: 'player',
    chips: seat.chips,
    seatIndex: seat.seatIndex,
    holeCards: [],
    currentBet: 0,
    totalContributed: 0,
    status: 'waiting',
    hasActed: false,
    timeBankChips: 1,
  };
}

describe('LiveTableAdapter', () => {
  let manager: RoomManager;
  let adapter: LiveTableAdapter;
  let seatHero: ReturnType<typeof vi.fn<(profileId: string, roomId: string, seat: { seatIndex: number; chips: number }) => boolean>>;
  let onStepFinished: ReturnType<typeof vi.fn<(profileId: string, runId: string, summary: LiveStepSummary) => void>>;
  let onLiveChanged: ReturnType<typeof vi.fn<(profileId: string) => void>>;

  function buildAdapter(options: { holdTimeoutMs?: number; sweepIntervalMs?: number; exposeBotThoughts?: boolean; finishDelayMs?: number } = {}): void {
    adapter = new LiveTableAdapter({
      roomManager: manager,
      hero: { seatHero },
      sweepIntervalMs: 0,
      ...options,
    });
    adapter.bindEvents({ onStepFinished, onLiveChanged });
    manager.setStoryHooks(adapter);
  }

  beforeEach(() => {
    vi.useFakeTimers();
    manager = new RoomManager(() => {}, () => {});
    seatHero = vi.fn((profileId: string, roomId: string, seat: { seatIndex: number; chips: number }) => (
      manager.joinRoom(roomId, makeHero(profileId, seat))
    ));
    onStepFinished = vi.fn();
    onLiveChanged = vi.fn();
    buildAdapter();
  });

  afterEach(() => {
    adapter.shutdown();
    manager.shutdown();
    const stats = manager.getRuntimeStats();
    expect(stats.rooms).toBe(0);
    expect(stats.botTimers + stats.pendingStartTimers + stats.turnTimers + stats.sitOutTimers).toBe(0);
    vi.useRealTimers();
  });

  // --- 헬퍼 ---------------------------------------------------------------

  const tick = (ms: number) => vi.advanceTimersByTimeAsync(ms);

  function enter(
    step: LiveStep,
    partnerId: LiveEnterInput['partnerId'] = 'sakura',
    botDisplaysBySeat?: LiveEnterInput['botDisplaysBySeat'],
  ): string {
    const entered = adapter.enter({
      profileId: PROFILE,
      runId: RUN,
      chapterId: 'act1-ch01',
      chapterTitle: '도장의 문',
      stepIndex: 3,
      step,
      partnerId,
      botDisplaysBySeat,
    });
    expect(entered).toBe('entered');
    const roomId = adapter.view(PROFILE)?.roomId;
    expect(roomId).toBeTruthy();
    return roomId as string;
  }

  function stateOf(roomId: string) {
    return manager.getRoom(roomId)?.engine.state;
  }

  function heroSeat(roomId: string): Player | undefined {
    return stateOf(roomId)?.players.find(p => p.id === PROFILE);
  }

  /** 히어로 턴이면 체크/폴드로 넘긴다 (플레이 자체가 아니라 배선을 검증한다) */
  function autoHero(roomId: string): void {
    const st = stateOf(roomId);
    if (!st?.isHandInProgress) return;
    const active = st.players[st.activePlayerIndex];
    if (!active || active.id !== PROFILE) return;
    const canCheck = active.currentBet >= st.currentBet;
    manager.processPlayerAction(roomId, PROFILE, canCheck ? 'check' : 'fold');
  }

  async function pumpUntil(
    done: () => boolean,
    options: { roomId?: () => string | null; maxMs?: number; step?: number; hero?: boolean } = {},
  ): Promise<boolean> {
    const { maxMs = 180_000, step = 250, hero = true } = options;
    for (let elapsed = 0; elapsed <= maxMs; elapsed += step) {
      if (done()) return true;
      const roomId = options.roomId?.() ?? adapter.view(PROFILE)?.roomId ?? null;
      if (hero && roomId) autoHero(roomId);
      await tick(step);
    }
    return done();
  }

  // --- 케이스 -------------------------------------------------------------

  it('enter: 스토리 방을 열고 라인업(파트너 해석)·히어로를 앉힌 뒤 첫 핸드에 프리셋을 깐다', async () => {
    const roomId = enter(practiceStep());
    const room = manager.getRoom(roomId)!;
    const config: RoomConfig = room.config;
    expect(config.storyChapterId).toBe('act1-ch01');
    expect(config.storyRunId).toBe(RUN);
    expect(config.storyHandTag).toBe('practice');
    expect(config.tableType).toBe('bots');
    expect(config.economyMode).toBe('practice');
    expect(config.turnTime).toBe(30);
    expect(seatHero).toHaveBeenCalledWith(PROFILE, roomId, { seatIndex: 0, chips: 2000 });

    const seats = room.engine.state.players.map(p => ({ seat: p.seatIndex, type: p.type, character: p.personalityId ?? null }));
    expect(seats).toEqual([
      { seat: 0, type: 'human', character: null },
      { seat: 1, type: 'bot', character: 'sakura' },
      { seat: 2, type: 'bot', character: 'kapi' },
      { seat: 3, type: 'bot', character: 'choco' },
    ]);
    expect(manager.getRoomList().some(item => item.id === roomId)).toBe(false);
    expect(manager.getInviteCode(roomId)).toBeNull();

    const view = adapter.view(PROFILE)!;
    expect(view).toMatchObject({ roomId, tag: '연습', hold: false, holdReason: null, handsPlayed: 0, maxHands: 2, objectives: [] });
    expect(adapter.phase(PROFILE)).toBe('live-play');

    await tick(2_100);
    const st = stateOf(roomId)!;
    expect(st.isHandInProgress).toBe(true);
    expect(heroSeat(roomId)!.holeCards).toEqual([
      { rank: 'A', suit: 'spades' },
      { rank: 'K', suit: 'spades' },
    ]);
    const kapi = st.players.find(p => p.seatIndex === 2)!;
    expect(kapi.holeCards).toEqual([
      { rank: 'Q', suit: 'hearts' },
      { rank: 'Q', suit: 'diamonds' },
    ]);
    expect(adapter.skipHandProgression(roomId)).toBe(true);
  });

  it('practice: 스크립트를 순서대로 소비하고 마지막 핸드 뒤 방을 해체해 onStepFinished(done)를 보낸다', async () => {
    const roomId = enter(practiceStep());
    const finished = await pumpUntil(
      () => onStepFinished.mock.calls.length > 0,
      { roomId: () => roomId },
    );
    // 두 번째 핸드의 프리셋/스택 보정은 진행 중에 확인해야 하므로 다음 케이스가 별도 주행으로 검증
    expect(finished).toBe(true);
    expect(onStepFinished).toHaveBeenCalledTimes(1);
    const [profileId, runId, summary] = onStepFinished.mock.calls[0];
    expect(profileId).toBe(PROFILE);
    expect(runId).toBe(RUN);
    expect(summary).toMatchObject({ outcome: 'done', tag: '연습', handsPlayed: 2, primaryObjectivesMet: null, liveScore: null, netBB: 0 });
    expect(manager.getRoom(roomId)).toBeUndefined();
    expect(adapter.hasSession(PROFILE)).toBe(false);
    expect(adapter.view(PROFILE)).toBeNull();
  });

  it('practice: 두 번째 핸드는 스크립트 ②를 받고 라인업 스택은 스펙으로 되돌아간다', async () => {
    const roomId = enter(practiceStep());
    await tick(2_100);
    expect(stateOf(roomId)!.handNumber).toBe(1);
    // 첫 핸드 중 스택을 흐트러뜨려 둔다 (핸드 사이 보정 검증)
    const reached = await pumpUntil(
      () => stateOf(roomId)?.handNumber === 2 && !!stateOf(roomId)?.isHandInProgress,
      { roomId: () => roomId, maxMs: 90_000 },
    );
    expect(reached).toBe(true);
    const st = stateOf(roomId)!;
    expect(heroSeat(roomId)!.holeCards).toEqual([
      { rank: '7', suit: 'diamonds' },
      { rank: '2', suit: 'clubs' },
    ]);
    for (const player of st.players) {
      expect(player.handStartChips).toBe(2000);
    }
    expect(adapter.view(PROFILE)!.handsPlayed).toBe(1);
  });

  it('타임아웃: 자동 폴드된 핸드 뒤 beforeHand가 마킹을 풀고 hold(timeout) → resume이 히어로를 다시 딜인한다', async () => {
    const roomId = enter(practiceStep({ turnTimeSec: 2 }));
    const gotTurn = await pumpUntil(
      () => {
        const st = stateOf(roomId);
        return !!st?.isHandInProgress && st.players[st.activePlayerIndex]?.id === PROFILE;
      },
      { roomId: () => roomId, hero: false, maxMs: 60_000, step: 100 },
    );
    expect(gotTurn).toBe(true);
    await tick(2_200);
    expect(heroSeat(roomId)!.sitOutNext).toBe(true);
    expect(heroSeat(roomId)!.sitOutAuto).toBe(true);

    const held = await pumpUntil(() => adapter.view(PROFILE)?.hold === true, { roomId: () => roomId, hero: false, maxMs: 90_000 });
    expect(held).toBe(true);
    const view = adapter.view(PROFILE)!;
    expect(view.holdReason).toBe('timeout');
    expect(adapter.phase(PROFILE)).toBe('live-hold');
    expect(adapter.isHeld(roomId)).toBe(true);
    expect(stateOf(roomId)!.isHandInProgress).toBe(false);
    expect(heroSeat(roomId)!.sitOutNext).toBe(false);
    expect(heroSeat(roomId)!.sitOutAuto).toBeUndefined();
    expect(heroSeat(roomId)!.status).not.toBe('sitting-out');
    expect(manager.getRuntimeStats().pendingStartTimers).toBe(0);
    expect(onLiveChanged).toHaveBeenCalledWith(PROFILE);

    // 재개 전엔 봇끼리 핸드가 돌지 않는다
    await tick(15_000);
    expect(stateOf(roomId)!.isHandInProgress).toBe(false);

    expect(adapter.resume('someone-else', RUN).ok).toBe(false);
    expect(adapter.resume(PROFILE, 'stale-run')).toMatchObject({ ok: false, code: 'stale-state' });
    expect(adapter.resume(PROFILE, RUN)).toEqual({ ok: true });
    expect(adapter.resume(PROFILE, RUN)).toMatchObject({ ok: false, code: 'action-rejected' });
    await tick(2_100);
    expect(stateOf(roomId)!.isHandInProgress).toBe(true);
    expect(heroSeat(roomId)!.holeCards).toHaveLength(2);
    expect(heroSeat(roomId)!.status).not.toBe('sitting-out');
  });

  it('sparring: 목표 진행·halfway 인터럽트 hold·완주 후 onStepFinished(done)', async () => {
    const roomId = enter(sparringStep(3));
    expect(adapter.skipHandProgression(roomId)).toBe(false);
    expect(adapter.view(PROFILE)!.objectives.map(o => o.id)).toEqual(['played', 'win', 'survive']);

    const heldAtHalf = await pumpUntil(() => adapter.view(PROFILE)?.hold === true, { roomId: () => roomId });
    expect(heldAtHalf).toBe(true);
    const view = adapter.view(PROFILE)!;
    expect(view.holdReason).toBe('scene');
    expect(view.interruptId).toBe('int-half');
    expect(view.handsPlayed).toBe(2);
    expect(view.objectives.find(o => o.id === 'played')).toMatchObject({ progress: 2, target: 3, achieved: false, primary: true });
    expect(stateOf(roomId)!.isHandInProgress).toBe(false);

    // hold 중엔 다음 핸드가 잡히지 않는다
    await tick(15_000);
    expect(stateOf(roomId)!.handNumber).toBe(2);

    expect(adapter.resume(PROFILE, RUN)).toEqual({ ok: true });
    const finished = await pumpUntil(() => onStepFinished.mock.calls.length > 0, { roomId: () => roomId });
    expect(finished).toBe(true);
    const summary = onStepFinished.mock.calls[0][2];
    expect(summary.outcome).toBe('done');
    expect(summary.tag).toBe('대결');
    expect(summary.handsPlayed).toBe(3);
    expect(summary.primaryObjectivesMet).toBe(true);
    expect(summary.objectives.find(o => o.id === 'played')).toMatchObject({ progress: 3, achieved: true });
    expect(typeof summary.liveScore).toBe('number');
    expect(typeof summary.netBB).toBe('number');
    expect(manager.getRoom(roomId)).toBeUndefined();
    expect(adapter.hasSession(PROFILE)).toBe(false);
  });

  it('sparring: 미션형(minHands) — primary 목표를 전부 채우면 maxHands 전에 조기 종료한다', async () => {
    const step = sparringStep(10);
    step.minHands = 1;
    step.objectives = {
      primary: [{ id: 'fold', kind: 'fold-hands', label: '폴드해 보기', target: 1 }],
      bonus: [{ id: 'survive', kind: 'survive', label: '생존' }],
    };
    step.interrupts = [];
    const roomId = enter(step);
    expect(adapter.view(PROFILE)!.minHands).toBe(1);
    expect(adapter.view(PROFILE)!.maxHands).toBe(10);

    const finished = await pumpUntil(() => onStepFinished.mock.calls.length > 0, { roomId: () => roomId });
    expect(finished).toBe(true);
    const summary = onStepFinished.mock.calls[0][2];
    expect(summary.outcome).toBe('done');
    expect(summary.handsPlayed).toBeLessThan(10);
    expect(summary.objectives.find(o => o.id === 'fold')).toMatchObject({ achieved: true, primary: true });
    expect(summary.primaryObjectivesMet).toBe(true);
    expect(manager.getRoom(roomId)).toBeUndefined();
  });

  it('sparring: 미션형이라도 판정 불가(기회 없음) primary가 남아 있으면 조기 종료하지 않고 maxHands에서 끝난다', async () => {
    const step = sparringStep(2);
    step.minHands = 1;
    // quiz-accuracy는 라이브 퀴즈 집계가 없으면 항상 판정 불가(null) — "기회가 안 온 목표"의 대역
    step.objectives = { primary: [{ id: 'quiz', kind: 'quiz-accuracy', label: '리딩 퀴즈', minRatio: 0.5 }], bonus: [] };
    step.interrupts = [];
    const roomId = enter(step);

    const finished = await pumpUntil(() => onStepFinished.mock.calls.length > 0, { roomId: () => roomId });
    expect(finished).toBe(true);
    const summary = onStepFinished.mock.calls[0][2];
    expect(summary.handsPlayed).toBe(2);
    expect(summary.objectives.find(o => o.id === 'quiz')).toMatchObject({ achieved: null });
    // 기회 0 목표는 판정에서 빠지므로 통과를 막지 않는다(A13)
    expect(summary.primaryObjectivesMet).toBeNull();
  });

  it('sparring: first-showdown 인터럽트는 히어로가 딜인된 첫 경합 쇼다운 뒤 hold(scene)로 잡힌다', async () => {
    const step = sparringStep(10);
    step.interrupts = [
      { id: 'int-turn', trigger: { kind: 'first-my-turn' }, scene: { id: 'int-turn', lines: [] } },
      { id: 'int-showdown', trigger: { kind: 'first-showdown' }, scene: { id: 'int-showdown', lines: [] } },
    ];
    const roomId = enter(step);
    // 봇 랜덤성과 무관하게 첫 핸드를 경합 쇼다운으로 본다 (엔진 레코드는 불변 — 어댑터 입력만 감싼다)
    const engine = manager.getRoom(roomId)!.engine;
    const original = engine.getCompletedHandRecord.bind(engine);
    engine.getCompletedHandRecord = () => {
      const record = original();
      return record ? { ...record, showdown: true } : record;
    };
    const held = await pumpUntil(() => adapter.view(PROFILE)?.hold === true, { roomId: () => roomId, maxMs: 60_000 });
    expect(held).toBe(true);
    expect(adapter.view(PROFILE)).toMatchObject({ holdReason: 'scene', interruptId: 'int-showdown', handsPlayed: 1 });
    expect(stateOf(roomId)!.isHandInProgress).toBe(false);
    await tick(15_000);
    expect(stateOf(roomId)!.handNumber).toBe(1);
    expect(adapter.resume(PROFILE, RUN)).toEqual({ ok: true });
    await tick(2_100);
    expect(stateOf(roomId)!.handNumber).toBe(2);
    // 한 번 쓴 인터럽트는 다시 잡지 않는다
    const second = await pumpUntil(() => (adapter.view(PROFILE)?.handsPlayed ?? 0) >= 2 && !stateOf(roomId)!.isHandInProgress, { roomId: () => roomId, maxMs: 60_000 });
    expect(second).toBe(true);
    expect(adapter.view(PROFILE)!.hold).toBe(false);
  });

  it('sparring: 실제 Ch1 스파링 스텝의 first-showdown 인터럽트도 같은 경로로 잡힌다', async () => {
    const step = CH01.steps.find((candidate): candidate is Extract<Step, { kind: 'sparring' }> => candidate.kind === 'sparring')!;
    const roomId = enter(step);
    const engine = manager.getRoom(roomId)!.engine;
    const original = engine.getCompletedHandRecord.bind(engine);
    engine.getCompletedHandRecord = () => {
      const record = original();
      return record ? { ...record, showdown: true } : record;
    };
    const held = await pumpUntil(() => adapter.view(PROFILE)?.hold === true, { roomId: () => roomId, maxMs: 60_000 });
    expect(held).toBe(true);
    expect(adapter.view(PROFILE)).toMatchObject({ holdReason: 'scene', interruptId: 'act1-ch01:int-first-showdown' });
  });

  it('sparring: 히어로 파산은 회수가 아니라 failed 분기로 끝난다', async () => {
    const roomId = enter(sparringStep(10));
    // 핸드 사이에 히어로 스택을 0으로 — 다음 핸드 종료 시점(또는 beforeHand)에 실패 확정
    await tick(2_100);
    const reachedHand2 = await pumpUntil(
      () => !stateOf(roomId)!.isHandInProgress && (stateOf(roomId)?.handNumber ?? 0) >= 1,
      { roomId: () => roomId, maxMs: 60_000, step: 100 },
    );
    expect(reachedHand2).toBe(true);
    heroSeat(roomId)!.chips = 0;
    const finished = await pumpUntil(() => onStepFinished.mock.calls.length > 0, { roomId: () => roomId, maxMs: 60_000 });
    expect(finished).toBe(true);
    const summary = onStepFinished.mock.calls[0][2];
    expect(summary.outcome).toBe('failed');
    expect(summary.primaryObjectivesMet).toBe(false);
    expect(manager.getRoom(roomId)).toBeUndefined();
  });

  it('abandon: 진행 중 핸드에서도 방을 즉시 해체하고 코디네이터에 알리지 않는다', async () => {
    const roomId = enter(sparringStep(3));
    await tick(2_100);
    expect(stateOf(roomId)!.isHandInProgress).toBe(true);
    adapter.abandon(PROFILE);
    expect(manager.getRoom(roomId)).toBeUndefined();
    expect(adapter.hasSession(PROFILE)).toBe(false);
    expect(adapter.stats()).toEqual({ sessions: 0, rooms: 0, holds: 0 });
    await tick(20_000);
    expect(onStepFinished).not.toHaveBeenCalled();
  });

  it('room-lost: grace 만료로 방이 사라져도 집계를 보존하고 resume이 새 방으로 이어간다', async () => {
    const roomId = enter(sparringStep(5));
    const playedOne = await pumpUntil(() => (adapter.view(PROFILE)?.handsPlayed ?? 0) >= 1 && !stateOf(roomId)!.isHandInProgress, { roomId: () => roomId });
    expect(playedOne).toBe(true);
    const chipsBefore = heroSeat(roomId)!.chips;

    manager.handleDisconnect(roomId, PROFILE, Date.now() + 60_000);
    expect(manager.handleGraceExpired(roomId, PROFILE)).toBe(false);
    expect(manager.getRoom(roomId)).toBeUndefined();

    const lost = adapter.view(PROFILE)!;
    expect(lost.roomId).toBeNull();
    expect(lost.hold).toBe(true);
    expect(lost.holdReason).toBe('room-lost');
    expect(lost.handsPlayed).toBe(1);
    expect(adapter.phase(PROFILE)).toBe('live-hold');
    expect(onStepFinished).not.toHaveBeenCalled();

    seatHero.mockClear();
    expect(adapter.resume(PROFILE, RUN)).toEqual({ ok: true });
    const next = adapter.view(PROFILE)!;
    expect(next.roomId).not.toBeNull();
    expect(next.roomId).not.toBe(roomId);
    expect(next.hold).toBe(false);
    expect(next.handsPlayed).toBe(1);
    expect(seatHero).toHaveBeenCalledWith(PROFILE, next.roomId, { seatIndex: 0, chips: Math.max(20, chipsBefore) });
    await tick(2_100);
    expect(stateOf(next.roomId!)!.isHandInProgress).toBe(true);
  });

  it('hold 타임아웃: 상한을 넘긴 hold는 방을 해체하고 room-lost 보존으로 전환한다', async () => {
    adapter.shutdown();
    buildAdapter({ holdTimeoutMs: 5_000, sweepIntervalMs: 1_000 });
    const roomId = enter(sparringStep(2));
    // halfway(ceil(2/2)=1) → 첫 핸드 뒤 hold(scene)
    const held = await pumpUntil(() => adapter.view(PROFILE)?.hold === true, { roomId: () => roomId });
    expect(held).toBe(true);
    expect(adapter.view(PROFILE)!.holdReason).toBe('scene');
    await tick(7_000);
    expect(manager.getRoom(roomId)).toBeUndefined();
    const view = adapter.view(PROFILE)!;
    expect(view.roomId).toBeNull();
    expect(view.holdReason).toBe('room-lost');
    expect(view.handsPlayed).toBe(1);
  });

  it('봇 속마음은 수집만 하고 기본값에선 뷰에 싣지 않는다 (exposeBotThoughts=true면 노출)', async () => {
    const roomId = enter(sparringStep(3));
    const botActed = await pumpUntil(() => (stateOf(roomId)?.actionSeq ?? 0) > 3, { roomId: () => roomId, maxMs: 30_000 });
    expect(botActed).toBe(true);
    expect(adapter.view(PROFILE)!.botThoughts).toEqual([]);
    adapter.abandon(PROFILE);

    buildAdapter({ exposeBotThoughts: true });
    const roomId2 = enter(sparringStep(3), 'sakura', {
      1: { name: '가면 A', characterId: 'story-mask' },
      2: { name: '가면 B', characterId: 'story-mask' },
      3: { name: '가면 C', characterId: 'story-mask' },
    });
    const acted2 = await pumpUntil(() => (adapter.view(PROFILE)?.botThoughts.length ?? 0) > 0, { roomId: () => roomId2, maxMs: 30_000 });
    expect(acted2).toBe(true);
    const thought = adapter.view(PROFILE)!.botThoughts[0];
    expect(thought.playerId).toMatch(/^bot-/);
    expect(typeof thought.reason).toBe('string');
    expect(thought.text.length).toBeGreaterThan(0);
    // 속마음도 성향이 아니라 그 시점의 표시 얼굴을 스냅샷한다
    expect(thought.characterId).toBe('story-mask');
    expect(thought.characterId).toBe(
      stateOf(roomId2)!.players.find(player => player.id === thought.playerId)!.avatar,
    );
  });

  it('enter: 히어로 착석에 실패하면 방을 정리하되 스텝을 건너뛰지 않고 room-lost hold로 보존한다 (이어하기가 재시도)', async () => {
    seatHero.mockImplementationOnce(() => false);
    const entered = adapter.enter({
      profileId: PROFILE,
      runId: RUN,
      chapterId: 'act1-ch01',
      chapterTitle: '도장의 문',
      stepIndex: 3,
      step: practiceStep(),
      partnerId: null,
    });
    expect(entered).toBe('entered');
    expect(adapter.hasSession(PROFILE)).toBe(true);
    expect(manager.getRoomCount()).toBe(0);
    expect(adapter.view(PROFILE)).toMatchObject({ roomId: null, hold: true, holdReason: 'room-lost', handsPlayed: 0 });
    expect(adapter.phase(PROFILE)).toBe('live-hold');

    // 소켓이 돌아온 뒤 이어하기 → 같은 스텝을 새 방으로 연다
    expect(adapter.resume(PROFILE, RUN)).toEqual({ ok: true });
    const roomId = adapter.view(PROFILE)!.roomId;
    expect(roomId).toBeTruthy();
    await tick(2_100);
    expect(stateOf(roomId!)!.isHandInProgress).toBe(true);
  });

  it('abandon: 핸드 정산이 미해결이면 방을 닫지 못하고 false — 세션·방 소유권을 유지하고 회복 뒤 다시 성공한다', async () => {
    adapter.shutdown();
    manager.shutdown();
    let failCompleteHand = true;
    manager = new RoomManager(() => {}, () => {}, undefined, {
      progression: {
        captureHandStart: () => {},
        confirmHandStart: () => {},
        cancelHand: () => {},
        completeHand: () => {
          if (failCompleteHand) throw new Error('db down');
        },
        completeSng: () => {},
        disposeRoom: () => {},
      },
    });
    seatHero.mockImplementation((profileId: string, roomId: string, seat: { seatIndex: number; chips: number }) => (
      manager.joinRoom(roomId, makeHero(profileId, seat))
    ));
    buildAdapter();
    const roomId = enter(sparringStep(5)); // 스파링은 핸드 XP 경로를 탄다 → completeHand 실패 → 정산 미해결
    const settled = await pumpUntil(
      () => (stateOf(roomId)?.handNumber ?? 0) >= 1 && !stateOf(roomId)!.isHandInProgress,
      { roomId: () => roomId, maxMs: 60_000, step: 100 },
    );
    expect(settled).toBe(true);

    expect(adapter.abandon(PROFILE)).toBe(false);
    expect(manager.getRoom(roomId)).toBeDefined();
    expect(adapter.hasSession(PROFILE)).toBe(true);
    expect(adapter.view(PROFILE)!.roomId).toBe(roomId);

    // 저장 연결 회복 → RoomManager 정산 재시도(10초 간격) 성공 → 이제 닫을 수 있다
    failCompleteHand = false;
    await tick(11_000);
    expect(adapter.abandon(PROFILE)).toBe(true);
    expect(manager.getRoom(roomId)).toBeUndefined();
    expect(adapter.hasSession(PROFILE)).toBe(false);
  });

  it('partner 해석: 파트너가 없거나 라인업과 겹치면 다른 히로인으로 대체된다', () => {
    const step = practiceStep({
      lineup: [
        { seatIndex: 1, characterId: 'partner', stackBB: 100, role: 'partner' },
        { seatIndex: 2, characterId: 'sakura', stackBB: 100, role: 'neighbor' },
      ],
    });
    const roomId = enter(step, 'sakura');
    const bots = stateOf(roomId)!.players.filter(p => p.type === 'bot').map(p => p.personalityId);
    expect(bots).toHaveLength(2);
    expect(bots).toContain('sakura');
    expect(new Set(bots).size).toBe(2);
  });

  it('스토리 방 생성은 훅 없이는 fail-closed', () => {
    const bare = new RoomManager(() => {}, () => {});
    expect(() => bare.createRoom({
      name: 'x', smallBlind: 10, bigBlind: 20, minBuyIn: 2000, maxBuyIn: 2000, maxPlayers: 6,
      economyMode: 'practice', turnTime: 30, gameMode: 'cash', botCount: 0, tableType: 'bots',
      storyChapterId: 'act1-ch01',
    })).toThrow(/story hooks/);
    expect(() => bare.createRoom({
      name: 'x', smallBlind: 10, bigBlind: 20, minBuyIn: 2000, maxBuyIn: 2000, maxPlayers: 6,
      economyMode: 'practice', turnTime: 30, gameMode: 'cash', botCount: 0, tableType: 'bots',
      botThinkScale: 0.5,
    })).toThrow(/storyChapterId/);
    bare.shutdown();
  });
  describe('가면 봇 identity', () => {
    // 좌석 1(파트너 좌석)만 공용 가면으로 가린다 — 실제 성향은 라인업이 그대로 정한다
    const MASK: LiveEnterInput['botDisplaysBySeat'] = {
      1: { name: '가면 A', characterId: 'story-mask' },
    };

    function seatOne(roomId: string): Player {
      return stateOf(roomId)!.players.find(player => player.seatIndex === 1)!;
    }

    it('가면 좌석은 표시 identity만 공개하고 실제 성향은 서버에만 남는다', () => {
      const roomId = enter(practiceStep(), 'sakura', MASK);
      const bot = seatOne(roomId);
      expect(bot).toMatchObject({ name: '가면 A', avatar: 'story-mask', personalityId: 'sakura' });
      expect(bot.id).not.toContain('sakura');

      const publicSeat = manager.getRoom(roomId)!.engine.getPublicState(PROFILE)
        .players.find(player => player.seatIndex === 1)!;
      expect(publicSeat).toMatchObject({ id: bot.id, name: '가면 A', avatar: 'story-mask' });
      expect('personalityId' in publicSeat).toBe(false);

      // 가면을 씌우지 않은 좌석은 그대로 실제 캐릭터를 보여준다
      expect(stateOf(roomId)!.players.find(player => player.seatIndex === 2)).toMatchObject({
        avatar: 'kapi', personalityId: 'kapi',
      });
    });

    it('room-lost 재개는 저장된 계획을 재사용해 성향·가면을 그대로 이어간다', () => {
      const roomId = enter(practiceStep(), null, MASK);
      const before = { personalityId: seatOne(roomId).personalityId, name: seatOne(roomId).name };
      expect(before.name).toBe('가면 A');

      manager.handleDisconnect(roomId, PROFILE, Date.now() + 60_000);
      expect(manager.handleGraceExpired(roomId, PROFILE)).toBe(false);
      expect(adapter.view(PROFILE)!.roomId).toBeNull();

      expect(adapter.resume(PROFILE, RUN)).toEqual({ ok: true });
      const resumedRoomId = adapter.view(PROFILE)!.roomId!;
      expect(resumedRoomId).not.toBe(roomId);
      expect(seatOne(resumedRoomId)).toMatchObject({
        personalityId: before.personalityId,
        name: '가면 A',
        avatar: 'story-mask',
      });
    });

    it('공개는 stale 요청을 거절하고, 성공해도 id·성향은 그대로 둔 채 얼굴만 바꾼다', async () => {
      buildAdapter({ exposeBotThoughts: true });
      const roomId = enter(sparringStep(10), 'sakura', MASK);
      const bot = seatOne(roomId);
      const before = { id: bot.id, personalityId: bot.personalityId, seatIndex: bot.seatIndex };

      expect(adapter.revealBotIdentity(PROFILE, 'old-run', 1)).toMatchObject({ ok: false, code: 'stale-state' });
      expect(adapter.revealBotIdentity('someone-else', RUN, 1)).toMatchObject({ ok: false, code: 'stale-state' });
      expect(adapter.revealBotIdentity(PROFILE, RUN, 5)).toMatchObject({ ok: false, code: 'action-rejected' });
      expect(seatOne(roomId)).toMatchObject({ name: '가면 A', avatar: 'story-mask' });

      expect(adapter.revealBotIdentity(PROFILE, RUN, 1)).toEqual({ ok: true });
      expect(seatOne(roomId)).toMatchObject({ ...before, name: '사쿠라', avatar: 'sakura' });

      // 공개 뒤 새로 쌓이는 속마음 스냅샷은 실제 얼굴을 쓴다
      const acted = await pumpUntil(
        () => (adapter.view(PROFILE)?.botThoughts ?? []).some(thought => thought.playerId === before.id),
        { roomId: () => roomId, maxMs: 60_000 },
      );
      expect(acted).toBe(true);
      const thought = adapter.view(PROFILE)!.botThoughts.find(candidate => candidate.playerId === before.id)!;
      expect(thought.characterId).toBe('sakura');
    });

    it('방이 없는 동안의 공개는 계획에 남아 다음 재개 방에 실제 얼굴로 적용된다', () => {
      const roomId = enter(practiceStep(), 'sakura', MASK);
      manager.handleDisconnect(roomId, PROFILE, Date.now() + 60_000);
      expect(manager.handleGraceExpired(roomId, PROFILE)).toBe(false);
      expect(adapter.view(PROFILE)!.roomId).toBeNull();

      expect(adapter.revealBotIdentity(PROFILE, RUN, 1)).toEqual({ ok: true });
      expect(adapter.resume(PROFILE, RUN)).toEqual({ ok: true });

      const resumedRoomId = adapter.view(PROFILE)!.roomId!;
      expect(seatOne(resumedRoomId)).toMatchObject({
        personalityId: 'sakura', name: '사쿠라', avatar: 'sakura',
      });
    });

    it('잘못된 표시 identity는 방을 만들기 전에 거절하고 room-lost hold로 남긴다', () => {
      expect(adapter.enter({
        profileId: PROFILE,
        runId: RUN,
        chapterId: 'act1-ch01',
        chapterTitle: '도장의 문',
        stepIndex: 3,
        step: practiceStep(),
        partnerId: 'sakura',
        botDisplaysBySeat: { 1: { name: '가면 A', characterId: 'missing-character' } },
      })).toBe('entered');

      expect(manager.getRoomCount()).toBe(0);
      expect(seatHero).not.toHaveBeenCalled();
      expect(adapter.view(PROFILE)).toMatchObject({ roomId: null, hold: true, holdReason: 'room-lost' });
    });
  });

  describe('operator forceFinish', () => {
    it('ends a sparring step at once with every objective achieved, disposes the room and reports synchronously', async () => {
      const roomId = enter(sparringStep(3));
      await tick(50);
      expect(adapter.forceFinish(PROFILE)).toBe('finished');
      expect(manager.getRoom(roomId)).toBeUndefined();
      expect(adapter.hasSession(PROFILE)).toBe(false);
      expect(adapter.view(PROFILE)).toBeNull();
      expect(onStepFinished).toHaveBeenCalledTimes(1);
      const summary = onStepFinished.mock.calls[0][2];
      expect(summary.outcome).toBe('done');
      expect(summary.tag).toBe('대결');
      expect(summary.primaryObjectivesMet).toBe(true);
      expect(summary.liveScore).toBe(1);
      expect(summary.objectives.length).toBeGreaterThan(0);
      expect(summary.objectives.every(objective => objective.achieved)).toBe(true);
      expect(summary.objectives.find(objective => objective.id === 'played')).toMatchObject({ progress: 3, target: 3 });
      expect(adapter.forceFinish(PROFILE)).toBe('no-session');
    });

    it('keeps a practice step summary objective-less (null primary/score)', async () => {
      enter(practiceStep());
      await tick(50);
      expect(adapter.forceFinish(PROFILE)).toBe('finished');
      const summary = onStepFinished.mock.calls[0][2];
      expect(summary).toMatchObject({ outcome: 'done', tag: '연습', objectives: [], primaryObjectivesMet: null, liveScore: null });
    });
  });
  it('does not manufacture mandatory Ch7 quiz completion when an operator ends the live step', () => {
    const step = structuredClone(CH07.steps.find(step => step.kind === 'sparring')!) as Extract<Step, { kind: 'sparring' }>;
    enter(step);
    expect(adapter.forceFinish(PROFILE)).toBe('finished');
    expect(onStepFinished.mock.calls[0][2].primaryObjectivesMet).toBe(false);
    expect(onStepFinished.mock.calls[0][2].objectives.find(o => o.id === 'ch07-quiz')?.achieved).toBe(false);
  });
  it('Ch7: twelve real hands lead to four locked quizzes; room loss preserves the deadline and offline issues no new question', async () => {
    const step = structuredClone(CH07.steps.find(step => step.kind === 'sparring')!) as Extract<Step, { kind: 'sparring' }>;
    const roomId = enter(step);
    expect(await pumpUntil(() => !!adapter.view(PROFILE)?.pendingQuiz, { maxMs: 500_000 })).toBe(true);
    expect(adapter.view(PROFILE)?.handsPlayed).toBe(12);
    const question = adapter.view(PROFILE)!.pendingQuiz!;
    expect(adapter.resume(PROFILE, RUN).ok).toBe(false);
    const publicBefore = JSON.stringify(adapter.view(PROFILE));
    for (const id of ['mochi','choco','gumi','chloe']) expect(publicBefore).not.toContain(id);
    expect(manager.disposeRoom(roomId, 'idle')).toBe(true);
    expect(adapter.view(PROFILE)?.pendingQuiz).toEqual(question);
    await tick(30_001);
    expect(adapter.view(PROFILE)?.pendingQuiz).toBeNull();
    expect(adapter.view(PROFILE)?.masquerade?.answered).toBe(1);
    await tick(90_000);
    expect(adapter.view(PROFILE)?.masquerade?.answered).toBe(1);
    expect(adapter.resume(PROFILE, RUN).ok).toBe(true);
    const newRoomId = adapter.view(PROFILE)!.roomId!;
    expect(newRoomId).not.toBe(roomId);
    for (let i = 1; i < 4; i++) {
      const q = adapter.view(PROFILE)!.pendingQuiz!;
      const personality = stateOf(newRoomId)!.players.find(p => p.seatIndex === q.seatIndex)!.personalityId;
      const optionIndex = ['mochi','choco','gumi','chloe'].indexOf(personality!);
      const receipt = adapter.answerQuiz(PROFILE, { runId: RUN, quizId: q.quizId, optionIndex });
      expect(receipt).toEqual({ ok: true, receipt: { quizId: q.quizId, accepted: true } });
      expect(adapter.answerQuiz(PROFILE, { runId: RUN, quizId: q.quizId, optionIndex: (optionIndex + 1) % 4 })).toEqual(receipt);
      if (i < 3) { expect(adapter.view(PROFILE)?.masquerade?.feedback).toBeNull(); expect(adapter.view(PROFILE)?.objectives[0].progress).toBe(0); }
    }
    expect(adapter.view(PROFILE)?.masquerade?.feedback).toHaveLength(4);
    expect(adapter.view(PROFILE)?.objectives[0]).toMatchObject({ achieved: true, progress: 0.75 });
    expect(stateOf(newRoomId)!.players.filter(p => p.type === 'bot').every(p => p.avatar !== 'story-mask')).toBe(true);
    const hands = stateOf(newRoomId)!.handNumber;
    await tick(10_000);
    expect(stateOf(newRoomId)!.handNumber).toBe(hands);
    expect(adapter.resume(PROFILE, RUN).ok).toBe(true);
    expect(adapter.view(PROFILE)?.masquerade?.phase).toBe('revealed-play');
    expect(await pumpUntil(() => onStepFinished.mock.calls.length > 0, { maxMs: 500_000 })).toBe(true);
    expect(onStepFinished.mock.calls[0][2].objectives.find(o => o.id === 'ch07-quiz')?.achieved).toBe(true);
  });

});
