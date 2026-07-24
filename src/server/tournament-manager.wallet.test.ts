import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { RoomManager } from './room-manager';
import {
  TournamentManager,
  type CreateTournamentInput,
  type MttEconomyHooks,
} from './tournament-manager';
import { EconomyDomainError } from './economy-repository';
import { computePayouts } from '../lib/poker/payout-table';
import type { PokerEngine } from '../lib/poker/engine';

/**
 * wallet MTT 매니저 흐름 회귀 — 경제 훅(mock) 호출 계약.
 * - 개설: economy 훅 없음/봇 충원이면 거부
 * - 등록/취소: reserveEntry·refundEntry, 예약 실패는 등록 미반영(rethrow)
 * - 시작: 노쇼 환불 → startEscrow(출석 명단), 실패 시 'economy' + 등록 유지
 * - 완주: settle에 전 순위(1..N)와 payout-table 상금 전달, 풀 = 바이인 × N
 * - 취소: refundAll
 */

interface EconomyCall {
  kind: string;
  args: unknown[];
}

function createEconomyMock(overrides: Partial<MttEconomyHooks> = {}) {
  const calls: EconomyCall[] = [];
  const economy: MttEconomyHooks = {
    reserveEntry: (...args) => { calls.push({ kind: 'reserve', args }); },
    refundEntry: (...args) => { calls.push({ kind: 'refund', args }); },
    startEscrow: (...args) => { calls.push({ kind: 'start', args }); },
    settle: (...args) => { calls.push({ kind: 'settle', args }); },
    refundAll: (...args) => { calls.push({ kind: 'refundAll', args }); return 0; },
    ...overrides,
  };
  return { calls, economy };
}

const BUY_IN = 1_500;
const FEE = 150;

function walletInput(overrides: Partial<CreateTournamentInput> = {}): CreateTournamentInput {
  return {
    name: '리얼 칩 MTT',
    speed: 'standard',
    maxEntrants: 12,
    tableSize: 6,
    startAt: null,
    botFill: false,
    turnTime: 15,
    hostId: 'h1',
    economyMode: 'wallet',
    entryBuyIn: BUY_IN,
    entryFee: FEE,
    ...overrides,
  };
}

function engineOf(roomManager: RoomManager, roomId: string): PokerEngine {
  const room = roomManager.getRoom(roomId);
  if (!room) throw new Error(`room not found: ${roomId}`);
  return room.engine;
}

describe('TournamentManager wallet MTT', () => {
  let roomManager: RoomManager;
  let manager: TournamentManager;

  beforeEach(() => {
    vi.useFakeTimers();
    roomManager = new RoomManager(() => {}, () => {});
  });

  afterEach(() => {
    manager?.shutdown();
    roomManager.shutdown();
    vi.useRealTimers();
  });

  it('경제 훅 없이 또는 봇 충원으로는 wallet 토너를 개설할 수 없다', () => {
    manager = new TournamentManager(roomManager, { isConnected: () => true });
    expect(manager.createTournament(walletInput())).toEqual({ ok: false, reason: 'invalid' });

    const { economy } = createEconomyMock();
    manager.shutdown();
    manager = new TournamentManager(roomManager, { isConnected: () => true, economy });
    expect(manager.createTournament(walletInput({ botFill: true })))
      .toEqual({ ok: false, reason: 'invalid' });
    expect(manager.createTournament(walletInput({ entryBuyIn: 0 })))
      .toEqual({ ok: false, reason: 'invalid' });
    expect(manager.createTournament(walletInput()).ok).toBe(true);
  });

  it('등록은 에스크로 예약이 먼저 — 실패하면 등록되지 않는다', () => {
    const { calls, economy } = createEconomyMock();
    economy.reserveEntry = (profileId, tournamentId, maxEntrants) => {
      calls.push({ kind: 'reserve', args: [profileId, tournamentId, maxEntrants] });
      if (profileId === 'broke') throw new EconomyDomainError('INSUFFICIENT_BALANCE');
    };
    manager = new TournamentManager(roomManager, { isConnected: () => true, economy });
    const created = manager.createTournament(walletInput());
    if (!created.ok) throw new Error('create failed');
    const id = created.tournamentId;

    expect(manager.register(id, { id: 'p1', name: '유저1', avatar: 'ara' })).toBe('ok');
    expect(() => manager.register(id, { id: 'broke', name: '빈털터리', avatar: 'ara' }))
      .toThrowError(EconomyDomainError);
    expect(manager.getDetail(id)!.entrants.map(e => e.id)).toEqual(['p1']);
    expect(calls.filter(c => c.kind === 'reserve').map(c => c.args[0]))
      .toEqual(['p1', 'broke']);

    // 등록 취소는 환불 후 제거
    expect(manager.unregister(id, 'p1')).toBe(true);
    expect(calls.filter(c => c.kind === 'refund')).toHaveLength(1);
    expect(manager.getDetail(id)!.entrants).toHaveLength(0);
  });

  it('시작: 노쇼 환불 → 출석 명단 startEscrow, 실패 시 economy + 등록 유지', () => {
    const offline = new Set(['p9']);
    let failStart = true;
    const { calls, economy } = createEconomyMock({
      startEscrow: () => {
        if (failStart) throw new EconomyDomainError('SNG_START_INVALID');
        calls.push({ kind: 'start-ok', args: [] });
      },
    });
    manager = new TournamentManager(roomManager, {
      isConnected: id => !offline.has(id),
      economy,
    });
    const created = manager.createTournament(walletInput());
    if (!created.ok) throw new Error('create failed');
    const id = created.tournamentId;
    const registered = Array.from({ length: 9 }, (_, index) => `p${index + 1}`);
    for (const pid of registered) {
      manager.register(id, { id: pid, name: pid, avatar: 'ara' });
    }

    expect(manager.startTournament(id, 'h1')).toBe('economy');
    // 노쇼 p9는 환불·제외, 출석자는 등록 유지 (재시도 가능)
    expect(calls.filter(c => c.kind === 'refund').map(c => c.args[0])).toEqual(['p9']);
    const detail = manager.getDetail(id)!;
    expect(detail.summary.phase).toBe('registering');
    expect(detail.entrants.map(e => e.id).sort())
      .toEqual(registered.slice(0, 8).sort());

    failStart = false;
    expect(manager.startTournament(id, 'h1')).toBe('ok');
    expect(calls.some(c => c.kind === 'start-ok')).toBe(true);
    // 풀 = 바이인 × 출석 8명 (수수료 제외), 봇 없음
    const summary = manager.listTournaments()[0];
    expect(summary.phase).toBe('running');
    expect(summary.entrantCount).toBe(8);
    expect(summary.prizePool).toBe(BUY_IN * 8);
    expect(summary.economyMode).toBe('wallet');
  });

  it('접속 중인 wallet 참가자가 8명 미만이면 시작하지 않는다', () => {
    const offline = new Set(['p8']);
    const { calls, economy } = createEconomyMock();
    manager = new TournamentManager(roomManager, {
      isConnected: id => !offline.has(id),
      economy,
    });
    const created = manager.createTournament(walletInput({ maxEntrants: 8, tableSize: 8 }));
    if (!created.ok) throw new Error('create failed');
    for (let i = 1; i <= 8; i++) {
      manager.register(created.tournamentId, {
        id: `p${i}`,
        name: `p${i}`,
        avatar: 'ara',
      });
    }

    expect(manager.startTournament(created.tournamentId, 'h1')).toBe('not-enough');
    expect(manager.getDetail(created.tournamentId)?.summary.phase).toBe('registering');
    expect(calls.some(call => call.kind === 'start')).toBe(false);
    expect(calls.some(call => call.kind === 'refund')).toBe(false);
  });

  it('완주 시 settle에 전 순위와 payout-table 상금이 전달된다', () => {
    const { calls, economy } = createEconomyMock();
    manager = new TournamentManager(roomManager, { isConnected: () => true, economy });
    const created = manager.createTournament(walletInput({
      maxEntrants: 8,
      tableSize: 8,
      payoutPreset: 'top-heavy',
    }));
    if (!created.ok) throw new Error('create failed');
    const id = created.tournamentId;
    const ids = ['p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7', 'p8'];
    for (const pid of ids) manager.register(id, { id: pid, name: pid, avatar: 'ara' });
    expect(manager.startTournament(id, 'h1')).toBe('ok');

    const [roomId] = roomManager
      .getAdminRoomSummaries()
      .filter(room => room.mode === 'mtt')
      .map(room => room.id);
    const engine = engineOf(roomManager, roomId);
    // 7명을 순차 버스트 — 스택 차이로 순위 결정
    const alive = engine.state.players.map(p => p.id);
    alive.slice(0, 7).forEach((pid, i) => {
      const player = engine.state.players.find(p => p.id === pid)!;
      player.handStartChips = 100 * (i + 1);
      player.chips = 0;
    });
    manager.roomHooks.onHandComplete(roomId);

    expect(manager.listTournaments()[0].phase).toBe('completed');
    const settle = calls.find(c => c.kind === 'settle');
    expect(settle).toBeDefined();
    const [settleId, results, payoutPreset] = settle!.args as [
      string,
      Array<{ playerId: string; place: number; prize: number }>,
      string,
    ];
    expect(settleId).toBe(id);
    expect(payoutPreset).toBe('top-heavy');
    expect(results).toHaveLength(8);
    expect([...results.map(r => r.place)].sort((a, b) => a - b))
      .toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    const ladder = computePayouts(BUY_IN * 8, 8, 'top-heavy');
    for (const result of results) {
      expect(result.prize).toBe(ladder[result.place - 1] ?? 0);
    }
    // 우승자 = 마지막 생존자
    expect(results.find(r => r.place === 1)!.playerId).toBe(alive[7]);
  });

  it('취소는 refundAll을 태운다 (등록 중·진행 중 공통)', () => {
    const { calls, economy } = createEconomyMock();
    manager = new TournamentManager(roomManager, { isConnected: () => true, economy });
    const created = manager.createTournament(walletInput());
    if (!created.ok) throw new Error('create failed');
    manager.register(created.tournamentId, { id: 'p1', name: 'p1', avatar: 'ara' });

    expect(manager.directorAction(created.tournamentId, 'h1', { kind: 'cancel' })).toBe('ok');
    expect(calls.filter(c => c.kind === 'refundAll').map(c => c.args[0]))
      .toEqual([created.tournamentId]);
  });
});
