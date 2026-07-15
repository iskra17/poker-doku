import { describe, it, expect } from 'vitest';
import { PokerEngine } from './engine';
import { makePlayer } from './test-helpers';
import { ActionType, RoomConfig } from './types';

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

/**
 * 숏스택 규칙 — 스택이 상대 벳에 못 미치면 콜(=올인 콜)/폴드만.
 * ActionBar가 이 조건을 자체 구현해 어긋난 탓에 "올인 버튼은 보이는데 눌러도 서버가 거부"하는
 * 먹통 버튼이 나왔던 버그의 회귀 테스트. 지금은 양쪽이 computeValidActions를 공유한다.
 */
describe('getValidActions: 숏스택은 콜/폴드만', () => {
  /** 상대(active)가 1000을 벳한 상황에서 내 스택이 heroChips일 때의 유효 액션 */
  function actionsWithStack(heroChips: number): ActionType[] {
    const engine = new PokerEngine(CONFIG, 'room-short');
    const hero = makePlayer('hero', heroChips, 0, { status: 'active' });
    const villain = makePlayer('villain', 4000, 1, {
      status: 'active', currentBet: 1000, totalContributed: 1000,
    });
    engine.addPlayer(hero);
    engine.addPlayer(villain);
    engine.state.isHandInProgress = true;
    engine.state.currentBet = 1000;
    engine.state.minRaise = 1000; // 최소 레이즈 총액 = 2000
    return engine.getValidActions(hero);
  }

  it('스택이 상대 벳보다 적으면 레이즈/올인이 없다 (콜이 곧 올인 콜)', () => {
    const actions = actionsWithStack(500);
    expect(actions).toEqual(expect.arrayContaining(['fold', 'call']));
    expect(actions).not.toContain('raise');
    expect(actions).not.toContain('all-in');
  });

  it('스택이 상대 벳과 정확히 같아도 올인은 제공되지 않는다 (콜과 동일한 액션)', () => {
    const actions = actionsWithStack(1000);
    expect(actions).toContain('call');
    expect(actions).not.toContain('raise');
    expect(actions).not.toContain('all-in');
  });

  it('상대 벳은 넘기지만 최소 레이즈에 못 미치면 올인만 (언더레이즈 올인은 합법)', () => {
    const actions = actionsWithStack(1500);
    expect(actions).toContain('call');
    expect(actions).toContain('all-in');
    expect(actions).not.toContain('raise');
  });

  it('최소 레이즈를 채우면 레이즈/올인 모두 제공', () => {
    const actions = actionsWithStack(2500);
    expect(actions).toContain('raise');
    expect(actions).toContain('all-in');
  });

  it('숏스택 올인을 강행하면 엔진이 거부한다 (클라가 잘못 보내도 서버가 방어)', () => {
    const engine = new PokerEngine(CONFIG, 'room-short2');
    const hero = makePlayer('hero', 500, 0, { status: 'active' });
    const villain = makePlayer('villain', 4000, 1, {
      status: 'active', currentBet: 1000, totalContributed: 1000,
    });
    engine.addPlayer(hero);
    engine.addPlayer(villain);
    engine.state.isHandInProgress = true;
    engine.state.currentBet = 1000;
    engine.state.minRaise = 1000;
    engine.state.activePlayerIndex = 0;

    const result = engine.processAction({ playerId: 'hero', type: 'all-in', amount: 0 });
    expect(result.valid).toBe(false);
    expect(hero.chips).toBe(500); // 칩이 움직이지 않았다
  });
});
