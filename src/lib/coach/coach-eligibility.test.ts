import { describe, expect, it } from 'vitest';
import type { PublicPlayer, TournamentState } from '../poker/types';
import { isPartnerCoachEligible, type CoachEligibilityInput } from './coach-eligibility';

function seat(id: string, type: 'human' | 'bot'): PublicPlayer {
  return {
    id, name: id, type, avatar: 'mochi', chips: 2_000, seatIndex: 0, holeCards: [],
    currentBet: 0, totalContributed: 0, status: 'active', hasActed: false,
  };
}

const base: CoachEligibilityInput = {
  enabled: true,
  myPlayerId: 'me',
  roomTableType: 'bots',
  inStoryRoom: false,
  gameState: {
    players: [seat('me', 'human'), seat('b1', 'bot'), seat('b2', 'bot')],
    economyMode: 'practice',
  },
};

describe('isPartnerCoachEligible', () => {
  it('혼자 연습 테이블(봇만 상대)에서 설정이 켜져 있으면 허용', () => {
    expect(isPartnerCoachEligible(base)).toBe(true);
    // 지갑 칩을 쓰는 혼자 연습 테이블도 상대가 봇뿐이면 허용
    expect(isPartnerCoachEligible({ ...base, gameState: { ...base.gameState!, economyMode: 'wallet' } })).toBe(true);
  });

  it('설정을 끄면 끈다', () => {
    expect(isPartnerCoachEligible({ ...base, enabled: false })).toBe(false);
  });

  it('봇+사람·사람만 방, 목록에 없는 방은 끈다', () => {
    expect(isPartnerCoachEligible({ ...base, roomTableType: 'mixed' })).toBe(false);
    expect(isPartnerCoachEligible({ ...base, roomTableType: 'humans' })).toBe(false);
    expect(isPartnerCoachEligible({ ...base, roomTableType: undefined })).toBe(false);
  });

  it('다른 휴먼이 앉아 있으면 tableType과 무관하게 끈다', () => {
    const players = [...base.gameState!.players, seat('other', 'human')];
    expect(isPartnerCoachEligible({ ...base, gameState: { ...base.gameState!, players } })).toBe(false);
  });

  it('수련 스토리·주간 도장·토너먼트·아레나는 끈다', () => {
    expect(isPartnerCoachEligible({ ...base, inStoryRoom: true })).toBe(false);
    expect(isPartnerCoachEligible({ ...base, gameState: { ...base.gameState!, weeklyDojo: true } })).toBe(false);
    expect(isPartnerCoachEligible({
      ...base,
      gameState: { ...base.gameState!, tournament: { level: 1 } as TournamentState },
    })).toBe(false);
    expect(isPartnerCoachEligible({ ...base, gameState: { ...base.gameState!, economyMode: 'arena' } })).toBe(false);
  });

  it('스토리 방은 스텝이 opt-in(partnerCoach)했을 때만 켜고, 그때도 목록 tableType 없이 판정한다 (2026-10-24 Ch1 첫 핸드)', () => {
    const story = { ...base, inStoryRoom: true, roomTableType: undefined };
    expect(isPartnerCoachEligible(story)).toBe(false);
    expect(isPartnerCoachEligible({ ...story, storyCoachStep: false })).toBe(false);
    expect(isPartnerCoachEligible({ ...story, storyCoachStep: true })).toBe(true);
    // opt-in이어도 설정·다른 휴먼·주간 도장·토너먼트·아레나 제외는 그대로
    // 수업 스텝의 훈수는 설정(partnerCoach)이 꺼져 있어도 켠다 — 지시문이 훈수를 약속한다. 스텝 밖 스토리 방은 그대로 꺼진다
    expect(isPartnerCoachEligible({ ...story, storyCoachStep: true, enabled: false })).toBe(true);
    expect(isPartnerCoachEligible({ ...story, storyCoachStep: false, enabled: false })).toBe(false);
    expect(isPartnerCoachEligible({ ...base, enabled: false })).toBe(false);
    const players = [...base.gameState!.players, seat('other', 'human')];
    expect(isPartnerCoachEligible({ ...story, storyCoachStep: true, gameState: { ...base.gameState!, players } })).toBe(false);
    expect(isPartnerCoachEligible({ ...story, storyCoachStep: true, gameState: { ...base.gameState!, weeklyDojo: true } })).toBe(false);
    expect(isPartnerCoachEligible({ ...story, storyCoachStep: true, gameState: { ...base.gameState!, economyMode: 'arena' } })).toBe(false);
    // 스토리 방이 아니면 opt-in 플래그는 무시한다(일반 방은 목록 tableType으로만)
    expect(isPartnerCoachEligible({ ...base, roomTableType: 'mixed', storyCoachStep: true })).toBe(false);
  });

  it('좌석이 없거나(착석 대기) 스냅샷이 없으면 끈다', () => {
    expect(isPartnerCoachEligible({ ...base, myPlayerId: 'ghost' })).toBe(false);
    expect(isPartnerCoachEligible({ ...base, myPlayerId: null })).toBe(false);
    expect(isPartnerCoachEligible({ ...base, gameState: null })).toBe(false);
  });
});
