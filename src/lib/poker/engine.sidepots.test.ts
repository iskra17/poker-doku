import { describe, it, expect } from 'vitest';
import { setupTable, act, actor, totalTableChips, totalStacks } from './test-helpers';

/**
 * 사이드팟 회계 테스트.
 * 핵심 불변식: 테이블 전체 칩(스택+팟)은 핸드 어느 시점에도 보존된다.
 *
 * 테이블 구성(setupTable): 블라인드 10/20, 딜러 = p1.
 * 3인: SB = p2, BB = p3, 프리플랍 첫 액션 = p1(딜러=UTG), 포스트플랍 첫 액션 = p2.
 */

describe('사이드팟 — 단일 스트리트 (기존에도 정상이던 케이스)', () => {
  it('프리플랍 불균등 올인 3인: 팟 계층과 금액이 정확하다', () => {
    // p1 1000, p2 1000, p3 150 (숏스택)
    const { engine, initialTotal } = setupTable(
      [1000, 1000, 150],
      'As Ah Kd Kc 7h 7d  2c 8s 9d  4h  Js',
    );
    engine.startHand();

    // p1 올인 1000, p2 콜(올인 아님? p2도 1000이므로 콜하면 올인), p3 콜 130 올인
    expect(actor(engine).id).toBe('p1');
    act(engine, 'all-in');
    expect(actor(engine).id).toBe('p2');
    act(engine, 'call'); // 1000 매치 → 올인
    // p3 콜 (150 전부)
    const res = act(engine, 'call');

    expect(res.valid).toBe(true);
    // 전원 올인 → 런아웃 → 쇼다운
    expect(engine.state.street).toBe('showdown');
    expect(totalStacks(engine)).toBe(initialTotal);
  });
});

describe('사이드팟 — 멀티 스트리트 (버그 A 재현)', () => {
  it('프리플랍 팟 + 플랍 불균등 올인: 이전 스트리트 기여금이 소실되지 않는다', () => {
    // p1 1000, p2 1000, p3 150
    // 프리플랍: 전원 콜 20 → 팟 60
    // 플랍: p2 벳 200, p3 콜 올인(130), p1 폴드
    // 올바른 팟 총액: 60 + 200 + 130 = 390
    const { engine, initialTotal } = setupTable(
      [1000, 1000, 150],
      '2h 3d  As Ah  Kc Kd  7s 8d 2c  4h  9s',
    );
    engine.startHand();

    // 프리플랍: p1 콜 20, p2 콜(+10), p3 체크(BB 옵션)
    expect(actor(engine).id).toBe('p1');
    act(engine, 'call');
    act(engine, 'call');
    act(engine, 'check');

    expect(engine.state.street).toBe('flop');
    const potAfterPreflop = engine.state.pots.reduce((s, p) => s + p.amount, 0);
    expect(potAfterPreflop).toBe(60);

    // 플랍: p2 첫 액션 (딜러 p1의 좌측)
    expect(actor(engine).id).toBe('p2');
    act(engine, 'raise', 200); // 벳 200
    expect(actor(engine).id).toBe('p3');
    // 언더콜 올인은 call로 처리된다 (스택이 콜 금액에 못 미치면 있는 만큼 올인)
    const allInRes = act(engine, 'call');
    expect(allInRes.valid).toBe(true);
    expect(engine.state.players.find(p => p.id === 'p3')!.status).toBe('all-in');

    // 핸드 진행 중 (p1 액션 전): 팟 총액은 60(프리플랍) + 200 + 130 = 390이어야 한다
    const potTotal = engine.state.pots.reduce((s, p) => s + p.amount, 0);
    expect(potTotal).toBe(390);
    // 칩 보존: 스택 + 팟 = 시작 총액
    expect(totalTableChips(engine)).toBe(initialTotal);

    act(engine, 'fold'); // p1 폴드 → 라운드 완료 → 런아웃 → 쇼다운

    // 쇼다운 후 스택 총합 보존 (팟은 표시용으로 유지되므로 스택만 검증)
    expect(engine.state.street).toBe('showdown');
    expect(totalStacks(engine)).toBe(initialTotal);

    // p2(AA)가 메인+사이드 전부 수령: 1000 - 220 + 390 = 1170
    const p2 = engine.state.players.find(p => p.id === 'p2')!;
    expect(p2.chips).toBe(1170);
  });

  it('턴에서의 불균등 올인도 프리플랍+플랍 기여금을 보존한다', () => {
    // p1 1000, p2 1000, p3 300
    const { engine, initialTotal } = setupTable(
      [1000, 1000, 300],
      'As Ah  Kd Kc  Qh Qd  2c 8s 9d  4h  Js',
    );
    engine.startHand();

    // 프리플랍: 전원 콜 20 → 팟 60
    act(engine, 'call');
    act(engine, 'call');
    act(engine, 'check');
    expect(engine.state.street).toBe('flop');

    // 플랍: 전원 체크 (p2 → p3 → p1)
    act(engine, 'check');
    act(engine, 'check');
    act(engine, 'check');
    expect(engine.state.street).toBe('turn');

    // 턴: p2 벳 500, p3 콜 올인 280(언더콜), p1 폴드
    act(engine, 'raise', 500);
    const allInRes = act(engine, 'call');
    expect(allInRes.valid).toBe(true);
    expect(engine.state.players.find(p => p.id === 'p3')!.status).toBe('all-in');

    // 핸드 진행 중: 팟 총액 = 60 + 500 + 280 = 840
    const potTotal = engine.state.pots.reduce((s, p) => s + p.amount, 0);
    expect(potTotal).toBe(840);
    expect(totalTableChips(engine)).toBe(initialTotal);

    act(engine, 'fold'); // → 런아웃 → 쇼다운
    expect(engine.state.street).toBe('showdown');
    expect(totalStacks(engine)).toBe(initialTotal);
  });

  it('폴드한 플레이어의 기여금(dead money)도 팟에 포함된다', () => {
    // p1 1000, p2 1000, p3 150
    // 프리플랍: p1 레이즈 100, p2 콜, p3 폴드(BB 20 dead) → 팟 220
    // 플랍: p2 올인 900, p1 콜 → 팟 220 + 1800 = 2020
    const { engine, initialTotal } = setupTable(
      [1000, 1000, 150],
      'As Ah  Kd Kc  2h 3d  7s 8d 2c  4h  9s',
    );
    engine.startHand();

    act(engine, 'raise', 100); // p1
    act(engine, 'call'); // p2
    act(engine, 'fold'); // p3 (BB 20은 dead money)
    expect(engine.state.street).toBe('flop');

    act(engine, 'all-in'); // p2 (900 잔여)
    const res = act(engine, 'call'); // p1
    expect(res.valid).toBe(true);

    expect(engine.state.street).toBe('showdown');
    expect(totalStacks(engine)).toBe(initialTotal);
    // p1(AA) 승리: 1000 - 1000 + 2020 = 2020
    const p1 = engine.state.players.find(p => p.id === 'p1')!;
    expect(p1.chips).toBe(2020);
  });

  it('스플릿 팟: 동점 시 팟을 나누고 홀수 칩도 소실되지 않는다', () => {
    // 보드 플레이 (보드가 최강) → p1/p2 스플릿
    const { engine, initialTotal } = setupTable(
      [1000, 1000],
      '2h 3d  2s 3c  As Ks Qs  Js  Ts',
    );
    engine.startHand();

    // 헤즈업: 딜러 p1이 SB(10), p2가 BB(20). 프리플랍 첫 액션 p1
    act(engine, 'call');
    act(engine, 'check');
    // 플랍/턴/리버 체크 다운 (포스트플랍 첫 액션 = BB p2... 헤즈업은 딜러가 아닌 쪽부터)
    act(engine, 'check');
    act(engine, 'check');
    act(engine, 'check');
    act(engine, 'check');
    act(engine, 'check');
    act(engine, 'check');

    expect(engine.state.street).toBe('showdown');
    expect(totalStacks(engine)).toBe(initialTotal);
    expect(engine.state.winners).toHaveLength(2);
    // 각자 원금 회복
    expect(engine.state.players[0].chips).toBe(1000);
    expect(engine.state.players[1].chips).toBe(1000);
  });
});
