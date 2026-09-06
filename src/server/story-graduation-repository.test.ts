import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openPokerDatabase, type PokerDatabase } from './persistence/database';
import { StoryPersistenceError, StoryRepository, type StoryGraduationInput } from './story-repository';
import { GRADUATION_CHAMPION_FLAG, isStoryRewardEntitled, STORY_REWARD_CATALOG } from '@/lib/story/rewards/catalog';
import { STORY_CURRICULUM } from '@/lib/story/curriculum';
import { BLACK_BELT_FLAG } from '@/lib/story/unlocks';
import type { Chapter, ChapterGrade, ChapterId, StoryAct } from '@/lib/story/types';

/**
 * 졸업 순위 영수증(v38) 회귀:
 * - (profile, run) 1행 캡 · 같은 값 재전달은 duplicate · 다른 순위는 STORY_GRADUATION_CONFLICT
 * - 자격 플래그는 단조(3위 이내 검은띠 · 1위 사범대리) — 내려가지 않는다
 * - 영수증은 불변, 프로필 삭제 CASCADE만 허용
 * - 검은띠/사범대리 보상은 **플래그만으로 지급되지 않는다**(4막 전체 완주가 함께 필요)
 */

const T0 = Date.parse('2026-09-06T12:00:00+09:00');
const HERO = 'grad-hero';

function receipt(overrides: Partial<StoryGraduationInput> = {}): StoryGraduationInput {
  return { runId: 'run-1', place: 2, entrants: 6, mode: 'full', source: 'play', finishedAt: T0, ...overrides };
}

describe('StoryRepository 졸업 영수증', () => {
  let database: PokerDatabase;
  let repository: StoryRepository;

  beforeEach(() => {
    database = openPokerDatabase(':memory:');
    repository = new StoryRepository(database);
    insertProfile(database, HERO);
  });

  afterEach(() => {
    database.close();
  });

  function record(input: StoryGraduationInput, profileId = HERO) {
    return repository.runAtomic(() => repository.recordGraduationInTransaction(profileId, input));
  }

  it('3위 이내는 검은띠 플래그, 1위는 사범대리 플래그까지 세운다', () => {
    expect(record(receipt({ place: 3 }))).toEqual({ status: 'recorded', itm: true, champion: false });
    expect(repository.getFlags(HERO)[BLACK_BELT_FLAG]).toBe('1');
    expect(repository.getFlags(HERO)[GRADUATION_CHAMPION_FLAG]).toBeUndefined();

    expect(record(receipt({ runId: 'run-2', place: 1, mode: 'graduation' })))
      .toEqual({ status: 'recorded', itm: true, champion: true });
    expect(repository.getFlags(HERO)[GRADUATION_CHAMPION_FLAG]).toBe('1');
  });

  it('4위 이하는 자격 플래그를 세우지 않고 기존 플래그도 내리지 않는다', () => {
    record(receipt({ runId: 'win', place: 1 }));
    expect(record(receipt({ runId: 'later', place: 5 })))
      .toEqual({ status: 'recorded', itm: false, champion: false });
    expect(repository.getFlags(HERO)[BLACK_BELT_FLAG]).toBe('1');
    expect(repository.getFlags(HERO)[GRADUATION_CHAMPION_FLAG]).toBe('1');
  });

  it('같은 run 재전달은 duplicate, 순위가 다르면 충돌이다', () => {
    expect(record(receipt()).status).toBe('recorded');
    expect(record(receipt()).status).toBe('duplicate');
    try {
      record(receipt({ place: 1 }));
      throw new Error('expected conflict');
    } catch (error) {
      expect(error).toBeInstanceOf(StoryPersistenceError);
      expect((error as StoryPersistenceError).code).toBe('STORY_GRADUATION_CONFLICT');
    }
    expect(repository.listGraduations(HERO)).toEqual([receipt()]);
  });

  it('운영자 스킵 출처는 source로만 남고 mode는 실제 런 모드다', () => {
    record(receipt({ runId: 'op', mode: 'graduation', source: 'operator-skip', place: 1 }));
    expect(repository.listGraduations(HERO)[0]).toMatchObject({ mode: 'graduation', source: 'operator-skip' });
  });

  it('잘못된 순위·인원은 거절한다', () => {
    expect(() => record(receipt({ place: 0 }))).toThrow(StoryPersistenceError);
    expect(() => record(receipt({ place: 5, entrants: 4 }))).toThrow(StoryPersistenceError);
    expect(() => record(receipt({ mode: 'exam' as never }))).toThrow(StoryPersistenceError);
    expect(() => record(receipt({ source: 'cheat' as never }))).toThrow(StoryPersistenceError);
    expect(repository.listGraduations(HERO)).toHaveLength(0);
  });

  it('트랜잭션 밖 호출은 거절한다', () => {
    expect(() => repository.recordGraduationInTransaction(HERO, receipt())).toThrow(StoryPersistenceError);
  });

  it('영수증은 불변이고 프로필 삭제만 CASCADE로 지운다', () => {
    record(receipt());
    expect(() => database.db.prepare(`
      UPDATE story_graduations SET place = 1 WHERE profile_id = ?
    `).run(HERO)).toThrow(/immutable/);
    expect(() => database.db.prepare(`
      DELETE FROM story_graduations WHERE profile_id = ?
    `).run(HERO)).toThrow(/immutable/);
    database.db.prepare('DELETE FROM profiles WHERE id = ?').run(HERO);
    expect(repository.listGraduations(HERO)).toHaveLength(0);
    expect(database.db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
  });
});

describe('졸업 보상 자격', () => {
  const blackBeltItem = STORY_REWARD_CATALOG.find(item => item.id === 'story-felt-black-belt')!;
  const championItem = STORY_REWARD_CATALOG.find(item => item.id === 'story-title-master-deputy')!;

  // 커리큘럼 전 챕터의 최소 스텁 — 자격 판정은 id·act만 본다(Ch12 등록 시점과 독립적인 회귀)
  const chapters = ([1, 2, 3, 4] as StoryAct[]).flatMap(act => STORY_CURRICULUM[act].map((id, index) => ({
    id, act, order: index + 1, title: id, subtitle: '', teacher: 'miyako', belt: 'white',
    requires: [], steps: [], rewards: { first: { dojoXpMilli: 0, affinity: [] }, replay: { dojoXpMilli: 0 }, gradeBonusMilli: {} },
    estimatedMinutes: 1,
  } as Chapter)));

  function state(completed: ChapterId[], flags: Record<string, string>) {
    return {
      curriculum: STORY_CURRICULUM,
      completed: new Set(completed),
      bestGrade: new Map<ChapterId, ChapterGrade>(),
      flags,
      chapters,
      dojoLevel: 0,
      affinityLevels: new Map<string, number>(),
    };
  }

  const allChapters = [
    ...STORY_CURRICULUM[1], ...STORY_CURRICULUM[2], ...STORY_CURRICULUM[3], ...STORY_CURRICULUM[4],
  ];

  it('플래그만으로는 검은띠 보상을 주지 않는다', () => {
    const flags = { [BLACK_BELT_FLAG]: '1', [GRADUATION_CHAMPION_FLAG]: '1' };
    expect(isStoryRewardEntitled(blackBeltItem, state([...STORY_CURRICULUM[1]], flags))).toBe(false);
    expect(isStoryRewardEntitled(championItem, state([...STORY_CURRICULUM[1]], flags))).toBe(false);
  });

  it('4막 전체 완주 + ITM 플래그면 검은띠, 우승 플래그까지 있으면 사범대리', () => {
    const itmOnly = state(allChapters, { [BLACK_BELT_FLAG]: '1' });
    expect(isStoryRewardEntitled(blackBeltItem, itmOnly)).toBe(true);
    expect(isStoryRewardEntitled(championItem, itmOnly)).toBe(false);
    const champion = state(allChapters, { [BLACK_BELT_FLAG]: '1', [GRADUATION_CHAMPION_FLAG]: '1' });
    expect(isStoryRewardEntitled(championItem, champion)).toBe(true);
  });

  it('4막을 다 마쳐도 ITM 플래그가 없으면 검은띠 보상이 없다', () => {
    expect(isStoryRewardEntitled(blackBeltItem, state(allChapters, {}))).toBe(false);
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
