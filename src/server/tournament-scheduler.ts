import { createHash } from 'node:crypto';
import type {
  TournamentConfigSnapshotV2,
  TournamentRecurrence,
} from '@/lib/tournament/tournament-config';
import type { PokerDatabase } from './persistence/database';
import {
  PromotionFundError,
  PromotionFundRepository,
} from './promotion-fund-repository';
import {
  TournamentInstanceRepository,
  type CreateInstanceCommand,
  type StartClaimSource,
  type TournamentActor,
  type TournamentInstanceRecord,
  type TournamentTemplateRecord,
} from './tournament-instance-repository';

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;
const WEEK_MS = 7 * DAY_MS;
const KST_OFFSET_MS = 9 * HOUR_MS;
const MATERIALIZED_OCCURRENCE_LIMIT = 5;
const MISSED_START_GRACE_MS = 10 * MINUTE_MS;
const START_LEASE_MS = 30_000;
const MAX_LIVE_TOURNAMENTS = 4;
const MAX_TIMER_DELAY_MS = 2_147_000_000;
const MIN_RETRY_DELAY_MS = 1_000;
const MAX_RETRY_DELAY_MS = 30_000;
const SYSTEM_ACTOR = { kind: 'system' as const, id: 'tournament-scheduler' };
const CREATED_BY: TournamentActor = {
  kind: 'system',
  profileId: null,
};

interface TemplateRow {
  readonly id: string;
  readonly revision: number;
  readonly idempotency_key: string;
  readonly name: string;
  readonly enabled: number;
  readonly timezone: string;
  readonly recurrence_json: string;
  readonly first_starts_at: number | null;
  readonly recurrence_ends_at: number | null;
  readonly visible_lead_ms: number;
  readonly registration_lead_ms: number;
  readonly config_json: string;
  readonly created_by_kind: string;
  readonly created_by_profile_id: string | null;
  readonly created_at: number;
  readonly updated_at: number;
}

interface DueRow {
  readonly id: string;
}

interface SchedulerTimer {
  readonly handle: ReturnType<typeof setTimeout>;
  readonly deadline: number;
}

export interface TournamentSchedulerOptions {
  readonly database: PokerDatabase;
  readonly clock?: () => number;
  readonly ownerId?: string;
  readonly startProcessingEnabled?: boolean;
  readonly onStartClaim?: (
    instance: TournamentInstanceRecord,
    source: StartClaimSource,
  ) => unknown;
  readonly onStartLeaseExpired?:
    (instance: TournamentInstanceRecord) => unknown;
  readonly onRefundPending?: (instance: TournamentInstanceRecord) => unknown;
  readonly onError?: (
    error: Error,
    context: {
      readonly phase: 'timer';
      readonly instanceId: string;
      readonly retryAttempt: number;
    },
  ) => unknown;
  readonly setTimer?: typeof setTimeout;
  readonly clearTimer?: typeof clearTimeout;
}

export interface DueReconciliationResult {
  readonly exposed: number;
  readonly opened: number;
  readonly startClaims: number;
  readonly cancelled: number;
}

export type TemplateGenerationResult =
  | { readonly status: 'generated'; readonly generated: number }
  | { readonly status: 'revision-conflict'; readonly actualRevision: number }
  | { readonly status: 'not-found' };

/**
 * Returns at most `limit` recurrences inside the operator-reviewed inclusive
 * boundaries.
 */
export function kstOccurrenceStarts(
  recurrence: TournamentRecurrence,
  now: number,
  firstStartsAt: number,
  recurrenceEndsAt: number,
  limit = MATERIALIZED_OCCURRENCE_LIMIT,
): number[] {
  assertTimestamp(now);
  assertTimestamp(firstStartsAt);
  assertTimestamp(recurrenceEndsAt);
  assertPositiveInteger(limit);
  if (recurrenceEndsAt < firstStartsAt) {
    throw new Error('Tournament recurrence end precedes first start');
  }
  const starts: number[] = [];
  let cursor = nextKstOccurrence(
    recurrence,
    Math.max(now, firstStartsAt),
  );
  while (cursor <= recurrenceEndsAt && starts.length < limit) {
    starts.push(cursor);
    cursor = nextKstOccurrence(recurrence, cursor + 1);
  }
  return starts;
}

export class TournamentScheduler {
  private readonly instances: TournamentInstanceRepository;
  private readonly funds: PromotionFundRepository;
  private readonly clock: () => number;
  private readonly ownerId: string;
  private readonly startProcessingEnabled: boolean;
  private readonly onStartClaim: (
    instance: TournamentInstanceRecord,
    source: StartClaimSource,
  ) => unknown;
  private readonly onStartLeaseExpired:
    (instance: TournamentInstanceRecord) => unknown;
  private readonly onRefundPending:
    (instance: TournamentInstanceRecord) => unknown;
  private readonly onError: NonNullable<TournamentSchedulerOptions['onError']>;
  private readonly setTimer: typeof setTimeout;
  private readonly clearTimer: typeof clearTimeout;
  private readonly timers = new Map<string, SchedulerTimer>();
  private readonly retryAttempts = new Map<string, number>();

  constructor(private readonly options: TournamentSchedulerOptions) {
    this.clock = options.clock ?? Date.now;
    this.ownerId = options.ownerId ?? `tournament-scheduler-${process.pid}`;
    this.startProcessingEnabled = options.startProcessingEnabled ?? false;
    if (
      this.startProcessingEnabled
      && (!options.onStartClaim || !options.onStartLeaseExpired)
    ) {
      throw new Error(
        'Start processing requires prepared-start and lease watchdog handlers',
      );
    }
    this.onStartClaim = options.onStartClaim ?? (() => undefined);
    this.onStartLeaseExpired =
      options.onStartLeaseExpired ?? (() => undefined);
    this.onRefundPending = options.onRefundPending ?? (() => undefined);
    this.onError = options.onError ?? ((error, context) => {
      console.error('[tournament-scheduler]', context, error);
    });
    this.setTimer = options.setTimer ?? setTimeout;
    this.clearTimer = options.clearTimer ?? clearTimeout;
    this.instances = new TournamentInstanceRepository(
      options.database,
      this.clock,
    );
    this.funds = new PromotionFundRepository(options.database);
  }

  reconcileTemplates(at = this.clock()): number {
    assertTimestamp(at);
    let created = 0;
    for (const template of this.listTemplates()) {
      if (!template.enabled) continue;
      const commands = this.occurrenceCommandsToFill(template, at);
      const previous = this.options.database.db.prepare(`
        SELECT DISTINCT template_revision AS revision
        FROM tournament_instance
        WHERE template_id = ?
          AND template_revision < ?
          AND status <> 'cancelled'
        ORDER BY template_revision
      `).all(template.id, template.revision) as unknown as Array<{
        revision: number;
      }>;
      if (previous.length > 0) {
        for (const row of previous) {
          const result = this.instances.replaceHiddenTemplateOccurrences(
            template.id,
            row.revision,
            commands,
            at,
          );
          created += result.createdIds.length;
        }
      }
      for (const command of commands) {
        const exists = this.options.database.db.prepare(`
          SELECT 1 FROM tournament_instance WHERE idempotency_key = ?
        `).get(command.idempotencyKey);
        if (exists) continue;
        const occupied = this.options.database.db.prepare(`
          SELECT 1
          FROM tournament_instance
          WHERE template_id = ? AND occurrence_key = ?
            AND (
              status <> 'cancelled'
              OR COALESCE(status_reason, '') <> 'template-superseded'
            )
        `).get(template.id, command.occurrenceKey);
        if (occupied) continue;
        this.instances.createInstance(command);
        created += 1;
      }
    }
    return created;
  }

  generateTemplateOccurrencesIfRevision(
    templateId: string,
    revision: number,
    at = this.clock(),
  ): TemplateGenerationResult {
    assertTimestamp(at);
    const result = this.instances.withTemplateRevisionLease(
      templateId,
      revision,
      template => {
        let generated = 0;
        const commands = this.occurrenceCommandsToFill(template, at);
        for (const command of commands) {
          const exists = this.options.database.db.prepare(`
            SELECT 1 FROM tournament_instance WHERE idempotency_key = ?
          `).get(command.idempotencyKey);
          if (exists) continue;
          const occupied = this.options.database.db.prepare(`
            SELECT 1
            FROM tournament_instance
            WHERE template_id = ? AND occurrence_key = ?
              AND (
                status <> 'cancelled'
                OR COALESCE(status_reason, '') <> 'template-superseded'
              )
          `).get(template.id, command.occurrenceKey);
          if (occupied) continue;
          this.instances.createInstance(command);
          generated += 1;
        }
        return generated;
      },
    );
    if (result.status !== 'leased') return result;
    return { status: 'generated', generated: result.value };
  }

  reconcileDue(at = this.clock()): DueReconciliationResult {
    assertTimestamp(at);
    let exposed = 0;
    let opened = 0;
    let startClaims = 0;
    let cancelled = 0;

    if (this.startProcessingEnabled) {
      const expiredLeases = this.options.database.db.prepare(`
        SELECT id FROM tournament_instance
        WHERE status = 'starting'
          AND start_owner_id IS NOT NULL
          AND start_lease_until IS NOT NULL
          AND start_lease_until <= ?
        ORDER BY start_lease_until, id
      `).all(at) as unknown as DueRow[];
      for (const row of expiredLeases) {
        const instance = this.instances.getInstance(row.id);
        if (
          instance?.status === 'starting'
          && instance.startLeaseUntil !== null
          && instance.startLeaseUntil <= at
        ) {
          this.onStartLeaseExpired(instance);
        }
      }
    }

    const hidden = this.options.database.db.prepare(`
      SELECT id FROM tournament_instance
      WHERE status = 'scheduled-hidden' AND visible_at <= ?
      ORDER BY visible_at, id
    `).all(at) as unknown as DueRow[];
    for (const row of hidden) {
      const instance = this.instances.getInstance(row.id);
      if (!instance || instance.status !== 'scheduled-hidden') continue;
      if (instance.economyMode === 'freeroll') {
        const prize = instance.config.prizePool;
        if (prize.kind !== 'promotion-funded') {
          this.cancelWithoutLiability(instance.id, 'invalid-config', at);
          cancelled += 1;
          continue;
        }
        try {
          this.funds.reserveFreerollPrize({
            instanceId: instance.id,
            amount: prize.totalPrize,
            idempotencyKey: uuidFromKey(`fund:${instance.id}`),
            actor: SYSTEM_ACTOR,
            at,
          });
          exposed += 1;
        } catch (error) {
          if (
            error instanceof PromotionFundError
            && (
              error.code === 'promotion-insufficient'
              || error.code === 'not-claimable'
            )
          ) {
            cancelled += error.code === 'promotion-insufficient' ? 1 : 0;
            continue;
          }
          throw error;
        }
      } else {
        const result = this.options.database.db.prepare(`
          UPDATE tournament_instance
          SET status = CASE
                WHEN registration_opens_at <= ? THEN 'registering'
                ELSE 'scheduled-visible'
              END,
              registration_state = CASE
                WHEN registration_opens_at <= ? THEN 'open-prestart'
                ELSE 'not-open'
              END,
              updated_at = ?
          WHERE id = ?
            AND status = 'scheduled-hidden'
            AND registration_state = 'not-open'
            AND visible_at <= ?
        `).run(at, at, at, instance.id, at);
        exposed += Number(result.changes);
      }
    }

    const visible = this.options.database.db.prepare(`
      SELECT id FROM tournament_instance
      WHERE status = 'scheduled-visible' AND registration_opens_at <= ?
      ORDER BY registration_opens_at, id
    `).all(at) as unknown as DueRow[];
    for (const row of visible) {
      const result = this.options.database.db.prepare(`
        UPDATE tournament_instance
        SET status = 'registering',
            registration_state = 'open-prestart',
            updated_at = ?
        WHERE id = ?
          AND status = 'scheduled-visible'
          AND registration_state = 'not-open'
          AND registration_opens_at <= ?
      `).run(at, row.id, at);
      opened += Number(result.changes);
    }

    const expiredManual = this.options.database.db.prepare(`
      SELECT id FROM tournament_instance
      WHERE status IN ('scheduled-hidden', 'scheduled-visible', 'registering')
        AND starts_at IS NULL
        AND manual_expires_at IS NOT NULL
        AND manual_expires_at <= ?
      ORDER BY manual_expires_at, id
    `).all(at) as unknown as DueRow[];
    for (const row of expiredManual) {
      if (this.cancelOrQueueRefund(row.id, 'not-enough', at)) cancelled += 1;
    }

    let active = this.liveTournamentCount();
    const scheduled = this.options.database.db.prepare(`
      SELECT id FROM tournament_instance
      WHERE starts_at IS NOT NULL
        AND starts_at <= ?
        AND (
          (
            status = 'registering'
            AND registration_state = 'open-prestart'
          )
          OR (
            status = 'start-delayed'
            AND registration_state = 'locked-for-start'
            AND next_retry_at IS NOT NULL
            AND next_retry_at <= ?
          )
        )
      ORDER BY starts_at, id
    `).all(at, at) as unknown as DueRow[];
    for (const row of scheduled) {
      const instance = this.instances.getInstance(row.id);
      if (
        !instance
        || (
          instance.status !== 'registering'
          && instance.status !== 'start-delayed'
        )
        || instance.schedule.startsAt === null
        || instance.schedule.startsAt > at
        || (
          instance.status === 'start-delayed'
          && (
            instance.nextRetryAt === null
            || instance.nextRetryAt > at
          )
        )
      ) {
        continue;
      }
      if (at - instance.schedule.startsAt > MISSED_START_GRACE_MS) {
        if (this.cancelOrQueueRefund(instance.id, 'missed-start', at)) {
          cancelled += 1;
        }
        continue;
      }
      if (!this.startProcessingEnabled) continue;
      if (active >= MAX_LIVE_TOURNAMENTS) break;
      const claim = this.instances.claimStart(
        instance.id,
        this.ownerId,
        safeAdd(at, START_LEASE_MS),
      );
      if (claim.status !== 'claimed') continue;
      active += 1;
      startClaims += 1;
      this.onStartClaim(claim.instance, claim.source);
    }

    return { exposed, opened, startClaims, cancelled };
  }

  reconcileAndHydrate(at = this.clock()): DueReconciliationResult {
    this.reconcileTemplates(at);
    const result = this.reconcileDue(at);
    this.hydrateTimers(at);
    return result;
  }

  hydrateTimers(at = this.clock()): void {
    assertTimestamp(at);
    const rows = this.options.database.db.prepare(`
      SELECT id, MIN(deadline) AS deadline
      FROM (
        SELECT id, visible_at AS deadline
        FROM tournament_instance
        WHERE status = 'scheduled-hidden'
        UNION ALL
        SELECT id, registration_opens_at AS deadline
        FROM tournament_instance
        WHERE status = 'scheduled-visible'
        UNION ALL
        SELECT id, starts_at AS deadline
        FROM tournament_instance
        WHERE status = 'registering' AND starts_at IS NOT NULL
        UNION ALL
        SELECT id, next_retry_at AS deadline
        FROM tournament_instance
        WHERE status = 'start-delayed' AND next_retry_at IS NOT NULL
        UNION ALL
        SELECT id, start_lease_until AS deadline
        FROM tournament_instance
        WHERE status = 'starting' AND start_lease_until IS NOT NULL
        UNION ALL
        SELECT id, manual_expires_at AS deadline
        FROM tournament_instance
        WHERE status IN ('scheduled-hidden', 'scheduled-visible', 'registering')
          AND manual_expires_at IS NOT NULL
      )
      GROUP BY id
    `).all() as unknown as Array<{ id: string; deadline: number }>;
    const wanted = new Set(rows.map(row => row.id));
    for (const [id, timer] of this.timers) {
      if (!wanted.has(id)) {
        this.clearTimer(timer.handle);
        this.timers.delete(id);
      }
    }
    for (const row of rows) {
      const existing = this.timers.get(row.id);
      if (existing?.deadline === row.deadline) continue;
      if (existing) this.clearTimer(existing.handle);
      const delay = Math.min(
        MAX_TIMER_DELAY_MS,
        Math.max(MIN_RETRY_DELAY_MS, row.deadline - at),
      );
      const handle = this.setTimer(() => this.runTimer(row.id), delay);
      this.timers.set(row.id, { handle, deadline: row.deadline });
    }
  }

  close(): void {
    for (const timer of this.timers.values()) {
      this.clearTimer(timer.handle);
    }
    this.timers.clear();
    this.retryAttempts.clear();
  }

  private runTimer(instanceId: string): void {
    this.timers.delete(instanceId);
    try {
      // A timer only wakes reconciliation. Every transition reloads the row,
      // checks its persisted deadline and uses a CAS update/claim.
      this.reconcileDue(this.clock());
      this.retryAttempts.delete(instanceId);
      this.hydrateTimers(this.clock());
    } catch (cause) {
      const error = cause instanceof Error ? cause : new Error(String(cause));
      const retryAttempt = (this.retryAttempts.get(instanceId) ?? 0) + 1;
      this.retryAttempts.set(instanceId, retryAttempt);
      try {
        this.onError(error, { phase: 'timer', instanceId, retryAttempt });
      } catch {
        // Diagnostic hooks cannot turn a contained timer failure into an
        // uncaught process exception.
      }
      const delay = Math.min(
        MAX_RETRY_DELAY_MS,
        MIN_RETRY_DELAY_MS * (2 ** Math.min(retryAttempt - 1, 10)),
      );
      const handle = this.setTimer(() => this.runTimer(instanceId), delay);
      this.timers.set(instanceId, {
        handle,
        deadline: safeAdd(this.clock(), delay),
      });
    }
  }

  private liveTournamentCount(): number {
    const row = this.options.database.db.prepare(`
      SELECT COUNT(*) AS count
      FROM tournament_instance
      WHERE status IN ('starting', 'running')
    `).get() as { count: number };
    return row.count;
  }

  private occurrenceCommandsToFill(
    template: TournamentTemplateRecord,
    at: number,
  ): CreateInstanceCommand[] {
    if (
      template.firstStartsAt === null
      || template.recurrenceEndsAt === null
    ) {
      if (!template.enabled) return [];
      throw new Error('Enabled tournament template has no recurrence boundary');
    }
    const active = this.options.database.db.prepare(`
      SELECT COUNT(*) AS count
      FROM tournament_instance
      WHERE template_id = ?
        AND template_revision = ?
        AND status NOT IN ('completed', 'cancelled')
    `).get(template.id, template.revision) as { count: number };
    let remaining = Math.max(
      0,
      MATERIALIZED_OCCURRENCE_LIMIT - active.count,
    );
    if (remaining === 0) return [];

    const commands: CreateInstanceCommand[] = [];
    let cursor = Math.max(at, template.firstStartsAt);
    let scanned = 0;
    for (; scanned < 100_000 && remaining > 0; scanned += 1) {
      const startsAt = nextKstOccurrence(template.recurrence, cursor);
      if (startsAt > template.recurrenceEndsAt) break;
      const occurrenceKey = String(startsAt);
      const occupied = this.options.database.db.prepare(`
        SELECT 1
        FROM tournament_instance
        WHERE template_id = ? AND occurrence_key = ?
          AND (
            status <> 'cancelled'
            OR COALESCE(status_reason, '') <> 'template-superseded'
          )
        LIMIT 1
      `).get(template.id, occurrenceKey);
      if (!occupied) {
        commands.push(occurrenceCommand(template, startsAt, at));
        remaining -= 1;
      }
      cursor = safeAdd(startsAt, 1);
    }
    if (remaining > 0 && scanned === 100_000) {
      throw new Error('Tournament recurrence scan is unbounded');
    }
    return commands;
  }

  private cancelOrQueueRefund(
    instanceId: string,
    reason: 'not-enough' | 'missed-start',
    at: number,
  ): boolean {
    const direct = this.instances.claimDirectCancellation(
      instanceId,
      reason,
      `${this.ownerId}-cancel`,
      at,
    );
    if (direct.status === 'claimed') return true;
    const refund = this.instances.claimRefundPending(
      instanceId,
      reason,
      `${this.ownerId}-refund`,
    );
    if (refund.status !== 'claimed') return false;
    this.onRefundPending(refund.instance);
    return true;
  }

  private cancelWithoutLiability(
    instanceId: string,
    reason: 'invalid-config',
    at: number,
  ): boolean {
    return this.instances.claimDirectCancellation(
      instanceId,
      reason,
      `${this.ownerId}-invalid`,
      at,
    ).status === 'claimed';
  }

  private listTemplates(): TournamentTemplateRecord[] {
    const rows = this.options.database.db.prepare(`
      SELECT * FROM tournament_template
      ORDER BY id
    `).all() as unknown as TemplateRow[];
    return rows.map(decodeTemplate);
  }
}

function nextKstOccurrence(
  recurrence: TournamentRecurrence,
  atOrAfter: number,
): number {
  assertTimestamp(atOrAfter);
  assertRecurrence(recurrence);
  const local = new Date(safeAdd(atOrAfter, KST_OFFSET_MS));
  let localCandidate: number;
  if (recurrence.kind === 'hourly') {
    localCandidate = Date.UTC(
      local.getUTCFullYear(),
      local.getUTCMonth(),
      local.getUTCDate(),
      local.getUTCHours(),
      recurrence.minute,
    );
    if (localCandidate - KST_OFFSET_MS < atOrAfter) {
      localCandidate = safeAdd(localCandidate, HOUR_MS);
    }
  } else if (recurrence.kind === 'daily') {
    localCandidate = Date.UTC(
      local.getUTCFullYear(),
      local.getUTCMonth(),
      local.getUTCDate(),
      recurrence.hour,
      recurrence.minute,
    );
    if (localCandidate - KST_OFFSET_MS < atOrAfter) {
      localCandidate = safeAdd(localCandidate, DAY_MS);
    }
  } else {
    const daysAhead = (
      recurrence.weekday - local.getUTCDay() + 7
    ) % 7;
    localCandidate = Date.UTC(
      local.getUTCFullYear(),
      local.getUTCMonth(),
      local.getUTCDate() + daysAhead,
      recurrence.hour,
      recurrence.minute,
    );
    if (localCandidate - KST_OFFSET_MS < atOrAfter) {
      localCandidate = safeAdd(localCandidate, WEEK_MS);
    }
  }
  const result = localCandidate - KST_OFFSET_MS;
  assertTimestamp(result);
  return result;
}

function occurrenceCommand(
  template: TournamentTemplateRecord,
  startsAt: number,
  createdAt: number,
): CreateInstanceCommand {
  const identity =
    `template:${template.id}:r${template.revision}:${startsAt}`;
  return {
    id: uuidFromKey(`instance:${identity}`),
    templateId: template.id,
    templateRevision: template.revision,
    idempotencyKey: identity,
    occurrenceKey: String(startsAt),
    schedule: {
      visibleAt: startsAt - template.visibleLeadMs,
      registrationOpensAt: startsAt - template.registrationLeadMs,
      startsAt,
      manualStartExpiresAt: null,
    },
    config: template.config,
    createdBy: CREATED_BY,
    directorProfileId: null,
    now: createdAt,
  };
}

function decodeTemplate(row: TemplateRow): TournamentTemplateRecord {
  if (
    row.timezone !== 'Asia/Seoul'
    || !Number.isSafeInteger(row.revision)
    || row.revision < 1
    || (row.enabled !== 0 && row.enabled !== 1)
  ) {
    throw new Error('Invalid persisted tournament template');
  }
  const recurrence = JSON.parse(row.recurrence_json) as TournamentRecurrence;
  assertRecurrence(recurrence);
  assertNonNegativeInteger(row.visible_lead_ms);
  assertNonNegativeInteger(row.registration_lead_ms);
  if (row.visible_lead_ms < row.registration_lead_ms) {
    throw new Error('Invalid persisted tournament template leads');
  }
  if (
    (row.first_starts_at === null) !== (row.recurrence_ends_at === null)
    || (
      row.first_starts_at === null
      && row.enabled === 1
    )
    || (
      row.first_starts_at !== null
      && row.recurrence_ends_at !== null
      && (
        !Number.isSafeInteger(row.first_starts_at)
        || row.first_starts_at < 0
        || !Number.isSafeInteger(row.recurrence_ends_at)
        || row.recurrence_ends_at < row.first_starts_at
      )
    )
  ) {
    throw new Error('Invalid persisted tournament template boundaries');
  }
  return {
    id: row.id,
    revision: row.revision,
    idempotencyKey: row.idempotency_key,
    name: row.name,
    enabled: row.enabled === 1,
    timezone: 'Asia/Seoul',
    recurrence,
    firstStartsAt: row.first_starts_at,
    recurrenceEndsAt: row.recurrence_ends_at,
    visibleLeadMs: row.visible_lead_ms,
    registrationLeadMs: row.registration_lead_ms,
    config: JSON.parse(row.config_json) as TournamentConfigSnapshotV2,
    createdBy: {
      kind: row.created_by_kind,
      profileId: row.created_by_profile_id,
    },
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function uuidFromKey(value: string): string {
  const hex = createHash('sha256').update(value).digest('hex').slice(0, 32);
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    `5${hex.slice(13, 16)}`,
    `a${hex.slice(17, 20)}`,
    hex.slice(20, 32),
  ].join('-');
}

function assertRecurrence(
  recurrence: TournamentRecurrence,
): asserts recurrence is TournamentRecurrence {
  if (
    recurrence.kind === 'hourly'
    && isMinute(recurrence.minute)
  ) return;
  if (
    recurrence.kind === 'daily'
    && isHour(recurrence.hour)
    && isMinute(recurrence.minute)
  ) return;
  if (
    recurrence.kind === 'weekly'
    && Number.isSafeInteger(recurrence.weekday)
    && recurrence.weekday >= 0
    && recurrence.weekday <= 6
    && isHour(recurrence.hour)
    && isMinute(recurrence.minute)
  ) return;
  throw new Error('Invalid tournament recurrence');
}

function isHour(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0 && value <= 23;
}

function isMinute(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0 && value <= 59;
}

function assertTimestamp(value: number): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error('Invalid tournament scheduler timestamp');
  }
}

function assertNonNegativeInteger(value: number): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error('Invalid tournament scheduler duration');
  }
}

function assertPositiveInteger(value: number): void {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new Error('Invalid tournament scheduler limit');
  }
}

function safeAdd(left: number, right: number): number {
  const result = left + right;
  assertTimestamp(result);
  return result;
}
