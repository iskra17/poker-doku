import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openPokerDatabase, type PokerDatabase } from './persistence/database';
import { getKstDateKey } from './economy-service';
import { ProgressionRepository } from './progression-repository';
import {
  ProgressionService,
  ProgressionServiceError,
  STORY_CHAPTER_MAX_AFFINITY_MILLI,
  STORY_CHAPTER_MAX_DOJO_XP_MILLI,
  STORY_DAILY_AFFINITY_MILLI,
  buildStoryChapterEventId,
  buildStoryDailyDrillsEventId,
} from './progression-service';

const AT = 1_700_000_000_000;

describe('ProgressionService story rewards', () => {
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

  it('builds idempotency keys with the length-prefixed contract', () => {
    expect(buildStoryChapterEventId('profile-a', 'act1-ch01')).toBe(
      'story-chapter:9:act1-ch01:first:9:profile-a',
    );
    expect(buildStoryChapterEventId('profile-a', 'act1-ch01', 'run-1')).toBe(
      'story-chapter:9:act1-ch01:run:5:run-1:9:profile-a',
    );
    expect(buildStoryDailyDrillsEventId('profile-a', '2026-09-02')).toBe(
      'story-daily-drills:10:2026-09-02:9:profile-a',
    );
  });

  it('awards dojo xp and heroine affinity on a first clear', () => {
    seedProfile('profile-a', 'ara');

    const result = service.recordStoryChapterComplete({
      profileId: 'profile-a',
      chapterId: 'act1-ch01',
      runId: 'run-1',
      firstClear: true,
      grade: 'A',
      dojoXpMilli: 60_000,
      affinity: [{ characterId: 'sakura', milli: 30_000 }],
      completedAt: AT,
    });

    expect(result.duplicate).toBe(false);
    expect(result.summary).toEqual({
      eventId: buildStoryChapterEventId('profile-a', 'act1-ch01'),
      dojoXpMilli: 60_000,
      dojoLevelsGained: [],
      characterId: 'sakura',
      affinityMilli: 30_000,
      affinityLevelsGained: [],
      missionCompletions: [],
      grantedItemIds: [],
    });
    expect(result.snapshot.profile.dojoXpMilli).toBe(60_000);
    expect(affinityOf(result.snapshot, 'sakura')).toEqual({
      level: 1,
      xpMilli: 30_000,
    });
  });

  it('creates an affinity row for a heroine who is not the selected partner', () => {
    seedProfile('profile-a', 'ara');
    expect(affinityRow('profile-a', 'hana')).toBeUndefined();

    const result = service.recordStoryChapterComplete({
      profileId: 'profile-a',
      chapterId: 'act1-ch04',
      runId: 'run-1',
      firstClear: true,
      grade: 'S',
      dojoXpMilli: 0,
      affinity: [{ characterId: 'hana', milli: 10_000 }],
      completedAt: AT,
    });

    expect(affinityRow('profile-a', 'hana')).toEqual({
      profile_id: 'profile-a',
      character_id: 'hana',
      level: 1,
      xp_milli: 10_000,
    });
    // 담당 히로인에게 줘도 파트너는 바뀌지 않는다.
    expect(result.snapshot.profile.selectedCharacterId).toBe('ara');
    expect(selectedCharacterId('profile-a')).toBe('ara');
    expect(affinityOf(result.snapshot, 'ara')).toEqual({ level: 1, xpMilli: 0 });
  });

  it('treats a repeated first-clear key as a duplicate and grants nothing twice', () => {
    seedProfile('profile-a', 'sakura');
    const input = {
      profileId: 'profile-a',
      chapterId: 'act1-ch01',
      runId: 'run-1',
      firstClear: true,
      grade: 'B' as const,
      dojoXpMilli: 60_000,
      affinity: [{ characterId: 'sakura' as const, milli: 30_000 }],
      completedAt: AT,
    };

    const first = service.recordStoryChapterComplete(input);
    const again = service.recordStoryChapterComplete({
      ...input,
      runId: 'run-9',
      completedAt: AT + 60_000,
    });

    expect(again.duplicate).toBe(true);
    expect(again.summary).toEqual(first.summary);
    expect(again.snapshot.profile.dojoXpMilli).toBe(60_000);
    expect(affinityOf(again.snapshot, 'sakura')).toEqual({
      level: 1,
      xpMilli: 30_000,
    });
    expect(eventCount('profile-a', 'story-chapter')).toBe(1);
  });

  it('replays dojo xp per retry run without touching affinity', () => {
    seedProfile('profile-a', 'sakura');
    service.recordStoryChapterComplete({
      profileId: 'profile-a',
      chapterId: 'act1-ch01',
      runId: 'run-1',
      firstClear: true,
      grade: 'A',
      dojoXpMilli: 60_000,
      affinity: [{ characterId: 'sakura', milli: 30_000 }],
      completedAt: AT,
    });

    const retry = service.recordStoryChapterComplete({
      profileId: 'profile-a',
      chapterId: 'act1-ch01',
      runId: 'run-2',
      firstClear: false,
      grade: 'S',
      dojoXpMilli: 20_000,
      affinity: [],
      completedAt: AT + 1_000,
    });

    expect(retry.duplicate).toBe(false);
    expect(retry.summary.affinityMilli).toBe(0);
    // 인연 대상이 없으면 요약의 characterId는 선택 파트너로 채운다(계약상 단일 캐릭터 필드).
    expect(retry.summary.characterId).toBe('sakura');
    expect(retry.snapshot.profile.dojoXpMilli).toBe(80_000);
    expect(affinityOf(retry.snapshot, 'sakura')).toEqual({
      level: 1,
      xpMilli: 30_000,
    });

    const sameRun = service.recordStoryChapterComplete({
      profileId: 'profile-a',
      chapterId: 'act1-ch01',
      runId: 'run-2',
      firstClear: false,
      grade: 'S',
      dojoXpMilli: 20_000,
      affinity: [],
      completedAt: AT + 2_000,
    });
    expect(sameRun.duplicate).toBe(true);
    expect(sameRun.snapshot.profile.dojoXpMilli).toBe(80_000);

    const otherRun = service.recordStoryChapterComplete({
      profileId: 'profile-a',
      chapterId: 'act1-ch01',
      runId: 'run-3',
      firstClear: false,
      grade: 'B',
      dojoXpMilli: 10_000,
      affinity: [],
      completedAt: AT + 3_000,
    });
    expect(otherRun.duplicate).toBe(false);
    expect(otherRun.snapshot.profile.dojoXpMilli).toBe(90_000);
  });

  it('grants every heroine in one event (Ch12 graduation)', () => {
    seedProfile('profile-a', 'elena');

    const result = service.recordStoryChapterComplete({
      profileId: 'profile-a',
      chapterId: 'act4-ch12',
      runId: 'run-1',
      firstClear: true,
      grade: 'S',
      dojoXpMilli: 100_000,
      affinity: [
        { characterId: 'sakura', milli: 30_000 },
        { characterId: 'ara', milli: 30_000 },
        { characterId: 'hana', milli: 30_000 },
        { characterId: 'chloe', milli: 30_000 },
        { characterId: 'vivian', milli: 30_000 },
        { characterId: 'elena', milli: 30_000 },
      ],
      completedAt: AT,
    });

    for (const characterId of [
      'sakura', 'ara', 'hana', 'chloe', 'vivian', 'elena',
    ] as const) {
      expect(affinityOf(result.snapshot, characterId)).toEqual({
        level: 1,
        xpMilli: 30_000,
      });
    }
    // 요약은 단일 히로인 계약이라 첫 대상만 싣는다 — 전모는 스냅샷이 갖는다.
    expect(result.summary.characterId).toBe('sakura');
    expect(result.summary.affinityMilli).toBe(30_000);
    expect(result.snapshot.affinities).toHaveLength(6);
    expect(selectedCharacterId('profile-a')).toBe('elena');
  });

  it('sums duplicate heroines then clamps per character and per chapter', () => {
    seedProfile('profile-a', 'sakura');

    const result = service.recordStoryChapterComplete({
      profileId: 'profile-a',
      chapterId: 'act1-ch01',
      runId: 'run-1',
      firstClear: true,
      grade: 'S',
      dojoXpMilli: STORY_CHAPTER_MAX_DOJO_XP_MILLI + 1_000,
      affinity: [
        { characterId: 'hana', milli: STORY_CHAPTER_MAX_AFFINITY_MILLI },
        { characterId: 'hana', milli: 40_000 },
      ],
      completedAt: AT,
    });

    expect(result.summary.dojoXpMilli).toBe(STORY_CHAPTER_MAX_DOJO_XP_MILLI);
    expect(result.summary.characterId).toBe('hana');
    expect(result.summary.affinityMilli).toBe(STORY_CHAPTER_MAX_AFFINITY_MILLI);
    // 인연 상한(500_000)은 Lv20 만렙(누적 3_325_000)에 못 미치므로 레벨만 오른다.
    expect(affinityOf(result.snapshot, 'hana')).toEqual({ level: 7, xpMilli: 35_000 });
  });

  it('levels up dojo and affinity across thresholds', () => {
    seedProfile('profile-a', 'sakura');

    const result = service.recordStoryChapterComplete({
      profileId: 'profile-a',
      chapterId: 'act2-ch05',
      runId: 'run-1',
      firstClear: true,
      grade: 'S',
      // 도장 L1→L2 100_000 · L2→L3 125_000
      dojoXpMilli: 250_000,
      // 인연 L1→L2 40_000 · L2→L3 55_000
      affinity: [{ characterId: 'sakura', milli: 100_000 }],
      completedAt: AT,
    });

    expect(result.summary.dojoLevelsGained).toEqual([2, 3]);
    expect(result.summary.affinityLevelsGained).toEqual([2, 3]);
    expect(result.snapshot.profile).toMatchObject({
      dojoLevel: 3,
      dojoXpMilli: 25_000,
    });
    expect(affinityOf(result.snapshot, 'sakura')).toEqual({
      level: 3,
      xpMilli: 5_000,
    });
    // 스토리 이벤트는 카탈로그 영구 아이템을 지급하지 않는다(Phase 2 — 뷰/트리거 소스 한정).
    expect(result.summary.grantedItemIds).toEqual([]);
    expect(result.snapshot.inventory).toEqual([]);
  });

  it('rejects invalid input and leaves no partial state behind', () => {
    seedProfile('profile-a', 'sakura');
    const base = {
      profileId: 'profile-a',
      chapterId: 'act1-ch01',
      runId: 'run-1',
      firstClear: true,
      grade: 'A' as const,
      dojoXpMilli: 10_000,
      affinity: [{ characterId: 'sakura' as const, milli: 10_000 }],
      completedAt: AT,
    };

    const invalidInputs = [
      { ...base, profileId: '' },
      { ...base, chapterId: '' },
      { ...base, runId: '' },
      { ...base, grade: 'C' as never },
      { ...base, firstClear: 'yes' as never },
      { ...base, dojoXpMilli: -1 },
      { ...base, dojoXpMilli: 1.5 },
      { ...base, completedAt: -1 },
      { ...base, affinity: [{ characterId: 'miyako' as never, milli: 10 }] },
      { ...base, affinity: [{ characterId: 'sakura' as const, milli: -5 }] },
      { ...base, affinity: 'nope' as never },
      {
        ...base,
        affinity: Array.from({ length: 65 }, () => ({
          characterId: 'sakura' as const,
          milli: 1,
        })),
      },
    ];
    for (const input of invalidInputs) {
      expect(() => service.recordStoryChapterComplete(input)).toThrow(
        ProgressionServiceError,
      );
    }

    // 목록 중간의 미지 히로인도 전체를 무효로 만든다 — 앞선 대상에 선지급하지 않는다.
    expect(() => service.recordStoryChapterComplete({
      ...base,
      affinity: [
        { characterId: 'sakura', milli: 10_000 },
        { characterId: 'nobody' as never, milli: 10_000 },
        { characterId: 'hana', milli: 10_000 },
      ],
    })).toThrow(ProgressionServiceError);

    expect(eventCount('profile-a', 'story-chapter')).toBe(0);
    expect(affinityRow('profile-a', 'hana')).toBeUndefined();
    expect(affinityRow('profile-a', 'sakura')).toMatchObject({
      level: 1,
      xp_milli: 0,
    });
    expect(dojoXpMilli('profile-a')).toBe(0);
  });

  it('rolls the whole transaction back when persistence rejects a grant', () => {
    seedProfile('profile-a', 'sakura');
    // 인연 만렙(20) 행을 미리 만들어 두면 xp는 0으로 고정되므로,
    // 스토리 지급이 CAS/CHECK를 건드려도 이벤트 행까지 함께 사라져야 한다.
    database.db.prepare(`
      INSERT INTO character_affinity (profile_id, character_id, level, xp_milli)
      VALUES ('profile-a', 'hana', 20, 0)
    `).run();

    const result = service.recordStoryChapterComplete({
      profileId: 'profile-a',
      chapterId: 'act1-ch01',
      runId: 'run-1',
      firstClear: true,
      grade: 'A',
      dojoXpMilli: 10_000,
      affinity: [{ characterId: 'hana', milli: 100_000 }],
      completedAt: AT,
    });

    // 만렙은 초과분을 흡수한다(밸런스 계약) — 이벤트는 정상 기록.
    expect(result.duplicate).toBe(false);
    expect(affinityRow('profile-a', 'hana')).toMatchObject({
      level: 20,
      xp_milli: 0,
    });

    // 존재하지 않는 프로필은 트랜잭션 자체가 실패하고 이벤트도 남지 않는다.
    expect(() => service.recordStoryChapterComplete({
      profileId: 'ghost-profile',
      chapterId: 'act1-ch01',
      runId: 'run-1',
      firstClear: true,
      grade: 'A',
      dojoXpMilli: 10_000,
      affinity: [{ characterId: 'sakura', milli: 10_000 }],
      completedAt: AT,
    })).toThrow();
    expect(eventCount('ghost-profile', 'story-chapter')).toBe(0);
  });

  it('awards the daily drill set once per KST day', () => {
    seedProfile('profile-a', 'sakura');
    const kstDate = getKstDateKey(AT);

    const first = service.recordStoryDailyDrills({
      profileId: 'profile-a',
      kstDate,
      teacherId: 'vivian',
      completedAt: AT,
    });

    expect(first.duplicate).toBe(false);
    expect(first.summary).toMatchObject({
      eventId: buildStoryDailyDrillsEventId('profile-a', kstDate),
      dojoXpMilli: 0,
      characterId: 'vivian',
      affinityMilli: STORY_DAILY_AFFINITY_MILLI,
      grantedItemIds: [],
    });
    expect(affinityOf(first.snapshot, 'vivian')).toEqual({
      level: 1,
      xpMilli: STORY_DAILY_AFFINITY_MILLI,
    });
    expect(first.snapshot.profile.dojoXpMilli).toBe(0);

    const again = service.recordStoryDailyDrills({
      profileId: 'profile-a',
      kstDate,
      teacherId: 'chloe',
      completedAt: AT + 3_600_000,
    });
    expect(again.duplicate).toBe(true);
    expect(affinityRow('profile-a', 'chloe')).toBeUndefined();

    const nextDayAt = AT + 24 * 60 * 60 * 1_000;
    const nextDay = service.recordStoryDailyDrills({
      profileId: 'profile-a',
      kstDate: getKstDateKey(nextDayAt),
      teacherId: 'vivian',
      completedAt: nextDayAt,
    });
    expect(nextDay.duplicate).toBe(false);
    expect(affinityOf(nextDay.snapshot, 'vivian')).toEqual({
      level: 1,
      xpMilli: STORY_DAILY_AFFINITY_MILLI * 2,
    });
  });

  it('rejects a daily date that does not match the completion time', () => {
    seedProfile('profile-a', 'sakura');

    expect(() => service.recordStoryDailyDrills({
      profileId: 'profile-a',
      kstDate: getKstDateKey(AT - 24 * 60 * 60 * 1_000),
      teacherId: 'vivian',
      completedAt: AT,
    })).toThrow(ProgressionServiceError);
    expect(() => service.recordStoryDailyDrills({
      profileId: 'profile-a',
      kstDate: 'not-a-date',
      teacherId: 'vivian',
      completedAt: AT,
    })).toThrow(ProgressionServiceError);
    expect(() => service.recordStoryDailyDrills({
      profileId: 'profile-a',
      kstDate: getKstDateKey(AT),
      teacherId: 'miyako' as never,
      completedAt: AT,
    })).toThrow(ProgressionServiceError);
    expect(eventCount('profile-a', 'story-daily-drills')).toBe(0);
  });

  it('seeds a progression profile when the story reward is the first event', () => {
    insertProfile(database, 'profile-new');

    const result = service.recordStoryChapterComplete({
      profileId: 'profile-new',
      chapterId: 'act1-ch01',
      runId: 'run-1',
      firstClear: true,
      grade: 'A',
      dojoXpMilli: 10_000,
      affinity: [{ characterId: 'hana', milli: 10_000 }],
      completedAt: AT,
    });

    expect(result.snapshot.profile.selectedCharacterId).toBe('sakura');
    expect(affinityOf(result.snapshot, 'hana')).toEqual({
      level: 1,
      xpMilli: 10_000,
    });
  });

  function seedProfile(profileId: string, characterId: string): void {
    insertProfile(database, profileId);
    service.selectCharacter(profileId, characterId, AT - 1_000);
  }

  function affinityRow(profileId: string, characterId: string): unknown {
    return database.db.prepare(`
      SELECT profile_id, character_id, level, xp_milli
      FROM character_affinity WHERE profile_id = ? AND character_id = ?
    `).get(profileId, characterId);
  }

  function selectedCharacterId(profileId: string): string | undefined {
    const row = database.db.prepare(`
      SELECT selected_character_id FROM progression_profiles WHERE profile_id = ?
    `).get(profileId) as { selected_character_id: string } | undefined;
    return row?.selected_character_id;
  }

  function dojoXpMilli(profileId: string): number | undefined {
    const row = database.db.prepare(`
      SELECT dojo_xp_milli FROM progression_profiles WHERE profile_id = ?
    `).get(profileId) as { dojo_xp_milli: number } | undefined;
    return row?.dojo_xp_milli;
  }

  function eventCount(profileId: string, eventType: string): number {
    const row = database.db.prepare(`
      SELECT COUNT(*) AS total FROM progression_events
      WHERE profile_id = ? AND event_type = ?
    `).get(profileId, eventType) as { total: number };
    return row.total;
  }
});

function affinityOf(
  snapshot: { affinities: Array<{ characterId: string; level: number; xpMilli: number }> },
  characterId: string,
): { level: number; xpMilli: number } | undefined {
  const affinity = snapshot.affinities.find(
    value => value.characterId === characterId,
  );
  return affinity
    ? { level: affinity.level, xpMilli: affinity.xpMilli }
    : undefined;
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
