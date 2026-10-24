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
 * - bottom: 평면 하단 가장자리(근경 레일)의 화면 위치 (위에서부터, H 비율). 그 아래는 히어로 전경 존
 * - height: 평면을 눕히기 전 높이 (H 배수, 눕히면 짧아진다)
 * - tiltDeg: 뒤로 눕힌 각도 / perspective: 시점 거리 (H 배수 — 화면 크기와 무관하게 같은 모양)
 */
export const FELT_PLANE = {
  bottom: 0.85,
  height: 1.2,
  tiltDeg: 36,
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
const round2 = (value: number) => Math.round(value * 100) / 100;

/**
 * 원근 이전(평평한 테이블) 설계 좌표 → 투영 화면 좌표 + 그 자리의 원근 배율.
 * 기존 평면 레이아웃은 레일 상자 x 4~96%, y 11~95%에서 서로 겹치지 않게 다듬은 값이라,
 * 그 상대 위치를 그대로 눕힌 평면에 옮긴다. dy는 투영 뒤 화면 % 보정(스프라이트 크기 여유).
 */
function feltPoint(flatX: number, flatY: number, dy = 0): { pos: TablePos; depth: number } {
  const p = projectFelt((flatX - 50) / 46, (95 - flatY) / 84);
  return { pos: { x: pct(p.x), y: pct(p.y + dy) }, depth: round2(p.scale) };
}

// 좌석 — 상대 5명은 레일 위(평면 설계 좌표), 히어로는 평면 밖 전경: 근경 레일이 가슴 높이를 지나도록
// 레일 선(bottom) 바로 아래에 둔다. 360×640(테이블 높이 ≈408px)에서도 플레이트가 독에 잘리지 않는 높이.
const OPPONENT_SEATS = [
  feltPoint(10, 71),   // 1: 좌하 (공개 카드 줄이 보드 아래로 오도록 근경 쪽)
  feltPoint(9, 31),    // 2: 좌상
  feltPoint(50, 14),   // 3: 상단 중앙
  feltPoint(91, 31),   // 4: 우상
  feltPoint(90, 71),   // 5: 우하 (공개 카드 줄이 보드 아래로 오도록 근경 쪽)
];
const HERO_SEAT: TablePos = { x: '50%', y: pct(FELT_PLANE.bottom * 100 + 1.5) };

export const SEATS: TablePos[] = [HERO_SEAT, ...OPPONENT_SEATS.map(point => point.pos)];

/**
 * 좌석 원근 배율 — 디스플레이 슬롯 순서. 히어로는 시점 바로 앞이라 1보다 크고, 먼 좌석일수록 작다.
 * 투영 배율(원경 레일 ≈0.75)을 따르되 글자 가독성을 위해 측면은 조금 완만하게 다듬은 값.
 */
export const SEAT_DEPTH: number[] = [1.06, 0.93, 0.83, 0.74, 0.83, 0.93];

/** 히어로 아바타 중심의 화면 y(%) 근사 — 좌석 중심보다 위 (아바타+플레이트 컬럼의 위쪽) */
export const HERO_AVATAR_Y = pct(parseFloat(HERO_SEAT.y) - 2.2);

// 각 좌석에서 테이블 중앙 방향으로 오프셋된 베팅 칩 위치
const BETS = [
  feltPoint(50, 80),   // 0: 히어로 → 위로 (펠트에 놓인 히어로 카드보다 안쪽)
  feltPoint(34, 78),   // 1: 좌하 → 오른쪽 아래 (쇼다운 공개 카드 줄보다 아래)
  feltPoint(30, 40),   // 2: 좌상 → 우하
  feltPoint(50, 30),   // 3: 상단 → 아래로 (원경 — 플레이트·팟과 안 겹치게)
  feltPoint(70, 40),   // 4: 우상 → 좌하
  feltPoint(66, 78),   // 5: 우하 → 왼쪽 아래 (쇼다운 공개 카드 줄보다 아래)
];
export const BET_POSITIONS: TablePos[] = BETS.map(point => point.pos);
/** 베팅 칩의 원근 배율 (근경 레일 = 1) — 펠트에 눕혀 그릴 때 쓴다 */
export const BET_DEPTH: number[] = BETS.map(point => point.depth);

// 딜러 버튼 위치 — 좌석 옆 펠트 위, 베팅 칩보다 살짝 바깥.
// 원경 측면(2·4)은 공개 카드(아바타 안쪽 옆)와 겹치지 않게 플레이트 아래 안쪽에 둔다.
const DEALER_BTNS = [
  { pos: { x: '31%', y: HERO_AVATAR_Y }, depth: 1 }, // 0: 히어로 → 아바타 왼쪽 (전경, 투척 발사대보다 바깥)
  feltPoint(16, 86),   // 1: 좌하 → 플레이트 아래 바깥 (근경 레일 위)
  feltPoint(22, 45),   // 2: 좌상 → 플레이트 아래 안쪽
  feltPoint(39, 29),   // 3: 상단 → 플레이트 아래 왼쪽 (양옆 원경 좌석의 공개 카드·홀카드 뒷면을 피해)
  feltPoint(78, 45),   // 4: 우상 → 플레이트 아래 안쪽
  feltPoint(84, 86),   // 5: 우하 → 플레이트 아래 바깥 (히어로 카드 팬을 피해)
];
export const DEALER_BTN_POSITIONS: TablePos[] = DEALER_BTNS.map(point => point.pos);
export const DEALER_BTN_DEPTH: number[] = DEALER_BTNS.map(point => point.depth);

// 팟 위치 — 보드 위쪽 (칩 수거/푸시 애니메이션의 목적지/출발지).
const POT = feltPoint(50, 40);
export const POT_POS: TablePos = POT.pos;
export const POT_DEPTH = POT.depth;

// 덱(딜러) 위치 — 우상단 딜러 코너 근처(화면 고정, 펠트 밖). 딜링/폴드 카드 비행의 출발/도착점
export const DECK_POS: TablePos = { x: '82%', y: '6%' };

// 커뮤니티 카드 라인 (딜링 비행 목적지 근사) — 상단 좌석 라인·하단 베팅 라인 사이 중앙
const BOARD = feltPoint(50, 53);
export const BOARD_POS: TablePos = BOARD.pos;
export const BOARD_DEPTH = BOARD.depth;

/**
 * 펠트에 놓인 물건(보드·팟·칩·포지션 버튼)을 평면과 같은 기울기로 눕히는 transform 조각.
 * 세운 스프라이트(좌석)와 달리 테이블 위에 "놓여" 보이게 한다. size는 원근 배율 × 추가 배율.
 */
export function layFlat(size: number): string {
  return `scale(${round2(size)}) perspective(900px) rotateX(${FELT_PLANE.tiltDeg}deg)`;
}

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
