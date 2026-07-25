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

interface RecoveryEnrollmentLinkRow {
  readonly instance_id: string;
  readonly profile_id: string;
  readonly registration_status: string;
  readonly registration_attempt: number;
  readonly economy_entry_attempt: number | null;
  readonly attempt_status: string | null;
  readonly attempt_economy_entry_attempt: number | null;
  readonly entry_id: string | null;
  readonly entry_tournament_id: string | null;
  readonly entry_room_id: string | null;
  readonly entry_attempt: number | null;
  readonly entry_status: string | null;
  readonly buy_in: number | null;
  readonly fee: number | null;
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
  const links = database.db.prepare(`
    SELECT
      registration.instance_id,
      registration.profile_id,
      registration.status AS registration_status,
      registration.registration_attempt,
      registration.economy_entry_attempt,
      attempt.status AS attempt_status,
      attempt.economy_entry_attempt AS attempt_economy_entry_attempt,
      entry.id AS entry_id,
      entry.tournament_id AS entry_tournament_id,
      entry.room_id AS entry_room_id,
      entry.entry_attempt,
      entry.status AS entry_status,
      entry.buy_in,
      entry.fee,
      instance.economy_mode,
      instance.config_json
    FROM tournament_registration registration
    JOIN tournament_instance instance
      ON instance.id = registration.instance_id
    LEFT JOIN tournament_registration_attempt attempt
      ON attempt.instance_id = registration.instance_id
     AND attempt.profile_id = registration.profile_id
     AND attempt.registration_attempt = registration.registration_attempt
    LEFT JOIN sng_entries entry
      ON entry.tournament_id = registration.instance_id
     AND entry.profile_id = registration.profile_id
    WHERE instance.status IN (
      'scheduled-hidden',
      'scheduled-visible',
      'registering',
      'start-delayed'
    )
      AND instance.economy_mode = 'wallet'
      AND registration.status IN (
        'registered',
        'seat-claimed',
        'late-pending',
        'seated'
      )
    ORDER BY
      registration.instance_id,
      registration.profile_id,
      entry.entry_attempt,
      entry.id
  `).all() as unknown as RecoveryEnrollmentLinkRow[];
  const registrations = groupRecoveryLinks(links);
  for (const registration of registrations) {
    const first = registration[0]!;
    const product = persistedWalletProduct(first);
    const exactLinks = registration.filter(link => (
      link.entry_id !== null
      && link.entry_attempt === first.economy_entry_attempt
    ));
    const activeLinks = registration.filter(link => (
      link.entry_id !== null
      && (link.entry_status === 'reserved' || link.entry_status === 'started')
    ));
    const exact = exactLinks.length === 1 ? exactLinks[0]! : null;
    const coherent = (
      first.registration_status === 'registered'
      && first.economy_entry_attempt !== null
      && first.attempt_status === 'registered'
      && first.attempt_economy_entry_attempt === first.economy_entry_attempt
      && exact !== null
      && exact.entry_tournament_id === first.instance_id
      && exact.entry_room_id === first.instance_id
      && exact.entry_status === 'reserved'
      && activeLinks.length === 1
      && activeLinks[0]!.entry_id === exact.entry_id
      && product !== null
      && product.buyIn === exact.buy_in
      && product.fee === exact.fee
    );
    if (!coherent || !product || !exact) {
      refundInstanceIds.add(first.instance_id);
      refundReasons.set(first.instance_id, 'financial-invariant');
      continue;
    }
    let byProfile = preserved.get(first.instance_id);
    if (!byProfile) {
      byProfile = new Map();
      preserved.set(first.instance_id, byProfile);
    }
    byProfile.set(first.profile_id, {
      economyEntryAttempt: first.economy_entry_attempt!,
      productVersion: product.productVersion,
      buyIn: product.buyIn,
      fee: product.fee,
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
      terminateWalletRegistrations(dependencies.database, instance.id, at);
      dependencies.voidWallet(instance.id, at);
      assertNoActiveWalletLiability(dependencies.database, instance.id);
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

function persistedWalletProduct(entry: RecoveryEnrollmentLinkRow): {
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

function groupRecoveryLinks(
  links: readonly RecoveryEnrollmentLinkRow[],
): RecoveryEnrollmentLinkRow[][] {
  const grouped = new Map<string, RecoveryEnrollmentLinkRow[]>();
  for (const link of links) {
    const key = `${link.instance_id}\u0000${link.profile_id}`;
    const current = grouped.get(key);
    if (current) current.push(link);
    else grouped.set(key, [link]);
  }
  return [...grouped.values()];
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

function assertNoActiveWalletLiability(
  database: PokerDatabase,
  instanceId: string,
): void {
  const row = database.db.prepare(`
    SELECT (
      SELECT COUNT(*) FROM sng_entries
      WHERE tournament_id = ? AND status IN ('reserved', 'started')
    ) + (
      SELECT COUNT(*) FROM seat_escrows
      WHERE room_id = ? AND mode = 'sng' AND status = 'active'
    ) AS count
  `).get(instanceId, instanceId) as { count: number };
  if (row.count !== 0) {
    throw new TournamentRecoveryError(
      `Tournament wallet liability remains active: ${instanceId}`,
    );
  }
}

function isPositiveInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) > 0;
}
