/**
 * 마이그레이션 v42 — 주간 도장 (Weekly Dojo).
 *
 * `migrations.ts`가 이 모듈을 import해 목록 끝에 붙인다 (병합 순서를 단순하게 유지하기 위한
 * 분리 — 다른 기능이 v41을 쓰고 있어도 이 파일만 옮기면 된다).
 *
 * 계약:
 * - 시도 번호(`attempt_no`)는 **플레이 전에** 예약한다. 불리한 기록을 중간에 버리고 다시 뽑는
 *   재도전 우위를 차단하는 핵심이다 (기획: "세션 시작 시 순번을 서버에 확정").
 * - `committed_chips`는 마지막으로 **확정된 핸드 경계**의 스택이다. 진행 중 핸드에서 나가거나
 *   포기하면 런타임이 그 자리에서 "기여금 전액 포기" 경계를 기록하므로, 진 핸드는 나가기로
 *   지워지지 않는다. 서버가 핸드 도중 죽은 경우(진짜 크래시)에만 그 핸드가 롤백된다.
 * - `room_epoch`는 이 시도가 방을 연 횟수다. 방을 다시 열면 `PokerEngine`의 `hand_number`가
 *   1부터 다시 시작하므로, 에폭 없이 `(attempt_id, hand_number)`만으로 키를 잡으면 재개 후
 *   첫 핸드들이 이전 핸드와 충돌해 **조용히 무시**된다(= 추가 핸드·손실 삭제). 에폭을 방 오픈
 *   시점에 durable하게 올리고 키에 포함해 그 모호성을 없앤다.
 * - `hand_index`는 시도 전체에서 단조 증가하는 핸드 번호다. 저장소가 `hands_played + 1`로
 *   직접 계산하고 UNIQUE로 잠근다 — 호출자가 인덱스를 제출할 수 없다.
 * - `checkpoint_json`은 **서버 전용 경계 스냅샷**(봇 좌석별 칩·딜러 앵커·라인업 버전)이다.
 *   재개 시 이걸로 복원하지 않으면 봇 스택·버튼이 초기화돼 칩 풀과 상대 조건이 리셋된다.
 *   어떤 공개 뷰/이벤트로도 내보내지 않는다.
 * - 지갑/원장/경기권과 어떤 외래키도 공유하지 않는다 — 이 기능은 경제에 영향을 주지 않는다.
 */
export const WEEKLY_DOJO_MIGRATION = {
  version: 42,
  name: 'weekly_dojo_challenge',
  sql: `
    CREATE TABLE weekly_dojo_attempts (
      id TEXT PRIMARY KEY CHECK (length(id) BETWEEN 1 AND 128),
      profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
      week_key TEXT NOT NULL CHECK (length(week_key) BETWEEN 6 AND 16),
      attempt_no INTEGER NOT NULL CHECK (attempt_no BETWEEN 1 AND 3),
      lineup_version TEXT NOT NULL CHECK (length(lineup_version) BETWEEN 1 AND 32),
      starting_chips INTEGER NOT NULL CHECK (starting_chips > 0),
      big_blind INTEGER NOT NULL CHECK (big_blind > 0),
      max_hands INTEGER NOT NULL CHECK (max_hands > 0),
      status TEXT NOT NULL CHECK (status IN ('live','completed')),
      hands_played INTEGER NOT NULL CHECK (hands_played >= 0 AND hands_played <= max_hands),
      committed_chips INTEGER NOT NULL CHECK (committed_chips >= 0),
      room_epoch INTEGER NOT NULL DEFAULT 0 CHECK (room_epoch >= 0),
      checkpoint_json TEXT CHECK (
        checkpoint_json IS NULL OR length(checkpoint_json) BETWEEN 2 AND 4096
      ),
      score_milli_bb INTEGER,
      finish_reason TEXT CHECK (
        finish_reason IS NULL
        OR finish_reason IN ('max-hands','bust','forfeit','recovery','table-short')
      ),
      started_at INTEGER NOT NULL CHECK (started_at > 0),
      updated_at INTEGER NOT NULL CHECK (updated_at >= started_at),
      completed_at INTEGER,
      CHECK (
        (
          status = 'live'
          AND score_milli_bb IS NULL
          AND finish_reason IS NULL
          AND completed_at IS NULL
        )
        OR (
          status = 'completed'
          AND score_milli_bb IS NOT NULL
          AND finish_reason IS NOT NULL
          AND completed_at IS NOT NULL
          AND completed_at >= started_at
        )
      ),
      UNIQUE (profile_id, week_key, attempt_no)
    ) STRICT;

    CREATE UNIQUE INDEX weekly_dojo_one_live_attempt
      ON weekly_dojo_attempts(profile_id) WHERE status = 'live';

    CREATE INDEX idx_weekly_dojo_week_status
      ON weekly_dojo_attempts(week_key, status);

    CREATE TABLE weekly_dojo_hands (
      attempt_id TEXT NOT NULL
        REFERENCES weekly_dojo_attempts(id) ON DELETE CASCADE,
      room_epoch INTEGER NOT NULL CHECK (room_epoch >= 0),
      hand_number INTEGER NOT NULL CHECK (hand_number > 0),
      hand_index INTEGER NOT NULL CHECK (hand_index > 0),
      chips_after INTEGER NOT NULL CHECK (chips_after >= 0),
      recorded_at INTEGER NOT NULL CHECK (recorded_at > 0),
      PRIMARY KEY (attempt_id, room_epoch, hand_number)
    ) STRICT;

    CREATE UNIQUE INDEX weekly_dojo_hand_sequence
      ON weekly_dojo_hands(attempt_id, hand_index);
  `,
} as const;
