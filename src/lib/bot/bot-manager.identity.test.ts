import { describe, expect, it } from 'vitest';
import { BOT_CHARACTERS, MASKED_BOT_CHARACTER, getCharacterById } from '../characters';
import { PokerEngine } from '../poker/engine';
import type { RoomConfig } from '../poker/types';
import { createBotWithCharacter, getUsedCharacterIds } from './bot-manager';

const CONFIG: RoomConfig = {
  name: 'identity test', smallBlind: 10, bigBlind: 20,
  minBuyIn: 100, maxBuyIn: 2_000, maxPlayers: 6,
  turnTime: 30, gameMode: 'cash', economyMode: 'practice',
};

describe('bot behavior/display identity', () => {
  it('keeps the real personality while publishing the requested display identity', () => {
    const bot = createBotWithCharacter(1, 2_000, 'sakura', 'easy', {
      name: '수상한 도전자',
      characterId: 'story-mask',
    })!;

    expect(bot).toMatchObject({
      name: '수상한 도전자',
      avatar: 'story-mask',
      personalityId: 'sakura',
    });
    expect(bot.id).toMatch(/^bot-[0-9a-f-]{36}$/);
    expect(bot.id).not.toContain('sakura');
  });

  it('rejects invalid display identities and the display-only mask as a behavior character', () => {
    expect(createBotWithCharacter(1, 2_000, 'sakura', 'easy', {
      name: '   ', characterId: 'story-mask',
    })).toBeNull();
    expect(createBotWithCharacter(1, 2_000, 'sakura', 'easy', {
      name: '가면', characterId: 'missing-character',
    })).toBeNull();
    expect(createBotWithCharacter(1, 2_000, 'story-mask', 'easy')).toBeNull();
  });

  it('registers the mask for presentation without adding it to random bot candidates', () => {
    expect(getCharacterById('story-mask')).toBe(MASKED_BOT_CHARACTER);
    expect(BOT_CHARACTERS.some(character => character.id === 'story-mask')).toBe(false);
  });

  it('deduplicates masked bots by their real personality, not their shared avatar', () => {
    const engine = new PokerEngine(CONFIG, 'identity-room');
    const display = { name: '가면 도전자', characterId: 'story-mask' };
    expect(engine.addPlayer(createBotWithCharacter(1, 2_000, 'sakura', 'easy', display)!)).toBe(true);
    expect(engine.addPlayer(createBotWithCharacter(2, 2_000, 'ara', 'easy', display)!)).toBe(true);

    expect(getUsedCharacterIds(engine)).toEqual(['sakura', 'ara']);
  });
});
