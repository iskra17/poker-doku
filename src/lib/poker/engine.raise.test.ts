import { describe, it, expect } from 'vitest';
import { setupTable, act, actor, totalTableChips } from './test-helpers';

/**
 * 레이즈 금액 서버 검증 테스트 (버그 B).
 * 테이블: 블라인드 10/20, 딜러 = p1.
 * 헤즈업: p1 = 딜러/SB(프리플랍 첫 액션), p2 = BB.
 */

describe('레이즈 검증 — 악의적/비정상 금액 거부', () => {
  it('currentBet보다 작은 raise 금액은 거부된다 (칩 훔치기 방지)', () => {
    const { engine, initialTotal } = setupTable([1000, 1000]);
    engine.startHand();

    const p1 = actor(engine);
    expect(p1.id).toBe('p1');
    const chipsBefore = p1.chips; // 990 (SB 10 납부 후)

    // p1의 currentBet(10)보다 작은 raise → toAdd 음수 → 칩 증가 시도
    const res = act(engine, 'raise', 5);

    expect(res.valid).toBe(false);
    expect(p1.chips).toBe(chipsBefore); // 칩이 늘어나면 안 됨
    expect(totalTableChips(engine)).toBe(initialTotal);
  });

  it('최소 레이즈 미달 금액은 거부된다 (올인 제외)', () => {
    const { engine } = setupTable([1000, 1000]);
    engine.startHand();

    // currentBet 20, minRaise 20 → 최소 raise total 40. 25는 거부
    const res = act(engine, 'raise', 25);
    expect(res.valid).toBe(false);
  });

  it('NaN/Infinity/음수 금액은 거부된다', () => {
    const { engine, initialTotal } = setupTable([1000, 1000]);
    engine.startHand();

    expect(act(engine, 'raise', NaN).valid).toBe(false);
    expect(act(engine, 'raise', Infinity).valid).toBe(false);
    expect(act(engine, 'raise', -100).valid).toBe(false);
    expect(totalTableChips(engine)).toBe(initialTotal);
  });

  it('스택 초과 raise는 거부된다', () => {
    const { engine } = setupTable([1000, 1000]);
    engine.startHand();

    const res = act(engine, 'raise', 5000);
    expect(res.valid).toBe(false);
  });

  it('정상 최소 레이즈는 허용된다', () => {
    const { engine, initialTotal } = setupTable([1000, 1000]);
    engine.startHand();

    const res = act(engine, 'raise', 40); // currentBet 20 + minRaise 20
    expect(res.valid).toBe(true);
    expect(engine.state.currentBet).toBe(40);
    expect(engine.state.minRaise).toBe(20);
    expect(totalTableChips(engine)).toBe(initialTotal);
  });

  it('소수점 금액은 정수로 처리되거나 거부된다', () => {
    const { engine, initialTotal } = setupTable([1000, 1000]);
    engine.startHand();

    const res = act(engine, 'raise', 40.7);
    if (res.valid) {
      // 허용된다면 반드시 정수로 절사되어야 함
      expect(Number.isInteger(engine.state.currentBet)).toBe(true);
      expect(Number.isInteger(actor(engine).chips) || Number.isInteger(engine.state.players[0].chips)).toBe(true);
    }
    expect(Number.isInteger(totalTableChips(engine))).toBe(true);
    expect(totalTableChips(engine)).toBeLessThanOrEqual(initialTotal);
  });
});

describe('올인 언더레이즈 — 표준 룰', () => {
  it('풀 레이즈 미달 올인은 액션을 재오픈하지 않는다', () => {
    // 3인: p1 1000, p2 1000, p3 50
    // 프리플랍: p1 레이즈 100 → p2 콜 → p3 올인 50(...은 콜 미달이라 별개)
    // 시나리오 변경: p1 레이즈 40 → p3(BB 20, 스택 50)이 올인 50 = 언더레이즈(풀레이즈는 60)
    // → p1/p2는 콜만 가능해야 하고 minRaise는 재오픈되지 않아야 한다
    const { engine } = setupTable([1000, 1000, 50]);
    engine.startHand();

    // p1 UTG 레이즈 40
    expect(act(engine, 'raise', 40).valid).toBe(true);
    // p2 SB 콜
    expect(act(engine, 'call').valid).toBe(true);
    // p3 BB 올인 50 (풀 레이즈는 40+20=60 필요 → 언더레이즈)
    expect(actor(engine).id).toBe('p3');
    expect(act(engine, 'all-in').valid).toBe(true);

    expect(engine.state.currentBet).toBe(50);
    // 언더레이즈 올인은 이미 액션한 플레이어의 hasActed를 리셋하지 않는다
    const p1 = engine.state.players.find(p => p.id === 'p1')!;
    const p2 = engine.state.players.find(p => p.id === 'p2')!;
    expect(p1.hasActed).toBe(true);
    expect(p2.hasActed).toBe(true);
  });
});
