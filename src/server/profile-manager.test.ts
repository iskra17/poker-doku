import { createHash, scrypt } from 'node:crypto';
import { generateMnemonic, validateMnemonic } from '@scure/bip39';
import { wordlist as koreanWordlist } from '@scure/bip39/wordlists/korean.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { openPokerDatabase, type PokerDatabase } from './persistence/database';
import {
  ProfileManager,
  SCRYPT_V1_OPTIONS,
  type ProfileEntropy,
  type ProfileKdf,
} from './profile-manager';
import { ProfileRepository } from './profile-repository';

describe('ProfileManager', () => {
  let database: PokerDatabase;
  let manager: ProfileManager;

  beforeEach(() => {
    database = openPokerDatabase(':memory:');
    manager = new ProfileManager(new ProfileRepository(database));
  });

  afterEach(() => {
    database.close();
    vi.restoreAllMocks();
  });

  it('creates a safe anonymous profile with a wallet and starting ledger entry', async () => {
    const created = await manager.create({
      avatarId: 'sakura',
      adultConfirmed: true,
    });

    expect(created.profile.id).toMatch(/^p_[A-Za-z0-9_-]{22}$/);
    expect(created.profile.alias).toMatch(/^[가-힣]+#[0-9]{4}$/);
    expect(created.profile.avatarId).toBe('sakura');
    expect(created.profile.wallet).toEqual({ balance: 10_000, activeEscrow: 0 });
    expect(Buffer.from(created.credential, 'base64url')).toHaveLength(32);
    expect(created.recoveryWords.trim().split(/\s+/)).toHaveLength(12);
    expect(validateMnemonic(created.recoveryWords, koreanWordlist)).toBe(true);

    const ledger = database.db.prepare(`
      SELECT profile_id, account, delta, reason, idempotency_key
      FROM chip_ledger
    `).all();
    expect(ledger).toEqual([{
      profile_id: created.profile.id,
      account: 'wallet',
      delta: 10_000,
      reason: 'PROFILE_START',
      idempotency_key: `profile-start:${created.profile.id}`,
    }]);
  });

  it('stores only lookup digests and salted scrypt verifiers', async () => {
    const created = await manager.create({
      avatarId: 'hana',
      adultConfirmed: true,
    });

    const stored = database.db.prepare(`
      SELECT credential_hash, credential_lookup, recovery_hash, recovery_lookup
      FROM profiles WHERE id = ?
    `).get(created.profile.id) as Record<string, string>;
    const serialized = JSON.stringify(stored);

    expect(serialized).not.toContain(created.credential);
    expect(serialized).not.toContain(created.recoveryWords);
    expect(stored.credential_hash).toMatch(
      /^\$scrypt\$v1\$[A-Za-z0-9_-]{22}\$[A-Za-z0-9_-]{43}$/,
    );
    expect(stored.recovery_hash).toMatch(
      /^\$scrypt\$v1\$[A-Za-z0-9_-]{22}\$[A-Za-z0-9_-]{43}$/,
    );
    expect(stored.credential_lookup).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(stored.recovery_lookup).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it('requires explicit adult confirmation without writing any rows', async () => {
    await expect(manager.create({
      avatarId: 'sakura',
      adultConfirmed: false,
    })).rejects.toEqual(expect.objectContaining({
      code: 'ADULT_CONFIRMATION_REQUIRED',
    }));
    expect(economyRowCounts(database)).toEqual({
      profiles: 0,
      wallets: 0,
      chipLedger: 0,
    });
  });

  it('rejects avatars outside the six playable characters without writing rows', async () => {
    await expect(manager.create({
      avatarId: 'miyako',
      adultConfirmed: true,
    })).rejects.toEqual(expect.objectContaining({ code: 'INVALID_AVATAR' }));
    expect(economyRowCounts(database)).toEqual({
      profiles: 0,
      wallets: 0,
      chipLedger: 0,
    });
  });

  it('authenticates a valid credential and safely rejects invalid input or storage', async () => {
    const created = await manager.create({
      avatarId: 'elena',
      adultConfirmed: true,
    });

    expect(await manager.authenticateCredential(created.credential)).toEqual(
      created.profile,
    );
    expect(await manager.authenticateCredential(
      Buffer.alloc(32, 7).toString('base64url'),
    )).toBeNull();
    expect(await manager.authenticateCredential('not-base64url!')).toBeNull();

    database.db.prepare(`
      UPDATE profiles SET credential_hash = '$scrypt$v1$malformed'
      WHERE id = ?
    `).run(created.profile.id);
    await expect(
      manager.authenticateCredential(created.credential),
    ).resolves.toBeNull();
  });

  it('retries a deterministic alias collision and then succeeds', async () => {
    const repository = new ProfileRepository(database);
    const first = await new ProfileManager(
      repository,
      makeEntropy([0, 0, 1234], 'first-profile'),
    ).create({ avatarId: 'sakura', adultConfirmed: true });
    const second = await new ProfileManager(
      repository,
      makeEntropy([0, 0, 1234, 1, 1, 5678], 'second-profile'),
    ).create({ avatarId: 'ara', adultConfirmed: true });

    expect(first.profile.alias).toBe('벚꽃여우#1234');
    expect(second.profile.alias).toBe('달빛고양이#5678');
    expect(economyRowCounts(database)).toEqual({
      profiles: 2,
      wallets: 2,
      chipLedger: 2,
    });
  });

  it('stops after twenty alias collisions without partial rows', async () => {
    const repository = new ProfileRepository(database);
    await new ProfileManager(
      repository,
      makeEntropy([0, 0, 4321], 'existing-profile'),
    ).create({ avatarId: 'sakura', adultConfirmed: true });
    const collidingEntropy = makeEntropy(
      Array.from({ length: 60 }, (_, index) => index % 3 === 2 ? 4321 : 0),
      'colliding-profile',
    );

    await expect(new ProfileManager(repository, collidingEntropy).create({
      avatarId: 'hana',
      adultConfirmed: true,
    })).rejects.toEqual(expect.objectContaining({
      code: 'ALIAS_GENERATION_EXHAUSTED',
    }));
    expect(collidingEntropy.integerCalls).toBe(60);
    expect(economyRowCounts(database)).toEqual({
      profiles: 1,
      wallets: 1,
      chipLedger: 1,
    });
  });

  it('rolls back profile and wallet inserts when starting ledger creation fails', async () => {
    database.db.exec(`
      CREATE TRIGGER reject_profile_start
      BEFORE INSERT ON chip_ledger
      WHEN NEW.reason = 'PROFILE_START'
      BEGIN
        SELECT RAISE(ABORT, 'induced profile start failure');
      END;
    `);

    await expect(manager.create({
      avatarId: 'chloe',
      adultConfirmed: true,
    })).rejects.toThrowError('induced profile start failure');
    expect(economyRowCounts(database)).toEqual({
      profiles: 0,
      wallets: 0,
      chipLedger: 0,
    });
  });

  it('recovers a profile while atomically replacing both one-time secrets', async () => {
    const created = await manager.create({
      avatarId: 'vivian',
      adultConfirmed: true,
    });

    const recovered = await manager.recover(created.recoveryWords);

    expect(recovered).not.toBeNull();
    expect(recovered?.profile).toEqual(created.profile);
    expect(recovered?.credential).not.toBe(created.credential);
    expect(recovered?.recoveryWords).not.toBe(created.recoveryWords);
    expect(validateMnemonic(
      recovered?.recoveryWords ?? '',
      koreanWordlist,
    )).toBe(true);
    expect(await manager.authenticateCredential(created.credential)).toBeNull();
    expect(await manager.recover(created.recoveryWords)).toBeNull();
    expect(await manager.authenticateCredential(recovered?.credential ?? '')).toEqual(
      created.profile,
    );
  });

  it('accepts equivalent NFKC and collapsed-whitespace recovery input', async () => {
    const created = await manager.create({
      avatarId: 'ara',
      adultConfirmed: true,
    });
    const equivalentInput = `  ${created.recoveryWords
      .normalize('NFC')
      .split(' ')
      .join(' \n\t ')}  `;

    expect((await manager.recover(equivalentInput))?.profile.id).toBe(
      created.profile.id,
    );
  });

  it('rotates only recovery words while preserving the credential', async () => {
    const created = await manager.create({
      avatarId: 'hana',
      adultConfirmed: true,
    });

    const recoveryWords = await manager.rotateRecovery(created.profile.id);

    expect(recoveryWords).not.toBe(created.recoveryWords);
    expect(validateMnemonic(recoveryWords, koreanWordlist)).toBe(true);
    expect(await manager.recover(created.recoveryWords)).toBeNull();
    expect(await manager.authenticateCredential(created.credential)).toEqual(
      created.profile,
    );
    expect((await manager.recover(recoveryWords))?.profile.id).toBe(
      created.profile.id,
    );
  });

  it('regenerates creation secrets after a credential lookup collision', async () => {
    const existing = await manager.create({
      avatarId: 'sakura',
      adultConfirmed: true,
    });
    const entropy = makeScriptedEntropy({
      integers: [1, 1, 6789],
      bytes: [
        Buffer.alloc(16, 101),
        Buffer.from(existing.credential, 'base64url'),
        Buffer.alloc(16, 102),
        Buffer.alloc(32, 103),
      ],
      recoveryWords: [generateMnemonic(koreanWordlist, 128)],
      seed: 'creation-lookup-collision',
    });

    const created = await new ProfileManager(
      new ProfileRepository(database),
      entropy,
    ).create({ avatarId: 'elena', adultConfirmed: true });

    expect(created.credential).not.toBe(existing.credential);
    expect(created.profile.alias).toBe('달빛고양이#6789');
    expect(economyRowCounts(database)).toEqual({
      profiles: 2,
      wallets: 2,
      chipLedger: 2,
    });
  });

  it('regenerates both recovery credentials after a lookup collision', async () => {
    const first = await manager.create({
      avatarId: 'chloe',
      adultConfirmed: true,
    });
    const second = await manager.create({
      avatarId: 'vivian',
      adultConfirmed: true,
    });
    const uniqueRecovery = generateMnemonic(koreanWordlist, 128);
    const entropy = makeScriptedEntropy({
      recoveryWords: [second.recoveryWords, uniqueRecovery],
      seed: 'recovery-lookup-collision',
    });

    const recovered = await new ProfileManager(
      new ProfileRepository(database),
      entropy,
    ).recover(first.recoveryWords);

    expect(recovered?.recoveryWords).toBe(uniqueRecovery);
    expect(recovered?.credential).not.toBe(first.credential);
    expect(await manager.authenticateCredential(first.credential)).toBeNull();
    expect((await manager.authenticateCredential(recovered?.credential ?? ''))?.id).toBe(
      first.profile.id,
    );
    expect((await manager.recover(second.recoveryWords))?.profile.id).toBe(
      second.profile.id,
    );
  });

  it('guards active escrow deletion and cascades settled profile economy data', async () => {
    const created = await manager.create({
      avatarId: 'sakura',
      adultConfirmed: true,
    });
    database.db.prepare(`
      INSERT INTO seat_escrows (
        id,
        profile_id,
        room_id,
        mode,
        amount,
        checkpoint_amount,
        checkpoint_hand,
        status,
        updated_at
      ) VALUES (?, ?, ?, 'cash', 750, 750, 3, 'active', ?)
    `).run('escrow-delete-guard', created.profile.id, 'room-guard', Date.now());

    expect((await manager.authenticateCredential(created.credential))?.wallet).toEqual({
      balance: 10_000,
      activeEscrow: 750,
    });
    expect(() => manager.deleteProfile(created.profile.id)).toThrow(
      expect.objectContaining({ code: 'PROFILE_HAS_ACTIVE_ESCROW' }),
    );
    expect(economyRowCounts(database)).toEqual({
      profiles: 1,
      wallets: 1,
      chipLedger: 1,
    });
    expect(countRows(database, 'seat_escrows')).toBe(1);

    database.db.prepare(`
      UPDATE seat_escrows SET status = 'settled' WHERE profile_id = ?
    `).run(created.profile.id);
    manager.deleteProfile(created.profile.id);

    expect(economyRowCounts(database)).toEqual({
      profiles: 0,
      wallets: 0,
      chipLedger: 0,
    });
    expect(countRows(database, 'seat_escrows')).toBe(0);
    expect(await manager.authenticateCredential(created.credential)).toBeNull();
  });

  it('never serializes secret or verifier fields in public profiles', async () => {
    const created = await manager.create({
      avatarId: 'elena',
      adultConfirmed: true,
    });
    const authenticated = await manager.authenticateCredential(created.credential);
    const recovered = await manager.recover(created.recoveryWords);

    for (const profile of [created.profile, authenticated, recovered?.profile]) {
      const serialized = JSON.stringify(profile);
      expect(serialized).not.toMatch(/credential|recovery|hash|lookup/i);
      expect(Object.keys(profile ?? {}).sort()).toEqual([
        'alias', 'avatarId', 'id', 'wallet',
      ]);
    }
  });

  it('waits for asynchronous KDF work before writing profile data', async () => {
    const pending: Array<(value: Uint8Array) => void> = [];
    const kdf: ProfileKdf = {
      derive: () => new Promise(resolve => pending.push(resolve)),
    };
    const asynchronousManager = new ProfileManager(
      new ProfileRepository(database),
      makeEntropy([0, 0, 2468], 'async-kdf'),
      () => 123,
      kdf,
    );

    const creation = asynchronousManager.create({
      avatarId: 'sakura',
      adultConfirmed: true,
    });
    await Promise.resolve();

    expect(creation).toBeInstanceOf(Promise);
    expect(pending).toHaveLength(1);
    expect(economyRowCounts(database)).toEqual({
      profiles: 0,
      wallets: 0,
      chipLedger: 0,
    });

    pending.shift()?.(Buffer.alloc(32, 1));
    await new Promise<void>(resolve => setImmediate(resolve));
    expect(pending).toHaveLength(1);
    pending.shift()?.(Buffer.alloc(32, 2));

    await expect(creation).resolves.toMatchObject({
      profile: { alias: '벚꽃여우#2468' },
    });
  });

  it('rolls back recovery-only rotation when its public profile invariant is broken', async () => {
    const created = await manager.create({
      avatarId: 'hana',
      adultConfirmed: true,
    });
    const before = storedSecretState(database, created.profile.id);
    database.db.prepare('DELETE FROM wallets WHERE profile_id = ?')
      .run(created.profile.id);

    await expect(manager.rotateRecovery(created.profile.id)).rejects.toThrowError(
      'PROFILE_PERSISTENCE_INVARIANT',
    );

    expect(storedSecretState(database, created.profile.id)).toEqual(before);
  });

  it('rolls back combined secret rotation when its public profile invariant is broken', async () => {
    const created = await manager.create({
      avatarId: 'vivian',
      adultConfirmed: true,
    });
    const before = storedSecretState(database, created.profile.id);
    database.db.prepare('DELETE FROM wallets WHERE profile_id = ?')
      .run(created.profile.id);
    const repository = new ProfileRepository(database);

    expect(() => repository.rotateSecrets(created.profile.id, {
      credentialHash: 'replacement-credential-hash',
      credentialLookup: 'replacement-credential-lookup',
      recoveryHash: 'replacement-recovery-hash',
      recoveryLookup: 'replacement-recovery-lookup',
      now: 456,
    }, before.recovery_lookup)).toThrowError('PROFILE_PERSISTENCE_INVARIANT');

    expect(storedSecretState(database, created.profile.id)).toEqual(before);
  });

  it('bounds recovery input before Unicode normalization', async () => {
    const created = await manager.create({
      avatarId: 'ara',
      adultConfirmed: true,
    });
    const boundaryInput = created.recoveryWords.padEnd(1_024, ' ');

    expect((await manager.recover(boundaryInput))?.profile.id).toBe(
      created.profile.id,
    );

    const normalizeSpy = vi.spyOn(String.prototype, 'normalize');
    expect(await manager.recover(' '.repeat(1_025))).toBeNull();
    expect(normalizeSpy).not.toHaveBeenCalled();
  });

  it('allows the same recovery phrase to rotate secrets only once concurrently', async () => {
    const created = await manager.create({
      avatarId: 'chloe',
      adultConfirmed: true,
    });
    let verificationCalls = 0;
    let releaseVerification = (): void => undefined;
    const verificationGate = new Promise<void>(resolve => {
      releaseVerification = resolve;
    });
    let candidateCalls = 0;
    let releaseCandidates = (): void => undefined;
    const candidateGate = new Promise<void>(resolve => {
      releaseCandidates = resolve;
    });
    const kdf: ProfileKdf = {
      derive: async (secret, salt) => {
        if (secret === created.recoveryWords) {
          verificationCalls += 1;
          await verificationGate;
          return deriveScrypt(secret, salt);
        }
        candidateCalls += 1;
        if (candidateCalls === 2) releaseCandidates();
        if (candidateCalls <= 2) await candidateGate;
        return createHash('sha256').update(salt).digest();
      },
    };
    const concurrentManager = new ProfileManager(
      new ProfileRepository(database),
      makeScriptedEntropy({
        recoveryWords: [
          generateMnemonic(koreanWordlist, 128),
          generateMnemonic(koreanWordlist, 128),
        ],
        seed: 'concurrent-recovery',
      }),
      Date.now,
      kdf,
    );

    const first = concurrentManager.recover(created.recoveryWords);
    const second = concurrentManager.recover(created.recoveryWords);
    expect(verificationCalls).toBe(2);
    releaseVerification();

    const recovered = await Promise.all([first, second]);
    expect(recovered.filter(result => result !== null)).toHaveLength(1);
  });

  it('rejects a credential revoked while its KDF verification is pending', async () => {
    const created = await manager.create({
      avatarId: 'elena',
      adultConfirmed: true,
    });
    let releaseVerification = (): void => undefined;
    const verificationGate = new Promise<void>(resolve => {
      releaseVerification = resolve;
    });
    let markVerificationStarted = (): void => undefined;
    const verificationStarted = new Promise<void>(resolve => {
      markVerificationStarted = resolve;
    });
    const kdf: ProfileKdf = {
      derive: async (secret, salt) => {
        if (secret === created.credential) {
          markVerificationStarted();
          await verificationGate;
        }
        return deriveScrypt(secret, salt);
      },
    };
    const authenticatingManager = new ProfileManager(
      new ProfileRepository(database),
      makeScriptedEntropy({ recoveryWords: [], seed: 'stale-auth' }),
      Date.now,
      kdf,
    );

    const pendingAuthentication = authenticatingManager.authenticateCredential(
      created.credential,
    );
    await verificationStarted;
    await manager.recover(created.recoveryWords);
    releaseVerification();

    await expect(pendingAuthentication).resolves.toBeNull();
  });

  it('returns only one recovery code from concurrent rotations', async () => {
    const created = await manager.create({
      avatarId: 'sakura',
      adultConfirmed: true,
    });
    const rotatingManager = new ProfileManager(
      new ProfileRepository(database),
      makeScriptedEntropy({
        recoveryWords: [
          generateMnemonic(koreanWordlist, 128),
          generateMnemonic(koreanWordlist, 128),
        ],
        seed: 'concurrent-rotate-recovery',
      }),
      Date.now,
      createPairGateKdf(),
    );

    const settled = await Promise.allSettled([
      rotatingManager.rotateRecovery(created.profile.id),
      rotatingManager.rotateRecovery(created.profile.id),
    ]);
    const fulfilled = settled.filter(
      (result): result is PromiseFulfilledResult<string> => (
        result.status === 'fulfilled'
      ),
    );
    const rejected = settled.filter(
      (result): result is PromiseRejectedResult => result.status === 'rejected',
    );

    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(rejected[0].reason).toEqual(expect.objectContaining({
      code: 'PROFILE_SECRET_CONFLICT',
    }));
    const current = storedSecretState(database, created.profile.id);
    expect(current.recovery_lookup).toBe(
      createHash('sha256')
        .update(fulfilled[0].value, 'utf8')
      .digest('base64url'),
    );
  });

  it('rejects a credential whose profile is deleted during KDF verification', async () => {
    const created = await manager.create({
      avatarId: 'hana',
      adultConfirmed: true,
    });
    const gate = createManualGateKdf(created.credential, true);
    const authenticatingManager = new ProfileManager(
      new ProfileRepository(database),
      makeScriptedEntropy({ recoveryWords: [], seed: 'deleted-auth' }),
      Date.now,
      gate.kdf,
    );

    const pendingAuthentication = authenticatingManager.authenticateCredential(
      created.credential,
    );
    await gate.started;
    manager.deleteProfile(created.profile.id);
    gate.release();

    await expect(pendingAuthentication).resolves.toBeNull();
  });

  it('rejects recovery rotation made stale by a concurrent full recovery', async () => {
    const created = await manager.create({
      avatarId: 'vivian',
      adultConfirmed: true,
    });
    const gate = createManualGateKdf(undefined, false);
    const rotatingManager = new ProfileManager(
      new ProfileRepository(database),
      makeScriptedEntropy({
        recoveryWords: [generateMnemonic(koreanWordlist, 128)],
        seed: 'rotate-versus-recover',
      }),
      Date.now,
      gate.kdf,
    );

    const pendingRotation = rotatingManager.rotateRecovery(created.profile.id);
    await gate.started;
    const recovered = await manager.recover(created.recoveryWords);
    gate.release();

    await expect(pendingRotation).rejects.toEqual(expect.objectContaining({
      code: 'PROFILE_SECRET_CONFLICT',
    }));
    expect(recovered).not.toBeNull();
    expect(storedSecretState(database, created.profile.id).recovery_lookup).toBe(
      createHash('sha256')
        .update(recovered?.recoveryWords ?? '', 'utf8')
        .digest('base64url'),
    );
  });

  it('preserves PROFILE_NOT_FOUND for an initially missing recovery profile', async () => {
    await expect(manager.rotateRecovery('p_missing')).rejects.toEqual(
      expect.objectContaining({ code: 'PROFILE_NOT_FOUND' }),
    );
  });

  it('pins the scrypt v1 cost parameters', () => {
    expect(SCRYPT_V1_OPTIONS).toEqual({
      N: 16_384,
      r: 8,
      p: 1,
      maxmem: 32 * 1024 * 1024,
    });
  });
});

function economyRowCounts(database: PokerDatabase): {
  profiles: number;
  wallets: number;
  chipLedger: number;
} {
  const count = (table: 'profiles' | 'wallets' | 'chip_ledger'): number => (
    database.db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as {
      count: number;
    }
  ).count;
  return {
    profiles: count('profiles'),
    wallets: count('wallets'),
    chipLedger: count('chip_ledger'),
  };
}

function countRows(
  database: PokerDatabase,
  table: 'seat_escrows',
): number {
  return (
    database.db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as {
      count: number;
    }
  ).count;
}

function storedSecretState(
  database: PokerDatabase,
  profileId: string,
): Record<string, string> {
  return database.db.prepare(`
    SELECT credential_hash, credential_lookup, recovery_hash, recovery_lookup
    FROM profiles WHERE id = ?
  `).get(profileId) as Record<string, string>;
}

function makeEntropy(
  integers: number[],
  seed: string,
): ProfileEntropy & { integerCalls: number } {
  let byteCall = 0;
  const entropy = {
    integerCalls: 0,
    bytes(size: number): Uint8Array {
      const output = createHash('sha512')
        .update(`${seed}:${byteCall++}`)
        .digest();
      return output.subarray(0, size);
    },
    integer(maxExclusive: number): number {
      const value = integers[this.integerCalls++];
      if (value === undefined || value < 0 || value >= maxExclusive) {
        throw new Error('Test entropy integer out of range');
      }
      return value;
    },
    recoveryWords(): string {
      return generateMnemonic(koreanWordlist, 128);
    },
  };
  return entropy;
}

function makeScriptedEntropy(options: {
  bytes?: Buffer[];
  integers?: number[];
  recoveryWords: string[];
  seed: string;
}): ProfileEntropy {
  const byteValues = [...(options.bytes ?? [])];
  const integerValues = [...(options.integers ?? [])];
  const recoveryValues = [...options.recoveryWords];
  let fallbackCall = 0;
  return {
    bytes(size: number): Uint8Array {
      const scripted = byteValues.shift();
      if (scripted) {
        if (scripted.length !== size) {
          throw new Error(`Expected ${size} scripted bytes, got ${scripted.length}`);
        }
        return scripted;
      }
      return createHash('sha512')
        .update(`${options.seed}:fallback:${fallbackCall++}`)
        .digest()
        .subarray(0, size);
    },
    integer(maxExclusive: number): number {
      const scripted = integerValues.shift() ?? 0;
      if (scripted < 0 || scripted >= maxExclusive) {
        throw new Error('Scripted integer out of range');
      }
      return scripted;
    },
    recoveryWords(): string {
      const value = recoveryValues.shift();
      if (!value) throw new Error('Scripted recovery words exhausted');
      return value;
    },
  };
}

function deriveScrypt(
  secret: string,
  salt: Uint8Array,
): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    scrypt(secret, Buffer.from(salt), 32, (error, derivedKey) => {
      if (error) {
        reject(error);
        return;
      }
      resolve(derivedKey);
    });
  });
}

function createPairGateKdf(): ProfileKdf {
  let callCount = 0;
  let release = (): void => undefined;
  const gate = new Promise<void>(resolve => {
    release = resolve;
  });
  return {
    derive: async (_secret, salt) => {
      callCount += 1;
      if (callCount === 2) release();
      await gate;
      return createHash('sha256').update(salt).digest();
    },
  };
}

function createManualGateKdf(
  verifiedSecret: string | undefined,
  useScrypt: boolean,
): {
  kdf: ProfileKdf;
  started: Promise<void>;
  release: () => void;
} {
  let release = (): void => undefined;
  const gate = new Promise<void>(resolve => {
    release = resolve;
  });
  let markStarted = (): void => undefined;
  const started = new Promise<void>(resolve => {
    markStarted = resolve;
  });
  return {
    started,
    release,
    kdf: {
      derive: async (secret, salt) => {
        if (verifiedSecret === undefined || secret === verifiedSecret) {
          markStarted();
          await gate;
        }
        return useScrypt
          ? deriveScrypt(secret, salt)
          : createHash('sha256').update(salt).digest();
      },
    },
  };
}
