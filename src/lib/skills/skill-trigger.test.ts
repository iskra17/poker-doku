import { describe, expect, it } from 'vitest';
import { parseCards } from '../poker/card-notation';
import { evaluateHand } from '../poker/evaluator';
import type { PublicPlayer, WinResult } from '../poker/types';
import {
  BIG_COOLDOWN_HANDS,
  applyBigCooldown,
  detectSkillTrigger,
  type SkillTriggerInput,
} from './skill-trigger';

function player(id: string, cards: string, overrides: Partial<PublicPlayer> = {}): PublicPlayer {
  return {
    id,
    name: id,
    type: id === 'hero' ? 'human' : 'bot',
    avatar: 'sakura',
    chips: 1000,
    holeCards: cards ? parseCards(cards) : [],
    status: 'active',
    revealed: id !== 'hero',
    seatIndex: 0,
    currentBet: 0,
    totalContributed: 0,
    ...overrides,
  } as PublicPlayer;
}

function input(overrides: Partial<SkillTriggerInput> = {}): SkillTriggerInput {
  return {
    heroId: 'hero',
    winners: [],
    players: [player('hero', 'As Ks'), player('villain', 'Qd Qc')],
    communityCards: [],
    bigBlind: 20,
    ...overrides,
  };
}

function showdownWin(amount: number, hole: string, board: string): WinResult {
  return { playerId: 'hero', amount, hand: evaluateHand(parseCards(hole), parseCards(board)), potIndex: 0 };
}

describe('detectSkillTrigger', () => {
  it('내가 이기지 못한 핸드는 발동하지 않는다', () => {
    expect(detectSkillTrigger(input({
      winners: [{ playerId: 'villain', amount: 2000, hand: null, potIndex: 0 }],
    }))).toBeNull();
  });

  it('쇼다운 없는 승리는 6BB 이상이면 small(steal), 워크는 조용히 넘긴다', () => {
    const steal = detectSkillTrigger(input({
      winners: [{ playerId: 'hero', amount: 160, hand: null, potIndex: 0 }],
    }));
    expect(steal).toMatchObject({ tier: 'small', reason: 'steal', bb: 8 });

    expect(detectSkillTrigger(input({
      winners: [{ playerId: 'hero', amount: 30, hand: null, potIndex: 0 }],
    }))).toBeNull();
  });

  it('턴까지 지다가 리버에서 역전하면 big(river-comeback)', () => {
    // 턴: 상대 QQ 셋 vs 내 AK 하이 → 리버 T로 내 브로드웨이 스트레이트
    const board = 'Qh Jd 4c 2s Td';
    const trigger = detectSkillTrigger(input({
      communityCards: parseCards(board),
      winners: [showdownWin(400, 'As Ks', board)],
    }));
    expect(trigger).toMatchObject({ tier: 'big', reason: 'river-comeback' });
  });

  it('공개되지 않은(머킹) 상대 패는 역전 판정에 쓰지 않는다', () => {
    const board = 'Qh Jd 4c 2s Td';
    const trigger = detectSkillTrigger(input({
      players: [player('hero', 'As Ks'), player('villain', 'Qd Qc', { revealed: false })],
      communityCards: parseCards(board),
      winners: [showdownWin(400, 'As Ks', board)],
    }));
    expect(trigger?.reason).not.toBe('river-comeback');
  });

  it('턴에도 앞서 있었다면 역전이 아니다 — 스트레이트 이상은 medium', () => {
    const board = 'Qh Jd Tc 2s 4d';
    const trigger = detectSkillTrigger(input({
      communityCards: parseCards(board),
      winners: [showdownWin(400, 'As Ks', board)],
    }));
    expect(trigger).toMatchObject({ tier: 'medium', reason: 'big-pot' });
  });

  it('포카드 이상은 팟 크기와 무관하게 big(monster)', () => {
    const board = 'Ah Ad 7c 2s 9d';
    const trigger = detectSkillTrigger(input({
      players: [player('hero', 'As Ac'), player('villain', 'Kd Kc')],
      communityCards: parseCards(board),
      winners: [showdownWin(100, 'As Ac', board)],
    }));
    expect(trigger).toMatchObject({ tier: 'big', reason: 'monster' });
  });

  it('올인이 걸린 20BB 이상 쇼다운 승리는 big(all-in-win)', () => {
    const board = 'Kh 8d 4c 2s 9d';
    const trigger = detectSkillTrigger(input({
      players: [player('hero', 'As Ks'), player('villain', 'Qd Qc', { status: 'all-in' })],
      communityCards: parseCards(board),
      winners: [showdownWin(600, 'As Ks', board)],
    }));
    expect(trigger).toMatchObject({ tier: 'big', reason: 'all-in-win' });
  });

  it('작은 쇼다운 승리는 10BB 미만이면 발동하지 않는다', () => {
    const board = 'Kh 8d 4c 2s 9d';
    expect(detectSkillTrigger(input({
      communityCards: parseCards(board),
      winners: [showdownWin(100, 'As Ks', board)],
    }))).toBeNull();
    expect(detectSkillTrigger(input({
      communityCards: parseCards(board),
      winners: [showdownWin(240, 'As Ks', board)],
    }))).toMatchObject({ tier: 'small', reason: 'showdown-win' });
  });

  it('사이드팟까지 여러 팟을 합산해 BB로 환산한다', () => {
    const board = 'Kh 8d 4c 2s 9d';
    const trigger = detectSkillTrigger(input({
      communityCards: parseCards(board),
      winners: [showdownWin(400, 'As Ks', board), { ...showdownWin(300, 'As Ks', board), potIndex: 1 }],
    }));
    expect(trigger).toMatchObject({ amount: 700, bb: 35, tier: 'medium' });
  });
});

describe('applyBigCooldown', () => {
  const big = { tier: 'big' as const, reason: 'monster' as const, amount: 100, bb: 5 };

  it('쿨다운 안의 big은 medium으로 낮추고, 지나면 그대로 둔다', () => {
    expect(applyBigCooldown(big, 10, 8).tier).toBe('medium');
    expect(applyBigCooldown(big, 8 + BIG_COOLDOWN_HANDS, 8).tier).toBe('big');
    expect(applyBigCooldown(big, 10, null).tier).toBe('big');
  });

  it('핸드 번호가 리셋된 새 방(음수 차이)에서는 쿨다운을 적용하지 않는다', () => {
    expect(applyBigCooldown(big, 2, 40).tier).toBe('big');
  });
});
