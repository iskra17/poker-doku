import type { TournamentConfigSnapshotV2 } from '@/lib/tournament/tournament-config';
import { lateRegistrationClosesAt } from '@/lib/tournament/late-registration-clock';
import type {
  RegistrationCloseReason,
} from '@/lib/tournament/tournament-state';
import {
  type EconomyRepository,
  type MttInstanceProduct,
  type SngEntry,
} from './economy-repository';
import type { PokerDatabase } from './persistence/database';
import { isUuidRequestId } from './tournament-command-parser';

export type TournamentRegistrationStatus =
  | 'registered'
  | 'cancelled'
  | 'no-show'
  | 'seat-claimed'
  | 'late-pending'
  | 'seated'
  | 'eliminated'
  | 'finished'
  | 'refunded';

type RegistrationStatus = TournamentRegistrationStatus;
type EconomyMode = 'freeroll' | 'wallet';

export interface TournamentRegistrationEngagement {
  readonly tournamentId: string;
  readonly profileId: string;
  readonly requestId: string;
  readonly status: TournamentRegistrationStatus;
}

export type TournamentEnrollmentErrorCode =
  | 'not-found'
  | 'registration-closed'
  | 'capacity'
  | 'active-registration'
  | 'stale-attempt'
  | 'invalid-state'
  | 'financial-invariant'
  | 'invalid-input';

export class TournamentEnrollmentError extends Error {
  constructor(readonly code: TournamentEnrollmentErrorCode) {
    super(code);
    this.name = 'TournamentEnrollmentError';
  }
}

export interface PublicTournamentPlayer {
  readonly id: string;
  readonly name: string;
  readonly avatar: string;
}

export type LateEntryKey =
  | {
      readonly profileId: string;
      readonly economyMode: 'freeroll';
      readonly requestId: string;
      readonly registrationAttempt: number;
    }
  | {
      readonly profileId: string;
      readonly economyMode: 'wallet';
      readonly requestId: string;
      readonly registrationAttempt: number;
      readonly economyEntryAttempt: number;
      readonly entryId: string;
    };

export type NormalRegistrationCloseReason = Exclude<
  RegistrationCloseReason,
  'late-reg-disabled' | 'tournament-cancelled' | 'tournament-completed'
>;

export interface RegistrationCloseClaim {
  readonly generation: number;
  readonly ownerToken: string;
  readonly reason: NormalRegistrationCloseReason;
}

export interface DynamicCloseCandidate {
  readonly expectedGeneration: number;
  readonly ownerToken: string;
  readonly reason: 'bubble' | 'final-table' | 'last-player';
}

export type EnrollmentReservationResult =
  | {
      readonly status: 'reserved';
      readonly key: LateEntryKey;
      readonly acceptedAt: number;
      readonly closeClaim?: RegistrationCloseClaim;
    }
  | {
      readonly status: 'seated';
      readonly key: LateEntryKey;
      readonly acceptedAt: number;
    }
  | {
      readonly status: 'terminal';
      readonly key: LateEntryKey;
      readonly acceptedAt: number;
      readonly resultCode:
        | 'cancelled'
        | 'refunded'
        | 'no-show'
        | 'eliminated'
        | 'finished';
    };

export type LateEntryReleaseResult =
  | {
      readonly status: 'released' | 'already-released';
      readonly closeClaim?: RegistrationCloseClaim;
    }
  | {
      readonly status: 'closing';
      readonly closeClaim: RegistrationCloseClaim;
    }
  | {
      readonly status: 'terminal';
      readonly resultCode:
        | 'cancelled'
        | 'refunded'
        | 'no-show'
        | 'eliminated'
        | 'finished';
    };

export interface RegisterPreStartInput {
  readonly tournamentId: string;
  readonly profileId: string;
  readonly requestId: string;
  readonly publicPlayer: PublicTournamentPlayer;
  readonly at?: number;
}

export interface StartingRosterClaimInput {
  readonly tournamentId: string;
  readonly ownerId: string;
  readonly startAttempt: number;
  readonly checkedInProfileIds: readonly string[];
  readonly at?: number;
}

export interface StartingRosterClaimResult {
  readonly entries: readonly LateEntryKey[];
}

export interface CommitStartingRosterInput {
  readonly tournamentId: string;
  readonly ownerId: string;
  readonly startAttempt: number;
  readonly humanEntrants: number;
  readonly initialEntrants: number;
  readonly initialBotEntrants: number;
  readonly committedEntrants: number;
  readonly everMultiTable: boolean;
  readonly actualStartedAt: number;
}

export interface RollbackStartClaimInput {
  readonly tournamentId: string;
  readonly ownerId: string;
  readonly startAttempt: number;
  readonly restore?: {
    readonly status: 'registering' | 'start-delayed';
    readonly statusReason: string | null;
    readonly nextRetryAt: number | null;
  };
  readonly at?: number;
}

interface InstanceRow {
  id: string;
  status: string;
  registration_state: string;
  registration_close_reason: RegistrationCloseReason | null;
  registration_generation: number;
  registration_owner_token: string | null;
  registration_opens_at: number;
  starts_at: number | null;
  manual_expires_at: number | null;
  economy_mode: EconomyMode;
  min_entrants: number;
  max_entrants: number;
  committed_entrants: number | null;
  pending_late_entrants: number;
  ever_multi_table: number;
  config_json: string;
  start_attempt: number;
  start_owner_id: string | null;
  actual_started_at: number | null;
}

interface RegistrationRow {
  instance_id: string;
  profile_id: string;
  public_player_json: string;
  status: RegistrationStatus;
  ever_seated: number;
  registration_attempt: number;
  economy_entry_attempt: number | null;
  registered_at: number;
  updated_at: number;
}

interface AttemptRow {
  instance_id: string;
  profile_id: string;
  registration_attempt: number;
  request_id: string;
  economy_entry_attempt: number | null;
  status: RegistrationStatus;
  close_generation: number | null;
  close_owner_token: string | null;
  close_reason: NormalRegistrationCloseReason | null;
  created_at: number;
  updated_at: number;
}

interface EnrollmentContext {
  readonly instance: InstanceRow;
  readonly config: TournamentConfigSnapshotV2;
}

const TERMINAL_RESULTS = new Set<RegistrationStatus>([
  'cancelled',
  'refunded',
  'no-show',
  'eliminated',
  'finished',
]);
const REATTEMPT_STATUSES = new Set<RegistrationStatus>([
  'cancelled',
  'refunded',
  'no-show',
]);

export class TournamentEnrollmentRepository {
  constructor(
    private readonly database: PokerDatabase,
    private readonly economy: EconomyRepository,
    private readonly clock: () => number = Date.now,
  ) {}

  readTournamentEngagement(
    tournamentId: string,
    profileId: string,
  ): TournamentRegistrationEngagement | null {
    this.assertIdentity(tournamentId);
    this.assertIdentity(profileId);
    const row = this.database.db.prepare(`
      SELECT registration.instance_id AS tournament_id,
             registration.profile_id,
             attempt.request_id,
             registration.status
      FROM tournament_registration AS registration
      INNER JOIN tournament_registration_attempt AS attempt
        ON attempt.instance_id = registration.instance_id
       AND attempt.profile_id = registration.profile_id
       AND attempt.registration_attempt = registration.registration_attempt
      WHERE registration.instance_id = ?
        AND registration.profile_id = ?
    `).get(tournamentId, profileId) as {
      tournament_id: string;
      profile_id: string;
      request_id: string;
      status: TournamentRegistrationStatus;
    } | undefined;
    if (!row) return null;
    return {
      tournamentId: row.tournament_id,
      profileId: row.profile_id,
      requestId: row.request_id,
      status: row.status,
    };
  }

  registerPreStart(
    input: RegisterPreStartInput,
  ): EnrollmentReservationResult {
    const at = input.at ?? this.clock();
    this.assertIdentity(input.tournamentId);
    this.assertIdentity(input.profileId);
    this.assertRequestId(input.requestId);
    this.assertPublicPlayer(input.publicPlayer);
    this.assertTimestamp(at);

    return this.database.transaction((): EnrollmentReservationResult => {
      const replay = this.findReplay(
        input.tournamentId,
        input.profileId,
        input.requestId,
      );
      if (replay) return this.toReservationResult(replay);

      const context = this.requireContext(input.tournamentId);
      const { instance } = context;
      if (
        instance.status !== 'registering'
        || instance.registration_state !== 'open-prestart'
        || at < instance.registration_opens_at
        || (
          instance.starts_at !== null
            ? at >= instance.starts_at
            : instance.manual_expires_at === null
              || at >= instance.manual_expires_at
        )
      ) {
        throw new TournamentEnrollmentError('registration-closed');
      }
      this.requireProfileSnapshot(input.profileId);
      if (input.publicPlayer.id !== input.profileId) {
        throw new TournamentEnrollmentError('invalid-input');
      }
      this.assertPrestartCapacity(instance);
      const current = this.getRegistration(
        input.tournamentId,
        input.profileId,
      );
      const registrationAttempt = this.nextAttempt(current);
      const economyEntry = this.reserveEconomy(
        context,
        input.profileId,
        registrationAttempt,
        at,
      );
      const economyEntryAttempt = economyEntry?.entryAttempt ?? null;
      const publicPlayerJson = JSON.stringify(input.publicPlayer);

      this.persistNewAttempt({
        instanceId: input.tournamentId,
        profileId: input.profileId,
        publicPlayerJson,
        requestId: input.requestId,
        status: 'registered',
        registrationAttempt,
        economyEntryAttempt,
        at,
        current,
      });
      return {
        status: 'reserved',
        key: this.makeKey(
          input.profileId,
          input.requestId,
          registrationAttempt,
          instance.economy_mode,
          economyEntry,
        ),
        acceptedAt: at,
      };
    });
  }

  reserveLateMttEntry(
    profileId: string,
    tournamentId: string,
    requestId: string,
    candidateCloseOwnerToken: string,
  ): EnrollmentReservationResult {
    const at = this.clock();
    for (const value of [
      profileId,
      tournamentId,
      candidateCloseOwnerToken,
    ]) {
      this.assertIdentity(value);
    }
    this.assertRequestId(requestId);
    return this.database.transaction((): EnrollmentReservationResult => {
      const replay = this.findReplay(tournamentId, profileId, requestId);
      if (replay) return this.toReservationResult(replay);

      const context = this.requireContext(tournamentId);
      const { instance } = context;
      if (
        instance.status !== 'running'
        || instance.registration_state !== 'open-late'
      ) {
        throw new TournamentEnrollmentError('registration-closed');
      }
      if (!context.config.lateRegistration.enabled) {
        throw new TournamentEnrollmentError('registration-closed');
      }
      if (instance.actual_started_at === null) {
        throw new TournamentEnrollmentError('financial-invariant');
      }
      let closesAt: number;
      try {
        closesAt = lateRegistrationClosesAt(
          context.config.structure.segments,
          instance.actual_started_at,
          context.config.lateRegistration.durationLevels,
        );
      } catch {
        throw new TournamentEnrollmentError('financial-invariant');
      }
      if (!Number.isSafeInteger(closesAt) || at >= closesAt) {
        throw new TournamentEnrollmentError('registration-closed');
      }
      if (
        instance.committed_entrants === null
        || instance.committed_entrants + instance.pending_late_entrants
          >= instance.max_entrants
      ) {
        throw new TournamentEnrollmentError('capacity');
      }
      const current = this.getRegistration(tournamentId, profileId);
      const registrationAttempt = this.nextAttempt(current);
      const economyEntry = this.reserveEconomy(
        context,
        profileId,
        registrationAttempt,
        at,
      );
      const economyEntryAttempt = economyEntry?.entryAttempt ?? null;
      const publicPlayerJson = current?.public_player_json
        ?? JSON.stringify(this.requireProfileSnapshot(profileId));
      this.persistNewAttempt({
        instanceId: tournamentId,
        profileId,
        publicPlayerJson,
        requestId,
        status: 'late-pending',
        registrationAttempt,
        economyEntryAttempt,
        at,
        current,
      });

      const counter = this.database.db.prepare(`
        UPDATE tournament_instance
        SET pending_late_entrants = pending_late_entrants + 1,
            updated_at = ?
        WHERE id = ?
          AND status = 'running'
          AND registration_state = 'open-late'
          AND committed_entrants IS NOT NULL
          AND committed_entrants + pending_late_entrants < max_entrants
      `).run(at, tournamentId);
      if (counter.changes !== 1) {
        throw new TournamentEnrollmentError('capacity');
      }

      let closeClaim: RegistrationCloseClaim | undefined;
      const fullClaim = this.database.db.prepare(`
        UPDATE tournament_instance
        SET registration_state = 'closing',
            registration_close_reason = 'full',
            registration_generation = registration_generation + 1,
            registration_owner_token = ?,
            updated_at = ?
        WHERE id = ?
          AND status = 'running'
          AND registration_state = 'open-late'
          AND committed_entrants + pending_late_entrants = max_entrants
      `).run(candidateCloseOwnerToken, at, tournamentId);
      if (fullClaim.changes === 1) {
        const closed = this.requireInstance(tournamentId);
        closeClaim = this.closeClaimFromInstance(closed);
        this.attachCloseClaim(
          tournamentId,
          profileId,
          registrationAttempt,
          closeClaim,
          at,
        );
      }

      return {
        status: 'reserved',
        key: this.makeKey(
          profileId,
          requestId,
          registrationAttempt,
          instance.economy_mode,
          economyEntry,
        ),
        acceptedAt: at,
        ...(closeClaim ? { closeClaim } : {}),
      };
    });
  }

  commitLateMttBatch(
    tournamentId: string,
    entries: readonly LateEntryKey[],
    tableCount = 1,
  ): void {
    this.assertIdentity(tournamentId);
    if (
      entries.length === 0
      || new Set(entries.map(entry => entry.profileId)).size !== entries.length
      || !Number.isSafeInteger(tableCount)
      || tableCount < 1
    ) {
      throw new TournamentEnrollmentError('invalid-input');
    }
    const at = this.clock();
    this.database.transaction(() => {
      const instance = this.requireInstance(tournamentId);
      if (
        instance.status !== 'running'
        || !['open-late', 'closing'].includes(instance.registration_state)
      ) {
        throw new TournamentEnrollmentError('invalid-state');
      }

      const rows = entries.map(entry => this.requireExactAttempt(
        tournamentId,
        entry,
      ));
      if (rows.every(({ registration, attempt, economyEntry }) => (
        registration.status === 'seated'
        && attempt.status === 'seated'
        && (
          registration.economy_entry_attempt === null
          || economyEntry?.status === 'started'
        )
      ))) {
        return;
      }
      if (rows.some(({ registration, attempt, economyEntry }) => (
        registration.status !== 'late-pending'
        || attempt.status !== 'late-pending'
        || (
          registration.economy_entry_attempt !== null
          && economyEntry?.status !== 'reserved'
        )
      ))) {
        throw new TournamentEnrollmentError('stale-attempt');
      }
      this.assertFreerollEscrowIfNeeded(instance);

      for (const row of rows) {
        if (row.key.economyMode === 'wallet') {
          if (!row.economyEntry) {
            throw new TournamentEnrollmentError('financial-invariant');
          }
          this.economy.startMttEntryInTransaction(
            row.economyEntry.id,
            row.key.economyEntryAttempt,
            at,
          );
        }
      }
      for (const { key } of rows) {
        const updated = this.database.db.prepare(`
          UPDATE tournament_registration
          SET status = 'seated', ever_seated = 1, updated_at = ?
          WHERE instance_id = ? AND profile_id = ?
            AND registration_attempt = ?
            AND status = 'late-pending'
        `).run(at, tournamentId, key.profileId, key.registrationAttempt);
        if (updated.changes !== 1) {
          throw new TournamentEnrollmentError('stale-attempt');
        }
      }
      const counters = this.database.db.prepare(`
        UPDATE tournament_instance
        SET pending_late_entrants = pending_late_entrants - ?,
            committed_entrants = committed_entrants + ?,
            ever_multi_table = CASE
              WHEN ever_multi_table = 1 OR ? >= 2 THEN 1
              ELSE 0
            END,
            updated_at = ?
        WHERE id = ?
          AND status = 'running'
          AND registration_state IN ('open-late', 'closing')
          AND committed_entrants IS NOT NULL
          AND pending_late_entrants >= ?
          AND committed_entrants + ? <= max_entrants
      `).run(
        entries.length,
        entries.length,
        tableCount,
        at,
        tournamentId,
        entries.length,
        entries.length,
      );
      if (counters.changes !== 1) {
        throw new TournamentEnrollmentError('stale-attempt');
      }
    });
  }

  releaseLateMttEntry(
    tournamentId: string,
    entry: LateEntryKey,
    closeCandidate: DynamicCloseCandidate | null,
  ): LateEntryReleaseResult {
    this.assertIdentity(tournamentId);
    return this.database.transaction((): LateEntryReleaseResult => {
      const instance = this.requireInstance(tournamentId);
      const exact = this.requireExactAttempt(tournamentId, entry);
      if (exact.registration.status !== 'late-pending') {
        if (
          exact.registration.registration_attempt === entry.registrationAttempt
          && (
            exact.registration.status === 'refunded'
            || (
              entry.economyMode === 'freeroll'
              && exact.registration.status === 'cancelled'
            )
          )
        ) {
          return { status: 'already-released' };
        }
        if (TERMINAL_RESULTS.has(exact.registration.status)) {
          return {
            status: 'terminal',
            resultCode: exact.registration.status as
              | 'cancelled'
              | 'refunded'
              | 'no-show'
              | 'eliminated'
              | 'finished',
          };
        }
        throw new TournamentEnrollmentError('stale-attempt');
      }
      if (
        instance.status !== 'running'
        || !['open-late', 'closing'].includes(instance.registration_state)
      ) {
        throw new TournamentEnrollmentError('invalid-state');
      }
      const at = this.clock();
      if (entry.economyMode === 'wallet') {
        if (!exact.economyEntry || exact.economyEntry.status !== 'reserved') {
          throw new TournamentEnrollmentError('stale-attempt');
        }
        this.economy.refundMttEntryInTransaction(
          entry.entryId,
          entry.economyEntryAttempt,
          'SNG_ENTRY_REFUND',
          at,
        );
      }
      const terminalStatus = entry.economyMode === 'wallet'
        ? 'refunded'
        : 'cancelled';
      const registration = this.database.db.prepare(`
        UPDATE tournament_registration
        SET status = ?, updated_at = ?
        WHERE instance_id = ? AND profile_id = ?
          AND registration_attempt = ?
          AND status = 'late-pending'
      `).run(
        terminalStatus,
        at,
        tournamentId,
        entry.profileId,
        entry.registrationAttempt,
      );
      if (registration.changes !== 1) {
        throw new TournamentEnrollmentError('stale-attempt');
      }
      const counter = this.database.db.prepare(`
        UPDATE tournament_instance
        SET pending_late_entrants = pending_late_entrants - 1,
            updated_at = ?
        WHERE id = ?
          AND status = 'running'
          AND registration_state IN ('open-late', 'closing')
          AND pending_late_entrants >= 1
      `).run(at, tournamentId);
      if (counter.changes !== 1) {
        throw new TournamentEnrollmentError('stale-attempt');
      }

      let closeClaim: RegistrationCloseClaim | null = null;
      if (
        instance.registration_state === 'open-late'
        && closeCandidate
      ) {
        const claimed = this.database.db.prepare(`
          UPDATE tournament_instance
          SET registration_state = 'closing',
              registration_close_reason = ?,
              registration_generation = registration_generation + 1,
              registration_owner_token = ?,
              updated_at = ?
          WHERE id = ?
            AND status = 'running'
            AND registration_state = 'open-late'
            AND registration_generation = ?
            AND registration_owner_token IS NULL
        `).run(
          closeCandidate.reason,
          closeCandidate.ownerToken,
          at,
          tournamentId,
          closeCandidate.expectedGeneration,
        );
        if (claimed.changes === 1) {
          closeClaim = this.closeClaimFromInstance(
            this.requireInstance(tournamentId),
          );
          this.attachCloseClaim(
            tournamentId,
            entry.profileId,
            entry.registrationAttempt,
            closeClaim,
            at,
          );
        }
      }
      const currentInstance = this.requireInstance(tournamentId);
      if (currentInstance.registration_state === 'closing') {
        closeClaim ??= this.closeClaimFromInstance(currentInstance);
        return { status: 'closing', closeClaim };
      }
      return {
        status: 'released',
        ...(closeClaim ? { closeClaim } : {}),
      };
    });
  }

  claimStartingRoster(
    input: StartingRosterClaimInput,
  ): StartingRosterClaimResult {
    const at = input.at ?? this.clock();
    this.assertIdentity(input.tournamentId);
    this.assertIdentity(input.ownerId);
    this.assertPositiveInteger(input.startAttempt);
    this.assertTimestamp(at);
    const checkedIn = new Set(input.checkedInProfileIds);
    if (
      checkedIn.size !== input.checkedInProfileIds.length
      || [...checkedIn].some(profileId => !this.isIdentity(profileId))
    ) {
      throw new TournamentEnrollmentError('invalid-input');
    }

    return this.database.transaction(() => {
      const context = this.requireContext(input.tournamentId);
      const { instance } = context;
      if (
        instance.status !== 'starting'
        || instance.registration_state !== 'locked-for-start'
        || instance.start_attempt !== input.startAttempt
        || instance.start_owner_id !== input.ownerId
      ) {
        throw new TournamentEnrollmentError('stale-attempt');
      }
      const registrations = this.listCurrentRegistrations(input.tournamentId);
      const eligible = registrations.filter(row => (
        row.status === 'registered' || row.status === 'seat-claimed'
      ));
      for (const profileId of checkedIn) {
        if (!eligible.some(row => row.profile_id === profileId)) {
          throw new TournamentEnrollmentError('stale-attempt');
        }
      }
      this.assertFreerollEscrowIfNeeded(instance);

      const selected: LateEntryKey[] = [];
      for (const row of eligible) {
        const attempt = this.requireAttempt(
          input.tournamentId,
          row.profile_id,
          row.registration_attempt,
        );
        const key = this.makeKeyFromRows(instance, row, attempt);
        if (checkedIn.has(row.profile_id)) {
          if (row.status === 'registered') {
            const updated = this.database.db.prepare(`
              UPDATE tournament_registration
              SET status = 'seat-claimed', updated_at = ?
              WHERE instance_id = ? AND profile_id = ?
                AND registration_attempt = ?
                AND status = 'registered'
            `).run(
              at,
              input.tournamentId,
              row.profile_id,
              row.registration_attempt,
            );
            if (updated.changes !== 1) {
              throw new TournamentEnrollmentError('stale-attempt');
            }
          }
          if (key.economyMode === 'wallet') {
            const economyEntry = this.requireEconomyEntry(
              input.tournamentId,
              row.profile_id,
              key.economyEntryAttempt,
            );
            if (economyEntry.status !== 'reserved') {
              throw new TournamentEnrollmentError('financial-invariant');
            }
          }
          selected.push(key);
          continue;
        }
        if (row.status === 'seat-claimed') {
          throw new TournamentEnrollmentError('stale-attempt');
        }
        if (key.economyMode === 'wallet') {
          this.economy.refundMttEntryInTransaction(
            key.entryId,
            key.economyEntryAttempt,
            'SNG_ENTRY_REFUND',
            at,
          );
        }
        const noShowStatus = key.economyMode === 'wallet'
          ? 'refunded'
          : 'no-show';
        const updated = this.database.db.prepare(`
          UPDATE tournament_registration
          SET status = ?, updated_at = ?
          WHERE instance_id = ? AND profile_id = ?
            AND registration_attempt = ?
            AND status = 'registered'
        `).run(
          noShowStatus,
          at,
          input.tournamentId,
          row.profile_id,
          row.registration_attempt,
        );
        if (updated.changes !== 1) {
          throw new TournamentEnrollmentError('stale-attempt');
        }
      }
      return { entries: selected };
    });
  }

  listStartingCandidates(tournamentId: string): PublicTournamentPlayer[] {
    this.assertIdentity(tournamentId);
    return this.listCurrentRegistrations(tournamentId)
      .filter(row => row.status === 'registered' || row.status === 'seat-claimed')
      .map(row => {
        const player = JSON.parse(row.public_player_json) as PublicTournamentPlayer;
        this.assertPublicPlayer(player);
        return player;
      });
  }

  /**
   * 아직 착석하지 못한 지각 등록(late-pending)을 취소·환불에 쓸 수 있는 키와 함께
   * 열거한다. `listStartingCandidates`와 같은 "현재 attempt" 읽기 계약이고, 반환한
   * key는 그대로 `releaseLateMttEntry`에 넘길 수 있다.
   *
   * 마감(freeze) CAS가 `pending_late_entrants = 0`을 요구하므로 이 목록을 비우지
   * 않고서는 등록 창을 닫을 수 없다 — 마감 드라이버의 필수 입력이다.
   */
  listPendingLateEntries(tournamentId: string): Array<{
    key: LateEntryKey;
    player: PublicTournamentPlayer;
  }> {
    this.assertIdentity(tournamentId);
    const instance = this.requireInstance(tournamentId);
    return this.listCurrentRegistrations(tournamentId)
      .filter(row => row.status === 'late-pending')
      .map(row => {
        const attempt = this.requireAttempt(
          tournamentId,
          row.profile_id,
          row.registration_attempt,
        );
        const player = JSON.parse(row.public_player_json) as PublicTournamentPlayer;
        this.assertPublicPlayer(player);
        return {
          key: this.makeKeyFromRows(instance, row, attempt),
          player,
        };
      });
  }

  commitStartingRoster(input: CommitStartingRosterInput): boolean {
    this.assertIdentity(input.tournamentId);
    this.assertIdentity(input.ownerId);
    this.assertPositiveInteger(input.startAttempt);
    this.assertPositiveInteger(input.humanEntrants);
    this.assertPositiveInteger(input.initialEntrants);
    this.assertNonnegativeInteger(input.initialBotEntrants);
    this.assertPositiveInteger(input.committedEntrants);
    this.assertTimestamp(input.actualStartedAt);
    if (
      input.initialEntrants !== input.committedEntrants
      || input.humanEntrants + input.initialBotEntrants
        !== input.committedEntrants
    ) {
      throw new TournamentEnrollmentError('invalid-input');
    }
    return this.database.transaction(() => {
      const instance = this.requireInstance(input.tournamentId);
      if (
        instance.status !== 'starting'
        || instance.registration_state !== 'locked-for-start'
        || instance.start_attempt !== input.startAttempt
        || instance.start_owner_id !== input.ownerId
      ) {
        return false;
      }
      const claimed = this.database.db.prepare(`
        SELECT COUNT(*) AS count
        FROM tournament_registration
        WHERE instance_id = ? AND status = 'seat-claimed'
      `).get(input.tournamentId) as { count: number };
      if (claimed.count !== input.humanEntrants) return false;

      const registrations = this.database.db.prepare(`
        UPDATE tournament_registration
        SET status = 'seated', ever_seated = 1, updated_at = ?
        WHERE instance_id = ? AND status = 'seat-claimed'
      `).run(input.actualStartedAt, input.tournamentId);
      const attempts = this.database.db.prepare(`
        SELECT COUNT(*) AS count
        FROM tournament_registration_attempt
        WHERE instance_id = ? AND status = 'seated'
      `).get(input.tournamentId) as { count: number };
      if (
        registrations.changes !== input.humanEntrants
        || attempts.count !== input.humanEntrants
      ) {
        throw new TournamentEnrollmentError('stale-attempt');
      }
      const committed = this.database.db.prepare(`
        UPDATE tournament_instance
        SET status = 'running',
            status_reason = NULL,
            registration_state = 'open-late',
            registration_close_reason = NULL,
            initial_entrants = ?,
            initial_bot_entrants = ?,
            committed_entrants = ?,
            ever_multi_table = ?,
            actual_started_at = ?,
            start_owner_id = NULL,
            start_lease_until = NULL,
            next_retry_at = NULL,
            updated_at = ?
        WHERE id = ?
          AND status = 'starting'
          AND registration_state = 'locked-for-start'
          AND start_attempt = ?
          AND start_owner_id = ?
          AND start_lease_until IS NOT NULL
      `).run(
        input.initialEntrants,
        input.initialBotEntrants,
        input.committedEntrants,
        input.everMultiTable ? 1 : 0,
        input.actualStartedAt,
        input.actualStartedAt,
        input.tournamentId,
        input.startAttempt,
        input.ownerId,
      );
      if (committed.changes !== 1) {
        throw new TournamentEnrollmentError('stale-attempt');
      }
      return true;
    });
  }

  rollbackStartClaim(input: RollbackStartClaimInput): void {
    const at = input.at ?? this.clock();
    this.assertIdentity(input.tournamentId);
    this.assertIdentity(input.ownerId);
    this.assertPositiveInteger(input.startAttempt);
    this.assertTimestamp(at);
    this.database.transaction(() => {
      const instance = this.requireInstance(input.tournamentId);
      if (
        instance.status !== 'starting'
        || instance.registration_state !== 'locked-for-start'
        || instance.start_attempt !== input.startAttempt
        || instance.start_owner_id !== input.ownerId
      ) {
        throw new TournamentEnrollmentError('stale-attempt');
      }
      this.database.db.prepare(`
        UPDATE tournament_registration
        SET status = 'registered', updated_at = ?
        WHERE instance_id = ? AND status = 'seat-claimed'
      `).run(at, input.tournamentId);

      const restore = input.restore ?? {
        status: 'registering' as const,
        statusReason: null,
        nextRetryAt: null,
      };
      if (
        restore.status === 'registering'
        && (restore.statusReason !== null || restore.nextRetryAt !== null)
      ) {
        throw new TournamentEnrollmentError('invalid-input');
      }
      const rolledBack = this.database.db.prepare(`
        UPDATE tournament_instance
        SET status = ?,
            status_reason = ?,
            registration_state = ?,
            registration_close_reason = NULL,
            registration_owner_token = NULL,
            next_retry_at = ?,
            start_owner_id = NULL,
            start_lease_until = NULL,
            updated_at = ?
        WHERE id = ?
          AND status = 'starting'
          AND registration_state = 'locked-for-start'
          AND start_attempt = ?
          AND start_owner_id = ?
      `).run(
        restore.status,
        restore.statusReason,
        restore.status === 'registering'
          ? 'open-prestart'
          : 'locked-for-start',
        restore.nextRetryAt,
        at,
        input.tournamentId,
        input.startAttempt,
        input.ownerId,
      );
      if (rolledBack.changes !== 1) {
        throw new TournamentEnrollmentError('stale-attempt');
      }
    });
  }

  private reserveEconomy(
    context: EnrollmentContext,
    profileId: string,
    attempt: number,
    at: number,
  ): SngEntry | null {
    if (context.instance.economy_mode === 'freeroll') {
      this.assertFreerollEscrow(context);
      return null;
    }
    if (context.config.economy.mode !== 'wallet') {
      throw new TournamentEnrollmentError('financial-invariant');
    }
    const product: MttInstanceProduct = {
      instanceId: context.instance.id,
      productVersion: context.config.economy.productVersion,
      buyIn: context.config.economy.buyIn,
      fee: context.config.economy.fee,
    };
    return this.economy.reserveMttEntryInTransaction(
      profileId,
      product,
      this.nextEconomyEntryAttempt(context.instance.id, profileId),
      at,
    );
  }

  private persistNewAttempt(values: {
    instanceId: string;
    profileId: string;
    publicPlayerJson: string;
    requestId: string;
    status: 'registered' | 'late-pending';
    registrationAttempt: number;
    economyEntryAttempt: number | null;
    at: number;
    current: RegistrationRow | null;
  }): void {
    if (!values.current) {
      this.database.db.prepare(`
        INSERT INTO tournament_registration (
          instance_id, profile_id, public_player_json, status, ever_seated,
          registration_attempt, economy_entry_attempt,
          registered_at, updated_at
        ) VALUES (?, ?, ?, ?, 0, ?, ?, ?, ?)
      `).run(
        values.instanceId,
        values.profileId,
        values.publicPlayerJson,
        values.status,
        values.registrationAttempt,
        values.economyEntryAttempt,
        values.at,
        values.at,
      );
      this.insertAttempt(values);
      return;
    }
    this.insertAttempt(values);
    const updated = this.database.db.prepare(`
      UPDATE tournament_registration
      SET public_player_json = ?,
          status = ?,
          registration_attempt = ?,
          economy_entry_attempt = ?,
          registered_at = ?,
          updated_at = ?
      WHERE instance_id = ? AND profile_id = ?
        AND registration_attempt = ?
        AND status IN ('no-show', 'cancelled', 'refunded')
        AND ever_seated = 0
    `).run(
      values.publicPlayerJson,
      values.status,
      values.registrationAttempt,
      values.economyEntryAttempt,
      values.at,
      values.at,
      values.instanceId,
      values.profileId,
      values.registrationAttempt - 1,
    );
    if (updated.changes !== 1) {
      throw new TournamentEnrollmentError('stale-attempt');
    }
  }

  private insertAttempt(values: {
    instanceId: string;
    profileId: string;
    requestId: string;
    status: 'registered' | 'late-pending';
    registrationAttempt: number;
    economyEntryAttempt: number | null;
    at: number;
  }): void {
    this.database.db.prepare(`
      INSERT INTO tournament_registration_attempt (
        instance_id, profile_id, registration_attempt, request_id,
        economy_entry_attempt, status,
        close_generation, close_owner_token, close_reason,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, NULL, NULL, NULL, ?, ?)
    `).run(
      values.instanceId,
      values.profileId,
      values.registrationAttempt,
      values.requestId,
      values.economyEntryAttempt,
      values.status,
      values.at,
      values.at,
    );
  }

  private requireExactAttempt(
    instanceId: string,
    key: LateEntryKey,
  ): {
    key: LateEntryKey;
    registration: RegistrationRow;
    attempt: AttemptRow;
    economyEntry: SngEntry | null;
  } {
    const registration = this.getRegistration(instanceId, key.profileId);
    if (
      !registration
      || registration.registration_attempt !== key.registrationAttempt
      || registration.economy_entry_attempt !== (
        key.economyMode === 'wallet' ? key.economyEntryAttempt : null
      )
    ) {
      throw new TournamentEnrollmentError('stale-attempt');
    }
    const attempt = this.requireAttempt(
      instanceId,
      key.profileId,
      key.registrationAttempt,
    );
    if (
      attempt.request_id !== key.requestId
      || attempt.economy_entry_attempt !== registration.economy_entry_attempt
    ) {
      throw new TournamentEnrollmentError('stale-attempt');
    }
    const instance = this.requireInstance(instanceId);
    if (instance.economy_mode !== key.economyMode) {
      throw new TournamentEnrollmentError('stale-attempt');
    }
    const economyEntry = key.economyMode === 'wallet'
      ? this.requireEconomyEntry(
        instanceId,
        key.profileId,
        key.economyEntryAttempt,
      )
      : null;
    if (key.economyMode === 'wallet') {
      if (!economyEntry || economyEntry.id !== key.entryId) {
        throw new TournamentEnrollmentError('stale-attempt');
      }
      this.assertEconomyEntryMatchesInstance(instance, economyEntry);
    }
    return { key, registration, attempt, economyEntry };
  }

  private findReplay(
    instanceId: string,
    profileId: string,
    requestId: string,
  ): AttemptRow | null {
    const row = this.database.db.prepare(`
      SELECT instance_id, profile_id, registration_attempt, request_id,
             economy_entry_attempt, status, close_generation,
             close_owner_token, close_reason, created_at, updated_at
      FROM tournament_registration_attempt
      WHERE instance_id = ? AND profile_id = ? AND request_id = ?
    `).get(instanceId, profileId, requestId) as AttemptRow | undefined;
    return row ?? null;
  }

  private toReservationResult(
    attempt: AttemptRow,
  ): EnrollmentReservationResult {
    const instance = this.requireInstance(attempt.instance_id);
    const registration = this.getRegistration(
      attempt.instance_id,
      attempt.profile_id,
    );
    const key = this.makeKeyFromRows(
      instance,
      registration && registration.registration_attempt
        === attempt.registration_attempt
        ? registration
        : {
            instance_id: attempt.instance_id,
            profile_id: attempt.profile_id,
            public_player_json: '{}',
            status: attempt.status,
            ever_seated: 0,
            registration_attempt: attempt.registration_attempt,
            economy_entry_attempt: attempt.economy_entry_attempt,
            registered_at: attempt.created_at,
            updated_at: attempt.updated_at,
          },
      attempt,
    );
    const closeClaim = attempt.close_generation === null
      ? undefined
      : {
          generation: attempt.close_generation,
          ownerToken: attempt.close_owner_token as string,
          reason: attempt.close_reason as NormalRegistrationCloseReason,
        };
    if (attempt.status === 'seated') {
      return { status: 'seated', key, acceptedAt: attempt.created_at };
    }
    if (TERMINAL_RESULTS.has(attempt.status)) {
      return {
        status: 'terminal',
        key,
        acceptedAt: attempt.created_at,
        resultCode: attempt.status as
          | 'cancelled'
          | 'refunded'
          | 'no-show'
          | 'eliminated'
          | 'finished',
      };
    }
    return {
      status: 'reserved',
      key,
      acceptedAt: attempt.created_at,
      ...(closeClaim ? { closeClaim } : {}),
    };
  }

  private makeKeyFromRows(
    instance: InstanceRow,
    registration: RegistrationRow,
    attempt: AttemptRow,
  ): LateEntryKey {
    if (instance.economy_mode === 'freeroll') {
      if (
        registration.economy_entry_attempt !== null
        || attempt.economy_entry_attempt !== null
      ) {
        throw new TournamentEnrollmentError('financial-invariant');
      }
      return {
        profileId: attempt.profile_id,
        economyMode: 'freeroll',
        requestId: attempt.request_id,
        registrationAttempt: attempt.registration_attempt,
      };
    }
    if (
      attempt.economy_entry_attempt === null
      || registration.economy_entry_attempt !== attempt.economy_entry_attempt
    ) {
      throw new TournamentEnrollmentError('financial-invariant');
    }
    const entry = this.requireEconomyEntry(
      instance.id,
      attempt.profile_id,
      attempt.economy_entry_attempt,
    );
    this.assertEconomyEntryMatchesInstance(instance, entry);
    return {
      profileId: attempt.profile_id,
      economyMode: 'wallet',
      requestId: attempt.request_id,
      registrationAttempt: attempt.registration_attempt,
      economyEntryAttempt: attempt.economy_entry_attempt,
      entryId: entry.id,
    };
  }

  private makeKey(
    profileId: string,
    requestId: string,
    registrationAttempt: number,
    economyMode: EconomyMode,
    economyEntry: SngEntry | null,
  ): LateEntryKey {
    if (economyMode === 'freeroll') {
      return {
        profileId,
        economyMode,
        requestId,
        registrationAttempt,
      };
    }
    if (!economyEntry) {
      throw new TournamentEnrollmentError('financial-invariant');
    }
    return {
      profileId,
      economyMode,
      requestId,
      registrationAttempt,
      economyEntryAttempt: economyEntry.entryAttempt,
      entryId: economyEntry.id,
    };
  }

  private requireEconomyEntry(
    instanceId: string,
    profileId: string,
    economyEntryAttempt: number,
  ): SngEntry {
    const row = this.database.db.prepare(`
      SELECT id FROM sng_entries
      WHERE tournament_id = ? AND profile_id = ? AND entry_attempt = ?
    `).get(
      instanceId,
      profileId,
      economyEntryAttempt,
    ) as { id: string } | undefined;
    if (!row) throw new TournamentEnrollmentError('financial-invariant');
    const entry = this.database.db.prepare(`
      SELECT id, tournament_id, room_id, profile_id, buy_in, fee,
             status, place, prize, start_attempt, entry_attempt
      FROM sng_entries WHERE id = ?
    `).get(row.id) as {
      id: string;
      tournament_id: string;
      room_id: string;
      profile_id: string;
      buy_in: number;
      fee: number;
      status: SngEntry['status'];
      place: number | null;
      prize: number;
      start_attempt: number;
      entry_attempt: number;
    };
    return {
      id: entry.id,
      tournamentId: entry.tournament_id,
      roomId: entry.room_id,
      profileId: entry.profile_id,
      buyIn: entry.buy_in,
      fee: entry.fee,
      status: entry.status,
      place: entry.place,
      prize: entry.prize,
      startAttempt: entry.start_attempt,
      entryAttempt: entry.entry_attempt,
    };
  }

  private nextAttempt(current: RegistrationRow | null): number {
    if (!current) return 1;
    if (
      !REATTEMPT_STATUSES.has(current.status)
      || current.ever_seated !== 0
    ) {
      throw new TournamentEnrollmentError('active-registration');
    }
    return current.registration_attempt + 1;
  }

  private assertEconomyEntryMatchesInstance(
    instance: InstanceRow,
    entry: SngEntry,
  ): void {
    const config = this.parseConfig(instance);
    if (
      config.economy.mode !== 'wallet'
      || entry.tournamentId !== instance.id
      || entry.roomId !== instance.id
      || entry.buyIn !== config.economy.buyIn
      || entry.fee !== config.economy.fee
    ) {
      throw new TournamentEnrollmentError('financial-invariant');
    }
  }

  private nextEconomyEntryAttempt(
    instanceId: string,
    profileId: string,
  ): number {
    const row = this.database.db.prepare(`
      SELECT COALESCE(MAX(entry_attempt), 0) AS attempt
      FROM sng_entries
      WHERE tournament_id = ? AND profile_id = ?
    `).get(instanceId, profileId) as { attempt: number };
    this.assertNonnegativeInteger(row.attempt);
    return row.attempt + 1;
  }

  private assertPrestartCapacity(instance: InstanceRow): void {
    const row = this.database.db.prepare(`
      SELECT COUNT(*) AS count
      FROM tournament_registration
      WHERE instance_id = ?
        AND status IN ('registered', 'seat-claimed', 'late-pending', 'seated')
    `).get(instance.id) as { count: number };
    this.assertNonnegativeInteger(row.count);
    if (row.count >= instance.max_entrants) {
      throw new TournamentEnrollmentError('capacity');
    }
  }

  private assertFreerollEscrowIfNeeded(instance: InstanceRow): void {
    if (instance.economy_mode !== 'freeroll') return;
    this.assertFreerollEscrow({
      instance,
      config: this.parseConfig(instance),
    });
  }

  private assertFreerollEscrow(context: EnrollmentContext): void {
    if (
      context.config.economy.mode !== 'freeroll'
      || context.config.prizePool.kind !== 'promotion-funded'
    ) {
      throw new TournamentEnrollmentError('financial-invariant');
    }
    const row = this.database.db.prepare(`
      SELECT account_id, amount, status
      FROM tournament_prize_escrow
      WHERE instance_id = ?
    `).get(context.instance.id) as {
      account_id: string;
      amount: number;
      status: string;
    } | undefined;
    if (
      !row
      || row.account_id !== context.config.economy.promotionAccountId
      || row.amount !== context.config.prizePool.totalPrize
      || row.status !== 'reserved'
    ) {
      throw new TournamentEnrollmentError('financial-invariant');
    }
  }

  private attachCloseClaim(
    instanceId: string,
    profileId: string,
    attempt: number,
    claim: RegistrationCloseClaim,
    at: number,
  ): void {
    const result = this.database.db.prepare(`
      UPDATE tournament_registration_attempt
      SET close_generation = ?, close_owner_token = ?, close_reason = ?,
          updated_at = ?
      WHERE instance_id = ? AND profile_id = ?
        AND registration_attempt = ?
        AND close_generation IS NULL
    `).run(
      claim.generation,
      claim.ownerToken,
      claim.reason,
      at,
      instanceId,
      profileId,
      attempt,
    );
    if (result.changes !== 1) {
      throw new TournamentEnrollmentError('stale-attempt');
    }
  }

  private closeClaimFromInstance(
    instance: InstanceRow,
  ): RegistrationCloseClaim {
    if (
      instance.registration_state !== 'closing'
      || instance.registration_owner_token === null
      || instance.registration_close_reason === null
      || [
        'late-reg-disabled',
        'tournament-cancelled',
        'tournament-completed',
      ].includes(instance.registration_close_reason)
    ) {
      throw new TournamentEnrollmentError('invalid-state');
    }
    return {
      generation: instance.registration_generation,
      ownerToken: instance.registration_owner_token,
      reason: instance.registration_close_reason as NormalRegistrationCloseReason,
    };
  }

  private requireProfileSnapshot(
    profileId: string,
  ): PublicTournamentPlayer {
    const row = this.database.db.prepare(`
      SELECT id, alias, avatar_id
      FROM profiles WHERE id = ?
    `).get(profileId) as {
      id: string;
      alias: string;
      avatar_id: string;
    } | undefined;
    if (!row) throw new TournamentEnrollmentError('not-found');
    return { id: row.id, name: row.alias, avatar: row.avatar_id };
  }

  private listCurrentRegistrations(instanceId: string): RegistrationRow[] {
    return this.database.db.prepare(`
      SELECT instance_id, profile_id, public_player_json, status, ever_seated,
             registration_attempt, economy_entry_attempt,
             registered_at, updated_at
      FROM tournament_registration
      WHERE instance_id = ?
      ORDER BY profile_id
    `).all(instanceId) as unknown as RegistrationRow[];
  }

  private getRegistration(
    instanceId: string,
    profileId: string,
  ): RegistrationRow | null {
    const row = this.database.db.prepare(`
      SELECT instance_id, profile_id, public_player_json, status, ever_seated,
             registration_attempt, economy_entry_attempt,
             registered_at, updated_at
      FROM tournament_registration
      WHERE instance_id = ? AND profile_id = ?
    `).get(instanceId, profileId) as RegistrationRow | undefined;
    return row ?? null;
  }

  private requireAttempt(
    instanceId: string,
    profileId: string,
    registrationAttempt: number,
  ): AttemptRow {
    const row = this.database.db.prepare(`
      SELECT instance_id, profile_id, registration_attempt, request_id,
             economy_entry_attempt, status, close_generation,
             close_owner_token, close_reason, created_at, updated_at
      FROM tournament_registration_attempt
      WHERE instance_id = ? AND profile_id = ?
        AND registration_attempt = ?
    `).get(
      instanceId,
      profileId,
      registrationAttempt,
    ) as AttemptRow | undefined;
    if (!row) throw new TournamentEnrollmentError('stale-attempt');
    return row;
  }

  private requireContext(instanceId: string): EnrollmentContext {
    const instance = this.requireInstance(instanceId);
    return { instance, config: this.parseConfig(instance) };
  }

  private requireInstance(instanceId: string): InstanceRow {
    const row = this.database.db.prepare(`
      SELECT id, status, registration_state, registration_close_reason,
             registration_generation, registration_owner_token,
             registration_opens_at, starts_at, manual_expires_at,
             economy_mode, min_entrants, max_entrants,
             committed_entrants, pending_late_entrants, ever_multi_table,
             config_json, start_attempt, start_owner_id, actual_started_at
      FROM tournament_instance
      WHERE id = ?
    `).get(instanceId) as InstanceRow | undefined;
    if (!row) throw new TournamentEnrollmentError('not-found');
    return row;
  }

  private parseConfig(instance: InstanceRow): TournamentConfigSnapshotV2 {
    let parsed: unknown;
    try {
      parsed = JSON.parse(instance.config_json);
    } catch {
      throw new TournamentEnrollmentError('financial-invariant');
    }
    if (!isRecord(parsed) || parsed.version !== 2) {
      throw new TournamentEnrollmentError('financial-invariant');
    }
    const config = parsed as unknown as TournamentConfigSnapshotV2;
    if (
      !isRecord(config.economy)
      || config.economy.mode !== instance.economy_mode
      || !isRecord(config.field)
      || config.field.maxEntrants !== instance.max_entrants
      || config.field.minEntrants !== instance.min_entrants
      || !isRecord(config.prizePool)
      || !isRecord(config.lateRegistration)
    ) {
      throw new TournamentEnrollmentError('financial-invariant');
    }
    if (
      config.economy.mode === 'wallet'
      && (
        !this.isPositiveInteger(config.economy.productVersion)
        || !this.isPositiveInteger(config.economy.buyIn)
        || !this.isPositiveInteger(config.economy.fee)
        || config.prizePool.kind !== 'entry-pool'
      )
    ) {
      throw new TournamentEnrollmentError('financial-invariant');
    }
    if (
      config.economy.mode === 'freeroll'
      && (
        config.economy.promotionAccountId !== 'global'
        || config.prizePool.kind !== 'promotion-funded'
        || !this.isPositiveInteger(config.prizePool.totalPrize)
      )
    ) {
      throw new TournamentEnrollmentError('financial-invariant');
    }
    return config;
  }

  private assertPublicPlayer(player: PublicTournamentPlayer): void {
    for (const value of [player.id, player.name, player.avatar]) {
      if (typeof value !== 'string' || value.length < 1 || value.length > 100) {
        throw new TournamentEnrollmentError('invalid-input');
      }
    }
  }

  private assertIdentity(value: string): void {
    if (!this.isIdentity(value)) {
      throw new TournamentEnrollmentError('invalid-input');
    }
  }

  private assertRequestId(value: string): void {
    if (!isUuidRequestId(value)) {
      throw new TournamentEnrollmentError('invalid-input');
    }
  }

  private isIdentity(value: unknown): value is string {
    return typeof value === 'string' && value.length >= 1 && value.length <= 200;
  }

  private assertTimestamp(value: number): void {
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new TournamentEnrollmentError('invalid-input');
    }
  }

  private assertPositiveInteger(value: number): void {
    if (!this.isPositiveInteger(value)) {
      throw new TournamentEnrollmentError('invalid-input');
    }
  }

  private isPositiveInteger(value: unknown): value is number {
    return Number.isSafeInteger(value) && (value as number) > 0;
  }

  private assertNonnegativeInteger(value: number): void {
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new TournamentEnrollmentError('financial-invariant');
    }
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
