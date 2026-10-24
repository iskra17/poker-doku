/**
 * 테이블 좌표 시스템 (% 기반).
 * PokerTableView(정적 배치)·AnimationLayer(칩/카드 비행)·말풍선·투척·승리 연출이 공유한다.
 *
 * 좌표계 기준은 테이블 좌표 컨테이너(모든 화면에서 세로형 단일 레이아웃).
 * 히어로 하단 중앙, 상대 5명이 세로 타원 둘레에 배치되는 6-max 문법.
 *
 * 원근(2026-10-24): 펠트·레일은 하단 가장자리를 축으로 뒤로 눕힌 평면(`TableFelt`가 `FELT_PLANE` 그대로 CSS 3D 변환)이고,
 * 좌석·카드·칩은 그 평면 위 점을 화면에 투영한 위치에 선 "세운 스프라이트"다. 그래서 모든 좌표를 평면 좌표에서
 * `projectFelt()`로 계산한다 — 펠트 변환과 좌표가 같은 상수를 써야 칩/카드 비행·말풍선이 펠트와 어긋나지 않는다.
 */

export interface TablePos {
  x: string; // e.g. '50%'
  y: string;
}

/**
 * 펠트 평면 — 컨테이너 높이(H) 단위. 레일 타원은 평면 상자 전체(좌우 4% 안쪽)를 채운다.
 * - bottom: 평면 하단 가장자리(근경 레일)의 화면 위치 (위에서부터, H 비율)
 * - height: 평면을 눕히기 전 높이 (H 배수, 눕히면 짧아진다)
 * - tiltDeg: 뒤로 눕힌 각도 / perspective: 시점 거리 (H 배수 — 화면 크기와 무관하게 같은 모양)
 */
export const FELT_PLANE = {
  bottom: 0.93,
  height: 1.12,
  tiltDeg: 24,
  perspective: 2.1,
  /** 레일 타원의 좌우 여백 (컨테이너 폭 비율, 한쪽) */
  inset: 0.04,
} as const;

const RAD = (FELT_PLANE.tiltDeg * Math.PI) / 180;

/**
 * 평면 좌표 → 화면 좌표.
 * u: 레일 타원 중심 기준 가로 (-1 왼쪽 레일 ~ 1 오른쪽 레일), v: 근경 레일 0 ~ 원경 레일 1.
 * 반환 scale은 그 깊이의 원근 배율(근경 레일 = 1).
 */
export function projectFelt(u: number, v: number): { x: number; y: number; scale: number } {
  const d = v * FELT_PLANE.height;
  const scale = FELT_PLANE.perspective / (FELT_PLANE.perspective + d * Math.sin(RAD));
  return {
    x: 50 + u * (50 - FELT_PLANE.inset * 100) * scale,
    y: (FELT_PLANE.bottom - d * Math.cos(RAD) * scale) * 100,
    scale,
  };
}

const pct = (value: number) => `${Math.round(value * 10) / 10}%`;

/**
 * 원근 이전(평평한 테이블) 설계 좌표 → 투영 화면 좌표.
 * 기존 평면 레이아웃은 레일 상자 x 4~96%, y 11~95%에서 서로 겹치지 않게 다듬은 값이라,
 * 그 상대 위치를 그대로 눕힌 평면에 옮긴다. dy는 투영 뒤 화면 % 보정(스프라이트 크기 여유).
 */
function onFelt(flatX: number, flatY: number, dy = 0): TablePos {
  const u = (flatX - 50) / 46;
  const v = (95 - flatY) / 84;
  const p = projectFelt(u, v);
  return { x: pct(p.x), y: pct(p.y + dy) };
}

function depthAt(flatY: number): number {
  return projectFelt(0, (95 - flatY) / 84).scale;
}

// 좌석(평면 설계 좌표) — 히어로는 근경 레일에 걸터앉도록 레일 쪽으로 내린다
const SEAT_FLAT: readonly [number, number, number][] = [
  [50, 93, -2.1], // 0: 하단 중앙 (히어로) — 아바타가 근경 레일에 걸친다. 360×640(테이블 높이 ≈408px)에서도 플레이트가 독에 잘리지 않는 높이
  [10, 66, 0],    // 1: 좌하
  [9, 32, 0],     // 2: 좌상
  [50, 15, 0],    // 3: 상단 중앙
  [91, 32, 0],    // 4: 우상
  [90, 66, 0],    // 5: 우하
];

export const SEATS: TablePos[] = SEAT_FLAT.map(([x, y, dy]) => onFelt(x, y, dy));

/**
 * 좌석 원근 배율 — 디스플레이 슬롯 순서. 먼 좌석일수록 작다(히어로 1).
 * 가독성 하한 0.84 — 원경 좌석의 이름·칩 글자가 너무 작아지지 않게.
 */
export const SEAT_DEPTH: number[] = SEAT_FLAT.map(([, y]) =>
  Math.round(Math.max(0.84, depthAt(y) / depthAt(SEAT_FLAT[0][1])) * 100) / 100,
);

// 각 좌석에서 테이블 중앙 방향으로 오프셋된 베팅 칩 위치
export const BET_POSITIONS: TablePos[] = [
  onFelt(50, 75),   // 0: 히어로 → 위로 (히어로 카드 팬과 안 겹치게)
  onFelt(30, 61),   // 1: 좌하 → 우상
  onFelt(31, 38),   // 2: 좌상 → 우하
  onFelt(50, 30.5), // 3: 상단 → 아래로 (원근으로 좁아진 원경 — 360×640에서도 플레이트와 안 겹치게)
  onFelt(69, 38),   // 4: 우상 → 좌하
  onFelt(70, 61),   // 5: 우하 → 좌상
];

// 딜러 버튼 위치 — 좌석 옆 펠트 위, 베팅 칩보다 살짝 바깥.
// 주의: 커뮤니티 카드 라인과 x 16~84% 교차 지역은 보드와 겹치므로 피할 것
export const DEALER_BTN_POSITIONS: TablePos[] = [
  onFelt(31, 93, -4.2), // 0: 히어로 → 아바타 왼쪽 (아바타 중심 높이, 투척 발사대보다 바깥)
  onFelt(30, 69),   // 1: 좌하 → 베팅 칩 아래쪽
  onFelt(31, 30),   // 2: 좌상 → 베팅 칩 위쪽
  onFelt(64, 19),   // 3: 상단 → 오른쪽
  onFelt(69, 30),   // 4: 우상 → 베팅 칩 위쪽
  onFelt(70, 69),   // 5: 우하 → 베팅 칩 아래쪽
];

// 팟 위치 — 보드 위쪽 (칩 수거/푸시 애니메이션의 목적지/출발지).
// 좌상/우상 좌석 박스와 얽히지 않게 보드 바로 위 밴드에 둔다.
export const POT_POS: TablePos = onFelt(50, 38);

// 덱(딜러) 위치 — 우상단 딜러 코너 근처(화면 고정, 펠트 밖). 딜링/폴드 카드 비행의 출발/도착점
export const DECK_POS: TablePos = { x: '82%', y: '6%' };

// 커뮤니티 카드 라인 (딜링 비행 목적지 근사) — 상단 좌석 라인·하단 베팅 라인 사이 중앙
export const BOARD_POS: TablePos = onFelt(50, 50.5);

// 실전 테이블 좌표 컨테이너의 대표 가로:세로 비 (430×900 모바일: 상단 바·액션 독을 뺀 430×≈668).
// 좌표 컨테이너를 따로 크기 잡는 곳(수련 문제 테이블)은 이 비율을 지켜야 % 좌표가 실전과 같은 모양이 된다.
export const TABLE_ASPECT = 0.65;

export function getLayout() {
  return {
    seatDepth: SEAT_DEPTH,
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
