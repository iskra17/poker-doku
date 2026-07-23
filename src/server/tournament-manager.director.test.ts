import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { RoomManager } from './room-manager';
import { TournamentManager } from './tournament-manager';
import type { PokerEngine } from '../lib/poker/engine';

/**
 * 디렉터 콘솔(Phase 2) — 개설자 전용 운영 개입 회귀.
 * - pause: 시계 동결 + 전 테이블 다음 핸드 보류 (isHeld)
 * - resume: 정지 구간을 pauseAccum으로 제외하고 시계 재개
 * - set-level: 정지 중에만, 시계를 해당 레벨 시작점으로 리셋 + 엔진 미러 즉시 갱신
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

  it('블라인드 레벨 조정은 정지 중에만, 시계를 레벨 시작점으로 리셋한다', () => {
    const { id, tables } = start12(h);
    expect(h.manager.directorAction(id, 'h1', { kind: 'set-level', level: 5 }))
      .toBe('bad-state'); // 라이브 시계 밑 조정 금지

    h.manager.directorAction(id, 'h1', { kind: 'pause' });
    expect(h.manager.directorAction(id, 'h1', { kind: 'set-level', level: 0 }))
      .toBe('invalid');
    expect(h.manager.directorAction(id, 'h1', { kind: 'set-level', level: 99 }))
      .toBe('invalid');
    expect(h.manager.directorAction(id, 'h1', { kind: 'set-level', level: 5 }))
      .toBe('ok');

    // 엔진 미러 즉시 갱신 (레벨 5 = 200/400, 스탠다드 앤티는 레벨 4부터 = BB)
    for (const roomId of tables) {
      const tournament = engineOf(h.roomManager, roomId).state.tournament!;
      expect(tournament.level).toBe(5);
      expect(tournament.smallBlind).toBe(200);
      expect(tournament.bigBlind).toBe(400);
    }
    expect(h.manager.listTournaments()[0].level).toBe(5);

    // 재개 후 레벨 5의 잔여 시간이 처음부터 흐른다
    h.manager.directorAction(id, 'h1', { kind: 'resume' });
    vi.advanceTimersByTime(10_000);
    const detail = h.manager.getDetail(id)!;
    expect(detail.clock!.level).toBe(5);
    expect(detail.clock!.segmentRemainingMs).toBe(8 * 60_000 - 10_000);
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
