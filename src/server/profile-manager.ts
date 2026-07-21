import {
  createHash,
  randomBytes,
  randomInt,
  scrypt,
  timingSafeEqual,
} from 'node:crypto';
import { generateMnemonic, validateMnemonic } from '@scure/bip39';
import { wordlist as koreanWordlist } from '@scure/bip39/wordlists/korean.js';
import {
  STARTER_CHARACTER_IDS,
  isCharacterUnlocked,
  isSelectableCharacter,
} from '@/lib/characters/unlocks';
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
// 프로필 생성(온보딩)은 스타터 캐릭터만 — 나머지는 도장 레벨 해금 후 changeAvatar로
// (해금 규칙 단일 소스: src/lib/characters/unlocks.ts)
const PLAYABLE_AVATARS: ReadonlySet<string> = new Set(STARTER_CHARACTER_IDS);
const MAX_RECOVERY_INPUT_LENGTH = 1_024;
export const SCRYPT_V1_OPTIONS = {
  N: 16_384,
  r: 8,
  p: 1,
  maxmem: 32 * 1024 * 1024,
} as const;

export type ProfileErrorCode =
  | 'ADULT_CONFIRMATION_REQUIRED'
  | 'INVALID_AVATAR'
  | 'AVATAR_LOCKED'
  | 'ALIAS_GENERATION_EXHAUSTED'
  | 'PROFILE_SECRET_GENERATION_EXHAUSTED'
  | 'PROFILE_SECRET_CONFLICT'
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

export interface ProfileKdf {
  derive(secret: string, salt: Uint8Array): Promise<Uint8Array>;
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

const asynchronousScrypt: ProfileKdf = {
  derive: (secret, salt) => new Promise((resolve, reject) => {
    scrypt(
      secret,
      Buffer.from(salt),
      32,
      SCRYPT_V1_OPTIONS,
      (error, derivedKey) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(derivedKey);
      },
    );
  }),
};

const VERIFIED_CREDENTIAL_CACHE_MAX = 1_000;

export class ProfileManager {
  /**
   * 검증에 성공한 (lookup 다이제스트 → verifier) 캐시 — 반복 인증의 scrypt 재실행 회피.
   * 모든 인증 요청(세션/소켓/진행도)이 매번 KDF를 돌면 방문 폭주·재접속 폭풍에서 동시성
   * 게이트가 넘쳐 429가 난다 (2026-07-21 접속 장애). 비밀 원문은 저장하지 않는다 — 둘 다
   * DB에 이미 있는 값이고, verifier가 바뀌면(로테이션·삭제) 자연 미스 → 풀 검증.
   * 실패는 캐시하지 않으므로 무차별 대입은 여전히 시도마다 KDF 비용을 문다.
   */
  private readonly verifiedCredentials = new Map<string, string>();

  constructor(
    private readonly repository: ProfileRepository,
    private readonly entropy: ProfileEntropy = secureEntropy,
    private readonly now: () => number = Date.now,
    private readonly kdf: ProfileKdf = asynchronousScrypt,
  ) {}

  async create(input: {
    avatarId: string;
    adultConfirmed: boolean;
  }): Promise<CreatedProfile> {
    if (input.adultConfirmed !== true) {
      throw new ProfileDomainError('ADULT_CONFIRMATION_REQUIRED');
    }
    if (!PLAYABLE_AVATARS.has(input.avatarId)) {
      throw new ProfileDomainError('INVALID_AVATAR');
    }

    for (let aliasAttempt = 0; aliasAttempt < 20; aliasAttempt += 1) {
      const alias = this.createAlias();
      if (this.repository.hasAlias(alias)) continue;
      const created = await this.createWithAlias(alias, input.avatarId);
      if (created) return created;
    }
    throw new ProfileDomainError('ALIAS_GENERATION_EXHAUSTED');
  }

  async authenticateCredential(
    credential: string,
  ): Promise<PublicProfile | null> {
    if (!isCanonicalCredential(credential)) return null;
    const credentialLookup = digestSecret(credential);
    const stored = this.repository.findByCredentialLookup(credentialLookup);
    if (!stored) return null;
    // 이 (lookup, verifier) 쌍이 이전에 KDF 검증을 통과했으면 재실행 생략 —
    // 저장된 verifier가 그대로인지는 방금 읽은 DB 값으로 확인했다
    if (this.verifiedCredentials.get(credentialLookup) === stored.verifier) {
      this.refreshVerifiedCredential(credentialLookup, stored.verifier);
      return stored.profile;
    }
    if (!await verifySecret(credential, stored.verifier, this.kdf)) {
      return null;
    }
    const current = this.repository.findByCredentialLookup(credentialLookup);
    if (
      !current
      || current.verifier !== stored.verifier
      || current.profile.id !== stored.profile.id
    ) {
      return null;
    }
    this.refreshVerifiedCredential(credentialLookup, current.verifier);
    return current.profile;
  }

  /** LRU 적재/갱신 — Map 삽입 순서를 최근성으로 사용, 상한 초과 시 가장 오래된 항목 축출 */
  private refreshVerifiedCredential(lookup: string, verifier: string): void {
    this.verifiedCredentials.delete(lookup);
    this.verifiedCredentials.set(lookup, verifier);
    if (this.verifiedCredentials.size > VERIFIED_CREDENTIAL_CACHE_MAX) {
      const oldest = this.verifiedCredentials.keys().next().value;
      if (oldest !== undefined) this.verifiedCredentials.delete(oldest);
    }
  }

  isCredentialCurrent(profileId: string, credential: string): boolean {
    if (!isCanonicalCredential(credential)) return false;
    const current = this.repository.findByCredentialLookup(
      digestSecret(credential),
    );
    return current?.profile.id === profileId;
  }

  async recover(recoveryWords: string): Promise<CreatedProfile | null> {
    const canonical = canonicalRecoveryWords(recoveryWords);
    if (!canonical) return null;
    const presentedRecoveryLookup = digestSecret(canonical);
    const stored = this.repository.findByRecoveryLookup(
      presentedRecoveryLookup,
    );
    if (!stored || !await verifySecret(canonical, stored.verifier, this.kdf)) {
      return null;
    }

    for (let attempt = 0; attempt < 20; attempt += 1) {
      const credential = this.randomBytes(32).toString('base64url');
      const credentialLookup = digestSecret(credential);
      const nextRecoveryWords = canonicalRecoveryWords(
        this.entropy.recoveryWords(),
      );
      if (!nextRecoveryWords) continue;
      const nextRecoveryLookup = digestSecret(nextRecoveryWords);
      if (
        this.repository.hasCredentialLookup(credentialLookup)
        || this.repository.hasRecoveryLookup(nextRecoveryLookup)
      ) {
        continue;
      }
      try {
        const profile = this.repository.rotateSecrets(
          stored.profile.id,
          {
            credentialHash: await this.hashSecret(credential),
            credentialLookup,
            recoveryHash: await this.hashSecret(nextRecoveryWords),
            recoveryLookup: nextRecoveryLookup,
            now: this.now(),
          },
          presentedRecoveryLookup,
        );
        if (!profile) return null;
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

  async rotateRecovery(profileId: string): Promise<string> {
    const expectedRecoveryLookup = this.repository
      .findRecoveryLookupByProfileId(profileId);
    if (!expectedRecoveryLookup) {
      throw new ProfileDomainError('PROFILE_NOT_FOUND');
    }
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const recoveryWords = canonicalRecoveryWords(
        this.entropy.recoveryWords(),
      );
      if (!recoveryWords) continue;
      const recoveryLookup = digestSecret(recoveryWords);
      if (this.repository.hasRecoveryLookup(recoveryLookup)) continue;
      try {
        const profile = this.repository.rotateRecovery(
          profileId,
          {
            recoveryHash: await this.hashSecret(recoveryWords),
            recoveryLookup,
            now: this.now(),
          },
          expectedRecoveryLookup,
        );
        if (!profile) throw new ProfileDomainError('PROFILE_SECRET_CONFLICT');
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

  /**
   * 좌석 아바타 변경 — 스타터는 항상, 신규 캐릭터는 도장 레벨 해금 후 허용.
   * dojoLevel은 호출자(HTTP 레이어)가 진행도 서비스에서 조회해 전달한다.
   */
  changeAvatar(
    profileId: string,
    avatarId: string,
    dojoLevel: number,
  ): PublicProfile {
    if (!isSelectableCharacter(avatarId)) {
      throw new ProfileDomainError('INVALID_AVATAR');
    }
    if (!isCharacterUnlocked(avatarId, dojoLevel)) {
      throw new ProfileDomainError('AVATAR_LOCKED');
    }
    const profile = this.repository.updateAvatar(
      profileId,
      avatarId,
      this.now(),
    );
    if (!profile) throw new ProfileDomainError('PROFILE_NOT_FOUND');
    return profile;
  }

  private createAlias(): string {
    const prefix = ALIAS_PREFIXES[this.entropy.integer(ALIAS_PREFIXES.length)];
    const animal = ALIAS_ANIMALS[this.entropy.integer(ALIAS_ANIMALS.length)];
    const suffix = this.entropy.integer(10_000).toString().padStart(4, '0');
    return `${prefix}${animal}#${suffix}`;
  }

  private async hashSecret(secret: string): Promise<string> {
    const salt = this.randomBytes(16);
    const hash = Buffer.from(await this.kdf.derive(secret, salt));
    if (hash.length !== 32) throw new Error('PROFILE_KDF_INVALID');
    return `$scrypt$v1$${salt.toString('base64url')}$${hash.toString('base64url')}`;
  }

  private randomBytes(size: number): Buffer {
    const value = Buffer.from(this.entropy.bytes(size));
    if (value.length !== size) {
      throw new Error('PROFILE_ENTROPY_INVALID');
    }
    return value;
  }

  private async createWithAlias(
    alias: string,
    avatarId: string,
  ): Promise<CreatedProfile | null> {
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
          credentialHash: await this.hashSecret(credential),
          credentialLookup,
          recoveryHash: await this.hashSecret(recoveryWords),
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
  if (
    typeof value !== 'string'
    || value.length > MAX_RECOVERY_INPUT_LENGTH
  ) {
    return null;
  }
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

async function verifySecret(
  secret: string,
  verifier: string,
  kdf: ProfileKdf,
): Promise<boolean> {
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
  const actual = Buffer.from(await kdf.derive(secret, salt));
  if (actual.length !== 32) return false;
  return timingSafeEqual(actual, expected);
}

function isUniqueConstraint(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const sqliteError = error as { code?: unknown; errcode?: unknown };
  return sqliteError.code === 'ERR_SQLITE_ERROR'
    && typeof sqliteError.errcode === 'number'
    && (sqliteError.errcode === 1_555 || sqliteError.errcode === 2_067);
}
