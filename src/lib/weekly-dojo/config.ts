/**
 * 주간 도장 (Weekly Dojo) — 아레나 안의 비동기 주간 도전 규칙.
 *
 * 기획: `docs/planning-ui-economy-arena-2026-09-09.md` §6 "주간 도전 실험의 구체안".
 *
 * 계약:
 * - 지갑 칩·경기권·공식 아레나 MMR과 **완전히 분리**된다. 방은 항상 `economyMode: 'practice'`이고
 *   참가비도 보상 칩도 없다. 기록은 "짧은 표본의 재미 기록"이지 실력 측정이 아니다.
 * - 덱은 항상 엔진 기본 CSPRNG 셔플이다. 모두에게 같은 고정 시드를 재사용하면 먼저 플레이한
 *   사람이 카드를 공유할 수 있다 (기획 명시).
 * - 라인업은 버전으로 고정한다. 봇 성향을 바꾸면 `LINEUP_VERSION`을 올려야 하고, 그래야 과거 주
 *   기록이 어떤 봇 상대의 성적인지 남는다.
 */

export const WEEKLY_DOJO_LINEUP_VERSION = 'wd-v1';

/** 좌석 순서 고정 — 모든 참가자가 같은 좌석에 같은 상대를 만난다 */
export interface WeeklyDojoSeat {
  readonly seatIndex: number;
  readonly characterId: string;
}

/**
 * 봇 5석. 스타터 6인(sakura/ara/hana/chloe/vivian/elena)은 프로필 아바타 후보라
 * 히어로와 얼굴이 겹치기 쉬워 마스코트 5인을 쓴다 — 성향도 니트/ABC/트래퍼/블러퍼/3벳
 * 폭격기로 갈려 한 가지 공략으로 다 뚫리지 않는다. 히어로 좌석은 0번.
 */
export const WEEKLY_DOJO_LINEUP: readonly WeeklyDojoSeat[] = Object.freeze([
  { seatIndex: 1, characterId: 'mochi' },
  { seatIndex: 2, characterId: 'choco' },
  { seatIndex: 3, characterId: 'luna' },
  { seatIndex: 4, characterId: 'gumi' },
  { seatIndex: 5, characterId: 'paeng' },
] as const);

export const WEEKLY_DOJO_CONFIG = Object.freeze({
  lineupVersion: WEEKLY_DOJO_LINEUP_VERSION,
  heroSeatIndex: 0,
  smallBlind: 10,
  bigBlind: 20,
  /** 100BB */
  startingChips: 2_000,
  maxHands: 20,
  attemptsPerWeek: 3,
  /** 턴 시간(초) — 방 생성 옵션의 '표준' */
  turnTimeSec: 15,
  difficulty: 'hard' as const,
  /** 방을 열어 둔 채 아무 진행이 없을 때의 상한 — 넘기면 방만 닫고 시도는 live로 보존 */
  holdTimeoutMs: 10 * 60_000,
  /** 마지막 핸드 종료 → 방 해체까지 (승리 연출을 보여준 뒤) */
  finishDelayMs: 6_000,
});

export type WeeklyDojoFinishReason =
  | 'max-hands'
  | 'bust'
  | 'forfeit'
  | 'recovery'
  | 'table-short';

export const WEEKLY_DOJO_FINISH_REASONS: readonly WeeklyDojoFinishReason[] = Object.freeze([
  'max-hands',
  'bust',
  'forfeit',
  'recovery',
  'table-short',
] as const);

export function isWeeklyDojoFinishReason(
  value: unknown,
): value is WeeklyDojoFinishReason {
  return typeof value === 'string'
    && (WEEKLY_DOJO_FINISH_REASONS as readonly string[]).includes(value);
}
