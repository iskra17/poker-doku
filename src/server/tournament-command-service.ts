import {
  MTT_WALLET_BUY_IN,
  MTT_WALLET_ENTRY_FEE,
} from '../lib/economy/mtt-entry';
import type { CreateTournamentRequest } from '../lib/realtime/protocol';
import type { StartClaimSource } from './tournament-instance-repository';
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

export function parseTournamentOperatorIds(raw: string | undefined): ReadonlySet<string> {
  return new Set(
    (raw ?? '')
      .split(',')
      .map(value => value.trim())
      .filter(Boolean),
  );
}

export class TournamentCommandService {
  constructor(
    private readonly manager: TournamentManager,
    private readonly operatorProfileIds: ReadonlySet<string>,
    private readonly persistentStart?: PersistentTournamentStartPorts,
  ) {}

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
    if (memoryResult !== 'not-found' || !this.persistentStart) {
      return memoryResult;
    }
    const claim = this.persistentStart.claimManualStart?.(tournamentId);
    if (!claim) return 'not-found';
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
    return this.manager.directorActionAsOperator(
      tournamentId,
      action,
      this.auditActor(authority),
    );
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
}
