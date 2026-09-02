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

/**
 * 오픈 레이즈를 **맞았을 때**의 3구간 (2막 Ch6 「3벳의 온도」·A7 ③ "프리미엄(6%) 3벳 / 콜드콜 상위 12%").
 * 상위 THREE_BET_THRESHOLD% 안 = 3벳, COLD_CALL_THRESHOLD%까지 = 콜, 그 밖 = 폴드.
 * 드릴(D-RANGE 3벳)·스파링 목표(`premium-3bet`)·Ch6 해설이 함께 쓰는 단일 소스.
 */
export const THREE_BET_THRESHOLD = 6;
export const COLD_CALL_THRESHOLD = 12;

/**
 * 내 오픈이 **3벳을 맞았을 때**의 3구간 — 4벳 = 상위 FOUR_BET_THRESHOLD%(QQ+·AK·AQs 근처), 콜 = CALL_VS_THREE_BET_THRESHOLD%까지,
 * 그 밖은 폴드. 스파링 목표 `fold-vs-3bet-junk`(하위 폴드)·`no-junk-4bet`(하위 4벳 0)가 같은 값을 본다.
 */
export const FOUR_BET_THRESHOLD = 3.5;
export const CALL_VS_THREE_BET_THRESHOLD = 8;
