import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Player } from '../lib/poker/types';
import type { Step } from '../lib/story/types';
import { GRADUATION_STARTING_STACK } from './sng-structures';
import { RoomManager } from './room-manager';
import { LiveTableAdapter, type LiveStepSummary } from './story-live-adapter';

/**
 * 졸업 대결(토너먼트 정책) 어댑터 계약 — RoomManager 실물 + fake timers.
 *
 * 계약:
 *  ① 순위는 엔진 `finishPlace`/`tournament.entrants`에서만 나온다(칩 재추정·클라 제출값 금지).
 *  ② 방 재생성 경계는 **첫 딜 시작 여부**(`dealStarted`) — 그 뒤 방이 사라지면 순위 없는 종료.
 *  ③ 부재·끊김도 딜인·블라인드가 계속 나가고(SnG 계약) 어댑터는 hold하지 않는다.
 */

const PROFILE = 'hero-grad';
const RUN = 'run-grad';
const LINEUP = ['paeng', 'luna', 'vivian', 'elena', 'ingrid'] as const;

type TournamentStep = Extract<Step, { kind: 'sparring' }>;

function tournamentStep(maxHands = 400): TournamentStep {
  return {
    kind: 'sparring',
    id: 'ch12-graduation',
    tag: '대결',
    table: {
      tournament: { id: 'graduation-sng-v1', sngStructureId: 'graduation' },
      blinds: { small: 10, big: 20 },
      heroSeat: 0,
      heroStackBB: 50,
      lineup: LINEUP.map((characterId, index) => ({ seatIndex: index + 1, characterId, stackBB: 50 })),
      difficulty: 'normal',
      turnTimeSec: 30,
      botThinkScale: 0.5,
      hints: 0,
    },
    maxHands,
    objectives: { primary: [], bonus: [] },
    interrupts: [],
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

describe('LiveTableAdapter 졸업 대결', () => {
  let manager: RoomManager;
  let adapter: LiveTableAdapter;
  let onStepFinished: ReturnType<typeof vi.fn<(profileId: string, runId: string, summary: LiveStepSummary) => void>>;
  let onLiveChanged: ReturnType<typeof vi.fn<(profileId: string) => void>>;

  function enter(step: TournamentStep = tournamentStep()): string {
    const entered = adapter.enter({
      profileId: PROFILE,
      runId: RUN,
      chapterId: 'act4-ch12',
      chapterTitle: '졸업 시험',
      stepIndex: 5,
      step,
      partnerId: 'sakura',
    });
    expect(entered).toBe('entered');
    const roomId = adapter.view(PROFILE)?.roomId;
    expect(roomId).toBeTruthy();
    return roomId as string;
  }

  function chipTotal(roomId: string): number {
    const state = manager.getRoom(roomId)?.engine.state;
    if (!state) return 0;
    return state.players.reduce((sum, player) => sum + player.chips + player.totalContributed, 0);
  }

  /** 결과가 나올 때까지 fake timer를 돌린다 (방이 사라지면 멈춘다) */
  async function pump(maxMs = 45 * 60_000, step = 1_000): Promise<void> {
    for (let elapsed = 0; elapsed < maxMs; elapsed += step) {
      if (onStepFinished.mock.calls.length > 0) return;
      // 봇 사고 지연은 await 기반이라 microtask까지 흘려야 다음 액션이 나온다
      await vi.advanceTimersByTimeAsync(step);
    }
  }

  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubEnv('SNG_LEVEL_MS', '20000');
    manager = new RoomManager(() => {}, () => {});
    onStepFinished = vi.fn();
    onLiveChanged = vi.fn();
    adapter = new LiveTableAdapter({
      roomManager: manager,
      hero: {
        seatHero: (profileId, roomId, seat) => manager.joinRoom(roomId, makeHero(profileId, seat)),
      },
      sweepIntervalMs: 0,
      finishDelayMs: 0,
    });
    adapter.bindEvents({ onStepFinished, onLiveChanged });
    manager.setStoryHooks(adapter);
  });

  afterEach(() => {
    adapter.shutdown();
    manager.shutdown();
    vi.unstubAllEnvs();
    vi.useRealTimers();
  });

  it('실제 6인 SnG로 열리고 완주하면 엔진 순위를 요약에 싣는다', async () => {
    const roomId = enter();
    const room = manager.getRoom(roomId)!;
    expect(room.config.gameMode).toBe('sng');
    expect(room.config.sngStructureId).toBe('graduation');
    expect(room.engine.state.players).toHaveLength(6);
    expect(chipTotal(roomId)).toBe(6 * GRADUATION_STARTING_STACK);
    expect(room.engine.state.players.every(player => player.chips === GRADUATION_STARTING_STACK)).toBe(true);

    await pump();
    expect(onStepFinished).toHaveBeenCalledTimes(1);
    const summary = onStepFinished.mock.calls[0][2];
    expect(summary.outcome).toBe('done');
    expect(summary.tournament).toBeDefined();
    expect(summary.tournament!.entrants).toBe(6);
    expect(summary.tournament!.place).toBeGreaterThanOrEqual(1);
    expect(summary.tournament!.place).toBeLessThanOrEqual(6);
    expect(summary.tournament!.source).toBe('play');
    expect(summary.handsPlayed).toBeGreaterThan(0);
    expect(summary.primaryObjectivesMet).toBeNull();
    expect(manager.getRoom(roomId)).toBeUndefined();
  });

  it('히어로 탈락 순위는 엔진 finishPlace 그대로 실린다 (봇 우승을 기다리지 않는다)', () => {
    for (const place of [1, 3, 6]) {
      onStepFinished.mockClear();
      const roomId = enter();
      const state = manager.getRoom(roomId)!.engine.state;
      state.tournament!.entrants = 6;
      const hero = state.players.find(player => player.id === PROFILE)!;
      hero.finishPlace = place;
      if (place === 1) state.tournament!.finished = true;
      expect(adapter.onHandComplete(roomId)).toBe('hold');
      expect(onStepFinished).toHaveBeenCalledTimes(1);
      expect(onStepFinished.mock.calls[0][2].tournament).toEqual({ place, entrants: 6, source: 'play' });
      expect(manager.getRoom(roomId)).toBeUndefined();
      adapter.abandon(PROFILE);
    }
  });

  it('동시 탈락은 엔진의 handStartChips 우선순위를 그대로 따른다', () => {
    const roomId = enter();
    const engine = manager.getRoom(roomId)!.engine;
    const state = engine.state;
    state.tournament!.entrants = 6;
    const hero = state.players.find(player => player.id === PROFILE)!;
    const rival = state.players.find(player => player.id !== PROFILE)!;
    // 히어로가 더 큰 스택으로 시작했으면 동시 탈락에서 상위 순위를 받는다
    hero.chips = 0;
    hero.handStartChips = 400;
    rival.chips = 0;
    rival.handStartChips = 100;
    // 순위 확정은 엔진 내부 경로 — 어댑터는 그 결과(finishPlace)만 읽는다
    (engine as unknown as { finalizeTournamentHand(): void }).finalizeTournamentHand();
    expect(rival.finishPlace).toBe(6);
    expect(hero.finishPlace).toBe(5);
    expect(adapter.onHandComplete(roomId)).toBe('hold');
    expect(onStepFinished.mock.calls[0][2].tournament).toEqual({ place: 5, entrants: 6, source: 'play' });
  });

  it('끊긴 히어로도 hold 없이 딜인이 계속되고 재접속은 같은 방·스택으로 돌아온다', () => {
    const roomId = enter();
    const engine = manager.getRoom(roomId)!.engine;
    const hero = engine.state.players.find(player => player.id === PROFILE)!;
    hero.isDisconnected = true;
    vi.advanceTimersByTime(30_000);
    expect(engine.state.handNumber).toBeGreaterThan(0);
    expect(adapter.view(PROFILE)!.hold).toBe(false);
    expect(manager.getRoom(roomId)).toBeTruthy();

    const chipsWhileAway = hero.chips;
    hero.isDisconnected = false;
    expect(adapter.view(PROFILE)!.roomId).toBe(roomId);
    expect(hero.chips).toBe(chipsWhileAway);
    expect(chipTotal(roomId)).toBe(6 * GRADUATION_STARTING_STACK);
  });

  it('올인으로 칩이 0인 좌석도 남은 인원에 센다', () => {
    const roomId = enter();
    const state = manager.getRoom(roomId)!.engine.state;
    state.isHandInProgress = true;
    const hero = state.players.find(player => player.id === PROFILE)!;
    hero.chips = 0;
    hero.status = 'all-in';
    expect(adapter.view(PROFILE)!.tournament).toMatchObject({ alive: 6, entrants: 6, heroPlace: null });
    // 핸드가 끝나고도 칩이 없으면(순위 확정 전) 다음 핸드 전까지는 생존자가 아니다
    state.isHandInProgress = false;
    hero.status = 'folded';
    expect(adapter.view(PROFILE)!.tournament!.alive).toBe(5);
  });

  it('첫 딜 전 방 소실은 room-lost 보존, 첫 딜 뒤 방 소실은 순위 없는 종료다', () => {
    const before = enter();
    expect(manager.disposeRoom(before, 'idle')).toBe(true);
    expect(onStepFinished).not.toHaveBeenCalled();
    expect(adapter.view(PROFILE)!.holdReason).toBe('room-lost');
    const resumed = adapter.resume(PROFILE, RUN);
    expect(resumed.ok).toBe(true);
    const reopened = adapter.view(PROFILE)!.roomId!;
    expect(reopened).not.toBe(before);
    expect(manager.getRoom(reopened)!.engine.state.players.find(p => p.id === PROFILE)!.chips)
      .toBe(GRADUATION_STARTING_STACK);

    // 첫 핸드가 시작된 뒤
    vi.advanceTimersByTime(3_000);
    expect(manager.getRoom(reopened)!.engine.state.handNumber).toBeGreaterThan(0);
    expect(manager.disposeRoom(reopened, 'idle')).toBe(true);
    expect(onStepFinished).toHaveBeenCalledTimes(1);
    const summary = onStepFinished.mock.calls[0][2];
    expect(summary.outcome).toBe('abandoned');
    expect(summary.tournament).toBeUndefined();
    expect(adapter.hasSession(PROFILE)).toBe(false);
  });

  it('maxHands 폭주 가드는 순위 없이 실패로 끝낸다', async () => {
    const roomId = enter(tournamentStep(2));
    await pump(10 * 60_000);
    expect(onStepFinished).toHaveBeenCalledTimes(1);
    const summary = onStepFinished.mock.calls[0][2];
    // 2핸드 안에 순위가 났으면 정상 종료, 아니면 폭주 가드
    if (summary.tournament) {
      expect(summary.outcome).toBe('done');
    } else {
      expect(summary.outcome).toBe('failed');
      expect(summary.handsPlayed).toBeGreaterThanOrEqual(2);
    }
    expect(manager.getRoom(roomId)).toBeUndefined();
  });

  it('포기는 방을 즉시 정리하고 결과를 남기지 않는다', () => {
    const roomId = enter();
    vi.advanceTimersByTime(3_000);
    expect(adapter.abandon(PROFILE)).toBe(true);
    expect(manager.getRoom(roomId)).toBeUndefined();
    expect(adapter.hasSession(PROFILE)).toBe(false);
    expect(onStepFinished).not.toHaveBeenCalled();
  });

  it('운영자 스킵은 1위 · operator-skip 출처로 확정한다', () => {
    const roomId = enter();
    vi.advanceTimersByTime(3_000);
    expect(adapter.forceFinish(PROFILE)).toBe('finished');
    expect(onStepFinished).toHaveBeenCalledTimes(1);
    expect(onStepFinished.mock.calls[0][2].tournament).toEqual({ place: 1, entrants: 6, source: 'operator-skip' });
    expect(manager.getRoom(roomId)).toBeUndefined();
  });
});
