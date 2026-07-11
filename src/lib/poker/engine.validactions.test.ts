import { describe, it, expect } from 'vitest';
import { PokerEngine } from './engine';
import { makePlayer } from './test-helpers';
import { RoomConfig } from './types';

/**
 * getValidActions: 응수할 상대가 없으면(전원 올인) 레이즈/올인은 데드 액션 — 콜/폴드만.
 * (상대 올인을 커버하는 스택인데 레이즈/올인 버튼이 노출되던 버그의 회귀 테스트)
 */

const CONFIG: RoomConfig = {
  name: 'test', smallBlind: 10, bigBlind: 20,
  minBuyIn: 800, maxBuyIn: 4000, maxPlayers: 6, turnTime: 8,
};

function setupHeadsUp(villainStatus: 'all-in' | 'active', villainChips: number) {
  const engine = new PokerEngine(CONFIG, 'room-test');
  const hero = makePlayer('hero', 5000, 0, { status: 'active' });
  const villain = makePlayer('villain', villainChips, 1, {
    status: villainStatus, currentBet: 1000, totalContributed: 1000,
  });
  engine.addPlayer(hero);
  engine.addPlayer(villain);
  engine.state.isHandInProgress = true;
  engine.state.currentBet = 1000;
  engine.state.minRaise = 1000;
  return { engine, hero };
}

describe('getValidActions: 상대 전원 올인이면 콜/폴드만', () => {
  it('헤즈업에서 상대가 올인하면 내가 커버해도 레이즈/올인이 제공되지 않는다', () => {
    const { engine, hero } = setupHeadsUp('all-in', 0);
    const actions = engine.getValidActions(hero);
    expect(actions).toContain('fold');
    expect(actions).toContain('call');
    expect(actions).not.toContain('raise');
    expect(actions).not.toContain('all-in');
  });

  it('상대가 아직 active면(올인 아님) 레이즈/올인이 제공된다', () => {
    const { engine, hero } = setupHeadsUp('active', 2000);
    const actions = engine.getValidActions(hero);
    expect(actions).toContain('raise');
    expect(actions).toContain('all-in');
  });

  it('멀티웨이에서 한 명이라도 active가 남아 있으면 레이즈 가능', () => {
    const { engine, hero } = setupHeadsUp('all-in', 0);
    const third = makePlayer('third', 3000, 2, { status: 'active', currentBet: 1000, totalContributed: 1000 });
    engine.addPlayer(third);
    const actions = engine.getValidActions(hero);
    expect(actions).toContain('raise');
    expect(actions).toContain('all-in');
  });
});
