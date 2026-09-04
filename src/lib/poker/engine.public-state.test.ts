import { describe, expect, it } from 'vitest';
import { createBotWithCharacter } from '../bot/bot-manager';
import { setupTable } from './test-helpers';

describe('PokerEngine public player projection', () => {
  it('removes personalityId without mutating or aliasing the internal bot', () => {
    const { engine } = setupTable([1_000]);
    const bot = createBotWithCharacter(1, 1_000, 'sakura', 'easy')!;
    bot.holeCards = [
      { suit: 'spades', rank: 'A' },
      { suit: 'hearts', rank: 'K' },
    ];
    expect(engine.addPlayer(bot)).toBe(true);
    engine.state.communityCards = [
      { suit: 'clubs', rank: 'Q' },
      { suit: 'diamonds', rank: 'J' },
      { suit: 'spades', rank: '10' },
    ];

    const publicState = engine.getPublicState(bot.id);
    const publicBot = publicState.players.find(player => player.id === bot.id)!;

    expect(Object.hasOwn(publicBot, 'personalityId')).toBe(false);
    expect(JSON.stringify(publicState)).not.toContain('personalityId');
    expect(publicState).not.toBe(engine.state);
    expect(publicBot).not.toBe(bot);
    expect(publicBot.holeCards).not.toBe(bot.holeCards);
    expect(publicState.communityCards).not.toBe(engine.state.communityCards);
    expect(publicState.communityCards[0]).not.toBe(engine.state.communityCards[0]);

    publicBot.name = '변경된 공개 이름';
    publicBot.holeCards[0].rank = '2';
    publicState.communityCards[0].rank = '3';
    expect(bot.name).toBe('사쿠라');
    expect(bot.holeCards[0].rank).toBe('A');
    expect(bot.personalityId).toBe('sakura');
    expect(engine.state.communityCards[0].rank).toBe('Q');
  });
});
