/**
 * 테이블 좌표 시스템 (% 기반).
 * PokerTable(정적 배치)과 AnimationLayer(칩/카드 비행)가 공유한다.
 *
 * 좌표계 기준은 PokerTable의 세로 좌표 컨테이너(모든 화면에서 세로형 단일 레이아웃).
 * 히어로 하단 중앙, 상대 5명이 세로 타원 둘레에 배치되는 6-max 문법.
 */

export interface TablePos {
  x: string; // e.g. '50%'
  y: string;
}

export const SEATS: TablePos[] = [
  { x: '50%', y: '88%' },   // 0: 하단 중앙 (히어로)
  { x: '13%', y: '66%' },   // 1: 좌하
  { x: '13%', y: '34%' },   // 2: 좌상
  { x: '50%', y: '15%' },   // 3: 상단 중앙
  { x: '87%', y: '34%' },   // 4: 우상
  { x: '87%', y: '66%' },   // 5: 우하
];

// 각 좌석에서 테이블 중앙 방향으로 오프셋된 베팅 칩 위치
export const BET_POSITIONS: TablePos[] = [
  { x: '50%', y: '71%' },   // 0: 히어로 → 위로 (히어로 카드 팬과 안 겹치게)
  { x: '30%', y: '60%' },   // 1: 좌하 → 우상
  { x: '30%', y: '38%' },   // 2: 좌상 → 우하
  { x: '50%', y: '25%' },   // 3: 상단 → 아래로
  { x: '70%', y: '38%' },   // 4: 우상 → 좌하
  { x: '70%', y: '60%' },   // 5: 우하 → 좌상
];

// 딜러 버튼 위치 — 좌석 옆 펠트 위, 베팅 칩보다 살짝 바깥.
// 주의: y 41~49%(커뮤니티 카드 라인)와 x 16~84% 교차 지역은 보드와 겹치므로 피할 것
export const DEALER_BTN_POSITIONS: TablePos[] = [
  { x: '35%', y: '86%' },   // 0: 히어로 → 아바타 왼쪽
  { x: '31%', y: '68%' },   // 1: 좌하 → 베팅 칩 아래쪽
  { x: '31%', y: '30%' },   // 2: 좌상 → 베팅 칩 위쪽
  { x: '62%', y: '21%' },   // 3: 상단 → 오른쪽
  { x: '69%', y: '30%' },   // 4: 우상 → 베팅 칩 위쪽
  { x: '69%', y: '68%' },   // 5: 우하 → 베팅 칩 아래쪽
];

// 팟 위치 — 보드 위쪽 (칩 수거/푸시 애니메이션의 목적지/출발지)
export const POT_POS: TablePos = { x: '50%', y: '36%' };

// 덱(딜러) 위치 — 우상단 딜러 코너 근처. 딜링/폴드 카드 비행의 출발/도착점
export const DECK_POS: TablePos = { x: '82%', y: '6%' };

// 커뮤니티 카드 라인 (딜링 비행 목적지 근사)
export const BOARD_POS: TablePos = { x: '50%', y: '45%' };

export function getLayout() {
  return {
    seats: SEATS,
    betPositions: BET_POSITIONS,
    dealerBtnPositions: DEALER_BTN_POSITIONS,
    potPos: POT_POS,
    deckPos: DECK_POS,
    boardPos: BOARD_POS,
  };
}

/**
 * 실제 좌석 인덱스 → 디스플레이 슬롯 인덱스.
 * 내 좌석이 항상 하단 중앙(슬롯 0)에 오도록 테이블을 회전한다.
 * 관전/미착석(mySeatIndex < 0)이면 회전 없음.
 * 좌석 좌표를 쓰는 모든 곳(PokerTable/AnimationLayer/SeatSpeechBubble/WinnerSequence)이
 * 반드시 이 함수를 거쳐야 화면이 일치한다.
 */
export function toDisplayIndex(seatIndex: number, mySeatIndex: number): number {
  if (mySeatIndex < 0 || seatIndex < 0) return seatIndex;
  return (seatIndex - mySeatIndex + SEATS.length) % SEATS.length;
}
