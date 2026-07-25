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
    const plan = planLateRegistrationSeating({
      batchId: 'soon-bb',
      tables: [table('a', 6)],
      lateEntrants: entrants(1),
      tableMaxPlayers: CAPACITY,
      newTableIds: ['b'],
      tieBreak: zeroTieBreak,
    });

    expect(plan.incumbentMoves.map(move => move.playerId))
      .toEqual(['a-p0', 'a-p1']);
    expect(plan.incumbentMoves.map(move => move.toSeatIndex))
      .toEqual([0, 1]);
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
