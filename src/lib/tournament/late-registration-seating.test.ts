import { describe, expect, it, vi } from 'vitest';
import {
  planLateRegistrationSeating,
  type LateRegistrationTable,
} from './late-registration-seating';

const CAPACITY = 6;

function table(id: string, playerCount: number): LateRegistrationTable {
  return {
    tableId: id,
    seats: Array.from({ length: CAPACITY }, (_, seatIndex) => ({
      seatIndex,
      playerId: seatIndex < playerCount ? `${id}-p${seatIndex}` : null,
      nextBigBlindOrder: seatIndex,
    })),
  };
}

function entrants(count: number) {
  return Array.from({ length: count }, (_, index) => ({
    playerId: `late-${index}`,
  }));
}

function zeroTieBreak(maxExclusive: number): number {
  expect(maxExclusive).toBeGreaterThan(0);
  return 0;
}

function lastTieBreak(maxExclusive: number): number {
  expect(maxExclusive).toBeGreaterThan(0);
  return maxExclusive - 1;
}

function sequenceTieBreak(values: readonly number[]) {
  let index = 0;
  return (maxExclusive: number): number => {
    const value = values[index++ % values.length];
    return value % maxExclusive;
  };
}

const generatedFields = Array.from({ length: 32 }, (_, index) => {
  const alive = 2 + index;
  const batch = 1 + (index % Math.min(8, 48 - alive));
  const tableCount = Math.ceil(alive / CAPACITY);
  const low = Math.floor(alive / tableCount);
  const highCount = alive % tableCount;
  const tables = Array.from(
    { length: tableCount },
    (_, tableIndex) => table(
      `t${tableIndex + 1}`,
      low + (tableIndex < highCount ? 1 : 0),
    ),
  );
  return { alive, batch, tables };
});

describe('planLateRegistrationSeating properties', () => {
  it.each(generatedFields)(
    'plans $alive incumbents + $batch entrants within balanced capacity',
    ({ alive, batch, tables }) => {
      const plan = planLateRegistrationSeating({
        batchId: `batch-${alive}-${batch}`,
        tables,
        lateEntrants: entrants(batch),
        tableMaxPlayers: CAPACITY,
        newTableIds: Array.from({ length: 8 }, (_, i) => `new-${i}`),
        tieBreak: zeroTieBreak,
      });
      const finalSizes = [...plan.finalTableSizes.values()];
      const occupiedDestinations = new Set([
        ...plan.incumbentMoves.map(move => `${move.toTableId}:${move.toSeatIndex}`),
        ...plan.lateSeats.map(seat => `${seat.tableId}:${seat.seatIndex}`),
      ]);

      expect(finalSizes.reduce((sum, size) => sum + size, 0))
        .toBe(alive + batch);
      expect(Math.max(...finalSizes)).toBeLessThanOrEqual(CAPACITY);
      expect(Math.max(...finalSizes) - Math.min(...finalSizes))
        .toBeLessThanOrEqual(1);
      expect(occupiedDestinations.size).toBe(
        plan.incumbentMoves.length + plan.lateSeats.length,
      );
      expect(new Set(plan.lateSeats.map(seat => seat.playerId)).size)
        .toBe(batch);
    },
  );

  it('mixes a five-player cohort with incumbents instead of a new-only table', () => {
    const plan = planLateRegistrationSeating({
      batchId: 'batch-five',
      tables: [table('a', 5), table('b', 5)],
      lateEntrants: entrants(5),
      tableMaxPlayers: CAPACITY,
      newTableIds: ['c'],
      tieBreak: zeroTieBreak,
    });
    const lateByTable = new Map<string, number>();
    for (const seat of plan.lateSeats) {
      lateByTable.set(seat.tableId, (lateByTable.get(seat.tableId) ?? 0) + 1);
    }
    const movesToNew = plan.incumbentMoves.filter(move => move.toTableId === 'c');

    expect(plan.createTables.map(created => created.tableId)).toEqual(['c']);
    expect(movesToNew.length).toBeGreaterThanOrEqual(2);
    expect(Math.max(...lateByTable.values())).toBeLessThanOrEqual(2);
    expect(lateByTable.get('c')).toBeLessThan(5);
  });

  it('minimizes incumbent moves when existing deficits accept the cohort', () => {
    const plan = planLateRegistrationSeating({
      batchId: 'no-move',
      tables: [table('a', 5), table('b', 5)],
      lateEntrants: entrants(1),
      tableMaxPlayers: CAPACITY,
      newTableIds: [],
      tieBreak: zeroTieBreak,
    });

    expect(plan.incumbentMoves).toEqual([]);
    expect([...plan.finalTableSizes.values()].sort()).toEqual([5, 6]);
  });

  it('moves soon-BB incumbents into soon-BB empty seats', () => {
    const input = {
      batchId: 'soon-bb',
      tables: [table('a', 6)],
      lateEntrants: entrants(1),
      tableMaxPlayers: CAPACITY,
      newTableIds: ['b'],
    } as const;
    const plan = planLateRegistrationSeating({
      ...input,
      tieBreak: zeroTieBreak,
    });
    const alternate = planLateRegistrationSeating({
      ...input,
      tieBreak: lastTieBreak,
    });

    expect(plan.incumbentMoves.map(move => move.playerId))
      .toEqual(['a-p0', 'a-p1']);
    expect(plan.incumbentMoves.map(move => move.toSeatIndex))
      .toEqual([0, 1]);
    expect(alternate.incumbentMoves.map(move => move.playerId))
      .toEqual(['a-p0', 'a-p1']);
    expect(alternate.incumbentMoves.map(move => move.toSeatIndex))
      .toEqual([0, 1]);
  });

  it('draws a late entrant seat from the legal empty-seat pool', () => {
    const first = planLateRegistrationSeating({
      batchId: 'late-seat-first',
      tables: [table('a', 3)],
      lateEntrants: entrants(1),
      tableMaxPlayers: CAPACITY,
      newTableIds: [],
      tieBreak: zeroTieBreak,
    });
    const last = planLateRegistrationSeating({
      batchId: 'late-seat-last',
      tables: [table('a', 3)],
      lateEntrants: entrants(1),
      tableMaxPlayers: CAPACITY,
      newTableIds: [],
      tieBreak: lastTieBreak,
    });

    expect([3, 4, 5]).toContain(first.lateSeats[0].seatIndex);
    expect([3, 4, 5]).toContain(last.lateSeats[0].seatIndex);
    expect(first.lateSeats[0].seatIndex)
      .not.toBe(last.lateSeats[0].seatIndex);
  });

  it('replays an injected bounded random sequence reproducibly', () => {
    const input = {
      batchId: 'late-seat-sequence',
      tables: [table('a', 3)],
      lateEntrants: entrants(2),
      tableMaxPlayers: CAPACITY,
      newTableIds: [],
    } as const;

    const first = planLateRegistrationSeating({
      ...input,
      tieBreak: sequenceTieBreak([1, 0, 2, 1]),
    });
    const replay = planLateRegistrationSeating({
      ...input,
      tieBreak: sequenceTieBreak([1, 0, 2, 1]),
    });

    expect(replay).toEqual(first);
  });

  it('rejects a field above 48 before invoking tie-break or recursion', () => {
    const tieBreak = vi.fn(zeroTieBreak);

    expect(() => planLateRegistrationSeating({
      batchId: 'too-large',
      tables: Array.from({ length: 8 }, (_, index) => (
        table(`t${index}`, CAPACITY)
      )),
      lateEntrants: entrants(1),
      tableMaxPlayers: CAPACITY,
      newTableIds: ['ninth'],
      tieBreak,
    })).toThrow('invalid-seating-input');
    expect(tieBreak).not.toHaveBeenCalled();
  });

  it('rejects illegal table capacity and table count before planning', () => {
    const fiveSeatTable: LateRegistrationTable = {
      tableId: 'five',
      seats: Array.from({ length: 5 }, (_, seatIndex) => ({
        seatIndex,
        playerId: seatIndex < 2 ? `five-p${seatIndex}` : null,
        nextBigBlindOrder: seatIndex,
      })),
    };
    const capacityTieBreak = vi.fn(zeroTieBreak);
    expect(() => planLateRegistrationSeating({
      batchId: 'wrong-capacity',
      tables: [fiveSeatTable],
      lateEntrants: entrants(1),
      tableMaxPlayers: 5,
      newTableIds: [],
      tieBreak: capacityTieBreak,
    })).toThrow('invalid-seating-input');
    expect(capacityTieBreak).not.toHaveBeenCalled();

    const tableCountTieBreak = vi.fn(zeroTieBreak);
    expect(() => planLateRegistrationSeating({
      batchId: 'too-many-tables',
      tables: Array.from({ length: 9 }, (_, index) => table(`t${index}`, 2)),
      lateEntrants: entrants(1),
      tableMaxPlayers: CAPACITY,
      newTableIds: [],
      tieBreak: tableCountTieBreak,
    })).toThrow('invalid-seating-input');
    expect(tableCountTieBreak).not.toHaveBeenCalled();
  });

  it('rejects duplicate runtime IDs and seat coordinates', () => {
    const duplicateSeat: LateRegistrationTable = {
      tableId: 'duplicate-seat',
      seats: table('source', 2).seats.map((seat, index) => ({
        ...seat,
        seatIndex: index === 1 ? 0 : seat.seatIndex,
      })),
    };
    expect(() => planLateRegistrationSeating({
      batchId: 'duplicate-seat',
      tables: [duplicateSeat],
      lateEntrants: entrants(1),
      tableMaxPlayers: CAPACITY,
      newTableIds: [],
      tieBreak: zeroTieBreak,
    })).toThrow('invalid-seat');
    expect(() => planLateRegistrationSeating({
      batchId: 'duplicate-player',
      tables: [table('a', 2)],
      lateEntrants: [{ playerId: 'a-p0' }],
      tableMaxPlayers: CAPACITY,
      newTableIds: [],
      tieBreak: zeroTieBreak,
    })).toThrow('duplicate-player');
  });

  it('uses only the injected CSPRNG tie-break path', () => {
    const random = vi.spyOn(Math, 'random').mockImplementation(() => {
      throw new Error('Math.random must not be called');
    });
    try {
      expect(() => planLateRegistrationSeating({
        batchId: 'no-math-random',
        tables: [table('a', 5), table('b', 5)],
        lateEntrants: entrants(5),
        tableMaxPlayers: CAPACITY,
        newTableIds: ['c'],
        tieBreak: zeroTieBreak,
      })).not.toThrow();
    } finally {
      random.mockRestore();
    }
  });
});
