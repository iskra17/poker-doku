import { describe, it, expect } from 'vitest';
import { setupTable, act, actor, totalStacks } from './test-helpers';

/**
 * 핸드 중 이탈 처리 테스트 (버그 D).
 * 원칙: 핸드 진행 중 splice 금지 — 폴드 + pendingRemoval, 다음 핸드 시작 시 일괄 제거.
 * 테이블: 블라인드 10/20, 딜러 p1. 3인: SB p2, BB p3, UTG p1.
 */

describe('핸드 중 이탈 — processLeave', () => {
  it('자기 턴에 이탈하면 폴드 처리되고 턴이 다음 플레이어로 넘어간다', () => {
    const { engine } = setupTable([1000, 1000, 1000]);
    engine.startHand();

    expect(actor(engine).id).toBe('p1'); // UTG
    const { player, handComplete } = engine.processLeave('p1');

    expect(player?.id).toBe('p1');
    expect(handComplete).toBe(false);
    expect(engine.state.isHandInProgress).toBe(true);

    const p1 = engine.state.players.find(p => p.id === 'p1')!;
    expect(p1.status).toBe('folded');
    expect(p1.pendingRemoval).toBe(true);
    // 좌석은 유지된다 (splice 금지)
    expect(engine.state.players).toHaveLength(3);
    // 턴은 다음 액티브 플레이어(p2)로
    expect(actor(engine).id).toBe('p2');
  });

  it('자기 턴이 아닌 플레이어가 이탈해도 현재 액터의 턴이 유지된다', () => {
    const { engine } = setupTable([1000, 1000, 1000]);
    engine.startHand();

    act(engine, 'call'); // p1 콜 → p2 턴
    expect(actor(engine).id).toBe('p2');

    // p3(비 액터) 이탈
    const { handComplete } = engine.processLeave('p3');
    expect(handComplete).toBe(false);
    expect(actor(engine).id).toBe('p2'); // 턴 유지

    // p2 콜하면 라운드 완료 → 플랍 (p3는 이미 폴드)
    act(engine, 'call');
    expect(engine.state.street).toBe('flop');
  });

  it('마지막 상대가 이탈하면 핸드가 즉시 종료되고 팟이 지급된다', () => {
    const { engine, initialTotal } = setupTable([1000, 1000]);
    engine.startHand();

    // 헤즈업: p1 = 딜러/SB(액터), p2 = BB
    const { handComplete } = engine.processLeave('p2');

    expect(handComplete).toBe(true);
    expect(engine.state.isHandInProgress).toBe(false);
    expect(engine.state.winners).toHaveLength(1);
    expect(engine.state.winners![0].playerId).toBe('p1');

    // p1이 블라인드 팟(30) 수령: 1000 - 10 + 30 = 1020
    const p1 = engine.state.players.find(p => p.id === 'p1')!;
    expect(p1.chips).toBe(1020);
    expect(totalStacks(engine)).toBe(initialTotal);
  });

  it('올인 상태로 이탈한 플레이어의 기여금은 dead money로 팟에 남는다', () => {
    const { engine, initialTotal } = setupTable(
      [1000, 1000, 150],
      '2h 3d  As Ah  Kc Kd  7s 8d 2c  4h  9s',
    );
    engine.startHand();

    // 프리플랍: 전원 콜/체크 → 팟 60
    act(engine, 'call');
    act(engine, 'call');
    act(engine, 'check');
    expect(engine.state.street).toBe('flop');

    // 플랍: p2 벳 100 → p3 올인 130 (레이즈 시도는 minRaise 미달 스택이라 all-in 액션으로) → p1 턴
    act(engine, 'raise', 100);
    expect(act(engine, 'all-in').valid).toBe(true);
    expect(engine.state.players.find(p => p.id === 'p3')!.status).toBe('all-in');
    expect(actor(engine).id).toBe('p1');

    // 올인 상태의 p3가 이탈 (비 액터)
    engine.processLeave('p3');
    expect(engine.state.players.find(p => p.id === 'p3')!.status).toBe('folded');

    // p1 폴드 → p2 단독 생존 → 핸드 종료, p3의 150은 dead money로 p2에게
    const { handComplete } = act(engine, 'fold');
    expect(handComplete).toBe(true);

    const p2 = engine.state.players.find(p => p.id === 'p2')!;
    // 1000 - 20(프리플랍) - 100(플랍) + 290(팟: 60+100+130) = 1170
    expect(p2.chips).toBe(1170);
    expect(totalStacks(engine)).toBe(initialTotal);
  });

  it('다음 핸드 시작 시 이탈자가 제거되고 게임이 정상 진행된다', () => {
    const { engine } = setupTable([1000, 1000, 1000]);
    engine.startHand();

    engine.processLeave('p1'); // UTG 이탈
    // 핸드 마무리: p2 콜, p3 체크 → 플랍 → 체크다운
    act(engine, 'call');
    act(engine, 'check');
    while (engine.state.isHandInProgress) {
      act(engine, 'check');
    }
    expect(engine.state.players).toHaveLength(3); // 아직 좌석 유지

    // 다음 핸드 시작 → 이탈자 splice
    engine.startHand();
    expect(engine.state.players).toHaveLength(2);
    expect(engine.state.players.find(p => p.id === 'p1')).toBeUndefined();
    expect(engine.state.isHandInProgress).toBe(true);
    expect(engine.state.dealerIndex).toBeGreaterThanOrEqual(0);
    expect(engine.state.dealerIndex).toBeLessThan(2);
    expect(engine.state.activePlayerIndex).toBeGreaterThanOrEqual(0);
  });

  it('핸드 미진행 중 이탈은 즉시 제거된다', () => {
    const { engine } = setupTable([1000, 1000, 1000]);

    const { player } = engine.processLeave('p2');
    expect(player?.id).toBe('p2');
    expect(engine.state.players).toHaveLength(2);
    expect(engine.state.players.find(p => p.id === 'p2')).toBeUndefined();
  });

  it('이탈로 베팅 라운드가 완료되면 스트리트가 전진한다', () => {
    const { engine } = setupTable([1000, 1000, 1000]);
    engine.startHand();

    // p1 콜, p2 콜 → p3(BB) 턴. p3가 이탈하면 라운드 완료 → 플랍
    act(engine, 'call');
    act(engine, 'call');
    expect(actor(engine).id).toBe('p3');

    const { handComplete } = engine.processLeave('p3');
    expect(handComplete).toBe(false);
    expect(engine.state.street).toBe('flop');
    expect(engine.state.isHandInProgress).toBe(true);
    // 플랍 첫 액터는 p2 (딜러 좌측)
    expect(actor(engine).id).toBe('p2');
  });
});
