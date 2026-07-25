import { describe, expect, it, vi } from 'vitest';
import type { Player } from '../lib/poker/types';
import type { LateEntryKey } from './tournament-enrollment-repository';
import type { LateRegistrationSeatingPlan } from '../lib/tournament/late-registration-seating';
import {
  LateRegistrationCoordinator,
  type LateRegistrationCoordinatorPorts,
} from './late-registration-coordinator';

const operation = {
  generation: 3,
  ownerToken: 'seat-owner',
} as const;

const entry: LateEntryKey = {
  profileId: 'late-1',
  economyMode: 'freeroll',
  requestId: 'request-1',
  registrationAttempt: 1,
};

const latePlayer: Player = {
  id: 'late-1',
  name: 'late',
  avatar: 'ara',
  type: 'human',
  chips: 1_500,
  seatIndex: 1,
  holeCards: [],
  currentBet: 0,
  totalContributed: 0,
  status: 'waiting',
  hasActed: false,
};

function plan(overrides: Partial<LateRegistrationSeatingPlan> = {}): LateRegistrationSeatingPlan {
  return {
    batchId: 'batch-1',
    createTables: [],
    breakTables: [],
    incumbentMoves: [],
    lateSeats: [{ playerId: 'late-1', tableId: 'table-a', seatIndex: 1 }],
    finalTableSizes: new Map([['table-a', 2]]),
    ...overrides,
  };
}

function harness(overrides: Partial<LateRegistrationCoordinatorPorts> = {}) {
  const events: string[] = [];
  const applyCommittedPlan = vi.fn(() => {
    events.push('field');
  });
  const journal = {
    affectedRoomIds: ['table-a'],
    rollback: vi.fn(() => events.push('rollback')),
    publish: vi.fn(() => events.push('publish')),
  };
  const ports = {
    readProjection: vi.fn(() => ({
      status: 'running',
      registrationState: 'open-late',
      generation: 3,
      ownerToken: null,
    })),
    hold: vi.fn((roomId, reason, ownerToken) => {
      events.push(`hold:${roomId}:${reason}:${ownerToken}`);
    }),
    release: vi.fn((roomId, reason, ownerToken) => {
      events.push(`release:${roomId}:${reason}:${ownerToken}`);
    }),
    createTable: vi.fn(table => {
      events.push(`create:${table.tableId}`);
    }),
    disposeTable: vi.fn(tableId => {
      events.push(`dispose:${tableId}`);
    }),
    applyBatch: vi.fn(() => {
      events.push('apply');
      return journal;
    }),
    commitBatch: vi.fn(() => {
      events.push('commit');
    }),
    projectSessions: vi.fn(() => {
      events.push('sessions');
    }),
    applyCommittedPlan,
    ...overrides,
  };
  const coordinator = new LateRegistrationCoordinator(ports, {
    generation: 3,
    registrationState: 'open-late',
    ownerToken: null,
  });
  return { coordinator, ports, events, journal, applyCommittedPlan };
}

describe('LateRegistrationCoordinator', () => {
  it('ignores every stale generation and owner callback', () => {
    const h = harness();
    expect(h.coordinator.begin('seating', operation, ['table-a'])).toBe(true);

    expect(h.coordinator.runCallback(
      { generation: 2, ownerToken: 'seat-owner' },
      () => h.events.push('stale-generation'),
    )).toBe(false);
    expect(h.coordinator.runCallback(
      { generation: 3, ownerToken: 'other-owner' },
      () => h.events.push('stale-owner'),
    )).toBe(false);

    h.coordinator.adoptClosingProjection({
      generation: 4,
      ownerToken: 'close-owner',
    }, ['table-a']);
    h.coordinator.finish(operation, ['table-a']);

    expect(h.events).not.toContain('stale-generation');
    expect(h.events).not.toContain('stale-owner');
    expect(h.events).toContain(
      'hold:table-a:late-reg-closing:close-owner',
    );
    expect(h.events).not.toContain(
      'release:table-a:late-reg-closing:close-owner',
    );
  });

  it('idempotently reuses only the exact same operation kind', () => {
    const h = harness();
    expect(h.coordinator.begin('seating', operation, ['table-a'])).toBe(true);
    expect(h.coordinator.begin('seating', operation, ['table-a'])).toBe(true);
    expect(h.coordinator.begin('balance', operation, ['table-a'])).toBe(false);
    expect(h.events).toEqual([
      'hold:table-a:late-reg-seating:seat-owner',
    ]);
  });

  it('upgrades a changed one-player target into global balance', () => {
    const h = harness();
    h.coordinator.begin('seating', operation, ['table-a']);

    expect(h.coordinator.classifySingleSeatPlan(
      operation,
      'table-a',
      plan({
        incumbentMoves: [{
          playerId: 'incumbent',
          fromTableId: 'table-b',
          fromSeatIndex: 0,
          toTableId: 'table-a',
          toSeatIndex: 0,
        }],
      }),
      ['table-a', 'table-b'],
    )).toBe('balance');
    expect(h.events).toContain(
      'hold:table-b:late-reg-balance:seat-owner',
    );
  });

  it('commits a silent batch before any session or room update', () => {
    const h = harness();
    h.coordinator.begin('seating', operation, ['table-a']);

    expect(h.coordinator.commitSeating({
      operation,
      plan: plan(),
      entries: [entry],
      latePlayers: new Map([['late-1', latePlayer]]),
    })).toBe(true);

    expect(h.events).toEqual([
      'hold:table-a:late-reg-seating:seat-owner',
      'apply',
      'commit',
      'field',
      'sessions',
      'publish',
    ]);
    expect(h.ports.applyBatch).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ broadcast: false }),
    );
  });

  it('disposes broken tables only after commit and before live projection', () => {
    const h = harness();
    h.coordinator.begin('balance', operation, ['table-a', 'table-old']);

    expect(h.coordinator.commitSeating({
      operation,
      plan: plan({
        breakTables: [{ tableId: 'table-old' }],
        incumbentMoves: [{
          playerId: 'incumbent',
          fromTableId: 'table-old',
          fromSeatIndex: 0,
          toTableId: 'table-a',
          toSeatIndex: 0,
        }],
        finalTableSizes: new Map([['table-a', 3]]),
      }),
      entries: [entry],
      latePlayers: new Map([['late-1', latePlayer]]),
    })).toBe(true);

    expect(h.events).toEqual([
      'hold:table-a:late-reg-balance:seat-owner',
      'hold:table-old:late-reg-balance:seat-owner',
      'apply',
      'commit',
      'dispose:table-old',
      'field',
      'sessions',
      'publish',
    ]);
  });

  it('rolls the journal back and disposes a new table after db failure', () => {
    const h = harness({
      commitBatch: vi.fn(() => {
        h.events.push('commit');
        throw new Error('db down');
      }),
    });
    h.coordinator.begin('balance', operation, ['table-a', 'table-b']);

    expect(h.coordinator.commitSeating({
      operation,
      plan: plan({
        createTables: [{
          tableId: 'table-new',
          seats: [
            { seatIndex: 0, nextBigBlindOrder: 0 },
            { seatIndex: 1, nextBigBlindOrder: 1 },
          ],
        }],
        breakTables: [{ tableId: 'table-old' }],
        finalTableSizes: new Map([
          ['table-a', 1],
          ['table-new', 1],
        ]),
      }),
      entries: [entry],
      latePlayers: new Map([['late-1', latePlayer]]),
    })).toBe(false);

    expect(h.events).toEqual([
      'hold:table-a:late-reg-balance:seat-owner',
      'hold:table-b:late-reg-balance:seat-owner',
      'create:table-new',
      'apply',
      'commit',
      'rollback',
      'dispose:table-new',
    ]);
    expect(h.ports.projectSessions).not.toHaveBeenCalled();
    expect(h.journal.publish).not.toHaveBeenCalled();
    expect(h.events).not.toContain('dispose:table-old');
  });

  it('lets cancel take ownership before freeze without deadlock', () => {
    const h = harness();
    h.coordinator.begin('closing', {
      generation: 4,
      ownerToken: 'close-owner',
    }, ['table-a']);

    expect(h.coordinator.takeCancelOwnership({
      generation: 5,
      ownerToken: 'cancel-owner',
    }, ['table-a'])).toBe(true);
    expect(h.events.slice(-2)).toEqual([
      'release:table-a:late-reg-closing:close-owner',
      'hold:table-a:tournament-cancel:cancel-owner',
    ]);
    expect(h.coordinator.runCallback(
      { generation: 4, ownerToken: 'close-owner' },
      () => h.events.push('freeze'),
    )).toBe(false);
    expect(h.events).not.toContain('freeze');
  });
});
