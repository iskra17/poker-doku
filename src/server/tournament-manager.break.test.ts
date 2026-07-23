import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { RoomManager } from './room-manager';
import { TournamentManager } from './tournament-manager';
import { MTT_STRUCTURES } from '../lib/poker/mtt-structure';

/**
 * 브레이크 배리어 회귀 — 특히 "두 번째 브레이크" 후 재개 (2026-07-23 라이브 QA에서
 * 두 번째 브레이크 이후 테이블이 영영 재개되지 않는 교착 발견).
 */
describe('MTT break resume', () => {
  let rm: RoomManager;
  let tm: TournamentManager;

  beforeEach(() => {
    vi.useFakeTimers();
    rm = new RoomManager(() => {}, () => {});
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

  it('resumes after break 2 even with an H4H episode and a table merge before it', () => {
    // 2026-07-23 라이브 교착 재현 형태: 2테이블 → 버블 H4H → 버블 붕괴 → 테이블 통합 →
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

    // remaining 5 도달 → H4H 발동 (아직 2테이블 — 밸런싱보다 먼저 판정)
    bustAt(t2, 2);
    expect(tm.roomHooks.onHandComplete(t2)).toBe('hold');
    expect(tm.roomHooks.isHeld(t1)).toBe(false); // 무장됨 — 동기화 핸드 허용

    // 동기화 핸드에서 버블 붕괴 (t1에서 1명 탈락 → remaining 4)
    bustAt(t1, 1);
    expect(tm.roomHooks.onHandComplete(t1)).toBe('hold');
    expect(tm.roomHooks.isHeld(t1)).toBe(false);
    expect(tm.roomHooks.isHeld(t2)).toBe(false);

    // H4H 해제 후 다음 핸드 종료에서 통합 (2v2 → target 1)
    const verdict = tm.roomHooks.onHandComplete(t2);
    expect(['continue', 'gone']).toContain(verdict);
    const remainingTables = rm.getAdminRoomSummaries().filter(r => r.mode === 'mtt').map(r => r.id);
    expect(remainingTables.length).toBe(1);
    const finalTable = remainingTables[0];

    // 두 번째 브레이크 구간으로 시계 이동 → 핸드 종료 → 보류 → 휴식 종료 후 재개
    const playMs = s.levelDurationMs * s.breakEveryLevels;
    vi.advanceTimersByTime(2 * playMs + s.breakDurationMs + 5_000);
    expect(tm.roomHooks.onHandComplete(finalTable)).toBe('hold');
    expect(tm.roomHooks.isHeld(finalTable)).toBe(true);
    vi.advanceTimersByTime(s.breakDurationMs + 1_000);
    expect(tm.roomHooks.isHeld(finalTable)).toBe(false);
    expect(tm.roomHooks.onHandComplete(finalTable)).toBe('continue');
  });
});
