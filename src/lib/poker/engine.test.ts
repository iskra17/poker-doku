import { describe, expect, it } from 'vitest';
import { PokerEngine } from './engine';
import { RoomConfig } from './types';
import { RiggedDeck, act, completeRunout, makePlayer, setupTable, totalStacks } from './test-helpers';

function setupEconomyTable(
  chipCounts: number[],
  configOverrides: Partial<RoomConfig> = {},
  riggedCodes?: string,
) {
  const config: RoomConfig = {
    name: 'Economy Test',
    smallBlind: 10,
    bigBlind: 20,
    minBuyIn: 100,
    maxBuyIn: 10_000,
    maxPlayers: 6,
    turnTime: 30,
    gameMode: 'cash',
    economyMode: 'wallet',
    ...configOverrides,
  };
  const engine = new PokerEngine(
    config,
    'economy-test-room',
    riggedCodes ? new RiggedDeck(riggedCodes) : undefined,
  );
  chipCounts.forEach((chips, index) => {
    engine.addPlayer(makePlayer(`p${index + 1}`, chips, index));
  });
  engine.state.dealerIndex = chipCounts.length - 1;
  return { engine, initialTotal: chipCounts.reduce((sum, chips) => sum + chips, 0) };
}

describe('hand rake state', () => {
  it('starts at zero and is included in public state', () => {
    const { engine } = setupTable([1000, 1000]);

    expect(engine.state).toHaveProperty('handRake', 0);
    expect(engine.getPublicState('p1')).toHaveProperty('handRake', 0);
  });

  it('publishes economy mode without exposing server-only room configuration', () => {
    const { engine } = setupEconomyTable([1_000, 1_000], {
      economyMode: 'practice',
      password: 'server-secret',
    });

    const publicState = engine.getPublicState('p1');

    expect(publicState.economyMode).toBe('practice');
    expect(publicState).not.toHaveProperty('password');
  });

  it('resets before every new hand', () => {
    const { engine } = setupTable([1000, 1000]);
    (engine.state as unknown as { handRake: number }).handRake = 7;

    engine.startHand();

    expect(engine.state).toHaveProperty('handRake', 0);
  });

  it('keeps opponents hole cards masked in public state', () => {
    const { engine } = setupTable([1000, 1000], 'As Ah Kd Kc 2c 3d 4h 5s 6c');
    engine.startHand();

    const publicState = engine.getPublicState('p1');
    const hero = publicState.players.find(player => player.id === 'p1')!;
    const opponent = publicState.players.find(player => player.id === 'p2')!;

    expect(hero.holeCards).toEqual(engine.state.players.find(player => player.id === 'p1')!.holeCards);
    expect(opponent.holeCards).toEqual([
      { suit: 'spades', rank: '2' },
      { suit: 'spades', rank: '2' },
    ]);
    expect(opponent.revealed).toBe(false);
  });
});

describe('wallet cash rake settlement', () => {
  it('does not rake a fold before the flop', () => {
    const { engine, initialTotal } = setupEconomyTable([1000, 1000]);
    engine.startHand();

    act(engine, 'fold');

    expect(engine.state.handRake).toBe(0);
    expect(engine.state.pots.map(pot => pot.amount)).toEqual([30]);
    expect(engine.state.winners?.map(winner => winner.amount)).toEqual([30]);
    expect(totalStacks(engine)).toBe(initialTotal);
  });

  it('rakes five percent from a postflop fold while retaining gross pots', () => {
    const { engine, initialTotal } = setupEconomyTable([1000, 1000]);
    engine.startHand();
    act(engine, 'call');
    act(engine, 'check');

    act(engine, 'fold');

    expect(engine.state.communityCards).toHaveLength(3);
    expect(engine.state.pots.map(pot => pot.amount)).toEqual([40]);
    expect(engine.state.handRake).toBe(2);
    expect(engine.state.winners?.map(winner => winner.amount)).toEqual([38]);
    expect(totalStacks(engine) + engine.state.handRake).toBe(initialTotal);
  });

  it('caps postflop fold rake at five big blinds', () => {
    const { engine, initialTotal } = setupEconomyTable([5000, 5000]);
    engine.startHand();
    act(engine, 'raise', 1000);
    act(engine, 'call');

    act(engine, 'fold');

    expect(engine.state.pots.map(pot => pot.amount)).toEqual([2000]);
    expect(engine.state.handRake).toBe(100);
    expect(engine.state.winners?.map(winner => winner.amount)).toEqual([1900]);
    expect(totalStacks(engine) + engine.state.handRake).toBe(initialTotal);
  });

  it('rakes a preflop all-in after the board runs out', () => {
    const { engine, initialTotal } = setupEconomyTable(
      [1000, 1000],
      {},
      'As Ah Kd Kc 2c 8s 9d 4h Js',
    );
    engine.startHand();

    act(engine, 'all-in');
    act(engine, 'call');
    completeRunout(engine);

    expect(engine.state.communityCards).toHaveLength(5);
    expect(engine.state.pots.map(pot => pot.amount)).toEqual([2000]);
    expect(engine.state.handRake).toBe(100);
    expect(engine.state.winners?.map(winner => winner.amount)).toEqual([1900]);
    expect(totalStacks(engine) + engine.state.handRake).toBe(initialTotal);
  });

  it('resets a completed hand rake when the next hand starts', () => {
    const { engine } = setupEconomyTable([1000, 1000]);
    engine.startHand();
    act(engine, 'call');
    act(engine, 'check');
    act(engine, 'fold');
    expect(engine.state.handRake).toBe(2);

    engine.startHand();

    expect(engine.state.handRake).toBe(0);
  });
});

describe('rake exclusions', () => {
  it.each([
    ['practice cash', { gameMode: 'cash' as const, economyMode: 'practice' as const }],
    ['arena cash', { gameMode: 'cash' as const, economyMode: 'arena' as const }],
    ['cash with undefined economy', { gameMode: 'cash' as const, economyMode: undefined }],
    ['Sit & Go', { gameMode: 'sng' as const, economyMode: 'wallet' as const }],
  ])('pays the full pot in %s', (_label, configOverrides) => {
    const { engine, initialTotal } = setupEconomyTable([1000, 1000], configOverrides);
    engine.startHand();
    act(engine, 'call');
    act(engine, 'check');

    act(engine, 'fold');

    expect(engine.state.handRake).toBe(0);
    expect(engine.state.winners?.map(winner => winner.amount)).toEqual([40]);
    expect(totalStacks(engine)).toBe(initialTotal);
  });
});
