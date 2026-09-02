/**
 * 컷인 공용 조각 — 승자/패자 컷인(게임 이벤트 구동)과 스토리 컷인(prop 구동)이 같은 시각 문법을 쓴다.
 * 사선 스트라이프 배경: 캐릭터 색을 얹은 반투명 줄무늬 + 패널 그라디언트.
 */
export function stripeBg(color: string): string {
  return `repeating-linear-gradient(115deg, ${color}22 0 14px, ${color}0d 14px 28px), linear-gradient(115deg, rgba(21,12,38,0.97), rgba(30,18,53,0.92))`;
}
