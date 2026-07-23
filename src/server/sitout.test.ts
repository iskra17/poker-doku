import { describe, it, expect } from 'vitest';
import { shouldRemoveForMissedBlinds, SITOUT_MISSED_BB_LIMIT, SITOUT_MIN_WALL_MS } from './sitout';

describe('shouldRemoveForMissedBlinds — 자리비움 자동 정리 판정', () => {
  it('한도 미만이면 유지, 도달하면 정리한다 (6인 테이블 = 오르빗 6핸드)', () => {
    // 6인: 한 오르빗 ≈ 6핸드, 한도 2오르빗 = 12핸드
    expect(shouldRemoveForMissedBlinds(11, 6)).toBe(false);
    expect(shouldRemoveForMissedBlinds(12, 6)).toBe(true);
    expect(shouldRemoveForMissedBlinds(20, 6)).toBe(true);
  });

  it('헤즈업(2인)은 오르빗이 2핸드 — 4핸드면 정리', () => {
    expect(shouldRemoveForMissedBlinds(3, 2)).toBe(false);
    expect(shouldRemoveForMissedBlinds(4, 2)).toBe(true);
  });

  it('orbitSize 하한은 2 — 비정상 입력(0/1)도 헤즈업으로 취급', () => {
    expect(shouldRemoveForMissedBlinds(3, 0)).toBe(false);
    expect(shouldRemoveForMissedBlinds(4, 1)).toBe(true);
  });

  it('자리비움 직후(경과 0핸드)에는 정리하지 않는다', () => {
    expect(shouldRemoveForMissedBlinds(0, 6)).toBe(false);
    expect(shouldRemoveForMissedBlinds(0, 2)).toBe(false);
  });

  it('한도 상수는 2 (미납 빅블라인드 2회)', () => {
    expect(SITOUT_MISSED_BB_LIMIT).toBe(2);
  });

  it('오르빗 한도를 넘겨도 벽시계 하한 전에는 정리하지 않는다 (봇 폴드-페스트 방어)', () => {
    // 봇만 남은 3인 테이블: 6핸드가 20~40초 만에 지나간다 — 2026-07-22 QA에서 좌석 소멸 8회
    expect(shouldRemoveForMissedBlinds(6, 3, SITOUT_MIN_WALL_MS - 1)).toBe(false);
    expect(shouldRemoveForMissedBlinds(6, 3, SITOUT_MIN_WALL_MS)).toBe(true);
  });

  it('벽시계만 지나고 오르빗 한도 미달이면 정리하지 않는다', () => {
    expect(shouldRemoveForMissedBlinds(5, 3, SITOUT_MIN_WALL_MS * 10)).toBe(false);
  });

  it('핫 컨피그 주입 한도가 기본 상수를 대체한다', () => {
    // 한도를 3오르빗으로 상향 — 기본(2)이면 정리됐을 6핸드/3인이 아직 아님
    expect(shouldRemoveForMissedBlinds(6, 3, SITOUT_MIN_WALL_MS, { missedBbLimit: 3 })).toBe(false);
    expect(shouldRemoveForMissedBlinds(9, 3, SITOUT_MIN_WALL_MS, { missedBbLimit: 3 })).toBe(true);
    // 벽시계 하한 상향 — 기본(120초)이면 통과했을 시간이 아직 아님
    expect(shouldRemoveForMissedBlinds(6, 3, SITOUT_MIN_WALL_MS, { minWallMs: SITOUT_MIN_WALL_MS * 2 }))
      .toBe(false);
  });

  it('타임스탬프 미지정(구 상태)이면 오르빗 조건 단독으로 판정한다', () => {
    expect(shouldRemoveForMissedBlinds(12, 6)).toBe(true);
  });
});
