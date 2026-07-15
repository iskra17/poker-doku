import { describe, it, expect } from 'vitest';
import { shouldRemoveForMissedBlinds, SITOUT_MISSED_BB_LIMIT } from './sitout';

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
});
