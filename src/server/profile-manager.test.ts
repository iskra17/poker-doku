import { createHash } from 'node:crypto';
import { generateMnemonic, validateMnemonic } from '@scure/bip39';
import { wordlist as koreanWordlist } from '@scure/bip39/wordlists/korean.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openPokerDatabase, type PokerDatabase } from './persistence/database';
import { ProfileManager, type ProfileEntropy } from './profile-manager';
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
  });

  it('creates a safe anonymous profile with a wallet and starting ledger entry', () => {
    const created = manager.create({
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

  it('stores only lookup digests and salted scrypt verifiers', () => {
    const created = manager.create({
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

  it('requires explicit adult confirmation without writing any rows', () => {
    expect(() => manager.create({
      avatarId: 'sakura',
      adultConfirmed: false,
    })).toThrow(expect.objectContaining({
      code: 'ADULT_CONFIRMATION_REQUIRED',
    }));
    expect(economyRowCounts(database)).toEqual({
      profiles: 0,
      wallets: 0,
      chipLedger: 0,
    });
  });

  it('rejects avatars outside the six playable characters without writing rows', () => {
    expect(() => manager.create({
      avatarId: 'miyako',
      adultConfirmed: true,
    })).toThrow(expect.objectContaining({ code: 'INVALID_AVATAR' }));
    expect(economyRowCounts(database)).toEqual({
      profiles: 0,
      wallets: 0,
      chipLedger: 0,
    });
  });

  it('authenticates a valid credential and safely rejects invalid input or storage', () => {
    const created = manager.create({
      avatarId: 'elena',
      adultConfirmed: true,
    });

    expect(manager.authenticateCredential(created.credential)).toEqual(
      created.profile,
    );
    expect(manager.authenticateCredential(
      Buffer.alloc(32, 7).toString('base64url'),
    )).toBeNull();
    expect(manager.authenticateCredential('not-base64url!')).toBeNull();

    database.db.prepare(`
      UPDATE profiles SET credential_hash = '$scrypt$v1$malformed'
      WHERE id = ?
    `).run(created.profile.id);
    expect(() => manager.authenticateCredential(created.credential)).not.toThrow();
    expect(manager.authenticateCredential(created.credential)).toBeNull();
  });

  it('retries a deterministic alias collision and then succeeds', () => {
    const repository = new ProfileRepository(database);
    const first = new ProfileManager(
      repository,
      makeEntropy([0, 0, 1234], 'first-profile'),
    ).create({ avatarId: 'sakura', adultConfirmed: true });
    const second = new ProfileManager(
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

  it('stops after twenty alias collisions without partial rows', () => {
    const repository = new ProfileRepository(database);
    new ProfileManager(
      repository,
      makeEntropy([0, 0, 4321], 'existing-profile'),
    ).create({ avatarId: 'sakura', adultConfirmed: true });
    const collidingEntropy = makeEntropy(
      Array.from({ length: 60 }, (_, index) => index % 3 === 2 ? 4321 : 0),
      'colliding-profile',
    );

    expect(() => new ProfileManager(repository, collidingEntropy).create({
      avatarId: 'hana',
      adultConfirmed: true,
    })).toThrow(expect.objectContaining({
      code: 'ALIAS_GENERATION_EXHAUSTED',
    }));
    expect(collidingEntropy.integerCalls).toBe(60);
    expect(economyRowCounts(database)).toEqual({
      profiles: 1,
      wallets: 1,
      chipLedger: 1,
    });
  });

  it('rolls back profile and wallet inserts when starting ledger creation fails', () => {
    database.db.exec(`
      CREATE TRIGGER reject_profile_start
      BEFORE INSERT ON chip_ledger
      WHEN NEW.reason = 'PROFILE_START'
      BEGIN
        SELECT RAISE(ABORT, 'induced profile start failure');
      END;
    `);

    expect(() => manager.create({
      avatarId: 'chloe',
      adultConfirmed: true,
    })).toThrowError('induced profile start failure');
    expect(economyRowCounts(database)).toEqual({
      profiles: 0,
      wallets: 0,
      chipLedger: 0,
    });
  });

  it('recovers a profile while atomically replacing both one-time secrets', () => {
    const created = manager.create({
      avatarId: 'vivian',
      adultConfirmed: true,
    });

    const recovered = manager.recover(created.recoveryWords);

    expect(recovered).not.toBeNull();
    expect(recovered?.profile).toEqual(created.profile);
    expect(recovered?.credential).not.toBe(created.credential);
    expect(recovered?.recoveryWords).not.toBe(created.recoveryWords);
    expect(validateMnemonic(
      recovered?.recoveryWords ?? '',
      koreanWordlist,
    )).toBe(true);
    expect(manager.authenticateCredential(created.credential)).toBeNull();
    expect(manager.recover(created.recoveryWords)).toBeNull();
    expect(manager.authenticateCredential(recovered?.credential ?? '')).toEqual(
      created.profile,
    );
  });

  it('accepts equivalent NFKC and collapsed-whitespace recovery input', () => {
    const created = manager.create({
      avatarId: 'ara',
      adultConfirmed: true,
    });
    const equivalentInput = `  ${created.recoveryWords
      .normalize('NFC')
      .split(' ')
      .join(' \n\t ')}  `;

    expect(manager.recover(equivalentInput)?.profile.id).toBe(
      created.profile.id,
    );
  });

  it('rotates only recovery words while preserving the credential', () => {
    const created = manager.create({
      avatarId: 'hana',
      adultConfirmed: true,
    });

    const recoveryWords = manager.rotateRecovery(created.profile.id);

    expect(recoveryWords).not.toBe(created.recoveryWords);
    expect(validateMnemonic(recoveryWords, koreanWordlist)).toBe(true);
    expect(manager.recover(created.recoveryWords)).toBeNull();
    expect(manager.authenticateCredential(created.credential)).toEqual(
      created.profile,
    );
    expect(manager.recover(recoveryWords)?.profile.id).toBe(created.profile.id);
  });

  it('regenerates creation secrets after a credential lookup collision', () => {
    const existing = manager.create({
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

    const created = new ProfileManager(
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

  it('regenerates both recovery credentials after a lookup collision', () => {
    const first = manager.create({
      avatarId: 'chloe',
      adultConfirmed: true,
    });
    const second = manager.create({
      avatarId: 'vivian',
      adultConfirmed: true,
    });
    const uniqueRecovery = generateMnemonic(koreanWordlist, 128);
    const entropy = makeScriptedEntropy({
      recoveryWords: [second.recoveryWords, uniqueRecovery],
      seed: 'recovery-lookup-collision',
    });

    const recovered = new ProfileManager(
      new ProfileRepository(database),
      entropy,
    ).recover(first.recoveryWords);

    expect(recovered?.recoveryWords).toBe(uniqueRecovery);
    expect(recovered?.credential).not.toBe(first.credential);
    expect(manager.authenticateCredential(first.credential)).toBeNull();
    expect(manager.authenticateCredential(recovered?.credential ?? '')?.id).toBe(
      first.profile.id,
    );
    expect(manager.recover(second.recoveryWords)?.profile.id).toBe(
      second.profile.id,
    );
  });

  it('guards active escrow deletion and cascades settled profile economy data', () => {
    const created = manager.create({
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

    expect(manager.authenticateCredential(created.credential)?.wallet).toEqual({
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
    expect(manager.authenticateCredential(created.credential)).toBeNull();
  });

  it('never serializes secret or verifier fields in public profiles', () => {
    const created = manager.create({
      avatarId: 'elena',
      adultConfirmed: true,
    });
    const authenticated = manager.authenticateCredential(created.credential);
    const recovered = manager.recover(created.recoveryWords);

    for (const profile of [created.profile, authenticated, recovered?.profile]) {
      const serialized = JSON.stringify(profile);
      expect(serialized).not.toMatch(/credential|recovery|hash|lookup/i);
      expect(Object.keys(profile ?? {}).sort()).toEqual([
        'alias', 'avatarId', 'id', 'wallet',
      ]);
    }
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
