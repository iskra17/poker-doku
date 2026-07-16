import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openPokerDatabase, type PokerDatabase } from './persistence/database';
import {
  PLAYABLE_CHARACTER_IDS,
  ProgressionPersistenceError,
  ProgressionRepository,
  type PlayableCharacterId,
  type ProgressionCounters,
  type ProgressionCore,
} from './progression-repository';

describe('ProgressionRepository', () => {
  let database: PokerDatabase;
  let repository: ProgressionRepository;

  beforeEach(() => {
    database = openPokerDatabase(':memory:');
    repository = new ProgressionRepository(database);
  });

  afterEach(() => {
    database.close();
  });

  it('atomically lazy-initializes progression for an existing profile', () => {
    insertProfile(database, 'profile-a');

    const snapshot = repository.getOrCreate('profile-a', 'sakura', 1_000);

    expect(snapshot).toEqual({
      profile: {
        profileId: 'profile-a',
        balanceVersion: 1,
        dojoLevel: 1,
        dojoXpMilli: 0,
        selectedCharacterId: 'sakura',
        practiceDate: null,
        practiceHands: 0,
        completedHands: 0,
        cashHands: 0,
        practiceHandsTotal: 0,
        sngCompletions: 0,
        bestStreak: 0,
        createdAt: 1_000,
        updatedAt: 1_000,
      },
      affinities: [
        {
          profileId: 'profile-a',
          characterId: 'sakura',
          level: 1,
          xpMilli: 0,
        },
      ],
      streak: {
        profileId: 'profile-a',
        currentStreak: 0,
        restPasses: 0,
        lastQualifiedDate: null,
        lastWeekKey: null,
        createdAt: 1_000,
        updatedAt: 1_000,
      },
      inventory: [],
      equipment: {
        title: null,
        frame: null,
        skin: null,
        cutin: null,
      },
    });
    expect(rowCount(database, 'progression_profiles')).toBe(1);
    expect(rowCount(database, 'character_affinity')).toBe(1);
    expect(rowCount(database, 'streak_state')).toBe(1);
    expect(rowCount(database, 'profile_equipment')).toBe(4);
    expect(rowCount(database, 'wallets')).toBe(0);
  });

  it('does not duplicate or churn initialized rows and lazily adds another affinity', () => {
    insertProfile(database, 'profile-a');
    repository.getOrCreate('profile-a', 'sakura', 1_000);

    const duplicate = repository.getOrCreate('profile-a', 'sakura', 2_000);
    const withAnotherAffinity = repository.getOrCreate(
      'profile-a',
      'hana',
      3_000,
    );

    expect(duplicate.profile.createdAt).toBe(1_000);
    expect(duplicate.profile.updatedAt).toBe(1_000);
    expect(duplicate.streak.updatedAt).toBe(1_000);
    expect(withAnotherAffinity.profile.selectedCharacterId).toBe('sakura');
    expect(withAnotherAffinity.profile.updatedAt).toBe(1_000);
    expect(withAnotherAffinity.affinities.map(value => value.characterId))
      .toEqual(['hana', 'sakura']);
    expect(rowCount(database, 'progression_profiles')).toBe(1);
    expect(rowCount(database, 'character_affinity')).toBe(2);
    expect(rowCount(database, 'profile_equipment')).toBe(4);
  });

  it('accepts only the six approved playable characters', () => {
    expect(PLAYABLE_CHARACTER_IDS).toEqual([
      'sakura', 'ara', 'hana', 'chloe', 'vivian', 'elena',
    ]);
    for (const [index, characterId] of PLAYABLE_CHARACTER_IDS.entries()) {
      const profileId = `character-${characterId}`;
      insertProfile(database, profileId);
      expect(repository.getOrCreate(profileId, characterId, index).profile)
        .toMatchObject({ selectedCharacterId: characterId });
    }

    insertProfile(database, 'dealer-profile');
    expectErrorCode(
      () => repository.getOrCreate('dealer-profile', 'miyako', 1),
      'PROGRESSION_CHARACTER_INVALID',
    );
    expect(rowCount(database, 'progression_profiles', 'dealer-profile')).toBe(0);
  });

  it('rejects unknown profiles and unsafe timestamps without partial rows', () => {
    expectErrorCode(
      () => repository.getOrCreate('missing', 'sakura', 1_000),
      'PROGRESSION_PROFILE_NOT_FOUND',
    );

    insertProfile(database, 'profile-a');
    for (const at of [-1, Number.MAX_SAFE_INTEGER + 1, Number.NaN]) {
      expectErrorCode(
        () => repository.getOrCreate('profile-a', 'sakura', at),
        'PROGRESSION_TIME_INVALID',
      );
    }
    expect(rowCount(database, 'progression_profiles')).toBe(0);
    expect(rowCount(database, 'character_affinity')).toBe(0);
    expect(rowCount(database, 'streak_state')).toBe(0);
    expect(rowCount(database, 'profile_equipment')).toBe(0);
  });

  it('requires explicit transaction ownership for scoped helpers', () => {
    insertProfile(database, 'profile-a');

    expectErrorCode(
      () => repository.getOrCreateInTransaction(
        'profile-a',
        'sakura',
        1_000,
      ),
      'PROGRESSION_TRANSACTION_REQUIRED',
    );
    expectErrorCode(
      () => repository.getSnapshotInTransaction('profile-a'),
      'PROGRESSION_TRANSACTION_REQUIRED',
    );
    expectErrorCode(
      () => repository.getProgressionEvent('event-a'),
      'PROGRESSION_TRANSACTION_REQUIRED',
    );
    expect(rowCount(database, 'progression_profiles')).toBe(0);
  });

  it('rolls back state and event writes together when later work fails', () => {
    insertProfile(database, 'profile-a');
    repository.getOrCreate('profile-a', 'sakura', 1_000);
    const expected = core(1, 0, 'sakura');

    expect(() => database.transaction(() => {
      repository.compareAndUpdateProgressionInTransaction({
        profileId: 'profile-a',
        expected,
        next: core(2, 25_000, 'sakura'),
        updatedAt: 2_000,
      });
      repository.insertProgressionEvent({
        idempotencyKey: 'hand:room-a:1:profile-a',
        profileId: 'profile-a',
        eventType: 'completed-hand',
        balanceVersion: 1,
        summary: { dojoXpMilli: 25_000 },
        createdAt: 2_000,
      });
      throw new Error('later failure');
    })).toThrowError('later failure');

    const snapshot = repository.getOrCreate('profile-a', 'sakura', 3_000);
    expect(snapshot.profile).toMatchObject({
      dojoLevel: 1,
      dojoXpMilli: 0,
      updatedAt: 1_000,
    });
    expect(rowCount(database, 'progression_events')).toBe(0);
  });

  it('stores events once and returns the stored summary for exact duplicates', () => {
    insertProfile(database, 'profile-a');
    repository.getOrCreate('profile-a', 'sakura', 1_000);

    database.transaction(() => {
      const inserted = repository.insertProgressionEvent({
        idempotencyKey: 'event-a',
        profileId: 'profile-a',
        eventType: 'completed-hand',
        balanceVersion: 1,
        summary: { amount: 10, nested: { itemIds: ['frame-a'] } },
        createdAt: 2_000,
      });
      const duplicate = repository.insertProgressionEvent({
        idempotencyKey: 'event-a',
        profileId: 'profile-a',
        eventType: 'completed-hand',
        balanceVersion: 1,
        summary: { amount: 999 },
        createdAt: 3_000,
      });

      expect(inserted.status).toBe('inserted');
      expect(duplicate).toEqual({
        status: 'duplicate',
        event: inserted.event,
      });
      expect(repository.getProgressionEvent('event-a')).toEqual(inserted.event);
    });
    expect(rowCount(database, 'progression_events')).toBe(1);
  });

  it('rejects conflicting identities for an existing event key', () => {
    insertProfile(database, 'profile-a');
    insertProfile(database, 'profile-b');
    repository.getOrCreate('profile-a', 'sakura', 1_000);

    database.transaction(() => {
      repository.insertProgressionEvent({
        idempotencyKey: 'event-a',
        profileId: 'profile-a',
        eventType: 'completed-hand',
        balanceVersion: 1,
        summary: {},
        createdAt: 2_000,
      });
    });

    for (const conflict of [
      { profileId: 'profile-b', eventType: 'completed-hand', balanceVersion: 1 },
      { profileId: 'profile-a', eventType: 'sng-finish', balanceVersion: 1 },
      { profileId: 'profile-a', eventType: 'completed-hand', balanceVersion: 2 },
    ]) {
      expectErrorCode(() => database.transaction(() => {
        repository.insertProgressionEvent({
          idempotencyKey: 'event-a',
          ...conflict,
          summary: {},
          createdAt: 3_000,
        });
      }), 'PROGRESSION_EVENT_CONFLICT');
    }
    expect(rowCount(database, 'progression_events')).toBe(1);
  });

  it('validates and compare-and-swaps core, counters, and affinity rows', () => {
    insertProfile(database, 'profile-a');
    repository.getOrCreate('profile-a', 'sakura', 1_000);
    const initialCounters = counters(null, 0, 0, 0, 0, 0, 0);

    database.transaction(() => {
      repository.compareAndUpdateProgressionInTransaction({
        profileId: 'profile-a',
        expected: core(1, 0, 'sakura'),
        next: core(2, 25_000, 'hana'),
        updatedAt: 2_000,
      });
      repository.compareAndUpdateCountersInTransaction({
        profileId: 'profile-a',
        expected: initialCounters,
        next: counters('2026-07-17', 1, 1, 1, 0, 0, 1),
        updatedAt: 2_000,
      });
      repository.compareAndUpdateAffinityInTransaction({
        profileId: 'profile-a',
        characterId: 'sakura',
        expected: { level: 1, xpMilli: 0 },
        next: { level: 2, xpMilli: 5_000 },
      });
    });

    const snapshot = repository.getOrCreate('profile-a', 'hana', 3_000);
    expect(snapshot.profile).toMatchObject({
      dojoLevel: 2,
      dojoXpMilli: 25_000,
      selectedCharacterId: 'hana',
      practiceDate: '2026-07-17',
      practiceHands: 1,
      completedHands: 1,
      cashHands: 1,
      bestStreak: 1,
      updatedAt: 2_000,
    });
    expect(snapshot.affinities).toEqual([
      { profileId: 'profile-a', characterId: 'hana', level: 1, xpMilli: 0 },
      { profileId: 'profile-a', characterId: 'sakura', level: 2, xpMilli: 5_000 },
    ]);

    expectErrorCode(() => database.transaction(() => {
      repository.compareAndUpdateProgressionInTransaction({
        profileId: 'profile-a',
        expected: core(1, 0, 'sakura'),
        next: core(3, 0, 'hana'),
        updatedAt: 4_000,
      });
    }), 'PROGRESSION_CONFLICT');
    expectErrorCode(() => database.transaction(() => {
      repository.compareAndUpdateCountersInTransaction({
        profileId: 'profile-a',
        expected: counters('2026-07-17', 1, 1, 1, 0, 0, 1),
        next: counters(
          '2026-07-17',
          1,
          Number.MAX_SAFE_INTEGER + 1,
          1,
          0,
          0,
          1,
        ),
        updatedAt: 4_000,
      });
    }), 'PROGRESSION_VALUE_INVALID');
  });

  it('rejects non-canonical dates and unsupported balance versions from storage', () => {
    insertProfile(database, 'profile-a');
    repository.getOrCreate('profile-a', 'sakura', 1_000);

    database.db.prepare(`
      UPDATE progression_profiles SET practice_date = '2026-02-30'
      WHERE profile_id = 'profile-a'
    `).run();
    expectErrorCode(
      () => repository.getOrCreate('profile-a', 'sakura', 2_000),
      'PROGRESSION_PERSISTENCE_INVALID',
    );

    database.db.prepare(`
      UPDATE progression_profiles
      SET practice_date = NULL, balance_version = 2
      WHERE profile_id = 'profile-a'
    `).run();
    expectErrorCode(
      () => repository.getOrCreate('profile-a', 'sakura', 2_000),
      'PROGRESSION_PERSISTENCE_INVALID',
    );
  });

  it('rejects malformed persisted event JSON with the generic persistence error', () => {
    insertProfile(database, 'profile-a');
    repository.getOrCreate('profile-a', 'sakura', 1_000);
    database.transaction(() => {
      repository.insertProgressionEvent({
        idempotencyKey: 'event-a',
        profileId: 'profile-a',
        eventType: 'completed-hand',
        balanceVersion: 1,
        summary: {},
        createdAt: 2_000,
      });
    });
    database.db.exec('PRAGMA ignore_check_constraints = ON;');
    database.db.prepare(`
      UPDATE progression_events SET summary_json = '[]'
      WHERE idempotency_key = 'event-a'
    `).run();
    database.db.exec('PRAGMA ignore_check_constraints = OFF;');

    expectErrorCode(() => database.transaction(() => {
      repository.getProgressionEvent('event-a');
    }), 'PROGRESSION_PERSISTENCE_INVALID');
  });

  it('rejects malformed input summaries and unsafe stored counters', () => {
    insertProfile(database, 'profile-a');
    repository.getOrCreate('profile-a', 'sakura', 1_000);
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;

    expectErrorCode(() => database.transaction(() => {
      repository.insertProgressionEvent({
        idempotencyKey: 'event-a',
        profileId: 'profile-a',
        eventType: 'completed-hand',
        balanceVersion: 1,
        summary: cyclic,
        createdAt: 2_000,
      });
    }), 'PROGRESSION_VALUE_INVALID');
    expectErrorCode(() => database.transaction(() => {
      repository.insertProgressionEvent({
        idempotencyKey: 'event-unsafe-number',
        profileId: 'profile-a',
        eventType: 'completed-hand',
        balanceVersion: 1,
        summary: { amount: Number.MAX_SAFE_INTEGER + 1 },
        createdAt: 2_000,
      });
    }), 'PROGRESSION_VALUE_INVALID');

    database.db.exec('PRAGMA ignore_check_constraints = ON;');
    database.db.prepare(`
      UPDATE progression_profiles SET completed_hands = -1
      WHERE profile_id = 'profile-a'
    `).run();
    database.db.exec('PRAGMA ignore_check_constraints = OFF;');
    expectErrorCode(
      () => repository.getOrCreate('profile-a', 'sakura', 2_000),
      'PROGRESSION_PERSISTENCE_INVALID',
    );

    database.db.exec(`
      UPDATE progression_profiles SET completed_hands = 9223372036854775807
      WHERE profile_id = 'profile-a'
    `);
    expectErrorCode(
      () => repository.getOrCreate('profile-a', 'sakura', 2_000),
      'PROGRESSION_PERSISTENCE_INVALID',
    );
  });
});

function core(
  dojoLevel: number,
  dojoXpMilli: number,
  selectedCharacterId: PlayableCharacterId,
): ProgressionCore {
  return { balanceVersion: 1, dojoLevel, dojoXpMilli, selectedCharacterId };
}

function counters(
  practiceDate: string | null,
  practiceHands: number,
  completedHands: number,
  cashHands: number,
  practiceHandsTotal: number,
  sngCompletions: number,
  bestStreak: number,
): ProgressionCounters {
  return {
    practiceDate,
    practiceHands,
    completedHands,
    cashHands,
    practiceHandsTotal,
    sngCompletions,
    bestStreak,
  };
}

function insertProfile(database: PokerDatabase, id: string): void {
  database.db.prepare(`
    INSERT INTO profiles (
      id, credential_hash, credential_lookup, recovery_hash, recovery_lookup,
      alias, avatar_id, adult_confirmed_at, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, 'sakura', 1, 1, 1)
  `).run(
    id,
    `credential-hash-${id}`,
    `credential-lookup-${id}`,
    `recovery-hash-${id}`,
    `recovery-lookup-${id}`,
    `alias-${id}`,
  );
}

function rowCount(
  database: PokerDatabase,
  table: string,
  profileId?: string,
): number {
  const row = (profileId === undefined
    ? database.db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get()
    : database.db.prepare(
      `SELECT COUNT(*) AS count FROM ${table} WHERE profile_id = ?`,
    ).get(profileId)) as { count: number };
  return row.count;
}

function expectErrorCode(work: () => unknown, expectedCode: string): void {
  let thrown: unknown;
  try {
    work();
  } catch (error) {
    thrown = error;
  }
  expect(thrown).toBeInstanceOf(ProgressionPersistenceError);
  expect((thrown as ProgressionPersistenceError).code).toBe(expectedCode);
}
