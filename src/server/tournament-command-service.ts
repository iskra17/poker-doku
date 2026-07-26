import {
  MTT_WALLET_BUY_IN,
  MTT_WALLET_ENTRY_FEE,
} from '../lib/economy/mtt-entry';
import type { CreateTournamentRequest } from '../lib/realtime/protocol';
import { eventLog } from './event-log';
import type { PokerDatabase } from './persistence/database';
import {
  TournamentInstanceRepository,
  TournamentPersistenceError,
  type StartClaimSource,
  type TournamentInstanceAdminProjection,
  type TournamentInstanceRecord,
  type TournamentTemplateRecord,
} from './tournament-instance-repository';
import { parseCreateTournamentCommand } from './tournament-command-parser';
import type { TournamentScheduler } from './tournament-scheduler';
import {
  TournamentManager,
  type TournamentAuditActor,
  type TournamentDirectorAction,
  type TournamentDirectorResult,
  type MttEntrant,
  type PersistentTournamentStartSnapshot,
  type PreparedTournamentRuntime,
} from './tournament-manager';

export type TournamentAuthority =
  | { kind: 'backoffice' }
  | { kind: 'operator-profile'; profileId: string };

export type TournamentCreateResult =
  | { ok: true; tournamentId: string }
  | { ok: false; reason: 'forbidden' | 'limit' | 'host-limit' | 'invalid' };

export type TournamentStartResult =
  | 'ok'
  | 'forbidden'
  | 'not-found'
  | 'not-registering'
  | 'not-enough'
  | 'economy';

export type TournamentActionResult =
  | 'forbidden'
  | Exclude<TournamentDirectorResult, 'not-host'>;

export interface ClaimedTournamentStartSnapshot
  extends PersistentTournamentStartSnapshot {
  readonly startOwnerId: string | null;
  readonly startAttempt: number;
  readonly startSource?: StartClaimSource;
}

export interface PersistentTournamentStartPorts {
  claimManualStart?(
    tournamentId: string,
  ): ClaimedTournamentStartSnapshot | null;
  claimStartingRoster(
    snapshot: ClaimedTournamentStartSnapshot,
    ownerToken: string,
  ): { readonly roster: readonly MttEntrant[] };
  startEconomy(
    snapshot: ClaimedTournamentStartSnapshot,
    roster: readonly MttEntrant[],
    ownerToken: string,
  ): void;
  commitRunning(input: {
    readonly snapshot: ClaimedTournamentStartSnapshot;
    readonly ownerToken: string;
    readonly actualStartedAt: number;
    readonly initialEntrants: number;
    readonly initialBotEntrants: number;
    readonly committedEntrants: number;
    readonly everMultiTable: boolean;
  }): boolean;
  handoffRefund(
    snapshot: ClaimedTournamentStartSnapshot,
    ownerToken: string,
    error: Error,
  ): void;
  restoreStartSource?(
    snapshot: ClaimedTournamentStartSnapshot,
    ownerToken: string,
    source: StartClaimSource,
  ): void;
}

export type PersistentTournamentStartResult =
  | 'ok'
  | 'not-enough'
  | 'rollback';

export type PersistentTournamentAdminErrorCode =
  | 'forbidden'
  | 'unavailable'
  | 'invalid-payload'
  | 'not-found'
  | 'revision-conflict'
  | 'idempotency-conflict'
  | 'promotion-insufficient'
  | 'conflict';

export type PersistentTournamentAdminResult<T extends object> =
  | ({ readonly ok: true } & T)
  | {
      readonly ok: false;
      readonly code: PersistentTournamentAdminErrorCode;
      readonly actualRevision?: number;
    };

export interface PersistentTournamentAdminSnapshot {
  readonly instances: TournamentInstanceAdminProjection[];
  readonly templates: TournamentTemplateRecord[];
}

export interface PersistentTournamentAdminPorts {
  readonly database: PokerDatabase;
  readonly instances: TournamentInstanceRepository;
  readonly scheduler: Pick<
    TournamentScheduler,
    | 'reconcileTemplates'
    | 'generateTemplateOccurrencesIfRevision'
    | 'reconcileDue'
    | 'hydrateTimers'
  >;
  readonly onRefundPending?: (instance: TournamentInstanceRecord) => unknown;
  readonly now?: () => number;
}

export interface MttFeatureFlags {
  readonly schedulerV2: boolean;
  readonly lateRegistration: boolean;
  readonly walletLateRegistration: boolean;
}

export function resolveMttFeatureFlags(
  env: Record<string, string | undefined>,
): MttFeatureFlags {
  const schedulerV2 = env.MTT_SCHEDULER_V2_ENABLED === 'true';
  const lateRegistration = env.MTT_LATE_REG_ENABLED === 'true';
  const walletLateRegistration =
    env.MTT_WALLET_LATE_REG_ENABLED === 'true';
  if (lateRegistration && !schedulerV2) {
    throw new Error(
      'MTT_LATE_REG_ENABLED requires MTT_SCHEDULER_V2_ENABLED',
    );
  }
  if (walletLateRegistration && !lateRegistration) {
    throw new Error(
      'MTT_WALLET_LATE_REG_ENABLED requires MTT_LATE_REG_ENABLED',
    );
  }
  return { schedulerV2, lateRegistration, walletLateRegistration };
}

export function parseTournamentOperatorIds(raw: string | undefined): ReadonlySet<string> {
  return new Set(
    (raw ?? '')
      .split(',')
      .map(value => value.trim())
      .filter(Boolean),
  );
}

export class TournamentCommandService {
  private persistentAdmin?: PersistentTournamentAdminPorts;

  constructor(
    private readonly manager: TournamentManager,
    private readonly operatorProfileIds: ReadonlySet<string>,
    private readonly persistentStart?: PersistentTournamentStartPorts,
    persistentAdmin?: PersistentTournamentAdminPorts,
  ) {
    this.persistentAdmin = persistentAdmin;
  }

  configurePersistentAdmin(ports: PersistentTournamentAdminPorts): void {
    if (this.persistentAdmin && this.persistentAdmin !== ports) {
      throw new Error('Persistent tournament admin is already configured');
    }
    this.persistentAdmin = ports;
  }

  /**
   * Scheduler prepared-start handler. The durable running transition is the
   * publication gate: activation is unreachable until commitRunning wins.
   */
  processStartClaim(
    snapshot: ClaimedTournamentStartSnapshot,
    trigger: 'scheduled' | 'manual' = 'scheduled',
  ): PersistentTournamentStartResult {
    const ports = this.persistentStart;
    const ownerToken = snapshot.startOwnerId;
    if (!ports || !ownerToken) return 'rollback';
    let prepared: PreparedTournamentRuntime | null = null;
    try {
      const { roster } = ports.claimStartingRoster(snapshot, ownerToken);
      const humanCount = roster.length;
      const botCount = snapshot.economyMode === 'freeroll'
        && snapshot.config.field.botFillToMinimum
        && humanCount > 0
        ? Math.max(0, snapshot.config.field.minEntrants - humanCount)
        : 0;
      if (
        humanCount < 1
        || humanCount + botCount < snapshot.config.field.minEntrants
      ) {
        throw new Error('Tournament field is not large enough');
      }
      ports.startEconomy(snapshot, roster, ownerToken);
      prepared = this.manager.prepareFromInstance(
        snapshot,
        roster,
        ownerToken,
      );
      const actualStartedAt = Date.now();
      const committed = ports.commitRunning({
        snapshot,
        ownerToken,
        actualStartedAt,
        initialEntrants: prepared.committedEntrants,
        initialBotEntrants: prepared.botEntrants,
        committedEntrants: prepared.committedEntrants,
        everMultiTable: prepared.everMultiTable,
      });
      if (!committed) throw new Error('Tournament running CAS lost');
      this.manager.activatePreparedTournament(
        snapshot.id,
        ownerToken,
        actualStartedAt,
      );
      return 'ok';
    } catch (cause) {
      const error = cause instanceof Error ? cause : new Error(String(cause));
      this.manager.discardPreparedTournament(
        snapshot.id,
        ownerToken,
        'mtt-start-rollback',
      );
      if (
        trigger === 'manual'
        && prepared === null
        && error.message.includes('not large enough')
        && snapshot.startSource
      ) {
        ports.restoreStartSource?.(
          snapshot,
          ownerToken,
          snapshot.startSource,
        );
        if (ports.restoreStartSource) return 'not-enough';
      }
      ports.handoffRefund(snapshot, ownerToken, error);
      return prepared === null && error.message.includes('not large enough')
        ? 'not-enough'
        : 'rollback';
    }
  }

  processExpiredStartLease(
    snapshot: ClaimedTournamentStartSnapshot,
  ): void {
    const ports = this.persistentStart;
    const ownerToken = snapshot.startOwnerId;
    if (!ports || !ownerToken) return;
    this.manager.discardPreparedTournament(
      snapshot.id,
      ownerToken,
      'mtt-start-rollback',
    );
    ports.handoffRefund(
      snapshot,
      ownerToken,
      new Error('Tournament start lease expired'),
    );
  }

  canOperateProfile(profileId: string): boolean {
    return this.operatorProfileIds.has(profileId);
  }

  listAdmin(
    authority: TournamentAuthority,
    at = this.persistentAdmin?.now?.() ?? Date.now(),
  ): PersistentTournamentAdminResult<PersistentTournamentAdminSnapshot> {
    if (!this.allowed(authority)) return { ok: false, code: 'forbidden' };
    const admin = this.persistentAdmin;
    if (!admin) return { ok: false, code: 'unavailable' };
    return {
      ok: true,
      instances: admin.instances.listAdminProjections(at),
      templates: this.listTemplates(admin.database),
    };
  }

  createPersistentInstance(
    authority: TournamentAuthority,
    raw: unknown,
    at = this.persistentAdmin?.now?.() ?? Date.now(),
  ): PersistentTournamentAdminResult<{ instance: TournamentInstanceRecord }> {
    if (!this.allowed(authority)) return { ok: false, code: 'forbidden' };
    const admin = this.persistentAdmin;
    if (!admin) return { ok: false, code: 'unavailable' };
    let parsed;
    try {
      parsed = parseCreateTournamentCommand(raw, at);
      if (parsed.recurrence !== null) throw new Error('recurring-template');
    } catch {
      return { ok: false, code: 'invalid-payload' };
    }

    try {
      const instance = admin.instances.createInstance({
        id: parsed.requestId,
        templateId: null,
        templateRevision: null,
        idempotencyKey: parsed.requestId,
        occurrenceKey: parsed.requestId,
        schedule: parsed.schedule,
        config: parsed.config,
        createdBy: this.persistenceActor(authority),
        directorProfileId: authority.kind === 'operator-profile'
          ? authority.profileId
          : null,
        now: at,
      });
      admin.scheduler.reconcileDue(at);
      admin.scheduler.hydrateTimers(at);
      const current = admin.instances.getInstance(instance.id) ?? instance;
      const result = current.status === 'cancelled'
        && current.statusReason === 'promotion-insufficient'
        ? { ok: false as const, code: 'promotion-insufficient' as const }
        : { ok: true as const, instance: current };
      this.auditPersistentCommand(
        'mtt-instance-generate',
        authority,
        result.ok ? 'ok' : result.code,
        { tournamentId: current.id },
      );
      return result;
    } catch (error) {
      return this.persistenceFailure(error);
    }
  }

  createRecurringTemplate(
    authority: TournamentAuthority,
    raw: unknown,
    at = this.persistentAdmin?.now?.() ?? Date.now(),
  ): PersistentTournamentAdminResult<{ template: TournamentTemplateRecord }> {
    if (!this.allowed(authority)) return { ok: false, code: 'forbidden' };
    const admin = this.persistentAdmin;
    if (!admin) return { ok: false, code: 'unavailable' };
    let parsed;
    try {
      parsed = parseCreateTournamentCommand(raw, at);
      if (
        parsed.recurrence === null
        || parsed.firstStartsAt === null
        || parsed.recurrenceEndsAt === null
        || parsed.visibleLeadMs === null
        || parsed.registrationLeadMs === null
      ) {
        throw new Error('standalone-instance');
      }
    } catch {
      return { ok: false, code: 'invalid-payload' };
    }

    try {
      const template = admin.instances.createTemplate({
        id: parsed.requestId,
        idempotencyKey: parsed.requestId,
        name: parsed.config.name,
        enabled: true,
        timezone: 'Asia/Seoul',
        recurrence: parsed.recurrence,
        firstStartsAt: parsed.firstStartsAt,
        recurrenceEndsAt: parsed.recurrenceEndsAt,
        visibleLeadMs: parsed.visibleLeadMs,
        registrationLeadMs: parsed.registrationLeadMs,
        config: parsed.config,
        createdBy: this.persistenceActor(authority),
        now: at,
      });
      admin.scheduler.reconcileTemplates(at);
      admin.scheduler.reconcileDue(at);
      admin.scheduler.hydrateTimers(at);
      this.auditPersistentCommand(
        'mtt-template-create',
        authority,
        'ok',
        { templateId: template.id, revision: template.revision },
      );
      return { ok: true, template };
    } catch (error) {
      return this.persistenceFailure(error);
    }
  }

  patchRecurringTemplate(
    authority: TournamentAuthority,
    id: string,
    revision: number,
    raw: unknown,
    at = this.persistentAdmin?.now?.() ?? Date.now(),
  ): PersistentTournamentAdminResult<{ template: TournamentTemplateRecord }> {
    if (!this.allowed(authority)) return { ok: false, code: 'forbidden' };
    const admin = this.persistentAdmin;
    if (!admin) return { ok: false, code: 'unavailable' };
    const current = this.listTemplates(admin.database)
      .find(template => template.id === id);
    if (!current) return { ok: false, code: 'not-found' };
    if (current.revision !== revision) {
      return {
        ok: false,
        code: 'revision-conflict',
        actualRevision: current.revision,
      };
    }
    let parsed;
    let enabled: boolean;
    try {
      if (
        !isRecord(raw)
        || Object.keys(raw).length === 0
        || Object.keys(raw).some(key => !TEMPLATE_PATCH_FIELDS.has(key))
      ) {
        throw new Error('invalid-patch');
      }
      enabled = raw.enabled === undefined
        ? current.enabled
        : requireBoolean(raw.enabled);
      parsed = parseCreateTournamentCommand(
        this.templateParserInput(current, raw, at),
        at,
      );
      if (
        parsed.recurrence === null
        || parsed.firstStartsAt === null
        || parsed.recurrenceEndsAt === null
        || parsed.visibleLeadMs === null
        || parsed.registrationLeadMs === null
      ) {
        throw new Error('invalid-template');
      }
      if (
        enabled === current.enabled
        && parsed.config.name === current.name
        && parsed.firstStartsAt === current.firstStartsAt
        && parsed.recurrenceEndsAt === current.recurrenceEndsAt
        && parsed.visibleLeadMs === current.visibleLeadMs
        && parsed.registrationLeadMs === current.registrationLeadMs
        && sameJsonValue(parsed.recurrence, current.recurrence)
        && sameJsonValue(parsed.config, current.config)
      ) {
        throw new Error('no-op-patch');
      }
    } catch {
      return { ok: false, code: 'invalid-payload' };
    }

    const transitionAt = Math.max(at, current.updatedAt + 1);
    try {
      const result = admin.instances.patchTemplateIfRevision(id, revision, {
        name: parsed.config.name,
        enabled,
        recurrence: parsed.recurrence,
        firstStartsAt: parsed.firstStartsAt,
        recurrenceEndsAt: parsed.recurrenceEndsAt,
        visibleLeadMs: parsed.visibleLeadMs,
        registrationLeadMs: parsed.registrationLeadMs,
        config: parsed.config,
        updatedAt: transitionAt,
      });
      if (result.status === 'not-found') {
        return { ok: false, code: 'not-found' };
      }
      if (result.status === 'revision-conflict') {
        return {
          ok: false,
          code: 'revision-conflict',
          actualRevision: result.actualRevision,
        };
      }
      admin.scheduler.reconcileTemplates(transitionAt);
      admin.scheduler.reconcileDue(transitionAt);
      admin.scheduler.hydrateTimers(transitionAt);
      this.auditPersistentCommand(
        'mtt-template-update',
        authority,
        'ok',
        { templateId: id, revision: result.record.revision },
      );
      return { ok: true, template: result.record };
    } catch (error) {
      return this.persistenceFailure(error);
    }
  }

  actOnTemplate(
    authority: TournamentAuthority,
    id: string,
    revision: number,
    raw: unknown,
    at = this.persistentAdmin?.now?.() ?? Date.now(),
  ): PersistentTournamentAdminResult<{
    template: TournamentTemplateRecord;
    generated?: number;
  }> {
    if (!this.allowed(authority)) return { ok: false, code: 'forbidden' };
    const admin = this.persistentAdmin;
    if (!admin) return { ok: false, code: 'unavailable' };
    if (
      !isRecord(raw)
      || Object.keys(raw).length !== 1
      || typeof raw.action !== 'string'
    ) {
      return { ok: false, code: 'invalid-payload' };
    }
    if (raw.action === 'enable' || raw.action === 'disable') {
      return this.patchRecurringTemplate(
        authority,
        id,
        revision,
        { enabled: raw.action === 'enable' },
        at,
      );
    }
    if (raw.action !== 'generate-next') {
      return { ok: false, code: 'invalid-payload' };
    }
    const generation = admin.scheduler.generateTemplateOccurrencesIfRevision(
      id,
      revision,
      at,
    );
    if (generation.status === 'not-found') {
      return { ok: false, code: 'not-found' };
    }
    if (generation.status === 'revision-conflict') {
      return {
        ok: false,
        code: 'revision-conflict',
        actualRevision: generation.actualRevision,
      };
    }
    admin.scheduler.reconcileDue(at);
    admin.scheduler.hydrateTimers(at);
    const current = this.listTemplates(admin.database)
      .find(template => template.id === id);
    if (!current) return { ok: false, code: 'not-found' };
    this.auditPersistentCommand(
      'mtt-instance-generate',
      authority,
      'ok',
      { templateId: id, revision, generated: generation.generated },
    );
    return { ok: true, template: current, generated: generation.generated };
  }

  create(
    authority: TournamentAuthority,
    draft: CreateTournamentRequest,
  ): TournamentCreateResult {
    if (!this.allowed(authority)) return { ok: false, reason: 'forbidden' };
    const economyMode = draft.economyMode === 'wallet' ? 'wallet' : 'practice';
    return this.manager.createTournament(
      {
        ...draft,
        tableSize: 6,
        botFill: economyMode === 'wallet' ? false : draft.botFill,
        hostId: authority.kind === 'backoffice' ? 'backoffice' : authority.profileId,
        economyMode,
        entryBuyIn: economyMode === 'wallet' ? MTT_WALLET_BUY_IN : 0,
        entryFee: economyMode === 'wallet' ? MTT_WALLET_ENTRY_FEE : 0,
      },
      this.auditActor(authority),
    );
  }

  start(
    authority: TournamentAuthority,
    tournamentId: string,
  ): TournamentStartResult {
    if (!this.allowed(authority)) return 'forbidden';
    const memoryResult = this.manager.startTournamentAsOperator(
      tournamentId,
      this.auditActor(authority),
    );
    if (memoryResult !== 'not-found') {
      return memoryResult;
    }
    const claim = this.persistentStart?.claimManualStart?.(tournamentId);
    if (!claim) {
      return this.persistentAdmin?.instances.getInstance(tournamentId)
        ? 'not-registering'
        : 'not-found';
    }
    const result = this.processStartClaim(claim, 'manual');
    return result === 'ok'
      ? 'ok'
      : result === 'not-enough'
        ? 'not-enough'
        : 'economy';
  }

  act(
    authority: TournamentAuthority,
    tournamentId: string,
    action: TournamentDirectorAction,
  ): TournamentActionResult {
    if (!this.allowed(authority)) return 'forbidden';
    const memoryResult = this.manager.directorActionAsOperator(
      tournamentId,
      action,
      this.auditActor(authority),
    );
    // 취소는 인메모리 런타임 해체와 DB 영속 취소(등록 동결·에스크로 환불)를 **둘 다** 해야 한다.
    // 여기서 인메모리 성공만 보고 early-return하면 라이브 토너먼트는 영속 경로에 영영 닿지
    // 못하고, DB에는 status='running' 인스턴스와 잠긴 에스크로가 남는다. 운영자는 라이브
    // 목록에서 사라진 것만 보고 취소가 끝난 줄 안다 (2026-07-26 QA — 두 번 눌러야 정리됐다).
    const memoryCancelled = action.kind === 'cancel' && memoryResult === 'ok';
    if (memoryResult !== 'not-found' && !memoryCancelled) return memoryResult;
    // 인메모리 취소가 이미 성공했다면 영속 단계가 실패해도 그 성공을 뒤집지 않는다.
    const fallback: TournamentActionResult = memoryCancelled ? 'ok' : 'not-found';
    const admin = this.persistentAdmin;
    if (!admin) return fallback;
    const instance = admin.instances.getInstance(tournamentId);
    if (!instance) return fallback;
    if (action.kind !== 'cancel') return 'bad-state';

    const at = admin.now?.() ?? Date.now();
    const ownerToken = `admin-cancel:${tournamentId}:${at}`;
    const direct = admin.instances.claimDirectCancellation(
      tournamentId,
      'operator-cancel',
      ownerToken,
      at,
    );
    if (direct.status === 'claimed') {
      this.auditPersistentCommand(
        'mtt-director-action',
        authority,
        'ok',
        { tournamentId, action: 'cancel', durable: true },
      );
      admin.scheduler.reconcileDue(at);
      admin.scheduler.hydrateTimers(at);
      return 'ok';
    }
    if (!admin.onRefundPending) return fallback === 'ok' ? 'ok' : 'bad-state';
    const refund = admin.instances.claimRefundPending(
      tournamentId,
      'operator-cancel',
      ownerToken,
    );
    if (refund.status !== 'claimed') {
      return fallback === 'ok' ? 'ok' : 'bad-state';
    }
    admin.onRefundPending(refund.instance);
    this.auditPersistentCommand(
      'mtt-director-action',
      authority,
      'ok',
      { tournamentId, action: 'cancel', durable: true },
    );
    admin.scheduler.reconcileDue(at);
    admin.scheduler.hydrateTimers(at);
    return 'ok';
  }

  private allowed(authority: TournamentAuthority): boolean {
    return authority.kind === 'backoffice'
      || this.canOperateProfile(authority.profileId);
  }

  private auditActor(authority: TournamentAuthority): TournamentAuditActor {
    return authority.kind === 'backoffice'
      ? { authorityKind: 'backoffice' }
      : {
          authorityKind: 'operator-profile',
          operatorProfileId: authority.profileId,
        };
  }

  private persistenceActor(authority: TournamentAuthority): {
    kind: string;
    profileId: string | null;
  } {
    return authority.kind === 'backoffice'
      ? { kind: 'backoffice-admin', profileId: null }
      : { kind: 'operator-profile', profileId: authority.profileId };
  }

  private listTemplates(database: PokerDatabase): TournamentTemplateRecord[] {
    const rows = database.db.prepare(`
      SELECT *
      FROM tournament_template
      ORDER BY id
    `).all() as unknown as Array<Record<string, unknown>>;
    return rows.map(row => ({
      id: String(row.id),
      revision: Number(row.revision),
      idempotencyKey: String(row.idempotency_key),
      name: String(row.name),
      enabled: Number(row.enabled) === 1,
      timezone: 'Asia/Seoul',
      recurrence: JSON.parse(String(row.recurrence_json)),
      firstStartsAt: row.first_starts_at === null
        ? null
        : Number(row.first_starts_at),
      recurrenceEndsAt: row.recurrence_ends_at === null
        ? null
        : Number(row.recurrence_ends_at),
      visibleLeadMs: Number(row.visible_lead_ms),
      registrationLeadMs: Number(row.registration_lead_ms),
      config: JSON.parse(String(row.config_json)),
      createdBy: {
        kind: String(row.created_by_kind),
        profileId: row.created_by_profile_id === null
          ? null
          : String(row.created_by_profile_id),
      },
      createdAt: Number(row.created_at),
      updatedAt: Number(row.updated_at),
    }));
  }

  private templateParserInput(
    current: TournamentTemplateRecord,
    patch: Record<string, unknown>,
    at: number,
  ): Record<string, unknown> {
    const visibleLeadMs = patch.visibleLeadMs ?? current.visibleLeadMs;
    const registrationLeadMs =
      patch.registrationLeadMs ?? current.registrationLeadMs;
    const numericVisibleLead = typeof visibleLeadMs === 'number'
      ? visibleLeadMs
      : current.visibleLeadMs;
    const numericRegistrationLead = typeof registrationLeadMs === 'number'
      ? registrationLeadMs
      : current.registrationLeadMs;
    const firstStartsAt = patch.firstStartsAt ?? current.firstStartsAt;
    const recurrenceEndsAt =
      patch.recurrenceEndsAt ?? current.recurrenceEndsAt;
    const startsAt = typeof firstStartsAt === 'number'
      ? firstStartsAt
      : at + Math.max(
          60_000,
          numericVisibleLead,
          numericRegistrationLead,
        );
    return {
      requestId: '00000000-0000-4000-8000-000000000000',
      name: patch.name ?? current.name,
      economyMode: patch.economyMode ?? current.config.economy.mode,
      minEntrants: patch.minEntrants ?? current.config.field.minEntrants,
      maxEntrants: patch.maxEntrants ?? current.config.field.maxEntrants,
      botFillToMinimum:
        patch.botFillToMinimum ?? current.config.field.botFillToMinimum,
      turnTimeSeconds:
        patch.turnTimeSeconds ?? current.config.turnTimeSeconds,
      structure: patch.structure ?? current.config.structure,
      prizePool: patch.prizePool ?? current.config.prizePool,
      payout: patch.payout ?? current.config.payout,
      lateRegistration:
        patch.lateRegistration ?? current.config.lateRegistration,
      schedule: {
        visibleAt: startsAt - numericVisibleLead,
        registrationOpensAt: startsAt - numericRegistrationLead,
        startsAt,
        manualStartExpiresAt: null,
      },
      recurrence: patch.recurrence ?? current.recurrence,
      firstStartsAt,
      recurrenceEndsAt,
      visibleLeadMs,
      registrationLeadMs,
    };
  }

  private persistenceFailure<T extends object>(
    error: unknown,
  ): PersistentTournamentAdminResult<T> {
    if (error instanceof TournamentPersistenceError) {
      if (error.code === 'IDEMPOTENCY_CONFLICT') {
        return { ok: false, code: 'idempotency-conflict' };
      }
      if (error.code === 'INVALID_INPUT') {
        return { ok: false, code: 'invalid-payload' };
      }
      return { ok: false, code: 'conflict' };
    }
    return { ok: false, code: 'conflict' };
  }

  private auditPersistentCommand(
    type: string,
    authority: TournamentAuthority,
    resultCode: string,
    data: Record<string, unknown>,
  ): void {
    eventLog.log(type, {
      data: {
        ...data,
        resultCode,
        authorityKind: authority.kind,
        ...(authority.kind === 'operator-profile'
          ? { operatorProfileId: authority.profileId }
          : {}),
      },
    });
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function requireBoolean(value: unknown): boolean {
  if (typeof value !== 'boolean') throw new Error('Expected boolean');
  return value;
}

function sameJsonValue(left: unknown, right: unknown): boolean {
  return JSON.stringify(sortJsonValue(left)) === JSON.stringify(sortJsonValue(right));
}

function sortJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortJsonValue);
  if (!isRecord(value)) return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map(key => [key, sortJsonValue(value[key])]),
  );
}

const TEMPLATE_PATCH_FIELDS = new Set([
  'name',
  'enabled',
  'economyMode',
  'minEntrants',
  'maxEntrants',
  'botFillToMinimum',
  'turnTimeSeconds',
  'structure',
  'prizePool',
  'payout',
  'lateRegistration',
  'recurrence',
  'firstStartsAt',
  'recurrenceEndsAt',
  'visibleLeadMs',
  'registrationLeadMs',
]);
