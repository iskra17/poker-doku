/**
 * 언오픈 팟 오픈 레이즈 임계 (핸드 상위 %, `handPercentile × 100`과 비교) — 기획 A7 ③ 결정 리뷰 표와 같은 값.
 * 드릴 출제(D-RANGE)·스파링 목표 집계(`open-raise` 기회 판정)·Ch2 해설이 함께 쓰는 **단일 소스** —
 * 값을 바꾸려면 Ch2 개념 카드·수기 문항 해설도 같이 옮길 것.
 * BB는 언오픈 팟이 오지 않으므로(전원 폴드 = BB 승) 임계가 없다.
 */
export const OPEN_THRESHOLDS: Readonly<Record<string, number>> = Object.freeze({
  UTG: 15,
  HJ: 18,
  CO: 25,
  BTN: 35,
  SB: 25,
});
