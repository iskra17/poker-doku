import { compareHands, evaluateHand } from '../poker/evaluator';
import type { Card, HandRank, PublicPlayer, WinResult } from '../poker/types';

/**
 * 파트너 필살기(스킬 버스트) 발동 판정 — 순수 함수.
 *
 * 판정은 **내(히어로) 관점**의 핸드 결과만 본다. 결과를 바꾸지 않는 연출이라 서버 권위와 무관하고,
 * 발동 여부는 내 화면에서만 쓰인다 (다른 플레이어에게 전송하지 않음).
 * 상대 홀카드는 서버가 `revealed`로 공개한 것만 사용한다 — 머킹 패를 추측하지 않는다.
 *
 * 강도 3단계: 자주 나오는 순간은 작게, 드문 순간만 크게 (모든 승리에서 크게 터지면 금방 질린다).
 */

export type SkillTier = 'small' | 'medium' | 'big';

export type SkillReason =
  | 'steal'          // 쇼다운 없이 가져간 팟 (블러프/스틸 성공)
  | 'showdown-win'   // 평범한 쇼다운 승리
  | 'big-pot'        // 큰 팟 또는 스트레이트 이상으로 승리
  | 'all-in-win'     // 올인이 걸린 쇼다운 승리
  | 'river-comeback' // 턴까지 지고 있다가 리버에서 역전
  | 'monster';       // 포카드 이상

export interface SkillTrigger {
  tier: SkillTier;
  reason: SkillReason;
  /** 이번 핸드에 내가 받은 칩 합계 (여러 팟 합산) */
  amount: number;
  /** amount를 빅블라인드로 환산한 값 */
  bb: number;
}

export interface SkillTriggerInput {
  heroId: string;
  winners: WinResult[];
  players: PublicPlayer[];
  communityCards: Card[];
  bigBlind: number;
}

/** 쇼다운 없는 승리가 small로 터지는 최소 팟 (BB). 워크·미니 스틸은 조용히 넘긴다. */
export const STEAL_MIN_BB = 6;
/** 평범한 쇼다운 승리가 small로 터지는 최소 팟 (BB) */
export const SHOWDOWN_MIN_BB = 10;
/** medium으로 올라가는 팟 크기 (BB) */
export const BIG_POT_BB = 30;
/** 올인 승리가 big으로 터지는 최소 팟 (BB) */
export const ALL_IN_MIN_BB = 20;
/** big 발동 뒤 이 핸드 수 동안은 big 대신 medium으로 낮춘다 */
export const BIG_COOLDOWN_HANDS = 6;

const MONSTER_RANKS: HandRank[] = ['four-of-a-kind', 'straight-flush', 'royal-flush'];
const STRONG_RANKS: HandRank[] = ['straight', 'flush', 'full-house', ...MONSTER_RANKS];

export function detectSkillTrigger(input: SkillTriggerInput): SkillTrigger | null {
  const heroWins = input.winners.filter(w => w.playerId === input.heroId);
  if (heroWins.length === 0) return null;
  const hero = input.players.find(p => p.id === input.heroId);
  if (!hero) return null;

  const amount = heroWins.reduce((sum, w) => sum + w.amount, 0);
  const bb = input.bigBlind > 0 ? amount / input.bigBlind : 0;
  const result = (tier: SkillTier, reason: SkillReason): SkillTrigger => ({ tier, reason, amount, bb });

  const heroHand = heroWins.find(w => w.hand)?.hand ?? null;
  if (!heroHand) {
    return bb >= STEAL_MIN_BB ? result('small', 'steal') : null;
  }

  if (MONSTER_RANKS.includes(heroHand.rank)) return result('big', 'monster');
  if (isRiverComeback(input, hero)) return result('big', 'river-comeback');

  const allInInvolved = input.players.some(p => p.status === 'all-in');
  if (allInInvolved && bb >= ALL_IN_MIN_BB) return result('big', 'all-in-win');

  if (bb >= BIG_POT_BB || STRONG_RANKS.includes(heroHand.rank)) return result('medium', 'big-pot');
  return bb >= SHOWDOWN_MIN_BB ? result('small', 'showdown-win') : null;
}

/** 턴(보드 4장) 시점에 공개된 상대 중 누군가에게 지고 있었는가 — 리버 보드 5장일 때만 판정 */
function isRiverComeback(input: SkillTriggerInput, hero: PublicPlayer): boolean {
  if (input.communityCards.length !== 5 || hero.holeCards.length !== 2) return false;
  const turnBoard = input.communityCards.slice(0, 4);
  const heroAtTurn = evaluateHand(hero.holeCards, turnBoard);
  return input.players.some(p =>
    p.id !== hero.id
    && p.revealed === true
    && p.status !== 'folded'
    && p.holeCards.length === 2
    && compareHands(evaluateHand(p.holeCards, turnBoard), heroAtTurn) > 0,
  );
}

/** 쿨다운 중 big은 medium으로 낮춘다. lastBigHand는 마지막 big이 터진 핸드 번호 */
export function applyBigCooldown(
  trigger: SkillTrigger,
  handNumber: number,
  lastBigHand: number | null,
): SkillTrigger {
  if (trigger.tier !== 'big' || lastBigHand === null) return trigger;
  const sinceBig = handNumber - lastBigHand;
  return sinceBig >= 0 && sinceBig < BIG_COOLDOWN_HANDS ? { ...trigger, tier: 'medium' } : trigger;
}
