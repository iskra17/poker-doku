import { handPercentile } from '../bot/hand-rankings';
import { computeValidActions } from '../poker/engine';
import { evaluateHand } from '../poker/evaluator';
import { positionLabels } from '../poker/hand-history';
import {
  computePotOdds,
  countOutsToRank,
  exactDrawPct,
  handRankOrder,
} from '../poker/learning';
import type { ActionType, Card, HandRank, PublicGameState, PublicPlayer } from '../poker/types';
import {
  CALL_VS_THREE_BET_THRESHOLD,
  COLD_CALL_THRESHOLD,
  FOUR_BET_THRESHOLD,
  OPEN_THRESHOLDS,
  THREE_BET_THRESHOLD,
} from '../story/open-thresholds';

/**
 * 파트너 훈수의 판단 — 순수 함수. 혼자 연습 테이블에서 히로인이 "지금 이렇게 해 봐"를 고를 때 쓴다.
 *
 * 수련 스토리와 같은 기준을 쓴다: 오픈·3벳 임계는 `open-thresholds.ts`, 팟오즈·아우츠는 `learning.ts`.
 * 목표는 최적 전략(GTO)이 아니라 **입문자가 따라 해서 손해 보지 않는 단순하고 일관된 기본기**다.
 * 사람과 겨루는 테이블에서는 쓰지 않는다 (실시간 보조 도구가 되므로) — 호출부가 방 종류를 거른다.
 * 서버가 같은 함수로 "훈수를 따랐는지"를 다시 판정할 수 있도록 공개 스냅샷만 입력으로 받는다.
 */

export type CoachAction = Extract<ActionType, 'fold' | 'check' | 'call' | 'raise' | 'all-in'>;

export type CoachReason =
  | 'open-raise'        // 언오픈 팟, 포지션 범위 안 → 오픈 레이즈
  | 'fold-unopened'     // 언오픈 팟, 범위 밖 → 폴드
  | 'free-check'        // BB 등에서 공짜로 볼 수 있음
  | 'three-bet'         // 오픈을 맞고 프리미엄 → 3벳
  | 'call-open'         // 오픈을 맞고 좋은 핸드 → 콜
  | 'fold-vs-open'      // 오픈을 맞고 범위 밖 → 폴드
  | 'four-bet'          // 3벳을 맞고 최상위 → 4벳
  | 'call-three-bet'    // 3벳을 맞고 상위 → 콜
  | 'fold-vs-three-bet' // 3벳을 맞고 범위 밖 → 폴드
  | 'short-push'        // 숏스택 → 올인 아니면 폴드
  | 'short-fold'
  | 'value-bet'         // 강한 메이드 → 크게 벳
  | 'thin-value'        // 괜찮은 원페어 → 작게 벳
  | 'semi-bluff'        // 강한 드로우 → 벳으로 압박
  | 'pot-control'       // 애매한 패 → 체크
  | 'raise-value'       // 벳을 맞고 매우 강함 → 레이즈
  | 'call-strong'       // 벳을 맞고 강함 → 콜
  | 'call-price'        // 드로우·원페어 — 가격이 맞음 → 콜
  | 'fold-price';       // 가격이 안 맞음 → 폴드

export interface CoachAdvice {
  action: CoachAction;
  /** raise일 때 레이즈 총액(raise-to). 다른 액션은 없음 */
  amount?: number;
  reason: CoachReason;
  /** 대사에 넣을 숫자 — 있는 것만 채운다 */
  facts: {
    position?: string;
    /** 프리플랍 핸드 상위 % (작을수록 강함) */
    handTopPct?: number;
    /** 콜에 필요한 승률 % */
    requiredPct?: number;
    /** 드로우 완성 확률 % */
    drawPct?: number;
    outs?: number;
    /** 메이드 핸드 이름 키 */
    made?: HandRank;
    /** 벳·레이즈 크기를 BB로 */
    sizeBb?: number;
  };
}

/** 숏스택 기준 (BB) — 이 이하는 오픈 대신 올인 아니면 폴드 */
const SHORT_STACK_BB = 12;
/** 숏스택 올인 범위 (핸드 상위 %) */
const SHORT_PUSH_TOP_PCT = 20;
/** BB에서 작은 오픈을 방어하는 범위 (상위 %)와 최대 오픈 크기 */
const BB_DEFEND_TOP_PCT = 25;
const BB_DEFEND_MAX_OPEN_BB = 3;
/** 드로우로 벳을 거는 최소 아우츠 (플러시·양방향 스트레이트 드로우) */
const SEMI_BLUFF_MIN_OUTS = 8;

const RANK_LADDER: readonly HandRank[] = [
  'high-card', 'one-pair', 'two-pair', 'three-of-a-kind', 'straight',
  'flush', 'full-house', 'four-of-a-kind', 'straight-flush', 'royal-flush',
];

const RANK_VALUE: Record<string, number> = {
  '2': 2, '3': 3, '4': 4, '5': 5, '6': 6, '7': 7, '8': 8, '9': 9, '10': 10, J: 11, Q: 12, K: 13, A: 14,
};

/** 레이블(UTG/HJ/…) → 오픈 임계 키. 9인 테이블의 앞자리는 UTG 기준으로 보수적으로 묶는다 */
function openThresholdFor(position: string): number | null {
  if (position === 'BB') return null;
  if (position === 'BTN/SB') return OPEN_THRESHOLDS.BTN;
  return OPEN_THRESHOLDS[position] ?? OPEN_THRESHOLDS.UTG;
}

/** 이번 핸드에 딜인된 좌석 기준 내 포지션 라벨 */
export function heroPosition(state: PublicGameState, heroId: string): string | null {
  const dealt = state.players
    .map((player, index) => ({ player, index }))
    .filter(({ player }) => player.status !== 'sitting-out' && player.status !== 'waiting');
  const heroAt = dealt.findIndex(({ player }) => player.id === heroId);
  const dealerAt = dealt.findIndex(({ index }) => index === state.dealerIndex);
  if (heroAt < 0 || dealerAt < 0 || dealt.length < 2) return null;
  const labels = positionLabels(dealt.length);
  return labels[(heroAt - dealerAt + dealt.length) % dealt.length] ?? null;
}

function potTotal(state: PublicGameState): number {
  return state.pots.reduce((sum, pot) => sum + pot.amount, 0);
}

/** 레이즈 총액을 합법 범위로 — 최소 레이즈 미만이면 최소로, 내 스택을 넘으면 올인 */
function legalRaise(state: PublicGameState, hero: PublicPlayer, desiredTo: number): { action: CoachAction; amount?: number } {
  const maxTo = hero.chips + hero.currentBet;
  const minTo = state.currentBet + state.minRaise;
  const to = Math.round(Math.max(desiredTo, minTo));
  if (to >= maxTo) return { action: 'all-in' };
  return { action: 'raise', amount: to };
}

/** 원하는 액션이 지금 불가능하면 가장 가까운 합법 액션으로 낮춘다 */
function settle(
  valid: ActionType[],
  advice: CoachAdvice,
): CoachAdvice {
  if (valid.includes(advice.action)) return advice;
  if (advice.action === 'raise' && valid.includes('all-in')) return { ...advice, action: 'all-in', amount: undefined };
  const passive: CoachAction = valid.includes('check') ? 'check' : advice.action === 'fold' ? 'fold' : 'call';
  return { ...advice, action: valid.includes(passive) ? passive : 'fold', amount: undefined };
}

/** 보드에 깔린 페어가 아닌, 내 홀카드가 만든 원페어인지 + 그 페어가 탑페어/오버페어인지 */
function pairQuality(hole: Card[], board: Card[]): 'top' | 'weak' | 'board' {
  const boardRanks = board.map(card => RANK_VALUE[card.rank]);
  const holeRanks = hole.map(card => RANK_VALUE[card.rank]);
  const topBoard = Math.max(...boardRanks);
  if (holeRanks[0] === holeRanks[1]) return holeRanks[0] > topBoard ? 'top' : 'weak';
  const paired = holeRanks.find(rank => boardRanks.includes(rank));
  if (paired === undefined) return 'board';
  return paired === topBoard ? 'top' : 'weak';
}

function boardIsPaired(board: Card[]): boolean {
  const seen = new Set<string>();
  for (const card of board) {
    if (seen.has(card.rank)) return true;
    seen.add(card.rank);
  }
  return false;
}

type MadeStrength = 'monster' | 'strong' | 'good' | 'weak';

function madeStrength(hole: Card[], board: Card[], rank: HandRank): MadeStrength {
  const order = handRankOrder(rank);
  if (order >= handRankOrder('straight')) return 'monster';
  if (rank === 'three-of-a-kind') return 'strong';
  // 보드 페어 + 원페어는 사실상 원페어 — 투페어를 강하게 보지 않는다
  if (rank === 'two-pair') return boardIsPaired(board) ? 'good' : 'strong';
  if (rank === 'one-pair') {
    const quality = pairQuality(hole, board);
    return quality === 'top' ? 'good' : 'weak';
  }
  return 'weak';
}

export function adviseHero(state: PublicGameState, heroId: string): CoachAdvice | null {
  const hero = state.players.find(player => player.id === heroId);
  if (!state.isHandInProgress || !hero || hero.status !== 'active' || hero.holeCards.length !== 2) return null;
  if (state.players[state.activePlayerIndex]?.id !== heroId) return null;

  const valid = computeValidActions(state, hero);
  const bb = state.bigBlind || 1;
  const toCall = Math.max(0, Math.min(state.currentBet - hero.currentBet, hero.chips));
  const pot = potTotal(state);
  const stackBb = (hero.chips + hero.currentBet) / bb;
  const position = heroPosition(state, heroId) ?? undefined;

  const advice = state.street === 'preflop'
    ? advisePreflop(state, hero, { bb, toCall, pot, stackBb, position })
    : advisePostflop(state, hero, { bb, toCall, pot });
  return settle(valid, advice);
}

interface PreflopContext {
  bb: number;
  toCall: number;
  pot: number;
  stackBb: number;
  position?: string;
}

function advisePreflop(state: PublicGameState, hero: PublicPlayer, ctx: PreflopContext): CoachAdvice {
  const topPct = Math.round(handPercentile(hero.holeCards) * 1000) / 10;
  const facts = { position: ctx.position, handTopPct: topPct };

  if (ctx.stackBb <= SHORT_STACK_BB && ctx.toCall > 0 || ctx.stackBb <= SHORT_STACK_BB && state.currentBet <= ctx.bb) {
    if (topPct <= SHORT_PUSH_TOP_PCT) return { action: 'all-in', reason: 'short-push', facts };
    if (ctx.toCall === 0) return { action: 'check', reason: 'free-check', facts };
    return { action: 'fold', reason: 'short-fold', facts };
  }

  const unopened = state.currentBet <= ctx.bb;
  if (unopened) {
    const threshold = ctx.position ? openThresholdFor(ctx.position) : null;
    if (threshold !== null && topPct <= threshold) {
      const sized = legalRaise(state, hero, ctx.bb * 2.5);
      return { ...sized, reason: 'open-raise', facts: { ...facts, sizeBb: 2.5 } };
    }
    if (ctx.toCall === 0) return { action: 'check', reason: 'free-check', facts };
    return { action: 'fold', reason: 'fold-unopened', facts };
  }

  // 내가 이미 레이즈했는데 더 큰 벳이 왔다 = 3벳을 맞음
  const facingThreeBet = hero.currentBet > ctx.bb;
  if (facingThreeBet) {
    if (topPct <= FOUR_BET_THRESHOLD) {
      const sized = legalRaise(state, hero, state.currentBet * 2.3);
      return { ...sized, reason: 'four-bet', facts: { ...facts, sizeBb: Math.round((state.currentBet * 2.3) / ctx.bb) } };
    }
    if (topPct <= CALL_VS_THREE_BET_THRESHOLD) return { action: 'call', reason: 'call-three-bet', facts };
    return { action: 'fold', reason: 'fold-vs-three-bet', facts };
  }

  if (topPct <= THREE_BET_THRESHOLD) {
    const sized = legalRaise(state, hero, state.currentBet * 3);
    return { ...sized, reason: 'three-bet', facts: { ...facts, sizeBb: Math.round((state.currentBet * 3) / ctx.bb) } };
  }
  const bbDefends = ctx.position === 'BB'
    && state.currentBet <= ctx.bb * BB_DEFEND_MAX_OPEN_BB
    && topPct <= BB_DEFEND_TOP_PCT;
  if (topPct <= COLD_CALL_THRESHOLD || bbDefends) return { action: 'call', reason: 'call-open', facts };
  return { action: 'fold', reason: 'fold-vs-open', facts };
}

interface PostflopContext {
  bb: number;
  toCall: number;
  pot: number;
}

function advisePostflop(state: PublicGameState, hero: PublicPlayer, ctx: PostflopContext): CoachAdvice {
  const board = state.communityCards;
  const made = evaluateHand(hero.holeCards, board).rank;
  const strength = madeStrength(hero.holeCards, board, made);

  let outs = 0;
  let drawPct: number | undefined;
  if (board.length === 3 || board.length === 4) {
    const next = RANK_LADDER[handRankOrder(made) + 1];
    // 원페어 이하에서 스트레이트·플러시를 노리는 드로우만 센다 (원페어→투페어 아우츠는 드로우로 보지 않음)
    const target: HandRank | undefined = handRankOrder(made) <= handRankOrder('one-pair')
      ? (['straight', 'flush'] as HandRank[]).find(rank => countOutsToRank(hero.holeCards, board, rank).outs.length > 0)
      : next;
    if (target && handRankOrder(made) <= handRankOrder('one-pair')) {
      const result = countOutsToRank(hero.holeCards, board, target);
      outs = result.outs.length;
      if (outs > 0) drawPct = Math.round(exactDrawPct(outs, result.unseen, board.length === 3 ? 2 : 1));
    }
  }

  const facts: CoachAdvice['facts'] = { made, outs: outs || undefined, drawPct };

  if (ctx.toCall === 0) {
    if (strength === 'monster' || strength === 'strong') {
      const bet = ctx.pot * 0.66;
      return { ...legalRaise(state, hero, bet), reason: 'value-bet', facts: { ...facts, sizeBb: Math.round(bet / ctx.bb) } };
    }
    if (strength === 'good' && board.length < 5) {
      const bet = ctx.pot * 0.5;
      return { ...legalRaise(state, hero, bet), reason: 'thin-value', facts: { ...facts, sizeBb: Math.round(bet / ctx.bb) } };
    }
    if (outs >= SEMI_BLUFF_MIN_OUTS && board.length === 3) {
      const bet = ctx.pot * 0.5;
      return { ...legalRaise(state, hero, bet), reason: 'semi-bluff', facts: { ...facts, sizeBb: Math.round(bet / ctx.bb) } };
    }
    return { action: 'check', reason: 'pot-control', facts };
  }

  const required = Math.round(computePotOdds(ctx.toCall, ctx.pot).pct);
  const withPrice = { ...facts, requiredPct: required };
  if (strength === 'monster') {
    const raiseTo = state.currentBet * 3;
    return { ...legalRaise(state, hero, raiseTo), reason: 'raise-value', facts: { ...withPrice, sizeBb: Math.round(raiseTo / ctx.bb) } };
  }
  if (strength === 'strong') return { action: 'call', reason: 'call-strong', facts: withPrice };
  // 탑페어는 벳이 팟 이하일 때만 콜 — 큰 벳(필요 승률 33% 초과)에는 버틸 근거가 약하다
  if (strength === 'good' && required <= 33) return { action: 'call', reason: 'call-price', facts: withPrice };
  if (drawPct !== undefined && drawPct >= required) return { action: 'call', reason: 'call-price', facts: withPrice };
  return { action: 'fold', reason: 'fold-price', facts: withPrice };
}

/** 플레이어가 실제로 한 액션이 훈수와 같은지 — 레이즈 크기는 ±35% 안이면 같은 것으로 본다 */
export function followsAdvice(advice: CoachAdvice, action: ActionType, amount?: number): boolean {
  if (advice.action === 'raise') {
    if (action === 'all-in') return false;
    if (action !== 'raise' || advice.amount === undefined || amount === undefined) return action === 'raise';
    return Math.abs(amount - advice.amount) <= advice.amount * 0.35;
  }
  return advice.action === action;
}
