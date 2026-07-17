import { describe, it, expect } from 'vitest';
import { setupTable, actor, act, totalStacks, completeRunout } from './test-helpers';

/**
 * 블라인드 포스팅 올인 교착 회귀 테스트.
 * 스택이 블라인드 이하인 플레이어가 블라인드를 내며 올인되면
 * setFirstActor가 올인(액션 불가) 좌석을 첫 액터로 지정해 게임이 멈추던 버그 —
 * "상대방이 생각 중...에서 진행되지 않음" 프리즈의 근본 원인.
 *
 * 올인 런아웃은 단계별 모드(allInRunout)로 전환되므로, 최종 결과 검증은
 * completeRunout으로 즉시 끝까지 진행한 뒤 수행한다 (운영에선 RoomManager가 시간차 딜).
 */

describe('블라인드 올인 핸드가 교착 없이 진행된다', () => {
  it('헤즈업: 딜러(SB)가 블라인드로 올인되면 런아웃 모드 진입 — 핸드가 멈추지 않는다', () => {
    // p1 = 딜러/SB (5칩 < SB 10 → 블라인드 올인), p2 = BB
    const { engine, initialTotal } = setupTable([5, 1000]);
    engine.startHand();

    // BB는 이미 매칭 완료 + 상대는 올인 → 액션할 사람이 없어 단계별 런아웃 모드 진입
    expect(engine.state.isHandInProgress).toBe(true);
    expect(engine.state.allInRunout).toBe(true);
    expect(engine.state.activePlayerIndex).toBe(-1);

    completeRunout(engine);
    expect(engine.state.isHandInProgress).toBe(false);
    expect(engine.state.winners).not.toBeNull();
    expect(engine.state.communityCards).toHaveLength(5);
    expect(totalStacks(engine)).toBe(initialTotal);
  });

  it('헤즈업: 양쪽 모두 블라인드로 올인 — 첫 액터 없이 런아웃 진행', () => {
    const { engine, initialTotal } = setupTable([5, 15]);
    engine.startHand();

    expect(engine.state.allInRunout).toBe(true);
    completeRunout(engine);
    expect(engine.state.isHandInProgress).toBe(false);
    expect(engine.state.winners).not.toBeNull();
    expect(totalStacks(engine)).toBe(initialTotal);
  });

  it('헤즈업: BB가 숏올인이어도 딜러(SB)는 정상적으로 액션한다', () => {
    // p2 = BB 15칩 (< BB 20 → 숏 올인), p1 = 딜러/SB는 액션 가능
    const { engine } = setupTable([1000, 15]);
    engine.startHand();

    expect(engine.state.isHandInProgress).toBe(true);
    expect(actor(engine).id).toBe('p1');
    expect(actor(engine).status).toBe('active');
    // 상대 전원 올인 → 레이즈/올인 없이 콜/폴드만
    const actions = engine.getValidActions(actor(engine));
    expect(actions).not.toContain('raise');
    expect(actions).not.toContain('all-in');

    // 콜하면 베팅 라운드 완결 → 런아웃 모드 진입 후 딜 완료 시 핸드 종료
    const result = act(engine, 'call');
    expect(result.valid).toBe(true);
    expect(engine.state.allInRunout).toBe(true);
    completeRunout(engine);
    expect(engine.state.isHandInProgress).toBe(false);
  });

  it('3인: SB가 블라인드 올인이어도 첫 액터는 UTG(딜러)로 올바르게 지정된다', () => {
    // p1 = 딜러(=3인에서 UTG), p2 = SB 5칩(블라인드 올인), p3 = BB
    const { engine } = setupTable([1000, 5, 1000]);
    engine.startHand();

    expect(engine.state.isHandInProgress).toBe(true);
    // 버그 시절엔 올인 SB를 건너뛰고 포지션이 밀려 BB(p3)가 첫 액터가 됐다
    expect(actor(engine).id).toBe('p1');
    expect(actor(engine).status).toBe('active');
  });

  it('3인: SB/BB 모두 블라인드 올인 — 딜러 혼자 남아도 콜/폴드 액션을 받는다', () => {
    const { engine, initialTotal } = setupTable([1000, 5, 15]);
    engine.startHand();

    expect(engine.state.isHandInProgress).toBe(true);
    expect(actor(engine).id).toBe('p1');

    const result = act(engine, 'call');
    expect(result.valid).toBe(true);
    expect(engine.state.allInRunout).toBe(true);
    completeRunout(engine);
    expect(engine.state.isHandInProgress).toBe(false);
    expect(totalStacks(engine)).toBe(initialTotal);
  });
});
