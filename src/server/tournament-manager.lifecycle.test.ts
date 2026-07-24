import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RoomManager } from './room-manager';
import {
  TournamentManager,
  type CreateTournamentInput,
} from './tournament-manager';

const EMPTY_TTL_MS = 10_000;

function tournamentInput(
  hostId: string,
  overrides: Partial<CreateTournamentInput> = {},
): CreateTournamentInput {
  return {
    name: `${hostId} 토너먼트`,
    speed: 'standard',
    maxEntrants: 8,
    tableSize: 6,
    startAt: null,
    botFill: false,
    turnTime: 15,
    hostId,
    ...overrides,
  };
}

describe('TournamentManager registering lifecycle', () => {
  let roomManager: RoomManager;
  let manager: TournamentManager;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-24T00:00:00.000Z'));
    roomManager = new RoomManager(() => {}, () => {});
    manager = new TournamentManager(
      roomManager,
      { isConnected: () => true },
      { emptyTournamentTtlMs: EMPTY_TTL_MS },
    );
  });

  afterEach(() => {
    manager.shutdown();
    roomManager.shutdown();
    vi.useRealTimers();
  });

  it('auto-cancels an entrant-free registering tournament after its configured TTL', () => {
    const refundAll = vi.fn(() => 0);
    manager.shutdown();
    manager = new TournamentManager(
      roomManager,
      {
        isConnected: () => true,
        economy: {
          reserveEntry: vi.fn(),
          refundEntry: vi.fn(),
          startEscrow: vi.fn(),
          settle: vi.fn(),
          refundAll,
        },
      },
      { emptyTournamentTtlMs: EMPTY_TTL_MS },
    );
    const created = manager.createTournament(tournamentInput('host-1', {
      economyMode: 'wallet',
      entryBuyIn: 1_500,
      entryFee: 150,
    }));
    if (!created.ok) throw new Error('create failed');

    vi.advanceTimersByTime(EMPTY_TTL_MS - 1);
    expect(manager.getDetail(created.tournamentId)?.summary.phase).toBe('registering');

    vi.advanceTimersByTime(1);
    expect(manager.getDetail(created.tournamentId)?.summary.phase).toBe('cancelled');
    expect(refundAll).toHaveBeenCalledOnce();

    vi.advanceTimersByTime(60_000);
    expect(manager.getDetail(created.tournamentId)).toBeNull();
  });

  it('cancels the empty timer when the first entrant registers', () => {
    const created = manager.createTournament(tournamentInput('host-1'));
    if (!created.ok) throw new Error('create failed');

    vi.advanceTimersByTime(EMPTY_TTL_MS / 2);
    expect(manager.register(created.tournamentId, {
      id: 'player-1',
      name: '플레이어 1',
      avatar: 'ara',
    })).toBe('ok');
    vi.advanceTimersByTime(EMPTY_TTL_MS * 2);

    expect(manager.getDetail(created.tournamentId)?.summary.phase).toBe('registering');
  });

  it('rearms the full empty TTL when the last entrant unregisters', () => {
    const created = manager.createTournament(tournamentInput('host-1'));
    if (!created.ok) throw new Error('create failed');
    manager.register(created.tournamentId, {
      id: 'player-1',
      name: '플레이어 1',
      avatar: 'ara',
    });

    vi.advanceTimersByTime(EMPTY_TTL_MS * 2);
    expect(manager.unregister(created.tournamentId, 'player-1')).toBe(true);

    vi.advanceTimersByTime(EMPTY_TTL_MS - 1);
    expect(manager.getDetail(created.tournamentId)?.summary.phase).toBe('registering');
    vi.advanceTimersByTime(1);
    expect(manager.getDetail(created.tournamentId)?.summary.phase).toBe('cancelled');
  });

  it('caps registering tournaments per host without consuming another host quota', () => {
    expect(manager.createTournament(tournamentInput('host-1')).ok).toBe(true);
    expect(manager.createTournament(tournamentInput('host-1')).ok).toBe(true);
    expect(manager.createTournament(tournamentInput('host-1')))
      .toEqual({ ok: false, reason: 'host-limit' });

    expect(manager.createTournament(tournamentInput('host-2')).ok).toBe(true);
  });

  it('clears the empty lifecycle timer when the manager shuts down', () => {
    manager.createTournament(tournamentInput('host-1'));
    expect(vi.getTimerCount()).toBe(1);

    manager.shutdown();

    expect(vi.getTimerCount()).toBe(0);
  });
});
