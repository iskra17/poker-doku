import { describe, it, expect } from 'vitest';
import { decideBotAction } from './bot-ai';
import { makePlayer, cards } from '../poker/test-helpers';
import { GameState, ActionType } from '../poker/types';

/**
 * 숏스택 푸시/폴드 로직 테스트 (결정론적 경로만).
 * 블라인드 압박에서 봇이 폴드만 반복하며 교착되는 것을 방지하는 레이어.
 */

function preflopState(bigBlind: number, currentBet: number): GameState {
  return {
    id: 'test',
    players: [],
    communityCards: [],
    pots: [{ amount: bigBlind + bigBlind / 2, eligiblePlayerIds: [] }],
    currentBet,
    minRaise: bigBlind,
    street: 'preflop',
    dealerIndex: 0,
    activePlayerIndex: 0,
    smallBlind: bigBlind / 2,
    bigBlind,
    isHandInProgress: true,
    winners: null,
    lastAction: null,
    turnTimer: 30,
    handNumber: 1,
    actionSeq: 0,
  };
}

const ALL_ACTIONS: ActionType[] = ['fold', 'call', 'raise', 'all-in'];

describe('봇 숏스택 푸시/폴드', () => {
  it('3BB 이하에서는 아무 핸드나 올인한다', () => {
    const player = makePlayer('bot', 500, 0, {
      type: 'bot', personalityId: 'sakura', holeCards: cards('7d 2c'),
    });
    const d = decideBotAction(player, preflopState(200, 200), ALL_ACTIONS);
    expect(d.action).toBe('all-in');
  });

  it('5BB 이하에서는 투기 핸드(수딧 커넥터 등)도 올인한다', () => {
    const player = makePlayer('bot', 900, 0, {
      type: 'bot', personalityId: 'sakura', holeCards: cards('8h 7h'), // 87s = tier 1
    });
    const d = decideBotAction(player, preflopState(200, 200), ALL_ACTIONS);
    expect(d.action).toBe('all-in');
  });

  it('10BB 이하에서는 플레이어블 핸드로 올인한다', () => {
    const player = makePlayer('bot', 1800, 0, {
      type: 'bot', personalityId: 'sakura', holeCards: cards('9s 9d'), // 99 = tier 2
    });
    const d = decideBotAction(player, preflopState(200, 200), ALL_ACTIONS);
    expect(d.action).toBe('all-in');
  });

  it('10BB 이하라도 트래시 핸드는 강제 올인하지 않는다', () => {
    const player = makePlayer('bot', 1800, 0, {
      type: 'bot', personalityId: 'sakura', holeCards: cards('9d 3c'), // tier 0
    });
    const d = decideBotAction(player, preflopState(200, 200), ALL_ACTIONS);
    expect(d.action).not.toBe('all-in');
  });

  it('딥스택(30BB+)에서는 쇼브 레이어가 발동하지 않는다 — 트래시는 폴드/체크', () => {
    const player = makePlayer('bot', 6000, 0, {
      type: 'bot', personalityId: 'sakura', holeCards: cards('9d 3c'),
    });
    const d = decideBotAction(player, preflopState(200, 400), ALL_ACTIONS);
    expect(d.action).toBe('fold');
  });
});
