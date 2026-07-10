import { describe, it, expect } from 'vitest';
import { evaluateHand, compareHands } from './evaluator';
import { cards } from './test-helpers';

function evalHand(hole: string, board: string) {
  return evaluateHand(cards(hole), cards(board));
}

describe('evaluateHand — 핸드 랭크 판정', () => {
  it('로열 플러시', () => {
    expect(evalHand('As Ks', 'Qs Js Ts 2h 3d').rank).toBe('royal-flush');
  });

  it('스트레이트 플러시', () => {
    expect(evalHand('9h 8h', '7h 6h 5h Ad Kc').rank).toBe('straight-flush');
  });

  it('포카드', () => {
    expect(evalHand('Ah Ad', 'As Ac 7d 2c 9h').rank).toBe('four-of-a-kind');
  });

  it('풀하우스', () => {
    expect(evalHand('Kh Kd', 'Ks 2c 2d 7h 9s').rank).toBe('full-house');
  });

  it('플러시', () => {
    expect(evalHand('Ah 4h', '9h Jh 2h Kc Qd').rank).toBe('flush');
  });

  it('스트레이트', () => {
    expect(evalHand('9c 8d', '7h 6s 5d Ah 2c').rank).toBe('straight');
  });

  it('휠 스트레이트 (A-2-3-4-5)', () => {
    const hand = evalHand('Ah 2d', '3c 4s 5d Kh 9c');
    expect(hand.rank).toBe('straight');
    // 휠은 5-high — 6-high 스트레이트보다 낮아야 함
    const sixHigh = evalHand('6h 5d', '4c 3s 2d Kh 9c');
    expect(hand.value).toBeLessThan(sixHigh.value);
  });

  it('트리플', () => {
    expect(evalHand('7h 7d', '7s Kc 2d 9h 4s').rank).toBe('three-of-a-kind');
  });

  it('투페어', () => {
    expect(evalHand('Ah Kd', 'As Kc 2d 7h 9s').rank).toBe('two-pair');
  });

  it('원페어', () => {
    expect(evalHand('Ah Ad', 'Kc 2d 7h 9s 4c').rank).toBe('one-pair');
  });

  it('하이카드', () => {
    expect(evalHand('Ah Kd', 'Qc 9d 7h 4s 2c').rank).toBe('high-card');
  });
});

describe('evaluateHand — 킥커/비교', () => {
  it('같은 페어면 킥커로 승부', () => {
    const aceKicker = evalHand('Ah Qd', 'Qc 9d 7h 4s 2c'); // Q페어 + A킥커
    const kingKicker = evalHand('Kh Qd', 'Qc 9d 7h 4s 2c'); // Q페어 + K킥커
    expect(compareHands(aceKicker, kingKicker)).toBeGreaterThan(0);
  });

  it('높은 투페어가 이긴다', () => {
    const acesUp = evalHand('Ah 2d', 'As 2c Kd 7h 9s'); // A+2 투페어
    const kingsUp = evalHand('Kh Qd', 'Ks Qc 3d 7h 9s'); // K+Q 투페어
    expect(compareHands(acesUp, kingsUp)).toBeGreaterThan(0);
  });

  it('보드 플레이 시 동점 (스플릿)', () => {
    // 보드가 로열 플러시 — 두 플레이어 모두 보드 플레이
    const a = evalHand('2h 3d', 'As Ks Qs Js Ts');
    const b = evalHand('4c 5d', 'As Ks Qs Js Ts');
    expect(compareHands(a, b)).toBe(0);
  });

  it('플러시끼리는 최고 카드 순 비교', () => {
    const aceFlush = evalHand('Ah 4h', '9h Jh 2h Kc Qd');
    const kingFlush = evalHand('Kh 4d', '9h Jh 2h 3h Qd');
    expect(compareHands(aceFlush, kingFlush)).toBeGreaterThan(0);
  });

  it('풀하우스는 트리플 우선 비교', () => {
    const acesFull = evalHand('Ah Ad', 'As 2c 2d 7h 9s'); // AAA22
    const kingsFull = evalHand('Kh Kd', 'Ks Qc Qd 7h 9s'); // KKKQQ
    expect(compareHands(acesFull, kingsFull)).toBeGreaterThan(0);
  });
});
