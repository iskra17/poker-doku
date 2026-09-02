import type { ChapterGrade } from '@/lib/story/types';
import { isDrillCategory, type DrillCategory } from '@/lib/story/drills/types';
import type { PokerDatabase } from './persistence/database';

/**
 * 수련 스토리 모드 영속 계층 (마이그레이션 v30 `story_mode`).
 *
 * 계약:
 * - 해금 상태는 저장하지 않는다 — `completions > 0` 집합 + `requires` 그래프에서
 *   `src/lib/story/unlocks.ts`가 파생한다(서버 검증과 클라 허브가 같은 함수).
 * - 챕터 진행(`recordAttemptStart`/`recordCompletion`)은 코디네이터가 보상 지급
 *   트랜잭션 안에서도 호출하므로 `...InTransaction` 변형을 함께 제공한다.
 *   트랜잭션이 없는 호출은 리포지토리가 스스로 하나 연다(PokerDatabase는 중첩 금지).
 * - "오늘의 수련" 진행도는 별도 테이블 없이 `drill_attempts(context='daily')`에서
 *   파생한다 — KST 일 경계 계산은 호출자 몫(`listAttemptsBetween`/`countAttemptsBetween`).
 * - 복습 노트만 Leitner 박스라는 파생 불가 상태를 가지므로 별도 테이블이다.
 */

export type StoryErrorCode =
  | 'STORY_VALUE_INVALID'
  | 'STORY_TIME_INVALID'
  | 'STORY_PROFILE_NOT_FOUND'
  | 'STORY_TRANSACTION_REQUIRED'
  | 'STORY_PERSISTENCE_INVALID';

export class StoryPersistenceError extends Error {
  constructor(readonly code: StoryErrorCode) {
    super(code);
    this.name = 'StoryPersistenceError';
  }
}

/** 드릴을 푼 맥락 — DB CHECK와 같은 목록 */
export const DRILL_ATTEMPT_CONTEXTS = [
  'chapter',
  'review',
  'daily',
  'hand-review',
] as const;
export type DrillAttemptContext = typeof DRILL_ATTEMPT_CONTEXTS[number];

const DRILL_ATTEMPT_CONTEXT_SET: ReadonlySet<string> = new Set(
  DRILL_ATTEMPT_CONTEXTS,
);
export function isDrillAttemptContext(
  value: unknown,
): value is DrillAttemptContext {
  return typeof value === 'string' && DRILL_ATTEMPT_CONTEXT_SET.has(value);
}

/** Leitner 박스(1~3)별 다음 복습까지의 간격 — 오답은 항상 박스 1로 되돌아간다 */
export const REVIEW_BOX_INTERVAL_MS: Readonly<Record<1 | 2 | 3, number>> = {
  1: 24 * 60 * 60 * 1_000,
  2: 3 * 24 * 60 * 60 * 1_000,
  3: 7 * 24 * 60 * 60 * 1_000,
};

export type ReviewBox = 1 | 2 | 3;

/** box 3 정답 = 졸업(행 삭제), 노트가 없으면 'none' */
export type ReviewOutcome = 'promoted' | 'graduated' | 'none';

const GRADE_RANK: Readonly<Record<ChapterGrade, number>> = { B: 1, A: 2, S: 3 };
const MAX_UINT32 = 4_294_967_295;
const MAX_TIMESTAMP = 253_402_300_799_999;
const DANGEROUS_FLAG_KEYS: ReadonlySet<string> = new Set([
  '__proto__',
  'constructor',
  'prototype',
]);

export interface StoryProgressRow {
  profileId: string;
  chapterId: string;
  attempts: number;
  completions: number;
  bestGrade: ChapterGrade | null;
  firstCompletedAt: number | null;
  lastPlayedAt: number;
  updatedAt: number;
}

export interface DrillAttemptInput {
  profileId: string;
  templateId: string;
  seed: number;
  category: DrillCategory;
  context: DrillAttemptContext;
  chapterId?: string | null;
  runId?: string | null;
  correct: boolean;
  hintsUsed?: number;
  /** 0 = 첫 시도, n = n번째 재출제 (기본 0) — 데일리 완료·정확도는 첫 시도만 센다 */
  attempt?: number;
  elapsedMs: number;
  answeredAt: number;
}

export interface DrillAttemptRow {
  id: number;
  profileId: string;
  templateId: string;
  seed: number;
  category: string;
  context: DrillAttemptContext;
  chapterId: string | null;
  runId: string | null;
  correct: boolean;
  hintsUsed: number;
  attempt: number;
  elapsedMs: number;
  answeredAt: number;
}

export interface DrillAttemptQueryOptions {
  /** 첫 시도(attempt = 0)만 — 재출제 행 제외 */
  firstAttemptOnly?: boolean;
}

export interface DrillStats {
  total: number;
  correct: number;
  byCategory: Record<string, { total: number; correct: number }>;
}

export interface DrillReviewNote {
  profileId: string;
  templateId: string;
  seed: number;
  box: ReviewBox;
  dueAt: number;
  createdAt: number;
  updatedAt: number;
}

interface StoryProgressDbRow {
  profile_id: unknown;
  chapter_id: unknown;
  attempts: unknown;
  completions: unknown;
  best_grade: unknown;
  first_completed_at: unknown;
  last_played_at: unknown;
  updated_at: unknown;
}

interface DrillAttemptDbRow {
  id: unknown;
  profile_id: unknown;
  template_id: unknown;
  seed: unknown;
  category: unknown;
  context: unknown;
  chapter_id: unknown;
  run_id: unknown;
  correct: unknown;
  hints_used: unknown;
  attempt: unknown;
  elapsed_ms: unknown;
  answered_at: unknown;
}

interface DrillReviewNoteDbRow {
  profile_id: unknown;
  template_id: unknown;
  seed: unknown;
  box: unknown;
  due_at: unknown;
  created_at: unknown;
  updated_at: unknown;
}

export class StoryRepository {
  readonly #database: PokerDatabase;

  constructor(database: PokerDatabase) {
    this.#database = database;
  }

  // -------------------------------------------------------------------------
  // 챕터 진행

  listProgress(profileId: string): StoryProgressRow[] {
    assertProfileId(profileId);
    const rows = this.#database.db.prepare(`
      SELECT profile_id, chapter_id, attempts, completions, best_grade,
             first_completed_at, last_played_at, updated_at
      FROM story_progress
      WHERE profile_id = ?
      ORDER BY chapter_id ASC
    `).all(profileId) as unknown as StoryProgressDbRow[];
    return rows.map(toProgressRow);
  }

  getProgress(profileId: string, chapterId: string): StoryProgressRow | null {
    assertProfileId(profileId);
    assertChapterId(chapterId);
    return this.#readProgress(profileId, chapterId);
  }

  /** 완주한 챕터 집합 — `unlocks.ts` 해금 파생의 입력 */
  listCompletedChapterIds(profileId: string): string[] {
    assertProfileId(profileId);
    const rows = this.#database.db.prepare(`
      SELECT chapter_id FROM story_progress
      WHERE profile_id = ? AND completions > 0
      ORDER BY chapter_id ASC
    `).all(profileId) as unknown as Array<{ chapter_id: unknown }>;
    return rows.map(row => String(row.chapter_id));
  }

  /** 챕터 시작 — attempts++ 즉시 영속(서버 재시작으로 run이 사라져도 도전 기록은 남는다) */
  recordAttemptStart(
    profileId: string,
    chapterId: string,
    now: number = Date.now(),
  ): StoryProgressRow {
    return this.#atomic(() => this.#recordAttemptStart(profileId, chapterId, now));
  }

  /** Must be called inside a caller-owned PokerDatabase transaction. */
  recordAttemptStartInTransaction(
    profileId: string,
    chapterId: string,
    now: number = Date.now(),
  ): StoryProgressRow {
    this.#assertTransaction();
    return this.#recordAttemptStart(profileId, chapterId, now);
  }

  /** 챕터 완주 — completions++, best_grade는 S>A>B 상향만, first_completed_at은 최초 1회 고정 */
  recordCompletion(
    profileId: string,
    chapterId: string,
    grade: ChapterGrade,
    now: number = Date.now(),
  ): StoryProgressRow {
    return this.#atomic(
      () => this.#recordCompletion(profileId, chapterId, grade, now),
    );
  }

  /** Must be called inside a caller-owned PokerDatabase transaction. */
  recordCompletionInTransaction(
    profileId: string,
    chapterId: string,
    grade: ChapterGrade,
    now: number = Date.now(),
  ): StoryProgressRow {
    this.#assertTransaction();
    return this.#recordCompletion(profileId, chapterId, grade, now);
  }

  // -------------------------------------------------------------------------
  // 플래그 (선택지)

  getFlags(profileId: string): Record<string, string> {
    assertProfileId(profileId);
    const rows = this.#database.db.prepare(`
      SELECT flag_key, flag_value FROM story_flags
      WHERE profile_id = ?
      ORDER BY flag_key ASC
    `).all(profileId) as unknown as Array<{
      flag_key: unknown;
      flag_value: unknown;
    }>;
    const flags: Record<string, string> = {};
    for (const row of rows) {
      const key = String(row.flag_key);
      if (DANGEROUS_FLAG_KEYS.has(key)) continue;
      flags[key] = String(row.flag_value);
    }
    return flags;
  }

  getFlag(profileId: string, flagKey: string): string | null {
    assertProfileId(profileId);
    assertFlagKey(flagKey);
    const row = this.#database.db.prepare(`
      SELECT flag_value FROM story_flags WHERE profile_id = ? AND flag_key = ?
    `).get(profileId, flagKey) as unknown as { flag_value: unknown } | undefined;
    return row === undefined ? null : String(row.flag_value);
  }

  /** upsert만 — 스토리 플래그는 추가·갱신되며 삭제되지 않는다(선택지 이력) */
  setFlags(
    profileId: string,
    flags: Record<string, string>,
    now: number = Date.now(),
  ): void {
    this.#atomic(() => this.#setFlags(profileId, flags, now));
  }

  /** Must be called inside a caller-owned PokerDatabase transaction. */
  setFlagsInTransaction(
    profileId: string,
    flags: Record<string, string>,
    now: number = Date.now(),
  ): void {
    this.#assertTransaction();
    this.#setFlags(profileId, flags, now);
  }

  // -------------------------------------------------------------------------
  // 드릴 시도

  /** 시도 1건 기록 — 부여된 id 반환 */
  insertAttempt(input: DrillAttemptInput): number {
    assertProfileId(input.profileId);
    assertTemplateId(input.templateId);
    assertSeed(input.seed);
    if (!isDrillCategory(input.category)) {
      throw new StoryPersistenceError('STORY_VALUE_INVALID');
    }
    if (!isDrillAttemptContext(input.context)) {
      throw new StoryPersistenceError('STORY_VALUE_INVALID');
    }
    if (input.chapterId != null) assertChapterId(input.chapterId);
    if (input.runId != null) assertRunId(input.runId);
    if (typeof input.correct !== 'boolean') {
      throw new StoryPersistenceError('STORY_VALUE_INVALID');
    }
    const hintsUsed = input.hintsUsed ?? 0;
    if (!Number.isSafeInteger(hintsUsed) || hintsUsed < 0 || hintsUsed > 9) {
      throw new StoryPersistenceError('STORY_VALUE_INVALID');
    }
    if (!Number.isSafeInteger(input.elapsedMs) || input.elapsedMs < 0) {
      throw new StoryPersistenceError('STORY_VALUE_INVALID');
    }
    const attempt = input.attempt ?? 0;
    if (!Number.isSafeInteger(attempt) || attempt < 0 || attempt > 9) {
      throw new StoryPersistenceError('STORY_VALUE_INVALID');
    }
    assertTimestamp(input.answeredAt);
    this.#assertProfileExists(input.profileId);

    try {
      const result = this.#database.db.prepare(`
        INSERT INTO drill_attempts (
          profile_id, template_id, seed, category, context, chapter_id,
          run_id, correct, hints_used, attempt, elapsed_ms, answered_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        input.profileId,
        input.templateId,
        input.seed,
        input.category,
        input.context,
        input.chapterId ?? null,
        input.runId ?? null,
        input.correct ? 1 : 0,
        hintsUsed,
        attempt,
        input.elapsedMs,
        input.answeredAt,
      );
      return Number(result.lastInsertRowid);
    } catch (error) {
      rethrowUnexpected(error);
    }
  }

  getDrillStats(profileId: string): DrillStats {
    assertProfileId(profileId);
    const rows = this.#database.db.prepare(`
      SELECT category,
             COUNT(*) AS total,
             COALESCE(SUM(correct), 0) AS correct
      FROM drill_attempts
      WHERE profile_id = ?
      GROUP BY category
      ORDER BY category ASC
    `).all(profileId) as unknown as Array<{
      category: unknown;
      total: unknown;
      correct: unknown;
    }>;
    const byCategory: Record<string, { total: number; correct: number }> = {};
    let total = 0;
    let correct = 0;
    for (const row of rows) {
      const category = String(row.category);
      const entry = { total: Number(row.total), correct: Number(row.correct) };
      byCategory[category] = entry;
      total += entry.total;
      correct += entry.correct;
    }
    return { total, correct, byCategory };
  }

  /** [fromMs, toMsExclusive) 구간 시도 — "오늘의 수련 3문" 파생용(KST 경계는 호출자 계산) */
  listAttemptsBetween(
    profileId: string,
    fromMs: number,
    toMsExclusive: number,
    context?: DrillAttemptContext,
    options: DrillAttemptQueryOptions = {},
  ): DrillAttemptRow[] {
    assertProfileId(profileId);
    assertRange(fromMs, toMsExclusive);
    const filter = assertOptionalContext(context);
    const firstOnly = options.firstAttemptOnly ? 1 : 0;
    const rows = this.#database.db.prepare(`
      SELECT id, profile_id, template_id, seed, category, context, chapter_id,
             run_id, correct, hints_used, attempt, elapsed_ms, answered_at
      FROM drill_attempts
      WHERE profile_id = ?
        AND answered_at >= ?
        AND answered_at < ?
        AND (? IS NULL OR context = ?)
        AND (? = 0 OR attempt = 0)
      ORDER BY answered_at ASC, id ASC
    `).all(
      profileId,
      fromMs,
      toMsExclusive,
      filter,
      filter,
      firstOnly,
    ) as unknown as DrillAttemptDbRow[];
    return rows.map(toAttemptRow);
  }

  /** 구간 시도 수 — `firstAttemptOnly`면 재출제(attempt>0)를 빼고 센다(데일리 완료 판정·진행도) */
  countAttemptsBetween(
    profileId: string,
    fromMs: number,
    toMsExclusive: number,
    context?: DrillAttemptContext,
    options: DrillAttemptQueryOptions = {},
  ): number {
    assertProfileId(profileId);
    assertRange(fromMs, toMsExclusive);
    const filter = assertOptionalContext(context);
    const firstOnly = options.firstAttemptOnly ? 1 : 0;
    const row = this.#database.db.prepare(`
      SELECT COUNT(*) AS count
      FROM drill_attempts
      WHERE profile_id = ?
        AND answered_at >= ?
        AND answered_at < ?
        AND (? IS NULL OR context = ?)
        AND (? = 0 OR attempt = 0)
    `).get(profileId, fromMs, toMsExclusive, filter, filter, firstOnly) as unknown as {
      count: number;
    };
    return Number(row.count);
  }

  // -------------------------------------------------------------------------
  // 복습 노트 (Leitner 3박스)

  /** 오답 — 박스 1로 리셋하고 하루 뒤 재출제 */
  markWrong(
    profileId: string,
    templateId: string,
    seed: number,
    now: number = Date.now(),
  ): DrillReviewNote {
    assertProfileId(profileId);
    assertTemplateId(templateId);
    assertSeed(seed);
    assertTimestamp(now);
    this.#assertProfileExists(profileId);
    return this.#atomic(() => {
      const dueAt = now + REVIEW_BOX_INTERVAL_MS[1];
      try {
        this.#database.db.prepare(`
          INSERT INTO drill_review_notes (
            profile_id, template_id, seed, box, due_at, created_at, updated_at
          ) VALUES (?, ?, ?, 1, ?, ?, ?)
          ON CONFLICT(profile_id, template_id, seed) DO UPDATE SET
            box = 1,
            due_at = excluded.due_at,
            updated_at = excluded.updated_at
        `).run(profileId, templateId, seed, dueAt, now, now);
      } catch (error) {
        rethrowUnexpected(error);
      }
      const note = this.#readNote(profileId, templateId, seed);
      if (!note) throw new StoryPersistenceError('STORY_PERSISTENCE_INVALID');
      return note;
    });
  }

  /** 정답 — 박스 승급(2→+3일, 3→+7일), 박스 3에서 맞히면 졸업(행 삭제) */
  markCorrect(
    profileId: string,
    templateId: string,
    seed: number,
    now: number = Date.now(),
  ): ReviewOutcome {
    assertProfileId(profileId);
    assertTemplateId(templateId);
    assertSeed(seed);
    assertTimestamp(now);
    return this.#atomic(() => {
      const note = this.#readNote(profileId, templateId, seed);
      if (!note) return 'none';
      if (note.box >= 3) {
        this.#database.db.prepare(`
          DELETE FROM drill_review_notes
          WHERE profile_id = ? AND template_id = ? AND seed = ?
        `).run(profileId, templateId, seed);
        return 'graduated';
      }
      const nextBox = (note.box + 1) as ReviewBox;
      this.#database.db.prepare(`
        UPDATE drill_review_notes
        SET box = ?, due_at = ?, updated_at = ?
        WHERE profile_id = ? AND template_id = ? AND seed = ?
      `).run(
        nextBox,
        now + REVIEW_BOX_INTERVAL_MS[nextBox],
        now,
        profileId,
        templateId,
        seed,
      );
      return 'promoted';
    });
  }

  getNote(
    profileId: string,
    templateId: string,
    seed: number,
  ): DrillReviewNote | null {
    assertProfileId(profileId);
    assertTemplateId(templateId);
    assertSeed(seed);
    return this.#readNote(profileId, templateId, seed);
  }

  /** 복습 대기열 — due_at ≤ now, 오래 밀린 것부터 */
  listDue(
    profileId: string,
    now: number = Date.now(),
    limit = 20,
  ): DrillReviewNote[] {
    assertProfileId(profileId);
    assertTimestamp(now);
    const bounded = Math.min(Math.max(Math.trunc(limit) || 0, 1), 200);
    const rows = this.#database.db.prepare(`
      SELECT profile_id, template_id, seed, box, due_at, created_at, updated_at
      FROM drill_review_notes
      WHERE profile_id = ? AND due_at <= ?
      ORDER BY due_at ASC, template_id ASC, seed ASC
      LIMIT ?
    `).all(profileId, now, bounded) as unknown as DrillReviewNoteDbRow[];
    return rows.map(toReviewNote);
  }

  countNotes(profileId: string): number {
    assertProfileId(profileId);
    const row = this.#database.db.prepare(`
      SELECT COUNT(*) AS count FROM drill_review_notes WHERE profile_id = ?
    `).get(profileId) as unknown as { count: number };
    return Number(row.count);
  }

  listAll(profileId: string): DrillReviewNote[] {
    assertProfileId(profileId);
    const rows = this.#database.db.prepare(`
      SELECT profile_id, template_id, seed, box, due_at, created_at, updated_at
      FROM drill_review_notes
      WHERE profile_id = ?
      ORDER BY due_at ASC, template_id ASC, seed ASC
    `).all(profileId) as unknown as DrillReviewNoteDbRow[];
    return rows.map(toReviewNote);
  }

  // -------------------------------------------------------------------------
  // 내부

  #recordAttemptStart(
    profileId: string,
    chapterId: string,
    now: number,
  ): StoryProgressRow {
    assertProfileId(profileId);
    assertChapterId(chapterId);
    assertTimestamp(now);
    this.#assertProfileExists(profileId);
    try {
      this.#database.db.prepare(`
        INSERT INTO story_progress (
          profile_id, chapter_id, attempts, completions, best_grade,
          first_completed_at, last_played_at, updated_at
        ) VALUES (?, ?, 1, 0, NULL, NULL, ?, ?)
        ON CONFLICT(profile_id, chapter_id) DO UPDATE SET
          attempts = story_progress.attempts + 1,
          last_played_at = excluded.last_played_at,
          updated_at = excluded.updated_at
      `).run(profileId, chapterId, now, now);
    } catch (error) {
      rethrowUnexpected(error);
    }
    const row = this.#readProgress(profileId, chapterId);
    if (!row) throw new StoryPersistenceError('STORY_PERSISTENCE_INVALID');
    return row;
  }

  #recordCompletion(
    profileId: string,
    chapterId: string,
    grade: ChapterGrade,
    now: number,
  ): StoryProgressRow {
    assertProfileId(profileId);
    assertChapterId(chapterId);
    assertGrade(grade);
    assertTimestamp(now);
    this.#assertProfileExists(profileId);

    const existing = this.#readProgress(profileId, chapterId);
    try {
      if (!existing) {
        this.#database.db.prepare(`
          INSERT INTO story_progress (
            profile_id, chapter_id, attempts, completions, best_grade,
            first_completed_at, last_played_at, updated_at
          ) VALUES (?, ?, 0, 1, ?, ?, ?, ?)
        `).run(profileId, chapterId, grade, now, now, now);
      } else {
        const bestGrade = betterGrade(existing.bestGrade, grade);
        this.#database.db.prepare(`
          UPDATE story_progress
          SET completions = completions + 1,
              best_grade = ?,
              first_completed_at = COALESCE(first_completed_at, ?),
              last_played_at = ?,
              updated_at = ?
          WHERE profile_id = ? AND chapter_id = ?
        `).run(bestGrade, now, now, now, profileId, chapterId);
      }
    } catch (error) {
      rethrowUnexpected(error);
    }
    const row = this.#readProgress(profileId, chapterId);
    if (!row) throw new StoryPersistenceError('STORY_PERSISTENCE_INVALID');
    return row;
  }

  #setFlags(
    profileId: string,
    flags: Record<string, string>,
    now: number,
  ): void {
    assertProfileId(profileId);
    assertTimestamp(now);
    if (flags === null || typeof flags !== 'object' || Array.isArray(flags)) {
      throw new StoryPersistenceError('STORY_VALUE_INVALID');
    }
    const entries = Object.entries(flags);
    for (const [key, value] of entries) {
      assertFlagKey(key);
      assertFlagValue(value);
    }
    if (entries.length === 0) return;
    this.#assertProfileExists(profileId);
    const statement = this.#database.db.prepare(`
      INSERT INTO story_flags (profile_id, flag_key, flag_value, updated_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(profile_id, flag_key) DO UPDATE SET
        flag_value = excluded.flag_value,
        updated_at = excluded.updated_at
    `);
    try {
      for (const [key, value] of entries) {
        statement.run(profileId, key, value, now);
      }
    } catch (error) {
      rethrowUnexpected(error);
    }
  }

  #readProgress(profileId: string, chapterId: string): StoryProgressRow | null {
    const row = this.#database.db.prepare(`
      SELECT profile_id, chapter_id, attempts, completions, best_grade,
             first_completed_at, last_played_at, updated_at
      FROM story_progress
      WHERE profile_id = ? AND chapter_id = ?
    `).get(profileId, chapterId) as unknown as StoryProgressDbRow | undefined;
    return row === undefined ? null : toProgressRow(row);
  }

  #readNote(
    profileId: string,
    templateId: string,
    seed: number,
  ): DrillReviewNote | null {
    const row = this.#database.db.prepare(`
      SELECT profile_id, template_id, seed, box, due_at, created_at, updated_at
      FROM drill_review_notes
      WHERE profile_id = ? AND template_id = ? AND seed = ?
    `).get(profileId, templateId, seed) as unknown as
      DrillReviewNoteDbRow | undefined;
    return row === undefined ? null : toReviewNote(row);
  }

  #assertProfileExists(profileId: string): void {
    const row = this.#database.db.prepare(
      'SELECT 1 FROM profiles WHERE id = ?',
    ).get(profileId);
    if (row === undefined) {
      throw new StoryPersistenceError('STORY_PROFILE_NOT_FOUND');
    }
  }

  #assertTransaction(): void {
    try {
      this.#database.assertTransactionActive();
    } catch {
      throw new StoryPersistenceError('STORY_TRANSACTION_REQUIRED');
    }
  }

  /** 호출자가 이미 트랜잭션을 열었으면 그대로 참여한다 (PokerDatabase는 중첩 금지) */
  #atomic<T>(work: () => T): T {
    if (this.#inTransaction()) return work();
    // PokerDatabase.transaction의 SyncWork 조건부 타입은 미해결 제네릭 T를 좁히지 못한다.
    // 이 리포지토리의 work는 모두 동기(Promise 반환 없음)이므로 여기서만 좁혀 넘긴다.
    const runInTransaction = this.#database.transaction.bind(this.#database) as
      (work: () => T) => T;
    return runInTransaction(work);
  }

  #inTransaction(): boolean {
    try {
      this.#database.assertTransactionActive();
      return true;
    } catch {
      return false;
    }
  }
}

// ---------------------------------------------------------------------------
// 매핑 · 검증

function toProgressRow(row: StoryProgressDbRow): StoryProgressRow {
  return {
    profileId: String(row.profile_id),
    chapterId: String(row.chapter_id),
    attempts: Number(row.attempts),
    completions: Number(row.completions),
    bestGrade: row.best_grade === null
      ? null
      : String(row.best_grade) as ChapterGrade,
    firstCompletedAt: row.first_completed_at === null
      ? null
      : Number(row.first_completed_at),
    lastPlayedAt: Number(row.last_played_at),
    updatedAt: Number(row.updated_at),
  };
}

function toAttemptRow(row: DrillAttemptDbRow): DrillAttemptRow {
  return {
    id: Number(row.id),
    profileId: String(row.profile_id),
    templateId: String(row.template_id),
    seed: Number(row.seed),
    category: String(row.category),
    context: String(row.context) as DrillAttemptContext,
    chapterId: row.chapter_id === null ? null : String(row.chapter_id),
    runId: row.run_id === null ? null : String(row.run_id),
    correct: Number(row.correct) === 1,
    hintsUsed: Number(row.hints_used),
    attempt: Number(row.attempt),
    elapsedMs: Number(row.elapsed_ms),
    answeredAt: Number(row.answered_at),
  };
}

function toReviewNote(row: DrillReviewNoteDbRow): DrillReviewNote {
  return {
    profileId: String(row.profile_id),
    templateId: String(row.template_id),
    seed: Number(row.seed),
    box: Number(row.box) as ReviewBox,
    dueAt: Number(row.due_at),
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
  };
}

function betterGrade(
  current: ChapterGrade | null,
  next: ChapterGrade,
): ChapterGrade {
  if (current === null) return next;
  return GRADE_RANK[next] > GRADE_RANK[current] ? next : current;
}

function assertBoundedString(
  value: unknown,
  max: number,
  min = 1,
): void {
  if (
    typeof value !== 'string'
    || value.length < min
    || value.length > max
  ) {
    throw new StoryPersistenceError('STORY_VALUE_INVALID');
  }
}

function assertProfileId(value: string): void {
  assertBoundedString(value, 128);
}

function assertChapterId(value: string): void {
  assertBoundedString(value, 64);
}

function assertRunId(value: string): void {
  assertBoundedString(value, 64);
}

function assertTemplateId(value: string): void {
  assertBoundedString(value, 64);
}

function assertFlagKey(value: string): void {
  assertBoundedString(value, 128);
  if (DANGEROUS_FLAG_KEYS.has(value)) {
    throw new StoryPersistenceError('STORY_VALUE_INVALID');
  }
}

function assertFlagValue(value: string): void {
  assertBoundedString(value, 128, 0);
}

function assertGrade(value: ChapterGrade): void {
  if (value !== 'S' && value !== 'A' && value !== 'B') {
    throw new StoryPersistenceError('STORY_VALUE_INVALID');
  }
}

function assertSeed(value: number): void {
  if (!Number.isSafeInteger(value) || value < 0 || value > MAX_UINT32) {
    throw new StoryPersistenceError('STORY_VALUE_INVALID');
  }
}

function assertTimestamp(value: number): void {
  if (
    !Number.isSafeInteger(value)
    || value < 0
    || value > MAX_TIMESTAMP
  ) {
    throw new StoryPersistenceError('STORY_TIME_INVALID');
  }
}

function assertRange(fromMs: number, toMsExclusive: number): void {
  assertTimestamp(fromMs);
  assertTimestamp(toMsExclusive);
  if (toMsExclusive < fromMs) {
    throw new StoryPersistenceError('STORY_VALUE_INVALID');
  }
}

function assertOptionalContext(
  context: DrillAttemptContext | undefined,
): DrillAttemptContext | null {
  if (context === undefined) return null;
  if (!isDrillAttemptContext(context)) {
    throw new StoryPersistenceError('STORY_VALUE_INVALID');
  }
  return context;
}

function rethrowUnexpected(error: unknown): never {
  if (error instanceof StoryPersistenceError) throw error;
  throw new StoryPersistenceError('STORY_PERSISTENCE_INVALID');
}
