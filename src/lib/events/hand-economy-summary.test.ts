import { describe, expect, it } from 'vitest';
import { diffGameState, type GameEvent } from './game-events';
import type { GameState } from '@/lib/poker/types';
import {
  buildHandEconomySummary,
  formatChipDelta,
} from './hand-economy-summary';

function winnersEvent(
  overrides: Partial<Extract<GameEvent, { type: 'winners' }>> = {},
): Extract<GameEvent, { type: 'winners' }> {
  return {
    type: 'winners',
    winners: [
      { playerId: 'hero', amount: 300, hand: null, potIndex: 0 },
      { playerId: 'hero', amount: 100, hand: null, potIndex: 1 },
    ],
    players: [{
      id: 'hero',
      name: '벚꽃 여우',
      type: 'human',
      avatar: 'sakura',
      chips: 1_250,
      seatIndex: 0,
      holeCards: [],
      currentBet: 0,
      totalContributed: 250,
      status: 'active',
      hasActed: true,
      handStartChips: 1_000,
    }],
    potTotal: 400,
    bigWin: false,
    handRake: 20,
    economyMode: 'wallet',
    handNumber: 4,
    ...overrides,
  };
}

describe('hand economy summary', () => {
  it('derives public rake and economy mode on the winners event', () => {
    const event = winnersEvent();
    const base: GameState = {
      id: 'room-1',
      players: event.players,
      communityCards: [],
      pots: [{ amount: 420, eligiblePlayerIds: ['hero'] }],
      currentBet: 0,
      minRaise: 20,
      street: 'showdown',
      dealerIndex: 0,
      activePlayerIndex: 0,
      smallBlind: 10,
      bigBlind: 20,
      isHandInProgress: true,
      winners: null,
      handRake: 0,
      economyMode: 'wallet',
      lastAction: null,
      turnTimer: 8,
      handNumber: 4,
      actionSeq: 3,
    };
    const next: GameState = {
      ...base,
      isHandInProgress: false,
      winners: event.winners,
      handRake: 20,
    };

    expect(diffGameState(base, next, 'hero')).toContainEqual(expect.objectContaining({
      type: 'winners',
      handNumber: 4,
      handRake: 20,
      economyMode: 'wallet',
    }));
  });

  it('uses ending stack minus hand-start stack regardless of multi-pot winners', () => {
    expect(buildHandEconomySummary(winnersEvent(), 'hero')).toEqual({
      handNumber: 4,
      endingStack: 1_250,
      delta: 250,
      handRake: 20,
      economyMode: 'wallet',
    });
  });

  it('returns null when the current player was removed or lacks a safe starting stack', () => {
    expect(buildHandEconomySummary(winnersEvent(), 'missing')).toBeNull();
    expect(buildHandEconomySummary(winnersEvent({
      players: [{ ...winnersEvent().players[0], handStartChips: undefined }],
    }), 'hero')).toBeNull();
  });

  it('preserves practice mode and formats signed chip changes', () => {
    const event = winnersEvent({
      economyMode: 'practice',
      handRake: 0,
      players: [{ ...winnersEvent().players[0], chips: 750 }],
    });

    expect(buildHandEconomySummary(event, 'hero')).toMatchObject({
      delta: -250,
      economyMode: 'practice',
      handRake: 0,
    });
    expect(formatChipDelta(250)).toBe('+250');
    expect(formatChipDelta(-250)).toBe('-250');
    expect(formatChipDelta(0)).toBe('0');
  });
});
