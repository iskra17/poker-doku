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
 * 드로우 확률은 Ch3 계약대로 **다음 한 장** 기준이다(두 장 ×4는 두 장을 다 보는 게 확정인 올인 콜만).
 * 목표는 최적 전략(GTO)이 아니라 **입문자가 따라 해서 손해 보지 않는 단순하고 일관된 기본기**다.
 * 사람과 겨루는 테이블에서는 쓰지 않는다 (실시간 보조 도구가 되므로) — 호출부가 `coach-eligibility.ts`로 거른다.
 * 서버가 같은 함수로 "훈수를 따랐는지"를 다시 판정할 수 있도록 공개 스냅샷만 입력으로 받는다.
 */

export type CoachAction = Extract<ActionType, 'fold' | 'check' | 'call' | 'raise' | 'all-in'>;

export type CoachReason =
  | 'open-raise'        // 언오픈 팟, 포지션 범위 안 → 오픈 레이즈
  | 'iso-raise'         // 림프가 들어온 팟, 범위 안 → 크게 레이즈
  | 'fold-unopened'     // 언오픈(또는 림프) 팟, 범위 밖 → 폴드
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
  | 'call-strong'       // 벳을 맞고 강함 → 콜 (레이즈가 막힌 강한 핸드 포함)
  | 'call-price'        // 원페어·드로우 — 가격이 맞음 → 콜
  | 'call-implied'      // 강한 드로우 — 조금 모자라도 완성되면 더 받는다 → 콜
  | 'fold-price';       // 가격이 안 맞음 → 폴드

export interface CoachAdvice {
  action: CoachAction;
  /** raise일 때 레이즈 총액(raise-to — `sendAction('raise', amount)`와 같은 의미). 다른 액션은 없음 */
  amount?: number;
  reason: CoachReason;
  /** 대사에 넣을 숫자 — 있는 것만 채운다 */
  facts: {
    position?: string;
    /** 프리플랍 핸드 상위 % (작을수록 강함) */
    handTopPct?: number;
    /** 콜에 필요한 승률 % */
    requiredPct?: number;
    /** 드로우 완성 확률 % (벳을 맞을 땐 다음 한 장, 세미 블러프는 리버까지) */
    drawPct?: number;
    outs?: number;
    /** 메이드 핸드 이름 키 */
    made?: HandRank;
    /** 벳·레이즈 크기를 BB로 (소수 첫째 자리) */
    sizeBb?: number;
    /** 숏스택 판단 때 내 스택 BB */
    stackBb?: number;
  };
}

/** 숏스택 기준 (BB) — 이 이하는 오픈 대신 올인 아니면 폴드 */
const SHORT_STACK_BB = 12;
/** 숏스택 올인 범위 (핸드 상위 %) — 언오픈 / 레이즈를 맞았을 때 */
const SHORT_PUSH_TOP_PCT = 20;
const SHORT_PUSH_VS_RAISE_TOP_PCT = 10;
/** BB에서 작은 오픈을 방어하는 범위 (상위 %)와 최대 오픈 크기 */
const BB_DEFEND_TOP_PCT = 25;
const BB_DEFEND_MAX_OPEN_BB = 3;
/** 레이즈를 하지 않은 좌석이 이 크기 이상의 벳을 맞으면 3벳(재레이즈) 팟으로 본다 */
const RERAISED_POT_BB = 6;
/** 드로우로 벳을 거는 최소 아우츠 (플러시·양방향 스트레이트 드로우) */
const SEMI_BLUFF_MIN_OUTS = 8;
/** 강한 드로우가 가격이 이만큼(%p) 모자라도 남은 스택이 깊으면 콜 (임플라이드 오즈) */
const IMPLIED_ODDS_SLACK_PCT = 8;
const IMPLIED_ODDS_MIN_STACK_TO_CALL = 5;
/** 원페어(탑페어 미만)도 이 필요 승률 이하의 작은 벳이면 한 번은 콜 */
const CHEAP_CALL_REQUIRED_PCT = 20;
/** 탑페어로 버티는 필요 승률 상한 — 팟 사이즈 벳(33%)까지 */
const TOP_PAIR_CALL_REQUIRED_PCT = 33;
/** 레이즈 총액이 스택의 이 비율을 넘으면 그냥 올인 (어정쩡하게 조금 남기지 않는다) */
const COMMIT_SHOVE_RATIO = 0.85;

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

function roundBb(chips: number, bb: number): number {
  return Math.round((chips / bb) * 10) / 10;
}

type Sized = Pick<CoachAdvice, 'action' | 'amount'> & { sizeBb: number };

/**
 * 레이즈 총액을 합법 범위로 — 최소 레이즈 미만이면 최소로, 스택 대부분이면 올인.
 * sizeBb는 **실제로 권할 총액** 기준이라 클램프된 뒤의 숫자와 대사가 어긋나지 않는다.
 */
function legalRaise(state: PublicGameState, hero: PublicPlayer, desiredTo: number): Sized {
  const bb = state.bigBlind || 1;
  const maxTo = hero.chips + hero.currentBet;
  const minTo = state.currentBet + state.minRaise;
  const to = Math.round(Math.max(desiredTo, minTo));
  if (to >= maxTo * COMMIT_SHOVE_RATIO) return { action: 'all-in', sizeBb: roundBb(maxTo, bb) };
  return { action: 'raise', amount: to, sizeBb: roundBb(to, bb) };
}

/**
 * 원하는 액션이 지금 불가능하면 가장 가까운 합법 액션으로 낮춘다.
 * 공격 액션이 막히면(상대 전원 올인 등) 이유도 함께 바꿔 대사와 버튼이 어긋나지 않게 한다.
 */
function settle(valid: ActionType[], advice: CoachAdvice, preflop: boolean): CoachAdvice {
  if (valid.includes(advice.action)) return advice;
  const rest = { reason: advice.reason, facts: advice.facts };
  if (advice.action === 'raise' && valid.includes('all-in')) {
    return { ...rest, action: 'all-in' };
  }
  const aggressive = advice.action === 'raise' || advice.action === 'all-in';
  if (valid.includes('check')) {
    return { ...rest, action: 'check', reason: aggressive ? (preflop ? 'free-check' : 'pot-control') : advice.reason };
  }
  if (advice.action === 'fold' || !valid.includes('call')) return { ...rest, action: 'fold' };
  // 남은 칩이 콜 금액 이하라 올인이 곧 콜인 숏스택은 이유를 그대로 둔다 (대사는 "올인"이 맞다)
  const reason = aggressive && advice.reason !== 'short-push' ? 'call-strong' : advice.reason;
  return { ...rest, action: 'call', reason };
}

function rankCounts(cards: Card[]): Map<number, number> {
  const counts = new Map<number, number>();
  for (const card of cards) {
    const value = RANK_VALUE[card.rank];
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  return counts;
}

/** 보드만으로 이미 깔린 족보(페어 계열)의 순위 — 3·4장 보드용 */
function boardPatternOrder(board: Card[]): number {
  const counts = [...rankCounts(board).values()].sort((a, b) => b - a);
  if (counts[0] >= 4) return handRankOrder('four-of-a-kind');
  if (counts[0] === 3 && (counts[1] ?? 0) >= 2) return handRankOrder('full-house');
  if (counts[0] === 3) return handRankOrder('three-of-a-kind');
  if (counts[0] === 2 && (counts[1] ?? 0) === 2) return handRankOrder('two-pair');
  if (counts[0] === 2) return handRankOrder('one-pair');
  return handRankOrder('high-card');
}

/** 내 홀카드가 보드와 짝을 이루거나 포켓 페어인지 */
function holeConnects(hole: Card[], board: Card[]): boolean {
  if (hole[0].rank === hole[1].rank) return true;
  const boardRanks = new Set(board.map(card => card.rank));
  return hole.some(card => boardRanks.has(card.rank));
}

/**
 * 보드가 다 만든 족보를 그대로 쓰는 중인지 ("보드 플레이") — 777 보드의 트리플, 5장 스트레이트 보드 등.
 * 이런 족보는 상대도 똑같이 갖고 있으니 강하다고 보면 안 된다.
 */
function playsTheBoard(hole: Card[], board: Card[], made: HandRank): boolean {
  // 5장 보드는 스트레이트·플러시·풀하우스까지 보드가 완성할 수 있다 — 값이 같으면 내 카드가 안 쓰인다
  if (board.length >= 5 && evaluateHand(hole, board).value === evaluateHand([], board).value) return true;
  // 보드 페어 계열 족보 위에서 내 카드가 짝을 못 이루면 키커만 다른 것 (777 보드의 AK 등)
  return handRankOrder(made) <= boardPatternOrder(board) && !holeConnects(hole, board);
}

/** 내 홀카드가 만든 원페어의 질 — 탑페어/오버페어면 'top', 그 아래면 'weak', 짝이 없으면 'none' */
function pairQuality(hole: Card[], board: Card[]): 'top' | 'weak' | 'none' {
  if (board.length === 0) return 'none';
  const boardRanks = board.map(card => RANK_VALUE[card.rank]);
  const holeRanks = hole.map(card => RANK_VALUE[card.rank]);
  const topBoard = Math.max(...boardRanks);
  if (holeRanks[0] === holeRanks[1]) return holeRanks[0] > topBoard ? 'top' : 'weak';
  const paired = holeRanks.filter(rank => boardRanks.includes(rank));
  if (paired.length === 0) return 'none';
  return Math.max(...paired) === topBoard ? 'top' : 'weak';
}

type MadeStrength = 'monster' | 'strong' | 'good' | 'weak' | 'nothing';

function madeStrength(hole: Card[], board: Card[], rank: HandRank): MadeStrength {
  if (playsTheBoard(hole, board, rank)) return 'nothing';
  if (handRankOrder(rank) >= handRankOrder('straight')) return 'monster';
  if (rank === 'three-of-a-kind') return 'strong';
  if (rank === 'two-pair') {
    const counts = rankCounts(board);
    const boardPaired = [...counts.values()].some(count => count >= 2);
    if (!boardPaired) return 'strong'; // 두 장 모두 보드와 짝 — 진짜 투페어
    // 보드 페어 + 내 원페어는 사실상 원페어 — 보드의 홀로 남은 카드 기준으로 내 페어의 질을 본다
    const singles = board.filter(card => counts.get(RANK_VALUE[card.rank]) === 1);
    const quality = pairQuality(hole, singles.length > 0 ? singles : board);
    return quality === 'top' ? 'good' : 'weak';
  }
  if (rank === 'one-pair') {
    const quality = pairQuality(hole, board);
    return quality === 'top' ? 'good' : quality === 'weak' ? 'weak' : 'nothing';
  }
  return 'nothing';
}

export function adviseHero(state: PublicGameState, heroId: string): CoachAdvice | null {
  const hero = state.players.find(player => player.id === heroId);
  if (!state.isHandInProgress || state.allInRunout || !hero || hero.status !== 'active' || hero.holeCards.length !== 2) {
    return null;
  }
  if (state.street === 'showdown') return null;
  if (state.players[state.activePlayerIndex]?.id !== heroId) return null;

  const valid = computeValidActions(state, hero);
  const bb = state.bigBlind || 1;
  const toCall = Math.max(0, Math.min(state.currentBet - hero.currentBet, hero.chips));
  const pot = potTotal(state);
  const stackBb = (hero.chips + hero.currentBet) / bb;
  const position = heroPosition(state, heroId) ?? undefined;
  const preflop = state.street === 'preflop';

  const advice = preflop
    ? advisePreflop(state, hero, { bb, toCall, pot, stackBb, position })
    : advisePostflop(state, hero, { bb, toCall, pot });
  return settle(valid, advice, preflop);
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
  const facts: CoachAdvice['facts'] = { position: ctx.position, handTopPct: topPct };
  const unopened = state.currentBet <= ctx.bb;

  if (ctx.stackBb <= SHORT_STACK_BB) {
    const pushTop = unopened ? SHORT_PUSH_TOP_PCT : SHORT_PUSH_VS_RAISE_TOP_PCT;
    const shortFacts = { ...facts, stackBb: Math.round(ctx.stackBb * 10) / 10 };
    if (topPct <= pushTop) return { action: 'all-in', reason: 'short-push', facts: shortFacts };
    if (ctx.toCall === 0) return { action: 'check', reason: 'free-check', facts };
    return { action: 'fold', reason: 'short-fold', facts: shortFacts };
  }

  if (unopened) {
    // 림프(블라인드만 맞춘 콜)가 들어왔는지 — BB 본인 몫은 림프가 아니다
    const bigBlindId = state.bigBlindId
      ?? state.players.find(player => heroPosition(state, player.id) === 'BB')?.id;
    const limpers = state.players.filter(player => player.id !== hero.id
      && player.id !== bigBlindId
      && player.status !== 'folded'
      && player.currentBet >= ctx.bb).length;
    const threshold = ctx.position === 'BB'
      ? (limpers > 0 ? COLD_CALL_THRESHOLD : null)
      : ctx.position ? openThresholdFor(ctx.position) : null;
    if (threshold !== null && topPct <= threshold) {
      if (limpers > 0) {
        const sized = legalRaise(state, hero, ctx.bb * (3 + limpers));
        return { action: sized.action, amount: sized.amount, reason: 'iso-raise', facts: { ...facts, sizeBb: sized.sizeBb } };
      }
      const sized = legalRaise(state, hero, ctx.bb * 2.5);
      return { action: sized.action, amount: sized.amount, reason: 'open-raise', facts: { ...facts, sizeBb: sized.sizeBb } };
    }
    if (ctx.toCall === 0) return { action: 'check', reason: 'free-check', facts };
    return { action: 'fold', reason: 'fold-unopened', facts };
  }

  // 내가 이미 레이즈했는데 더 큰 벳이 왔다 = 3벳을 맞음. 레이즈 안 한 자리에서 큰 벳(재레이즈·큰 올인)을 맞아도 같은 기준
  const facingThreeBet = hero.currentBet > ctx.bb || state.currentBet >= ctx.bb * RERAISED_POT_BB;
  if (facingThreeBet) {
    if (topPct <= FOUR_BET_THRESHOLD) {
      const sized = legalRaise(state, hero, state.currentBet * 2.3);
      return { action: sized.action, amount: sized.amount, reason: 'four-bet', facts: { ...facts, sizeBb: sized.sizeBb } };
    }
    if (topPct <= CALL_VS_THREE_BET_THRESHOLD) return { action: 'call', reason: 'call-three-bet', facts };
    return { action: 'fold', reason: 'fold-vs-three-bet', facts };
  }

  if (topPct <= THREE_BET_THRESHOLD) {
    const sized = legalRaise(state, hero, state.currentBet * 3);
    return { action: sized.action, amount: sized.amount, reason: 'three-bet', facts: { ...facts, sizeBb: sized.sizeBb } };
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

interface DrawInfo {
  outs: number;
  unseen: number;
}

/** 원페어 이하에서 스트레이트 이상(플러시 포함)을 만드는 다음 한 장의 아우츠 */
function drawInfo(hole: Card[], board: Card[], made: HandRank): DrawInfo | null {
  if (board.length !== 3 && board.length !== 4) return null;
  if (handRankOrder(made) > handRankOrder('one-pair')) return null;
  const result = countOutsToRank(hole, board, 'straight');
  if (result.outs.length === 0) return null;
  return { outs: result.outs.length, unseen: result.unseen };
}

function advisePostflop(state: PublicGameState, hero: PublicPlayer, ctx: PostflopContext): CoachAdvice {
  const board = state.communityCards;
  const made = evaluateHand(hero.holeCards, board).rank;
  const strength = madeStrength(hero.holeCards, board, made);
  const draw = drawInfo(hero.holeCards, board, made);
  const outs = draw?.outs ?? 0;
  const facts: CoachAdvice['facts'] = { made, outs: outs || undefined };

  if (ctx.toCall === 0) {
    if (strength === 'monster' || strength === 'strong') {
      const sized = legalRaise(state, hero, ctx.pot * 0.66);
      return { action: sized.action, amount: sized.amount, reason: 'value-bet', facts: { ...facts, sizeBb: sized.sizeBb } };
    }
    if (strength === 'good' && board.length < 5) {
      const sized = legalRaise(state, hero, ctx.pot * 0.5);
      return { action: sized.action, amount: sized.amount, reason: 'thin-value', facts: { ...facts, sizeBb: sized.sizeBb } };
    }
    if (draw && outs >= SEMI_BLUFF_MIN_OUTS && board.length === 3) {
      const sized = legalRaise(state, hero, ctx.pot * 0.5);
      // 벳이 콜되면 턴·리버 두 장을 다 볼 수 있으니 여기선 리버까지 확률을 보여 준다
      const drawPct = Math.round(exactDrawPct(outs, draw.unseen, 2));
      return { action: sized.action, amount: sized.amount, reason: 'semi-bluff', facts: { ...facts, drawPct, sizeBb: sized.sizeBb } };
    }
    return { action: 'check', reason: 'pot-control', facts };
  }

  const required = Math.round(computePotOdds(ctx.toCall, Math.max(ctx.pot, 1)).pct);
  // 이 콜로 올인이면 남은 카드를 전부 보니 두 장 확률, 아니면 다음 한 장 (Ch3 「2/4의 법칙」 계약)
  const callIsAllIn = ctx.toCall >= hero.chips;
  const drawPct = draw
    ? Math.round(exactDrawPct(outs, draw.unseen, callIsAllIn && board.length === 3 ? 2 : 1))
    : undefined;
  const withPrice: CoachAdvice['facts'] = { ...facts, requiredPct: required, drawPct };

  if (strength === 'monster') {
    const sized = legalRaise(state, hero, state.currentBet * 3);
    return { action: sized.action, amount: sized.amount, reason: 'raise-value', facts: { ...withPrice, sizeBb: sized.sizeBb } };
  }
  if (strength === 'strong') return { action: 'call', reason: 'call-strong', facts: withPrice };
  if (strength === 'good' && required <= TOP_PAIR_CALL_REQUIRED_PCT) {
    return { action: 'call', reason: 'call-price', facts: withPrice };
  }
  if (drawPct !== undefined && drawPct >= required) return { action: 'call', reason: 'call-price', facts: withPrice };
  if (strength === 'weak' && board.length < 5 && required <= CHEAP_CALL_REQUIRED_PCT) {
    return { action: 'call', reason: 'call-price', facts: withPrice };
  }
  const deepBehind = hero.chips - ctx.toCall >= ctx.toCall * IMPLIED_ODDS_MIN_STACK_TO_CALL;
  if (drawPct !== undefined && outs >= SEMI_BLUFF_MIN_OUTS && board.length < 5 && deepBehind
    && required - drawPct <= IMPLIED_ODDS_SLACK_PCT) {
    return { action: 'call', reason: 'call-implied', facts: withPrice };
  }
  return { action: 'fold', reason: 'fold-price', facts: withPrice };
}

/** 레이즈 크기가 훈수와 이만큼(비율) 안이면 같은 액션으로 본다 */
export const FOLLOW_RAISE_TOLERANCE = 0.35;

/**
 * 플레이어가 실제로 한 액션이 훈수와 같은지.
 * - 레이즈는 총액이 ±35% 안이면 같은 것으로 본다.
 * - 올인 훈수에 슬라이더를 끝까지 올린 레이즈(총액 ≥ 내 최대 총액)도 따른 것으로 본다 —
 *   엔진은 그 액션을 'raise'로 기록하므로 `heroMaxTotal`(훈수 시점 칩+현재 벳)을 넘겨야 판정할 수 있다.
 */
export function followsAdvice(
  advice: CoachAdvice,
  action: ActionType,
  amount?: number,
  heroMaxTotal?: number,
): boolean {
  if (advice.action === 'raise') {
    if (action !== 'raise') return false;
    if (advice.amount === undefined || amount === undefined) return true;
    return Math.abs(amount - advice.amount) <= advice.amount * FOLLOW_RAISE_TOLERANCE;
  }
  if (advice.action === 'all-in') {
    if (action === 'all-in') return true;
    return action === 'raise' && amount !== undefined && heroMaxTotal !== undefined && amount >= heroMaxTotal;
  }
  return advice.action === action;
}
