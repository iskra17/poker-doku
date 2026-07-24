import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { RoomManager } from './room-manager';
import {
  TournamentManager,
  type TournamentRuntimeHooks,
} from './tournament-manager';
import type { PokerEngine } from '../lib/poker/engine';
import { computePayouts } from '../lib/poker/payout-table';

/**
 * MTT 오케스트레이션 통합 테스트.
 * 핸드 자체는 시작시키지 않고(예약 타이머 미진행 = 항상 "핸드 사이" 상태),
 * 엔진 스택을 직접 조작한 뒤 roomHooks를 호출해 탈락/밸런싱/H4H/완주를
 * 결정론적으로 검증한다.
 */

interface Harness {
  roomManager: RoomManager;
  manager: TournamentManager;
  events: {
    seated: Array<{ playerId: string; roomId: string }>;
    moved: Array<{ playerId: string; fromRoomId: string; toRoomId: string }>;
    eliminated: Array<{ playerId: string; place: number; prize: number }>;
  };
}

function createHarness(hooks: Partial<TournamentRuntimeHooks> = {}): Harness {
  const events: Harness['events'] = { seated: [], moved: [], eliminated: [] };
  const roomManager = new RoomManager(() => {}, () => {});
  const manager = new TournamentManager(roomManager, {
    isConnected: () => true,
    onSeated: ({ playerId, roomId }) => events.seated.push({ playerId, roomId }),
    onPlayerMoved: ({ playerId, fromRoomId, toRoomId }) =>
      events.moved.push({ playerId, fromRoomId, toRoomId }),
    onEliminated: ({ playerId, place, prize }) =>
      events.eliminated.push({ playerId, place, prize }),
    ...hooks,
  });
  return { roomManager, manager, events };
}

function mttTableIds(roomManager: RoomManager): string[] {
  return roomManager
    .getAdminRoomSummaries()
    .filter(room => room.mode === 'mtt')
    .map(room => room.id);
}

function engineOf(roomManager: RoomManager, roomId: string): PokerEngine {
  const room = roomManager.getRoom(roomId);
  if (!room) throw new Error(`room not found: ${roomId}`);
  return room.engine;
}

/** 지정 플레이어를 이번 핸드 버스트로 조작 (handStartChips = 버스트 직전 스택) */
function bust(engine: PokerEngine, playerId: string, handStartChips: number): void {
  const player = engine.state.players.find(p => p.id === playerId);
  if (!player) throw new Error(`player not found: ${playerId}`);
  player.handStartChips = handStartChips;
  player.chips = 0;
}

function aliveIds(engine: PokerEngine): string[] {
  return engine.state.players
    .filter(p => p.chips > 0 && !p.finishPlace && !p.pendingRemoval)
    .map(p => p.id);
}

/** 12인(휴먼 전용) 토너먼트를 등록·시작하고 테이블 2개를 반환 */
function start12(h: Harness): { id: string; tables: string[] } {
  const created = h.manager.createTournament({
    name: '테스트 MTT',
    speed: 'standard',
    maxEntrants: 12,
    tableSize: 6,
    startAt: null,
    botFill: false,
    turnTime: 15,
    hostId: 'h1',
  });
  if (!created.ok) throw new Error('create failed');
  for (let i = 1; i <= 12; i++) {
    expect(h.manager.register(created.tournamentId, {
      id: `h${i}`, name: `유저${i}`, avatar: 'ara',
    })).toBe('ok');
  }
  expect(h.manager.startTournament(created.tournamentId, 'h1')).toBe('ok');
  const tables = mttTableIds(h.roomManager);
  expect(tables.length).toBe(2);
  return { id: created.tournamentId, tables };
}

function prepareFourMaxH4hBubble(h: Harness): { id: string; tables: string[] } {
  const created = h.manager.createTournament({
    name: '동률 H4H',
    speed: 'standard',
    maxEntrants: 12,
    tableSize: 4,
    startAt: null,
    botFill: false,
    turnTime: 15,
    hostId: 'h1',
  });
  if (!created.ok) throw new Error('create failed');
  for (let i = 1; i <= 12; i++) {
    h.manager.register(created.tournamentId, {
      id: `h${i}`, name: `유저${i}`, avatar: 'ara',
    });
  }
  expect(h.manager.startTournament(created.tournamentId, 'h1')).toBe('ok');

  while (h.manager.listTournaments()[0].remaining > 6) {
    const candidates = mttTableIds(h.roomManager)
      .map(id => ({ id, alive: aliveIds(engineOf(h.roomManager, id)).length }))
      .sort((a, b) => b.alive - a.alive);
    const roomId = candidates[0]?.id;
    if (!roomId || candidates[0].alive === 0) {
      throw new Error(
        `no live H4H candidate: remaining=${h.manager.listTournaments()[0].remaining} `
        + `${JSON.stringify(candidates)}`,
      );
    }
    const engine = engineOf(h.roomManager, roomId);
    bust(engine, aliveIds(engine)[0], 100);
    h.manager.roomHooks.onHandComplete(roomId);
  }

  return { id: created.tournamentId, tables: mttTableIds(h.roomManager) };
}

function runCrossTableTie(
  callbackOrder: 'forward' | 'reverse',
): Array<{ playerId: string; place: number; prize: number }> {
  const local = createHarness();
  try {
    const { tables } = prepareFourMaxH4hBubble(local);
    const [firstRoomId, secondRoomId] = tables;
    const first = engineOf(local.roomManager, firstRoomId);
    const second = engineOf(local.roomManager, secondRoomId);

    // 6 → 5명: 버블 H4H를 무장한 뒤 두 테이블이 같은 라운드를 시작한다.
    bust(first, aliveIds(first)[0], 100);
    expect(local.manager.roomHooks.onHandComplete(firstRoomId)).toBe('hold');
    for (const [roomId, engine] of [
      [firstRoomId, first],
      [secondRoomId, second],
    ] as const) {
      engine.startHand();
      local.manager.roomHooks.onHandStarted(roomId, engine.state.handNumber);
    }

    const firstPlayerId = aliveIds(first)[0];
    const secondPlayerId = aliveIds(second)[0];
    bust(first, firstPlayerId, 777);
    bust(second, secondPlayerId, 777);

    const callbacks = callbackOrder === 'forward'
      ? [[firstRoomId, first], [secondRoomId, second]] as const
      : [[secondRoomId, second], [firstRoomId, first]] as const;
    for (const [roomId, engine] of callbacks) {
      engine.state.isHandInProgress = false;
      local.manager.roomHooks.onHandComplete(roomId);
    }

    return local.events.eliminated
      .filter(event => event.playerId === firstPlayerId || event.playerId === secondPlayerId)
      .sort((a, b) => a.playerId.localeCompare(b.playerId));
  } finally {
    local.manager.shutdown();
    local.roomManager.shutdown();
  }
}

describe('TournamentManager', () => {
  let h: Harness;

  beforeEach(() => {
    vi.useFakeTimers();
    h = createHarness();
  });

  afterEach(() => {
    h.manager.shutdown();
    h.roomManager.shutdown();
    vi.useRealTimers();
  });

  it('seats humans round-robin and fills with bots to max entrants', () => {
    const created = h.manager.createTournament({
      name: '봇 충원 MTT',
      speed: 'turbo',
      maxEntrants: 12,
      tableSize: 6,
      startAt: null,
      botFill: true,
      turnTime: 15,
      hostId: 'h1',
    });
    if (!created.ok) throw new Error('create failed');
    for (let i = 1; i <= 3; i++) {
      h.manager.register(created.tournamentId, { id: `h${i}`, name: `유저${i}`, avatar: 'ara' });
    }
    expect(h.manager.startTournament(created.tournamentId, 'h2')).toBe('not-host');
    expect(h.manager.startTournament(created.tournamentId, 'h1')).toBe('ok');

    const tables = mttTableIds(h.roomManager);
    expect(tables.length).toBe(2);
    let humans = 0;
    let bots = 0;
    for (const roomId of tables) {
      const engine = engineOf(h.roomManager, roomId);
      expect(engine.state.players.length).toBe(6);
      expect(engine.state.tournament?.entrants).toBe(12);
      humans += engine.state.players.filter(p => p.type === 'human').length;
      bots += engine.state.players.filter(p => p.type === 'bot').length;
      // 시작 스택 확인
      for (const p of engine.state.players) expect(p.chips).toBe(10000);
      // 테이블 내 봇 캐릭터 중복 없음
      const ids = engine.state.players
        .filter(p => p.type === 'bot')
        .map(p => p.personalityId);
      expect(new Set(ids).size).toBe(ids.length);
    }
    expect(humans).toBe(3);
    expect(bots).toBe(9);
    expect(h.events.seated.length).toBe(3);

    const summary = h.manager.listTournaments('h1')[0];
    expect(summary.phase).toBe('running');
    expect(summary.remaining).toBe(12);
    expect(summary.prizePool).toBe(120000);
    expect(summary.registered).toBe(true);
    expect(summary.myTableRoomId).toBeDefined();
  });

  it('rejects registration when full/closed/duplicate', () => {
    const created = h.manager.createTournament({
      name: '등록 게이트',
      speed: 'standard',
      maxEntrants: 8,
      tableSize: 6,
      startAt: null,
      botFill: false,
      turnTime: 15,
      hostId: 'h1',
    });
    if (!created.ok) throw new Error('create failed');
    for (let i = 1; i <= 8; i++) {
      h.manager.register(created.tournamentId, { id: `h${i}`, name: `유저${i}`, avatar: 'ara' });
    }
    expect(h.manager.register(created.tournamentId, { id: 'h9', name: '늦음', avatar: 'ara' }))
      .toBe('full');
    expect(h.manager.register(created.tournamentId, { id: 'h1', name: '중복', avatar: 'ara' }))
      .toBe('already');
    h.manager.startTournament(created.tournamentId, 'h1');
    expect(h.manager.register(created.tournamentId, { id: 'h9', name: '늦음', avatar: 'ara' }))
      .toBe('closed');
  });

  it('drops disconnected registrants at start (check-in = connection)', () => {
    const offline = new Set(['h2', 'h4']);
    h = createHarness({ isConnected: id => !offline.has(id) });
    const created = h.manager.createTournament({
      name: '체크인',
      speed: 'standard',
      maxEntrants: 10,
      tableSize: 6,
      startAt: null,
      botFill: false,
      turnTime: 15,
      hostId: 'h1',
    });
    if (!created.ok) throw new Error('create failed');
    for (let i = 1; i <= 10; i++) {
      h.manager.register(created.tournamentId, { id: `h${i}`, name: `유저${i}`, avatar: 'ara' });
    }
    expect(h.manager.startTournament(created.tournamentId, 'h1')).toBe('ok');
    const tables = mttTableIds(h.roomManager);
    const seatedIds = tables.flatMap(roomId =>
      engineOf(h.roomManager, roomId).state.players.map(p => p.id));
    expect(seatedIds).not.toContain('h2');
    expect(seatedIds).not.toContain('h4');
    expect(seatedIds.length).toBe(8);
    expect(h.manager.listTournaments()[0].remaining).toBe(8);
  });

  it('requires eight actual starters unless practice bot fill reaches the minimum', () => {
    const humansOnly = h.manager.createTournament({
      name: '최소 인원',
      speed: 'standard',
      maxEntrants: 8,
      tableSize: 6,
      startAt: null,
      botFill: false,
      turnTime: 15,
      hostId: 'h1',
    });
    if (!humansOnly.ok) throw new Error('create failed');
    for (let i = 1; i <= 7; i++) {
      h.manager.register(humansOnly.tournamentId, {
        id: `h${i}`,
        name: `유저${i}`,
        avatar: 'ara',
      });
    }
    expect(h.manager.startTournament(humansOnly.tournamentId, 'h1')).toBe('not-enough');
    expect(mttTableIds(h.roomManager)).toHaveLength(0);

    const botFill = h.manager.createTournament({
      name: '봇 최소 인원 충원',
      speed: 'standard',
      maxEntrants: 8,
      tableSize: 6,
      startAt: null,
      botFill: true,
      turnTime: 15,
      hostId: 'h2',
    });
    if (!botFill.ok) throw new Error('create failed');
    h.manager.register(botFill.tournamentId, {
      id: 'h8',
      name: '유저8',
      avatar: 'ara',
    });

    expect(h.manager.startTournament(botFill.tournamentId, 'h2')).toBe('ok');
    expect(h.manager.listTournaments().find(t => t.id === botFill.tournamentId)?.entrantCount)
      .toBe(8);
  });

  it('auto-cancels a scheduled tournament with too few checked-in entrants', () => {
    h = createHarness({ isConnected: () => false });
    const created = h.manager.createTournament({
      name: '자동 취소',
      speed: 'standard',
      maxEntrants: 8,
      tableSize: 6,
      startAt: Date.now() + 60_000,
      botFill: false,
      turnTime: 15,
      hostId: 'h1',
    });
    if (!created.ok) throw new Error('create failed');
    h.manager.register(created.tournamentId, { id: 'h1', name: '유저1', avatar: 'ara' });
    vi.advanceTimersByTime(61_000);
    expect(h.manager.listTournaments()[0]?.phase).toBe('cancelled');
    expect(mttTableIds(h.roomManager).length).toBe(0);
  });

  it('assigns global places (simultaneous busts by hand-start stack) and balances tables', () => {
    const { tables } = start12(h);
    const [t1, t2] = tables;
    const e1 = engineOf(h.roomManager, t1);

    // t1에서 2명 동시 버스트 — 시작 스택 작은 쪽이 하위
    const [a, b] = aliveIds(e1).slice(0, 2);
    bust(e1, a, 500);
    bust(e1, b, 300);
    expect(h.manager.roomHooks.onHandComplete(t1)).toBe('continue');

    const bPlayer = e1.state.players.find(p => p.id === b)!;
    const aPlayer = e1.state.players.find(p => p.id === a)!;
    expect(bPlayer.finishPlace).toBe(12); // 작은 스택이 12위
    expect(aPlayer.finishPlace).toBe(11);
    expect(bPlayer.pendingRemoval).toBe(true);
    expect(h.events.eliminated.map(e => e.place).sort()).toEqual([11, 12]);
    expect(h.manager.listTournaments()[0].remaining).toBe(10);

    // t2(6인)가 핸드를 끝내면 격차(6 vs 4)>1 — 다음 BB가 t1로 이동
    expect(h.manager.roomHooks.onHandComplete(t2)).toBe('continue');
    const e2 = engineOf(h.roomManager, t2);
    expect(aliveIds(e2).length).toBe(5);
    expect(aliveIds(e1).length).toBe(5);
    expect(h.events.moved.length).toBe(1);
    expect(h.events.moved[0].fromRoomId).toBe(t2);
    expect(h.events.moved[0].toRoomId).toBe(t1);
    // 이동한 플레이어의 칩 보존
    const movedId = h.events.moved[0].playerId;
    const moved = e1.state.players.find(p => p.id === movedId)!;
    expect(moved.chips).toBe(10000);
  });

  it('breaks same-table equal-stack eliminations by seat order left of the button', () => {
    const { tables: [roomId] } = start12(h);
    const engine = engineOf(h.roomManager, roomId);
    engine.state.dealerIndex = 0;
    const firstLeft = engine.state.players[1];
    const fartherLeft = engine.state.players[3];

    bust(engine, firstLeft.id, 500);
    bust(engine, fartherLeft.id, 500);
    expect(h.manager.roomHooks.onHandComplete(roomId)).toBe('continue');

    expect(firstLeft.finishPlace).toBe(11);
    expect(fartherLeft.finishPlace).toBe(12);
  });

  it('gives cross-table equal-stack H4H busts identical results regardless of callback order', () => {
    let randomCall = 0;
    const random = vi.spyOn(Math, 'random').mockImplementation(
      () => ((randomCall++ % 997) + 1) / 1_000,
    );
    try {
      randomCall = 0;
      const forward = runCrossTableTie('forward');
      randomCall = 0;
      const reverse = runCrossTableTie('reverse');
      const ladder = computePayouts(120_000, 12);

      expect(reverse).toEqual(forward);
      expect(forward.map(result => result.place)).toEqual([4, 4]);
      expect(forward.reduce((sum, result) => sum + result.prize, 0))
        .toBe((ladder[3] ?? 0) + (ladder[4] ?? 0));
    } finally {
      random.mockRestore();
    }
  });

  it('merges to a final table before arming H4H when the field fits', () => {
    const { id, tables } = start12(h);
    const [t1, t2] = tables;
    const e1 = engineOf(h.roomManager, t1);
    const e2 = engineOf(h.roomManager, t2);

    // 12 → 7명까지 정리 (paidPlaces(12)=4, 버블은 remaining 5)
    const t1Busts = aliveIds(e1).slice(0, 3);
    t1Busts.forEach((pid, i) => bust(e1, pid, 100 * (i + 1)));
    expect(h.manager.roomHooks.onHandComplete(t1)).toBe('continue'); // remaining 9
    const t2Busts = aliveIds(e2).slice(0, 2);
    t2Busts.forEach((pid, i) => bust(e2, pid, 100 * (i + 1)));
    // t2 완료: remaining 7 → 밸런싱 (t2:4 vs t1:3 — 격차 1, 이동 없음)
    expect(h.manager.roomHooks.onHandComplete(t2)).toBe('continue');
    expect(h.manager.listTournaments()[0].remaining).toBe(7);

    // 2명 더 탈락 → remaining 5 = 버블이지만 6-max 정원 안이므로 파이널 병합이 우선
    const more = aliveIds(e1).slice(0, 2);
    more.forEach((pid, i) => bust(e1, pid, 50 * (i + 1)));
    expect(['hold', 'gone']).toContain(h.manager.roomHooks.onHandComplete(t1));
    expect(h.roomManager.getRoom(t1)).toBeUndefined();
    expect(h.manager.listTournaments()[0].tableCount).toBe(1);
    expect(aliveIds(e2).length).toBe(5);
    expect(e2.state.tournament?.stage).toBe('final-intro');
    expect(h.manager.getTournamentIdForRoom(t2)).toBe(id);
  });

  it('forms a 1-versus-4 final table before H4H can start another hand', () => {
    const { id, tables } = start12(h);
    const [t1, t2] = tables;
    const e1 = engineOf(h.roomManager, t1);
    const e2 = engineOf(h.roomManager, t2);

    aliveIds(e1).slice(0, 5).forEach((pid, i) => bust(e1, pid, 100 * (i + 1)));
    expect(h.manager.roomHooks.onHandComplete(t1)).toBe('continue');
    expect(aliveIds(e1)).toHaveLength(1);

    aliveIds(e2).slice(0, 2).forEach((pid, i) => bust(e2, pid, 100 * (i + 1)));
    const resume = vi.spyOn(h.roomManager, 'resumeMttRoomAfterPresentation');
    resume.mockClear();
    expect(h.manager.roomHooks.onHandComplete(t2)).toBe('hold');

    const finalTables = mttTableIds(h.roomManager);
    expect(finalTables).toHaveLength(1);
    const finalRoomId = finalTables[0];
    const finalEngine = engineOf(h.roomManager, finalRoomId);
    expect(h.manager.getTournamentIdForRoom(finalRoomId)).toBe(id);
    expect(aliveIds(finalEngine)).toHaveLength(5);
    expect(finalEngine.state.handNumber).toBe(0);
    expect(finalEngine.state.tournament?.stage).toBe('final-intro');
    expect(finalEngine.state.tournament?.holdReasons).toEqual(['final-intro']);
    expect(finalEngine.state.tournament?.stageEndsAt).toBe(Date.now() + 4_500);
    expect(resume).not.toHaveBeenCalledWith(finalRoomId);

    vi.advanceTimersByTime(4_499);
    expect(finalEngine.state.handNumber).toBe(0);
    expect(finalEngine.state.tournament?.stage).toBe('final-intro');
    vi.advanceTimersByTime(1);
    expect(finalEngine.state.tournament?.stage).toBe('final-playing');
    expect(resume).toHaveBeenCalledTimes(1);
  });

  it('runs the final intro once before the first hand of a single-table MTT', () => {
    const created = h.manager.createTournament({
      name: '단일 테이블 파이널',
      speed: 'standard',
      maxEntrants: 8,
      tableSize: 8,
      startAt: null,
      botFill: false,
      turnTime: 15,
      hostId: 'h1',
    });
    if (!created.ok) throw new Error('create failed');
    for (let i = 1; i <= 8; i++) {
      h.manager.register(created.tournamentId, {
        id: `h${i}`, name: `유저${i}`, avatar: 'ara',
      });
    }
    expect(h.manager.startTournament(created.tournamentId, 'h1')).toBe('ok');
    const [roomId] = mttTableIds(h.roomManager);
    const engine = engineOf(h.roomManager, roomId);

    expect(engine.state.handNumber).toBe(0);
    expect(engine.state.tournament?.stage).toBe('final-intro');
    expect(engine.state.tournament?.holdReasons).toEqual(['final-intro']);
    expect(engine.state.tournament?.stageEndsAt).toBe(Date.now() + 4_500);

    h.roomManager.resumeRoom(roomId);
    vi.advanceTimersByTime(4_499);
    expect(engine.state.handNumber).toBe(0);
    expect(engine.state.tournament?.stage).toBe('final-intro');

    vi.advanceTimersByTime(1);
    expect(engine.state.tournament?.stage).toBe('final-playing');
    vi.advanceTimersByTime(2_000);
    expect(engine.state.handNumber).toBe(1);

    // 재동기화성 resume은 파이널 인트로를 다시 만들지 않는다.
    h.roomManager.resumeRoom(roomId);
    expect(engine.state.tournament?.stage).toBe('final-playing');
  });

  it('expires only the final-intro hold while a director pause remains', () => {
    const created = h.manager.createTournament({
      name: '인트로 겹침',
      speed: 'standard',
      maxEntrants: 8,
      tableSize: 8,
      startAt: null,
      botFill: false,
      turnTime: 15,
      hostId: 'h1',
    });
    if (!created.ok) throw new Error('create failed');
    for (let i = 1; i <= 8; i++) {
      h.manager.register(created.tournamentId, {
        id: `h${i}`, name: `유저${i}`, avatar: 'ara',
      });
    }
    expect(h.manager.startTournament(created.tournamentId, 'h1')).toBe('ok');
    const [roomId] = mttTableIds(h.roomManager);
    const engine = engineOf(h.roomManager, roomId);
    expect(h.manager.directorAction(created.tournamentId, 'h1', { kind: 'pause' })).toBe('ok');
    expect(engine.state.tournament?.holdReasons).toEqual(['director-pause', 'final-intro']);

    const resume = vi.spyOn(h.roomManager, 'resumeMttRoomAfterPresentation');
    vi.advanceTimersByTime(4_500);
    expect(engine.state.tournament?.stage).toBe('final-playing');
    expect(engine.state.tournament?.holdReasons).toEqual(['director-pause']);
    expect(resume).not.toHaveBeenCalled();

    expect(h.manager.directorAction(created.tournamentId, 'h1', { kind: 'resume' })).toBe('ok');
    expect(engine.state.tournament?.holdReasons).toEqual([]);
    expect(resume).toHaveBeenCalledWith(roomId);
  });

  it('clears lower-priority holds when the tournament completes during final intro', () => {
    const created = h.manager.createTournament({
      name: '인트로 중 완료',
      speed: 'standard',
      maxEntrants: 8,
      tableSize: 8,
      startAt: null,
      botFill: false,
      turnTime: 15,
      hostId: 'h1',
    });
    if (!created.ok) throw new Error('create failed');
    for (let i = 1; i <= 8; i++) {
      h.manager.register(created.tournamentId, {
        id: `h${i}`, name: `유저${i}`, avatar: 'ara',
      });
    }
    expect(h.manager.startTournament(created.tournamentId, 'h1')).toBe('ok');
    const [roomId] = mttTableIds(h.roomManager);
    const engine = engineOf(h.roomManager, roomId);
    expect(h.manager.directorAction(created.tournamentId, 'h1', { kind: 'pause' })).toBe('ok');
    expect(engine.state.tournament?.holdReasons).toEqual(['director-pause', 'final-intro']);

    aliveIds(engine).slice(0, 7).forEach((playerId, i) => bust(engine, playerId, i + 1));
    expect(h.manager.roomHooks.onHandComplete(roomId)).toBe('hold');

    expect(engine.state.tournament?.finished).toBe(true);
    expect(engine.state.tournament?.stage).toBe('complete');
    expect(engine.state.tournament?.holdReasons).toEqual([]);
    expect(engine.state.tournament?.stageEndsAt).toBeUndefined();
    expect(h.manager.getDetail(created.tournamentId)?.holdReasons).toEqual([]);
    expect(h.manager.listTournaments()[0].holdReasons).toEqual([]);
  });

  it('arms final intro for only the time remaining on its published deadline', () => {
    let shiftedClock = false;
    h = createHarness({
      onTournamentUpdate: tournamentId => {
        if (!shiftedClock && h.manager.getDetail(tournamentId)?.stage === 'final-intro') {
          shiftedClock = true;
          vi.setSystemTime(Date.now() + 1_000);
        }
      },
    });
    const { tables } = start12(h);
    const [t1, t2] = tables;
    const e1 = engineOf(h.roomManager, t1);
    const e2 = engineOf(h.roomManager, t2);

    aliveIds(e1).slice(0, 5).forEach((playerId, i) => bust(e1, playerId, i + 1));
    expect(h.manager.roomHooks.onHandComplete(t1)).toBe('continue');
    aliveIds(e2).slice(0, 2).forEach((playerId, i) => bust(e2, playerId, i + 1));
    expect(h.manager.roomHooks.onHandComplete(t2)).toBe('hold');

    const [finalRoomId] = mttTableIds(h.roomManager);
    const finalEngine = engineOf(h.roomManager, finalRoomId);
    expect(shiftedClock).toBe(true);
    expect(finalEngine.state.tournament?.stageEndsAt).toBe(Date.now() + 3_500);

    vi.advanceTimersByTime(3_499);
    expect(finalEngine.state.tournament?.stage).toBe('final-intro');
    vi.advanceTimersByTime(1);
    expect(finalEngine.state.tournament?.stage).toBe('final-playing');
  });

  it('completes the tournament and pays the ladder exactly', () => {
    const { tables } = start12(h);
    const [t1, t2] = tables;
    const e1 = engineOf(h.roomManager, t1);
    const e2 = engineOf(h.roomManager, t2);

    // t1에서 5명 버스트 → 12~8위, 잔존 7 (테이블은 아직 2개 유지: target=ceil(7/6)=2)
    aliveIds(e1).slice(0, 5).forEach((pid, i) => bust(e1, pid, 100 * (i + 1)));
    expect(h.manager.roomHooks.onHandComplete(t1)).toBe('continue');
    expect(h.manager.listTournaments()[0].remaining).toBe(7);

    // t2에서 5명 버스트 → 7~3위, 잔존 2 → t2(현재 테이블)가 브레이크 후보로 해체됨
    aliveIds(e2).slice(0, 5).forEach((pid, i) => bust(e2, pid, 100 * (i + 1)));
    expect(h.manager.roomHooks.onHandComplete(t2)).toBe('gone');
    expect(h.roomManager.getRoom(t2)).toBeUndefined();
    expect(h.manager.listTournaments()[0].tableCount).toBe(1);
    expect(aliveIds(e1).length).toBe(2); // 헤즈업 파이널

    // 파이널 헤즈업 — 마지막 버스트로 우승 확정
    const finalists = aliveIds(e1);
    bust(e1, finalists[0], 3000);
    expect(h.manager.roomHooks.onHandComplete(t1)).toBe('hold');

    const summary = h.manager.listTournaments()[0];
    expect(summary.phase).toBe('completed');
    const detail = h.manager.getDetail(summary.id)!;
    expect(detail.standings.length).toBe(12);
    const places = detail.standings.map(r => r.place).sort((a, b) => (a ?? 0) - (b ?? 0));
    expect(places).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);

    // 페이아웃: 12명 필드 = 4명 입상, 상금 합 = 풀 전액 (반올림 보정)
    const paid = detail.standings.filter(r => r.prize > 0);
    expect(paid.length).toBe(4);
    expect(paid.every(r => (r.place ?? 99) <= 4)).toBe(true);
    expect(paid.reduce((s, r) => s + r.prize, 0)).toBe(120000);
    expect(detail.standings.find(r => r.place === 1)!.playerId).toBe(finalists[1]);

    // 파이널 테이블 엔진에 전체 결과 미러 (TournamentResultOverlay 계약)
    expect(e1.state.tournament!.finished).toBe(true);
    expect(e1.state.tournament!.results.length).toBe(12);
    // 다음 핸드는 시작되지 않는다 (완주 보류)
    expect(h.manager.roomHooks.isHeld(t1)).toBe(true);
  });

  it('counts mid-hand all-in seats as alive (no premature break/move)', () => {
    // 2026-07-23 라이브 QA 버그: 다른 테이블 라이브 핸드의 올인 좌석(chips 0)을 죽은 것으로
    // 세어 총 생존을 과소평가 → 조기 브레이크 → 정원 부족 부분 이주 → 이동 핑퐁
    const { tables } = start12(h);
    const [t1, t2] = tables;
    const e2 = engineOf(h.roomManager, t2);

    // t2를 "전원 올인 라이브 핸드" 상태로 조작 — 6명 모두 chips 0이지만 팟 지분 생존자
    e2.state.isHandInProgress = true;
    for (const p of e2.state.players) {
      p.handStartChips = p.chips;
      p.totalContributed = p.chips;
      p.chips = 0;
      p.status = 'all-in';
    }

    // t1 핸드 종료 → 총 생존은 여전히 12 — 브레이크/이동 없이 계속되어야 한다
    expect(h.manager.roomHooks.onHandComplete(t1)).toBe('continue');
    expect(h.manager.listTournaments()[0].tableCount).toBe(2);
    expect(h.events.moved.length).toBe(0);
    expect(engineOf(h.roomManager, t1).state.players.length).toBe(6);

    // 순위표에도 올인 생존자가 팟 기여분 포함 스택으로 표시된다
    const detail = h.manager.getDetail(h.manager.listTournaments()[0].id)!;
    const aliveRows = detail.standings.filter(r => r.place === null);
    expect(aliveRows.length).toBe(12);
    const t2Rows = aliveRows.filter(r => r.tableNo === 2);
    expect(t2Rows.every(r => r.chips === 10000)).toBe(true);
  });

  it('publishes the reduced table count after a non-final table break', () => {
    h.manager.shutdown();
    h.roomManager.shutdown();
    const onTournamentsChanged = vi.fn();
    h = createHarness({ onTournamentsChanged });

    const created = h.manager.createTournament({
      name: 'Table count refresh',
      speed: 'standard',
      maxEntrants: 18,
      tableSize: 6,
      startAt: null,
      botFill: false,
      turnTime: 15,
      hostId: 'h1',
    });
    if (!created.ok) throw new Error('create failed');
    for (let i = 1; i <= 18; i++) {
      h.manager.register(created.tournamentId, {
        id: `h${i}`,
        name: `u${i}`,
        avatar: 'ara',
      });
    }
    expect(h.manager.startTournament(created.tournamentId, 'h1')).toBe('ok');
    const [sourceRoomId] = mttTableIds(h.roomManager);
    const source = engineOf(h.roomManager, sourceRoomId);

    onTournamentsChanged.mockClear();
    aliveIds(source).forEach((playerId, index) => {
      bust(source, playerId, index + 1);
    });
    expect(h.manager.roomHooks.onHandComplete(sourceRoomId)).toBe('gone');

    expect(h.manager.listTournaments()[0].tableCount).toBe(2);
    expect(onTournamentsChanged).toHaveBeenCalledTimes(2);
  });

  it('aborts a table break entirely when destinations lack capacity', () => {
    const { tables } = start12(h);
    const [t1, t2] = tables;
    const e1 = engineOf(h.roomManager, t1);
    const e2 = engineOf(h.roomManager, t2);

    // t1에서 1명만 탈락 → 11명. t2를 라이브 핸드로 잠가 t1 완료 시점에 target 계산을 흔들어도
    // (모두 생존으로 계산되므로) 브레이크가 일어나지 않아야 하고, 어떤 부분 이주도 없어야 한다.
    bust(e1, aliveIds(e1)[0], 100);
    e2.state.isHandInProgress = true;
    expect(h.manager.roomHooks.onHandComplete(t1)).toBe('continue');
    expect(h.events.moved.length).toBe(0);
    expect(aliveIds(e1).length).toBe(5);
    expect(h.manager.listTournaments()[0].tableCount).toBe(2);
  });

  it('avoids duplicate bot characters across tables at start', () => {
    const created = h.manager.createTournament({
      name: '전역 캐릭터',
      speed: 'turbo',
      maxEntrants: 12,
      tableSize: 6,
      startAt: null,
      botFill: true,
      turnTime: 15,
      hostId: 'h1',
    });
    if (!created.ok) throw new Error('create failed');
    h.manager.register(created.tournamentId, { id: 'h1', name: '유저1', avatar: 'ara' });
    expect(h.manager.startTournament(created.tournamentId, 'h1')).toBe('ok');

    const ids = mttTableIds(h.roomManager).flatMap(roomId =>
      engineOf(h.roomManager, roomId).state.players
        .filter(p => p.type === 'bot')
        .map(p => p.personalityId));
    expect(ids.length).toBe(11); // 봇 11 ≤ 로스터 16 → 전역 중복 없어야 한다
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('sweepIdleRooms never reclaims tournament tables', () => {
    // 2026-07-23 라이브 교착: 휴먼 전원 탈락 후 봇만 남은 파이널 테이블을 유휴 스윕이
    // 회수해 토너먼트가 영영 완주하지 못했다
    const { tables } = start12(h);
    for (const roomId of tables) {
      // 휴먼 전원 탈락 상황을 흉내 — 봇만 남은 방
      for (const p of engineOf(h.roomManager, roomId).state.players) p.type = 'bot';
    }
    expect(h.roomManager.sweepIdleRooms(0)).toBe(0);
    for (const roomId of tables) {
      expect(h.roomManager.getRoom(roomId)).toBeDefined();
    }
  });

  it('gives duplicate bot characters numbered names (48인 풀필드 — 2026-07-24 모바일 QA)', () => {
    const created = h.manager.createTournament({
      name: '풀필드',
      speed: 'turbo',
      maxEntrants: 48,
      tableSize: 6,
      startAt: null,
      botFill: true,
      turnTime: 15,
      hostId: 'h1',
    });
    if (!created.ok) throw new Error('create failed');
    h.manager.register(created.tournamentId, { id: 'h1', name: '유저1', avatar: 'ara' });
    expect(h.manager.startTournament(created.tournamentId, 'h1')).toBe('ok');

    const players = mttTableIds(h.roomManager).flatMap(roomId =>
      engineOf(h.roomManager, roomId).state.players);
    expect(players.length).toBe(48);
    // 순위표/로비에서 구분 가능해야 한다 — 전 좌석 이름 유일
    const names = players.map(p => p.name);
    expect(new Set(names).size).toBe(names.length);
    // 로스터(16) 초과분은 번호 접미 (엘레나, 엘레나 2, 엘레나 3 …)
    expect(names.some(name => / 2$/.test(name))).toBe(true);

    // 게임 중 상세 진입점 — 각 테이블 엔진 미러에 토너먼트 ID가 실린다
    for (const roomId of mttTableIds(h.roomManager)) {
      expect(engineOf(h.roomManager, roomId).state.tournament?.tournamentId)
        .toBe(created.tournamentId);
    }
  });

  it('sit-out leave keeps the seat — no reclaim, no elimination (TDA 30 블라인드 소진)', () => {
    const { tables } = start12(h);
    const [t1] = tables;
    const e1 = engineOf(h.roomManager, t1);

    const leaver = e1.state.players[0].id; // 셔플 배치라 t1의 실제 좌석에서 선택
    h.roomManager.sitOutAndLeave(t1, leaver);
    const player = e1.state.players.find(p => p.id === leaver)!;
    expect(player.sitOutNext || player.status === 'sitting-out').toBe(true);

    // 캐시라면 SITOUT_ABANDON_MS(5분) 후 회수되지만, MTT는 좌석을 절대 회수하지 않는다 —
    // 블라인드·앤티 소진으로만 자연 탈락한다 (회수하면 leaveRoom 경유 기권 탈락이 재발)
    vi.advanceTimersByTime(6 * 60_000);
    const after = engineOf(h.roomManager, t1).state.players.find(p => p.id === leaver);
    expect(after).toBeDefined();
    expect(after!.finishPlace).toBeUndefined();
    expect(after!.pendingRemoval).not.toBe(true);
  });

  it('records an explicit leave as elimination at current place', () => {
    const { tables } = start12(h);
    const [t1] = tables;
    const e1 = engineOf(h.roomManager, t1);
    const leaver = aliveIds(e1)[0];
    h.manager.roomHooks.onPlayerLeave(t1, leaver);
    const player = e1.state.players.find(p => p.id === leaver)!;
    expect(player.finishPlace).toBe(12);
    expect(h.manager.listTournaments()[0].remaining).toBe(11);
    // 중복 호출은 무시
    h.manager.roomHooks.onPlayerLeave(t1, leaver);
    expect(h.manager.listTournaments()[0].remaining).toBe(11);
  });
});
