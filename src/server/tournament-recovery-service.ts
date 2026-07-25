import { createHash } from 'node:crypto';
import type { TournamentInstanceStatusReason } from '@/lib/tournament/tournament-state';
import type { PokerDatabase } from './persistence/database';
import type { PromotionFundRepository } from './promotion-fund-repository';
import {
  TournamentInstanceRepository,
  type TournamentInstanceRecord,
} from './tournament-instance-repository';

export type RecoveryRefundReason = Extract<
  TournamentInstanceStatusReason,
  'server-restart-unrecoverable' | 'financial-invariant'
>;

export class TournamentRecoveryError extends Error {
  constructor(
    message: string,
    readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'TournamentRecoveryError';
  }
}

export interface RecoveryEntryExpectation {
  readonly economyEntryAttempt: number;
  readonly productVersion: number;
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
  readonly refundReasons: ReadonlyMap<string, RecoveryRefundReason>;
  readonly payoutInstanceIds: readonly string[];
}

export interface GenericRecoveryResult {
  readonly refunded: number;
  readonly failed: number;
  readonly preserved: number;
  readonly deferred: number;
}

export interface TournamentRecoveryPorts {
  loadAndValidate(): TournamentRecoveryPlan;
  recoverGeneric(options: Pick<
    TournamentRecoveryPlan,
    'preserveReservedMttEntries' | 'deferToMttVoidInstanceIds'
  >): GenericRecoveryResult;
  resumeRefund(instanceId: string, reason: RecoveryRefundReason): unknown;
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
    const generic = this.ports.recoverGeneric({
      preserveReservedMttEntries: plan.preserveReservedMttEntries,
      deferToMttVoidInstanceIds: plan.deferToMttVoidInstanceIds,
    });
    if (
      !Number.isSafeInteger(generic.failed)
      || generic.failed < 0
      || generic.failed > 0
    ) {
      throw new TournamentRecoveryError(
        `Generic economy recovery failed for ${generic.failed} entries`,
      );
    }
    for (const instanceId of plan.refundInstanceIds) {
      const reason = plan.refundReasons.get(instanceId);
      if (!reason) {
        throw new TournamentRecoveryError(
          `Missing refund classification for ${instanceId}`,
        );
      }
      this.ports.resumeRefund(instanceId, reason);
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
  readonly economy_mode: string;
  readonly config_json: string;
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
  const refundInstanceIds = new Set<string>();
  const refundReasons = new Map<string, RecoveryRefundReason>();
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
      refundInstanceIds.add(row.id);
      refundReasons.set(row.id, 'server-restart-unrecoverable');
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
      entry.fee,
      instance.economy_mode,
      instance.config_json
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
    const product = persistedWalletProduct(entry);
    if (
      !product
      || product.buyIn !== entry.buy_in
      || product.fee !== entry.fee
    ) {
      refundInstanceIds.add(entry.instance_id);
      refundReasons.set(entry.instance_id, 'financial-invariant');
      continue;
    }
    let byProfile = preserved.get(entry.instance_id);
    if (!byProfile) {
      byProfile = new Map();
      preserved.set(entry.instance_id, byProfile);
    }
    byProfile.set(entry.profile_id, {
      economyEntryAttempt: entry.economy_entry_attempt,
      productVersion: product.productVersion,
      buyIn: entry.buy_in,
      fee: entry.fee,
    });
  }

  return {
    preserveReservedMttEntries: preserved,
    // Generic orphan recovery must not touch either side of durable money
    // ownership. Refund and payout executors consume these rows afterward.
    deferToMttVoidInstanceIds: new Set([
      ...refundInstanceIds.values(),
      ...payoutInstanceIds,
    ]),
    refundInstanceIds: [...refundInstanceIds].sort(),
    refundReasons,
    payoutInstanceIds,
  };
}

export interface TournamentRefundRecoveryDependencies {
  readonly database: PokerDatabase;
  readonly instances: TournamentInstanceRepository;
  readonly funds: PromotionFundRepository;
  readonly voidWallet: (instanceId: string, at: number) => unknown;
}

export function resumeTournamentRefund(
  dependencies: TournamentRefundRecoveryDependencies,
  persisted: TournamentInstanceRecord,
  at: number,
  reason: RecoveryRefundReason = 'server-restart-unrecoverable',
): void {
  try {
    let instance = dependencies.instances.getInstance(persisted.id);
    if (!instance) {
      throw new TournamentRecoveryError(
        `Refund instance disappeared: ${persisted.id}`,
      );
    }
    if (instance.status !== 'refund-pending') {
      const claim = dependencies.instances.claimRefundPending(
        instance.id,
        reason,
        'startup-recovery',
      );
      if (claim.status === 'claimed') {
        instance = claim.instance;
      } else {
        const direct = dependencies.instances.claimDirectCancellation(
          instance.id,
          reason,
          'startup-recovery',
          at,
        );
        if (direct.status === 'claimed') return;
        throw new TournamentRecoveryError(
          `Tournament refund is not claimable: ${instance.id}`,
        );
      }
    }
    if (instance.economyMode === 'wallet') {
      dependencies.voidWallet(instance.id, at);
      terminateWalletRegistrations(dependencies.database, instance.id, at);
      dependencies.instances.finishCancellation(
        instance.id,
        instance.registrationGeneration,
        at,
      );
      return;
    }
    dependencies.funds.refundFreerollPrize({
      instanceId: instance.id,
      generation: instance.registrationGeneration,
      idempotencyKey: recoveryOperationUuid(
        `freeroll-refund:${instance.id}`,
      ),
      actor: { kind: 'system', id: 'startup-recovery' },
      at,
    });
  } catch (error) {
    if (error instanceof TournamentRecoveryError) throw error;
    throw new TournamentRecoveryError(
      `Tournament refund recovery failed: ${persisted.id}`,
      error,
    );
  }
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

function persistedWalletProduct(entry: PreservedEntryRow): {
  readonly productVersion: number;
  readonly buyIn: number;
  readonly fee: number;
} | null {
  if (entry.economy_mode !== 'wallet') return null;
  try {
    const config = JSON.parse(entry.config_json) as {
      economy?: {
        mode?: unknown;
        productVersion?: unknown;
        buyIn?: unknown;
        fee?: unknown;
      };
    };
    const economy = config.economy;
    if (
      economy?.mode !== 'wallet'
      || !isPositiveInteger(economy.productVersion)
      || !isPositiveInteger(economy.buyIn)
      || !isPositiveInteger(economy.fee)
    ) {
      return null;
    }
    return {
      productVersion: economy.productVersion,
      buyIn: economy.buyIn,
      fee: economy.fee,
    };
  } catch {
    return null;
  }
}

function terminateWalletRegistrations(
  database: PokerDatabase,
  instanceId: string,
  at: number,
): void {
  database.db.prepare(`
    UPDATE tournament_registration
    SET status = 'refunded', updated_at = ?
    WHERE instance_id = ?
      AND status IN (
        'registered',
        'seat-claimed',
        'late-pending',
        'seated',
        'eliminated',
        'finished'
      )
  `).run(at, instanceId);
  const active = database.db.prepare(`
    SELECT (
      SELECT COUNT(*) FROM tournament_registration
      WHERE instance_id = ?
        AND status IN (
          'registered', 'seat-claimed', 'late-pending', 'seated',
          'eliminated', 'finished'
        )
    ) + (
      SELECT COUNT(*) FROM tournament_registration_attempt
      WHERE instance_id = ?
        AND status IN (
          'registered', 'seat-claimed', 'late-pending', 'seated',
          'eliminated', 'finished'
        )
    ) AS count
  `).get(instanceId, instanceId) as { count: number };
  if (active.count !== 0) {
    throw new TournamentRecoveryError(
      `Tournament registrations remain active: ${instanceId}`,
    );
  }
}

function isPositiveInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) > 0;
}
