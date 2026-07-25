import { createHash } from 'node:crypto';
import type { PokerDatabase } from './persistence/database';
import { TournamentInstanceRepository } from './tournament-instance-repository';

export interface RecoveryEntryExpectation {
  readonly economyEntryAttempt: number;
  readonly buyIn: number;
  readonly fee: number;
}

export interface TournamentRecoveryPlan {
  readonly preserveReservedMttEntries: ReadonlyMap<
    string,
    ReadonlyMap<string, RecoveryEntryExpectation>
  >;
  readonly deferToMttVoidInstanceIds: ReadonlySet<string>;
  readonly refundInstanceIds: readonly string[];
  readonly payoutInstanceIds: readonly string[];
}

export interface TournamentRecoveryPorts {
  loadAndValidate(): TournamentRecoveryPlan;
  recoverGeneric(options: Pick<
    TournamentRecoveryPlan,
    'preserveReservedMttEntries' | 'deferToMttVoidInstanceIds'
  >): unknown;
  resumeRefund(instanceId: string): unknown;
  resumePayout(instanceId: string): unknown;
  reconcileTemplatesAndTimers(): unknown;
}

/**
 * Runs before the network listener is opened. The deliberately small port keeps
 * enrollment/economy recovery replaceable without letting generic orphan
 * recovery make tournament lifecycle decisions.
 */
export class TournamentRecoveryService {
  constructor(private readonly ports: TournamentRecoveryPorts) {}

  recoverBeforeListen(): TournamentRecoveryPlan {
    const plan = this.ports.loadAndValidate();
    this.ports.recoverGeneric({
      preserveReservedMttEntries: plan.preserveReservedMttEntries,
      deferToMttVoidInstanceIds: plan.deferToMttVoidInstanceIds,
    });
    for (const instanceId of plan.refundInstanceIds) {
      this.ports.resumeRefund(instanceId);
    }
    for (const instanceId of plan.payoutInstanceIds) {
      this.ports.resumePayout(instanceId);
    }
    this.ports.reconcileTemplatesAndTimers();
    return plan;
  }
}

interface RecoveryInstanceRow {
  readonly id: string;
  readonly status: string;
  readonly payout_freeze_json: string | null;
}

interface PreservedEntryRow {
  readonly instance_id: string;
  readonly profile_id: string;
  readonly economy_entry_attempt: number;
  readonly entry_attempt: number;
  readonly buy_in: number;
  readonly fee: number;
}

/**
 * Reads and validates the complete durable inventory before generic economy
 * recovery runs. A malformed config snapshot fails startup through the instance
 * repository decoder instead of being silently refunded or exposed.
 */
export function loadTournamentRecoveryPlan(
  database: PokerDatabase,
  now: number,
): TournamentRecoveryPlan {
  if (!Number.isSafeInteger(now) || now < 0) {
    throw new Error('Invalid tournament recovery clock');
  }
  const instances = new TournamentInstanceRepository(database, () => now);
  instances.listAdminProjections(now);

  const rows = database.db.prepare(`
    SELECT id, status, payout_freeze_json
    FROM tournament_instance
    WHERE status NOT IN ('completed', 'cancelled')
    ORDER BY id
  `).all() as unknown as RecoveryInstanceRow[];
  const refundInstanceIds: string[] = [];
  const payoutInstanceIds: string[] = [];

  for (const row of rows) {
    if (
      row.status === 'payout-pending'
      || (row.status === 'running' && row.payout_freeze_json !== null)
    ) {
      payoutInstanceIds.push(row.id);
      continue;
    }
    if (
      row.status === 'refund-pending'
      || (
        (row.status === 'starting' || row.status === 'running')
        && row.payout_freeze_json === null
      )
    ) {
      refundInstanceIds.push(row.id);
    }
  }

  const preserved = new Map<
    string,
    Map<string, RecoveryEntryExpectation>
  >();
  const entries = database.db.prepare(`
    SELECT
      registration.instance_id,
      registration.profile_id,
      registration.economy_entry_attempt,
      entry.entry_attempt,
      entry.buy_in,
      entry.fee
    FROM tournament_registration registration
    JOIN tournament_instance instance
      ON instance.id = registration.instance_id
    JOIN sng_entries entry
      ON entry.tournament_id = registration.instance_id
     AND entry.profile_id = registration.profile_id
    WHERE instance.status IN (
      'scheduled-hidden',
      'scheduled-visible',
      'registering',
      'start-delayed'
    )
      AND instance.economy_mode = 'wallet'
      AND registration.status = 'registered'
      AND registration.economy_entry_attempt IS NOT NULL
      AND entry.status = 'reserved'
      AND entry.entry_attempt = registration.economy_entry_attempt
    ORDER BY registration.instance_id, registration.profile_id
  `).all() as unknown as PreservedEntryRow[];
  for (const entry of entries) {
    let byProfile = preserved.get(entry.instance_id);
    if (!byProfile) {
      byProfile = new Map();
      preserved.set(entry.instance_id, byProfile);
    }
    byProfile.set(entry.profile_id, {
      economyEntryAttempt: entry.economy_entry_attempt,
      buyIn: entry.buy_in,
      fee: entry.fee,
    });
  }

  return {
    preserveReservedMttEntries: preserved,
    // Generic orphan recovery must not touch either side of durable money
    // ownership. Refund and payout executors consume these rows afterward.
    deferToMttVoidInstanceIds: new Set([
      ...refundInstanceIds,
      ...payoutInstanceIds,
    ]),
    refundInstanceIds,
    payoutInstanceIds,
  };
}

export function recoveryOperationUuid(value: string): string {
  const hex = createHash('sha256').update(value).digest('hex').slice(0, 32);
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    `5${hex.slice(13, 16)}`,
    `a${hex.slice(17, 20)}`,
    hex.slice(20, 32),
  ].join('-');
}
