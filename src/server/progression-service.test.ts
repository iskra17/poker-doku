import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openPokerDatabase, type PokerDatabase } from './persistence/database';
import { ProfileRepository } from './profile-repository';
import { getCollectionItemDefinition } from '@/lib/collection/catalog';
import {
  assignDailyMissions,
  getMissionDefinition,
  selectRerollMission,
  type MissionId,
} from '@/lib/progression/missions';
import {
  ProgressionPersistenceError,
  ProgressionRepository,
} from './progression-repository';
import {
  ProgressionService,
  ProgressionServiceError,
  buildCompletedHandEventId,
} from './progression-service';

describe('ProgressionService', () => {
  let database: PokerDatabase;
  let repository: ProgressionRepository;
  let service: ProgressionService;

  beforeEach(() => {
    database = openPokerDatabase(':memory:');
    repository = new ProgressionRepository(database);
    service = new ProgressionService(database, repository);
  });

  afterEach(() => {
    database.close();
  });

  it('awards a cash hand from completion only and updates exact counters', () => {
    insertProfile(database, 'profile-a');

    const summary = service.recordCompletedHand({
      profileId: 'profile-a',
      roomId: 'cash-room',
      handNumber: 1,
      mode: 'cash',
      selectedCharacterId: 'sakura',
      completedAt: 1_000,
    });

    expect(summary).toEqual({
      eventId: buildCompletedHandEventId('profile-a', 'cash-room', 1),
      dojoXpMilli: 10_000,
      dojoLevelsGained: [],
      characterId: 'sakura',
      affinityMilli: 2_000,
      affinityLevelsGained: [],
      missionCompletions: [],
      grantedItemIds: [],
    });
    expect(Object.isFrozen(summary)).toBe(true);
    const snapshot = repository.getOrCreate('profile-a', 'sakura', 2_000);
    expect(snapshot.profile).toMatchObject({
      dojoLevel: 1,
      dojoXpMilli: 10_000,
      completedHands: 1,
      cashHands: 1,
      practiceHandsTotal: 0,
      sngCompletions: 0,
    });
    expect(snapshot.affinities).toContainEqual({
      profileId: 'profile-a',
      characterId: 'sakura',
      level: 1,
      xpMilli: 2_000,
    });
    expect(database.db.prepare(`
      SELECT event_type, balance_version FROM progression_events
      WHERE idempotency_key = ?
    `).get(summary.eventId)).toEqual({
      event_type: 'completed-hand',
      balance_version: 1,
    });
    expect(rowCount(database, 'wallets')).toBe(0);
  });

  it('grants every newly crossed dojo and affinity cosmetic exactly once', () => {
    const profileId = findProfileWithMission('COMPLETE_ONE_SNG');
    insertProfile(database, profileId);
    repository.getOrCreate(profileId, 'sakura', 1);
    database.db.prepare(`
      UPDATE progression_profiles
      SET dojo_level = 4, dojo_xp_milli = 174000
      WHERE profile_id = ?
    `).run(profileId);
    database.db.prepare(`
      UPDATE character_affinity
      SET level = 4, xp_milli = 84999
      WHERE profile_id = ? AND character_id = 'sakura'
    `).run(profileId);

    const input = {
      profileId,
      roomId: 'reward-room',
      place: 1,
      selectedCharacterId: 'sakura',
      completedAt: 1_000,
    } as const;
    const first = service.recordSngFinish(input);
    const duplicate = service.recordSngFinish(input);

    expect(first.dojoLevelsGained).toEqual([5, 6]);
    expect(first.affinityLevelsGained).toEqual([5]);
    expect(first.grantedItemIds).toEqual([
      'dojo-frame-cherry-blossom',
      'affinity-sakura-dialogue-pack',
    ]);
    expect(duplicate).toEqual(first);
    expect(database.db.prepare(`
      SELECT item_id, quantity FROM inventory_items
      WHERE profile_id = ? ORDER BY item_id
    `).all(profileId)).toEqual([
      { item_id: 'affinity-sakura-dialogue-pack', quantity: 1 },
      { item_id: 'dojo-frame-cherry-blossom', quantity: 1 },
    ]);
    expect(database.db.prepare(`
      SELECT item_id, source_kind, source_level, source_character_id,
             source_event_id
      FROM permanent_progression_grants
      WHERE profile_id = ? ORDER BY item_id
    `).all(profileId)).toEqual([
      {
        item_id: 'affinity-sakura-dialogue-pack',
        source_kind: 'affinity-level',
        source_level: 5,
        source_character_id: 'sakura',
        source_event_id: first.eventId,
      },
      {
        item_id: 'dojo-frame-cherry-blossom',
        source_kind: 'dojo-level',
        source_level: 5,
        source_character_id: null,
        source_event_id: first.eventId,
      },
    ]);
  });

  it('does not regrant a permanent reward already backed by an earlier receipt', () => {
    const profileId = findProfileWithMission('COMPLETE_ONE_SNG');
    insertProfile(database, profileId);
    repository.getOrCreate(profileId, 'sakura', 1);
    grantPermanentForTest(
      database,
      repository,
      profileId,
      'dojo-frame-cherry-blossom',
      10,
    );
    database.db.prepare(`
      UPDATE progression_profiles
      SET dojo_level = 4, dojo_xp_milli = 174000
      WHERE profile_id = ?
    `).run(profileId);

    const input = {
      profileId,
      roomId: 'preowned-receipt-room',
      place: 1,
      selectedCharacterId: 'sakura',
      completedAt: 1_000,
    } as const;
    const first = service.recordSngFinish(input);
    const duplicate = service.recordSngFinish(input);

    expect(first.grantedItemIds).not.toContain('dojo-frame-cherry-blossom');
    expect(duplicate).toEqual(first);
    expect(database.db.prepare(`
      SELECT quantity, granted_at, updated_at FROM inventory_items
      WHERE profile_id = ? AND item_id = 'dojo-frame-cherry-blossom'
    `).get(profileId)).toEqual({ quantity: 1, granted_at: 10, updated_at: 10 });
    expect(database.db.prepare(`
      SELECT COUNT(*) AS count FROM permanent_progression_grants
      WHERE profile_id = ? AND item_id = 'dojo-frame-cherry-blossom'
    `).get(profileId)).toEqual({ count: 1 });
  });

  it('preserves a seeded preowned permanent item without creating an orphan receipt', () => {
    const profileId = findProfileWithMission('COMPLETE_ONE_SNG');
    insertProfile(database, profileId);
    repository.getOrCreate(profileId, 'sakura', 1);
    database.db.prepare(`
      INSERT INTO inventory_items (
        profile_id, item_id, quantity, granted_at, updated_at
      ) VALUES (?, 'dojo-frame-cherry-blossom', 1, 7, 7)
    `).run(profileId);
    database.db.prepare(`
      UPDATE progression_profiles
      SET dojo_level = 4, dojo_xp_milli = 174000
      WHERE profile_id = ?
    `).run(profileId);

    const input = {
      profileId,
      roomId: 'preowned-seed-room',
      place: 1,
      selectedCharacterId: 'sakura',
      completedAt: 1_000,
    } as const;
    const first = service.recordSngFinish(input);
    const duplicate = service.recordSngFinish(input);

    expect(first.grantedItemIds).not.toContain('dojo-frame-cherry-blossom');
    expect(duplicate).toEqual(first);
    expect(database.db.prepare(`
      SELECT quantity, granted_at, updated_at FROM inventory_items
      WHERE profile_id = ? AND item_id = 'dojo-frame-cherry-blossom'
    `).get(profileId)).toEqual({ quantity: 1, granted_at: 7, updated_at: 7 });
    expect(database.db.prepare(`
      SELECT COUNT(*) AS count FROM permanent_progression_grants
      WHERE profile_id = ? AND item_id = 'dojo-frame-cherry-blossom'
    `).get(profileId)).toEqual({ count: 0 });
  });

  it('fails closed when a permanent receipt and inventory timestamps disagree', () => {
    const profileId = findProfileWithMission('COMPLETE_ONE_SNG');
    insertProfile(database, profileId);
    repository.getOrCreate(profileId, 'sakura', 1);
    grantPermanentForTest(
      database,
      repository,
      profileId,
      'dojo-frame-cherry-blossom',
      10,
    );
    database.db.exec('DROP TRIGGER protect_permanent_inventory_update');
    database.db.prepare(`
      UPDATE inventory_items SET updated_at = 11
      WHERE profile_id = ? AND item_id = 'dojo-frame-cherry-blossom'
    `).run(profileId);
    database.db.prepare(`
      UPDATE progression_profiles
      SET dojo_level = 4, dojo_xp_milli = 174000
      WHERE profile_id = ?
    `).run(profileId);

    expect(() => service.recordSngFinish({
      profileId,
      roomId: 'corrupt-preowned-room',
      place: 1,
      selectedCharacterId: 'sakura',
      completedAt: 1_000,
    })).toThrowError(ProgressionPersistenceError);
    expect(database.db.prepare(`
      SELECT COUNT(*) AS count FROM progression_events
      WHERE profile_id = ? AND event_type = 'sng-finish'
    `).get(profileId))
      .toEqual({ count: 0 });
  });

  it('rolls permanent grants back when the source event cannot commit', () => {
    insertProfile(database, 'rollback-reward');
    repository.getOrCreate('rollback-reward', 'sakura', 1);
    database.db.prepare(`
      UPDATE progression_profiles SET dojo_level = 1, dojo_xp_milli = 99999
      WHERE profile_id = 'rollback-reward'
    `).run();
    database.db.exec(`
      CREATE TRIGGER reject_reward_source
      BEFORE INSERT ON progression_events
      WHEN NEW.profile_id = 'rollback-reward'
      BEGIN SELECT RAISE(ABORT, 'injected event failure'); END;
    `);

    expect(() => service.recordCompletedHand({
      profileId: 'rollback-reward',
      roomId: 'rollback-room',
      handNumber: 1,
      mode: 'cash',
      selectedCharacterId: 'sakura',
      completedAt: 1_000,
    })).toThrow();
    expect(rowCount(database, 'inventory_items', 'rollback-reward')).toBe(0);
    expect(rowCount(database, 'permanent_progression_grants', 'rollback-reward')).toBe(0);
  });

  it('selects only approved characters and lazily creates their affinity', () => {
    insertProfile(database, 'character-profile');
    service.getSnapshot('character-profile', 'sakura', 1);

    expect(service.selectCharacter('character-profile', 'ara', 2).profile)
      .toMatchObject({ selectedCharacterId: 'ara' });
    expect(repository.getOrCreate('character-profile', 'ara', 3).affinities)
      .toContainEqual({
        profileId: 'character-profile',
        characterId: 'ara',
        level: 1,
        xpMilli: 0,
      });
    expect(() => service.selectCharacter('character-profile', 'miyako', 4))
      .toThrowError(ProgressionServiceError);
  });

  it('equips only owned catalog items in their exact slot and unequips', () => {
    insertProfile(database, 'equipment-profile');
    service.getSnapshot('equipment-profile', 'sakura', 1);
    grantPermanentForTest(
      database,
      repository,
      'equipment-profile',
      'dojo-frame-cherry-blossom',
      1,
    );

    expect(service.setEquipment(
      'equipment-profile',
      'frame',
      'dojo-frame-cherry-blossom',
      2,
    ).equipment.frame).toBe('dojo-frame-cherry-blossom');
    expect(() => service.setEquipment(
      'equipment-profile',
      'title',
      'dojo-frame-cherry-blossom',
      3,
    )).toThrowError(ProgressionServiceError);
    expect(() => service.setEquipment(
      'equipment-profile',
      'frame',
      'dojo-frame-clear-sky',
      3,
    )).toThrowError(ProgressionServiceError);
    expect(service.setEquipment('equipment-profile', 'frame', null, 4)
      .equipment.frame).toBeNull();
  });

  it('rejects a skin for a character other than the selected character', () => {
    insertProfile(database, 'skin-profile');
    service.getSnapshot('skin-profile', 'sakura', 1);
    grantPermanentForTest(
      database,
      repository,
      'skin-profile',
      'affinity-ara-skin',
      1,
    );

    expectServiceError(() => service.setEquipment(
      'skin-profile',
      'skin',
      'affinity-ara-skin',
      2,
    ), 'PROGRESSION_SKIN_CHARACTER_MISMATCH');
  });

  it('unequips an incompatible skin when the selected character changes', () => {
    insertProfile(database, 'skin-switch-profile');
    service.getSnapshot('skin-switch-profile', 'sakura', 1);
    grantPermanentForTest(
      database,
      repository,
      'skin-switch-profile',
      'affinity-sakura-skin',
      1,
    );
    service.setEquipment(
      'skin-switch-profile',
      'skin',
      'affinity-sakura-skin',
      2,
    );

    const changed = service.selectCharacter('skin-switch-profile', 'ara', 3);

    expect(changed.profile.selectedCharacterId).toBe('ara');
    expect(changed.equipment.skin).toBeNull();
  });

  it('applies full practice rewards for 30 hands and reduced exact rewards later', () => {
    insertProfile(database, 'practice-profile');
    for (let handNumber = 1; handNumber <= 30; handNumber += 1) {
      service.recordCompletedHand({
        profileId: 'practice-profile',
        roomId: 'practice-room',
        handNumber,
        mode: 'practice',
        selectedCharacterId: 'hana',
        completedAt: Date.parse('2026-07-17T03:00:00+09:00') + handNumber,
      });
    }
    const before = repository.getOrCreate('practice-profile', 'hana', 1);

    const summaries = [31, 32, 33, 34].map(handNumber => (
      service.recordCompletedHand({
        profileId: 'practice-profile',
        roomId: 'practice-room',
        handNumber,
        mode: 'practice',
        selectedCharacterId: 'hana',
        completedAt: Date.parse('2026-07-17T04:00:00+09:00') + handNumber,
      })
    ));

    expect(summaries[0]).toMatchObject({
      dojoXpMilli: 2_500,
      affinityMilli: 500,
    });
    expect(summaries.reduce((sum, value) => sum + value.dojoXpMilli, 0))
      .toBe(10_000);
    expect(summaries.reduce((sum, value) => sum + value.affinityMilli, 0))
      .toBe(2_000);
    const after = repository.getOrCreate('practice-profile', 'hana', 2);
    expect(after.profile.practiceDate).toBe('2026-07-17');
    expect(after.profile.practiceHands).toBe(34);
    expect(after.profile.completedHands).toBe(34);
    expect(after.profile.practiceHandsTotal).toBe(34);
    expect(totalDojoMilli(after.profile) - totalDojoMilli(before.profile))
      .toBe(10_000);
    expect(totalAffinityMilli(after.affinities[0])
      - totalAffinityMilli(before.affinities[0])).toBe(2_000);
  });

  it('resets the practice counter exactly at KST midnight', () => {
    insertProfile(database, 'rollover-profile');
    const beforeMidnight = Date.parse('2026-07-17T23:59:59.000+09:00');
    for (let handNumber = 1; handNumber <= 31; handNumber += 1) {
      service.recordCompletedHand({
        profileId: 'rollover-profile',
        roomId: 'practice-room',
        handNumber,
        mode: 'practice',
        selectedCharacterId: 'ara',
        completedAt: beforeMidnight + handNumber,
      });
    }

    const summary = service.recordCompletedHand({
      profileId: 'rollover-profile',
      roomId: 'practice-room',
      handNumber: 32,
      mode: 'practice',
      selectedCharacterId: 'ara',
      completedAt: Date.parse('2026-07-18T00:00:00.000+09:00'),
    });

    expect(summary).toMatchObject({ dojoXpMilli: 10_000, affinityMilli: 2_000 });
    expect(repository.getOrCreate('rollover-profile', 'ara', 3).profile)
      .toMatchObject({ practiceDate: '2026-07-18', practiceHands: 1 });
  });

  it.each([
    [1, 160_000, 30_000],
    [2, 100_000, 20_000],
    [3, 70_000, 15_000],
    [4, 50_000, 12_000],
    [5, 40_000, 10_000],
    [6, 30_000, 8_000],
  ])('awards SNG place %i without changing completed-hand counters', (
    place,
    dojoXpMilli,
    affinityMilli,
  ) => {
    const profileId = `sng-profile-${place}`;
    insertProfile(database, profileId);
    const missionBonus = assignDailyMissions(profileId, '1970-01-01', 1)
      .some(mission => mission.id === 'COMPLETE_ONE_SNG')
      ? 100_000
      : 0;

    const summary = service.recordSngFinish({
      profileId,
      roomId: 'sng-room',
      place,
      selectedCharacterId: 'chloe',
      completedAt: 10_000 + place,
    });

    expect(summary).toMatchObject({
      dojoXpMilli: dojoXpMilli + missionBonus,
      characterId: 'chloe',
      affinityMilli,
    });
    expect(repository.getOrCreate(profileId, 'chloe', 20_000).profile)
      .toMatchObject({
        completedHands: 0,
        cashHands: 0,
        practiceHandsTotal: 0,
        sngCompletions: 1,
      });
  });

  it('records every crossed dojo and affinity level in the summary', () => {
    insertProfile(database, 'levels-profile');
    repository.getOrCreate('levels-profile', 'sakura', 1_000);
    database.db.prepare(`
      UPDATE progression_profiles SET dojo_xp_milli = 99000
      WHERE profile_id = 'levels-profile'
    `).run();
    database.db.prepare(`
      UPDATE character_affinity SET xp_milli = 39000
      WHERE profile_id = 'levels-profile' AND character_id = 'sakura'
    `).run();

    const summary = service.recordSngFinish({
      profileId: 'levels-profile',
      roomId: 'level-sng',
      place: 1,
      selectedCharacterId: 'sakura',
      completedAt: 2_000,
    });

    expect(summary.dojoLevelsGained).toEqual([2, 3]);
    expect(summary.affinityLevelsGained).toEqual([2]);
  });

  it('does not let stale caller state redirect affinity', () => {
    insertProfile(database, 'character-profile');
    repository.getOrCreate('character-profile', 'sakura', 1_000);

    expectServiceError(() => service.recordCompletedHand({
      profileId: 'character-profile',
      roomId: 'cash-room',
      handNumber: 1,
      mode: 'cash',
      selectedCharacterId: 'hana',
      completedAt: 2_000,
    }), 'PROGRESSION_CHARACTER_STALE');

    const snapshot = repository.getOrCreate('character-profile', 'sakura', 3_000);
    expect(snapshot.profile.dojoXpMilli).toBe(0);
    expect(snapshot.affinities).toEqual([{
      profileId: 'character-profile',
      characterId: 'sakura',
      level: 1,
      xpMilli: 0,
    }]);
    expect(rowCount(database, 'progression_events')).toBe(0);
  });

  it('returns the exact stored duplicate before recomputing or changing timestamps', () => {
    insertProfile(database, 'duplicate-profile');
    const first = service.recordCompletedHand({
      profileId: 'duplicate-profile',
      roomId: 'cash-room',
      handNumber: 7,
      mode: 'cash',
      selectedCharacterId: 'sakura',
      completedAt: 5_000,
    });
    const firstRow = progressionRow(database, 'duplicate-profile');

    const duplicate = service.recordCompletedHand({
      profileId: 'duplicate-profile',
      roomId: 'cash-room',
      handNumber: 7,
      mode: 'cash',
      selectedCharacterId: 'hana',
      completedAt: 9_000,
    });

    expect(duplicate).toEqual(first);
    expect(progressionRow(database, 'duplicate-profile')).toEqual(firstRow);
    expect(rowCount(database, 'progression_events')).toBe(1);
  });

  it('accepts only an exact semantic stored reward summary and returns it frozen', () => {
    insertProfile(database, 'semantic-profile');
    repository.getOrCreate('semantic-profile', 'sakura', 1_000);
    const eventId = buildCompletedHandEventId(
      'semantic-profile',
      'semantic-room',
      1,
    );
    const summary = validStoredSummary(eventId, {
      dojoXpMilli: 110_000,
      dojoLevelsGained: [2, 3],
      affinityLevelsGained: [2],
      missionCompletions: [{
        missionId: 'COMPLETE_HANDS_ANY_10',
        slot: 0,
        dojoXpMilli: 100_000,
      }],
      streak: {
        previousStreak: 5,
        currentStreak: 6,
        restPassUsed: false,
      },
      grantedItemIds: [],
    });
    insertRawRewardEvent(database, 'semantic-profile', eventId, summary);

    const stored = service.recordCompletedHand({
      profileId: 'semantic-profile',
      roomId: 'semantic-room',
      handNumber: 1,
      mode: 'cash',
      selectedCharacterId: 'sakura',
      completedAt: 2_000,
    });

    expect(stored).toEqual(summary);
    expect(Object.isFrozen(stored)).toBe(true);
    expect(Object.isFrozen(stored.dojoLevelsGained)).toBe(true);
    expect(Object.isFrozen(stored.missionCompletions)).toBe(true);
    expect(Object.isFrozen(stored.missionCompletions[0])).toBe(true);
    expect(Object.isFrozen(stored.streak)).toBe(true);
    expect(Object.isFrozen(stored.grantedItemIds)).toBe(true);
  });

  it('rejects malformed stored reward semantics with one generic error', () => {
    insertProfile(database, 'corrupt-summary-profile');
    repository.getOrCreate('corrupt-summary-profile', 'sakura', 1_000);
    const corruptions: Array<Record<string, unknown>> = [
      { extraTopLevel: true },
      { eventId: undefined },
      { missionCompletions: [{
        missionId: 'COMPLETE_HANDS_ANY_10',
        slot: 0,
        dojoXpMilli: 100_000,
        extra: true,
      }] },
      { missionCompletions: [{
        missionId: 'complete-hands',
        slot: 0,
        dojoXpMilli: 100_000,
      }] },
      { missionCompletions: [{
        missionId: 'COMPLETE_FAKE_MISSION',
        slot: 0,
        dojoXpMilli: 100_000,
      }] },
      { missionCompletions: [{
        missionId: 'COMPLETE_HANDS_ANY_10',
        slot: 0,
        dojoXpMilli: 99_999,
      }] },
      { missionCompletions: [{
        missionId: 'COMPLETE_HANDS_ANY_10',
        slot: 0,
        dojoXpMilli: 0,
      }] },
      {
        dojoXpMilli: 0,
        missionCompletions: [{
          missionId: 'COMPLETE_HANDS_ANY_10',
          slot: 0,
          dojoXpMilli: 100_000,
        }],
      },
      { missionCompletions: [{
        missionId: 'BAD\u0000MISSION',
        slot: 0,
        dojoXpMilli: 100_000,
      }] },
      { missionCompletions: [{
        missionId: `BAD${String.fromCharCode(0xd800)}`,
        slot: 0,
        dojoXpMilli: 100_000,
      }] },
      { missionCompletions: [{
        missionId: 'COMPLETE_HANDS_ANY_10',
        slot: '0',
        dojoXpMilli: 100_000,
      }] },
      { streak: {
        previousStreak: 1,
        currentStreak: 2,
        restPassUsed: false,
        extra: true,
      } },
      { streak: {
        previousStreak: 1,
        currentStreak: 2,
        restPassUsed: 0,
      } },
      { streak: {
        previousStreak: 6,
        currentStreak: 9,
        restPassUsed: false,
      } },
      { streak: {
        previousStreak: 0,
        currentStreak: 1,
        restPassUsed: true,
      } },
      { streak: {
        previousStreak: 2,
        currentStreak: 1,
        restPassUsed: true,
      } },
      {
        streak: {
          previousStreak: 6,
          currentStreak: 7,
          restPassUsed: false,
        },
        grantedItemIds: [],
      },
      {
        streak: {
          previousStreak: 5,
          currentStreak: 6,
          restPassUsed: false,
        },
        grantedItemIds: ['streak-fragment'],
      },
      { dojoLevelsGained: [2, 2] },
      { dojoLevelsGained: [2, 4] },
      { affinityLevelsGained: [3, 2] },
      { grantedItemIds: ['item-a', 'item-a'] },
      { grantedItemIds: ['unknown-cosmetic'] },
      { grantedItemIds: ['bad\u0000item'] },
      { grantedItemIds: [`bad${String.fromCharCode(0xd800)}`] },
      { grantedItemIds: ['x'.repeat(129)] },
      { dojoXpMilli: -1 },
      { characterId: 'dealer' },
    ];

    corruptions.forEach((corruption, index) => {
      const handNumber = index + 1;
      const eventId = buildCompletedHandEventId(
        'corrupt-summary-profile',
        'corrupt-summary-room',
        handNumber,
      );
      const summary = validStoredSummary(eventId, corruption);
      insertRawRewardEvent(
        database,
        'corrupt-summary-profile',
        eventId,
        summary,
      );

      expectServiceError(() => service.recordCompletedHand({
        profileId: 'corrupt-summary-profile',
        roomId: 'corrupt-summary-room',
        handNumber,
        mode: 'cash',
        selectedCharacterId: 'sakura',
        completedAt: 2_000 + index,
      }), 'PROGRESSION_STORED_SUMMARY_INVALID');
    });
  });

  it('normalizes stored summary reflection traps without leaking details', () => {
    const eventId = buildCompletedHandEventId(
      'trap-profile',
      'trap-room',
      1,
    );
    const trappedSummary = new Proxy({}, {
      getPrototypeOf() {
        throw new Error('sensitive-summary-trap');
      },
    });
    const trappedEvent = {
      idempotencyKey: eventId,
      profileId: 'trap-profile',
      eventType: 'completed-hand',
      balanceVersion: 1,
      summary: trappedSummary,
      createdAt: 1_000,
    };
    const repositoryDouble = {
      getProgressionEvent: () => trappedEvent,
      insertProgressionEvent: () => ({
        status: 'duplicate' as const,
        event: trappedEvent,
      }),
    } as unknown as ProgressionRepository;
    const trappedService = new ProgressionService(database, repositoryDouble);

    expectServiceError(() => trappedService.recordCompletedHand({
      profileId: 'trap-profile',
      roomId: 'trap-room',
      handNumber: 1,
      mode: 'cash',
      selectedCharacterId: 'sakura',
      completedAt: 2_000,
    }), 'PROGRESSION_STORED_SUMMARY_INVALID');
  });

  it('rejects an existing key with a conflicting event identity', () => {
    insertProfile(database, 'conflict-profile');
    repository.getOrCreate('conflict-profile', 'sakura', 1_000);
    const key = buildCompletedHandEventId('conflict-profile', 'cash-room', 1);
    database.transaction(() => {
      repository.insertProgressionEvent({
        idempotencyKey: key,
        profileId: 'conflict-profile',
        eventType: 'sng-finish',
        balanceVersion: 1,
        summary: {},
        createdAt: 1_500,
      });
    });

    expect(() => service.recordCompletedHand({
      profileId: 'conflict-profile',
      roomId: 'cash-room',
      handNumber: 1,
      mode: 'cash',
      selectedCharacterId: 'sakura',
      completedAt: 2_000,
    })).toThrowError(ProgressionPersistenceError);
    expect(progressionRow(database, 'conflict-profile')).toMatchObject({
      dojo_xp_milli: 0,
      completed_hands: 0,
    });
  });

  it('keeps same-room hand events distinct for different profiles', () => {
    insertProfile(database, 'profile-a');
    insertProfile(database, 'profile-b');
    const base = {
      roomId: 'shared-room',
      handNumber: 42,
      mode: 'cash' as const,
      selectedCharacterId: 'sakura',
      completedAt: 5_000,
    };

    const a = service.recordCompletedHand({ profileId: 'profile-a', ...base });
    const b = service.recordCompletedHand({ profileId: 'profile-b', ...base });

    expect(a.eventId).not.toBe(b.eventId);
    expect(rowCount(database, 'progression_events')).toBe(2);
  });

  it('rolls back all growth when a CAS write or event insertion fails', () => {
    for (const [profileId, triggerSql] of [
      ['cas-profile', `
        CREATE TRIGGER fail_progression_cas
        BEFORE UPDATE OF completed_hands ON progression_profiles
        BEGIN SELECT RAISE(FAIL, 'cas blocked'); END
      `],
      ['event-profile', `
        CREATE TRIGGER fail_progression_event
        BEFORE INSERT ON progression_events
        BEGIN SELECT RAISE(FAIL, 'event blocked'); END
      `],
    ] as const) {
      insertProfile(database, profileId);
      repository.getOrCreate(profileId, 'sakura', 1_000);
      database.db.exec(`${triggerSql};`);

      expect(() => service.recordCompletedHand({
        profileId,
        roomId: `${profileId}-room`,
        handNumber: 1,
        mode: 'cash',
        selectedCharacterId: 'sakura',
        completedAt: 2_000,
      })).toThrow();

      expect(progressionRow(database, profileId)).toMatchObject({
        dojo_level: 1,
        dojo_xp_milli: 0,
        completed_hands: 0,
      });
      expect(affinityRow(database, profileId)).toMatchObject({
        level: 1,
        xp_milli: 0,
      });
      expect(rowCount(database, 'progression_events', profileId)).toBe(0);
      database.db.exec(`DROP TRIGGER ${profileId === 'cas-profile'
        ? 'fail_progression_cas'
        : 'fail_progression_event'}`);
    }
  });

  it('fails safely for an unknown persisted balance version', () => {
    insertProfile(database, 'future-profile');
    repository.getOrCreate('future-profile', 'sakura', 1_000);
    database.db.exec('PRAGMA ignore_check_constraints = ON;');
    database.db.prepare(`
      UPDATE progression_profiles SET balance_version = 2
      WHERE profile_id = 'future-profile'
    `).run();
    database.db.exec('PRAGMA ignore_check_constraints = OFF;');

    expect(() => service.recordCompletedHand({
      profileId: 'future-profile',
      roomId: 'cash-room',
      handNumber: 1,
      mode: 'cash',
      selectedCharacterId: 'sakura',
      completedAt: 2_000,
    })).toThrowError('PROGRESSION_PERSISTENCE_INVALID');
    expect(rowCount(database, 'progression_events')).toBe(0);
  });

  it('rejects a counter overflow without granting partial growth', () => {
    insertProfile(database, 'overflow-profile');
    repository.getOrCreate('overflow-profile', 'sakura', 1_000);
    database.db.prepare(`
      UPDATE progression_profiles SET completed_hands = ?
      WHERE profile_id = 'overflow-profile'
    `).run(Number.MAX_SAFE_INTEGER);

    expectServiceError(() => service.recordCompletedHand({
      profileId: 'overflow-profile',
      roomId: 'cash-room',
      handNumber: 1,
      mode: 'cash',
      selectedCharacterId: 'sakura',
      completedAt: 2_000,
    }), 'PROGRESSION_COUNTER_OVERFLOW');

    expect(progressionRow(database, 'overflow-profile')).toMatchObject({
      dojo_xp_milli: 0,
      completed_hands: Number.MAX_SAFE_INTEGER,
    });
    expect(rowCount(database, 'progression_events')).toBe(0);
  });

  it('rejects malformed inputs before touching the database', () => {
    insertProfile(database, 'input-profile');
    const valid = {
      profileId: 'input-profile',
      roomId: 'room-a',
      handNumber: 1,
      mode: 'cash' as const,
      selectedCharacterId: 'sakura',
      completedAt: 1_000,
    };
    for (const patch of [
      { profileId: '' },
      { profileId: 'x'.repeat(129) },
      { profileId: 'profile:collision' },
      { profileId: 'profile\u0000collision' },
      { profileId: `profile${String.fromCharCode(0xd800)}` },
      { roomId: '' },
      { roomId: 'x'.repeat(129) },
      { roomId: 'room:collision' },
      { roomId: 'room collision' },
      { roomId: 'room\u0000collision' },
      { roomId: `room${String.fromCharCode(0xd800)}` },
      { roomId: `room${String.fromCharCode(0xfffd)}` },
      { handNumber: 0 },
      { handNumber: 1.5 },
      { mode: 'arena' },
      { selectedCharacterId: 'dealer' },
      { completedAt: -1 },
      { completedAt: Number.MAX_SAFE_INTEGER + 1 },
    ]) {
      expectServiceError(
        () => service.recordCompletedHand({ ...valid, ...patch } as never),
        'PROGRESSION_INPUT_INVALID',
      );
    }
    for (const place of [0, 7, 1.5]) {
      expectServiceError(() => service.recordSngFinish({
        profileId: 'input-profile',
        roomId: 'sng-room',
        place,
        selectedCharacterId: 'sakura',
        completedAt: 1_000,
      }), 'PROGRESSION_INPUT_INVALID');
    }
    expect(rowCount(database, 'progression_profiles')).toBe(0);
    expect(rowCount(database, 'progression_events')).toBe(0);
  });

  it('accepts production profile and room identifier formats', () => {
    const profileId = 'p_AbCdEf0123_-';
    const roomId = 'room-1721199999999-a1b2c';
    insertProfile(database, profileId);

    const summary = service.recordCompletedHand({
      profileId,
      roomId,
      handNumber: 1,
      mode: 'cash',
      selectedCharacterId: 'sakura',
      completedAt: 2_000,
    });

    expect(summary.eventId.length).toBeLessThanOrEqual(384);
    expect(rowCount(database, 'progression_events')).toBe(1);
  });

  it('normalizes an unrepresentable practice KST date before a transaction', () => {
    insertProfile(database, 'kst-overflow-profile');

    expectServiceError(() => service.recordCompletedHand({
      profileId: 'kst-overflow-profile',
      roomId: 'practice-room',
      handNumber: 1,
      mode: 'practice',
      selectedCharacterId: 'sakura',
      completedAt: Date.parse('9999-12-31T23:59:59.999Z'),
    }), 'PROGRESSION_INPUT_INVALID');

    expect(rowCount(database, 'progression_profiles')).toBe(0);
    expect(rowCount(database, 'progression_events')).toBe(0);
  });

  it('assigns today before progressing only completion-based cash metrics', () => {
    insertProfile(database, 'cash-mission-profile');
    const completedAt = Date.parse('2026-07-17T12:00:00+09:00');

    service.recordCompletedHand({
      profileId: 'cash-mission-profile',
      roomId: 'cash-mission-room',
      handNumber: 1,
      mode: 'cash',
      selectedCharacterId: 'sakura',
      completedAt,
    });

    const day = database.transaction(() => (
      repository.readDailyMissionDayInTransaction(
        'cash-mission-profile', '2026-07-17', 1,
      )
    ));
    expect(day.modes).toEqual(['cash']);
    for (const mission of day.missions) {
      const metric = getMissionDefinition(mission.missionId)?.metric;
      const expected = metric === 'handsAny'
        || metric === 'handsCash'
        || metric === 'modesCompleted'
        ? 1
        : 0;
      expect(mission.progress).toBe(expected);
    }
  });

  it('rewards overlapping hand missions together without affinity bonus', () => {
    const completedAt = Date.parse('2026-07-17T13:00:00+09:00');
    const profileId = findProfileWithMissions(
      '2026-07-17',
      ['COMPLETE_HANDS_ANY_10', 'COMPLETE_HANDS_CASH_10'],
    );
    insertProfile(database, profileId);

    let tenth;
    for (let handNumber = 1; handNumber <= 10; handNumber += 1) {
      tenth = service.recordCompletedHand({
        profileId,
        roomId: 'overlap-room',
        handNumber,
        mode: 'cash',
        selectedCharacterId: 'sakura',
        completedAt: completedAt + handNumber,
      });
    }

    expect(tenth).toMatchObject({
      dojoXpMilli: 210_000,
      affinityMilli: 2_000,
    });
    expect(tenth?.missionCompletions.map(value => value.missionId).sort())
      .toEqual(['COMPLETE_HANDS_ANY_10', 'COMPLETE_HANDS_CASH_10']);
    expect(tenth?.missionCompletions.every(value => (
      value.dojoXpMilli === 100_000
    ))).toBe(true);
  });

  it('counts distinct modes once and completes the two-mode mission', () => {
    const date = '2026-07-17';
    const at = Date.parse(`${date}T14:00:00+09:00`);
    const profileId = findProfileWithMissions(date, ['COMPLETE_TWO_MODES']);
    insertProfile(database, profileId);

    service.recordCompletedHand({
      profileId,
      roomId: 'mode-cash-room',
      handNumber: 1,
      mode: 'cash',
      selectedCharacterId: 'hana',
      completedAt: at,
    });
    service.recordCompletedHand({
      profileId,
      roomId: 'mode-cash-room',
      handNumber: 2,
      mode: 'cash',
      selectedCharacterId: 'hana',
      completedAt: at + 1,
    });
    const practice = service.recordCompletedHand({
      profileId,
      roomId: 'mode-practice-room',
      handNumber: 1,
      mode: 'practice',
      selectedCharacterId: 'hana',
      completedAt: at + 2,
    });

    expect(practice.missionCompletions).toEqual([
      expect.objectContaining({ missionId: 'COMPLETE_TWO_MODES' }),
    ]);
    const day = database.transaction(() => (
      repository.readDailyMissionDayInTransaction(profileId, date, 1)
    ));
    expect(day.modes).toEqual(['cash', 'practice']);
  });

  it('returns a duplicate before mutating mission progress or mode rows', () => {
    const at = Date.parse('2026-07-17T15:00:00+09:00');
    insertProfile(database, 'mission-duplicate');
    const input = {
      profileId: 'mission-duplicate',
      roomId: 'mission-duplicate-room',
      handNumber: 1,
      mode: 'cash' as const,
      selectedCharacterId: 'sakura',
      completedAt: at,
    };
    const first = service.recordCompletedHand(input);
    const before = database.transaction(() => (
      repository.readDailyMissionDayInTransaction(
        'mission-duplicate', '2026-07-17', 1,
      )
    ));

    const duplicate = service.recordCompletedHand({
      ...input,
      mode: 'practice',
      selectedCharacterId: 'hana',
      completedAt: at + 10_000,
    });
    const after = database.transaction(() => (
      repository.readDailyMissionDayInTransaction(
        'mission-duplicate', '2026-07-17', 1,
      )
    ));

    expect(duplicate).toEqual(first);
    expect(after).toEqual(before);
  });

  it('rerolls one incomplete slot deterministically and rejects a second use', () => {
    const date = '2026-07-17';
    const at = Date.parse(`${date}T16:00:00+09:00`);
    insertProfile(database, 'reroll-profile');
    repository.getOrCreate('reroll-profile', 'sakura', at);
    const before = database.transaction(() => (
      repository.ensureDailyMissionsInTransaction(
        'reroll-profile', date, 1, at,
      )
    ));

    const rerolled = service.rerollMission('reroll-profile', date, 1, at);
    const restarted = database.transaction(() => (
      repository.readDailyMissionDayInTransaction('reroll-profile', date, 1)
    ));

    expect(rerolled).toEqual(restarted);
    expect(rerolled.missions[1]).toMatchObject({
      slot: 1,
      progress: 0,
      rerollCount: 1,
      completedAt: null,
      rewardedAt: null,
    });
    expect(before.missions.map(value => value.missionId))
      .not.toContain(rerolled.missions[1].missionId);
    expectServiceError(
      () => service.rerollMission('reroll-profile', date, 0, at),
      'PROGRESSION_MISSION_REROLL_USED',
    );
  });

  it('rolls mission and progression mutations back when the event insert fails', () => {
    const at = Date.parse('2026-07-17T17:00:00+09:00');
    insertProfile(database, 'mission-rollback');
    database.db.exec(`
      CREATE TRIGGER fail_mission_event
      BEFORE INSERT ON progression_events
      BEGIN SELECT RAISE(ABORT, 'sensitive-mission-event'); END;
    `);

    expect(() => service.recordCompletedHand({
      profileId: 'mission-rollback',
      roomId: 'mission-rollback-room',
      handNumber: 1,
      mode: 'cash',
      selectedCharacterId: 'sakura',
      completedAt: at,
    })).toThrowError(ProgressionPersistenceError);

    expect(rowCount(database, 'progression_profiles', 'mission-rollback')).toBe(0);
    expect(rowCount(database, 'daily_missions', 'mission-rollback')).toBe(0);
    expect(rowCount(database, 'daily_mission_modes', 'mission-rollback')).toBe(0);
  });

  it('progresses only SNG completion and mode metrics regardless of place', () => {
    const date = '2026-07-17';
    const at = Date.parse(`${date}T18:00:00+09:00`);
    insertProfile(database, 'sng-metrics');

    service.recordSngFinish({
      profileId: 'sng-metrics',
      roomId: 'sng-metrics-room',
      place: 6,
      selectedCharacterId: 'vivian',
      completedAt: at,
    });

    const day = database.transaction(() => (
      repository.readDailyMissionDayInTransaction('sng-metrics', date, 1)
    ));
    expect(day.modes).toEqual(['sng']);
    for (const mission of day.missions) {
      const metric = getMissionDefinition(mission.missionId)?.metric;
      expect(mission.progress).toBe(
        metric === 'sngCompleted' || metric === 'modesCompleted' ? 1 : 0,
      );
    }
  });

  it('uses a separate mission day at exact KST midnight for cash and SNG', () => {
    const before = Date.parse('2026-07-17T23:59:59.999+09:00');
    const after = Date.parse('2026-07-18T00:00:00.000+09:00');
    insertProfile(database, 'kst-all-modes');
    service.recordCompletedHand({
      profileId: 'kst-all-modes',
      roomId: 'kst-cash',
      handNumber: 1,
      mode: 'cash',
      selectedCharacterId: 'ara',
      completedAt: before,
    });
    service.recordSngFinish({
      profileId: 'kst-all-modes',
      roomId: 'kst-sng',
      place: 3,
      selectedCharacterId: 'ara',
      completedAt: after,
    });

    expect(database.db.prepare(`
      SELECT mission_date, COUNT(*) AS count FROM daily_missions
      WHERE profile_id = 'kst-all-modes'
      GROUP BY mission_date ORDER BY mission_date
    `).all()).toEqual([
      { mission_date: '2026-07-17', count: 3 },
      { mission_date: '2026-07-18', count: 3 },
    ]);
  });

  it('keeps the full mission reward when reduced practice XP applies', () => {
    const date = '2026-07-17';
    const at = Date.parse(`${date}T03:00:00+09:00`);
    const scenario = findRerollReplacement(date, 'COMPLETE_HANDS_PRACTICE_10');
    insertProfile(database, scenario.profileId);
    for (let handNumber = 1; handNumber <= 30; handNumber += 1) {
      service.recordCompletedHand({
        profileId: scenario.profileId,
        roomId: 'reduced-practice',
        handNumber,
        mode: 'practice',
        selectedCharacterId: 'elena',
        completedAt: at + handNumber,
      });
    }
    service.rerollMission(
      scenario.profileId,
      date,
      scenario.slot,
      at + 31,
    );

    let fortieth;
    for (let handNumber = 31; handNumber <= 40; handNumber += 1) {
      fortieth = service.recordCompletedHand({
        profileId: scenario.profileId,
        roomId: 'reduced-practice',
        handNumber,
        mode: 'practice',
        selectedCharacterId: 'elena',
        completedAt: at + 100 + handNumber,
      });
    }

    expect(fortieth).toMatchObject({
      dojoXpMilli: 102_500,
      affinityMilli: 500,
      missionCompletions: [{
        missionId: 'COMPLETE_HANDS_PRACTICE_10',
        slot: scenario.slot,
        dojoXpMilli: 100_000,
      }],
    });
  });

  it('rejects completed, stale-day, and unknown-profile rerolls safely', () => {
    const date = '2026-07-17';
    const at = Date.parse(`${date}T19:00:00+09:00`);
    const profileId = findProfileWithMissions(date, ['COMPLETE_ONE_SNG']);
    insertProfile(database, profileId);
    service.recordSngFinish({
      profileId,
      roomId: 'completed-reroll-sng',
      place: 1,
      selectedCharacterId: 'sakura',
      completedAt: at,
    });
    const day = database.transaction(() => (
      repository.readDailyMissionDayInTransaction(profileId, date, 1)
    ));
    const completedSlot = day.missions.find(
      mission => mission.missionId === 'COMPLETE_ONE_SNG',
    )?.slot as number;

    expectServiceError(
      () => service.rerollMission(profileId, date, completedSlot, at + 1),
      'PROGRESSION_MISSION_COMPLETED',
    );
    expectServiceError(
      () => service.rerollMission(profileId, '2026-07-16', 0, at + 1),
      'PROGRESSION_INPUT_INVALID',
    );
    expectServiceError(
      () => service.rerollMission('missing-profile', date, 0, at + 1),
      'PROGRESSION_PROFILE_NOT_FOUND',
    );
  });

  it('cannot reset a completed mission and award its XP a second time', () => {
    const date = '2026-07-17';
    const at = Date.parse(`${date}T19:30:00+09:00`);
    const profileId = findProfileWithMissions(date, ['COMPLETE_ONE_SNG']);
    insertProfile(database, profileId);
    const first = service.recordSngFinish({
      profileId,
      roomId: 'terminal-mission-first',
      place: 6,
      selectedCharacterId: 'sakura',
      completedAt: at,
    });
    const firstCompletion = first.missionCompletions.find(
      completion => completion.missionId === 'COMPLETE_ONE_SNG',
    );
    expect(firstCompletion).toBeDefined();
    if (!firstCompletion) throw new Error('missing test mission completion');
    const slot = firstCompletion.slot;

    let resetRejected = false;
    try {
      database.db.prepare(`
        UPDATE daily_missions
        SET progress = 0, completed_at = NULL, rewarded_at = NULL
        WHERE profile_id = ? AND mission_date = ? AND slot = ?
      `).run(profileId, date, slot);
    } catch {
      resetRejected = true;
    }
    const second = service.recordSngFinish({
      profileId,
      roomId: 'terminal-mission-second',
      place: 6,
      selectedCharacterId: 'sakura',
      completedAt: at + 1,
    });

    expect(resetRejected).toBe(true);
    expect(second.missionCompletions.map(value => value.missionId))
      .not.toContain('COMPLETE_ONE_SNG');
    expect(database.db.prepare(`
      SELECT progress, completed_at, rewarded_at FROM daily_missions
      WHERE profile_id = ? AND mission_date = ? AND slot = ?
    `).get(profileId, date, slot)).toEqual({
      progress: 1,
      completed_at: at,
      rewarded_at: at,
    });
  });

  it('rolls a failed mission replacement back without consuming the reroll', () => {
    const date = '2026-07-17';
    const at = Date.parse(`${date}T20:00:00+09:00`);
    insertProfile(database, 'reroll-rollback');
    repository.getOrCreate('reroll-rollback', 'sakura', at);
    const before = database.transaction(() => (
      repository.ensureDailyMissionsInTransaction(
        'reroll-rollback', date, 1, at,
      )
    ));
    database.db.exec(`
      CREATE TRIGGER fail_mission_reroll
      BEFORE UPDATE ON daily_missions
      BEGIN SELECT RAISE(ABORT, 'sensitive-reroll'); END;
    `);
    expect(() => service.rerollMission(
      'reroll-rollback', date, 0, at + 1,
    )).toThrowError(ProgressionPersistenceError);
    database.db.exec('DROP TRIGGER fail_mission_reroll;');

    const after = database.transaction(() => (
      repository.readDailyMissionDayInTransaction('reroll-rollback', date, 1)
    ));
    expect(after).toEqual(before);
    expect(service.rerollMission('reroll-rollback', date, 0, at + 2)
      .missions[0].rerollCount).toBe(1);
  });

  it('records mission receipts while keeping max-level XP canonical', () => {
    const date = '2026-07-17';
    const at = Date.parse(`${date}T21:00:00+09:00`);
    const profileId = findProfileWithMissions(date, ['COMPLETE_HANDS_ANY_10']);
    insertProfile(database, profileId);
    repository.getOrCreate(profileId, 'sakura', at);
    database.db.prepare(`
      UPDATE progression_profiles SET dojo_level = 50, dojo_xp_milli = 0
      WHERE profile_id = ?
    `).run(profileId);

    let tenth;
    for (let handNumber = 1; handNumber <= 10; handNumber += 1) {
      tenth = service.recordCompletedHand({
        profileId,
        roomId: 'max-level-missions',
        handNumber,
        mode: 'cash',
        selectedCharacterId: 'sakura',
        completedAt: at + handNumber,
      });
    }

    expect(tenth?.missionCompletions.map(value => value.missionId))
      .toContain('COMPLETE_HANDS_ANY_10');
    expect(repository.getOrCreate(profileId, 'sakura', at + 100).profile)
      .toMatchObject({ dojoLevel: 50, dojoXpMilli: 0 });
  });

  it('reconciles the weekly rest pass lazily on snapshots and caps it at one', () => {
    insertProfile(database, 'weekly-snapshot');
    const sunday = Date.parse('2026-07-19T23:59:59.999+09:00');
    const monday = Date.parse('2026-07-20T00:00:00.000+09:00');

    const first = service.getSnapshot('weekly-snapshot', 'sakura', sunday);
    expect(first.streak).toMatchObject({
      restPasses: 1,
      lastWeekKey: '2026-W29',
    });
    expect(service.getSnapshot('weekly-snapshot', 'sakura', sunday).streak)
      .toEqual(first.streak);
    expect(service.getSnapshot('weekly-snapshot', 'sakura', monday).streak)
      .toMatchObject({ restPasses: 1, lastWeekKey: '2026-W30' });
  });

  it('qualifies a streak once on the tenth completed hand, not the ninth or a duplicate', () => {
    const profileId = 'ten-hand-streak';
    const at = Date.parse('2026-07-14T12:00:00+09:00');
    insertProfile(database, profileId);

    let ninth;
    for (let handNumber = 1; handNumber <= 9; handNumber += 1) {
      ninth = service.recordCompletedHand({
        profileId,
        roomId: 'streak-cash',
        handNumber,
        mode: 'cash',
        selectedCharacterId: 'sakura',
        completedAt: at + handNumber,
      });
    }
    expect(ninth).not.toHaveProperty('streak');
    expect(database.db.prepare(`
      SELECT hands, sngs, qualified_at FROM streak_daily_progress
      WHERE profile_id = ? AND kst_date = '2026-07-14'
    `).get(profileId)).toEqual({ hands: 9, sngs: 0, qualified_at: null });

    const tenth = service.recordCompletedHand({
      profileId,
      roomId: 'streak-cash',
      handNumber: 10,
      mode: 'cash',
      selectedCharacterId: 'sakura',
      completedAt: at + 10,
    });
    expect(tenth.streak).toEqual({
      previousStreak: 0,
      currentStreak: 1,
      restPassUsed: false,
    });
    expect(service.getSnapshot(profileId, 'sakura', at + 11)).toMatchObject({
      profile: { bestStreak: 1 },
      streak: {
        currentStreak: 1,
        restPasses: 1,
        lastQualifiedDate: '2026-07-14',
      },
    });

    expect(service.recordCompletedHand({
      profileId,
      roomId: 'streak-cash',
      handNumber: 10,
      mode: 'cash',
      selectedCharacterId: 'sakura',
      completedAt: at + 10,
    })).toEqual(tenth);
    expect(database.db.prepare(`
      SELECT hands, sngs, qualified_at FROM streak_daily_progress
      WHERE profile_id = ? AND kst_date = '2026-07-14'
    `).get(profileId)).toEqual({ hands: 10, sngs: 0, qualified_at: at + 10 });
  });

  it('qualifies immediately on the first SNG and ignores later SNGs that day', () => {
    const profileId = 'sng-streak';
    const at = Date.parse('2026-07-14T13:00:00+09:00');
    insertProfile(database, profileId);
    const first = service.recordSngFinish({
      profileId,
      roomId: 'streak-sng-1',
      place: 6,
      selectedCharacterId: 'hana',
      completedAt: at,
    });
    const second = service.recordSngFinish({
      profileId,
      roomId: 'streak-sng-2',
      place: 1,
      selectedCharacterId: 'hana',
      completedAt: at + 1,
    });

    expect(first.streak).toMatchObject({ previousStreak: 0, currentStreak: 1 });
    expect(second).not.toHaveProperty('streak');
    expect(database.db.prepare(`
      SELECT hands, sngs, qualified_at FROM streak_daily_progress
      WHERE profile_id = ? AND kst_date = '2026-07-14'
    `).get(profileId)).toEqual({ hands: 0, sngs: 1, qualified_at: at });
  });

  it('auto-uses one pass for one missed day and resets after two missed days', () => {
    const profileId = 'streak-gap';
    insertProfile(database, profileId);
    const qualify = (roomId: string, localDate: string) => service.recordSngFinish({
      profileId,
      roomId,
      place: 6,
      selectedCharacterId: 'elena',
      completedAt: Date.parse(`${localDate}T12:00:00+09:00`),
    });

    expect(qualify('gap-day-1', '2026-07-14').streak).toMatchObject({
      previousStreak: 0,
      currentStreak: 1,
      restPassUsed: false,
    });
    expect(qualify('gap-day-3', '2026-07-16').streak).toEqual({
      previousStreak: 1,
      currentStreak: 2,
      restPassUsed: true,
    });
    expect(qualify('gap-day-6', '2026-07-19').streak).toEqual({
      previousStreak: 2,
      currentStreak: 1,
      restPassUsed: false,
    });
    expect(service.getSnapshot(
      profileId,
      'elena',
      Date.parse('2026-07-19T13:00:00+09:00'),
    )).toMatchObject({
      profile: { bestStreak: 2 },
      streak: { currentStreak: 1, restPasses: 0 },
    });
  });

  it('stacks one durable fragment on streak days seven and fourteen', () => {
    const profileId = 'fragment-streak';
    insertProfile(database, profileId);
    const start = Date.parse('2026-07-06T12:00:00+09:00');
    const summaries = Array.from({ length: 14 }, (_, index) => (
      service.recordSngFinish({
        profileId,
        roomId: `fragment-sng-${index + 1}`,
        place: 6,
        selectedCharacterId: 'vivian',
        completedAt: start + index * 24 * 60 * 60 * 1_000,
      })
    ));

    expect(summaries[5].grantedItemIds).toEqual([]);
    expect(summaries[6].grantedItemIds).toEqual(['streak-fragment']);
    expect(summaries[13].grantedItemIds).toEqual(['streak-fragment']);
    expect(database.db.prepare(`
      SELECT quantity FROM inventory_items
      WHERE profile_id = ? AND item_id = 'streak-fragment'
    `).get(profileId)).toEqual({ quantity: 2 });
    expect(database.db.prepare(`
      SELECT idempotency_key FROM progression_item_grants
      WHERE profile_id = ? AND source = 'streak'
      ORDER BY granted_at
    `).all(profileId)).toEqual([
      { idempotency_key: `streak-fragment:${profileId}:2026-07-12` },
      { idempotency_key: `streak-fragment:${profileId}:2026-07-19` },
    ]);
  });

  it('qualifies historical progress without regressing the current streak', () => {
    const profileId = 'past-streak';
    insertProfile(database, profileId);
    service.recordSngFinish({
      profileId,
      roomId: 'current-sng',
      place: 1,
      selectedCharacterId: 'ara',
      completedAt: Date.parse('2026-07-17T12:00:00+09:00'),
    });
    const historical = service.recordSngFinish({
      profileId,
      roomId: 'historical-sng',
      place: 2,
      selectedCharacterId: 'ara',
      completedAt: Date.parse('2026-07-16T12:00:00+09:00'),
    });

    expect(historical).not.toHaveProperty('streak');
    expect(service.getSnapshot(
      profileId,
      'ara',
      Date.parse('2026-07-17T13:00:00+09:00'),
    ).streak).toMatchObject({
      currentStreak: 1,
      lastQualifiedDate: '2026-07-17',
    });
  });

  it('rolls daily qualification and streak mutations back with a failed event', () => {
    const profileId = 'streak-rollback';
    const at = Date.parse('2026-07-14T12:00:00+09:00');
    insertProfile(database, profileId);
    for (let handNumber = 1; handNumber <= 9; handNumber += 1) {
      service.recordCompletedHand({
        profileId,
        roomId: 'streak-rollback-room',
        handNumber,
        mode: 'cash',
        selectedCharacterId: 'sakura',
        completedAt: at + handNumber,
      });
    }
    database.db.exec(`
      CREATE TRIGGER fail_tenth_streak_event
      BEFORE INSERT ON progression_events
      WHEN NEW.event_type = 'completed-hand'
      BEGIN SELECT RAISE(ABORT, 'blocked tenth streak event'); END;
    `);

    expect(() => service.recordCompletedHand({
      profileId,
      roomId: 'streak-rollback-room',
      handNumber: 10,
      mode: 'cash',
      selectedCharacterId: 'sakura',
      completedAt: at + 10,
    })).toThrowError(ProgressionPersistenceError);
    expect(database.db.prepare(`
      SELECT hands, qualified_at FROM streak_daily_progress
      WHERE profile_id = ? AND kst_date = '2026-07-14'
    `).get(profileId)).toEqual({ hands: 9, qualified_at: null });
    expect(database.db.prepare(`
      SELECT current_streak, last_qualified_date FROM streak_state
      WHERE profile_id = ?
    `).get(profileId)).toEqual({
      current_streak: 0,
      last_qualified_date: null,
    });
    expect(progressionRow(database, profileId)).toMatchObject({
      completed_hands: 9,
      best_streak: 0,
    });
  });

  it('rolls a seventh-day fragment receipt and inventory increment back with its event', () => {
    const profileId = 'fragment-rollback';
    const start = Date.parse('2026-07-06T12:00:00+09:00');
    insertProfile(database, profileId);
    for (let index = 0; index < 6; index += 1) {
      service.recordSngFinish({
        profileId,
        roomId: `fragment-rollback-${index + 1}`,
        place: 6,
        selectedCharacterId: 'chloe',
        completedAt: start + index * 24 * 60 * 60 * 1_000,
      });
    }
    database.db.exec(`
      CREATE TRIGGER fail_fragment_main_event
      BEFORE INSERT ON progression_events
      WHEN NEW.event_type = 'sng-finish'
      BEGIN SELECT RAISE(ABORT, 'blocked fragment main event'); END;
    `);

    expect(() => service.recordSngFinish({
      profileId,
      roomId: 'fragment-rollback-7',
      place: 6,
      selectedCharacterId: 'chloe',
      completedAt: start + 6 * 24 * 60 * 60 * 1_000,
    })).toThrowError(ProgressionPersistenceError);
    const snapshotAfterRollback = service.getSnapshot(
      profileId,
      'chloe',
      start + 6 * 24 * 60 * 60 * 1_000,
    );
    expect(snapshotAfterRollback).toMatchObject({
      profile: { bestStreak: 6 },
      streak: { currentStreak: 6 },
    });
    expect(snapshotAfterRollback.inventory.map(item => item.itemId))
      .not.toContain('streak-fragment');
    expect(database.db.prepare(`
      SELECT COUNT(*) AS count FROM progression_events
      WHERE idempotency_key = ?
    `).get(`streak-fragment:${profileId}:2026-07-12`)).toEqual({ count: 0 });
    expect(database.db.prepare(`
      SELECT COUNT(*) AS count FROM streak_daily_progress
      WHERE profile_id = ? AND kst_date = '2026-07-12'
    `).get(profileId)).toEqual({ count: 0 });
  });

  it('replays a seventh-day fragment summary only when its receipt and inventory agree', () => {
    const profileId = 'fragment-duplicate-proof';
    const start = Date.parse('2026-07-06T12:00:00+09:00');
    insertProfile(database, profileId);
    let seventh: ReturnType<ProgressionService['recordSngFinish']> | undefined;
    for (let index = 0; index < 7; index += 1) {
      seventh = service.recordSngFinish({
        profileId,
        roomId: `fragment-proof-${index + 1}`,
        place: 6,
        selectedCharacterId: 'sakura',
        completedAt: start + index * 24 * 60 * 60 * 1_000,
      });
    }
    const before = {
      receipt: database.db.prepare(`
        SELECT * FROM progression_item_grants WHERE profile_id = ?
      `).get(profileId),
      inventory: database.db.prepare(`
        SELECT * FROM inventory_items WHERE profile_id = ?
      `).get(profileId),
    };

    const replay = service.recordSngFinish({
      profileId,
      roomId: 'fragment-proof-7',
      place: 6,
      selectedCharacterId: 'sakura',
      completedAt: start + 6 * 24 * 60 * 60 * 1_000,
    });
    expect(replay).toEqual(seventh);
    expect({
      receipt: database.db.prepare(`
        SELECT * FROM progression_item_grants WHERE profile_id = ?
      `).get(profileId),
      inventory: database.db.prepare(`
        SELECT * FROM inventory_items WHERE profile_id = ?
      `).get(profileId),
    }).toEqual(before);

    database.db.exec('DROP TRIGGER validate_fragment_inventory_update;');
    database.db.prepare(`
      UPDATE inventory_items SET quantity = 2
      WHERE profile_id = ? AND item_id = 'streak-fragment'
    `).run(profileId);
    expectServiceError(() => service.recordSngFinish({
      profileId,
      roomId: 'fragment-proof-7',
      place: 6,
      selectedCharacterId: 'sakura',
      completedAt: start + 6 * 24 * 60 * 60 * 1_000,
    }), 'PROGRESSION_STORED_SUMMARY_INVALID');
  });

  it('deletes a fragment-bearing profile while protecting its source event directly', () => {
    const profileId = 'fragment-profile-delete';
    const start = Date.parse('2026-07-06T12:00:00+09:00');
    insertProfile(database, profileId);
    let seventh: ReturnType<ProgressionService['recordSngFinish']> | undefined;
    for (let index = 0; index < 7; index += 1) {
      seventh = service.recordSngFinish({
        profileId,
        roomId: `fragment-delete-${index + 1}`,
        place: 6,
        selectedCharacterId: 'sakura',
        completedAt: start + index * 24 * 60 * 60 * 1_000,
      });
    }
    expect(seventh?.grantedItemIds).toEqual(['streak-fragment']);
    if (!seventh) throw new Error('expected seventh-day summary');
    expect(() => database?.db.prepare(`
      DELETE FROM progression_events WHERE idempotency_key = ?
    `).run(seventh.eventId)).toThrow();
    expect(() => database?.db.prepare(`
      UPDATE progression_events SET summary_json = '{}'
      WHERE idempotency_key = ?
    `).run(seventh.eventId)).toThrowError('immutable fragment source event');

    expect(new ProfileRepository(database).deleteProfile(profileId))
      .toBe('deleted');
    expect(database.db.prepare(`
      SELECT COUNT(*) AS count FROM profiles WHERE id = ?
    `).get(profileId)).toEqual({ count: 0 });
    for (const table of [
      'progression_profiles',
      'streak_state',
      'streak_daily_progress',
      'character_affinity',
      'daily_missions',
      'daily_mission_modes',
      'profile_equipment',
      'progression_events',
      'progression_item_grants',
      'inventory_items',
    ]) {
      expect(rowCount(database, table, profileId)).toBe(0);
    }
  });
});

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

function grantPermanentForTest(
  database: PokerDatabase,
  repository: ProgressionRepository,
  profileId: string,
  itemId: string,
  grantedAt: number,
): void {
  const definition = getCollectionItemDefinition(itemId);
  if (!definition || definition.source.kind === 'streak') {
    throw new Error(`Not a permanent reward: ${itemId}`);
  }
  const source = definition.source;
  const sourceEventId = `test-grant-${itemId}-${profileId}`;
  database.transaction(() => {
    repository.grantPermanentInventoryItemInTransaction({
      profileId,
      itemId,
      sourceEventId,
      source,
      grantedAt,
    });
    repository.insertProgressionEvent({
      idempotencyKey: sourceEventId,
      profileId,
      eventType: 'completed-hand',
      balanceVersion: 1,
      summary: validStoredSummary(sourceEventId, { grantedItemIds: [itemId] }),
      createdAt: grantedAt,
    });
  });
}

function findProfileWithMission(missionId: MissionId): string {
  for (let index = 0; index < 10_000; index += 1) {
    const profileId = `mission-reward-${index}`;
    if (assignDailyMissions(profileId, '1970-01-01', 1)
      .some(mission => mission.id === missionId)) {
      return profileId;
    }
  }
  throw new Error(`Could not find deterministic mission assignment for ${missionId}`);
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

function progressionRow(database: PokerDatabase, profileId: string) {
  return database.db.prepare(`
    SELECT * FROM progression_profiles WHERE profile_id = ?
  `).get(profileId) as Record<string, unknown>;
}

function affinityRow(database: PokerDatabase, profileId: string) {
  return database.db.prepare(`
    SELECT level, xp_milli FROM character_affinity WHERE profile_id = ?
  `).get(profileId) as Record<string, unknown>;
}

function validStoredSummary(
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

function insertRawRewardEvent(
  database: PokerDatabase,
  profileId: string,
  eventId: string,
  summary: Record<string, unknown>,
): void {
  database.db.prepare(`
    INSERT INTO progression_events (
      idempotency_key, profile_id, event_type, balance_version,
      summary_json, created_at
    ) VALUES (?, ?, 'completed-hand', 1, ?, 1500)
  `).run(eventId, profileId, JSON.stringify(summary));
}

function totalDojoMilli(value: { dojoLevel: number; dojoXpMilli: number }): number {
  let total = value.dojoXpMilli;
  for (let level = 1; level < value.dojoLevel; level += 1) {
    total += (100 + 25 * (level - 1)) * 1_000;
  }
  return total;
}

function totalAffinityMilli(value: { level: number; xpMilli: number }): number {
  let total = value.xpMilli;
  for (let level = 1; level < value.level; level += 1) {
    total += (40 + 15 * (level - 1)) * 1_000;
  }
  return total;
}

function expectServiceError(
  work: () => unknown,
  code: ProgressionServiceError['code'],
): void {
  let thrown: unknown;
  try {
    work();
  } catch (error) {
    thrown = error;
  }
  expect(thrown).toBeInstanceOf(ProgressionServiceError);
  expect((thrown as ProgressionServiceError).code).toBe(code);
}

function findProfileWithMissions(
  date: string,
  required: readonly MissionId[],
): string {
  for (let index = 0; index < 10_000; index += 1) {
    const profileId = `mission-search-${index}`;
    const ids = new Set(
      assignDailyMissions(profileId, date, 1).map(mission => mission.id),
    );
    if (required.every(id => ids.has(id))) return profileId;
  }
  throw new Error('test mission assignment unavailable');
}

function findRerollReplacement(
  date: string,
  requiredReplacement: MissionId,
): { profileId: string; slot: number } {
  for (let index = 0; index < 10_000; index += 1) {
    const profileId = `reroll-search-${index}`;
    const assigned = assignDailyMissions(profileId, date, 1);
    const ids = assigned.map(mission => mission.id);
    for (const [slot, discarded] of assigned.entries()) {
      if (
        discarded.metric !== 'sngCompleted'
        && discarded.metric !== 'modesCompleted'
      ) {
        continue;
      }
      const replacement = selectRerollMission(
        profileId,
        date,
        1,
        ids,
        discarded.id,
      );
      if (replacement.id === requiredReplacement) return { profileId, slot };
    }
  }
  throw new Error('test reroll replacement unavailable');
}
