import { describe, expect, it } from 'vitest';
import {
  parseWeeklyDojoCheckpoint,
  serializeWeeklyDojoCheckpoint,
  type WeeklyDojoCheckpoint,
} from './checkpoint';

/**
 * 경계 스냅샷 파서 회귀 — 재개 복원의 유일한 입력이라 방어적으로 읽어야 한다.
 * 깨진 스냅샷을 "빈 값"으로 통과시키면 봇이 시작 스택으로 리필돼 칩 풀이 리셋된다.
 */

const VALID: WeeklyDojoCheckpoint = {
  v: 1,
  lineupVersion: 'wd-v1',
  dealerSeatIndex: 3,
  heroChips: 1_850,
  seats: [
    { seatIndex: 1, characterId: 'mochi', chips: 2_010 },
    { seatIndex: 2, characterId: 'choco', chips: 1_990 },
    { seatIndex: 3, characterId: 'luna', chips: 2_100 },
    { seatIndex: 4, characterId: 'gumi', chips: 2_050 },
    { seatIndex: 5, characterId: 'paeng', chips: 2_000 },
  ],
};

describe('weekly dojo checkpoint', () => {
  it('round-trips a boundary snapshot', () => {
    expect(parseWeeklyDojoCheckpoint(serializeWeeklyDojoCheckpoint(VALID))).toEqual(VALID);
  });

  it('keeps a busted bot seat (a resume must not refund it)', () => {
    const busted: WeeklyDojoCheckpoint = {
      ...VALID,
      seats: VALID.seats.map((seat, index) => (index === 0 ? { ...seat, chips: 0 } : seat)),
    };
    const parsed = parseWeeklyDojoCheckpoint(serializeWeeklyDojoCheckpoint(busted));
    expect(parsed?.seats[0].chips).toBe(0);
  });

  it('rejects anything it cannot restore faithfully', () => {
    const json = (value: unknown) => JSON.stringify(value);
    expect(parseWeeklyDojoCheckpoint(null)).toBeNull();
    expect(parseWeeklyDojoCheckpoint('')).toBeNull();
    expect(parseWeeklyDojoCheckpoint('not json')).toBeNull();
    expect(parseWeeklyDojoCheckpoint(json([1, 2]))).toBeNull();
    expect(parseWeeklyDojoCheckpoint(json({ ...VALID, v: 2 }))).toBeNull();
    expect(parseWeeklyDojoCheckpoint(json({ ...VALID, lineupVersion: '' }))).toBeNull();
    expect(parseWeeklyDojoCheckpoint(json({ ...VALID, dealerSeatIndex: 9 }))).toBeNull();
    expect(parseWeeklyDojoCheckpoint(json({ ...VALID, heroChips: -1 }))).toBeNull();
    expect(parseWeeklyDojoCheckpoint(json({ ...VALID, heroChips: 12.5 }))).toBeNull();
    // 좌석 수가 라인업과 다르면 복원할 수 없다
    expect(parseWeeklyDojoCheckpoint(json({ ...VALID, seats: VALID.seats.slice(1) }))).toBeNull();
    // 좌석 중복은 한 자리를 두 번 채우게 된다
    expect(parseWeeklyDojoCheckpoint(json({
      ...VALID,
      seats: VALID.seats.map(seat => ({ ...seat, seatIndex: 1 })),
    }))).toBeNull();
    expect(parseWeeklyDojoCheckpoint(json({
      ...VALID,
      seats: VALID.seats.map((seat, index) => (index === 0 ? { ...seat, chips: 'x' } : seat)),
    }))).toBeNull();
  });
});
