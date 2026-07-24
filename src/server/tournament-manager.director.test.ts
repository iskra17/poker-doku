import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { RoomManager } from './room-manager';
import {
  TournamentManager,
  type MttEconomyHooks,
} from './tournament-manager';
import type { PokerEngine } from '../lib/poker/engine';

/**
 * 디렉터 콘솔(Phase 2) — 개설자 전용 운영 개입 회귀.
 * - pause: 시계 동결 + 전 테이블 다음 핸드 보류 (isHeld)
 * - resume: 정지 구간을 pauseAccum으로 제외하고 시계 재개
 * - set-level: 정지 중에만, 시계를 해당 레벨 시작점으로 리셋 + 다음 핸드 경계 적용
 * - remove-player: 현재 순위 탈락 확정 (명시적 퇴장 경로 재사용)
 * - cancel: 전 테이블 해산 + 취소 기록 잠시 보존 후 목록 제거
 */

interface Harness {
  roomManager: RoomManager;
  manager: TournamentManager;
}

function createHarness(): Harness {
  const roomManager = new RoomManager(() => {}, () => {});
  const manager = new TournamentManager(roomManager, { isConnected: () => true });
  return { roomManager, manager };
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

function aliveIds(engine: PokerEngine): string[] {
  return engine.state.players
    .filter(player => player.chips > 0 && !player.finishPlace && !player.pendingRemoval)
    .map(player => player.id);
}

function bust(engine: PokerEngine, playerId: string, handStartChips: number): void {
  const player = engine.state.players.find(candidate => candidate.id === playerId);
  if (!player) throw new Error(`player not found: ${playerId}`);
  player.handStartChips = handStartChips;
  player.chips = 0;
}

/** 12인(휴먼 전용) 스탠다드 토너먼트 등록·시작 (레벨 8분 — env 단축 없이 결정론) */
function start12(h: Harness): { id: string; tables: string[] } {
  const created = h.manager.createTournament({
    name: '디렉터 MTT',
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
    h.manager.register(created.tournamentId, {
      id: `h${i}`, name: `유저${i}`, avatar: 'ara',
    });
  }
  expect(h.manager.startTournament(created.tournamentId, 'h1')).toBe('ok');
  return { id: created.tournamentId, tables: mttTableIds(h.roomManager) };
}

function enableWalletMtt(h: Harness): void {
  const economy: MttEconomyHooks = {
    reserveEntry: () => {},
    refundEntry: () => {},
    startEscrow: () => {},
    settle: () => {},
    refundAll: () => 0,
  };
  h.manager.shutdown();
  h.manager = new TournamentManager(h.roomManager, {
    isConnected: () => true,
    economy,
  });
}

describe('TournamentManager 디렉터 콘솔', () => {
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

  it('개설자가 아니면 모든 개입이 거부된다', () => {
    const { id } = start12(h);
    expect(h.manager.directorAction(id, 'h2', { kind: 'pause' })).toBe('not-host');
    expect(h.manager.directorAction('없는-토너', 'h1', { kind: 'pause' })).toBe('not-found');
  });

  it('일시정지는 시계를 동결하고 전 테이블 다음 핸드를 보류한다', () => {
    const { id, tables } = start12(h);
    expect(h.manager.directorAction(id, 'h1', { kind: 'pause' })).toBe('ok');
    // 중복 정지는 거부
    expect(h.manager.directorAction(id, 'h1', { kind: 'pause' })).toBe('bad-state');

    for (const roomId of tables) {
      expect(h.manager.roomHooks.isHeld(roomId)).toBe(true);
    }
    // 정지 중 10분이 흘러도 시계는 레벨 1에 머문다 (스탠다드 레벨 8분)
    vi.advanceTimersByTime(10 * 60_000);
    const summary = h.manager.listTournaments()[0];
    expect(summary.paused).toBe(true);
    expect(summary.level).toBe(1);
    // 예약된 첫 핸드 시작도 보류로 무산 — 어떤 테이블도 핸드가 돌지 않는다
    for (const roomId of tables) {
      expect(engineOf(h.roomManager, roomId).state.isHandInProgress).toBe(false);
    }

    // 재개 — 정지 구간은 pauseAccum으로 제외되어 남은 시간이 이어진다
    expect(h.manager.directorAction(id, 'h1', { kind: 'resume' })).toBe('ok');
    expect(h.manager.directorAction(id, 'h1', { kind: 'resume' })).toBe('bad-state');
    for (const roomId of tables) {
      expect(h.manager.roomHooks.isHeld(roomId)).toBe(false);
    }
    vi.advanceTimersByTime(30_000);
    const detail = h.manager.getDetail(id)!;
    expect(detail.summary.paused).toBe(false);
    expect(detail.clock!.level).toBe(1);
    // 총 경과 플레이 시간 = 재개 후 30초뿐
    expect(detail.clock!.segmentRemainingMs).toBe(8 * 60_000 - 30_000);
  });

  it('라이브 핸드 중 레벨 조정은 현재 블라인드를 보존하고 다음 핸드 경계에 적용한다', () => {
    const { id, tables } = start12(h);
    expect(h.manager.directorAction(id, 'h1', { kind: 'set-level', level: 5 }))
      .toBe('bad-state'); // 라이브 시계 밑 조정 금지

    vi.advanceTimersByTime(2_000);
    const engine = engineOf(h.roomManager, tables[0]);
    expect(engine.state.isHandInProgress).toBe(true);
    const before = {
      smallBlind: engine.state.smallBlind,
      bigBlind: engine.state.bigBlind,
      ante: engine.state.tournament!.ante,
      minRaise: engine.state.minRaise,
      handNumber: engine.state.handNumber,
    };

    expect(h.manager.directorAction(id, 'h1', { kind: 'pause' })).toBe('ok');
    expect(h.manager.directorAction(id, 'h1', { kind: 'set-level', level: 0 }))
      .toBe('invalid');
    expect(h.manager.directorAction(id, 'h1', { kind: 'set-level', level: 99 }))
      .toBe('invalid');
    expect(h.manager.directorAction(id, 'h1', { kind: 'set-level', level: 5 }))
      .toBe('ok');

    // 진행 중 핸드는 레벨 1 계약을 끝까지 유지한다.
    expect({
      smallBlind: engine.state.smallBlind,
      bigBlind: engine.state.bigBlind,
      ante: engine.state.tournament!.ante,
      minRaise: engine.state.minRaise,
      handNumber: engine.state.handNumber,
    }).toEqual(before);
    expect(h.manager.listTournaments()[0].level).toBe(5);

    let guard = 0;
    while (engine.state.isHandInProgress && guard++ < 12) {
      const actor = engine.state.players[engine.state.activePlayerIndex];
      h.roomManager.processPlayerAction(tables[0], actor.id, 'fold');
    }
    expect(engine.state.isHandInProgress).toBe(false);

    // 재개 뒤 이 테이블의 다음 startHand 직전에 레벨 5가 적용된다.
    expect(h.manager.directorAction(id, 'h1', { kind: 'resume' })).toBe('ok');
    vi.advanceTimersByTime(2_000);
    expect(engine.state.handNumber).toBe(before.handNumber + 1);
    expect(engine.state.smallBlind).toBe(200);
    expect(engine.state.bigBlind).toBe(400);
    expect(engine.state.tournament!.ante).toBe(400);
    expect(engine.state.minRaise).toBe(400);

    // 다른 테이블의 진행 중 핸드는 첫 테이블 적용 뒤에도 기존 레벨을 유지한다.
    const otherEngine = engineOf(h.roomManager, tables[1]);
    expect(otherEngine.state.handNumber).toBe(before.handNumber);
    expect(otherEngine.state.smallBlind).toBe(before.smallBlind);
    expect(otherEngine.state.bigBlind).toBe(before.bigBlind);
    expect(otherEngine.state.tournament!.ante).toBe(before.ante);
    expect(otherEngine.state.minRaise).toBe(before.minRaise);

    guard = 0;
    while (otherEngine.state.isHandInProgress && guard++ < 12) {
      const actor = otherEngine.state.players[otherEngine.state.activePlayerIndex];
      h.roomManager.processPlayerAction(tables[1], actor.id, 'fold');
    }
    vi.advanceTimersByTime(6_500);
    expect(otherEngine.state.handNumber).toBe(before.handNumber + 1);
    expect(otherEngine.state.smallBlind).toBe(200);
    expect(otherEngine.state.bigBlind).toBe(400);
    expect(otherEngine.state.tournament!.ante).toBe(400);
    expect(otherEngine.state.minRaise).toBe(400);

    vi.advanceTimersByTime(10_000);
    const detail = h.manager.getDetail(id)!;
    expect(detail.clock!.level).toBe(5);
    // 재개 후 예약 2초 + 기존 핸드 종료 연출 6.5초 + 추가 진행 10초가 흐름
    expect(detail.clock!.segmentRemainingMs).toBe(8 * 60_000 - 18_500);
  });

  it('동일 레벨 리셋도 느린 테이블을 포함해 각 다음 핸드 경계에서 deadline을 갱신한다', () => {
    const { id, tables } = start12(h);
    vi.advanceTimersByTime(2_000);
    const first = engineOf(h.roomManager, tables[0]);
    const slow = engineOf(h.roomManager, tables[1]);
    const oldDeadline = first.state.tournament!.levelEndsAt;
    expect(slow.state.tournament!.levelEndsAt).toBe(oldDeadline);

    expect(h.manager.directorAction(id, 'h1', { kind: 'pause' })).toBe('ok');
    expect(h.manager.directorAction(id, 'h1', { kind: 'set-level', level: 1 })).toBe('ok');

    let guard = 0;
    while (first.state.isHandInProgress && guard++ < 12) {
      const actor = first.state.players[first.state.activePlayerIndex];
      h.roomManager.processPlayerAction(tables[0], actor.id, 'fold');
    }
    expect(h.manager.directorAction(id, 'h1', { kind: 'resume' })).toBe('ok');
    vi.advanceTimersByTime(2_000);

    const resetDeadline = first.state.tournament!.levelEndsAt;
    expect(first.state.handNumber).toBe(2);
    expect(resetDeadline).toBeGreaterThan(oldDeadline);
    expect(slow.state.handNumber).toBe(1);
    expect(slow.state.tournament!.levelEndsAt).toBe(oldDeadline);

    guard = 0;
    while (slow.state.isHandInProgress && guard++ < 12) {
      const actor = slow.state.players[slow.state.activePlayerIndex];
      h.roomManager.processPlayerAction(tables[1], actor.id, 'fold');
    }
    vi.advanceTimersByTime(6_500);

    expect(slow.state.handNumber).toBe(2);
    expect(slow.state.tournament!.levelEndsAt).toBe(resetDeadline);
  });

  it('pending 레벨은 파이널 병합에서 해체 테이블을 제외하고 최종 테이블 경계에 적용한다', () => {
    const { id, tables } = start12(h);
    const [sourceRoomId, destinationRoomId] = tables;
    const source = engineOf(h.roomManager, sourceRoomId);
    const destination = engineOf(h.roomManager, destinationRoomId);
    const oldDeadline = destination.state.tournament!.levelEndsAt;

    expect(h.manager.directorAction(id, 'h1', { kind: 'pause' })).toBe('ok');
    expect(h.manager.directorAction(id, 'h1', { kind: 'set-level', level: 1 })).toBe('ok');

    aliveIds(source).slice(0, 3).forEach((playerId, index) => {
      bust(source, playerId, 100 * (index + 1));
    });
    expect(h.manager.roomHooks.onHandComplete(sourceRoomId)).toBe('continue');
    aliveIds(destination).slice(0, 2).forEach((playerId, index) => {
      bust(destination, playerId, 100 * (index + 1));
    });
    expect(h.manager.roomHooks.onHandComplete(destinationRoomId)).toBe('continue');
    aliveIds(source).slice(0, 2).forEach((playerId, index) => {
      bust(source, playerId, 50 * (index + 1));
    });
    expect(['hold', 'gone']).toContain(
      h.manager.roomHooks.onHandComplete(sourceRoomId),
    );

    const [finalRoomId] = mttTableIds(h.roomManager);
    expect(mttTableIds(h.roomManager)).toHaveLength(1);
    const final = engineOf(h.roomManager, finalRoomId);
    expect(final.state.tournament?.holdReasons).toEqual([
      'director-pause',
      'final-intro',
    ]);

    vi.advanceTimersByTime(4_500);
    expect(h.manager.directorAction(id, 'h1', { kind: 'resume' })).toBe('ok');
    vi.advanceTimersByTime(2_000);

    expect(final.state.handNumber).toBe(1);
    expect(final.state.tournament!.levelEndsAt).toBeGreaterThan(oldDeadline);
  });

  it('wallet MTT는 시작 전 취소만 허용하고 시작 후 참가자 방장의 위험 개입을 거부한다', () => {
    enableWalletMtt(h);
    const input = {
      name: '지갑 디렉터 MTT',
      speed: 'standard' as const,
      maxEntrants: 8,
      tableSize: 6,
      startAt: null,
      botFill: false,
      turnTime: 15,
      hostId: 'h1',
      economyMode: 'wallet' as const,
      entryBuyIn: 1_500,
      entryFee: 150,
    };

    const preStart = h.manager.createTournament(input);
    if (!preStart.ok) throw new Error('create failed');
    expect(h.manager.directorAction(preStart.tournamentId, 'h1', { kind: 'cancel' }))
      .toBe('ok');

    const running = h.manager.createTournament(input);
    if (!running.ok) throw new Error('create failed');
    h.manager.register(running.tournamentId, { id: 'h1', name: '방장', avatar: 'ara' });
    h.manager.register(running.tournamentId, { id: 'h2', name: '참가자', avatar: 'hana' });
    expect(h.manager.startTournament(running.tournamentId, 'h1')).toBe('ok');

    expect(h.manager.directorAction(
      running.tournamentId,
      'h1',
      { kind: 'remove-player', playerId: 'h2' },
    )).toBe('bad-state');
    expect(h.manager.directorAction(running.tournamentId, 'h1', { kind: 'pause' }))
      .toBe('ok');
    expect(h.manager.directorAction(
      running.tournamentId,
      'h1',
      { kind: 'set-level', level: 2 },
    )).toBe('bad-state');
    expect(h.manager.directorAction(running.tournamentId, 'h1', { kind: 'cancel' }))
      .toBe('bad-state');
  });

  it('강제 제거는 현재 순위 탈락으로 확정된다', () => {
    const { id, tables } = start12(h);
    const e1 = engineOf(h.roomManager, tables[0]);
    const target = e1.state.players[0].id;

    expect(h.manager.directorAction(id, 'h1', { kind: 'remove-player', playerId: target }))
      .toBe('ok');
    const removed = e1.state.players.find(p => p.id === target);
    // 좌석이 이미 정리됐거나(핸드 사이) 탈락 마킹 상태여야 한다
    if (removed) {
      expect(removed.finishPlace).toBe(12);
      expect(removed.pendingRemoval).toBe(true);
    }
    const summary = h.manager.listTournaments()[0];
    expect(summary.remaining).toBe(11);
    const detail = h.manager.getDetail(id)!;
    expect(detail.standings.find(r => r.playerId === target)!.place).toBe(12);

    // 없는/이미 탈락한 대상은 invalid
    expect(h.manager.directorAction(id, 'h1', { kind: 'remove-player', playerId: target }))
      .toBe('invalid');
    expect(h.manager.directorAction(id, 'h1', { kind: 'remove-player', playerId: 'ghost' }))
      .toBe('invalid');
  });

  it('취소는 전 테이블을 해산하고 참가 기록을 잠시 보존 후 목록에서 제거한다', () => {
    const { id, tables } = start12(h);
    expect(h.manager.directorAction(id, 'h1', { kind: 'cancel' })).toBe('ok');
    expect(h.manager.directorAction(id, 'h1', { kind: 'cancel' })).toBe('bad-state');

    expect(h.manager.listTournaments()[0].phase).toBe('cancelled');
    for (const roomId of tables) {
      expect(h.roomManager.getRoom(roomId)).toBeUndefined();
    }
    vi.advanceTimersByTime(61_000);
    expect(h.manager.listTournaments().length).toBe(0);
  });

  it('getAdminSummaries가 테이블 상태·보류 사유·스탠딩을 담는다 (/admin 탭)', () => {
    const { id } = start12(h);
    h.manager.directorAction(id, 'h1', { kind: 'pause' });
    const [view] = h.manager.getAdminSummaries();
    expect(view.id).toBe(id);
    expect(view.phase).toBe('running');
    expect(view.paused).toBe(true);
    expect(view.remaining).toBe(12);
    expect(view.tables).toHaveLength(2);
    expect(view.tables[0]).toMatchObject({ players: 6, humans: 6, alive: 6, handInProgress: false });
    expect(view.standings).toHaveLength(12);
    expect(view.standings.every(row => row.place === null)).toBe(true);
  });

  it('정지 중 취소도 안전하다 (paused 해제 + 해산)', () => {
    const { id, tables } = start12(h);
    h.manager.directorAction(id, 'h1', { kind: 'pause' });
    expect(h.manager.directorAction(id, 'h1', { kind: 'cancel' })).toBe('ok');
    expect(h.manager.listTournaments()[0].phase).toBe('cancelled');
    expect(h.manager.listTournaments()[0].paused).toBe(false);
    for (const roomId of tables) {
      expect(h.roomManager.getRoom(roomId)).toBeUndefined();
    }
  });
});
