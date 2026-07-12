import { describe, it, expect } from 'vitest';
import { decideBotAction } from './bot-ai';
import { botThinkDelay } from './bot-manager';
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

/**
 * 올인 캐스케이드 가드 테스트 (결정론적 경로).
 * 딥스택에서 프리미엄이 아닌 핸드로 스택을 크게 커밋하는 것을 차단하는 레이어 —
 * SnG 초반(75BB) 봇들이 서로 레이즈 전쟁으로 올인까지 가는 캐스케이드를 막는다.
 */

function postflopState(
  bigBlind: number,
  currentBet: number,
  potAmount: number,
  communityCodes: string,
): GameState {
  return {
    id: 'test',
    players: [],
    communityCards: cards(communityCodes),
    pots: [{ amount: potAmount, eligiblePlayerIds: [] }],
    currentBet,
    minRaise: bigBlind,
    street: communityCodes.trim().split(/\s+/).length === 3 ? 'flop' : 'turn',
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

describe('봇 딥스택 올인 캐스케이드 가드', () => {
  it('딥스택 tier3(JJ)는 스택 40%+를 커밋하는 레이즈에 폴드한다', () => {
    // 100BB 스택, 40BB 레이즈 직면 (커밋 40%) — 폴드 결정론 (전에는 ryuka가 ~89% 콜)
    const player = makePlayer('bot', 2000, 0, {
      type: 'bot', personalityId: 'ryuka', holeCards: cards('Jh Jd'),
    });
    for (let i = 0; i < 30; i++) {
      const d = decideBotAction(player, preflopState(20, 800), ALL_ACTIONS);
      expect(d.action).toBe('fold');
    }
  });

  it('포스트플랍 강한 핸드도 리레이즈로 되돌아오면 다시 레이즈하지 않는다', () => {
    // 탑 투페어로 이번 스트리트 이미 벳 → 레이즈 직면: 콜만 (매니악 포함)
    const player = makePlayer('bot', 2000, 0, {
      type: 'bot', personalityId: 'akira', holeCards: cards('Kh Qd'), currentBet: 100,
    });
    const state = postflopState(20, 400, 900, 'Ks Qc 7h');
    for (let i = 0; i < 30; i++) {
      const d = decideBotAction(player, state, ALL_ACTIONS);
      expect(d.action).not.toBe('raise');
      expect(d.action).not.toBe('all-in');
    }
  });

  it('딥스택 미들 페어는 스택 40%+ 커밋 벳에 폴드한다 — 콜링 스테이션 포함', () => {
    const player = makePlayer('bot', 2000, 0, {
      type: 'bot', personalityId: 'yuki', holeCards: cards('9h 8d'),
    });
    const state = postflopState(20, 900, 600, 'Kh 9c 4s'); // 미들 페어, 커밋 45%
    for (let i = 0; i < 30; i++) {
      const d = decideBotAction(player, state, ALL_ACTIONS);
      expect(d.action).toBe('fold');
    }
  });

  it('드로우는 리레이즈 상황에서 세미블러프 레이즈를 하지 않는다', () => {
    // 플러시 드로우로 이번 스트리트 이미 액션 → 레이즈 직면: 콜/폴드만
    const player = makePlayer('bot', 1500, 0, {
      type: 'bot', personalityId: 'akira', holeCards: cards('Ah 7h'), currentBet: 100,
    });
    const state = postflopState(20, 500, 600, 'Kh 9h 2c');
    for (let i = 0; i < 30; i++) {
      const d = decideBotAction(player, state, ALL_ACTIONS);
      expect(d.action).not.toBe('raise');
      expect(d.action).not.toBe('all-in');
    }
  });
});

describe('봇 사고 시간 가변화', () => {
  it('뻔한 액션(체크·프리플랍 폴드)은 짧고 레이즈는 길다', () => {
    const player = makePlayer('bot', 2000, 0, { type: 'bot', personalityId: 'hana' });
    const pre = preflopState(20, 60);
    for (let i = 0; i < 20; i++) {
      expect(botThinkDelay({ action: 'check', amount: 0 }, player, pre)).toBeLessThan(1000);
      expect(botThinkDelay({ action: 'fold', amount: 0 }, player, pre)).toBeLessThan(1200);
      expect(botThinkDelay({ action: 'raise', amount: 200 }, player, pre)).toBeGreaterThanOrEqual(1300);
    }
  });

  it('팟 대비 큰 콜일수록 고민 시간이 늘어난다 (하한 비교)', () => {
    const player = makePlayer('bot', 5000, 0, { type: 'bot', personalityId: 'hana' });
    const bigCall = postflopState(20, 2000, 2000, 'Ks Qc 7h 2d'); // 콜 = 팟 100%
    for (let i = 0; i < 20; i++) {
      // base 1000 + bigness(1.0) * 700 = 최소 1700ms
      expect(botThinkDelay({ action: 'call', amount: 2000 }, player, bigCall)).toBeGreaterThanOrEqual(1700);
    }
  });
});
