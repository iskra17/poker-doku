import { describe, it, expect } from 'vitest';
import { setupTable, act, actor, totalTableChips, completeRunout } from './test-helpers';

/**
 * 빅블라인드 앤티 (MTT) — BB 좌석이 테이블 몫을 일괄 납부하는 현대 표준.
 * 앤티는 currentBet에 포함되지 않는 dead money이며(totalContributed에만 반영),
 * 스택 부족 시 앤티 우선 공제 후 올인된다 (TDA 순서).
 */
describe('big blind ante', () => {
  it('BB posts ante + blind; ante is not part of currentBet', () => {
    const { engine } = setupTable([1000, 1000, 1000], undefined, {
      gameMode: 'mtt',
      ante: 20,
    });
    engine.startHand();

    // p1 딜러, p2 SB, p3 BB
    const bb = engine.state.players.find(p => p.id === engine.state.bigBlindId)!;
    expect(bb.id).toBe('p3');
    expect(bb.chips).toBe(1000 - 20 - 20); // 앤티 20 + 블라인드 20
    expect(bb.currentBet).toBe(20); // 앤티는 currentBet 미포함
    expect(bb.totalContributed).toBe(40);
    expect(engine.state.currentBet).toBe(20);

    // 팟 = SB 10 + BB 20 + 앤티 20
    const potTotal = engine.state.pots.reduce((s, p) => s + p.amount, 0);
    expect(potTotal).toBe(50);
  });

  it('conserves chips through a full hand with ante', () => {
    const { engine, initialTotal } = setupTable([1000, 1000, 1000], undefined, {
      gameMode: 'mtt',
      ante: 20,
    });
    engine.startHand();
    expect(totalTableChips(engine)).toBe(initialTotal);

    // UTG(p1) 콜 → SB 콜 → BB 체크 → 이후 전원 체크로 쇼다운
    while (engine.state.isHandInProgress && !engine.state.allInRunout) {
      const a = actor(engine);
      const valid = engine.getValidActions(a);
      act(engine, valid.includes('check') ? 'check' : 'call');
    }
    completeRunout(engine);
    expect(engine.state.isHandInProgress).toBe(false);
    const stacks = engine.state.players.reduce((s, p) => s + p.chips, 0);
    expect(stacks).toBe(initialTotal);
  });

  it('short BB goes all-in on ante alone and stays dealt in', () => {
    // BB(p3) 스택 15 < 앤티 20 → 앤티로 전액 올인, 블라인드는 못 냄
    const { engine } = setupTable([1000, 1000, 15], undefined, {
      gameMode: 'mtt',
      ante: 20,
    });
    engine.startHand();

    const bb = engine.state.players.find(p => p.id === 'p3')!;
    expect(bb.status).toBe('all-in');
    expect(bb.totalContributed).toBe(15);
    expect(bb.currentBet).toBe(0);
    expect(bb.holeCards.length).toBe(2); // 딜인 유지
    expect(engine.state.currentBet).toBe(20); // BB 금액은 테이블 벳으로 유지
  });

  it('BB covering ante but not full blind creates correct side pot cap', () => {
    // BB(p3) 스택 30: 앤티 20 → 블라인드 10만 → 올인 (totalContributed 30)
    const { engine } = setupTable([1000, 1000, 30], undefined, {
      gameMode: 'mtt',
      ante: 20,
    });
    engine.startHand();

    const bb = engine.state.players.find(p => p.id === 'p3')!;
    expect(bb.status).toBe('all-in');
    expect(bb.currentBet).toBe(10);
    expect(bb.totalContributed).toBe(30);

    // p1(UTG) 콜 20, p2(SB) 콜 → 프리플랍 종료
    act(engine, 'call');
    act(engine, 'call');

    // 팟 계층: 메인 = 라이브 10×3 + dead 앤티 20 = 50 (전원 자격),
    // 사이드 = p1/p2의 초과 라이브 10×2 = 20 (BB 제외).
    // totalContributed(30)로 캡을 잘랐다면 BB만 자격인 팟에 70이 전부 들어갔을 것.
    expect(engine.state.pots.map(p => p.amount)).toEqual([50, 20]);
    expect(engine.state.pots[0].eligiblePlayerIds).toContain('p3');
    expect(engine.state.pots[1].eligiblePlayerIds).not.toContain('p3');
    expect(engine.state.pots[1].eligiblePlayerIds).toEqual(
      expect.arrayContaining(['p1', 'p2']),
    );

    // 남은 두 명이 체크다운 → 정산 후 칩 보존
    while (engine.state.isHandInProgress && !engine.state.allInRunout) {
      act(engine, 'check');
    }
    completeRunout(engine);
    expect(engine.state.isHandInProgress).toBe(false);
    const stacks = engine.state.players.reduce((s, p) => s + p.chips, 0);
    expect(stacks).toBe(2030);
  });

  it('ante-only all-in BB is eligible only for the dead-money main pot', () => {
    // BB(p3) 스택 15 < 앤티 20 → 라이브 기여 0. 메인 팟(dead 15)만 자격.
    const { engine } = setupTable([1000, 1000, 15], undefined, {
      gameMode: 'mtt',
      ante: 20,
    });
    engine.startHand();
    act(engine, 'call'); // p1 콜 20
    act(engine, 'call'); // p2 SB 콜
    const [main, side] = engine.state.pots;
    expect(main.amount).toBe(15); // dead 앤티만
    expect(main.eligiblePlayerIds).toContain('p3');
    expect(side.amount).toBe(40); // p1/p2 라이브 20×2
    expect(side.eligiblePlayerIds).not.toContain('p3');
  });

  it('heads-up: BB posts ante too', () => {
    const { engine } = setupTable([1000, 1000], undefined, {
      gameMode: 'mtt',
      ante: 20,
    });
    engine.startHand();
    const bb = engine.state.players.find(p => p.id === engine.state.bigBlindId)!;
    expect(bb.totalContributed).toBe(40);
    const potTotal = engine.state.pots.reduce((s, p) => s + p.amount, 0);
    expect(potTotal).toBe(50); // SB 10 + BB 20 + 앤티 20
  });

  it('records post-ante in hand history before blinds', () => {
    const { engine } = setupTable([1000, 1000, 1000], undefined, {
      gameMode: 'mtt',
      ante: 20,
    });
    engine.startHand();
    // 폴드로 즉시 종료 후 기록 확인
    act(engine, 'fold');
    act(engine, 'fold');
    const record = engine.getCompletedHandRecord()!;
    const kinds = record.actions.map(a => a.kind);
    expect(kinds.indexOf('post-ante')).toBeGreaterThanOrEqual(0);
    expect(kinds.indexOf('post-ante')).toBeLessThan(kinds.indexOf('post-sb'));
    const ante = record.actions.find(a => a.kind === 'post-ante')!;
    expect(ante.playerId).toBe('p3');
    expect(ante.amount).toBe(20);
  });

  it('no ante posted when ante is 0 or unset (SnG/cash unchanged)', () => {
    const { engine } = setupTable([1000, 1000, 1000], undefined, { gameMode: 'sng' });
    engine.startHand();
    const potTotal = engine.state.pots.reduce((s, p) => s + p.amount, 0);
    expect(potTotal).toBe(30); // SB 10 + BB 20만
    act(engine, 'fold');
    act(engine, 'fold');
    const record = engine.getCompletedHandRecord()!;
    expect(record.actions.some(a => a.kind === 'post-ante')).toBe(false);
  });
});
