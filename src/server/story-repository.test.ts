import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openPokerDatabase, type PokerDatabase } from './persistence/database';
import {
  REVIEW_BOX_INTERVAL_MS,
  StoryPersistenceError,
  StoryRepository,
  type DrillAttemptInput,
} from './story-repository';

/**
 * 수련 스토리 모드 영속(v30) 회귀:
 * - 진행: attempts 증가 · best_grade 상향만 · first_completed_at 최초 고정
 * - 플래그: upsert(삭제 없음)
 * - 드릴 시도: 카테고리 집계 · KST 일 경계 파생용 기간 조회
 * - 복습 노트: Leitner 3박스(오답 리셋 → 승급 → 졸업)
 * - 프로필 삭제 시 전 테이블 CASCADE
 */

const DAY_MS = 24 * 60 * 60 * 1_000;
const T0 = Date.parse('2026-09-02T12:00:00+09:00');
const HERO = 'story-hero';

describe('StoryRepository', () => {
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

  describe('chapter progress', () => {
    it('creates the row on the first attempt and increments afterwards', () => {
      const first = repository.recordAttemptStart(HERO, 'act1-ch01', T0);

      expect(first).toEqual({
        profileId: HERO,
        chapterId: 'act1-ch01',
        attempts: 1,
        completions: 0,
        bestGrade: null,
        firstCompletedAt: null,
        lastPlayedAt: T0,
        updatedAt: T0,
      });

      const second = repository.recordAttemptStart(HERO, 'act1-ch01', T0 + 5_000);
      expect(second.attempts).toBe(2);
      expect(second.completions).toBe(0);
      expect(second.lastPlayedAt).toBe(T0 + 5_000);
      expect(repository.getProgress(HERO, 'act1-ch01')).toEqual(second);
      expect(repository.getProgress(HERO, 'act1-ch02')).toBeNull();
    });

    it('raises best_grade only upward and freezes first_completed_at', () => {
      repository.recordAttemptStart(HERO, 'act1-ch01', T0);

      const b = repository.recordCompletion(HERO, 'act1-ch01', 'B', T0 + 1_000);
      expect(b.completions).toBe(1);
      expect(b.bestGrade).toBe('B');
      expect(b.firstCompletedAt).toBe(T0 + 1_000);

      const s = repository.recordCompletion(HERO, 'act1-ch01', 'S', T0 + 2_000);
      expect(s.completions).toBe(2);
      expect(s.bestGrade).toBe('S');
      expect(s.firstCompletedAt).toBe(T0 + 1_000);

      const a = repository.recordCompletion(HERO, 'act1-ch01', 'A', T0 + 3_000);
      expect(a.completions).toBe(3);
      expect(a.bestGrade).toBe('S');
      expect(a.firstCompletedAt).toBe(T0 + 1_000);
      expect(a.attempts).toBe(1);
    });

    it('completes a chapter that was never started', () => {
      const row = repository.recordCompletion(HERO, 'act1-ch03', 'A', T0);

      expect(row.attempts).toBe(0);
      expect(row.completions).toBe(1);
      expect(row.bestGrade).toBe('A');
      expect(row.firstCompletedAt).toBe(T0);
    });

    it('lists progress and derives the completed chapter set', () => {
      repository.recordAttemptStart(HERO, 'act1-ch02', T0);
      repository.recordCompletion(HERO, 'act1-ch01', 'B', T0);
      repository.recordCompletion(HERO, 'act1-ch03', 'S', T0);

      expect(repository.listProgress(HERO).map(row => row.chapterId))
        .toEqual(['act1-ch01', 'act1-ch02', 'act1-ch03']);
      expect(repository.listCompletedChapterIds(HERO))
        .toEqual(['act1-ch01', 'act1-ch03']);
    });

    it('joins a caller-owned transaction and rolls back with it', () => {
      expect(() => database.transaction(() => {
        repository.recordAttemptStartInTransaction(HERO, 'act1-ch01', T0);
        repository.recordCompletionInTransaction(HERO, 'act1-ch01', 'S', T0);
        throw new Error('caller rollback');
      })).toThrow('caller rollback');

      expect(repository.getProgress(HERO, 'act1-ch01')).toBeNull();

      database.transaction(() => {
        repository.recordAttemptStart(HERO, 'act1-ch01', T0);
        repository.setFlags(HERO, { 'choice:act1-ch01:c1': 'brave' }, T0);
      });
      expect(repository.getProgress(HERO, 'act1-ch01')?.attempts).toBe(1);
      expect(repository.getFlags(HERO)).toEqual({
        'choice:act1-ch01:c1': 'brave',
      });
    });

    it('requires an active transaction for the InTransaction variants', () => {
      expect(() => repository.recordAttemptStartInTransaction(HERO, 'act1-ch01', T0))
        .toThrow(StoryPersistenceError);
      expect(() => repository.recordCompletionInTransaction(HERO, 'act1-ch01', 'S', T0))
        .toThrow(new StoryPersistenceError('STORY_TRANSACTION_REQUIRED'));
    });

    it('rejects unknown profiles and malformed identifiers', () => {
      expect(() => repository.recordAttemptStart('ghost', 'act1-ch01', T0))
        .toThrow(new StoryPersistenceError('STORY_PROFILE_NOT_FOUND'));
      expect(() => repository.recordAttemptStart(HERO, '', T0))
        .toThrow(new StoryPersistenceError('STORY_VALUE_INVALID'));
      expect(() => repository.recordAttemptStart(HERO, 'x'.repeat(65), T0))
        .toThrow(new StoryPersistenceError('STORY_VALUE_INVALID'));
      expect(() => repository.recordAttemptStart(HERO, 'act1-ch01', -1))
        .toThrow(new StoryPersistenceError('STORY_TIME_INVALID'));
    });
  });

  describe('flags', () => {
    it('upserts flags without deleting existing keys', () => {
      repository.setFlags(HERO, {
        'choice:act1-ch01:intro': 'bold',
        'choice:act1-ch01:end': 'soft',
      }, T0);
      repository.setFlags(HERO, { 'choice:act1-ch01:intro': 'shy' }, T0 + 1_000);

      expect(repository.getFlags(HERO)).toEqual({
        'choice:act1-ch01:intro': 'shy',
        'choice:act1-ch01:end': 'soft',
      });
      expect(repository.getFlag(HERO, 'choice:act1-ch01:end')).toBe('soft');
      expect(repository.getFlag(HERO, 'choice:missing')).toBeNull();
    });

    it('ignores an empty write and rejects unusable keys or values', () => {
      repository.setFlags(HERO, {}, T0);
      expect(repository.getFlags(HERO)).toEqual({});

      expect(() => repository.setFlags(HERO, { '': 'x' }, T0))
        .toThrow(new StoryPersistenceError('STORY_VALUE_INVALID'));
      expect(() => repository.setFlags(HERO, { constructor: 'x' }, T0))
        .toThrow(new StoryPersistenceError('STORY_VALUE_INVALID'));
      expect(() => repository.setFlags(HERO, { key: 'v'.repeat(129) }, T0))
        .toThrow(new StoryPersistenceError('STORY_VALUE_INVALID'));
      expect(repository.getFlags(HERO)).toEqual({});
    });
  });

  describe('drill attempts', () => {
    it('records attempts and aggregates stats per category', () => {
      repository.insertAttempt(attempt({ category: 'pot-odds', correct: true }));
      repository.insertAttempt(attempt({
        category: 'pot-odds',
        correct: false,
        answeredAt: T0 + 1_000,
      }));
      repository.insertAttempt(attempt({
        category: 'outs',
        correct: true,
        answeredAt: T0 + 2_000,
        hintsUsed: 2,
      }));

      expect(repository.getDrillStats(HERO)).toEqual({
        total: 3,
        correct: 2,
        byCategory: {
          'pot-odds': { total: 2, correct: 1 },
          outs: { total: 1, correct: 1 },
        },
      });
      expect(repository.getDrillStats(HERO).byCategory['sng-math']).toBeUndefined();
    });

    it('stores every column and returns the inserted id', () => {
      const id = repository.insertAttempt(attempt({
        context: 'chapter',
        chapterId: 'act1-ch03',
        runId: 'run-1',
        hintsUsed: 1,
        elapsedMs: 8_400,
      }));

      expect(id).toBeGreaterThan(0);
      expect(repository.listAttemptsBetween(HERO, T0, T0 + 1)).toEqual([{
        id,
        profileId: HERO,
        templateId: 'D-ODDS-1',
        seed: 4_294_967_295,
        category: 'pot-odds',
        context: 'chapter',
        chapterId: 'act1-ch03',
        runId: 'run-1',
        correct: true,
        hintsUsed: 1,
        elapsedMs: 8_400,
        answeredAt: T0,
      }]);
    });

    it('derives the daily set from a half-open window and context filter', () => {
      // KST 2026-09-02 하루 = [00:00, 다음날 00:00) — 경계는 호출자가 계산한다
      const dayStart = Date.parse('2026-09-02T00:00:00+09:00');
      const dayEnd = dayStart + DAY_MS;
      repository.insertAttempt(attempt({
        context: 'daily', answeredAt: dayStart - 1, correct: true,
      }));
      repository.insertAttempt(attempt({
        context: 'daily', answeredAt: dayStart, correct: true,
      }));
      repository.insertAttempt(attempt({
        context: 'daily', answeredAt: dayEnd - 1, correct: false,
      }));
      repository.insertAttempt(attempt({
        context: 'daily', answeredAt: dayEnd, correct: true,
      }));
      repository.insertAttempt(attempt({
        context: 'chapter', answeredAt: dayStart + 10, correct: true,
      }));

      expect(repository.countAttemptsBetween(HERO, dayStart, dayEnd, 'daily'))
        .toBe(2);
      expect(repository.countAttemptsBetween(HERO, dayStart, dayEnd)).toBe(3);
      expect(
        repository.listAttemptsBetween(HERO, dayStart, dayEnd, 'daily')
          .map(row => row.answeredAt),
      ).toEqual([dayStart, dayEnd - 1]);
    });

    it('rejects unknown categories, contexts and out-of-range values', () => {
      expect(() => repository.insertAttempt(attempt({
        category: 'no-such-category' as DrillAttemptInput['category'],
      }))).toThrow(new StoryPersistenceError('STORY_VALUE_INVALID'));
      expect(() => repository.insertAttempt(attempt({
        context: 'live' as DrillAttemptInput['context'],
      }))).toThrow(new StoryPersistenceError('STORY_VALUE_INVALID'));
      expect(() => repository.insertAttempt(attempt({ seed: 4_294_967_296 })))
        .toThrow(new StoryPersistenceError('STORY_VALUE_INVALID'));
      expect(() => repository.insertAttempt(attempt({ hintsUsed: 10 })))
        .toThrow(new StoryPersistenceError('STORY_VALUE_INVALID'));
      expect(() => repository.insertAttempt(attempt({ elapsedMs: -1 })))
        .toThrow(new StoryPersistenceError('STORY_VALUE_INVALID'));
      expect(() => repository.insertAttempt(attempt({ profileId: 'ghost' })))
        .toThrow(new StoryPersistenceError('STORY_PROFILE_NOT_FOUND'));
      expect(repository.getDrillStats(HERO).total).toBe(0);
    });
  });

  describe('review notes (Leitner)', () => {
    it('walks box 1 → 2 → 3 → graduation and resets on a miss', () => {
      const note = repository.markWrong(HERO, 'D-OUTS-1', 7, T0);
      expect(note).toEqual({
        profileId: HERO,
        templateId: 'D-OUTS-1',
        seed: 7,
        box: 1,
        dueAt: T0 + DAY_MS,
        createdAt: T0,
        updatedAt: T0,
      });

      expect(repository.markCorrect(HERO, 'D-OUTS-1', 7, T0 + DAY_MS))
        .toBe('promoted');
      expect(repository.getNote(HERO, 'D-OUTS-1', 7)).toMatchObject({
        box: 2,
        dueAt: T0 + DAY_MS + REVIEW_BOX_INTERVAL_MS[2],
        createdAt: T0,
        updatedAt: T0 + DAY_MS,
      });

      expect(repository.markCorrect(HERO, 'D-OUTS-1', 7, T0 + 2 * DAY_MS))
        .toBe('promoted');
      expect(repository.getNote(HERO, 'D-OUTS-1', 7)).toMatchObject({
        box: 3,
        dueAt: T0 + 2 * DAY_MS + REVIEW_BOX_INTERVAL_MS[3],
      });

      // 박스 3에서 오답이면 박스 1로 리셋 (createdAt은 유지)
      expect(repository.markWrong(HERO, 'D-OUTS-1', 7, T0 + 3 * DAY_MS))
        .toMatchObject({ box: 1, dueAt: T0 + 4 * DAY_MS, createdAt: T0 });

      repository.markCorrect(HERO, 'D-OUTS-1', 7, T0 + 4 * DAY_MS);
      repository.markCorrect(HERO, 'D-OUTS-1', 7, T0 + 5 * DAY_MS);
      expect(repository.getNote(HERO, 'D-OUTS-1', 7)?.box).toBe(3);

      expect(repository.markCorrect(HERO, 'D-OUTS-1', 7, T0 + 6 * DAY_MS))
        .toBe('graduated');
      expect(repository.getNote(HERO, 'D-OUTS-1', 7)).toBeNull();
      expect(repository.countNotes(HERO)).toBe(0);
    });

    it('reports none for an unknown note and never creates one on a correct answer', () => {
      expect(repository.markCorrect(HERO, 'D-EQ-1', 3, T0)).toBe('none');
      expect(repository.countNotes(HERO)).toBe(0);
    });

    it('lists only due notes, oldest due first', () => {
      repository.markWrong(HERO, 'D-ODDS-1', 1, T0);
      repository.markWrong(HERO, 'D-OUTS-1', 2, T0 - DAY_MS);
      repository.markWrong(HERO, 'D-EQ-1', 3, T0 + DAY_MS);

      const now = T0 + DAY_MS;
      expect(repository.listDue(HERO, now).map(row => row.templateId))
        .toEqual(['D-OUTS-1', 'D-ODDS-1']);
      expect(repository.listDue(HERO, now, 1).map(row => row.templateId))
        .toEqual(['D-OUTS-1']);
      expect(repository.listAll(HERO)).toHaveLength(3);
      expect(repository.countNotes(HERO)).toBe(3);
    });

    it('keeps notes per (template, seed) pair', () => {
      repository.markWrong(HERO, 'D-ODDS-1', 1, T0);
      repository.markWrong(HERO, 'D-ODDS-1', 2, T0);

      expect(repository.countNotes(HERO)).toBe(2);
      expect(repository.markCorrect(HERO, 'D-ODDS-1', 1, T0)).toBe('promoted');
      expect(repository.getNote(HERO, 'D-ODDS-1', 2)?.box).toBe(1);
    });
  });

  it('cascades every story table when the profile is deleted', () => {
    repository.recordCompletion(HERO, 'act1-ch01', 'S', T0);
    repository.setFlags(HERO, { 'choice:act1-ch01:intro': 'bold' }, T0);
    repository.insertAttempt(attempt({}));
    repository.markWrong(HERO, 'D-ODDS-1', 1, T0);

    database.db.prepare('DELETE FROM profiles WHERE id = ?').run(HERO);

    expect(rowCount(database, 'story_progress')).toBe(0);
    expect(rowCount(database, 'story_flags')).toBe(0);
    expect(rowCount(database, 'drill_attempts')).toBe(0);
    expect(rowCount(database, 'drill_review_notes')).toBe(0);
  });
});

function attempt(
  overrides: Partial<DrillAttemptInput>,
): DrillAttemptInput {
  return {
    profileId: HERO,
    templateId: 'D-ODDS-1',
    seed: 4_294_967_295,
    category: 'pot-odds',
    context: 'chapter',
    chapterId: 'act1-ch03',
    runId: 'run-1',
    correct: true,
    hintsUsed: 0,
    elapsedMs: 8_400,
    answeredAt: T0,
    ...overrides,
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

function rowCount(database: PokerDatabase, table: string): number {
  const row = database.db
    .prepare(`SELECT COUNT(*) AS count FROM ${table}`)
    .get() as { count: number };
  return row.count;
}
