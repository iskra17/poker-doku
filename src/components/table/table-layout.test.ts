import { describe, expect, it } from 'vitest';
import { BET_DEPTH, BET_POSITIONS, BOARD_DEPTH, BOARD_POS, DEALER_BTN_POSITIONS, FELT_PLANE, POT_DEPTH, POT_POS, SEATS, SEAT_DEPTH, layFlat, projectFelt } from './table-layout';

const num = (value: string) => parseFloat(value);

describe('perspective table layout', () => {
  it('narrows and shortens the far side of the felt plane', () => {
    const near = projectFelt(1, 0);
    const far = projectFelt(1, 1);
    expect(near.scale).toBe(1);
    expect(far.scale).toBeLessThan(near.scale);
    // 원경 레일이 근경보다 좁다 (사다리꼴)
    expect(far.x - 50).toBeLessThan(near.x - 50);
    // 원경 레일은 화면 안, 근경 레일 위쪽
    expect(far.y).toBeGreaterThan(5);
    expect(far.y).toBeLessThan(near.y);
  });

  it('keeps every coordinate on screen', () => {
    for (const pos of [...SEATS, ...BET_POSITIONS, ...DEALER_BTN_POSITIONS, POT_POS, BOARD_POS]) {
      expect(num(pos.x)).toBeGreaterThanOrEqual(0);
      expect(num(pos.x)).toBeLessThanOrEqual(100);
      expect(num(pos.y)).toBeGreaterThanOrEqual(0);
      expect(num(pos.y)).toBeLessThanOrEqual(100);
    }
  });

  it('scales seats by depth: hero in front (>= 1), far seats smaller but readable, mirror symmetric', () => {
    expect(SEAT_DEPTH[0]).toBeGreaterThanOrEqual(1);
    expect(SEAT_DEPTH[1]).toBeLessThan(SEAT_DEPTH[0]);
    expect(SEAT_DEPTH[3]).toBeLessThan(SEAT_DEPTH[2]);
    expect(SEAT_DEPTH[2]).toBeLessThan(SEAT_DEPTH[1]);
    expect(Math.min(...SEAT_DEPTH)).toBeGreaterThanOrEqual(0.72);
    expect(SEAT_DEPTH[1]).toBe(SEAT_DEPTH[5]);
    expect(SEAT_DEPTH[2]).toBe(SEAT_DEPTH[4]);
  });

  it('places each bet between its seat and the board, and keeps the pot above the board', () => {
    for (const slot of [1, 2, 4, 5]) {
      const seatX = num(SEATS[slot].x);
      const betX = num(BET_POSITIONS[slot].x);
      expect(Math.abs(betX - 50)).toBeLessThan(Math.abs(seatX - 50));
    }
    expect(num(BET_POSITIONS[0].y)).toBeLessThan(num(SEATS[0].y));
    expect(num(BET_POSITIONS[3].y)).toBeGreaterThan(num(SEATS[3].y));
    expect(num(POT_POS.y)).toBeLessThan(num(BOARD_POS.y));
  });

  it('puts the hero in the foreground below the near rail and lays felt objects flat with the plane', () => {
    expect(num(SEATS[0].y)).toBeGreaterThan(FELT_PLANE.bottom * 100);
    // 먼 물건일수록 작게 (팟·보드는 근경 베팅보다 멀다)
    expect(POT_DEPTH).toBeLessThan(BET_DEPTH[0]);
    expect(BOARD_DEPTH).toBeLessThan(BET_DEPTH[0]);
    expect(BET_DEPTH[3]).toBeLessThan(BET_DEPTH[0]);
    expect(layFlat(0.8)).toContain(`rotateX(${FELT_PLANE.tiltDeg}deg)`);
  });
});
