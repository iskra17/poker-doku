/**
 * 자리비움(sit-out) 정책 상수 + 순수 헬퍼.
 * - 캐시: 자리비움 좌석은 딜인하지 않되, 대략 SITOUT_MISSED_BB_LIMIT 오르빗(=미납 빅블라인드
 *   횟수)만큼 방치되면 자동으로 자리를 정리한다 (포커룸 표준 missed-blind 룰).
 * - SnG: 자리비움도 딜인/블라인드 유지 + 자동 폴드 — 토너먼트가 끝날 때까지 좌석 보존.
 *
 * 미납 블라인드는 좌석 인덱스 링 기하로 세지 않는다 — 엔진의 players 배열은 도착순(좌석순 아님)이라
 * 버튼이 배열 인덱스로 돌아 좌석 링과 어긋난다. 대신 "자리비움 시작 후 경과한 핸드 수"를 테이블
 * 인원으로 나눠 대략적인 오르빗(=미납 BB) 수로 환산한다.
 */

export const SITOUT_MISSED_BB_LIMIT = 2;
/** 자리비움 후 방을 떠난(로비 복귀) 좌석의 최종 정리 유예 — 핸드가 돌지 않는 방까지 확실히 회수 */
export const SITOUT_ABANDON_MS = 5 * 60_000;
/** 파산(0칩) 좌석의 리바이 유예 — 빠른 세션 회전을 위해 짧게 (2026-07-21 운영 결정: 30초) */
export const BUST_RECLAIM_MS = 30_000;
/**
 * 미납 BB 정리의 벽시계 하한 — 봇만 남은 테이블은 핸드가 3~5초에 돌아 2오르빗이 20~40초로
 * 축소된다 (2026-07-22 QA: 잠깐 자리 비운 사이 좌석 소멸 8회). 오르빗 조건에 AND로 결합해
 * 아무리 빨라도 이 시간 전에는 정리하지 않는다.
 */
export const SITOUT_MIN_WALL_MS = 120_000;

/**
 * 자리비움 좌석을 자동 정리할지. handsSatOut 핸드 동안 자리를 비웠고, 한 오르빗이 대략
 * orbitSize 핸드라면, 미납 빅블라인드 ≈ handsSatOut / orbitSize. 이것이 한도 이상이고
 * 벽시계로도 SITOUT_MIN_WALL_MS 이상 지났을 때만 정리.
 */
export function shouldRemoveForMissedBlinds(
  handsSatOut: number,
  orbitSize: number,
  satOutMs: number = Infinity,
): boolean {
  const orbit = Math.max(2, orbitSize); // 헤즈업 하한
  return handsSatOut >= SITOUT_MISSED_BB_LIMIT * orbit && satOutMs >= SITOUT_MIN_WALL_MS;
}
