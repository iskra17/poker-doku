import type { PublicProfile } from '@/lib/profile/types';
import { ECONOMY_RULES } from './economy-service';
import type { PokerDatabase } from './persistence/database';

export interface StoredProfileCreation {
  id: string;
  credentialHash: string;
  credentialLookup: string;
  recoveryHash: string;
  recoveryLookup: string;
  alias: string;
  avatarId: string;
  now: number;
}

export interface StoredAuthenticationProfile {
  profile: PublicProfile;
  verifier: string;
}

export interface StoredSecretRotation {
  credentialHash: string;
  credentialLookup: string;
  recoveryHash: string;
  recoveryLookup: string;
  now: number;
}

export type ProfileDeletionResult =
  | 'deleted'
  | 'not-found'
  | 'active-escrow';

export class ProfileRepository {
  constructor(private readonly database: PokerDatabase) {}

  hasAlias(alias: string): boolean {
    return this.database.db.prepare(`
      SELECT 1 FROM profiles WHERE alias = ?
    `).get(alias) !== undefined;
  }

  hasProfileId(profileId: string): boolean {
    return this.hasValue('id', profileId);
  }

  hasCredentialLookup(lookup: string): boolean {
    return this.hasValue('credential_lookup', lookup);
  }

  hasRecoveryLookup(lookup: string): boolean {
    return this.hasValue('recovery_lookup', lookup);
  }

  findRecoveryLookupByProfileId(profileId: string): string | null {
    const row = this.database.db.prepare(`
      SELECT recovery_lookup FROM profiles WHERE id = ?
    `).get(profileId) as { recovery_lookup: string } | undefined;
    return row?.recovery_lookup ?? null;
  }

  /** 소켓 접속 시 활동 지표 갱신 — 백오피스 관측용 (접속 횟수/마지막 활동 시각) */
  recordConnect(profileId: string, at: number): void {
    this.database.db.prepare(`
      UPDATE profiles
      SET connect_count = connect_count + 1, last_seen_at = ?
      WHERE id = ?
    `).run(at, profileId);
  }

  createWithWallet(profile: StoredProfileCreation): PublicProfile {
    return this.database.transaction(() => {
      this.database.db.prepare(`
        INSERT INTO profiles (
          id,
          credential_hash,
          credential_lookup,
          recovery_hash,
          recovery_lookup,
          alias,
          avatar_id,
          adult_confirmed_at,
          created_at,
          updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        profile.id,
        profile.credentialHash,
        profile.credentialLookup,
        profile.recoveryHash,
        profile.recoveryLookup,
        profile.alias,
        profile.avatarId,
        profile.now,
        profile.now,
        profile.now,
      );
      this.database.db.prepare(`
        INSERT INTO wallets (profile_id, balance, updated_at)
        VALUES (?, ?, ?)
      `).run(profile.id, ECONOMY_RULES.startingChips, profile.now);
      this.database.db.prepare(`
        INSERT INTO chip_ledger (
          id,
          profile_id,
          account,
          delta,
          reason,
          ref_id,
          idempotency_key,
          created_at
        ) VALUES (?, ?, 'wallet', ?, 'PROFILE_START', NULL, ?, ?)
      `).run(
        `ledger-profile-start:${profile.id}`,
        profile.id,
        ECONOMY_RULES.startingChips,
        `profile-start:${profile.id}`,
        profile.now,
      );

      return {
        id: profile.id,
        alias: profile.alias,
        avatarId: profile.avatarId,
        wallet: { balance: ECONOMY_RULES.startingChips, activeEscrow: 0 },
      };
    });
  }

  findByCredentialLookup(lookup: string): StoredAuthenticationProfile | null {
    return this.findByLookup('credential', lookup);
  }

  findByRecoveryLookup(lookup: string): StoredAuthenticationProfile | null {
    return this.findByLookup('recovery', lookup);
  }

  rotateSecrets(
    profileId: string,
    rotation: StoredSecretRotation,
    expectedRecoveryLookup: string,
  ): PublicProfile | null {
    return this.database.transaction(() => {
      const result = this.database.db.prepare(`
        UPDATE profiles
        SET
          credential_hash = ?,
          credential_lookup = ?,
          recovery_hash = ?,
          recovery_lookup = ?,
          updated_at = ?
        WHERE id = ? AND recovery_lookup = ?
      `).run(
        rotation.credentialHash,
        rotation.credentialLookup,
        rotation.recoveryHash,
        rotation.recoveryLookup,
        rotation.now,
        profileId,
        expectedRecoveryLookup,
      );
      return result.changes === 0
        ? null
        : this.requirePublicProfile(profileId);
    });
  }

  rotateRecovery(
    profileId: string,
    rotation: Pick<
      StoredSecretRotation,
      'recoveryHash' | 'recoveryLookup' | 'now'
    >,
    expectedRecoveryLookup: string,
  ): PublicProfile | null {
    return this.database.transaction(() => {
      const result = this.database.db.prepare(`
        UPDATE profiles
        SET recovery_hash = ?, recovery_lookup = ?, updated_at = ?
        WHERE id = ? AND recovery_lookup = ?
      `).run(
        rotation.recoveryHash,
        rotation.recoveryLookup,
        rotation.now,
        profileId,
        expectedRecoveryLookup,
      );
      return result.changes === 0
        ? null
        : this.requirePublicProfile(profileId);
    });
  }

  deleteProfile(profileId: string): ProfileDeletionResult {
    return this.database.transaction(() => {
      const activeEscrow = this.database.db.prepare(`
        SELECT 1 FROM seat_escrows
        WHERE profile_id = ? AND status = 'active'
        UNION ALL
        SELECT 1 FROM arena_ticket_escrows
        WHERE profile_id = ? AND status = 'escrow'
        LIMIT 1
      `).get(profileId, profileId);
      if (activeEscrow) return 'active-escrow';
      const result = this.database.db.prepare(`
        DELETE FROM profiles WHERE id = ?
      `).run(profileId);
      return result.changes === 0 ? 'not-found' : 'deleted';
    });
  }

  private findByLookup(
    kind: 'credential' | 'recovery',
    lookup: string,
  ): StoredAuthenticationProfile | null {
    const verifierColumn = kind === 'credential'
      ? 'credential_hash'
      : 'recovery_hash';
    const lookupColumn = kind === 'credential'
      ? 'credential_lookup'
      : 'recovery_lookup';
    const row = this.database.db.prepare(`
      SELECT
        profiles.id,
        profiles.alias,
        profiles.avatar_id,
        profiles.${verifierColumn} AS verifier,
        wallets.balance,
        COALESCE((
          SELECT amount FROM seat_escrows
          WHERE profile_id = profiles.id AND status = 'active'
        ), 0) AS active_escrow
      FROM profiles
      JOIN wallets ON wallets.profile_id = profiles.id
      WHERE profiles.${lookupColumn} = ?
    `).get(lookup) as {
      id: string;
      alias: string;
      avatar_id: string;
      verifier: string;
      balance: number;
      active_escrow: number;
    } | undefined;
    if (!row) return null;
    return {
      verifier: row.verifier,
      profile: mapPublicProfile(row),
    };
  }

  private getPublicProfile(profileId: string): PublicProfile | null {
    const row = this.database.db.prepare(`
      SELECT
        profiles.id,
        profiles.alias,
        profiles.avatar_id,
        wallets.balance,
        COALESCE((
          SELECT amount FROM seat_escrows
          WHERE profile_id = profiles.id AND status = 'active'
        ), 0) AS active_escrow
      FROM profiles
      JOIN wallets ON wallets.profile_id = profiles.id
      WHERE profiles.id = ?
    `).get(profileId) as PublicProfileRow | undefined;
    return row ? mapPublicProfile(row) : null;
  }

  private requirePublicProfile(profileId: string): PublicProfile {
    const profile = this.getPublicProfile(profileId);
    if (!profile) throw new Error('PROFILE_PERSISTENCE_INVARIANT');
    return profile;
  }

  private hasValue(
    column: 'id' | 'credential_lookup' | 'recovery_lookup',
    value: string,
  ): boolean {
    return this.database.db.prepare(`
      SELECT 1 FROM profiles WHERE ${column} = ?
    `).get(value) !== undefined;
  }
}

interface PublicProfileRow {
  id: string;
  alias: string;
  avatar_id: string;
  balance: number;
  active_escrow: number;
}

function mapPublicProfile(row: PublicProfileRow): PublicProfile {
  return {
    id: row.id,
    alias: row.alias,
    avatarId: row.avatar_id,
    wallet: {
      balance: row.balance,
      activeEscrow: row.active_escrow,
    },
  };
}
