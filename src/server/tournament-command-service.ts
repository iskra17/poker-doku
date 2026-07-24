import {
  MTT_WALLET_BUY_IN,
  MTT_WALLET_ENTRY_FEE,
} from '../lib/economy/mtt-entry';
import type { CreateTournamentRequest } from '../lib/realtime/protocol';
import {
  TournamentManager,
  type TournamentAuditActor,
  type TournamentDirectorAction,
  type TournamentDirectorResult,
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
  ) {}

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
    return this.manager.startTournamentAsOperator(
      tournamentId,
      this.auditActor(authority),
    );
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
