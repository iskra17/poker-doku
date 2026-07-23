import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { RoomManager } from './room-manager';
import { TournamentManager } from './tournament-manager';
import { MTT_STRUCTURES } from '../lib/poker/mtt-structure';
import type { GameState } from '../lib/poker/types';

function prepareH4hBubble(
  tm: TournamentManager,
  rm: RoomManager,
): { tournamentId: string; tables: string[] } {
  const created = tm.createTournament({
    name: 'H4H 준비',
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
    tm.register(created.tournamentId, { id: `h${i}`, name: `u${i}`, avatar: 'ara' });
  }
  expect(tm.startTournament(created.tournamentId, 'h1')).toBe('ok');

  while (tm.listTournaments()[0].remaining > 6) {
    const roomId = rm.getAdminRoomSummaries()
      .filter(r => r.mode === 'mtt')
      .map(r => ({
        id: r.id,
        alive: rm.getRoom(r.id)!.engine.state.players.filter(
          p => p.chips > 0 && !p.finishPlace && !p.pendingRemoval,
        ).length,
      }))
      .sort((a, b) => b.alive - a.alive)[0].id;
    const engine = rm.getRoom(roomId)!.engine;
    const player = engine.state.players.find(
      p => p.chips > 0 && !p.finishPlace && !p.pendingRemoval,
    );
    if (!player) throw new Error('no player to bust');
    player.handStartChips = player.chips;
    player.chips = 0;
    tm.roomHooks.onHandComplete(roomId);
  }

  return {
    tournamentId: created.tournamentId,
    tables: rm.getAdminRoomSummaries().filter(r => r.mode === 'mtt').map(r => r.id),
  };
}

/**
 * 브레이크 배리어 회귀 — 특히 "두 번째 브레이크" 후 재개 (2026-07-23 라이브 QA에서
 * 두 번째 브레이크 이후 테이블이 영영 재개되지 않는 교착 발견).
 */
describe('MTT break resume', () => {
  let rm: RoomManager;
  let tm: TournamentManager;
  let publicSnapshots: Array<{ roomId: string; state: GameState }>;

  beforeEach(() => {
    vi.useFakeTimers();
    publicSnapshots = [];
    rm = new RoomManager((roomId, engine) => {
      publicSnapshots.push({
        roomId,
        state: JSON.parse(JSON.stringify(engine.getPublicState())) as GameState,
      });
    }, () => {});
    tm = new TournamentManager(rm, { isConnected: () => true });
  });

  afterEach(() => {
    tm.shutdown();
    rm.shutdown();
    vi.useRealTimers();
  });

  it('resumes tables after the first AND second break', () => {
    const s = MTT_STRUCTURES.standard; // 레벨 8분 · 6레벨마다 5분 브레이크 (env 미적용 기본)
    const created = tm.createTournament({
      name: '브레이크',
      speed: 'standard',
      maxEntrants: 8,
      tableSize: 6,
      startAt: null,
      botFill: false,
      turnTime: 15,
      hostId: 'h1',
    });
    if (!created.ok) throw new Error('create failed');
    for (let i = 1; i <= 5; i++) {
      tm.register(created.tournamentId, { id: `h${i}`, name: `u${i}`, avatar: 'ara' });
    }
    expect(tm.startTournament(created.tournamentId, 'h1')).toBe('ok');
    const roomId = rm.getAdminRoomSummaries().find(r => r.mode === 'mtt')!.id;

    const playMs = s.levelDurationMs * s.breakEveryLevels;

    // --- 브레이크 1: 플레이 구간 종료 직후 핸드가 끝났다 ---
    vi.advanceTimersByTime(playMs + 1_000);
    expect(tm.roomHooks.onHandComplete(roomId)).toBe('hold');
    expect(tm.roomHooks.isHeld(roomId)).toBe(true);
    // 휴식 종료 → 재개
    vi.advanceTimersByTime(s.breakDurationMs + 1_000);
    expect(tm.roomHooks.isHeld(roomId)).toBe(false);

    // --- 브레이크 2: 다음 플레이 구간(6레벨) 종료 직후 ---
    vi.advanceTimersByTime(playMs);
    expect(tm.roomHooks.onHandComplete(roomId)).toBe('hold');
    expect(tm.roomHooks.isHeld(roomId)).toBe(true);
    vi.advanceTimersByTime(s.breakDurationMs + 1_000);
    expect(tm.roomHooks.isHeld(roomId)).toBe(false);

    // 브레이크가 아닐 때는 계속 진행
    vi.advanceTimersByTime(60_000);
    expect(tm.roomHooks.onHandComplete(roomId)).toBe('continue');
  });

  it('keeps a scheduled break held when a director pause is released first', () => {
    const s = MTT_STRUCTURES.standard;
    const created = tm.createTournament({
      name: '브레이크 겹침',
      speed: 'standard',
      maxEntrants: 8,
      tableSize: 6,
      startAt: null,
      botFill: false,
      turnTime: 15,
      hostId: 'h1',
    });
    if (!created.ok) throw new Error('create failed');
    for (let i = 1; i <= 5; i++) {
      tm.register(created.tournamentId, { id: `h${i}`, name: `u${i}`, avatar: 'ara' });
    }
    expect(tm.startTournament(created.tournamentId, 'h1')).toBe('ok');
    const roomId = rm.getAdminRoomSummaries().find(r => r.mode === 'mtt')!.id;
    vi.advanceTimersByTime(4_500);
    vi.advanceTimersByTime(s.levelDurationMs * s.breakEveryLevels + 1_000);
    expect(tm.roomHooks.onHandComplete(roomId)).toBe('hold');

    expect(tm.directorAction(created.tournamentId, 'h1', { kind: 'pause' })).toBe('ok');
    expect(rm.getRoom(roomId)!.engine.state.tournament?.holdReasons).toEqual([
      'director-pause',
      'scheduled-break',
    ]);
    expect(tm.getDetail(created.tournamentId)?.holdReasons).toEqual([
      'director-pause',
      'scheduled-break',
    ]);

    const resume = vi.spyOn(rm, 'resumeRoom');
    expect(tm.directorAction(created.tournamentId, 'h1', { kind: 'resume' })).toBe('ok');
    expect(tm.roomHooks.isHeld(roomId)).toBe(true);
    expect(resume).not.toHaveBeenCalled();

    vi.advanceTimersByTime(s.breakDurationMs + 1_000);
    expect(tm.roomHooks.isHeld(roomId)).toBe(false);
    expect(resume).toHaveBeenCalledWith(roomId);
  });

  it('resumes after break 2 even after a final-table merge', () => {
    // 2026-07-23 라이브 교착 재현 형태: 2테이블 → 파이널 통합 →
    // 헤즈업 진행 중 두 번째 브레이크 도달
    const s = MTT_STRUCTURES.standard;
    const created = tm.createTournament({
      name: '교착 재현',
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
      tm.register(created.tournamentId, { id: `h${i}`, name: `u${i}`, avatar: 'ara' });
    }
    expect(tm.startTournament(created.tournamentId, 'h1')).toBe('ok');
    const tables = rm.getAdminRoomSummaries().filter(r => r.mode === 'mtt').map(r => r.id);
    expect(tables.length).toBe(2);
    const [t1, t2] = tables;
    const engine = (roomId: string) => rm.getRoom(roomId)!.engine;
    const bustAt = (roomId: string, count: number) => {
      const alive = engine(roomId).state.players.filter(
        p => p.chips > 0 && !p.finishPlace && !p.pendingRemoval,
      ).slice(0, count);
      alive.forEach((p, i) => {
        p.handStartChips = 100 * (i + 1);
        p.chips = 0;
      });
    };

    // 12 → 7명 — paid(12)=4, 버블은 remaining 5
    bustAt(t1, 3);
    expect(tm.roomHooks.onHandComplete(t1)).toBe('continue'); // 9명 (3v6)
    bustAt(t2, 2);
    expect(tm.roomHooks.onHandComplete(t2)).toBe('continue'); // 7명 (3v4)

    // remaining 5 도달 → H4H보다 파이널 병합이 우선
    bustAt(t2, 2);
    expect(['hold', 'gone']).toContain(tm.roomHooks.onHandComplete(t2));
    const remainingTables = rm.getAdminRoomSummaries().filter(r => r.mode === 'mtt').map(r => r.id);
    expect(remainingTables.length).toBe(1);
    const finalTable = remainingTables[0];
    expect(engine(finalTable).state.tournament?.stage).toBe('final-intro');
    vi.advanceTimersByTime(4_500);
    expect(engine(finalTable).state.tournament?.stage).toBe('final-playing');

    // 두 번째 브레이크 구간으로 시계 이동 → 핸드 종료 → 보류 → 휴식 종료 후 재개
    const playMs = s.levelDurationMs * s.breakEveryLevels;
    vi.advanceTimersByTime(2 * playMs + s.breakDurationMs + 5_000);
    expect(tm.roomHooks.onHandComplete(finalTable)).toBe('hold');
    expect(tm.roomHooks.isHeld(finalTable)).toBe(true);
    vi.advanceTimersByTime(s.breakDurationMs + 1_000);
    expect(tm.roomHooks.isHeld(finalTable)).toBe(false);
    expect(tm.roomHooks.onHandComplete(finalTable)).toBe('continue');
  });

  it('does not resume an H4H-held table while a director pause still applies', () => {
    const { tournamentId, tables: [t1, t2] } = prepareH4hBubble(tm, rm);
    const engine = (roomId: string) => rm.getRoom(roomId)!.engine;

    // 버블 도달 시 다른 테이블이 아직 핸드 중이면 H4H 배리어가 유지된다.
    engine(t2).state.isHandInProgress = true;
    const bubble = engine(t1).state.players.find(
      p => p.chips > 0 && !p.finishPlace && !p.pendingRemoval,
    )!;
    bubble.handStartChips = bubble.chips;
    bubble.chips = 0;
    expect(tm.roomHooks.onHandComplete(t1)).toBe('hold');
    expect(tm.directorAction(tournamentId, 'h1', { kind: 'pause' })).toBe('ok');

    const resume = vi.spyOn(rm, 'resumeRoom');
    engine(t2).state.isHandInProgress = false;
    expect(tm.roomHooks.onHandComplete(t2)).toBe('hold');

    expect(tm.roomHooks.isHeld(t1)).toBe(true);
    expect(tm.roomHooks.isHeld(t2)).toBe(true);
    expect(resume).not.toHaveBeenCalled();

    expect(tm.directorAction(tournamentId, 'h1', { kind: 'resume' })).toBe('ok');
    expect(resume).toHaveBeenCalledWith(t1);
    expect(resume).toHaveBeenCalledWith(t2);
  });

  it('consumes an H4H permit only after a hand actually starts', () => {
    const { tables: [t1] } = prepareH4hBubble(tm, rm);
    const engine = (roomId: string) => rm.getRoom(roomId)!.engine;
    const bubble = engine(t1).state.players.find(
      p => p.chips > 0 && !p.finishPlace && !p.pendingRemoval,
    )!;
    bubble.handStartChips = bubble.chips;
    bubble.chips = 0;
    expect(tm.roomHooks.onHandComplete(t1)).toBe('hold');
    expect(tm.roomHooks.isHeld(t1)).toBe(false);

    tm.roomHooks.applyLevel(t1, engine(t1));
    expect(tm.roomHooks.isHeld(t1)).toBe(false);

    const previousHandNumber = engine(t1).state.handNumber;
    engine(t1).startHand();
    expect(engine(t1).state.handNumber).toBe(previousHandNumber + 1);
    tm.roomHooks.onHandStarted(t1, engine(t1).state.handNumber);
    expect(tm.roomHooks.isHeld(t1)).toBe(true);
  });

  it('balances a 4-max 1-versus-4 bubble before arming H4H', () => {
    const { tables: [shortRoomId, fullRoomId] } = prepareH4hBubble(tm, rm);
    const short = rm.getRoom(shortRoomId)!.engine;
    const full = rm.getRoom(fullRoomId)!.engine;
    short.removePendingPlayers();
    full.removePendingPlayers();

    // remaining 6을 의도적으로 2대4로 만든 뒤 숏 테이블에서 한 명이 탈락해 1대4 버블이 된다.
    const mover = short.state.players.find(p => p.chips > 0)!;
    const occupied = new Set(full.state.players.map(p => p.seatIndex));
    const emptySeat = [0, 1, 2, 3].find(seat => !occupied.has(seat));
    if (emptySeat === undefined) throw new Error('missing destination seat');
    expect(rm.transferMttSeat(shortRoomId, fullRoomId, mover.id, emptySeat)).toBe(true);

    const bubble = short.state.players.find(
      p => p.chips > 0 && !p.finishPlace && !p.pendingRemoval,
    )!;
    bubble.handStartChips = bubble.chips;
    bubble.chips = 0;
    expect(tm.roomHooks.onHandComplete(shortRoomId)).toBe('hold');

    const counts = [shortRoomId, fullRoomId]
      .map(roomId => rm.getRoom(roomId)!.engine.state.players.filter(
        p => p.chips > 0 && !p.finishPlace && !p.pendingRemoval,
      ).length)
      .sort((a, b) => a - b);
    expect(counts).toEqual([2, 3]);
    expect(tm.roomHooks.isHeld(shortRoomId)).toBe(false);
    expect(tm.roomHooks.isHeld(fullRoomId)).toBe(false);
  });

  it('retries 1-versus-4 balance when the large table finishes later', () => {
    const { tables: [shortRoomId, fullRoomId] } = prepareH4hBubble(tm, rm);
    const short = rm.getRoom(shortRoomId)!.engine;
    const full = rm.getRoom(fullRoomId)!.engine;
    short.removePendingPlayers();
    full.removePendingPlayers();

    const mover = short.state.players.find(p => p.chips > 0)!;
    const occupied = new Set(full.state.players.map(p => p.seatIndex));
    const emptySeat = [0, 1, 2, 3].find(seat => !occupied.has(seat));
    if (emptySeat === undefined) throw new Error('missing destination seat');
    expect(rm.transferMttSeat(shortRoomId, fullRoomId, mover.id, emptySeat)).toBe(true);

    full.state.isHandInProgress = true;
    const bubble = short.state.players.find(
      p => p.chips > 0 && !p.finishPlace && !p.pendingRemoval,
    )!;
    bubble.handStartChips = bubble.chips;
    bubble.chips = 0;
    expect(tm.roomHooks.onHandComplete(shortRoomId)).toBe('hold');
    expect(tm.roomHooks.isHeld(shortRoomId)).toBe(true);
    expect(tm.roomHooks.isHeld(fullRoomId)).toBe(true);

    full.state.isHandInProgress = false;
    expect(tm.roomHooks.onHandComplete(fullRoomId)).toBe('hold');

    const counts = [shortRoomId, fullRoomId]
      .map(roomId => rm.getRoom(roomId)!.engine.state.players.filter(
        p => p.chips > 0 && !p.finishPlace && !p.pendingRemoval,
      ).length)
      .sort((a, b) => a - b);
    expect(counts).toEqual([2, 3]);
    expect(tm.roomHooks.isHeld(shortRoomId)).toBe(false);
    expect(tm.roomHooks.isHeld(fullRoomId)).toBe(false);
  });

  it('arms H4H on remaining tables when bubble balancing breaks the completed table', () => {
    const created = tm.createTournament({
      name: 'gone 뒤 H4H',
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
      tm.register(created.tournamentId, { id: `h${i}`, name: `u${i}`, avatar: 'ara' });
    }
    expect(tm.startTournament(created.tournamentId, 'h1')).toBe('ok');
    const [t1, t2, completedRoomId] = rm.getAdminRoomSummaries()
      .filter(r => r.mode === 'mtt')
      .map(r => r.id);
    const eliminate = (roomId: string, count: number) => {
      const players = rm.getRoom(roomId)!.engine.state.players
        .filter(p => p.chips > 0 && !p.finishPlace && !p.pendingRemoval)
        .slice(0, count);
      for (const player of players) tm.roomHooks.onPlayerLeave(roomId, player.id);
    };
    eliminate(t1, 2);
    eliminate(t2, 1);
    eliminate(completedRoomId, 3);
    expect(tm.listTournaments()[0].remaining).toBe(6);

    const completed = rm.getRoom(completedRoomId)!.engine;
    const bubble = completed.state.players.find(
      p => p.chips > 0 && !p.finishPlace && !p.pendingRemoval,
    )!;
    bubble.handStartChips = bubble.chips;
    bubble.chips = 0;
    expect(tm.roomHooks.onHandComplete(completedRoomId)).toBe('gone');

    expect(rm.getRoom(completedRoomId)).toBeUndefined();
    const remainingRooms = rm.getAdminRoomSummaries()
      .filter(r => r.mode === 'mtt')
      .map(r => r.id);
    expect(remainingRooms).toHaveLength(2);
    expect(tm.getAdminSummaries()[0].h4hActive).toBe(true);
    for (const roomId of remainingRooms) {
      expect(tm.roomHooks.isHeld(roomId)).toBe(false);
    }
  });

  it('broadcasts one public snapshot per hold batch when another hold remains', () => {
    const created = tm.createTournament({
      name: '보류 공개',
      speed: 'standard',
      maxEntrants: 8,
      tableSize: 6,
      startAt: null,
      botFill: false,
      turnTime: 15,
      hostId: 'h1',
    });
    if (!created.ok) throw new Error('create failed');
    for (let i = 1; i <= 5; i++) {
      tm.register(created.tournamentId, { id: `h${i}`, name: `u${i}`, avatar: 'ara' });
    }
    expect(tm.startTournament(created.tournamentId, 'h1')).toBe('ok');
    const roomId = rm.getAdminRoomSummaries().find(r => r.mode === 'mtt')!.id;

    publicSnapshots = [];
    expect(tm.directorAction(created.tournamentId, 'h1', { kind: 'pause' })).toBe('ok');
    expect(publicSnapshots).toHaveLength(1);
    expect(publicSnapshots[0].roomId).toBe(roomId);
    expect(publicSnapshots[0].state.tournament?.stage).toBe('final-intro');
    expect(publicSnapshots[0].state.tournament?.holdReasons).toEqual([
      'director-pause',
      'final-intro',
    ]);

    publicSnapshots = [];
    vi.advanceTimersByTime(4_500);
    expect(publicSnapshots).toHaveLength(1);
    expect(publicSnapshots[0].state.tournament?.stage).toBe('final-playing');
    expect(publicSnapshots[0].state.tournament?.holdReasons).toEqual(['director-pause']);
  });

  it('enters final-forming before an idle removal and finishes after the seat is removed', () => {
    const { tournamentId, tables } = prepareH4hBubble(tm, rm);
    const [sourceRoomId] = tables;
    const source = rm.getRoom(sourceRoomId)!.engine;
    source.removePendingPlayers();

    const first = source.state.players.find(p => p.chips > 0)!;
    expect(rm.leaveRoom(sourceRoomId, first.id)).toBe(true);
    expect(tm.getDetail(tournamentId)?.summary.remaining).toBe(5);
    expect(tm.getDetail(tournamentId)?.stage).toBe('multi-table');

    const target = source.state.players.find(p => p.chips > 0)!;
    const originalProcessLeave = source.processLeave.bind(source);
    let stageBeforeRemoval: string | undefined;
    let holdsBeforeRemoval: string[] | undefined;
    vi.spyOn(source, 'processLeave').mockImplementation(playerId => {
      if (playerId === target.id) {
        stageBeforeRemoval = source.state.tournament?.stage;
        holdsBeforeRemoval = source.state.tournament?.holdReasons;
      }
      return originalProcessLeave(playerId);
    });

    expect(rm.leaveRoom(sourceRoomId, target.id)).toBe(true);
    expect(stageBeforeRemoval).toBe('final-forming');
    expect(holdsBeforeRemoval).toEqual(['final-forming']);

    const finalRooms = rm.getAdminRoomSummaries().filter(r => r.mode === 'mtt').map(r => r.id);
    expect(finalRooms).toHaveLength(1);
    const final = rm.getRoom(finalRooms[0])!.engine;
    expect(final.state.players.filter(p => p.chips > 0 && !p.pendingRemoval)).toHaveLength(4);
    expect(final.state.tournament?.stage).toBe('final-intro');
    expect(final.state.tournament?.holdReasons).toEqual(['final-intro']);
  });
});
