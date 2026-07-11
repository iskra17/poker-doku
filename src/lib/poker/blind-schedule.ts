/**
 * 시트앤고 블라인드 스케줄 (터보 구조).
 * 표준 SnG: 시작 스택 ≈75BB, 일정 시간마다 블라인드 상승, 상위 입상 시상.
 * 이 게임은 1~3위 시상(50/30/20%)을 기본으로 한다.
 */

export interface BlindLevel {
  smallBlind: number;
  bigBlind: number;
}

export const SNG_BLIND_SCHEDULE: BlindLevel[] = [
  { smallBlind: 10, bigBlind: 20 },
  { smallBlind: 15, bigBlind: 30 },
  { smallBlind: 25, bigBlind: 50 },
  { smallBlind: 50, bigBlind: 100 },
  { smallBlind: 75, bigBlind: 150 },
  { smallBlind: 100, bigBlind: 200 },
  { smallBlind: 150, bigBlind: 300 },
  { smallBlind: 200, bigBlind: 400 },
  { smallBlind: 300, bigBlind: 600 },
  { smallBlind: 500, bigBlind: 1000 },
  { smallBlind: 1000, bigBlind: 2000 },
];

/** 레벨당 지속 시간 (터보: 3분). 서버 테스트용 SNG_LEVEL_MS 환경변수로 단축 가능 */
export const SNG_LEVEL_DURATION_MS =
  (typeof process !== 'undefined' && Number(process.env.SNG_LEVEL_MS)) || 3 * 60_000;

/** 시작 스택 (75BB @ 10/20) */
export const SNG_STARTING_STACK = 1500;

/** 순위별 상금 배분 (1위부터) — 총 상금 = 참가자 수 × 시작 스택 */
export const SNG_PRIZE_SPLIT = [0.5, 0.3, 0.2];

/** 경과 시간 → 레벨 인덱스 (0-based, 스케줄 끝에서 고정) */
export function levelIndexAt(startedAt: number, now: number): number {
  const elapsed = Math.max(0, now - startedAt);
  return Math.min(Math.floor(elapsed / SNG_LEVEL_DURATION_MS), SNG_BLIND_SCHEDULE.length - 1);
}
