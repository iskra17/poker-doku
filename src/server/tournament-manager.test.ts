import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { RoomManager } from './room-manager';
import {
  TournamentManager,
  type TournamentRuntimeHooks,
} from './tournament-manager';
import type { PokerEngine } from '../lib/poker/engine';

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
    expect(h.manager.startTournament(created.tournamentId, 'h1')).toBe('ok');
    const tables = mttTableIds(h.roomManager);
    const seatedIds = tables.flatMap(roomId =>
      engineOf(h.roomManager, roomId).state.players.map(p => p.id));
    expect(seatedIds).not.toContain('h2');
    expect(seatedIds).not.toContain('h4');
    expect(seatedIds.length).toBe(6);
    expect(h.manager.listTournaments()[0].remaining).toBe(6);
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

  it('runs hand-for-hand at the bubble and breaks tables to a final table', () => {
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

    // 2명 더 탈락 → remaining 5 = 버블 → H4H 발동
    const more = aliveIds(e1).slice(0, 2);
    more.forEach((pid, i) => bust(e1, pid, 50 * (i + 1)));
    expect(h.manager.roomHooks.onHandComplete(t1)).toBe('hold');
    // 전 테이블이 핸드 사이 → 즉시 무장되어 다음 동기화 핸드 허용
    expect(h.manager.roomHooks.isHeld(t1)).toBe(false);
    expect(h.manager.roomHooks.isHeld(t2)).toBe(false);

    // 동기화 핸드에서 버블 보이 탈락 → 순위 확정 + H4H 종료
    const bubbleBoy = aliveIds(e1)[0];
    bust(e1, bubbleBoy, 200);
    expect(h.manager.roomHooks.onHandComplete(t1)).toBe('hold');
    const bubblePlayer = e1.state.players.find(p => p.id === bubbleBoy)!;
    expect(bubblePlayer.finishPlace).toBe(5);
    expect(h.manager.listTournaments()[0].remaining).toBe(4);

    // t1은 1명만 남음 → t2가 핸드를 끝내면 테이블 브레이크 → 파이널 테이블
    expect(h.manager.roomHooks.onHandComplete(t2)).toBe('continue');
    expect(h.roomManager.getRoom(t1)).toBeUndefined();
    expect(h.manager.listTournaments()[0].tableCount).toBe(1);
    expect(aliveIds(e2).length).toBe(4);
    expect(h.manager.getTournamentIdForRoom(t2)).toBe(id);
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
