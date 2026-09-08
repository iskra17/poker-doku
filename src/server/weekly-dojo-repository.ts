import { randomUUID } from 'node:crypto';
import { netMilliBB } from '@/lib/weekly-dojo/rules';
import type { WeeklyDojoFinishReason } from '@/lib/weekly-dojo/config';
import type { PokerDatabase } from './persistence/database';

/**
 * 주간 도장 영속 계층 (마이그레이션 v42).
 *
 * 이 저장소가 유일한 점수 권위다. 런타임(WeeklyDojoService)은 엔진에서 읽은 스택을 넘길 뿐
 * 시도 번호·핸드 인덱스·완료 여부·점수는 전부 여기서 확정된다.
 *
 * 불변식:
 * - 프로필당 `status='live'` 행은 최대 1개 (부분 유니크 인덱스). 주가 바뀌어도 유지되므로
 *   지난 주 시도를 끝내야 새 주 시도가 열린다.
 * - `committed_chips`는 **확정된 핸드 경계**의 스택이다.
 * - `hand_index`는 저장소가 `hands_played + 1`로 **직접 계산**한다. 호출자가 인덱스를 제출할 수
 *   없으므로 인메모리 카운터가 낡아도 순번이 어긋나지 않는다.
 * - 핸드 키는 `(attempt_id, room_epoch, hand_number)`다. 방을 다시 열면 엔진 `handNumber`가
 *   1부터 다시 시작하므로 에폭 없이는 재개 후 첫 핸드가 이전 기록과 충돌해 조용히 무시된다.
 * - `hands_played >= max_hands`면 새 경계를 받지 않는다(`cap-reached`) — 상한 초과 기록 차단.
 * - `completeAttempt`는 멱등이다 — 이미 완료된 시도는 저장된 결과를 그대로 돌려준다.
 */

export type WeeklyDojoAttemptStatusRow = 'live' | 'completed';

export interface WeeklyDojoAttemptRecord {
  readonly id: string;
  readonly profileId: string;
  readonly weekKey: string;
  readonly attemptNo: number;
  readonly lineupVersion: string;
  readonly startingChips: number;
  readonly bigBlind: number;
  readonly maxHands: number;
  readonly status: WeeklyDojoAttemptStatusRow;
  readonly handsPlayed: number;
  readonly committedChips: number;
  /** 이 시도가 방을 연 횟수 — 핸드 키의 일부 (재개 후 handNumber 충돌 방지) */
  readonly roomEpoch: number;
  /**
   * 서버 전용 경계 스냅샷(원문 JSON). 봇 좌석별 칩·딜러 앵커·라인업 버전이 들어 있다.
   * **공개 뷰로 내보내지 말 것** — 상대 스택은 테이블 안에서만 보여야 한다.
   */
  readonly checkpointJson: string | null;
  readonly scoreMilliBB: number | null;
  readonly finishReason: WeeklyDojoFinishReason | null;
  readonly startedAt: number;
  readonly updatedAt: number;
  readonly completedAt: number | null;
}

export interface ReserveAttemptInput {
  readonly profileId: string;
  readonly weekKey: string;
  readonly lineupVersion: string;
  readonly startingChips: number;
  readonly bigBlind: number;
  readonly maxHands: number;
  readonly attemptsPerWeek: number;
  readonly at: number;
}

export type ReserveAttemptResult =
  | { readonly status: 'reserved'; readonly attempt: WeeklyDojoAttemptRecord }
  /** 이미 진행 중인 시도가 있다 — 이어서 해야 한다 (다른 주의 시도일 수도 있다) */
  | { readonly status: 'resumed'; readonly attempt: WeeklyDojoAttemptRecord }
  | { readonly status: 'cap-reached' };

export type BeginRoomEpochResult =
  | { readonly status: 'ok'; readonly attempt: WeeklyDojoAttemptRecord }
  | { readonly status: 'not-live' };

export type HandBoundaryResult =
  | { readonly status: 'recorded'; readonly attempt: WeeklyDojoAttemptRecord }
  | { readonly status: 'duplicate'; readonly attempt: WeeklyDojoAttemptRecord }
  | { readonly status: 'cap-reached'; readonly attempt: WeeklyDojoAttemptRecord }
  | { readonly status: 'not-live' };

export type CompleteAttemptResult =
  | { readonly status: 'completed'; readonly attempt: WeeklyDojoAttemptRecord }
  | { readonly status: 'already-completed'; readonly attempt: WeeklyDojoAttemptRecord }
  | { readonly status: 'not-found' };

export interface WeeklyDojoStandingRow {
  readonly profileId: string;
  readonly alias: string;
  readonly avatarId: string;
  readonly scoreMilliBB: number;
  readonly completedAttempts: number;
}

interface AttemptRow {
  readonly id: string;
  readonly profile_id: string;
  readonly week_key: string;
  readonly attempt_no: number;
  readonly lineup_version: string;
  readonly starting_chips: number;
  readonly big_blind: number;
  readonly max_hands: number;
  readonly status: string;
  readonly hands_played: number;
  readonly committed_chips: number;
  readonly room_epoch: number;
  readonly checkpoint_json: string | null;
  readonly score_milli_bb: number | null;
  readonly finish_reason: string | null;
  readonly started_at: number;
  readonly updated_at: number;
  readonly completed_at: number | null;
}

const ATTEMPT_COLUMNS = `
  id, profile_id, week_key, attempt_no, lineup_version, starting_chips,
  big_blind, max_hands, status, hands_played, committed_chips,
  room_epoch, checkpoint_json,
  score_milli_bb, finish_reason, started_at, updated_at, completed_at
`;

function toRecord(row: AttemptRow): WeeklyDojoAttemptRecord {
  return {
    id: row.id,
    profileId: row.profile_id,
    weekKey: row.week_key,
    attemptNo: row.attempt_no,
    lineupVersion: row.lineup_version,
    startingChips: row.starting_chips,
    bigBlind: row.big_blind,
    maxHands: row.max_hands,
    status: row.status as WeeklyDojoAttemptStatusRow,
    handsPlayed: row.hands_played,
    committedChips: row.committed_chips,
    roomEpoch: row.room_epoch,
    checkpointJson: row.checkpoint_json,
    scoreMilliBB: row.score_milli_bb,
    finishReason: row.finish_reason as WeeklyDojoFinishReason | null,
    startedAt: row.started_at,
    updatedAt: row.updated_at,
    completedAt: row.completed_at,
  };
}

export class WeeklyDojoRepository {
  readonly #database: PokerDatabase;

  constructor(database: PokerDatabase) {
    this.#database = database;
  }

  /** 프로필의 진행 중 시도 (주 무관 — 지난 주 시도가 남아 있을 수 있다) */
  findLiveAttempt(profileId: string): WeeklyDojoAttemptRecord | null {
    const row = this.#database.db.prepare(`
      SELECT ${ATTEMPT_COLUMNS} FROM weekly_dojo_attempts
      WHERE profile_id = ? AND status = 'live'
    `).get(profileId) as AttemptRow | undefined;
    return row ? toRecord(row) : null;
  }

  findAttempt(attemptId: string): WeeklyDojoAttemptRecord | null {
    const row = this.#database.db.prepare(`
      SELECT ${ATTEMPT_COLUMNS} FROM weekly_dojo_attempts WHERE id = ?
    `).get(attemptId) as AttemptRow | undefined;
    return row ? toRecord(row) : null;
  }

  listAttempts(profileId: string, weekKey: string): WeeklyDojoAttemptRecord[] {
    return (this.#database.db.prepare(`
      SELECT ${ATTEMPT_COLUMNS} FROM weekly_dojo_attempts
      WHERE profile_id = ? AND week_key = ?
      ORDER BY attempt_no
    `).all(profileId, weekKey) as unknown as AttemptRow[]).map(toRecord);
  }

  /**
   * 플레이 전에 시도 번호를 확정한다. 진행 중 시도가 있으면 그것을 그대로 돌려준다(resumed) —
   * 새 번호를 발급하지 않는 것이 "불리한 기록 버리기" 차단의 핵심이다.
   */
  reserveAttempt(input: ReserveAttemptInput): ReserveAttemptResult {
    return this.#database.transaction((): ReserveAttemptResult => {
      const live = this.findLiveAttempt(input.profileId);
      if (live) return { status: 'resumed', attempt: live };

      const used = this.#database.db.prepare(`
        SELECT COALESCE(MAX(attempt_no), 0) AS used FROM weekly_dojo_attempts
        WHERE profile_id = ? AND week_key = ?
      `).get(input.profileId, input.weekKey) as { used: number };
      const attemptNo = used.used + 1;
      if (attemptNo > input.attemptsPerWeek) return { status: 'cap-reached' };

      const id = `wd_${randomUUID().replaceAll('-', '')}`;
      const row = this.#database.db.prepare(`
        INSERT INTO weekly_dojo_attempts (
          id, profile_id, week_key, attempt_no, lineup_version, starting_chips,
          big_blind, max_hands, status, hands_played, committed_chips,
          room_epoch, checkpoint_json,
          score_milli_bb, finish_reason, started_at, updated_at, completed_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'live', 0, ?, 0, NULL, NULL, NULL, ?, ?, NULL)
        RETURNING ${ATTEMPT_COLUMNS}
      `).get(
        id,
        input.profileId,
        input.weekKey,
        attemptNo,
        input.lineupVersion,
        input.startingChips,
        input.bigBlind,
        input.maxHands,
        input.startingChips,
        input.at,
        input.at,
      ) as unknown as AttemptRow;
      return { status: 'reserved', attempt: toRecord(row) };
    });
  }

  /**
   * 방을 열기 **전에** 에폭을 durable하게 올린다. 이 값이 핸드 키의 일부라서, 새 엔진의
   * `handNumber` 1이 이전 방의 1과 절대 겹치지 않는다. 실패하면 방을 열지 않는다(fail-closed).
   */
  beginRoomEpoch(attemptId: string, at: number): BeginRoomEpochResult {
    const row = this.#database.db.prepare(`
      UPDATE weekly_dojo_attempts
      SET room_epoch = room_epoch + 1, updated_at = MAX(?, started_at)
      WHERE id = ? AND status = 'live'
      RETURNING ${ATTEMPT_COLUMNS}
    `).get(at, attemptId) as AttemptRow | undefined;
    return row ? { status: 'ok', attempt: toRecord(row) } : { status: 'not-live' };
  }

  /**
   * 확정된 핸드 경계를 기록한다. `handIndex`는 **저장소가** `hands_played + 1`로 계산하고,
   * 중복 콜백은 `(attempt_id, room_epoch, hand_number)` PK가 흡수한다.
   * `checkpointJson`은 같은 트랜잭션에서 함께 고정되므로 경계와 복원 상태가 어긋나지 않는다.
   */
  recordHandBoundary(input: {
    readonly attemptId: string;
    readonly roomEpoch: number;
    readonly handNumber: number;
    readonly chipsAfter: number;
    readonly checkpointJson: string | null;
    readonly at: number;
  }): HandBoundaryResult {
    return this.#database.transaction((): HandBoundaryResult => {
      const current = this.findAttempt(input.attemptId);
      if (!current || current.status !== 'live') return { status: 'not-live' };

      const existing = this.#database.db.prepare(`
        SELECT hand_index FROM weekly_dojo_hands
        WHERE attempt_id = ? AND room_epoch = ? AND hand_number = ?
      `).get(input.attemptId, input.roomEpoch, input.handNumber) as
        { hand_index: number } | undefined;
      if (existing) {
        // 이미 확정된 경계다. 스택은 절대 다시 쓰지 않고(중복 콜백 방어), 진행 중 이탈로 비워 둔
        // 체크포인트만 **진짜 핸드 종료 시점에** 한 번 채운다 — 그래야 복원 상태가 경계와 맞는다.
        if (input.checkpointJson === null || current.checkpointJson !== null) {
          return { status: 'duplicate', attempt: current };
        }
        const patched = this.#database.db.prepare(`
          UPDATE weekly_dojo_attempts
          SET checkpoint_json = ?, updated_at = MAX(?, started_at)
          WHERE id = ? AND status = 'live' AND checkpoint_json IS NULL
          RETURNING ${ATTEMPT_COLUMNS}
        `).get(input.checkpointJson, input.at, input.attemptId) as
          AttemptRow | undefined;
        return { status: 'duplicate', attempt: patched ? toRecord(patched) : current };
      }

      // 상한을 넘긴 기록은 받지 않는다 — 재개·중복 경로가 21번째 핸드를 만들 수 없다
      if (current.handsPlayed >= current.maxHands) {
        return { status: 'cap-reached', attempt: current };
      }
      const handIndex = current.handsPlayed + 1;

      this.#database.db.prepare(`
        INSERT INTO weekly_dojo_hands (
          attempt_id, room_epoch, hand_number, hand_index, chips_after, recorded_at
        ) VALUES (?, ?, ?, ?, ?, ?)
      `).run(
        input.attemptId,
        input.roomEpoch,
        input.handNumber,
        handIndex,
        input.chipsAfter,
        input.at,
      );

      const row = this.#database.db.prepare(`
        UPDATE weekly_dojo_attempts
        SET hands_played = ?, committed_chips = ?, checkpoint_json = ?,
            updated_at = MAX(?, started_at)
        WHERE id = ? AND status = 'live'
        RETURNING ${ATTEMPT_COLUMNS}
      `).get(
        handIndex,
        input.chipsAfter,
        input.checkpointJson,
        input.at,
        input.attemptId,
      ) as AttemptRow | undefined;
      if (!row) return { status: 'not-live' };
      return { status: 'recorded', attempt: toRecord(row) };
    });
  }

  /**
   * 시도를 확정 종료한다. 점수는 저장된 `committed_chips`(마지막 확정 경계)로만 계산한다 —
   * 호출자가 스택을 제출할 수 없다. 이미 완료된 시도는 그대로 돌려준다(멱등).
   */
  completeAttempt(input: {
    readonly attemptId: string;
    readonly reason: WeeklyDojoFinishReason;
    readonly at: number;
  }): CompleteAttemptResult {
    return this.#database.transaction((): CompleteAttemptResult => {
      const current = this.findAttempt(input.attemptId);
      if (!current) return { status: 'not-found' };
      if (current.status === 'completed') {
        return { status: 'already-completed', attempt: current };
      }
      const score = netMilliBB(
        current.committedChips,
        current.startingChips,
        current.bigBlind,
      );
      const completedAt = Math.max(input.at, current.startedAt);
      const row = this.#database.db.prepare(`
        UPDATE weekly_dojo_attempts
        SET status = 'completed', score_milli_bb = ?, finish_reason = ?,
            completed_at = ?, updated_at = ?
        WHERE id = ? AND status = 'live'
        RETURNING ${ATTEMPT_COLUMNS}
      `).get(
        score,
        input.reason,
        completedAt,
        completedAt,
        input.attemptId,
      ) as AttemptRow | undefined;
      if (!row) return { status: 'not-found' };
      return { status: 'completed', attempt: toRecord(row) };
    });
  }

  /**
   * 주간 확정 순위표 재료 — **완주(3시도)한 프로필만**. 미완료는 진행 기록이지 공식 순위가
   * 아니라는 기획 계약을 SQL에서 강제한다. 정렬·공동 순위는 `rules.rankScores`가 맡는다.
   */
  listWeeklyStandings(
    weekKey: string,
    attemptsPerWeek: number,
  ): WeeklyDojoStandingRow[] {
    return (this.#database.db.prepare(`
      SELECT
        a.profile_id AS profileId,
        p.alias AS alias,
        p.avatar_id AS avatarId,
        SUM(a.score_milli_bb) AS scoreMilliBB,
        COUNT(*) AS completedAttempts
      FROM weekly_dojo_attempts AS a
      JOIN profiles AS p ON p.id = a.profile_id
      WHERE a.week_key = ? AND a.status = 'completed'
      GROUP BY a.profile_id, p.alias, p.avatar_id
      HAVING COUNT(*) >= ?
    `).all(weekKey, attemptsPerWeek) as unknown as {
      profileId: string;
      alias: string;
      avatarId: string;
      scoreMilliBB: number;
      completedAttempts: number;
    }[]).map(row => ({
      profileId: row.profileId,
      alias: row.alias,
      avatarId: row.avatarId,
      scoreMilliBB: row.scoreMilliBB,
      completedAttempts: row.completedAttempts,
    }));
  }
}
