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

/**
 * 자리비움 좌석을 자동 정리할지. handsSatOut 핸드 동안 자리를 비웠고, 한 오르빗이 대략
 * orbitSize 핸드라면, 미납 빅블라인드 ≈ handsSatOut / orbitSize. 이것이 한도 이상이면 정리.
 */
export function shouldRemoveForMissedBlinds(handsSatOut: number, orbitSize: number): boolean {
  const orbit = Math.max(2, orbitSize); // 헤즈업 하한
  return handsSatOut >= SITOUT_MISSED_BB_LIMIT * orbit;
}
