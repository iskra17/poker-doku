import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PokerEngine } from '../lib/poker/engine';
import { RoomManager } from './room-manager';
import {
  TournamentManager,
  type PersistentTournamentStartSnapshot,
  type PersistentTournamentSettlementPorts,
} from './tournament-manager';

function snapshot(
  id: string,
  lateRegistration: boolean,
): PersistentTournamentStartSnapshot {
  return {
    id,
    economyMode: 'freeroll',
    directorProfileId: 'director-1',
    registrationState: lateRegistration ? 'open-late' : 'closed',
    registrationGeneration: 1,
    registrationOwnerToken: null,
    config: {
      version: 2,
      name: 'Durable freeroll',
      economy: { mode: 'freeroll', promotionAccountId: 'global' },
      tableSize: 6,
      field: {
        minEntrants: 6,
        maxEntrants: 12,
        botFillToMinimum: true,
      },
      turnTimeSeconds: 15,
      structure: {
        sourcePresetId: 'standard',
        startingStack: 10_000,
        segments: [{
          kind: 'level',
          durationMs: 480_000,
          smallBlind: 50,
          bigBlind: 100,
          bigBlindAnte: 0,
        }],
      },
      prizePool: { kind: 'promotion-funded', totalPrize: 100_000 },
      payout: {
        tableVersion: 2,
        presetId: 'standard',
        paidFieldPercent: 15,
      },
      lateRegistration: lateRegistration
        ? {
            enabled: true,
            durationLevels: 2,
            minStartingStackBb: 20,
          }
        : {
            enabled: false,
            durationLevels: 0,
            minStartingStackBb: 20,
          },
    },
  };
}

function engine(rooms: RoomManager): PokerEngine {
  const [room] = rooms.getAdminRoomSummaries().filter(row => row.mode === 'mtt');
  if (!room) throw new Error('MTT room missing');
  return rooms.getRoom(room.id)!.engine;
}

describe('TournamentManager persistent freeroll settlement', () => {
  let rooms: RoomManager;
  let manager: TournamentManager;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-25T00:00:00.000Z'));
    rooms = new RoomManager(() => {}, () => {});
  });

  afterEach(() => {
    manager?.shutdown();
    rooms.shutdown();
    vi.useRealTimers();
  });

  it('keeps open-late eliminations provisional and freezes every place once', () => {
    let projection = {
      status: 'running',
      registrationState: 'open-late',
      registrationGeneration: 1,
      registrationOwnerToken: null as string | null,
    };
    const freezeRegistration = vi.fn(input => {
      projection = {
        status: 'running',
        registrationState: 'closed',
        registrationGeneration: input.generation,
        registrationOwnerToken: null,
      };
      return true;
    });
    const provisional = vi.fn();
    const finalElimination = vi.fn();
    const settlement: PersistentTournamentSettlementPorts = {
      freezeRegistration,
      listParticipants: () => [{
        playerId: 'human-1',
        profileId: 'human-1',
        registrationAttempt: 1,
        displayName: 'Human One',
      }],
      claimPayoutPending: vi.fn(),
      settlePayout: vi.fn(),
    };
    manager = new TournamentManager(rooms, {
      onProvisionalEliminated: provisional,
      onEliminated: finalElimination,
    }, {
      persistentRuntimeEnabled: true,
      persistentLateRegistration: {
        readInstance: () => projection,
        commitLateMttBatch: vi.fn(),
      },
      persistentSettlement: settlement,
    });
    manager.prepareFromInstance(
      snapshot('open-late-freeze', true),
      [{ id: 'human-1', name: 'Human One', avatar: 'ara' }],
      'start-owner',
    );
    manager.activatePreparedTournament(
      'open-late-freeze',
      'start-owner',
      Date.now(),
    );
    const table = engine(rooms);
    const bot = table.state.players.find(player => player.type === 'bot')!;
    bot.handStartChips = 100;
    bot.chips = 0;

    manager.roomHooks.onHandComplete(
      rooms.getAdminRoomSummaries().find(row => row.mode === 'mtt')!.id,
    );

    expect(provisional).toHaveBeenCalledWith(expect.objectContaining({
      tournamentId: 'open-late-freeze',
      playerId: bot.id,
      eliminationBatchSeq: 1,
    }));
    expect(finalElimination).not.toHaveBeenCalled();
    expect(bot.finishPlace).toBeUndefined();

    const close = { generation: 2, ownerToken: 'close-owner' };
    expect(manager.beginLateRegistrationOperation(
      'open-late-freeze',
      'closing',
      close,
    )).toBe(true);
    expect(manager.finishLateRegistration('open-late-freeze', close)).toBe(true);
    expect(freezeRegistration).toHaveBeenCalledOnce();
    const frozen = freezeRegistration.mock.calls[0]![0].freeze;
    expect(frozen.finalEntrants).toBe(6);
    expect(frozen.payouts).toHaveLength(6);
    expect(frozen.payouts.reduce(
      (total: number, payout: { amount: number }) => total + payout.amount,
      0,
    )).toBe(100_000);
    expect(freezeRegistration.mock.calls[0]![0].eliminatedPlayerIds)
      .toEqual([]);
    expect(manager.finishLateRegistration('open-late-freeze', close)).toBe(false);
  });

  it('persists Tx1 before payout, and never cleans up a failed payout-pending runtime', () => {
    const claimPayoutPending = vi.fn<
      PersistentTournamentSettlementPorts['claimPayoutPending']
    >(() => 'claimed');
    const settlePayout = vi.fn(() => {
      throw new Error('injected payout failure');
    });
    manager = new TournamentManager(rooms, {}, {
      persistentRuntimeEnabled: true,
      persistentLateRegistration: {
        readInstance: () => ({
          status: 'running',
          registrationState: 'closed',
          registrationGeneration: 1,
          registrationOwnerToken: null,
        }),
        commitLateMttBatch: vi.fn(),
      },
      persistentSettlement: {
        freezeRegistration: vi.fn(() => true),
        listParticipants: () => [{
          playerId: 'human-1',
          profileId: 'human-1',
          registrationAttempt: 1,
          displayName: 'Human One',
        }],
        claimPayoutPending,
        settlePayout,
      },
    });
    manager.prepareFromInstance(
      snapshot('failed-payout', false),
      [{ id: 'human-1', name: 'Human One', avatar: 'ara' }],
      'start-owner',
    );
    manager.activatePreparedTournament(
      'failed-payout',
      'start-owner',
      Date.now(),
    );
    const mttRooms = rooms.getAdminRoomSummaries()
      .filter(row => row.mode === 'mtt');
    for (const room of mttRooms) {
      const table = rooms.getRoom(room.id)!.engine;
      for (const player of table.state.players) {
        if (player.type === 'human') continue;
        player.handStartChips = 100;
        player.chips = 0;
      }
    }

    for (const room of mttRooms) {
      manager.roomHooks.onHandComplete(room.id);
    }

    expect(claimPayoutPending).toHaveBeenCalledOnce();
    expect(settlePayout).toHaveBeenCalledOnce();
    const plan = claimPayoutPending.mock.calls[0]![1];
    expect(plan.results.map(result => result.place)).toEqual(
      Array.from({ length: 6 }, (_, index) => index + 1),
    );
    expect(plan.results.filter(result => result.participantType === 'human'))
      .toEqual([expect.objectContaining({
        playerId: 'human-1',
        profileId: 'human-1',
      })]);
    expect(manager.getDetail('failed-payout')?.summary.phase).toBe('running');
    expect(manager.directorActionAsOperator(
      'failed-payout',
      { kind: 'cancel' },
    )).toBe('bad-state');

    vi.advanceTimersByTime(11 * 60_000);

    expect(manager.getDetail('failed-payout')).not.toBeNull();
    expect(settlePayout).toHaveBeenCalledTimes(2);
  });
});
