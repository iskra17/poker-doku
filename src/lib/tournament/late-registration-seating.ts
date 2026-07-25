export interface LateRegistrationSeatSnapshot {
  readonly seatIndex: number;
  readonly playerId: string | null;
  readonly nextBigBlindOrder: number;
}

export interface LateRegistrationTable {
  readonly tableId: string;
  readonly seats: readonly LateRegistrationSeatSnapshot[];
}

export interface LateRegistrationEntrant {
  readonly playerId: string;
}

export interface PlannedTable {
  readonly tableId: string;
  readonly seats: readonly Omit<LateRegistrationSeatSnapshot, 'playerId'>[];
}

export interface PlannedTableBreak {
  readonly tableId: string;
}

export interface PlannedMove {
  readonly playerId: string;
  readonly fromTableId: string;
  readonly fromSeatIndex: number;
  readonly toTableId: string;
  readonly toSeatIndex: number;
}

export interface PlannedSeat {
  readonly playerId: string;
  readonly tableId: string;
  readonly seatIndex: number;
}

export interface LateRegistrationSeatingPlan {
  readonly batchId: string;
  readonly createTables: readonly PlannedTable[];
  readonly breakTables: readonly PlannedTableBreak[];
  readonly incumbentMoves: readonly PlannedMove[];
  readonly lateSeats: readonly PlannedSeat[];
  readonly finalTableSizes: ReadonlyMap<string, number>;
}

export interface LateRegistrationSeatingInput {
  readonly batchId: string;
  readonly tables: readonly LateRegistrationTable[];
  readonly lateEntrants: readonly LateRegistrationEntrant[];
  readonly tableMaxPlayers: number;
  readonly newTableIds: readonly string[];
  readonly tieBreak: (maxExclusive: number) => number;
}

interface Occupant {
  playerId: string;
  tableId: string;
  seatIndex: number;
  nextBigBlindOrder: number;
}

interface TargetTable {
  tableId: string;
  source: LateRegistrationTable | null;
  seats: readonly LateRegistrationSeatSnapshot[];
  targetSize: number;
  lateCount: number;
  incumbentCount: number;
}

interface AllocationCandidate {
  targets: TargetTable[];
  mixingScore: number;
  maxCohort: number;
  incumbentMoves: number;
}

function draw(tieBreak: (maxExclusive: number) => number, maxExclusive: number): number {
  const value = tieBreak(maxExclusive);
  if (!Number.isSafeInteger(value) || value < 0 || value >= maxExclusive) {
    throw new Error('invalid-tie-break-result');
  }
  return value;
}

function shuffle<T>(
  values: readonly T[],
  tieBreak: (maxExclusive: number) => number,
): T[] {
  const result = [...values];
  for (let index = result.length - 1; index > 0; index--) {
    const other = draw(tieBreak, index + 1);
    [result[index], result[other]] = [result[other], result[index]];
  }
  return result;
}

function occupants(table: LateRegistrationTable): Occupant[] {
  return table.seats
    .filter((seat): seat is LateRegistrationSeatSnapshot & { playerId: string } => (
      seat.playerId !== null
    ))
    .map(seat => ({
      playerId: seat.playerId,
      tableId: table.tableId,
      seatIndex: seat.seatIndex,
      nextBigBlindOrder: seat.nextBigBlindOrder,
    }));
}

function validateInput(input: LateRegistrationSeatingInput): void {
  if (
    input.batchId.length === 0
    || !Number.isSafeInteger(input.tableMaxPlayers)
    || input.tableMaxPlayers < 2
    || input.lateEntrants.length === 0
  ) {
    throw new Error('invalid-seating-input');
  }
  const tableIds = new Set<string>();
  const playerIds = new Set<string>();
  for (const table of input.tables) {
    if (table.tableId.length === 0 || tableIds.has(table.tableId)) {
      throw new Error('duplicate-table');
    }
    tableIds.add(table.tableId);
    if (table.seats.length !== input.tableMaxPlayers) {
      throw new Error('invalid-table-capacity');
    }
    const seatIndices = new Set<number>();
    for (const seat of table.seats) {
      if (
        !Number.isSafeInteger(seat.seatIndex)
        || seat.seatIndex < 0
        || seat.seatIndex >= input.tableMaxPlayers
        || seatIndices.has(seat.seatIndex)
        || !Number.isSafeInteger(seat.nextBigBlindOrder)
        || seat.nextBigBlindOrder < 0
      ) {
        throw new Error('invalid-seat');
      }
      seatIndices.add(seat.seatIndex);
      if (seat.playerId !== null) {
        if (seat.playerId.length === 0 || playerIds.has(seat.playerId)) {
          throw new Error('duplicate-player');
        }
        playerIds.add(seat.playerId);
      }
    }
  }
  for (const entrant of input.lateEntrants) {
    if (entrant.playerId.length === 0 || playerIds.has(entrant.playerId)) {
      throw new Error('duplicate-player');
    }
    playerIds.add(entrant.playerId);
  }
  for (const newTableId of input.newTableIds) {
    if (
      newTableId.length === 0
      || tableIds.has(newTableId)
      || input.newTableIds.indexOf(newTableId)
        !== input.newTableIds.lastIndexOf(newTableId)
    ) {
      throw new Error('duplicate-table');
    }
  }
}

function extraAssignments(tableCount: number, extraCount: number): number[][] {
  const result: number[][] = [];
  const visit = (next: number, selected: number[]): void => {
    if (selected.length === extraCount) {
      result.push(selected);
      return;
    }
    for (
      let index = next;
      index <= tableCount - (extraCount - selected.length);
      index++
    ) {
      visit(index + 1, [...selected, index]);
    }
  };
  visit(0, []);
  return result;
}

function bestLateAllocation(
  targetSizes: readonly number[],
  currentSizes: readonly number[],
  newTableStartIndex: number,
  lateCount: number,
  incumbentTotal: number,
  tieBreak: (maxExclusive: number) => number,
): {
  lateCounts: number[];
  mixingScore: number;
  maxCohort: number;
  moves: number;
} | null {
  const newRequiredTwo = targetSizes
    .slice(newTableStartIndex)
    .map(size => Math.min(2, size));
  const newRequiredOne = targetSizes
    .slice(newTableStartIndex)
    .map(size => Math.min(1, size));
  const requiredTwoTotal = newRequiredTwo.reduce((sum, count) => sum + count, 0);
  const requiredOneTotal = newRequiredOne.reduce((sum, count) => sum + count, 0);
  const requiredNewIncumbents = incumbentTotal >= requiredTwoTotal
    ? newRequiredTwo
    : incumbentTotal >= requiredOneTotal
      ? newRequiredOne
      : newRequiredOne.map(() => 0);
  const mixingScore = requiredNewIncumbents
    .reduce((sum, count) => sum + count, 0);
  const maxLateByTable = targetSizes.map((size, index) => (
    index < newTableStartIndex
      ? size
      : size - requiredNewIncumbents[index - newTableStartIndex]
  ));

  for (
    let maxCohort = 0;
    maxCohort <= Math.max(...targetSizes);
    maxCohort++
  ) {
    const totalLateCapacity = maxLateByTable
      .reduce((sum, maximum) => sum + Math.min(maximum, maxCohort), 0);
    if (totalLateCapacity < lateCount) continue;

    let states = new Map<number, { lateCounts: number[]; moves: number }>();
    states.set(0, { lateCounts: [], moves: 0 });
    for (let index = 0; index < targetSizes.length; index++) {
      const nextStates = new Map<
        number,
        { lateCounts: number[]; moves: number }
      >();
      const maximum = Math.min(maxLateByTable[index], maxCohort);
      for (const [sum, state] of states) {
        for (let late = 0; late <= maximum; late++) {
          const nextSum = sum + late;
          if (nextSum > lateCount) continue;
          const finalIncumbents = targetSizes[index] - late;
          const moves = state.moves
            + Math.max(0, finalIncumbents - currentSizes[index]);
          const existing = nextStates.get(nextSum);
          const candidate = {
            lateCounts: [...state.lateCounts, late],
            moves,
          };
          if (
            !existing
            || candidate.moves < existing.moves
            || (
              candidate.moves === existing.moves
              && draw(tieBreak, 2) === 0
            )
          ) {
            nextStates.set(nextSum, candidate);
          }
        }
      }
      states = nextStates;
    }
    const best = states.get(lateCount);
    if (best) {
      return {
        ...best,
        mixingScore,
        maxCohort,
      };
    }
  }
  return null;
}

function chooseCandidate(
  candidates: readonly AllocationCandidate[],
  tieBreak: (maxExclusive: number) => number,
): AllocationCandidate {
  let best = candidates[0];
  for (const candidate of candidates.slice(1)) {
    const comparison =
      candidate.mixingScore !== best.mixingScore
        ? candidate.mixingScore - best.mixingScore
        : candidate.maxCohort !== best.maxCohort
          ? best.maxCohort - candidate.maxCohort
          : candidate.incumbentMoves !== best.incumbentMoves
            ? best.incumbentMoves - candidate.incumbentMoves
            : 0;
    if (comparison > 0 || (comparison === 0 && draw(tieBreak, 2) === 0)) {
      best = candidate;
    }
  }
  return best;
}

export function planLateRegistrationSeating(
  input: LateRegistrationSeatingInput,
): LateRegistrationSeatingPlan {
  validateInput(input);
  const incumbentTotal = input.tables
    .reduce((sum, current) => sum + occupants(current).length, 0);
  const total = incumbentTotal + input.lateEntrants.length;
  const targetTableCount = Math.ceil(total / input.tableMaxPlayers);
  const rankedTables = shuffle(input.tables, input.tieBreak)
    .sort((left, right) => occupants(right).length - occupants(left).length);
  const keptTables = rankedTables.slice(
    0,
    Math.min(targetTableCount, rankedTables.length),
  );
  const brokenTables = rankedTables.slice(keptTables.length);
  const newTableCount = targetTableCount - keptTables.length;
  if (input.newTableIds.length < newTableCount) {
    throw new Error('missing-new-table-id');
  }
  const newTables = input.newTableIds.slice(0, newTableCount).map(tableId => ({
    tableId,
    seats: Array.from(
      { length: input.tableMaxPlayers },
      (_, seatIndex): LateRegistrationSeatSnapshot => ({
        seatIndex,
        playerId: null,
        nextBigBlindOrder: seatIndex,
      }),
    ),
  }));
  const targetSources = [
    ...keptTables.map(source => ({ tableId: source.tableId, source })),
    ...newTables.map(source => ({ tableId: source.tableId, source: null })),
  ];
  const lowTargetSize = Math.floor(total / targetTableCount);
  const highTargetCount = total % targetTableCount;
  const candidates: AllocationCandidate[] = [];

  for (const highIndices of extraAssignments(targetTableCount, highTargetCount)) {
    const highSet = new Set(highIndices);
    const targetSizes = targetSources.map((_, index) => (
      lowTargetSize + (highSet.has(index) ? 1 : 0)
    ));
    const currentSizes = targetSources.map(target => (
      target.source ? occupants(target.source).length : 0
    ));
    const allocation = bestLateAllocation(
      targetSizes,
      currentSizes,
      keptTables.length,
      input.lateEntrants.length,
      incumbentTotal,
      input.tieBreak,
    );
    if (!allocation) continue;
    candidates.push({
      targets: targetSources.map((target, index) => ({
        tableId: target.tableId,
        source: target.source,
        seats: target.source?.seats ?? newTables[index - keptTables.length].seats,
        targetSize: targetSizes[index],
        lateCount: allocation.lateCounts[index],
        incumbentCount: targetSizes[index] - allocation.lateCounts[index],
      })),
      mixingScore: allocation.mixingScore,
      maxCohort: allocation.maxCohort,
      incumbentMoves: allocation.moves,
    });
  }
  if (candidates.length === 0) throw new Error('seating-plan-impossible');
  const chosen = chooseCandidate(candidates, input.tieBreak);

  const movers: Occupant[] = [];
  const retainedByTable = new Map<string, Set<string>>();
  for (const target of chosen.targets) {
    const currentOccupants = target.source ? occupants(target.source) : [];
    const moveCount = Math.max(0, currentOccupants.length - target.incumbentCount);
    const moving = [...currentOccupants]
      .sort((left, right) => (
        left.nextBigBlindOrder - right.nextBigBlindOrder
        || left.seatIndex - right.seatIndex
      ))
      .slice(0, moveCount);
    const movingIds = new Set(moving.map(player => player.playerId));
    retainedByTable.set(
      target.tableId,
      new Set(
        currentOccupants
          .filter(player => !movingIds.has(player.playerId))
          .map(player => player.playerId),
      ),
    );
    movers.push(...moving);
  }
  for (const broken of brokenTables) movers.push(...occupants(broken));

  const availableSeats = new Map<string, LateRegistrationSeatSnapshot[]>();
  for (const target of chosen.targets) {
    const retained = retainedByTable.get(target.tableId) ?? new Set<string>();
    availableSeats.set(
      target.tableId,
      target.seats
        .filter(seat => seat.playerId === null || !retained.has(seat.playerId))
        .sort((left, right) => (
          left.nextBigBlindOrder - right.nextBigBlindOrder
          || left.seatIndex - right.seatIndex
        )),
    );
  }

  const incumbentMoves: PlannedMove[] = [];
  let moverIndex = 0;
  for (const target of chosen.targets) {
    const retainedCount = retainedByTable.get(target.tableId)?.size ?? 0;
    const inboundCount = target.incumbentCount - retainedCount;
    const seats = availableSeats.get(target.tableId)!;
    for (let index = 0; index < inboundCount; index++) {
      const mover = movers[moverIndex++];
      const seat = seats.shift();
      if (!mover || !seat) throw new Error('incumbent-move-impossible');
      incumbentMoves.push({
        playerId: mover.playerId,
        fromTableId: mover.tableId,
        fromSeatIndex: mover.seatIndex,
        toTableId: target.tableId,
        toSeatIndex: seat.seatIndex,
      });
    }
  }
  if (moverIndex !== movers.length) throw new Error('incumbent-move-unassigned');

  const shuffledEntrants = shuffle(input.lateEntrants, input.tieBreak);
  const tableOrder = shuffle(chosen.targets, input.tieBreak);
  const remainingLate = new Map(
    chosen.targets.map(target => [target.tableId, target.lateCount]),
  );
  const lateSeats: PlannedSeat[] = [];
  let entrantIndex = 0;
  while (entrantIndex < shuffledEntrants.length) {
    let placedThisRound = 0;
    for (const target of tableOrder) {
      const remaining = remainingLate.get(target.tableId) ?? 0;
      if (remaining === 0 || entrantIndex >= shuffledEntrants.length) continue;
      const seat = availableSeats.get(target.tableId)!.shift();
      if (!seat) throw new Error('late-seat-impossible');
      lateSeats.push({
        playerId: shuffledEntrants[entrantIndex++].playerId,
        tableId: target.tableId,
        seatIndex: seat.seatIndex,
      });
      remainingLate.set(target.tableId, remaining - 1);
      placedThisRound += 1;
    }
    if (placedThisRound === 0) throw new Error('late-seat-unassigned');
  }

  return {
    batchId: input.batchId,
    createTables: newTables.map(created => ({
      tableId: created.tableId,
      seats: created.seats.map(({ seatIndex, nextBigBlindOrder }) => ({
        seatIndex,
        nextBigBlindOrder,
      })),
    })),
    breakTables: brokenTables.map(table => ({ tableId: table.tableId })),
    incumbentMoves,
    lateSeats,
    finalTableSizes: new Map(
      chosen.targets.map(target => [target.tableId, target.targetSize]),
    ),
  };
}
