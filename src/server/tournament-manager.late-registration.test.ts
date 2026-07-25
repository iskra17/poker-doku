import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Player } from '../lib/poker/types';
import type { LateRegistrationSeatingPlan } from '../lib/tournament/late-registration-seating';
import type { LateEntryKey } from './tournament-enrollment-repository';
import { RoomManager } from './room-manager';
import { TournamentManager } from './tournament-manager';

const entry: LateEntryKey = {
  profileId: 'late-1',
  economyMode: 'freeroll',
  requestId: 'request-1',
  registrationAttempt: 1,
};

const latePlayer: Player = {
  id: 'late-1',
  name: 'Late One',
  avatar: 'ara',
  type: 'human',
  chips: 10_000,
  seatIndex: 0,
  holeCards: [],
  currentBet: 0,
  totalContributed: 0,
  status: 'waiting',
  hasActed: false,
};

function snapshot(id: string) {
  return {
    id,
    status: 'starting',
    economyMode: 'freeroll',
    directorProfileId: 'director-1',
    registrationState: 'open-late',
    registrationGeneration: 1,
    registrationOwnerToken: null,
    config: {
      version: 2,
      name: 'Late registration integration',
      economy: { mode: 'freeroll', promotionAccountId: 'global' },
      tableSize: 6,
      field: {
        minEntrants: 8,
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
      lateRegistration: {
        enabled: true,
        durationLevels: 2,
        minStartingStackBb: 20,
      },
    },
  } as const;
}

describe('TournamentManager committed late-registration projection', () => {
  let rooms: RoomManager;
  let manager: TournamentManager;
  let events: string[];
  let commitLateMttBatch: (
    tournamentId: string,
    entries: readonly LateEntryKey[],
    tableCount: number,
  ) => void;
  let tournamentId: string;
  let roomIds: string[];

  beforeEach(() => {
    vi.useFakeTimers();
    events = [];
    commitLateMttBatch = vi.fn();
    rooms = new RoomManager(roomId => {
      events.push(`update:${roomId}`);
    }, () => {});
    tournamentId = 'persistent-late-projection';
    manager = new TournamentManager(rooms, {
      onSeated: ({ playerId, roomId }) => {
        events.push(`seat:${playerId}:${roomId}`);
      },
      onPlayerMoved: ({ playerId, toRoomId }) => {
        events.push(`move:${playerId}:${toRoomId}`);
      },
    }, {
      persistentRuntimeEnabled: true,
      persistentLateRegistration: {
        readInstance: () => ({
          status: 'running',
          registrationState: 'open-late',
          registrationGeneration: 1,
          registrationOwnerToken: null,
        }),
        commitLateMttBatch,
      },
    });
    const prepared = manager.prepareFromInstance(
      snapshot(tournamentId),
      [{ id: 'human-1', name: 'Human One', avatar: 'ara' }],
      'owner-1',
    );
    roomIds = [...prepared.roomIds];
    manager.activatePreparedTournament(tournamentId, 'owner-1', Date.now());
    events = [];
  });

  afterEach(() => {
    manager.shutdown();
    rooms.shutdown();
    vi.useRealTimers();
  });

  it('updates counters, every field mirror, and sessions before first broadcast', () => {
    const [leftId, rightId] = roomIds;
    const left = rooms.getRoom(leftId!)!.engine.state.players[0]!;
    const right = rooms.getRoom(rightId!)!.engine.state.players[0]!;
    const plan: LateRegistrationSeatingPlan = {
      batchId: 'batch-create',
      createTables: [{
        tableId: 'late-new-table',
        seats: Array.from({ length: 6 }, (_, seatIndex) => ({
          seatIndex,
          nextBigBlindOrder: seatIndex,
        })),
      }],
      breakTables: [],
      incumbentMoves: [{
        playerId: left.id,
        fromTableId: leftId!,
        fromSeatIndex: left.seatIndex,
        toTableId: 'late-new-table',
        toSeatIndex: 0,
      }, {
        playerId: right.id,
        fromTableId: rightId!,
        fromSeatIndex: right.seatIndex,
        toTableId: 'late-new-table',
        toSeatIndex: 1,
      }],
      lateSeats: [{
        playerId: latePlayer.id,
        tableId: 'late-new-table',
        seatIndex: 2,
      }],
      finalTableSizes: new Map([
        [leftId!, 3],
        [rightId!, 3],
        ['late-new-table', 3],
      ]),
    };
    const operation = { generation: 1, ownerToken: 'balance-owner' };
    expect(manager.beginLateRegistrationOperation(
      tournamentId,
      'balance',
      operation,
    )).toBe(true);

    expect(manager.commitLateRegistrationSeating(tournamentId, {
      operation,
      plan,
      entries: [entry],
      latePlayers: new Map([[latePlayer.id, latePlayer]]),
    })).toBe(true);

    expect(commitLateMttBatch).toHaveBeenCalledWith(
      tournamentId,
      [entry],
      3,
    );
    expect(manager.getAdminSummaries()[0]).toMatchObject({
      seatedCount: 9,
      remaining: 9,
      tables: expect.arrayContaining([
        expect.objectContaining({ roomId: 'late-new-table' }),
      ]),
    });
    for (const roomId of [...roomIds, 'late-new-table']) {
      expect(rooms.getRoom(roomId)!.engine.state.tournament).toMatchObject({
        entrants: 9,
        fieldRemaining: 9,
      });
    }
    const seatIndex = events.findIndex(event => event.startsWith('seat:late-1:'));
    const firstUpdate = events.findIndex(event => event.startsWith('update:'));
    expect(seatIndex).toBeGreaterThanOrEqual(0);
    expect(firstUpdate).toBeGreaterThan(seatIndex);
  });

  it('disposes every committed break table and clears both manager mappings', () => {
    expect(manager.createLateRegistrationTable(
      tournamentId,
      'late-empty-table',
    )).toBe('late-empty-table');
    const targetId = roomIds[0]!;
    const target = rooms.getRoom(targetId)!.engine.state.players;
    const plan: LateRegistrationSeatingPlan = {
      batchId: 'batch-break',
      createTables: [],
      breakTables: [{ tableId: 'late-empty-table' }],
      incumbentMoves: [],
      lateSeats: [{
        playerId: latePlayer.id,
        tableId: targetId,
        seatIndex: 5,
      }],
      finalTableSizes: new Map([
        [targetId, target.length + 1],
        [roomIds[1]!, rooms.getRoom(roomIds[1]!)!.engine.state.players.length],
      ]),
    };
    const operation = { generation: 1, ownerToken: 'break-owner' };
    expect(manager.beginLateRegistrationOperation(
      tournamentId,
      'balance',
      operation,
    )).toBe(true);

    expect(manager.commitLateRegistrationSeating(tournamentId, {
      operation,
      plan,
      entries: [entry],
      latePlayers: new Map([[latePlayer.id, latePlayer]]),
    })).toBe(true);

    expect(rooms.getRoom('late-empty-table')).toBeUndefined();
    expect(manager.getTournamentIdForRoom('late-empty-table')).toBeUndefined();
    expect(manager.getAdminSummaries()[0]?.tables).toHaveLength(2);
  });
});
