import {
  createHash,
  randomBytes,
  randomInt,
  scryptSync,
  timingSafeEqual,
} from 'node:crypto';
import { generateMnemonic, validateMnemonic } from '@scure/bip39';
import { wordlist as koreanWordlist } from '@scure/bip39/wordlists/korean.js';
import type { PublicProfile } from '@/lib/profile/types';
import type { ProfileRepository } from './profile-repository';

const ALIAS_PREFIXES = [
  '벚꽃', '달빛', '별빛', '새벽', '노을',
  '은빛', '구름', '여름', '겨울', '푸른',
] as const;
const ALIAS_ANIMALS = [
  '여우', '고양이', '토끼', '수달', '참새',
  '판다', '사슴', '늑대', '부엉이', '펭귄',
] as const;
const PLAYABLE_AVATARS = new Set([
  'sakura', 'ara', 'hana', 'chloe', 'vivian', 'elena',
]);

export type ProfileErrorCode =
  | 'ADULT_CONFIRMATION_REQUIRED'
  | 'INVALID_AVATAR'
  | 'ALIAS_GENERATION_EXHAUSTED'
  | 'PROFILE_SECRET_GENERATION_EXHAUSTED'
  | 'PROFILE_HAS_ACTIVE_ESCROW'
  | 'PROFILE_NOT_FOUND';

export class ProfileDomainError extends Error {
  constructor(readonly code: ProfileErrorCode) {
    super(code);
    this.name = 'ProfileDomainError';
  }
}

export interface ProfileEntropy {
  bytes(size: number): Uint8Array;
  integer(maxExclusive: number): number;
  recoveryWords(): string;
}

export interface CreatedProfile {
  profile: PublicProfile;
  credential: string;
  recoveryWords: string;
}

const secureEntropy: ProfileEntropy = {
  bytes: size => randomBytes(size),
  integer: maxExclusive => randomInt(maxExclusive),
  recoveryWords: () => generateMnemonic(koreanWordlist, 128),
};

export class ProfileManager {
  constructor(
    private readonly repository: ProfileRepository,
    private readonly entropy: ProfileEntropy = secureEntropy,
    private readonly now: () => number = Date.now,
  ) {}

  create(input: {
    avatarId: string;
    adultConfirmed: boolean;
  }): CreatedProfile {
    if (input.adultConfirmed !== true) {
      throw new ProfileDomainError('ADULT_CONFIRMATION_REQUIRED');
    }
    if (!PLAYABLE_AVATARS.has(input.avatarId)) {
      throw new ProfileDomainError('INVALID_AVATAR');
    }

    for (let aliasAttempt = 0; aliasAttempt < 20; aliasAttempt += 1) {
      const alias = this.createAlias();
      if (this.repository.hasAlias(alias)) continue;
      const created = this.createWithAlias(alias, input.avatarId);
      if (created) return created;
    }
    throw new ProfileDomainError('ALIAS_GENERATION_EXHAUSTED');
  }

  authenticateCredential(credential: string): PublicProfile | null {
    if (!isCanonicalCredential(credential)) return null;
    const stored = this.repository.findByCredentialLookup(
      digestSecret(credential),
    );
    if (!stored || !verifySecret(credential, stored.verifier)) return null;
    return stored.profile;
  }

  recover(recoveryWords: string): CreatedProfile | null {
    const canonical = canonicalRecoveryWords(recoveryWords);
    if (!canonical) return null;
    const stored = this.repository.findByRecoveryLookup(
      digestSecret(canonical),
    );
    if (!stored || !verifySecret(canonical, stored.verifier)) return null;

    for (let attempt = 0; attempt < 20; attempt += 1) {
      const credential = this.randomBytes(32).toString('base64url');
      const credentialLookup = digestSecret(credential);
      const nextRecoveryWords = canonicalRecoveryWords(
        this.entropy.recoveryWords(),
      );
      if (!nextRecoveryWords) continue;
      const recoveryLookup = digestSecret(nextRecoveryWords);
      if (
        this.repository.hasCredentialLookup(credentialLookup)
        || this.repository.hasRecoveryLookup(recoveryLookup)
      ) {
        continue;
      }
      try {
        const profile = this.repository.rotateSecrets(stored.profile.id, {
          credentialHash: this.hashSecret(credential),
          credentialLookup,
          recoveryHash: this.hashSecret(nextRecoveryWords),
          recoveryLookup,
          now: this.now(),
        });
        if (!profile) throw new ProfileDomainError('PROFILE_NOT_FOUND');
        return {
          profile,
          credential,
          recoveryWords: nextRecoveryWords,
        };
      } catch (error) {
        if (!isUniqueConstraint(error)) throw error;
      }
    }
    throw new ProfileDomainError('PROFILE_SECRET_GENERATION_EXHAUSTED');
  }

  rotateRecovery(profileId: string): string {
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const recoveryWords = canonicalRecoveryWords(
        this.entropy.recoveryWords(),
      );
      if (!recoveryWords) continue;
      const recoveryLookup = digestSecret(recoveryWords);
      if (this.repository.hasRecoveryLookup(recoveryLookup)) continue;
      try {
        const profile = this.repository.rotateRecovery(profileId, {
          recoveryHash: this.hashSecret(recoveryWords),
          recoveryLookup,
          now: this.now(),
        });
        if (!profile) throw new ProfileDomainError('PROFILE_NOT_FOUND');
        return recoveryWords;
      } catch (error) {
        if (!isUniqueConstraint(error)) throw error;
      }
    }
    throw new ProfileDomainError('PROFILE_SECRET_GENERATION_EXHAUSTED');
  }

  deleteProfile(profileId: string): void {
    const result = this.repository.deleteProfile(profileId);
    if (result === 'active-escrow') {
      throw new ProfileDomainError('PROFILE_HAS_ACTIVE_ESCROW');
    }
  }

  private createAlias(): string {
    const prefix = ALIAS_PREFIXES[this.entropy.integer(ALIAS_PREFIXES.length)];
    const animal = ALIAS_ANIMALS[this.entropy.integer(ALIAS_ANIMALS.length)];
    const suffix = this.entropy.integer(10_000).toString().padStart(4, '0');
    return `${prefix}${animal}#${suffix}`;
  }

  private hashSecret(secret: string): string {
    const salt = this.randomBytes(16);
    const hash = scryptSync(secret, salt, 32);
    return `$scrypt$v1$${salt.toString('base64url')}$${hash.toString('base64url')}`;
  }

  private randomBytes(size: number): Buffer {
    const value = Buffer.from(this.entropy.bytes(size));
    if (value.length !== size) {
      throw new Error('PROFILE_ENTROPY_INVALID');
    }
    return value;
  }

  private createWithAlias(alias: string, avatarId: string): CreatedProfile | null {
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const id = `p_${this.randomBytes(16).toString('base64url')}`;
      if (this.repository.hasProfileId(id)) continue;
      const credential = this.randomBytes(32).toString('base64url');
      const credentialLookup = digestSecret(credential);
      if (this.repository.hasCredentialLookup(credentialLookup)) continue;
      const recoveryWords = canonicalRecoveryWords(
        this.entropy.recoveryWords(),
      );
      if (!recoveryWords) continue;
      const recoveryLookup = digestSecret(recoveryWords);
      if (this.repository.hasRecoveryLookup(recoveryLookup)) continue;

      try {
        const profile = this.repository.createWithWallet({
          id,
          credentialHash: this.hashSecret(credential),
          credentialLookup,
          recoveryHash: this.hashSecret(recoveryWords),
          recoveryLookup,
          alias,
          avatarId,
          now: this.now(),
        });
        return { profile, credential, recoveryWords };
      } catch (error) {
        if (!isUniqueConstraint(error)) throw error;
        if (this.repository.hasAlias(alias)) return null;
      }
    }
    throw new ProfileDomainError('PROFILE_SECRET_GENERATION_EXHAUSTED');
  }
}

function digestSecret(secret: string): string {
  return createHash('sha256').update(secret, 'utf8').digest('base64url');
}

function normalizeRecoveryWords(value: string): string {
  return value.normalize('NFKD').trim().split(/\s+/u).join(' ');
}

function canonicalRecoveryWords(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const normalized = normalizeRecoveryWords(value);
  if (
    normalized.split(' ').length !== 12
    || !validateMnemonic(normalized, koreanWordlist)
  ) {
    return null;
  }
  return normalized;
}

function isCanonicalCredential(value: unknown): value is string {
  if (
    typeof value !== 'string'
    || !/^[A-Za-z0-9_-]{43}$/.test(value)
  ) {
    return false;
  }
  const decoded = Buffer.from(value, 'base64url');
  return decoded.length === 32 && decoded.toString('base64url') === value;
}

function verifySecret(secret: string, verifier: string): boolean {
  const match = /^\$scrypt\$v1\$([A-Za-z0-9_-]{22})\$([A-Za-z0-9_-]{43})$/.exec(
    verifier,
  );
  if (!match) return false;
  const salt = Buffer.from(match[1], 'base64url');
  const expected = Buffer.from(match[2], 'base64url');
  if (
    salt.length !== 16
    || expected.length !== 32
    || salt.toString('base64url') !== match[1]
    || expected.toString('base64url') !== match[2]
  ) {
    return false;
  }
  const actual = scryptSync(secret, salt, 32);
  return timingSafeEqual(actual, expected);
}

function isUniqueConstraint(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const sqliteError = error as { code?: unknown; errcode?: unknown };
  return sqliteError.code === 'ERR_SQLITE_ERROR'
    && typeof sqliteError.errcode === 'number'
    && (sqliteError.errcode === 1_555 || sqliteError.errcode === 2_067);
}
