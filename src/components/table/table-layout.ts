/**
 * 테이블 좌표 시스템 (% 기반).
 * PokerTable(정적 배치)과 AnimationLayer(칩/카드 비행)가 공유한다.
 */

export interface TablePos {
  x: string; // e.g. '50%'
  y: string;
}

// Desktop: wide elliptical layout
export const DESKTOP_SEATS: TablePos[] = [
  { x: '50%', y: '88%' },   // 0: bottom center (hero)
  { x: '10%', y: '65%' },   // 1: left bottom
  { x: '10%', y: '30%' },   // 2: left top
  { x: '50%', y: '8%' },    // 3: top center
  { x: '90%', y: '30%' },   // 4: right top
  { x: '90%', y: '65%' },   // 5: right bottom
];

// Mobile: compact portrait layout (히어로 카드가 커서 좌석을 약간 위로)
export const MOBILE_SEATS: TablePos[] = [
  { x: '50%', y: '78%' },   // 0: bottom center (hero)
  { x: '8%',  y: '62%' },   // 1: left middle
  { x: '8%',  y: '28%' },   // 2: left top
  { x: '50%', y: '8%' },    // 3: top center
  { x: '92%', y: '28%' },   // 4: right top
  { x: '92%', y: '62%' },   // 5: right middle
];

// 각 좌석에서 테이블 중앙 방향으로 오프셋된 칩 위치 (좌석→중앙 사이 40% 지점)
export const DESKTOP_BET_POSITIONS: TablePos[] = [
  { x: '40%', y: '70%' },   // 0: bottom → 히어로 아바타와 겹치지 않게 좌측으로
  { x: '25%', y: '58%' },   // 1: left bottom → 우상
  { x: '25%', y: '38%' },   // 2: left top → 우하
  { x: '50%', y: '22%' },   // 3: top → 아래로
  { x: '75%', y: '38%' },   // 4: right top → 좌하
  { x: '75%', y: '58%' },   // 5: right bottom → 좌상
];

export const MOBILE_BET_POSITIONS: TablePos[] = [
  { x: '36%', y: '62%' },   // 0: bottom → 히어로 카드와 겹치지 않게 좌측으로
  { x: '22%', y: '52%' },   // 1: left middle → 우상
  { x: '22%', y: '34%' },   // 2: left top → 우하
  { x: '50%', y: '18%' },   // 3: top → 아래로
  { x: '78%', y: '34%' },   // 4: right top → 좌하
  { x: '78%', y: '52%' },   // 5: right middle → 좌상
];

// 팟 위치 (칩 수거/푸시 애니메이션의 목적지/출발지)
export const DESKTOP_POT_POS: TablePos = { x: '50%', y: '60%' };
export const MOBILE_POT_POS: TablePos = { x: '50%', y: '56%' };

// 덱(딜러) 위치 — 딜링/폴드 카드 비행의 출발/도착점
export const DESKTOP_DECK_POS: TablePos = { x: '50%', y: '28%' };
export const MOBILE_DECK_POS: TablePos = { x: '50%', y: '25%' };

// 커뮤니티 카드 라인 (딜링 비행 목적지 근사)
export const DESKTOP_BOARD_POS: TablePos = { x: '50%', y: '45%' };
export const MOBILE_BOARD_POS: TablePos = { x: '50%', y: '42%' };

export function getLayout(isMobile: boolean) {
  return {
    seats: isMobile ? MOBILE_SEATS : DESKTOP_SEATS,
    betPositions: isMobile ? MOBILE_BET_POSITIONS : DESKTOP_BET_POSITIONS,
    potPos: isMobile ? MOBILE_POT_POS : DESKTOP_POT_POS,
    deckPos: isMobile ? MOBILE_DECK_POS : DESKTOP_DECK_POS,
    boardPos: isMobile ? MOBILE_BOARD_POS : DESKTOP_BOARD_POS,
  };
}
