import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openPokerDatabase, type PokerDatabase } from './persistence/database';
import {
  PLAYABLE_CHARACTER_IDS,
  ProgressionPersistenceError,
  ProgressionRepository,
  PROGRESSION_SUMMARY_LIMITS,
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

  it('repairs only a missing streak child without recreating progression siblings', () => {
    insertProfile(database, 'repair-streak-child');
    const before = repository.getOrCreate(
      'repair-streak-child',
      'sakura',
      1_000,
    );
    database.db.prepare(`
      DELETE FROM streak_state WHERE profile_id = 'repair-streak-child'
    `).run();

    const repaired = repository.getOrCreate(
      'repair-streak-child',
      'sakura',
      2_000,
    );

    expect(repaired.profile).toEqual(before.profile);
    expect(repaired.streak).toEqual({
      profileId: 'repair-streak-child',
      currentStreak: 0,
      restPasses: 0,
      lastQualifiedDate: null,
      lastWeekKey: null,
      createdAt: before.profile.createdAt,
      updatedAt: before.profile.updatedAt,
    });
    expect(rowCount(database, 'progression_profiles', 'repair-streak-child'))
      .toBe(1);
    expect(rowCount(database, 'character_affinity', 'repair-streak-child'))
      .toBe(1);
    expect(rowCount(database, 'profile_equipment', 'repair-streak-child'))
      .toBe(4);
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

  it('fails closed when a stored equipment timestamp bypasses DB guards', () => {
    insertProfile(database, 'unsafe-equipment-snapshot');
    repository.getOrCreate('unsafe-equipment-snapshot', 'sakura', 1);
    database.db.exec('DROP TRIGGER validate_collection_equipment_shape_update');
    database.db.prepare(`
      UPDATE profile_equipment SET updated_at = 253402300800000
      WHERE profile_id = 'unsafe-equipment-snapshot' AND slot = 'title'
    `).run();

    expectErrorCode(
      () => repository.getOrCreate('unsafe-equipment-snapshot', 'sakura', 2),
      'PROGRESSION_PERSISTENCE_INVALID',
    );
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
    expectErrorCode(
      () => repository.advanceStreakDailyProgressInTransaction({
        profileId: 'profile-a',
        kstDate: '2026-07-17',
        kind: 'hand',
        completedAt: 1_000,
      }),
      'PROGRESSION_TRANSACTION_REQUIRED',
    );
    expectErrorCode(
      () => repository.compareAndUpdateStreakInTransaction({
        profileId: 'profile-a',
        expected: {
          currentStreak: 0,
          restPasses: 0,
          lastQualifiedDate: null,
          lastWeekKey: null,
          updatedAt: 1_000,
        },
        next: {
          currentStreak: 0,
          restPasses: 1,
          lastQualifiedDate: null,
          lastWeekKey: '2026-W29',
        },
        updatedAt: 1_000,
      }),
      'PROGRESSION_TRANSACTION_REQUIRED',
    );
    expectErrorCode(
      () => repository.grantStackableInventoryItemInTransaction({
        idempotencyKey: 'streak-fragment:profile-a:2026-07-17',
        profileId: 'profile-a',
        itemId: 'streak-fragment',
        balanceVersion: 1,
        grantedAt: 1_000,
        source: 'streak',
        sourceRef: 'streak-fragment:profile-a:1970-01-01',
        sourceEventId: 'event-a',
        sourceDate: '1970-01-01',
      }),
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

  it.each([
    [
      'partial reward summary',
      1,
      {
        dojoLevelsGained: [5],
        grantedItemIds: ['dojo-frame-cherry-blossom'],
      },
    ],
    [
      'unsupported balance',
      2,
      validRewardSummary('repository-balance-two', {
        dojoLevelsGained: [5],
        grantedItemIds: ['dojo-frame-cherry-blossom'],
      }),
    ],
  ])('rolls a permanent grant back for a %s source', (
    _label,
    balanceVersion,
    summary,
  ) => {
    insertProfile(database, 'repository-source-proof');
    repository.getOrCreate('repository-source-proof', 'sakura', 1);
    database.db.prepare(`
      UPDATE progression_profiles SET dojo_level = 5, dojo_xp_milli = 0
      WHERE profile_id = 'repository-source-proof'
    `).run();

    expect(() => database.transaction(() => {
      repository.grantPermanentInventoryItemInTransaction({
        profileId: 'repository-source-proof',
        itemId: 'dojo-frame-cherry-blossom',
        sourceEventId: balanceVersion === 1
          ? 'repository-partial'
          : 'repository-balance-two',
        source: { kind: 'dojo-level', level: 5 },
        grantedAt: 10,
      });
      repository.insertProgressionEvent({
        idempotencyKey: balanceVersion === 1
          ? 'repository-partial'
          : 'repository-balance-two',
        profileId: 'repository-source-proof',
        eventType: 'completed-hand',
        balanceVersion,
        summary,
        createdAt: 10,
      });
    })).toThrowError(ProgressionPersistenceError);
    expect(rowCount(
      database,
      'permanent_progression_grants',
      'repository-source-proof',
    )).toBe(0);
    expect(rowCount(
      database,
      'inventory_items',
      'repository-source-proof',
    )).toBe(0);
    expect(rowCount(
      database,
      'progression_events',
      'repository-source-proof',
    )).toBe(0);
  });

  it('returns duplicate or conflict before inspecting a caller retry summary', () => {
    insertProfile(database, 'profile-a');
    repository.getOrCreate('profile-a', 'sakura', 1_000);
    database.transaction(() => {
      repository.insertProgressionEvent({
        idempotencyKey: 'event-a',
        profileId: 'profile-a',
        eventType: 'completed-hand',
        balanceVersion: 1,
        summary: { stored: true },
        createdAt: 2_000,
      });
    });
    let inspected = false;
    const hostileRetry = new Proxy<Record<string, unknown>>({}, {
      ownKeys() {
        inspected = true;
        throw new Error('sensitive-retry-summary');
      },
      getPrototypeOf() {
        inspected = true;
        throw new Error('sensitive-retry-prototype');
      },
    });

    const duplicate = database.transaction(() => (
      repository.insertProgressionEvent({
        idempotencyKey: 'event-a',
        profileId: 'profile-a',
        eventType: 'completed-hand',
        balanceVersion: 1,
        summary: hostileRetry,
        createdAt: Number.NaN,
      })
    ));
    expect(duplicate).toMatchObject({
      status: 'duplicate',
      event: { summary: { stored: true } },
    });
    expect(inspected).toBe(false);

    const conflict = captureError(() => database.transaction(() => {
      repository.insertProgressionEvent({
        idempotencyKey: 'event-a',
        profileId: 'profile-a',
        eventType: 'sng-finish',
        balanceVersion: 1,
        summary: hostileRetry,
        createdAt: Number.NaN,
      });
    }), 'PROGRESSION_EVENT_CONFLICT');
    expect(conflict.message).not.toContain('sensitive');
    expect(inspected).toBe(false);
  });

  it('canonicalizes only bounded data descriptors without executing user code', () => {
    insertProfile(database, 'profile-a');
    repository.getOrCreate('profile-a', 'sakura', 1_000);
    let getterCalled = false;
    const accessorSummary: Record<string, unknown> = {};
    Object.defineProperty(accessorSummary, 'secret', {
      enumerable: true,
      get() {
        getterCalled = true;
        throw new Error('sensitive-getter-message');
      },
    });
    const accessorError = captureError(
      () => insertEvent(repository, database, 'accessor', accessorSummary),
      'PROGRESSION_VALUE_INVALID',
    );
    expect(getterCalled).toBe(false);
    expect(accessorError.message).not.toContain('sensitive');

    let toJsonCalled = false;
    const toJsonSummary = { safe: true } as Record<string, unknown>;
    Object.defineProperty(toJsonSummary, 'toJSON', {
      enumerable: false,
      value: () => {
        toJsonCalled = true;
        return { replaced: true };
      },
    });
    captureError(
      () => insertEvent(repository, database, 'to-json', toJsonSummary),
      'PROGRESSION_VALUE_INVALID',
    );
    expect(toJsonCalled).toBe(false);

    const symbolSummary: Record<string, unknown> = { safe: true };
    Object.defineProperty(symbolSummary, Symbol('hidden'), {
      enumerable: true,
      value: 1,
    });
    captureError(
      () => insertEvent(repository, database, 'symbol', symbolSummary),
      'PROGRESSION_VALUE_INVALID',
    );

    const nonEnumerableSummary: Record<string, unknown> = { safe: true };
    Object.defineProperty(nonEnumerableSummary, 'hidden', {
      enumerable: false,
      value: 1,
    });
    captureError(
      () => insertEvent(
        repository,
        database,
        'non-enumerable',
        nonEnumerableSummary,
      ),
      'PROGRESSION_VALUE_INVALID',
    );

    for (const dangerousKey of ['__proto__', 'constructor', 'prototype']) {
      const dangerousSummary = Object.create(null) as Record<string, unknown>;
      Object.defineProperty(dangerousSummary, dangerousKey, {
        enumerable: true,
        configurable: true,
        writable: true,
        value: 'blocked',
      });
      captureError(
        () => insertEvent(
          repository,
          database,
          `dangerous-${dangerousKey}`,
          dangerousSummary,
        ),
        'PROGRESSION_VALUE_INVALID',
      );
    }
    expect(rowCount(database, 'progression_events')).toBe(0);
  });

  it('normalizes Proxy traps, cycles, and summary resource limits', () => {
    insertProfile(database, 'profile-a');
    repository.getOrCreate('profile-a', 'sakura', 1_000);
    for (const [key, summary] of [
      [
        'proxy-prototype',
        new Proxy({}, {
          getPrototypeOf() {
            throw new Error('sensitive-proxy-prototype');
          },
        }),
      ],
      [
        'proxy-own-keys',
        new Proxy({}, {
          ownKeys() {
            throw new ProgressionPersistenceError(
              'PROGRESSION_PROFILE_NOT_FOUND',
            );
          },
        }),
      ],
    ] as const) {
      const error = captureError(
        () => insertEvent(repository, database, key, summary),
        'PROGRESSION_VALUE_INVALID',
      );
      expect(error.message).not.toContain('sensitive');
    }

    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    captureError(
      () => insertEvent(repository, database, 'cycle', cyclic),
      'PROGRESSION_VALUE_INVALID',
    );
    const indirectA: Record<string, unknown> = {};
    const indirectB: Record<string, unknown> = {};
    indirectA.next = indirectB;
    indirectB.previous = indirectA;
    captureError(
      () => insertEvent(repository, database, 'indirect-cycle', indirectA),
      'PROGRESSION_VALUE_INVALID',
    );

    const tooDeep: Record<string, unknown> = {};
    let cursor = tooDeep;
    for (let depth = 0; depth < 15_000; depth += 1) {
      const next: Record<string, unknown> = {};
      cursor.next = next;
      cursor = next;
    }
    captureError(
      () => insertEvent(repository, database, 'deep', tooDeep),
      'PROGRESSION_VALUE_INVALID',
    );

    const tooManyNodes = {
      values: Array.from(
        { length: PROGRESSION_SUMMARY_LIMITS.maxNodes },
        (_, index) => index,
      ),
    };
    captureError(
      () => insertEvent(repository, database, 'nodes', tooManyNodes),
      'PROGRESSION_VALUE_INVALID',
    );
    const tooManyBytes = {
      text: '한'.repeat(PROGRESSION_SUMMARY_LIMITS.maxUtf8Bytes),
    };
    captureError(
      () => insertEvent(repository, database, 'bytes', tooManyBytes),
      'PROGRESSION_VALUE_INVALID',
    );
    expect(rowCount(database, 'progression_events')).toBe(0);
  });

  it('stores deterministic sorted JSON and returns an immutable canonical clone', () => {
    insertProfile(database, 'profile-a');
    repository.getOrCreate('profile-a', 'sakura', 1_000);

    const inserted = database.transaction(() => (
      repository.insertProgressionEvent({
        idempotencyKey: 'canonical-event',
        profileId: 'profile-a',
        eventType: 'completed-hand',
        balanceVersion: 1,
        summary: { z: 1, a: { y: 2, b: 3 } },
        createdAt: 2_000,
      })
    ));

    expect(database.db.prepare(`
      SELECT summary_json FROM progression_events
      WHERE idempotency_key = 'canonical-event'
    `).get()).toEqual({ summary_json: '{"a":{"b":3,"y":2},"z":1}' });
    expect(inserted.event.summary).toEqual({ a: { b: 3, y: 2 }, z: 1 });
    expect(Object.isFrozen(inserted.event.summary)).toBe(true);
    expect(Object.isFrozen(inserted.event.summary.a)).toBe(true);
  });

  it('normalizes negative zero consistently across insert and DB roundtrip', () => {
    insertProfile(database, 'profile-a');
    repository.getOrCreate('profile-a', 'sakura', 1_000);

    const inserted = database.transaction(() => (
      repository.insertProgressionEvent({
        idempotencyKey: 'numeric-event',
        profileId: 'profile-a',
        eventType: 'completed-hand',
        balanceVersion: 1,
        summary: { negativeZero: -0, zero: 0, positive: 7, negative: -7 },
        createdAt: 2_000,
      })
    ));
    const duplicate = database.transaction(() => (
      repository.insertProgressionEvent({
        idempotencyKey: 'numeric-event',
        profileId: 'profile-a',
        eventType: 'completed-hand',
        balanceVersion: 1,
        summary: {},
        createdAt: 3_000,
      })
    ));
    const insertedSummary = inserted.event.summary as Record<string, number>;
    const duplicateSummary = duplicate.event.summary as Record<string, number>;

    expect(Object.is(insertedSummary.negativeZero, 0)).toBe(true);
    expect(Object.is(insertedSummary.negativeZero, -0)).toBe(false);
    expect(Object.is(
      insertedSummary.negativeZero,
      duplicateSummary.negativeZero,
    )).toBe(true);
    expect(insertedSummary).toEqual(duplicateSummary);
    expect(insertedSummary).toMatchObject({
      zero: 0,
      positive: 7,
      negative: -7,
    });
  });

  it('expands shared-reference DAGs into distinct immutable clones', () => {
    insertProfile(database, 'profile-a');
    repository.getOrCreate('profile-a', 'sakura', 1_000);
    const shared = { value: 7, nested: [1, 2] };

    const inserted = database.transaction(() => (
      repository.insertProgressionEvent({
        idempotencyKey: 'dag-event',
        profileId: 'profile-a',
        eventType: 'completed-hand',
        balanceVersion: 1,
        summary: { a: shared, b: shared },
        createdAt: 2_000,
      })
    ));
    const summary = inserted.event.summary as {
      a: { value: number; nested: number[] };
      b: { value: number; nested: number[] };
    };

    expect(summary.a).toEqual(summary.b);
    expect(summary.a).not.toBe(summary.b);
    expect(summary.a.nested).not.toBe(summary.b.nested);
    expect(Object.isFrozen(summary.a)).toBe(true);
    expect(Object.isFrozen(summary.b)).toBe(true);
    expect(Object.isFrozen(summary.a.nested)).toBe(true);
    expect(Object.isFrozen(summary.b.nested)).toBe(true);

    const stored = database.transaction(() => (
      repository.getProgressionEvent('dag-event')
    ));
    const storedSummary = stored?.summary as typeof summary;
    expect(storedSummary.a).toEqual(storedSummary.b);
    expect(storedSummary.a).not.toBe(storedSummary.b);
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

    database.db.exec('PRAGMA ignore_check_constraints = ON;');
    database.db.prepare(`
      UPDATE progression_profiles SET practice_date = '2026-02-30'
      WHERE profile_id = 'profile-a'
    `).run();
    database.db.exec('PRAGMA ignore_check_constraints = OFF;');
    expectErrorCode(
      () => repository.getOrCreate('profile-a', 'sakura', 2_000),
      'PROGRESSION_PERSISTENCE_INVALID',
    );

    database.db.exec('PRAGMA ignore_check_constraints = ON;');
    database.db.prepare(`
      UPDATE progression_profiles
      SET practice_date = NULL, balance_version = 2
      WHERE profile_id = 'profile-a'
    `).run();
    database.db.exec('PRAGMA ignore_check_constraints = OFF;');
    expectErrorCode(
      () => repository.getOrCreate('profile-a', 'sakura', 2_000),
      'PROGRESSION_PERSISTENCE_INVALID',
    );
  });

  it('rejects non-normalized dojo and affinity XP from legacy storage', () => {
    for (const [profileId, corruption] of [
      [
        'dojo-corrupt',
        `UPDATE progression_profiles
         SET dojo_level = 1, dojo_xp_milli = 100000
         WHERE profile_id = 'dojo-corrupt'`,
      ],
      [
        'affinity-corrupt',
        `UPDATE character_affinity
         SET level = 1, xp_milli = 40000
         WHERE profile_id = 'affinity-corrupt' AND character_id = 'sakura'`,
      ],
    ] as const) {
      insertProfile(database, profileId);
      repository.getOrCreate(profileId, 'sakura', 1_000);
      database.db.exec('PRAGMA ignore_check_constraints = ON;');
      database.db.exec(corruption);
      database.db.exec('PRAGMA ignore_check_constraints = OFF;');

      expectErrorCode(
        () => repository.getOrCreate(profileId, 'sakura', 2_000),
        'PROGRESSION_PERSISTENCE_INVALID',
      );
    }
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

    database.db.exec('DROP TRIGGER validate_progression_profile_safe_update;');
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

  it('normalizes every unexpected write failure and fully rolls back', () => {
    insertProfile(database, 'trigger-public-init');
    database.db.exec(`
      CREATE TRIGGER fail_public_init
      BEFORE INSERT ON progression_profiles
      BEGIN SELECT RAISE(ABORT, 'sensitive-public-init'); END;
    `);
    expectSafePersistenceFailure(() => {
      repository.getOrCreate('trigger-public-init', 'sakura', 1_000);
    });
    expect(rowCount(database, 'progression_profiles', 'trigger-public-init'))
      .toBe(0);
    database.db.exec('DROP TRIGGER fail_public_init;');

    insertProfile(database, 'trigger-scoped-init');
    database.db.exec(`
      CREATE TRIGGER fail_scoped_init
      BEFORE INSERT ON profile_equipment
      BEGIN SELECT RAISE(ABORT, 'sensitive-scoped-init'); END;
    `);
    expectSafePersistenceFailure(() => database.transaction(() => {
      repository.getOrCreateInTransaction(
        'trigger-scoped-init',
        'sakura',
        1_000,
      );
    }));
    expect(rowCount(database, 'progression_profiles', 'trigger-scoped-init'))
      .toBe(0);
    expect(rowCount(database, 'streak_state', 'trigger-scoped-init')).toBe(0);
    database.db.exec('DROP TRIGGER fail_scoped_init;');

    insertProfile(database, 'trigger-writes');
    repository.getOrCreate('trigger-writes', 'sakura', 1_000);
    database.db.exec(`
      CREATE TRIGGER fail_core
      BEFORE INSERT ON character_affinity
      WHEN NEW.character_id = 'hana'
      BEGIN SELECT RAISE(ABORT, 'sensitive-core-followup'); END;
    `);
    expectSafePersistenceFailure(() => database.transaction(() => {
      repository.compareAndUpdateProgressionInTransaction({
        profileId: 'trigger-writes',
        expected: core(1, 0, 'sakura'),
        next: core(2, 0, 'hana'),
        updatedAt: 2_000,
      });
    }));
    database.db.exec('DROP TRIGGER fail_core;');

    database.db.exec(`
      CREATE TRIGGER fail_counters
      BEFORE UPDATE OF completed_hands ON progression_profiles
      BEGIN SELECT RAISE(ABORT, 'sensitive-counter-update'); END;
    `);
    expectSafePersistenceFailure(() => database.transaction(() => {
      repository.compareAndUpdateCountersInTransaction({
        profileId: 'trigger-writes',
        expected: counters(null, 0, 0, 0, 0, 0, 0),
        next: counters(null, 0, 1, 1, 0, 0, 0),
        updatedAt: 2_000,
      });
    }));
    database.db.exec('DROP TRIGGER fail_counters;');

    database.db.exec(`
      CREATE TRIGGER fail_affinity
      BEFORE UPDATE ON character_affinity
      BEGIN SELECT RAISE(ABORT, 'sensitive-affinity-update'); END;
    `);
    expectSafePersistenceFailure(() => database.transaction(() => {
      repository.compareAndUpdateAffinityInTransaction({
        profileId: 'trigger-writes',
        characterId: 'sakura',
        expected: { level: 1, xpMilli: 0 },
        next: { level: 2, xpMilli: 0 },
      });
    }));
    database.db.exec('DROP TRIGGER fail_affinity;');

    database.db.exec(`
      CREATE TRIGGER fail_event
      BEFORE INSERT ON progression_events
      BEGIN SELECT RAISE(ABORT, 'sensitive-event-insert'); END;
    `);
    expectSafePersistenceFailure(() => database.transaction(() => {
      repository.insertProgressionEvent({
        idempotencyKey: 'trigger-event',
        profileId: 'trigger-writes',
        eventType: 'completed-hand',
        balanceVersion: 1,
        summary: {},
        createdAt: 2_000,
      });
    }));
    database.db.exec('DROP TRIGGER fail_event;');

    const snapshot = repository.getOrCreate('trigger-writes', 'sakura', 3_000);
    expect(snapshot.profile).toMatchObject({
      dojoLevel: 1,
      dojoXpMilli: 0,
      completedHands: 0,
      cashHands: 0,
      updatedAt: 1_000,
    });
    expect(snapshot.affinities).toEqual([
      {
        profileId: 'trigger-writes',
        characterId: 'sakura',
        level: 1,
        xpMilli: 0,
      },
    ]);
    expect(rowCount(database, 'progression_events', 'trigger-writes')).toBe(0);
  });

  it('assigns and durably reads exactly three missions per KST day', () => {
    insertProfile(database, 'mission-profile');
    repository.getOrCreate('mission-profile', 'sakura', 1_000);

    const first = database.transaction(() => (
      repository.ensureDailyMissionsInTransaction(
        'mission-profile', '2026-07-17', 1, 2_000,
      )
    ));
    const restart = database.transaction(() => (
      repository.ensureDailyMissionsInTransaction(
        'mission-profile', '2026-07-17', 1, 9_000,
      )
    ));
    const tomorrow = database.transaction(() => (
      repository.ensureDailyMissionsInTransaction(
        'mission-profile', '2026-07-18', 1, 10_000,
      )
    ));

    expect(first).toEqual(restart);
    expect(first.missions.map(mission => mission.slot)).toEqual([0, 1, 2]);
    expect(new Set(first.missions.map(mission => mission.missionId)).size)
      .toBe(3);
    expect(first.missions.every(mission => mission.assignedAt === 2_000))
      .toBe(true);
    expect(first.modes).toEqual([]);
    expect(tomorrow.missionDate).toBe('2026-07-18');
    expect(rowCount(database, 'daily_missions', 'mission-profile')).toBe(6);
  });

  it('stores each completed mode once and returns a sorted set snapshot', () => {
    insertProfile(database, 'mode-profile');
    repository.getOrCreate('mode-profile', 'sakura', 1_000);
    database.transaction(() => {
      repository.ensureDailyMissionsInTransaction(
        'mode-profile', '2026-07-17', 1, 2_000,
      );
      repository.insertDailyMissionModeInTransaction(
        'mode-profile', '2026-07-17', 'cash', 3_000,
      );
      repository.insertDailyMissionModeInTransaction(
        'mode-profile', '2026-07-17', 'cash', 4_000,
      );
      repository.insertDailyMissionModeInTransaction(
        'mode-profile', '2026-07-17', 'practice', 5_000,
      );
    });

    const day = database.transaction(() => (
      repository.readDailyMissionDayInTransaction(
        'mode-profile', '2026-07-17', 1,
      )
    ));
    expect(day.modes).toEqual(['cash', 'practice']);
    expect(rowCount(database, 'daily_mission_modes', 'mode-profile')).toBe(2);
  });

  it('clamps progress, completes and rewards each mission exactly once', () => {
    insertProfile(database, 'progress-profile');
    repository.getOrCreate('progress-profile', 'sakura', 1_000);
    database.transaction(() => {
      repository.ensureDailyMissionsInTransaction(
        'progress-profile', '2026-07-17', 1, 2_000,
      );
      repository.insertDailyMissionModeInTransaction(
        'progress-profile', '2026-07-17', 'cash', 2_000,
      );
      repository.insertDailyMissionModeInTransaction(
        'progress-profile', '2026-07-17', 'practice', 2_000,
      );
      repository.insertDailyMissionModeInTransaction(
        'progress-profile', '2026-07-17', 'sng', 2_000,
      );
    });

    const completions = [];
    for (let index = 0; index < 20; index += 1) {
      completions.push(...database.transaction(() => (
        repository.advanceDailyMissionsInTransaction({
          profileId: 'progress-profile',
          missionDate: '2026-07-17',
          balanceVersion: 1,
          metricDeltas: {
            handsAny: 1,
            handsCash: 1,
            handsPractice: 1,
            sngCompleted: 1,
          },
          completedAt: 3_000 + index,
        })
      )));
    }
    const afterCompletion = database.transaction(() => (
      repository.advanceDailyMissionsInTransaction({
        profileId: 'progress-profile',
        missionDate: '2026-07-17',
        balanceVersion: 1,
        metricDeltas: { handsAny: 1 },
        completedAt: 9_000,
      })
    ));

    expect(completions).toHaveLength(3);
    expect(new Set(completions.map(mission => mission.slot)).size).toBe(3);
    expect(afterCompletion).toEqual([]);
    const day = database.transaction(() => (
      repository.readDailyMissionDayInTransaction(
        'progress-profile', '2026-07-17', 1,
      )
    ));
    expect(day.missions.every(mission => (
      mission.progress === mission.target
      && mission.completedAt !== null
      && mission.rewardedAt === mission.completedAt
    ))).toBe(true);
  });

  it('rejects partial or malformed stored mission sets with one generic error', () => {
    insertProfile(database, 'malformed-missions');
    repository.getOrCreate('malformed-missions', 'sakura', 1_000);
    database.transaction(() => {
      repository.ensureDailyMissionsInTransaction(
        'malformed-missions', '2026-07-17', 1, 2_000,
      );
    });
    database.db.exec('DROP TRIGGER validate_daily_mission_update;');
    database.db.prepare(`
      UPDATE daily_missions SET target = target + 1
      WHERE profile_id = 'malformed-missions' AND slot = 0
    `).run();

    expectErrorCode(() => database.transaction(() => {
      repository.readDailyMissionDayInTransaction(
        'malformed-missions', '2026-07-17', 1,
      );
    }), 'PROGRESSION_PERSISTENCE_INVALID');
  });

  it('does not recreate a previously used day whose entire mission set vanished', () => {
    insertProfile(database, 'missing-mission-day');
    repository.getOrCreate('missing-mission-day', 'sakura', 1_000);
    database.transaction(() => {
      repository.ensureDailyMissionsInTransaction(
        'missing-mission-day', '2026-07-17', 1, 2_000,
      );
      repository.insertDailyMissionModeInTransaction(
        'missing-mission-day', '2026-07-17', 'cash', 2_000,
      );
    });
    database.db.prepare(`
      DELETE FROM daily_missions
      WHERE profile_id = 'missing-mission-day' AND mission_date = '2026-07-17'
    `).run();

    expectErrorCode(() => database.transaction(() => {
      repository.ensureDailyMissionsInTransaction(
        'missing-mission-day', '2026-07-17', 1, 3_000,
      );
    }), 'PROGRESSION_PERSISTENCE_INVALID');
    expect(rowCount(database, 'daily_missions', 'missing-mission-day')).toBe(0);
  });

  it('rejects a duplicate fragment receipt whose inventory mutation is missing', () => {
    const profileId = 'fragment-receipt-corrupt';
    const key = `streak-fragment:${profileId}:2026-07-17`;
    insertProfile(database, profileId);
    repository.getOrCreate(profileId, 'sakura', 1_000);
    const grantedAt = Date.parse('2026-07-17T12:00:00+09:00');
    database.transaction(() => {
      repository.insertProgressionEvent({
        idempotencyKey: 'corrupt-main-event',
        profileId,
        eventType: 'completed-hand',
        balanceVersion: 1,
        summary: fragmentSourceSummary('corrupt-main-event'),
        createdAt: grantedAt,
      });
    });
    database.db.prepare(`
      INSERT INTO streak_daily_progress (
        profile_id, kst_date, hands, sngs, qualified_at
      ) VALUES (?, '2026-07-17', 0, 1, ?)
    `).run(profileId, grantedAt);
    database.db.exec('DROP TRIGGER sync_fragment_inventory_insert;');
    database.db.prepare(`
      INSERT INTO progression_item_grants (
        idempotency_key, profile_id, item_id, source, source_ref,
        source_event_id, source_date, quantity, granted_at
      ) VALUES (
        ?, ?, 'streak-fragment', 'streak', ?, ?, '2026-07-17', 1, ?
      )
    `).run(key, profileId, key, 'corrupt-main-event', grantedAt);

    expectErrorCode(() => database.transaction(() => {
      repository.grantStackableInventoryItemInTransaction({
        idempotencyKey: key,
        profileId,
        itemId: 'streak-fragment',
        balanceVersion: 1,
        grantedAt,
        source: 'streak',
        sourceRef: key,
        sourceEventId: 'corrupt-main-event',
        sourceDate: '2026-07-17',
      });
    }), 'PROGRESSION_PERSISTENCE_INVALID');
  });

  it('rejects a fragment source summary that does not prove the reward claim', () => {
    const profileId = 'invalid-fragment-source-summary';
    const sourceDate = '2026-07-17';
    const grantedAt = Date.parse(`${sourceDate}T12:00:00+09:00`);
    const key = `streak-fragment:${profileId}:${sourceDate}`;
    insertProfile(database, profileId);
    repository.getOrCreate(profileId, 'sakura', 1_000);
    database.db.prepare(`
      INSERT INTO streak_daily_progress VALUES (?, ?, 0, 1, ?)
    `).run(profileId, sourceDate, grantedAt);
    database.transaction(() => {
      repository.insertProgressionEvent({
        idempotencyKey: 'invalid-fragment-main-event',
        profileId,
        eventType: 'sng-finish',
        balanceVersion: 1,
        summary: {},
        createdAt: grantedAt,
      });
    });

    expectErrorCode(() => database.transaction(() => {
      repository.grantStackableInventoryItemInTransaction({
        idempotencyKey: key,
        profileId,
        itemId: 'streak-fragment',
        balanceVersion: 1,
        grantedAt,
        source: 'streak',
        sourceRef: key,
        sourceEventId: 'invalid-fragment-main-event',
        sourceDate,
      });
    }), 'PROGRESSION_PERSISTENCE_INVALID');
    expect(rowCount(database, 'progression_item_grants', profileId)).toBe(0);
    expect(rowCount(database, 'inventory_items', profileId)).toBe(0);
  });

  it('uses a dedicated immutable grant receipt as the source of fragment quantity', () => {
    const profileId = 'dedicated-fragment-receipt';
    const sourceDate = '2026-07-17';
    const key = `streak-fragment:${profileId}:${sourceDate}`;
    insertProfile(database, profileId);
    repository.getOrCreate(profileId, 'sakura', 1_000);
    database.transaction(() => {
      repository.insertProgressionEvent({
        idempotencyKey: 'completed-hand:source-event',
        profileId,
        eventType: 'completed-hand',
        balanceVersion: 1,
        summary: fragmentSourceSummary('completed-hand:source-event'),
        createdAt: Date.parse(`${sourceDate}T12:00:00+09:00`),
      });
    });
    database.db.prepare(`
      INSERT INTO streak_daily_progress (
        profile_id, kst_date, hands, sngs, qualified_at
      ) VALUES (?, ?, 0, 1, ?)
    `).run(
      profileId,
      sourceDate,
      Date.parse(`${sourceDate}T12:00:00+09:00`),
    );

    const first = database.transaction(() => (
      repository.grantStackableInventoryItemInTransaction({
        idempotencyKey: key,
        profileId,
        itemId: 'streak-fragment',
        balanceVersion: 1,
        grantedAt: Date.parse(`${sourceDate}T12:00:00+09:00`),
        source: 'streak',
        sourceRef: key,
        sourceEventId: 'completed-hand:source-event',
        sourceDate,
      })
    ));
    const duplicate = database.transaction(() => (
      repository.grantStackableInventoryItemInTransaction({
        idempotencyKey: key,
        profileId,
        itemId: 'streak-fragment',
        balanceVersion: 1,
        grantedAt: Date.parse(`${sourceDate}T12:00:00+09:00`),
        source: 'streak',
        sourceRef: key,
        sourceEventId: 'completed-hand:source-event',
        sourceDate,
      })
    ));

    expect(first).toBe(true);
    expect(duplicate).toBe(false);
    expect(database.db.prepare(`
      SELECT idempotency_key, source, source_ref, source_event_id,
             source_date, quantity
      FROM progression_item_grants WHERE profile_id = ?
    `).get(profileId)).toEqual({
      idempotency_key: key,
      source: 'streak',
      source_ref: key,
      source_event_id: 'completed-hand:source-event',
      source_date: sourceDate,
      quantity: 1,
    });
    expect(database.db.prepare(`
      SELECT quantity FROM inventory_items
      WHERE profile_id = ? AND item_id = 'streak-fragment'
    `).get(profileId)).toEqual({ quantity: 1 });
    expect(database.db.prepare(`
      SELECT COUNT(*) AS count FROM progression_events
      WHERE profile_id = ? AND event_type = 'streak-fragment'
    `).get(profileId)).toEqual({ count: 0 });
    expect(() => database?.db.prepare(`
      UPDATE inventory_items SET quantity = 2
      WHERE profile_id = ? AND item_id = 'streak-fragment'
    `).run(profileId)).toThrowError('fragment inventory receipt mismatch');
    expect(() => database?.db.prepare(`
      UPDATE inventory_items SET updated_at = 9007199254740992
      WHERE profile_id = ? AND item_id = 'streak-fragment'
    `).run(profileId)).toThrowError('fragment inventory receipt mismatch');
    expect(() => database?.db.prepare(`
      DELETE FROM inventory_items
      WHERE profile_id = ? AND item_id = 'streak-fragment'
    `).run(profileId)).toThrowError('fragment inventory receipt mismatch');
    expect(() => database?.db.prepare(`
      UPDATE inventory_items SET item_id = 'renamed-fragment'
      WHERE profile_id = ? AND item_id = 'streak-fragment'
    `).run(profileId)).toThrowError('fragment inventory receipt mismatch');
    insertProfile(database, 'fragment-identity-target');
    repository.getOrCreate('fragment-identity-target', 'sakura', 1_000);
    expect(() => database?.db.prepare(`
      UPDATE inventory_items SET profile_id = 'fragment-identity-target'
      WHERE profile_id = ? AND item_id = 'streak-fragment'
    `).run(profileId)).toThrowError('fragment inventory receipt mismatch');
    expect(() => database?.db.prepare(`
      DELETE FROM progression_item_grants WHERE profile_id = ?
    `).run(profileId)).toThrowError('immutable progression item grant');

    expect(() => database?.db.prepare(`
      DELETE FROM progression_profiles WHERE profile_id = ?
    `).run(profileId)).toThrowError('delete progression through profile owner');
    database.db.prepare(`
      DELETE FROM profiles WHERE id = ?
    `).run(profileId);
    expect(database.db.prepare(`
      SELECT COUNT(*) AS count FROM progression_item_grants
      WHERE profile_id = ?
    `).get(profileId)).toEqual({ count: 0 });
    expect(database.db.prepare(`
      SELECT COUNT(*) AS count FROM inventory_items
      WHERE profile_id = ? AND item_id = 'streak-fragment'
    `).get(profileId)).toEqual({ count: 0 });
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

function fragmentSourceSummary(eventId: string) {
  return {
    eventId,
    dojoXpMilli: 30_000,
    dojoLevelsGained: [],
    characterId: 'sakura',
    affinityMilli: 8_000,
    affinityLevelsGained: [],
    missionCompletions: [],
    streak: {
      previousStreak: 6,
      currentStreak: 7,
      restPassUsed: false,
    },
    grantedItemIds: ['streak-fragment'],
  };
}

function validRewardSummary(
  eventId: string,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    eventId,
    dojoXpMilli: 10_000,
    dojoLevelsGained: [],
    characterId: 'sakura',
    affinityMilli: 2_000,
    affinityLevelsGained: [],
    missionCompletions: [],
    grantedItemIds: [],
    ...overrides,
  };
}

function insertEvent(
  repository: ProgressionRepository,
  database: PokerDatabase,
  key: string,
  summary: Record<string, unknown>,
): void {
  database.transaction(() => {
    repository.insertProgressionEvent({
      idempotencyKey: key,
      profileId: 'profile-a',
      eventType: 'completed-hand',
      balanceVersion: 1,
      summary,
      createdAt: 2_000,
    });
  });
}

function captureError(
  work: () => unknown,
  expectedCode: string,
): ProgressionPersistenceError {
  let thrown: unknown;
  try {
    work();
  } catch (error) {
    thrown = error;
  }
  expect(thrown).toBeInstanceOf(ProgressionPersistenceError);
  const progressionError = thrown as ProgressionPersistenceError;
  expect(progressionError.code).toBe(expectedCode);
  expect(progressionError.message).toBe(expectedCode);
  expect('cause' in progressionError).toBe(false);
  return progressionError;
}

function expectSafePersistenceFailure(work: () => unknown): void {
  const error = captureError(work, 'PROGRESSION_PERSISTENCE_INVALID');
  expect(String(error)).not.toContain('sensitive');
}

function expectErrorCode(work: () => unknown, expectedCode: string): void {
  captureError(work, expectedCode);
}
