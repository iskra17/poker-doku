import { createHash } from 'node:crypto';
import type { PokerDatabase } from './persistence/database';
import {
  PAYOUT_TABLE_VERSIONS,
  computePayouts,
  payoutPercents,
} from '@/lib/poker/payout-table';
import type {
  PublicTournamentLifecycle,
  PublicTournamentSummary,
  TournamentDetailView,
  TournamentSummary,
} from '@/lib/realtime/protocol';
import {
  TEMPLATE_OCCURRENCE_LIMIT,
  type TournamentConfigSnapshotV2,
  type TournamentRecurrence,
  type TournamentSchedule,
} from '@/lib/tournament/tournament-config';
import type {
  RegistrationCloseReason,
  TournamentInstanceStatus,
  TournamentInstanceStatusReason,
  TournamentRegistrationState,
} from '@/lib/tournament/tournament-state';

type SqliteRow = Record<string, unknown>;

const MINUTE_MS = 60_000;
const DAY_MS = 24 * 60 * MINUTE_MS;
const WALLET_REGISTRATION_WINDOW_MS = 20 * MINUTE_MS;
const FREEROLL_MANUAL_WINDOW_MS = 6 * 60 * MINUTE_MS;
const MAX_VISIBLE_LEAD_MS = 30 * DAY_MS;
const MAX_FREEROLL_REGISTRATION_LEAD_MS = 7 * DAY_MS;

const INSTANCE_STATUSES: readonly TournamentInstanceStatus[] = [
  'scheduled-hidden',
  'scheduled-visible',
  'registering',
  'start-delayed',
  'starting',
  'running',
  'payout-pending',
  'refund-pending',
  'completed',
  'cancelled',
];
const REGISTRATION_STATES: readonly TournamentRegistrationState[] = [
  'not-open',
  'open-prestart',
  'locked-for-start',
  'open-late',
  'closing',
  'closed',
];
const STATUS_REASONS: readonly TournamentInstanceStatusReason[] = [
  'capacity',
  'restart-checkin-grace',
  'not-enough',
  'missed-start',
  'promotion-insufficient',
  'financial-invariant',
  'invalid-config',
  'template-superseded',
  'operator-cancel',
  'server-restart-unrecoverable',
  'start-economy-failed',
  'room-create-failed',
];
const CLOSE_REASONS: readonly RegistrationCloseReason[] = [
  'late-reg-disabled',
  'time',
  'full',
  'stack-floor',
  'bubble',
  'final-table',
  'last-player',
  'tournament-cancelled',
  'tournament-completed',
];
const DIRECT_CANCELLATION_REASONS = new Set<TournamentInstanceStatusReason>([
  'not-enough',
  'missed-start',
  'promotion-insufficient',
  'invalid-config',
  'template-superseded',
  'operator-cancel',
  'server-restart-unrecoverable',
  'start-economy-failed',
  'room-create-failed',
]);
const CANCELLABLE_STATUSES = new Set<TournamentInstanceStatus>([
  'scheduled-hidden',
  'scheduled-visible',
  'registering',
  'start-delayed',
  'starting',
  'running',
]);
const PUBLIC_STATUSES = new Set<TournamentInstanceStatus>([
  'scheduled-visible',
  'registering',
  'start-delayed',
  'starting',
  'running',
  'payout-pending',
  'refund-pending',
  'completed',
  'cancelled',
]);

export type TournamentPersistenceErrorCode =
  | 'INVALID_INPUT'
  | 'IDEMPOTENCY_CONFLICT'
  | 'PERSISTED_ROW_INVALID'
  | 'FINANCIAL_LIABILITY'
  | 'SETTLEMENT_CONFLICT';

export class TournamentPersistenceError extends Error {
  constructor(readonly code: TournamentPersistenceErrorCode) {
    super(code);
    this.name = 'TournamentPersistenceError';
  }
}

export interface TournamentActor {
  readonly kind: string;
  readonly profileId: string | null;
}

export interface CreateTemplateCommand {
  readonly id: string;
  readonly idempotencyKey: string;
  readonly name: string;
  readonly enabled: boolean;
  readonly timezone: 'Asia/Seoul';
  readonly recurrence: TournamentRecurrence;
  readonly firstStartsAt: number;
  readonly recurrenceEndsAt: number;
  readonly visibleLeadMs: number;
  readonly registrationLeadMs: number;
  readonly config: TournamentConfigSnapshotV2;
  readonly createdBy: TournamentActor;
  readonly now: number;
}

export interface TemplatePatch {
  readonly name?: string;
  readonly enabled?: boolean;
  readonly recurrence?: TournamentRecurrence;
  readonly firstStartsAt?: number;
  readonly recurrenceEndsAt?: number;
  readonly visibleLeadMs?: number;
  readonly registrationLeadMs?: number;
  readonly config?: TournamentConfigSnapshotV2;
  readonly updatedAt: number;
}

export interface TournamentTemplateRecord {
  readonly id: string;
  readonly revision: number;
  readonly idempotencyKey: string;
  readonly name: string;
  readonly enabled: boolean;
  readonly timezone: 'Asia/Seoul';
  readonly recurrence: TournamentRecurrence;
  readonly firstStartsAt: number | null;
  readonly recurrenceEndsAt: number | null;
  readonly visibleLeadMs: number;
  readonly registrationLeadMs: number;
  readonly config: TournamentConfigSnapshotV2;
  readonly createdBy: TournamentActor;
  readonly createdAt: number;
  readonly updatedAt: number;
}

export type TemplatePatchResult =
  | { readonly status: 'updated'; readonly record: TournamentTemplateRecord }
  | { readonly status: 'revision-conflict'; readonly actualRevision: number }
  | { readonly status: 'not-found' };

export type TemplateRevisionLeaseResult<T> =
  | { readonly status: 'leased'; readonly value: T }
  | { readonly status: 'revision-conflict'; readonly actualRevision: number }
  | { readonly status: 'not-found' };

export interface CreateInstanceCommand {
  readonly id: string;
  readonly templateId: string | null;
  readonly templateRevision: number | null;
  readonly idempotencyKey: string;
  readonly occurrenceKey: string;
  readonly schedule: TournamentSchedule;
  readonly config: TournamentConfigSnapshotV2;
  readonly createdBy: TournamentActor;
  readonly directorProfileId?: string | null;
  readonly now: number;
}

export interface TournamentInstanceRecord {
  readonly id: string;
  readonly templateId: string | null;
  readonly templateRevision: number | null;
  readonly idempotencyKey: string;
  readonly occurrenceKey: string;
  readonly schedule: TournamentSchedule;
  readonly status: TournamentInstanceStatus;
  readonly statusReason: TournamentInstanceStatusReason | null;
  readonly economyMode: 'freeroll' | 'wallet';
  readonly registrationState: TournamentRegistrationState;
  readonly registrationCloseReason: RegistrationCloseReason | null;
  readonly registrationGeneration: number;
  readonly registrationOwnerToken: string | null;
  readonly minEntrants: number;
  readonly maxEntrants: number;
  readonly initialEntrants: number | null;
  readonly initialBotEntrants: number | null;
  readonly committedEntrants: number | null;
  readonly pendingLateEntrants: number;
  readonly finalEntrants: number | null;
  readonly everMultiTable: boolean;
  readonly forfeitedChips: number;
  readonly payoutFreezeVersion: number | null;
  readonly payoutFreeze: unknown | null;
  readonly payoutFreezeAbortedAt: number | null;
  readonly config: TournamentConfigSnapshotV2;
  readonly createdBy: TournamentActor;
  readonly directorProfileId: string | null;
  readonly startAttempt: number;
  readonly nextRetryAt: number | null;
  readonly startOwnerId: string | null;
  readonly startLeaseUntil: number | null;
  readonly settlementAttempt: number;
  readonly settlementNextRetryAt: number | null;
  readonly settlementOwnerId: string | null;
  readonly settlementLeaseUntil: number | null;
  readonly actualStartedAt: number | null;
  readonly completedAt: number | null;
  readonly createdAt: number;
  readonly updatedAt: number;
}

export type StartClaim =
  | {
      readonly status: 'claimed';
      readonly ownerId: string;
      readonly startAttempt: number;
      readonly instance: TournamentInstanceRecord;
      readonly source: StartClaimSource;
    }
  | { readonly status: 'not-found' | 'not-claimable' };

export interface StartClaimSource {
  readonly status: 'registering' | 'start-delayed';
  readonly registrationState: 'open-prestart' | 'locked-for-start';
  readonly statusReason: TournamentInstanceStatusReason | null;
  readonly nextRetryAt: number | null;
}

export type CloseClaim =
  | {
      readonly status: 'claimed' | 'already-owned';
      readonly ownerToken: string;
      readonly generation: number;
      readonly instance: TournamentInstanceRecord;
    }
  | {
      readonly status: 'not-claimable';
      readonly ownerToken?: string;
      readonly generation?: number;
    }
  | { readonly status: 'not-found' };

export type RefundClaim =
  | {
      readonly status: 'claimed';
      readonly ownerToken: string;
      readonly claimGeneration: number;
      readonly instance: TournamentInstanceRecord;
    }
  | { readonly status: 'not-found' | 'not-claimable' };

export interface TournamentPayoutResult {
  readonly place: number;
  readonly playerId: string;
  readonly participantType: 'human' | 'bot';
  readonly profileId: string | null;
  readonly registrationAttempt: number | null;
  readonly displayName: string;
  readonly prize: number;
  readonly disposition: 'wallet-credit' | 'promotion-return' | 'none';
}

export interface TournamentPayoutFreezePlan {
  readonly version: number;
  readonly checksum: string;
  readonly prizePool: number;
  readonly fingerprint: string;
  readonly results: readonly TournamentPayoutResult[];
  readonly now: number;
}

export interface TournamentSettlementFingerprintInput {
  readonly instanceId: string;
  readonly configVersion: number;
  readonly payoutFreezeVersion: number;
  readonly payoutFreezeChecksum: string;
  readonly prizePool: number;
  readonly results: readonly TournamentPayoutResult[];
}

export type PayoutClaim =
  | {
      readonly status: 'claimed' | 'already-pending';
      readonly instance: TournamentInstanceRecord;
    }
  | { readonly status: 'not-found' | 'not-claimable' };

export type DirectCancellationClaim =
  | { readonly status: 'claimed'; readonly instance: TournamentInstanceRecord }
  | { readonly status: 'not-found' | 'not-claimable' };

export interface TemplateReconciliationResult {
  readonly supersededIds: string[];
  readonly createdIds: string[];
  readonly preservedIds: string[];
}

export type TournamentFundingProjection =
  | { readonly status: 'not-applicable'; readonly amount: null }
  | {
      readonly status: 'missing' | 'reserved' | 'settled' | 'refunded';
      readonly amount: number | null;
    };

export interface TournamentInstancePublicProjection {
  readonly id: string;
  readonly name: string;
  readonly status: TournamentInstanceStatus;
  readonly statusReason: TournamentInstanceStatusReason | null;
  readonly economyMode: 'freeroll' | 'wallet';
  readonly schedule: TournamentSchedule & { readonly actualStartedAt: number | null };
  readonly registrationState: TournamentRegistrationState;
  readonly registrationCloseReason: RegistrationCloseReason | null;
  readonly minEntrants: number;
  readonly maxEntrants: number;
  readonly acceptedEntrants: number;
  readonly pendingLateEntrants: number;
  readonly finalEntrants: number | null;
  readonly botFillToMinimum: boolean;
  readonly prizePool: number;
  readonly registered: boolean;
  readonly myRegistrationStatus: string | null;
  readonly funding: TournamentFundingProjection;
  readonly serverNow: number;
}

export interface TournamentPublicDetailView extends TournamentDetailView {
  readonly serverNow: number;
}

export interface TournamentInstanceAdminProjection
  extends TournamentInstancePublicProjection {
  readonly templateId: string | null;
  readonly templateRevision: number | null;
  readonly occurrenceKey: string;
  readonly registrationGeneration: number;
  readonly registrationOwnerToken: string | null;
  readonly startAttempt: number;
  readonly startOwnerId: string | null;
  readonly startLeaseUntil: number | null;
  readonly nextRetryAt: number | null;
  readonly settlementAttempt: number;
  readonly settlementOwnerId: string | null;
  readonly settlementLeaseUntil: number | null;
  readonly settlementNextRetryAt: number | null;
  readonly invariantWarnings: string[];
}

export class TournamentInstanceRepository {
  constructor(
    private readonly database: PokerDatabase,
    private readonly now: () => number = Date.now,
  ) {}

  createTemplate(command: CreateTemplateCommand): TournamentTemplateRecord {
    assertTemplateCommand(command);
    const existing = this.#templateByIdempotencyKey(command.idempotencyKey);
    if (existing) {
      if (!sameTemplateCreation(existing, command)) {
        throw new TournamentPersistenceError('IDEMPOTENCY_CONFLICT');
      }
      return existing;
    }

    try {
      this.database.db.prepare(`
        INSERT INTO tournament_template (
          id, revision, idempotency_key, name, enabled, timezone,
          recurrence_json, first_starts_at, recurrence_ends_at,
          visible_lead_ms, registration_lead_ms,
          config_version, config_json, created_by_kind,
          created_by_profile_id, created_at, updated_at
        ) VALUES (
          ?, 1, ?, ?, ?, 'Asia/Seoul', ?, ?, ?, ?, ?, 2, ?, ?, ?, ?, ?
        )
      `).run(
        command.id,
        command.idempotencyKey,
        command.name,
        command.enabled ? 1 : 0,
        canonicalJson(command.recurrence),
        command.firstStartsAt,
        command.recurrenceEndsAt,
        command.visibleLeadMs,
        command.registrationLeadMs,
        canonicalJson(command.config),
        command.createdBy.kind,
        command.createdBy.profileId,
        command.now,
        command.now,
      );
    } catch (error) {
      const raced = this.#templateByIdempotencyKey(command.idempotencyKey);
      if (raced && sameTemplateCreation(raced, command)) return raced;
      throw persistenceError(error);
    }
    return this.#requireTemplate(command.id);
  }

  patchTemplateIfRevision(
    id: string,
    revision: number,
    patch: TemplatePatch,
  ): TemplatePatchResult {
    assertIdentifier(id);
    assertPositiveInteger(revision);
    assertTimestamp(patch.updatedAt);
    const current = this.#templateById(id);
    if (!current) return { status: 'not-found' };
    if (current.revision !== revision) {
      return { status: 'revision-conflict', actualRevision: current.revision };
    }
    const next = {
      name: patch.name ?? current.name,
      enabled: patch.enabled ?? current.enabled,
      recurrence: patch.recurrence ?? current.recurrence,
      firstStartsAt: patch.firstStartsAt ?? current.firstStartsAt,
      recurrenceEndsAt: patch.recurrenceEndsAt ?? current.recurrenceEndsAt,
      visibleLeadMs: patch.visibleLeadMs ?? current.visibleLeadMs,
      registrationLeadMs:
        patch.registrationLeadMs ?? current.registrationLeadMs,
      config: patch.config ?? current.config,
    };
    assertTemplateMutableValues(next);
    const result = this.database.db.prepare(`
      UPDATE tournament_template
      SET revision = revision + 1,
          name = ?,
          enabled = ?,
          recurrence_json = ?,
          first_starts_at = ?,
          recurrence_ends_at = ?,
          visible_lead_ms = ?,
          registration_lead_ms = ?,
          config_version = 2,
          config_json = ?,
          updated_at = ?
      WHERE id = ? AND revision = ?
    `).run(
      next.name,
      next.enabled ? 1 : 0,
      canonicalJson(next.recurrence),
      next.firstStartsAt,
      next.recurrenceEndsAt,
      next.visibleLeadMs,
      next.registrationLeadMs,
      canonicalJson(next.config),
      patch.updatedAt,
      id,
      revision,
    );
    if (result.changes !== 1) {
      const raced = this.#templateById(id);
      return raced
        ? { status: 'revision-conflict', actualRevision: raced.revision }
        : { status: 'not-found' };
    }
    return { status: 'updated', record: this.#requireTemplate(id) };
  }

  withTemplateRevisionLease<T>(
    id: string,
    revision: number,
    work: (template: TournamentTemplateRecord) => T,
  ): TemplateRevisionLeaseResult<T> {
    assertIdentifier(id);
    assertPositiveInteger(revision);
    return this.database.transaction((): TemplateRevisionLeaseResult<T> => {
      const current = this.#templateById(id);
      if (!current) return { status: 'not-found' };
      if (current.revision !== revision) {
        return {
          status: 'revision-conflict',
          actualRevision: current.revision,
        };
      }
      return { status: 'leased', value: work(current) };
    });
  }

  createInstance(command: CreateInstanceCommand): TournamentInstanceRecord {
    assertInstanceCommand(command);
    const existing = this.#instanceByIdempotencyKey(command.idempotencyKey);
    if (existing) {
      if (!sameInstanceCreation(existing, command)) {
        throw new TournamentPersistenceError('IDEMPOTENCY_CONFLICT');
      }
      return existing;
    }
    if (command.templateId !== null) {
      const template = this.#templateById(command.templateId);
      const startsAt = command.schedule.startsAt;
      const expectedIdempotencyKey = startsAt === null
        ? null
        : `template:${template?.id}:r${template?.revision}:${startsAt}`;
      if (
        !template
        || template.revision !== command.templateRevision
        || startsAt === null
        || command.schedule.manualStartExpiresAt !== null
        || command.occurrenceKey !== String(startsAt)
        || command.idempotencyKey !== expectedIdempotencyKey
        || command.schedule.visibleAt !== startsAt - template.visibleLeadMs
        || command.schedule.registrationOpensAt
          !== startsAt - template.registrationLeadMs
        || canonicalJson(command.config) !== canonicalJson(template.config)
      ) {
        throw new TournamentPersistenceError('INVALID_INPUT');
      }
    } else if (command.occurrenceKey !== command.id) {
      throw new TournamentPersistenceError('INVALID_INPUT');
    }
    try {
      this.database.db.prepare(`
        INSERT INTO tournament_instance (
          id, template_id, template_revision, idempotency_key, occurrence_key,
          visible_at, registration_opens_at, starts_at, manual_expires_at,
          status, status_reason, economy_mode, registration_state,
          registration_close_reason, registration_generation,
          registration_owner_token, min_entrants, max_entrants,
          config_version, config_json, created_by_kind, created_by_profile_id,
          director_profile_id, created_at, updated_at
        ) VALUES (
          ?, ?, ?, ?, ?, ?, ?, ?, ?,
          'scheduled-hidden', NULL, ?, 'not-open',
          NULL, 0, NULL, ?, ?,
          2, ?, ?, ?, ?, ?, ?
        )
      `).run(
        command.id,
        command.templateId,
        command.templateRevision,
        command.idempotencyKey,
        command.occurrenceKey,
        command.schedule.visibleAt,
        command.schedule.registrationOpensAt,
        command.schedule.startsAt,
        command.schedule.manualStartExpiresAt,
        command.config.economy.mode,
        command.config.field.minEntrants,
        command.config.field.maxEntrants,
        canonicalJson(command.config),
        command.createdBy.kind,
        command.createdBy.profileId,
        command.directorProfileId ?? null,
        command.now,
        command.now,
      );
    } catch (error) {
      const raced = this.#instanceByIdempotencyKey(command.idempotencyKey);
      if (raced && sameInstanceCreation(raced, command)) return raced;
      throw persistenceError(error);
    }
    return this.#requireInstance(command.id);
  }

  replaceHiddenTemplateOccurrences(
    templateId: string,
    oldRevision: number,
    replacements: readonly CreateInstanceCommand[],
    now: number,
  ): TemplateReconciliationResult {
    assertIdentifier(templateId);
    assertPositiveInteger(oldRevision);
    assertTimestamp(now);
    for (const replacement of replacements) {
      assertInstanceCommand(replacement);
      if (
        replacement.templateId !== templateId
        || replacement.templateRevision === null
        || replacement.templateRevision <= oldRevision
      ) {
        throw new TournamentPersistenceError('INVALID_INPUT');
      }
    }

    return this.database.transaction((): TemplateReconciliationResult => {
      const supersededIds: string[] = [];
      const createdIds: string[] = [];
      const preservedIds: string[] = [];
      const oldRows = this.database.db.prepare(`
        SELECT id, occurrence_key
        FROM tournament_instance
        WHERE template_id = ?
          AND template_revision = ?
          AND status = 'scheduled-hidden'
          AND NOT EXISTS (
            SELECT 1 FROM tournament_registration registration
            WHERE registration.instance_id = tournament_instance.id
          )
          AND NOT EXISTS (
            SELECT 1 FROM tournament_prize_escrow escrow
            WHERE escrow.instance_id = tournament_instance.id
          )
          AND NOT EXISTS (
            SELECT 1 FROM sng_entries entry
            WHERE entry.tournament_id = tournament_instance.id
              AND entry.status IN ('reserved', 'started')
          )
        ORDER BY id
      `).all(templateId, oldRevision) as SqliteRow[];
      for (const row of oldRows) {
        const id = stringValue(row.id);
        const result = this.database.db.prepare(`
          UPDATE tournament_instance
          SET status = 'cancelled',
              status_reason = 'template-superseded',
              registration_state = 'closed',
              registration_close_reason = 'tournament-cancelled',
              registration_generation = registration_generation + 1,
              completed_at = ?,
              updated_at = ?
          WHERE id = ?
            AND template_revision = ?
            AND status = 'scheduled-hidden'
            AND registration_state = 'not-open'
            AND registration_generation = 0
            AND registration_owner_token IS NULL
            AND start_owner_id IS NULL
            AND start_lease_until IS NULL
            AND settlement_owner_id IS NULL
            AND settlement_lease_until IS NULL
        `).run(now, now, id, oldRevision);
        if (result.changes === 1) supersededIds.push(id);
      }

      for (const replacement of replacements) {
        const occupied = this.database.db.prepare(`
          SELECT id, status, template_revision
          FROM tournament_instance
          WHERE template_id = ? AND occurrence_key = ?
            AND (
              status <> 'cancelled'
              OR COALESCE(status_reason, '') <> 'template-superseded'
            )
          LIMIT 1
        `).get(templateId, replacement.occurrenceKey) as SqliteRow | undefined;
        if (occupied) {
          preservedIds.push(stringValue(occupied.id));
          continue;
        }
        const created = this.createInstance(replacement);
        createdIds.push(created.id);
      }
      return { supersededIds, createdIds, preservedIds };
    });
  }

  getInstance(id: string): TournamentInstanceRecord | null {
    assertIdentifier(id);
    const row = this.database.db.prepare(`
      SELECT * FROM tournament_instance WHERE id = ?
    `).get(id) as SqliteRow | undefined;
    return row ? decodeInstance(row) : null;
  }

  claimStart(
    instanceId: string,
    ownerId: string,
    leaseUntil: number,
  ): StartClaim {
    assertIdentifier(instanceId);
    assertIdentifier(ownerId);
    assertTimestamp(leaseUntil);
    return this.database.transaction((): StartClaim => {
      const current = this.getInstance(instanceId);
      if (!current) return { status: 'not-found' };
      const sourceValid = (
        current.status === 'registering'
        && current.registrationState === 'open-prestart'
      ) || (
        current.status === 'start-delayed'
        && current.registrationState === 'locked-for-start'
      );
      if (
        !sourceValid
        || current.startOwnerId !== null
        || current.startLeaseUntil !== null
      ) {
        return { status: 'not-claimable' };
      }
      const updatedAt = this.now();
      const result = this.database.db.prepare(`
        UPDATE tournament_instance
        SET status = 'starting',
            status_reason = NULL,
            registration_state = 'locked-for-start',
            start_attempt = start_attempt + 1,
            start_owner_id = ?,
            start_lease_until = ?,
            next_retry_at = NULL,
            updated_at = ?
        WHERE id = ?
          AND status = ?
          AND registration_state = ?
          AND registration_generation = ?
          AND registration_owner_token IS ?
          AND start_attempt = ?
          AND start_owner_id IS NULL
          AND start_lease_until IS NULL
      `).run(
        ownerId,
        leaseUntil,
        updatedAt,
        instanceId,
        current.status,
        current.registrationState,
        current.registrationGeneration,
        current.registrationOwnerToken,
        current.startAttempt,
      );
      if (result.changes !== 1) return { status: 'not-claimable' };
      const instance = this.#requireInstance(instanceId);
      return {
        status: 'claimed',
        ownerId,
        startAttempt: instance.startAttempt,
        instance,
        source: {
          status: current.status as StartClaimSource['status'],
          registrationState:
            current.registrationState as StartClaimSource['registrationState'],
          statusReason: current.statusReason,
          nextRetryAt: current.nextRetryAt,
        },
      };
    });
  }

  claimRegistrationClose(
    instanceId: string,
    ownerToken: string,
    reason: RegistrationCloseReason,
  ): CloseClaim {
    assertIdentifier(instanceId);
    assertIdentifier(ownerToken);
    if (!CLOSE_REASONS.includes(reason)) invalid();
    return this.database.transaction((): CloseClaim => {
      const current = this.getInstance(instanceId);
      if (!current) return { status: 'not-found' };
      if (
        current.status === 'running'
        && current.registrationState === 'closing'
      ) {
        return current.registrationOwnerToken === ownerToken
          ? {
              status: 'already-owned',
              ownerToken,
              generation: current.registrationGeneration,
              instance: current,
            }
          : {
              status: 'not-claimable',
              ownerToken: current.registrationOwnerToken ?? undefined,
              generation: current.registrationGeneration,
            };
      }
      if (
        current.status !== 'running'
        || current.registrationState !== 'open-late'
        || current.registrationOwnerToken !== null
      ) {
        return { status: 'not-claimable' };
      }
      const result = this.database.db.prepare(`
        UPDATE tournament_instance
        SET registration_state = 'closing',
            registration_close_reason = ?,
            registration_generation = registration_generation + 1,
            registration_owner_token = ?,
            updated_at = ?
        WHERE id = ?
          AND status = 'running'
          AND registration_state = 'open-late'
          AND registration_close_reason IS NULL
          AND registration_generation = ?
          AND registration_owner_token IS NULL
      `).run(
        reason,
        ownerToken,
        this.now(),
        instanceId,
        current.registrationGeneration,
      );
      if (result.changes !== 1) return { status: 'not-claimable' };
      const instance = this.#requireInstance(instanceId);
      return {
        status: 'claimed',
        ownerToken,
        generation: instance.registrationGeneration,
        instance,
      };
    });
  }

  claimRefundPending(
    instanceId: string,
    reason: TournamentInstanceStatusReason,
    ownerToken: string,
  ): RefundClaim {
    assertIdentifier(instanceId);
    assertIdentifier(ownerToken);
    if (!STATUS_REASONS.includes(reason)) invalid();
    return this.database.transaction((): RefundClaim => {
      let current = this.getInstance(instanceId);
      if (!current) return { status: 'not-found' };
      if (current.status === 'refund-pending') {
        return { status: 'not-claimable' };
      }
      if (!CANCELLABLE_STATUSES.has(current.status)) {
        return { status: 'not-claimable' };
      }
      if (
        reason !== 'financial-invariant'
        && !this.#hasFinancialLiability(instanceId)
      ) {
        return { status: 'not-claimable' };
      }

      if (current.registrationState === 'open-late') {
        const close = this.database.db.prepare(`
          UPDATE tournament_instance
          SET registration_state = 'closing',
              registration_close_reason = 'tournament-cancelled',
              registration_generation = registration_generation + 1,
              registration_owner_token = ?,
              updated_at = ?
          WHERE id = ?
            AND status = 'running'
            AND registration_state = 'open-late'
            AND registration_close_reason IS NULL
            AND registration_generation = ?
            AND registration_owner_token IS NULL
        `).run(
          ownerToken,
          this.now(),
          instanceId,
          current.registrationGeneration,
        );
        if (close.changes !== 1) {
          return { status: 'not-claimable' };
        }
        current = this.#requireInstance(instanceId);
      }
      if (
        current.registrationState === 'closing'
        && current.registrationOwnerToken !== ownerToken
      ) {
        return { status: 'not-claimable' };
      }

      if (current.economyMode === 'freeroll') {
        this.#terminateRegistrationsForCancellation(
          instanceId,
          'cancelled',
          this.now(),
          true,
        );
      }
      const closeGenerationIncrement = (
        current.registrationState === 'closing'
        || current.registrationState === 'closed'
      ) ? 0 : 1;
      const result = this.database.db.prepare(`
        UPDATE tournament_instance
        SET status = 'refund-pending',
            status_reason = ?,
            registration_state = 'closed',
            registration_close_reason = COALESCE(
              registration_close_reason,
              'tournament-cancelled'
            ),
            registration_generation = registration_generation + ?,
            registration_owner_token = NULL,
            pending_late_entrants = 0,
            start_owner_id = NULL,
            start_lease_until = NULL,
            next_retry_at = NULL,
            payout_freeze_aborted_at = CASE
              WHEN payout_freeze_version IS NOT NULL
              THEN COALESCE(payout_freeze_aborted_at, ?)
              ELSE NULL
            END,
            updated_at = ?
        WHERE id = ?
          AND status = ?
          AND registration_state = ?
          AND registration_generation = ?
          AND registration_owner_token IS ?
          AND pending_late_entrants = ?
          AND settlement_owner_id IS NULL
          AND settlement_lease_until IS NULL
      `).run(
        reason,
        closeGenerationIncrement,
        this.now(),
        this.now(),
        instanceId,
        current.status,
        current.registrationState,
        current.registrationGeneration,
        current.registrationOwnerToken,
        current.pendingLateEntrants,
      );
      if (result.changes !== 1) {
        throw new TournamentPersistenceError('PERSISTED_ROW_INVALID');
      }
      const instance = this.#requireInstance(instanceId);
      return {
        status: 'claimed',
        ownerToken,
        claimGeneration: instance.registrationGeneration,
        instance,
      };
    });
  }

  finishCancellation(
    instanceId: string,
    claimGeneration: number,
    completedAt: number,
  ): TournamentInstanceRecord {
    assertIdentifier(instanceId);
    assertPositiveInteger(claimGeneration);
    assertTimestamp(completedAt);
    const current = this.getInstance(instanceId);
    if (!current || current.status !== 'refund-pending') {
      throw new TournamentPersistenceError('INVALID_INPUT');
    }
    try {
      const result = this.database.db.prepare(`
        UPDATE tournament_instance
        SET status = 'cancelled', completed_at = ?, updated_at = ?
        WHERE id = ?
          AND status = 'refund-pending'
          AND registration_state = 'closed'
          AND registration_generation = ?
          AND registration_owner_token IS NULL
          AND start_owner_id IS NULL
          AND settlement_owner_id IS NULL
      `).run(
        completedAt,
        completedAt,
        instanceId,
        claimGeneration,
      );
      if (result.changes !== 1) {
        throw new TournamentPersistenceError('INVALID_INPUT');
      }
    } catch (error) {
      throw persistenceError(error, 'FINANCIAL_LIABILITY');
    }
    return this.#requireInstance(instanceId);
  }

  claimDirectCancellation(
    instanceId: string,
    reason: TournamentInstanceStatusReason,
    ownerToken: string,
    completedAt: number,
  ): DirectCancellationClaim {
    assertIdentifier(instanceId);
    assertIdentifier(ownerToken);
    assertTimestamp(completedAt);
    if (!DIRECT_CANCELLATION_REASONS.has(reason)) invalid();
    return this.database.transaction((): DirectCancellationClaim => {
      let current = this.getInstance(instanceId);
      if (!current) return { status: 'not-found' };
      if (!CANCELLABLE_STATUSES.has(current.status)) {
        return { status: 'not-claimable' };
      }
      if (this.#hasFinancialLiability(instanceId)) {
        return { status: 'not-claimable' };
      }
      if (current.registrationState === 'open-late') {
        const close = this.database.db.prepare(`
          UPDATE tournament_instance
          SET registration_state = 'closing',
              registration_close_reason = 'tournament-cancelled',
              registration_generation = registration_generation + 1,
              registration_owner_token = ?,
              updated_at = ?
          WHERE id = ?
            AND status = 'running'
            AND registration_state = 'open-late'
            AND registration_close_reason IS NULL
            AND registration_generation = ?
            AND registration_owner_token IS NULL
        `).run(
          ownerToken,
          completedAt,
          instanceId,
          current.registrationGeneration,
        );
        if (close.changes !== 1) {
          return { status: 'not-claimable' };
        }
        current = this.#requireInstance(instanceId);
      }
      if (
        current.registrationState === 'closing'
        && current.registrationOwnerToken !== ownerToken
      ) {
        return { status: 'not-claimable' };
      }
      this.#terminateRegistrationsForCancellation(
        instanceId,
        'cancelled',
        completedAt,
        false,
      );
      const generationIncrement = current.registrationState === 'closing' ? 0 : 1;
      const result = this.database.db.prepare(`
          UPDATE tournament_instance
          SET status = 'cancelled',
              status_reason = ?,
              registration_state = 'closed',
              registration_close_reason = COALESCE(
                registration_close_reason,
                'tournament-cancelled'
              ),
              registration_generation = registration_generation + ?,
              registration_owner_token = NULL,
              pending_late_entrants = 0,
              start_owner_id = NULL,
              start_lease_until = NULL,
              completed_at = ?,
              updated_at = ?
          WHERE id = ?
            AND status = ?
            AND registration_state = ?
            AND registration_generation = ?
            AND registration_owner_token IS ?
            AND pending_late_entrants = ?
            AND settlement_owner_id IS NULL
            AND settlement_lease_until IS NULL
      `).run(
          reason,
          generationIncrement,
          completedAt,
          completedAt,
          instanceId,
          current.status,
          current.registrationState,
          current.registrationGeneration,
          current.registrationOwnerToken,
          current.pendingLateEntrants,
      );
      if (result.changes !== 1) {
        throw new TournamentPersistenceError('PERSISTED_ROW_INVALID');
      }
      return { status: 'claimed', instance: this.#requireInstance(instanceId) };
    });
  }

  claimPayoutPending(
    instanceId: string,
    freeze: TournamentPayoutFreezePlan,
  ): PayoutClaim {
    assertIdentifier(instanceId);
    assertPayoutPlan(freeze);
    return this.database.transaction((): PayoutClaim => {
      const current = this.getInstance(instanceId);
      if (!current) return { status: 'not-found' };
      if (current.status === 'payout-pending') {
        const settlement = this.database.db.prepare(`
          SELECT fingerprint, payout_freeze_checksum, final_entrants, prize_pool
          FROM tournament_settlement
          WHERE instance_id = ?
        `).get(instanceId) as SqliteRow | undefined;
        if (
          settlement?.fingerprint === freeze.fingerprint
          && settlement.payout_freeze_checksum === freeze.checksum
          && settlement.final_entrants === freeze.results.length
          && settlement.prize_pool === freeze.prizePool
          && current.payoutFreezeVersion === freeze.version
          && current.payoutFreeze !== null
          && computeTournamentPayoutFreezeChecksum(current.payoutFreeze)
            === freeze.checksum
          && computeTournamentSettlementFingerprint({
            instanceId,
            configVersion: current.config.version,
            payoutFreezeVersion: freeze.version,
            payoutFreezeChecksum: freeze.checksum,
            prizePool: freeze.prizePool,
            results: freeze.results,
          }) === freeze.fingerprint
        ) {
          return { status: 'already-pending', instance: current };
        }
        throw new TournamentPersistenceError('SETTLEMENT_CONFLICT');
      }
      if (
        current.status !== 'running'
        || current.registrationState !== 'closed'
        || current.pendingLateEntrants !== 0
      ) {
        return { status: 'not-claimable' };
      }
      const finalEntrants = freeze.results.length;
      if (current.committedEntrants !== finalEntrants) {
        return { status: 'not-claimable' };
      }

      if (
        current.finalEntrants !== finalEntrants
        || current.payoutFreezeVersion !== freeze.version
        || current.payoutFreeze === null
      ) {
        throw new TournamentPersistenceError('SETTLEMENT_CONFLICT');
      }
      const persistedFreezeChecksum =
        computeTournamentPayoutFreezeChecksum(current.payoutFreeze);
      if (persistedFreezeChecksum !== freeze.checksum) {
        throw new TournamentPersistenceError('SETTLEMENT_CONFLICT');
      }
      const expectedFingerprint = computeTournamentSettlementFingerprint({
        instanceId,
        configVersion: current.config.version,
        payoutFreezeVersion: freeze.version,
        payoutFreezeChecksum: freeze.checksum,
        prizePool: freeze.prizePool,
        results: freeze.results,
      });
      if (expectedFingerprint !== freeze.fingerprint) {
        throw new TournamentPersistenceError('SETTLEMENT_CONFLICT');
      }

      const humanPayoutTotal = freeze.results
        .filter(result => result.participantType === 'human')
        .reduce((total, result) => total + result.prize, 0);
      const botReturnTotal = freeze.results
        .filter(result => result.participantType === 'bot')
        .reduce((total, result) => total + result.prize, 0);
      try {
        if (current.economyMode === 'wallet' && botReturnTotal !== 0) {
          throw new TournamentPersistenceError('SETTLEMENT_CONFLICT');
        }
        if (current.economyMode === 'freeroll') {
          const escrow = this.database.db.prepare(`
            SELECT amount, status, settlement_fingerprint
            FROM tournament_prize_escrow
            WHERE instance_id = ? AND account_id = 'global'
          `).get(instanceId) as SqliteRow | undefined;
          if (
            !escrow
            || integerValue(escrow.amount) !== freeze.prizePool
            || escrow.status !== 'reserved'
            || (
              escrow.settlement_fingerprint !== null
              && escrow.settlement_fingerprint !== freeze.fingerprint
            )
          ) {
            throw new TournamentPersistenceError('SETTLEMENT_CONFLICT');
          }
          const bind = this.database.db.prepare(`
            UPDATE tournament_prize_escrow
            SET settlement_fingerprint = ?, updated_at = ?
            WHERE instance_id = ?
              AND status = 'reserved'
              AND amount = ?
              AND (
                settlement_fingerprint IS NULL
                OR settlement_fingerprint = ?
              )
          `).run(
            freeze.fingerprint,
            freeze.now,
            instanceId,
            freeze.prizePool,
            freeze.fingerprint,
          );
          if (bind.changes !== 1) {
            throw new TournamentPersistenceError('SETTLEMENT_CONFLICT');
          }
        }
        this.database.db.prepare(`
          INSERT INTO tournament_settlement (
            instance_id, status, payout_freeze_checksum, final_entrants,
            prize_pool, human_payout_total, bot_return_total, fingerprint,
            created_at, settled_at, updated_at
          ) VALUES (?, 'pending', ?, ?, ?, ?, ?, ?, ?, NULL, ?)
        `).run(
          instanceId,
          freeze.checksum,
          finalEntrants,
          freeze.prizePool,
          humanPayoutTotal,
          botReturnTotal,
          freeze.fingerprint,
          freeze.now,
          freeze.now,
        );
        const insertResult = this.database.db.prepare(`
          INSERT INTO tournament_settlement_result (
            instance_id, place, player_id, participant_type, profile_id,
            registration_attempt, display_name_snapshot, prize, disposition
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);
        for (const result of freeze.results) {
          insertResult.run(
            instanceId,
            result.place,
            result.playerId,
            result.participantType,
            result.profileId,
            result.registrationAttempt,
            result.displayName,
            result.prize,
            result.disposition,
          );
        }
        const statusUpdate = this.database.db.prepare(`
          UPDATE tournament_instance
          SET status = 'payout-pending',
              settlement_attempt = settlement_attempt + 1,
              settlement_next_retry_at = NULL,
              updated_at = ?
          WHERE id = ?
            AND status = 'running'
            AND registration_state = 'closed'
            AND registration_generation = ?
            AND registration_owner_token IS NULL
            AND final_entrants = ?
            AND payout_freeze_version = ?
            AND payout_freeze_json IS NOT NULL
            AND pending_late_entrants = 0
            AND settlement_owner_id IS NULL
            AND settlement_lease_until IS NULL
        `).run(
          freeze.now,
          instanceId,
          current.registrationGeneration,
          finalEntrants,
          freeze.version,
        );
        if (statusUpdate.changes !== 1) {
          throw new TournamentPersistenceError('SETTLEMENT_CONFLICT');
        }
      } catch (error) {
        throw persistenceError(error, 'SETTLEMENT_CONFLICT');
      }
      return { status: 'claimed', instance: this.#requireInstance(instanceId) };
    });
  }

  getPublicProjection(
    instanceId: string,
    forPlayerId: string | undefined,
    now: number,
  ): TournamentPublicDetailView | null {
    assertIdentifier(instanceId);
    assertTimestamp(now);
    const row = this.#projectionRow(instanceId, forPlayerId);
    if (!row) return null;
    const instance = decodeInstance(row);
    const funding = decodeFunding(row, instance.economyMode);
    if (
      !PUBLIC_STATUSES.has(instance.status)
      || (
        instance.economyMode === 'freeroll'
        && !hasExactFreerollFunding(instance, funding)
      )
    ) {
      return null;
    }
    return {
      ...projectDetail(instance, row, funding, now),
      entrants: this.#publicEntrants(instanceId),
    };
  }

  listPublicProjections(
    forPlayerId: string | undefined,
    now: number,
  ): PublicTournamentSummary[] {
    assertTimestamp(now);
    const rows = this.database.db.prepare(`
      SELECT id, template_id
      FROM tournament_instance
      WHERE status <> 'scheduled-hidden'
      ORDER BY COALESCE(starts_at, manual_expires_at), id
    `).all() as SqliteRow[];
    // template_id stays internal to this filter: the public summary contract
    // does not expose which template produced an occurrence.
    const perTemplate = new Map<string, number>();
    return rows.flatMap(row => {
      const detail = this.getPublicProjection(
        stringValue(row.id),
        forPlayerId,
        now,
      );
      if (!detail) return [];
      const summary = detail.summary as PublicTournamentSummary;
      const templateId = nullableString(row.template_id);
      if (templateId === null) return [summary];
      const shown = perTemplate.get(templateId) ?? 0;
      if (shown < TEMPLATE_OCCURRENCE_LIMIT) {
        perTemplate.set(templateId, shown + 1);
        return [summary];
      }
      // Beyond the cap only the viewer's own engaged occurrence survives, so a
      // player never loses sight of a tournament they are already part of.
      return isEngagedRegistrationStatus(summary.myRegistrationStatus ?? null)
        ? [summary]
        : [];
    });
  }

  getAdminProjection(
    instanceId: string,
    now: number,
  ): TournamentInstanceAdminProjection | null {
    assertIdentifier(instanceId);
    assertTimestamp(now);
    const row = this.#projectionRow(instanceId, undefined);
    if (!row) return null;
    const instance = decodeInstance(row);
    const funding = decodeFunding(row, instance.economyMode);
    const warnings: string[] = [];
    if (
      instance.economyMode === 'freeroll'
      && instance.status !== 'scheduled-hidden'
      && instance.status !== 'cancelled'
      && !hasExactFreerollFunding(instance, funding)
    ) {
      warnings.push('PUBLIC_FREEROLL_NOT_RESERVED');
    }
    if (
      instance.economyMode === 'freeroll'
      && funding.status !== 'missing'
      && funding.amount !== (
        instance.config.prizePool.kind === 'promotion-funded'
          ? instance.config.prizePool.totalPrize
          : null
      )
    ) {
      warnings.push('PROMOTION_ESCROW_AMOUNT_MISMATCH');
    }
    if (
      instance.economyMode === 'wallet'
      && funding.status !== 'not-applicable'
    ) {
      warnings.push('WALLET_HAS_PROMOTION_ESCROW');
    }
    if (
      instance.status === 'starting'
      && instance.startLeaseUntil !== null
      && instance.startLeaseUntil < now
    ) {
      warnings.push('STALE_START_LEASE');
    }
    if (
      instance.status === 'payout-pending'
      && instance.settlementLeaseUntil !== null
      && instance.settlementLeaseUntil < now
    ) {
      warnings.push('STALE_SETTLEMENT_LEASE');
    }
    const publicFields = projectPublic(instance, row, funding, now);
    return {
      ...publicFields,
      templateId: instance.templateId,
      templateRevision: instance.templateRevision,
      occurrenceKey: instance.occurrenceKey,
      registrationGeneration: instance.registrationGeneration,
      registrationOwnerToken: instance.registrationOwnerToken,
      startAttempt: instance.startAttempt,
      startOwnerId: instance.startOwnerId,
      startLeaseUntil: instance.startLeaseUntil,
      nextRetryAt: instance.nextRetryAt,
      settlementAttempt: instance.settlementAttempt,
      settlementOwnerId: instance.settlementOwnerId,
      settlementLeaseUntil: instance.settlementLeaseUntil,
      settlementNextRetryAt: instance.settlementNextRetryAt,
      invariantWarnings: warnings,
    };
  }

  listAdminProjections(now: number): TournamentInstanceAdminProjection[] {
    assertTimestamp(now);
    const ids = this.database.db.prepare(`
      SELECT id FROM tournament_instance
      ORDER BY COALESCE(starts_at, manual_expires_at), id
    `).all() as SqliteRow[];
    return ids.flatMap(row => {
      const projection = this.getAdminProjection(stringValue(row.id), now);
      return projection ? [projection] : [];
    });
  }

  #terminateRegistrationsForCancellation(
    instanceId: string,
    targetStatus: 'cancelled' | 'refunded',
    updatedAt: number,
    includeFinished: boolean,
  ): void {
    this.database.assertTransactionActive();
    const activeStatuses: string[] = [
      'registered',
      'seat-claimed',
      'late-pending',
      'seated',
    ];
    if (includeFinished) activeStatuses.push('eliminated', 'finished');
    const placeholders = activeStatuses.map(() => '?').join(', ');
    this.database.db.prepare(`
      UPDATE tournament_registration
      SET status = ?, updated_at = ?
      WHERE instance_id = ?
        AND status IN (${placeholders})
    `).run(
      targetStatus,
      updatedAt,
      instanceId,
      ...activeStatuses,
    );
    const survivors = this.database.db.prepare(`
      SELECT (
        SELECT COUNT(*)
        FROM tournament_registration
        WHERE instance_id = ?
          AND status IN (${placeholders})
      ) + (
        SELECT COUNT(*)
        FROM tournament_registration_attempt
        WHERE instance_id = ?
          AND status IN (${placeholders})
      ) AS count
    `).get(
      instanceId,
      ...activeStatuses,
      instanceId,
      ...activeStatuses,
    ) as SqliteRow;
    if (integerValue(survivors.count) !== 0) {
      throw new TournamentPersistenceError('PERSISTED_ROW_INVALID');
    }
  }

  #templateById(id: string): TournamentTemplateRecord | null {
    const row = this.database.db.prepare(`
      SELECT * FROM tournament_template WHERE id = ?
    `).get(id) as SqliteRow | undefined;
    return row ? decodeTemplate(row) : null;
  }

  #templateByIdempotencyKey(key: string): TournamentTemplateRecord | null {
    const row = this.database.db.prepare(`
      SELECT * FROM tournament_template WHERE idempotency_key = ?
    `).get(key) as SqliteRow | undefined;
    return row ? decodeTemplate(row) : null;
  }

  #requireTemplate(id: string): TournamentTemplateRecord {
    const record = this.#templateById(id);
    if (!record) throw new TournamentPersistenceError('PERSISTED_ROW_INVALID');
    return record;
  }

  #instanceByIdempotencyKey(key: string): TournamentInstanceRecord | null {
    const row = this.database.db.prepare(`
      SELECT * FROM tournament_instance WHERE idempotency_key = ?
    `).get(key) as SqliteRow | undefined;
    return row ? decodeInstance(row) : null;
  }

  #requireInstance(id: string): TournamentInstanceRecord {
    const record = this.getInstance(id);
    if (!record) throw new TournamentPersistenceError('PERSISTED_ROW_INVALID');
    return record;
  }

  #hasFinancialLiability(instanceId: string): boolean {
    const row = this.database.db.prepare(`
      SELECT (
        EXISTS (
          SELECT 1 FROM tournament_prize_escrow
          WHERE instance_id = ? AND status = 'reserved'
        )
        OR EXISTS (
          SELECT 1 FROM sng_entries
          WHERE tournament_id = ? AND status IN ('reserved', 'started')
        )
      ) AS liability
    `).get(instanceId, instanceId) as SqliteRow;
    return integerValue(row.liability) === 1;
  }

  #publicEntrants(
    instanceId: string,
  ): Array<{ id: string; name: string; avatar: string }> {
    const rows = this.database.db.prepare(`
      SELECT public_player_json
      FROM tournament_registration
      WHERE instance_id = ?
        AND status NOT IN ('cancelled', 'no-show', 'refunded')
      ORDER BY registered_at, profile_id
    `).all(instanceId) as SqliteRow[];
    return rows.map(row => {
      const player = parseJson(row.public_player_json);
      if (
        !isRecord(player)
        || typeof player.id !== 'string'
        || typeof player.name !== 'string'
        || typeof player.avatar !== 'string'
      ) {
        persistedInvalid();
      }
      return {
        id: player.id,
        name: player.name,
        avatar: player.avatar,
      };
    });
  }

  #projectionRow(
    instanceId: string,
    forPlayerId: string | undefined,
  ): SqliteRow | null {
    const row = this.database.db.prepare(`
      SELECT
        instance.*,
        escrow.status AS funding_status,
        escrow.amount AS funding_amount,
        (
          SELECT COUNT(*)
          FROM tournament_registration registration
          WHERE registration.instance_id = instance.id
            AND registration.status IN (
              'registered', 'seat-claimed',
              'seated', 'eliminated', 'finished'
            )
        ) AS accepted_entrants,
        (
          SELECT COUNT(*)
          FROM tournament_registration seated
          WHERE seated.instance_id = instance.id
            AND seated.status = 'seated'
        ) AS alive_seated,
        registration.status AS my_registration_status,
        registration.ever_seated AS my_ever_seated
      FROM tournament_instance instance
      LEFT JOIN tournament_prize_escrow escrow
        ON escrow.instance_id = instance.id
      LEFT JOIN tournament_registration registration
        ON registration.instance_id = instance.id
       AND registration.profile_id IS ?
      WHERE instance.id = ?
    `).get(forPlayerId ?? null, instanceId) as SqliteRow | undefined;
    return row ?? null;
  }
}

function projectPublic(
  instance: TournamentInstanceRecord,
  row: SqliteRow,
  funding: TournamentFundingProjection,
  now: number,
): TournamentInstancePublicProjection {
  const acceptedEntrants = integerValue(row.accepted_entrants);
  const myRegistrationStatus = nullableString(row.my_registration_status);
  const registered = isActiveRegistrationStatus(myRegistrationStatus);
  return {
    id: instance.id,
    name: instance.config.name,
    status: instance.status,
    statusReason: instance.statusReason,
    economyMode: instance.economyMode,
    schedule: {
      ...instance.schedule,
      actualStartedAt: instance.actualStartedAt,
    },
    registrationState: instance.registrationState,
    registrationCloseReason: instance.registrationCloseReason,
    minEntrants: instance.minEntrants,
    maxEntrants: instance.maxEntrants,
    acceptedEntrants,
    pendingLateEntrants: instance.pendingLateEntrants,
    finalEntrants: instance.finalEntrants,
    botFillToMinimum: instance.config.field.botFillToMinimum,
    prizePool: instance.config.prizePool.kind === 'promotion-funded'
      ? instance.config.prizePool.totalPrize
      : acceptedEntrants * (
          instance.config.economy.mode === 'wallet'
            ? instance.config.economy.buyIn
            : 0
        ),
    registered,
    myRegistrationStatus,
    funding,
    serverNow: now,
  };
}

function projectDetail(
  instance: TournamentInstanceRecord,
  row: SqliteRow,
  funding: TournamentFundingProjection,
  now: number,
): TournamentPublicDetailView {
  const projection = projectPublic(instance, row, funding, now);
  const lifecycle = publicLifecycle(instance.status);
  const aliveSeated = integerValue(row.alive_seated);
  const entrantBasis = Math.max(
    2,
    instance.finalEntrants
      ?? instance.committedEntrants
      ?? (
        projection.acceptedEntrants > 0
          ? projection.acceptedEntrants
          : instance.minEntrants
      ),
  );
  const totalPrize = projection.prizePool;
  const payoutAmounts = computePayouts(
    totalPrize,
    entrantBasis,
    instance.config.payout.presetId,
    instance.config.payout.tableVersion,
  );
  const percents = payoutPercents(
    entrantBasis,
    instance.config.payout.presetId,
    instance.config.payout.tableVersion,
  );
  const payoutRows = payoutAmounts.map((amount, index) => ({
    place: index + 1,
    percent: percents[index],
    amount,
  }));
  const myStatus = projection.myRegistrationStatus as
    | TournamentSummary['myRegistrationStatus'];
  const myEverSeated = row.my_ever_seated === null
    ? false
    : booleanInteger(row.my_ever_seated);
  const mayCreateAttempt = (
    myStatus === null
    || (
      !myEverSeated
      && (
        myStatus === 'cancelled'
        || myStatus === 'no-show'
        || myStatus === 'refunded'
      )
    )
  );
  const capacityAvailable = (
    projection.acceptedEntrants + projection.pendingLateEntrants
    < instance.maxEntrants
  );
  const preStartDeadline = instance.schedule.startsAt
    ?? instance.schedule.manualStartExpiresAt;
  const preStartWindowOpen = (
    now >= instance.schedule.registrationOpensAt
    && preStartDeadline !== null
    && now < preStartDeadline
  );
  const lateClosesAt = lateRegistrationClosesAt(instance);
  const canRegister = (
    mayCreateAttempt
    && capacityAvailable
    && (
      (
        instance.status === 'registering'
        && instance.registrationState === 'open-prestart'
        && preStartWindowOpen
      )
      || (
        instance.status === 'running'
        && instance.registrationState === 'open-late'
        && lateClosesAt !== null
        && now < lateClosesAt
      )
    )
  );
  const canCancelRegistration = (
    myStatus === 'registered'
    && (
      instance.status === 'registering'
      || instance.status === 'start-delayed'
    )
  );
  const sourcePresetId = instance.config.structure.sourcePresetId;
  const speed = sourcePresetId ?? 'standard';
  const firstLevel = instance.config.structure.segments.find(
    segment => segment.kind === 'level',
  );
  const levelDurationMs = firstLevel?.durationMs ?? 0;
  const summary: TournamentSummary = {
    id: instance.id,
    name: instance.config.name,
    lifecycle,
    statusReason: instance.statusReason,
    phase: legacyPhase(lifecycle),
    speed,
    entrantCount: projection.acceptedEntrants,
    maxEntrants: instance.maxEntrants,
    tableSize: instance.config.tableSize,
    remaining: instance.status === 'running'
      ? aliveSeated
      : projection.acceptedEntrants,
    tableCount: instance.status === 'running'
      ? Math.ceil(aliveSeated / instance.config.tableSize)
      : 0,
    prizePool: totalPrize,
    startAt: instance.schedule.startsAt,
    startedAt: instance.actualStartedAt,
    botFill: instance.config.field.botFillToMinimum,
    hostId: '',
    level: 1,
    paused: false,
    economyMode: instance.economyMode,
    entryBuyIn: instance.config.economy.mode === 'wallet'
      ? instance.config.economy.buyIn
      : 0,
    entryFee: instance.config.economy.mode === 'wallet'
      ? instance.config.economy.fee
      : 0,
    registered: projection.registered,
    payoutPreset: instance.config.payout.presetId,
    schedule: {
      visibleAt: instance.schedule.visibleAt,
      registrationOpensAt: instance.schedule.registrationOpensAt,
      scheduledStartsAt: instance.schedule.startsAt,
      manualStartExpiresAt: instance.schedule.manualStartExpiresAt,
      actualStartedAt: instance.actualStartedAt,
    },
    structure: {
      sourcePresetId,
      startingStack: instance.config.structure.startingStack,
      segments: instance.config.structure.segments,
      currentSegmentIndex: null,
      currentSegmentEndsAt: null,
    },
    payout: {
      tableVersion: instance.config.payout.tableVersion,
      presetId: instance.config.payout.presetId,
      paidFieldPercent: instance.config.payout.paidFieldPercent,
      status: instance.finalEntrants === null ? 'provisional' : 'final',
      totalPrize,
      payouts: payoutRows,
      fundingStatus: payoutFundingStatus(instance),
    },
    registrationState: instance.registrationState,
    registrationCloseReason: instance.registrationCloseReason,
    lateRegistrationClosesAt: lateClosesAt,
    minEntrants: instance.minEntrants,
    initialEntrants: instance.initialEntrants ?? 0,
    acceptedEntrants: projection.acceptedEntrants,
    pendingLateEntrants: instance.pendingLateEntrants,
    aliveSeated,
    finalEntrants: instance.finalEntrants,
    botFillToMinimum: instance.config.field.botFillToMinimum,
    myRegistrationStatus: myStatus,
    mySeat: null,
    canRegister,
    canCancelRegistration,
  };
  return {
    serverNow: now,
    summary,
    levels: instance.config.structure.segments.flatMap(segment => (
      segment.kind === 'level'
        ? [{
            level: 0,
            smallBlind: segment.smallBlind,
            bigBlind: segment.bigBlind,
            ante: segment.bigBlindAnte,
          }]
        : []
    )).map((level, index) => ({ ...level, level: index + 1 })),
    levelDurationMs,
    payouts: payoutAmounts.map((prize, index) => ({
      place: index + 1,
      prize,
    })),
    entrants: [],
    standings: [],
    clock: null,
  };
}

function publicLifecycle(
  status: TournamentInstanceStatus,
): PublicTournamentLifecycle {
  if (status === 'scheduled-hidden' || status === 'scheduled-visible') {
    return 'upcoming';
  }
  return status;
}

function isActiveRegistrationStatus(status: string | null): boolean {
  return status === 'registered'
    || status === 'seat-claimed'
    || status === 'late-pending'
    || status === 'seated';
}

/**
 * Lobby engagement is broader than active registration: a viewer who already
 * busted or finished still needs the row to read their result. Keep this
 * separate from isActiveRegistrationStatus, which drives the `registered`
 * boolean and must not treat a finished entry as still registered.
 */
function isEngagedRegistrationStatus(status: string | null): boolean {
  return isActiveRegistrationStatus(status)
    || status === 'eliminated'
    || status === 'finished';
}

/**
 * 공개 lifecycle → 구 `phase` 어댑터. 목록 투영이 쓰는 것과 **같은 매핑**을 상세 폴백
 * (socket-handler `persistentTournamentDetail`)도 써야 목록/상세가 어긋나지 않는다.
 */
export function legacyPhase(
  lifecycle: PublicTournamentLifecycle,
): TournamentSummary['phase'] {
  if (
    lifecycle === 'upcoming'
    || lifecycle === 'registering'
    || lifecycle === 'start-delayed'
    || lifecycle === 'starting'
  ) {
    return 'registering';
  }
  if (
    lifecycle === 'running'
    || lifecycle === 'payout-pending'
    || lifecycle === 'refund-pending'
  ) {
    return 'running';
  }
  return lifecycle;
}

function payoutFundingStatus(
  instance: TournamentInstanceRecord,
): NonNullable<TournamentSummary['payout']>['fundingStatus'] {
  if (instance.status === 'payout-pending') return 'payout-pending';
  if (instance.status === 'completed') return 'settled';
  return instance.economyMode === 'wallet'
    ? 'entry-funded'
    : 'promotion-reserved';
}

function lateRegistrationClosesAt(
  instance: TournamentInstanceRecord,
): number | null {
  if (
    instance.actualStartedAt === null
    || !instance.config.lateRegistration.enabled
  ) {
    return null;
  }
  let levels = 0;
  let duration = 0;
  for (const segment of instance.config.structure.segments) {
    duration += segment.durationMs;
    if (segment.kind === 'level') levels += 1;
    if (levels >= instance.config.lateRegistration.durationLevels) break;
  }
  return instance.actualStartedAt + duration;
}

function decodeFunding(
  row: SqliteRow,
  economyMode: 'freeroll' | 'wallet',
): TournamentFundingProjection {
  if (economyMode === 'wallet') {
    return { status: 'not-applicable', amount: null };
  }
  const status = nullableString(row.funding_status);
  if (status === null) return { status: 'missing', amount: null };
  if (!['reserved', 'settled', 'refunded'].includes(status)) persistedInvalid();
  return {
    status: status as 'reserved' | 'settled' | 'refunded',
    amount: nullableInteger(row.funding_amount),
  };
}

function hasExactFreerollFunding(
  instance: TournamentInstanceRecord,
  funding: TournamentFundingProjection,
): boolean {
  const expectedStatus = instance.status === 'completed'
    ? 'settled'
    : 'reserved';
  return instance.config.prizePool.kind === 'promotion-funded'
    && funding.status === expectedStatus
    && funding.amount === instance.config.prizePool.totalPrize;
}

function decodeTemplate(row: SqliteRow): TournamentTemplateRecord {
  try {
    const timezone = stringValue(row.timezone);
    if (timezone !== 'Asia/Seoul') persistedInvalid();
    const recurrence = parseJson(row.recurrence_json);
    assertRecurrence(recurrence);
    const config = parseJson(row.config_json);
    assertConfig(config);
    if (integerValue(row.config_version) !== config.version) persistedInvalid();
    const enabled = booleanInteger(row.enabled);
    const firstStartsAt = nullableInteger(row.first_starts_at);
    const recurrenceEndsAt = nullableInteger(row.recurrence_ends_at);
    if (
      (firstStartsAt !== null && firstStartsAt < 0)
      || (recurrenceEndsAt !== null && recurrenceEndsAt < 0)
      || (
        firstStartsAt !== null
        && recurrenceEndsAt !== null
        && firstStartsAt > recurrenceEndsAt
      )
      || (enabled && (firstStartsAt === null || recurrenceEndsAt === null))
    ) {
      persistedInvalid();
    }
    return {
      id: stringValue(row.id),
      revision: positiveIntegerValue(row.revision),
      idempotencyKey: stringValue(row.idempotency_key),
      name: stringValue(row.name),
      enabled,
      timezone,
      recurrence,
      firstStartsAt,
      recurrenceEndsAt,
      visibleLeadMs: nonNegativeIntegerValue(row.visible_lead_ms),
      registrationLeadMs: nonNegativeIntegerValue(row.registration_lead_ms),
      config,
      createdBy: {
        kind: stringValue(row.created_by_kind),
        profileId: nullableString(row.created_by_profile_id),
      },
      createdAt: nonNegativeIntegerValue(row.created_at),
      updatedAt: nonNegativeIntegerValue(row.updated_at),
    };
  } catch (error) {
    if (error instanceof TournamentPersistenceError) throw error;
    persistedInvalid();
  }
}

function decodeInstance(row: SqliteRow): TournamentInstanceRecord {
  try {
    const config = parseJson(row.config_json);
    assertConfig(config);
    const economyMode = stringValue(row.economy_mode);
    if (
      (economyMode !== 'freeroll' && economyMode !== 'wallet')
      || config.economy.mode !== economyMode
      || integerValue(row.config_version) !== config.version
      || integerValue(row.min_entrants) !== config.field.minEntrants
      || integerValue(row.max_entrants) !== config.field.maxEntrants
    ) {
      persistedInvalid();
    }
    const status = stringValue(row.status);
    const registrationState = stringValue(row.registration_state);
    if (
      !INSTANCE_STATUSES.includes(status as TournamentInstanceStatus)
      || !REGISTRATION_STATES.includes(
        registrationState as TournamentRegistrationState,
      )
    ) {
      persistedInvalid();
    }
    const reason = nullableString(row.status_reason);
    if (
      reason !== null
      && !STATUS_REASONS.includes(reason as TournamentInstanceStatusReason)
    ) {
      persistedInvalid();
    }
    const closeReason = nullableString(row.registration_close_reason);
    if (
      closeReason !== null
      && !CLOSE_REASONS.includes(closeReason as RegistrationCloseReason)
    ) {
      persistedInvalid();
    }
    const templateId = nullableString(row.template_id);
    const templateRevision = nullableInteger(row.template_revision);
    if ((templateId === null) !== (templateRevision === null)) persistedInvalid();
    const startsAt = nullableInteger(row.starts_at);
    const manualStartExpiresAt = nullableInteger(row.manual_expires_at);
    if ((startsAt === null) === (manualStartExpiresAt === null)) persistedInvalid();
    return {
      id: stringValue(row.id),
      templateId,
      templateRevision,
      idempotencyKey: stringValue(row.idempotency_key),
      occurrenceKey: stringValue(row.occurrence_key),
      schedule: {
        visibleAt: nonNegativeIntegerValue(row.visible_at),
        registrationOpensAt:
          nonNegativeIntegerValue(row.registration_opens_at),
        startsAt,
        manualStartExpiresAt,
      },
      status: status as TournamentInstanceStatus,
      statusReason: reason as TournamentInstanceStatusReason | null,
      economyMode,
      registrationState: registrationState as TournamentRegistrationState,
      registrationCloseReason: closeReason as RegistrationCloseReason | null,
      registrationGeneration:
        nonNegativeIntegerValue(row.registration_generation),
      registrationOwnerToken: nullableString(row.registration_owner_token),
      minEntrants: positiveIntegerValue(row.min_entrants),
      maxEntrants: positiveIntegerValue(row.max_entrants),
      initialEntrants: nullableInteger(row.initial_entrants),
      initialBotEntrants: nullableInteger(row.initial_bot_entrants),
      committedEntrants: nullableInteger(row.committed_entrants),
      pendingLateEntrants:
        nonNegativeIntegerValue(row.pending_late_entrants),
      finalEntrants: nullableInteger(row.final_entrants),
      everMultiTable: booleanInteger(row.ever_multi_table),
      forfeitedChips: nonNegativeIntegerValue(row.forfeited_chips),
      payoutFreezeVersion: nullableInteger(row.payout_freeze_version),
      payoutFreeze: row.payout_freeze_json === null
        ? null
        : parseJson(row.payout_freeze_json),
      payoutFreezeAbortedAt: nullableInteger(row.payout_freeze_aborted_at),
      config,
      createdBy: {
        kind: stringValue(row.created_by_kind),
        profileId: nullableString(row.created_by_profile_id),
      },
      directorProfileId: nullableString(row.director_profile_id),
      startAttempt: nonNegativeIntegerValue(row.start_attempt),
      nextRetryAt: nullableInteger(row.next_retry_at),
      startOwnerId: nullableString(row.start_owner_id),
      startLeaseUntil: nullableInteger(row.start_lease_until),
      settlementAttempt: nonNegativeIntegerValue(row.settlement_attempt),
      settlementNextRetryAt: nullableInteger(row.settlement_next_retry_at),
      settlementOwnerId: nullableString(row.settlement_owner_id),
      settlementLeaseUntil: nullableInteger(row.settlement_lease_until),
      actualStartedAt: nullableInteger(row.actual_started_at),
      completedAt: nullableInteger(row.completed_at),
      createdAt: nonNegativeIntegerValue(row.created_at),
      updatedAt: nonNegativeIntegerValue(row.updated_at),
    };
  } catch (error) {
    if (error instanceof TournamentPersistenceError) throw error;
    persistedInvalid();
  }
}

function assertTemplateCommand(command: CreateTemplateCommand): void {
  assertIdentifier(command.id);
  assertIdentifier(command.idempotencyKey);
  if (command.timezone !== 'Asia/Seoul') invalid();
  assertActor(command.createdBy);
  assertTimestamp(command.now);
  assertTemplateMutableValues(command);
}

function assertTemplateMutableValues(values: {
  name: string;
  enabled: boolean;
  recurrence: TournamentRecurrence;
  firstStartsAt: number | null;
  recurrenceEndsAt: number | null;
  visibleLeadMs: number;
  registrationLeadMs: number;
  config: TournamentConfigSnapshotV2;
}): void {
  if (
    typeof values.name !== 'string'
    || values.name.trim() !== values.name
    || values.name.length < 1
    || values.name.length > 100
    || typeof values.enabled !== 'boolean'
  ) {
    invalid();
  }
  assertRecurrence(values.recurrence);
  if (
    values.firstStartsAt !== null
    && values.recurrenceEndsAt !== null
  ) {
    assertTimestamp(values.firstStartsAt);
    assertTimestamp(values.recurrenceEndsAt);
    if (values.firstStartsAt > values.recurrenceEndsAt) invalid();
  } else if (values.enabled) {
    invalid();
  }
  assertTimestamp(values.visibleLeadMs);
  assertTimestamp(values.registrationLeadMs);
  assertConfig(values.config);
  const registrationLeadLimit = values.config.economy.mode === 'wallet'
    ? WALLET_REGISTRATION_WINDOW_MS
    : MAX_FREEROLL_REGISTRATION_LEAD_MS;
  if (
    values.visibleLeadMs > MAX_VISIBLE_LEAD_MS
    || values.registrationLeadMs > registrationLeadLimit
    || values.visibleLeadMs < values.registrationLeadMs
  ) {
    invalid();
  }
}

function assertInstanceCommand(command: CreateInstanceCommand): void {
  assertIdentifier(command.id);
  assertIdentifier(command.idempotencyKey);
  assertIdentifier(command.occurrenceKey);
  if ((command.templateId === null) !== (command.templateRevision === null)) {
    invalid();
  }
  if (command.templateId !== null) {
    assertIdentifier(command.templateId);
    assertPositiveInteger(command.templateRevision);
  }
  assertActor(command.createdBy);
  assertTimestamp(command.now);
  assertSchedule(command.schedule, command.config.economy.mode);
  assertConfig(command.config);
  if (command.directorProfileId !== undefined && command.directorProfileId !== null) {
    assertIdentifier(command.directorProfileId);
  }
}

function assertSchedule(
  schedule: TournamentSchedule,
  economyMode: 'freeroll' | 'wallet',
): void {
  assertTimestamp(schedule.visibleAt);
  assertTimestamp(schedule.registrationOpensAt);
  if (schedule.visibleAt > schedule.registrationOpensAt) invalid();
  const scheduled = schedule.startsAt !== null
    && schedule.manualStartExpiresAt === null;
  const manual = schedule.startsAt === null
    && schedule.manualStartExpiresAt !== null;
  if (!scheduled && !manual) invalid();
  if (schedule.startsAt !== null) {
    assertTimestamp(schedule.startsAt);
    if (schedule.registrationOpensAt > schedule.startsAt) invalid();
    if (
      economyMode === 'wallet'
      && schedule.startsAt - schedule.registrationOpensAt
        > WALLET_REGISTRATION_WINDOW_MS
    ) {
      invalid();
    }
  }
  if (schedule.manualStartExpiresAt !== null) {
    assertTimestamp(schedule.manualStartExpiresAt);
    if (schedule.registrationOpensAt >= schedule.manualStartExpiresAt) invalid();
    if (
      economyMode === 'wallet'
      && schedule.manualStartExpiresAt - schedule.registrationOpensAt
        > WALLET_REGISTRATION_WINDOW_MS
    ) {
      invalid();
    }
    if (
      economyMode === 'freeroll'
      && schedule.manualStartExpiresAt - schedule.registrationOpensAt
        > FREEROLL_MANUAL_WINDOW_MS
    ) {
      invalid();
    }
  }
}

function assertConfig(value: unknown): asserts value is TournamentConfigSnapshotV2 {
  if (!isRecord(value)) invalid();
  if (
    value.version !== 2
    || typeof value.name !== 'string'
    || value.name.length < 1
    || value.name.length > 100
    || value.tableSize !== 6
    || ![8, 15, 30].includes(value.turnTimeSeconds as number)
    || !isRecord(value.field)
    || !isRecord(value.economy)
    || !isRecord(value.prizePool)
    || !isRecord(value.structure)
    || !isRecord(value.payout)
    || !isRecord(value.lateRegistration)
  ) {
    invalid();
  }
  const min = value.field.minEntrants;
  const max = value.field.maxEntrants;
  if (
    !isIntegerIn(min, 2, 48)
    || !isIntegerIn(max, min as number, 48)
    || typeof value.field.botFillToMinimum !== 'boolean'
  ) {
    invalid();
  }
  if (value.economy.mode === 'freeroll') {
    if (
      value.economy.promotionAccountId !== 'global'
      || value.prizePool.kind !== 'promotion-funded'
      || !isIntegerIn(value.prizePool.totalPrize, 1, 2_000_000_000)
    ) {
      invalid();
    }
  } else if (value.economy.mode === 'wallet') {
    if (
      !isIntegerIn(value.economy.productVersion, 1, Number.MAX_SAFE_INTEGER)
      || !isIntegerIn(value.economy.buyIn, 1, Number.MAX_SAFE_INTEGER)
      || !isIntegerIn(value.economy.fee, 1, Number.MAX_SAFE_INTEGER)
      || value.prizePool.kind !== 'entry-pool'
      || value.field.botFillToMinimum !== false
    ) {
      invalid();
    }
  } else {
    invalid();
  }
  if (
    !isIntegerIn(value.structure.startingStack, 1, Number.MAX_SAFE_INTEGER)
    || !Array.isArray(value.structure.segments)
    || value.structure.segments.length === 0
    || !PAYOUT_TABLE_VERSIONS.includes(value.payout.tableVersion as never)
    || !['top-heavy', 'standard', 'flat'].includes(
      value.payout.presetId as string,
    )
    || ![10, 15, 20].includes(value.payout.paidFieldPercent as number)
    || typeof value.lateRegistration.enabled !== 'boolean'
    || value.lateRegistration.minStartingStackBb !== 20
  ) {
    invalid();
  }
  for (const segment of value.structure.segments) {
    if (!isRecord(segment) || !isIntegerIn(segment.durationMs, 1, 86_400_000)) {
      invalid();
    }
    if (
      segment.kind === 'level'
      && (
        !isIntegerIn(segment.smallBlind, 1, Number.MAX_SAFE_INTEGER)
        || !isIntegerIn(segment.bigBlind, 1, Number.MAX_SAFE_INTEGER)
        || !isIntegerIn(segment.bigBlindAnte, 0, Number.MAX_SAFE_INTEGER)
      )
    ) {
      invalid();
    } else if (segment.kind !== 'level' && segment.kind !== 'break') {
      invalid();
    }
  }
}

function assertRecurrence(value: unknown): asserts value is TournamentRecurrence {
  if (!isRecord(value)) invalid();
  if (value.kind === 'hourly') {
    if (!isIntegerIn(value.minute, 0, 59)) invalid();
    return;
  }
  if (value.kind === 'daily') {
    if (!isIntegerIn(value.hour, 0, 23) || !isIntegerIn(value.minute, 0, 59)) {
      invalid();
    }
    return;
  }
  if (value.kind === 'weekly') {
    if (
      !isIntegerIn(value.weekday, 0, 6)
      || !isIntegerIn(value.hour, 0, 23)
      || !isIntegerIn(value.minute, 0, 59)
    ) {
      invalid();
    }
    return;
  }
  invalid();
}

function assertPayoutPlan(plan: TournamentPayoutFreezePlan): void {
  assertPositiveInteger(plan.version);
  assertIdentifier(plan.checksum);
  assertIdentifier(plan.fingerprint);
  assertTimestamp(plan.now);
  assertPositiveInteger(plan.prizePool);
  if (plan.results.length < 1) invalid();
  const players = new Set<string>();
  let total = 0;
  for (let index = 0; index < plan.results.length; index += 1) {
    const result = plan.results[index];
    if (
      result.place !== index + 1
      || players.has(result.playerId)
      || typeof result.displayName !== 'string'
      || result.displayName.length < 1
      || !Number.isSafeInteger(result.prize)
      || result.prize < 0
    ) {
      invalid();
    }
    assertIdentifier(result.playerId);
    players.add(result.playerId);
    total += result.prize;
    if (result.participantType === 'human') {
      assertIdentifier(result.profileId);
      assertPositiveInteger(result.registrationAttempt);
      if (
        (result.prize > 0 && result.disposition !== 'wallet-credit')
        || (result.prize === 0 && result.disposition !== 'none')
      ) {
        invalid();
      }
    } else if (result.participantType === 'bot') {
      if (
        result.profileId !== null
        || result.registrationAttempt !== null
        || (result.prize > 0 && result.disposition !== 'promotion-return')
        || (result.prize === 0 && result.disposition !== 'none')
      ) {
        invalid();
      }
    } else {
      invalid();
    }
  }
  if (total !== plan.prizePool) invalid();
}

function sameTemplateCreation(
  record: TournamentTemplateRecord,
  command: CreateTemplateCommand,
): boolean {
  return record.id === command.id
    && record.revision === 1
    && record.name === command.name
    && record.enabled === command.enabled
    && record.timezone === command.timezone
    && record.firstStartsAt === command.firstStartsAt
    && record.recurrenceEndsAt === command.recurrenceEndsAt
    && record.visibleLeadMs === command.visibleLeadMs
    && record.registrationLeadMs === command.registrationLeadMs
    && canonicalJson(record.recurrence) === canonicalJson(command.recurrence)
    && canonicalJson(record.config) === canonicalJson(command.config)
    && record.createdBy.kind === command.createdBy.kind
    && record.createdBy.profileId === command.createdBy.profileId
    && record.createdAt === command.now;
}

function sameInstanceCreation(
  record: TournamentInstanceRecord,
  command: CreateInstanceCommand,
): boolean {
  return record.id === command.id
    && record.templateId === command.templateId
    && record.templateRevision === command.templateRevision
    && record.occurrenceKey === command.occurrenceKey
    && canonicalJson(record.schedule) === canonicalJson(command.schedule)
    && canonicalJson(record.config) === canonicalJson(command.config)
    && record.createdBy.kind === command.createdBy.kind
    && record.createdBy.profileId === command.createdBy.profileId
    && record.directorProfileId === (command.directorProfileId ?? null)
    && record.createdAt === command.now;
}

export function computeTournamentPayoutFreezeChecksum(freeze: unknown): string {
  return createHash('sha256').update(canonicalJson(freeze)).digest('hex');
}

export function computeTournamentSettlementFingerprint(
  input: TournamentSettlementFingerprintInput,
): string {
  assertIdentifier(input.instanceId);
  assertPositiveInteger(input.configVersion);
  assertPositiveInteger(input.payoutFreezeVersion);
  assertIdentifier(input.payoutFreezeChecksum);
  assertPositiveInteger(input.prizePool);
  return createHash('sha256').update(canonicalJson({
    instanceId: input.instanceId,
    configVersion: input.configVersion,
    payoutFreezeVersion: input.payoutFreezeVersion,
    payoutFreezeChecksum: input.payoutFreezeChecksum,
    prizePool: input.prizePool,
    finalEntrants: input.results.length,
    results: input.results.map(result => ({
      place: result.place,
      playerId: result.playerId,
      participantType: result.participantType,
      profileId: result.profileId,
      registrationAttempt: result.registrationAttempt,
      displayName: result.displayName,
      prize: result.prize,
      disposition: result.disposition,
    })),
  })).digest('hex');
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(',')}]`;
  }
  if (isRecord(value)) {
    return `{${Object.keys(value).sort().map(key => (
      `${JSON.stringify(key)}:${canonicalJson(value[key])}`
    )).join(',')}}`;
  }
  return JSON.stringify(value);
}

function parseJson(value: unknown): unknown {
  if (typeof value !== 'string') persistedInvalid();
  try {
    return JSON.parse(value);
  } catch {
    persistedInvalid();
  }
}

function assertActor(actor: TournamentActor): void {
  assertIdentifier(actor.kind);
  if (actor.profileId !== null) assertIdentifier(actor.profileId);
}

function assertIdentifier(value: unknown): asserts value is string {
  if (
    typeof value !== 'string'
    || value.trim() !== value
    || value.length < 1
    || value.length > 200
  ) {
    invalid();
  }
}

function assertPositiveInteger(value: unknown): asserts value is number {
  if (!Number.isSafeInteger(value) || (value as number) < 1) invalid();
}

function assertTimestamp(value: unknown): asserts value is number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) invalid();
}

function isIntegerIn(
  value: unknown,
  minimum: number,
  maximum: number,
): value is number {
  return Number.isSafeInteger(value) && (value as number) >= minimum
    && (value as number) <= maximum;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function stringValue(value: unknown): string {
  if (typeof value !== 'string') persistedInvalid();
  return value;
}

function nullableString(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  return stringValue(value);
}

function integerValue(value: unknown): number {
  if (!Number.isSafeInteger(value)) persistedInvalid();
  return value as number;
}

function positiveIntegerValue(value: unknown): number {
  const result = integerValue(value);
  if (result < 1) persistedInvalid();
  return result;
}

function nonNegativeIntegerValue(value: unknown): number {
  const result = integerValue(value);
  if (result < 0) persistedInvalid();
  return result;
}

function nullableInteger(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  return nonNegativeIntegerValue(value);
}

function booleanInteger(value: unknown): boolean {
  const result = integerValue(value);
  if (result !== 0 && result !== 1) persistedInvalid();
  return result === 1;
}

function invalid(): never {
  throw new TournamentPersistenceError('INVALID_INPUT');
}

function persistedInvalid(): never {
  throw new TournamentPersistenceError('PERSISTED_ROW_INVALID');
}

function persistenceError(
  error: unknown,
  fallback: TournamentPersistenceErrorCode = 'PERSISTED_ROW_INVALID',
): TournamentPersistenceError {
  if (error instanceof TournamentPersistenceError) return error;
  return new TournamentPersistenceError(fallback);
}
