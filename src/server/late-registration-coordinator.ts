import type { Player } from '../lib/poker/types';
import type {
  LateRegistrationSeatingPlan,
  PlannedTable,
} from '../lib/tournament/late-registration-seating';
import type { LateEntryKey } from './tournament-enrollment-repository';
import type {
  NextHandGateResult,
  AppliedTransferJournal,
} from './room-manager';

export type LateRegistrationOperationKind =
  | 'seating'
  | 'balance'
  | 'director-remove'
  | 'closing'
  | 'cancel';

export type LateRegistrationHoldReason =
  | 'late-reg-seating'
  | 'late-reg-balance'
  | 'late-reg-closing'
  | 'mtt-state-reconcile'
  | 'tournament-cancel';

export interface LateRegistrationOperationIdentity {
  readonly generation: number;
  readonly ownerToken: string;
}

export interface LateRegistrationProjection {
  readonly status: string;
  readonly registrationState: string;
  readonly generation: number;
  readonly ownerToken: string | null;
}

export interface LateRegistrationRuntimeProjection {
  readonly generation: number;
  readonly registrationState: string;
  readonly ownerToken: string | null;
}

export interface LateRegistrationCoordinatorPorts {
  readProjection(): LateRegistrationProjection;
  hold(
    roomId: string,
    reason: LateRegistrationHoldReason,
    ownerToken: string,
  ): void;
  release(
    roomId: string,
    reason: LateRegistrationHoldReason,
    ownerToken: string,
  ): void;
  createTable(table: PlannedTable): void;
  disposeTable(tableId: string): void;
  applyBatch(
    plan: LateRegistrationSeatingPlan,
    options: {
      broadcast: false;
      latePlayers: ReadonlyMap<string, Player>;
    },
  ): AppliedTransferJournal;
  commitBatch(
    entries: readonly LateEntryKey[],
    tableCount: number,
  ): void;
  projectSessions(plan: LateRegistrationSeatingPlan): void;
}

export interface CommitLateRegistrationSeating {
  readonly operation: LateRegistrationOperationIdentity;
  readonly plan: LateRegistrationSeatingPlan;
  readonly entries: readonly LateEntryKey[];
  readonly latePlayers: ReadonlyMap<string, Player>;
}

interface ActiveOperation extends LateRegistrationOperationIdentity {
  kind: LateRegistrationOperationKind;
  heldReason: LateRegistrationHoldReason;
  roomIds: Set<string>;
}

const TERMINAL_INSTANCE_STATUSES = new Set([
  'refund-pending',
  'payout-pending',
  'completed',
  'cancelled',
]);

function holdFor(kind: LateRegistrationOperationKind): LateRegistrationHoldReason {
  switch (kind) {
    case 'seating': return 'late-reg-seating';
    case 'balance': return 'late-reg-balance';
    case 'closing': return 'late-reg-closing';
    case 'cancel': return 'tournament-cancel';
    case 'director-remove': return 'late-reg-seating';
  }
}

function sameIdentity(
  left: LateRegistrationOperationIdentity | null,
  right: LateRegistrationOperationIdentity,
): boolean {
  return left?.generation === right.generation
    && left.ownerToken === right.ownerToken;
}

/**
 * Serializes the logical owners of late-registration work. SQLite remains the
 * durable authority; this object only owns live callbacks and exact-owner
 * holds. Every delayed continuation must pass its captured identity back in.
 */
export class LateRegistrationCoordinator {
  private projection: LateRegistrationRuntimeProjection;
  private active: ActiveOperation | null = null;

  constructor(
    private readonly ports: LateRegistrationCoordinatorPorts,
    initialProjection: LateRegistrationRuntimeProjection,
  ) {
    this.projection = { ...initialProjection };
  }

  snapshot(): Readonly<{
    projection: LateRegistrationRuntimeProjection;
    activeOperation: ActiveOperation | null;
  }> {
    return {
      projection: { ...this.projection },
      activeOperation: this.active
        ? {
            ...this.active,
            roomIds: new Set(this.active.roomIds),
          }
        : null,
    };
  }

  begin(
    kind: LateRegistrationOperationKind,
    identity: LateRegistrationOperationIdentity,
    roomIds: readonly string[],
  ): boolean {
    if (
      identity.generation < this.projection.generation
      || (
        this.active
        && !sameIdentity(this.active, identity)
        && kind !== 'cancel'
      )
    ) {
      return false;
    }
    const heldReason = holdFor(kind);
    const uniqueRoomIds = new Set(roomIds);
    for (const roomId of uniqueRoomIds) {
      this.ports.hold(roomId, heldReason, identity.ownerToken);
    }
    this.projection = {
      generation: identity.generation,
      registrationState: kind === 'closing' ? 'closing' : this.projection.registrationState,
      ownerToken: kind === 'closing' || kind === 'cancel'
        ? identity.ownerToken
        : this.projection.ownerToken,
    };
    this.active = {
      ...identity,
      kind,
      heldReason,
      roomIds: uniqueRoomIds,
    };
    return true;
  }

  runCallback(
    identity: LateRegistrationOperationIdentity,
    callback: () => void,
  ): boolean {
    if (!sameIdentity(this.active, identity)) return false;
    callback();
    return true;
  }

  finish(
    identity: LateRegistrationOperationIdentity,
    roomIds?: readonly string[],
  ): boolean {
    const active = this.active;
    if (!active || !sameIdentity(active, identity)) return false;
    for (const roomId of roomIds ?? active.roomIds) {
      if (!active.roomIds.has(roomId)) continue;
      this.ports.release(roomId, active.heldReason, active.ownerToken);
    }
    this.active = null;
    return true;
  }

  adoptClosingProjection(
    identity: LateRegistrationOperationIdentity,
    roomIds: readonly string[],
  ): boolean {
    if (identity.generation < this.projection.generation) return false;
    if (
      identity.generation === this.projection.generation
      && this.projection.registrationState === 'closing'
      && this.projection.ownerToken !== null
      && this.projection.ownerToken !== identity.ownerToken
    ) {
      return false;
    }

    const previous = this.active;
    const uniqueRoomIds = new Set(roomIds);
    // Install the new fence first. Removing an obsolete owner can therefore
    // never create a hand-start gap.
    for (const roomId of uniqueRoomIds) {
      this.ports.hold(roomId, 'late-reg-closing', identity.ownerToken);
    }
    if (
      previous
      && !sameIdentity(previous, identity)
      && (
        previous.heldReason === 'late-reg-seating'
        || previous.heldReason === 'late-reg-balance'
      )
    ) {
      for (const roomId of previous.roomIds) {
        this.ports.release(roomId, previous.heldReason, previous.ownerToken);
      }
    }
    this.projection = {
      generation: identity.generation,
      registrationState: 'closing',
      ownerToken: identity.ownerToken,
    };
    this.active = {
      ...identity,
      kind: 'closing',
      heldReason: 'late-reg-closing',
      roomIds: uniqueRoomIds,
    };
    return true;
  }

  takeCancelOwnership(
    identity: LateRegistrationOperationIdentity,
    roomIds: readonly string[],
  ): boolean {
    if (identity.generation <= this.projection.generation) return false;
    for (const roomId of new Set(roomIds)) {
      this.ports.hold(roomId, 'tournament-cancel', identity.ownerToken);
    }
    this.projection = {
      generation: identity.generation,
      registrationState: 'closed',
      ownerToken: identity.ownerToken,
    };
    this.active = {
      ...identity,
      kind: 'cancel',
      heldReason: 'tournament-cancel',
      roomIds: new Set(roomIds),
    };
    return true;
  }

  classifySingleSeatPlan(
    identity: LateRegistrationOperationIdentity,
    expectedTargetTableId: string,
    plan: LateRegistrationSeatingPlan,
    roomIds: readonly string[],
  ): 'single' | 'balance' | 'stale' {
    const previous = this.active;
    if (!previous || !sameIdentity(previous, identity)) return 'stale';
    const finalSizes = [...plan.finalTableSizes.values()];
    const balanced = finalSizes.length === 0
      || Math.max(...finalSizes) - Math.min(...finalSizes) <= 1;
    const remainsSingle = (
      plan.createTables.length === 0
      && plan.breakTables.length === 0
      && plan.incumbentMoves.length === 0
      && plan.lateSeats.length === 1
      && plan.lateSeats[0]?.tableId === expectedTargetTableId
      && balanced
    );
    if (remainsSingle) return 'single';

    for (const roomId of new Set(roomIds)) {
      this.ports.hold(roomId, 'late-reg-balance', identity.ownerToken);
    }
    for (const roomId of previous.roomIds) {
      this.ports.release(roomId, previous.heldReason, previous.ownerToken);
    }
    this.active = {
      ...identity,
      kind: 'balance',
      heldReason: 'late-reg-balance',
      roomIds: new Set(roomIds),
    };
    return 'balance';
  }

  commitSeating(input: CommitLateRegistrationSeating): boolean {
    if (!sameIdentity(this.active, input.operation)) return false;
    const createdTableIds: string[] = [];
    let journal: AppliedTransferJournal | null = null;
    let committed = false;
    try {
      for (const table of input.plan.createTables) {
        this.ports.createTable(table);
        createdTableIds.push(table.tableId);
      }
      journal = this.ports.applyBatch(input.plan, {
        broadcast: false,
        latePlayers: input.latePlayers,
      });
      this.ports.commitBatch(input.entries, input.plan.finalTableSizes.size);
      committed = true;
    } catch {
      if (!committed) {
        try {
          journal?.rollback();
        } finally {
          for (const tableId of createdTableIds.reverse()) {
            this.ports.disposeTable(tableId);
          }
        }
      }
      return false;
    }

    // Everything after the durable commit is an idempotent projection. A
    // disconnected client recovers it through resync, so never roll back the
    // committed ledger because a best-effort notification failed.
    try {
      this.ports.projectSessions(input.plan);
    } catch {
      // best effort
    }
    try {
      journal.publish();
    } catch {
      // best effort
    }
    return true;
  }

  checkNextHandGate(roomIds: readonly string[]): NextHandGateResult {
    let persisted: LateRegistrationProjection;
    try {
      persisted = this.ports.readProjection();
    } catch {
      return this.retryGate();
    }
    if (TERMINAL_INSTANCE_STATUSES.has(persisted.status)) {
      return { status: 'terminal' };
    }
    if (persisted.status !== 'running') return this.retryGate();

    if (persisted.registrationState === 'closing') {
      if (!persisted.ownerToken) return this.retryGate();
      this.adoptClosingProjection({
        generation: persisted.generation,
        ownerToken: persisted.ownerToken,
      }, roomIds);
      return { status: 'held' };
    }
    if (persisted.registrationState === 'open-late') {
      if (
        persisted.generation !== this.projection.generation
        || persisted.ownerToken !== null
      ) {
        return this.retryGate(persisted);
      }
      return this.active ? { status: 'held' } : { status: 'allow' };
    }
    if (persisted.registrationState === 'closed') {
      if (persisted.ownerToken !== null) return this.retryGate(persisted);
      this.projection = {
        generation: persisted.generation,
        registrationState: 'closed',
        ownerToken: null,
      };
      return this.active ? { status: 'held' } : { status: 'allow' };
    }
    return this.retryGate(persisted);
  }

  private retryGate(
    persisted?: Pick<LateRegistrationProjection, 'generation' | 'ownerToken'>,
  ): NextHandGateResult {
    const generation = persisted?.generation ?? this.projection.generation;
    const ownerToken = persisted?.ownerToken
      ?? this.projection.ownerToken
      ?? `mtt-reconcile-${generation}`;
    return { status: 'retry', generation, ownerToken };
  }
}
