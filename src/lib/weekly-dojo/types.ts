import type { WeeklyDojoFinishReason } from './config';

/**
 * 클라이언트로 나가는 주간 도장 뷰. 서버가 전부 계산한다 — 클라이언트가 점수·완료 여부·
 * 순위를 제출하거나 보정할 수 있는 필드는 없다.
 */

export type WeeklyDojoAttemptStatus = 'empty' | 'live' | 'completed';

export interface WeeklyDojoAttemptView {
  /** 1~3 (주간 시도 번호 — 시작 시점에 서버가 확정 예약한다) */
  readonly slot: number;
  readonly status: WeeklyDojoAttemptStatus;
  readonly handsPlayed: number;
  /** 확정된 핸드 경계까지의 순 BB (live면 진행 중 값) */
  readonly netBB: number;
  readonly finishReason: WeeklyDojoFinishReason | null;
  readonly completedAt: number | null;
}

export interface WeeklyDojoLeaderboardEntry {
  readonly rank: number;
  readonly profileId: string;
  readonly alias: string;
  readonly avatarId: string;
  readonly netBB: number;
  readonly isMe: boolean;
}

export interface WeeklyDojoLineupSeat {
  readonly seatIndex: number;
  readonly characterId: string;
  readonly name: string;
}

export interface WeeklyDojoRules {
  readonly startingChips: number;
  readonly smallBlind: number;
  readonly bigBlind: number;
  readonly startingBB: number;
  readonly maxHands: number;
  readonly attemptsPerWeek: number;
  readonly lineupVersion: string;
  readonly lineup: readonly WeeklyDojoLineupSeat[];
}

export interface WeeklyDojoLiveView {
  readonly attemptId: string;
  readonly slot: number;
  /** 살아 있는 테이블이 있으면 방 id (없으면 「이어하기」로 새 방을 연다) */
  readonly roomId: string | null;
  readonly handsPlayed: number;
  readonly netBB: number;
  /** 이 시도가 시작된 주 — 주가 바뀌었으면 먼저 끝내야 새 주 시도가 열린다 */
  readonly weekKey: string;
}

export interface WeeklyDojoView {
  readonly weekKey: string;
  /** 이번 주 종료(다음 KST 월요일 0시) */
  readonly weekEndsAt: number;
  readonly serverNow: number;
  readonly rules: WeeklyDojoRules;
  /** 항상 attemptsPerWeek 길이 — 아직 안 쓴 슬롯은 status 'empty' */
  readonly attempts: readonly WeeklyDojoAttemptView[];
  readonly live: WeeklyDojoLiveView | null;
  readonly completedCount: number;
  /** 3시도를 모두 끝냈을 때만 공식 합계 (미완료는 진행 기록) */
  readonly totalNetBB: number | null;
  readonly rank: number | null;
  readonly entrants: number;
  readonly top: readonly WeeklyDojoLeaderboardEntry[];
  readonly nearby: readonly WeeklyDojoLeaderboardEntry[];
}
