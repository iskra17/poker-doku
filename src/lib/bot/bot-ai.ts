import { Player, ActionType, GameState, Card, Rank, RoomDifficulty } from '../poker/types';
import { rankValue } from '../poker/deck';
import { evaluateHand } from '../poker/evaluator';
import { handPercentile } from './hand-rankings';
import { BotPersonality, BOT_PERSONALITIES } from './personalities';
import type { OpponentAggro } from './aggro-tracker';

// --- 상습 쇼버/레이저 대응 임계값 (특별 케이스 익스플로잇 — aggro-tracker 참조) ---
// 처음 한두 번의 쇼브는 기본 전략대로 접어주고, 트리거부터 맞선다.
/** 최근 윈도우 쇼브 3회+ → 강한 핸드(티어3: JJ/TT/AQ+)로 큰 커밋 콜 */
export const AGGRO_SHOVE_TRIGGER = 3;
/** 최근 윈도우 쇼브 5회+ → 플레이어블(티어2: 99+/AT+/브로드웨이)까지 확대 */
export const AGGRO_SHOVE_HEAVY = 5;
/** 최근 윈도우 레이즈 6회+ → 3벳/컨티뉴 레인지 확대 + 폴드 성향 반감 */
export const AGGRO_RAISE_TRIGGER = 6;

/**
 * HUD 스탯 기반 봇 의사결정.
 *
 * 설계 (personalities.ts의 계약 참조):
 * - 레인지 스탯: 홀카드 백분위(hand-rankings)와 비교 — vpip 24면 상위 24% 핸드로 참여.
 *   장기 빈도가 스탯과 수렴하면서도 "좋은 핸드일수록 참여"가 보장된다 (순수 RNG의 무작위성 회피).
 * - 빈도 스탯: 매 상황 독립시행 — rng() < stat/100 (c벳 70이면 10번 중 7번 c벳).
 * - 결정론 가드: 숏스택 푸시/폴드, 딥스택 커밋 가드, 리레이즈 전쟁 금지는 스탯과 무관하게
 *   항상 적용 (테스트가 의존 — 봇 실력의 기본기이자 교착/캐스케이드 방지 장치).
 *
 * rng 주입: 테스트에서 빈도 경로를 결정론적으로 검증할 수 있다.
 */

export type Rng = () => number;

// --- 숏스택 푸시/폴드 티어 (결정론 레이어 전용 — 백분위와 별도로 유지) ---
const PREMIUM_HANDS = ['AA', 'KK', 'QQ', 'AKs', 'AKo'];
const STRONG_HANDS = ['JJ', 'TT', 'AQs', 'AQo', 'AJs', 'KQs'];
const PLAYABLE_HANDS = ['99', '88', '77', 'ATs', 'AJo', 'KJs', 'KQo', 'QJs', 'JTs'];
const SPECULATIVE_HANDS = [
  '66', '55', '44', '33', '22',
  'A9s', 'A8s', 'A7s', 'A6s', 'A5s', 'A4s', 'A3s', 'A2s',
  'KTs', 'K9s', 'K8s', 'K7s', 'K6s', 'K5s', 'K4s', 'K3s', 'K2s',
  'QTs', 'Q9s', 'J9s', 'J8s', 'T9s', 'T8s', '98s', '97s', '87s', '86s', '76s', '75s', '65s', '64s', '54s',
  'ATo', 'KJo', 'KTo', 'QTo', 'JTo', 'A9o', 'T9o', '98o', '87o', '76o',
];

function getHandKey(cards: Card[]): string {
  if (cards.length !== 2) return '';
  const [c1, c2] = cards;
  const v1 = rankValue(c1.rank);
  const v2 = rankValue(c2.rank);
  const high = v1 >= v2 ? c1 : c2;
  const low = v1 >= v2 ? c2 : c1;
  const suited = c1.suit === c2.suit ? 's' : 'o';

  const rankStr = (r: Rank): string => {
    const map: Partial<Record<Rank, string>> = { '10': 'T' };
    return map[r] || r;
  };

  if (high.rank === low.rank) return `${rankStr(high.rank)}${rankStr(low.rank)}`;
  return `${rankStr(high.rank)}${rankStr(low.rank)}${suited}`;
}

function getPreflopTier(cards: Card[]): number {
  const key = getHandKey(cards);
  if (PREMIUM_HANDS.includes(key)) return 4;
  if (STRONG_HANDS.includes(key)) return 3;
  if (PLAYABLE_HANDS.includes(key)) return 2;
  if (SPECULATIVE_HANDS.includes(key)) return 1;
  return 0;
}

// --- 포스트플랍 핸드 분석 (evaluator 기반) ---

/** 원페어의 질 평가 — 오버페어/톱페어/미들/바텀 구분 */
function pairQuality(player: Player, community: Card[]): number {
  const hole = player.holeCards.map(c => rankValue(c.rank));
  const board = community.map(c => rankValue(c.rank)).sort((a, b) => b - a);
  const top = board[0] ?? 0;

  if (hole[0] === hole[1]) {
    if (hole[0] > top) return 0.72; // 오버페어
    if (hole[0] >= (board[1] ?? 0)) return 0.50; // 미들 포켓
    return 0.42;
  }
  const paired = hole.find(v => board.includes(v));
  if (paired === undefined) return 0.40; // 보드 페어 — 키커 승부
  if (paired === top) {
    // 톱페어 + 키커 보정
    const kicker = Math.max(...hole.filter(v => v !== paired), 0);
    return 0.56 + (kicker >= 13 ? 0.06 : kicker >= 10 ? 0.03 : 0);
  }
  if (paired >= (board[1] ?? 0)) return 0.47; // 미들 페어
  return 0.38; // 바텀 페어
}

function highCardQuality(player: Player, community: Card[]): number {
  const hole = player.holeCards.map(c => rankValue(c.rank));
  const top = Math.max(...community.map(c => rankValue(c.rank)), 0);
  const overs = hole.filter(v => v > top).length;
  if (overs === 2) return 0.28;
  if (overs === 1) return 0.22;
  return 0.12;
}

/** 드로우 감지 — 플러시/스트레이트 드로우의 대략적 에퀴티 (리버에선 0) */
function detectDraw(hole: Card[], community: Card[]): number {
  if (community.length >= 5) return 0;
  const all = [...hole, ...community];
  let draw = 0;

  // 플러시 드로우: 4장 동일 수트 + 홀카드 참여
  const suitCounts = new Map<string, number>();
  for (const c of all) suitCounts.set(c.suit, (suitCounts.get(c.suit) || 0) + 1);
  for (const [suit, n] of suitCounts) {
    if (n === 4 && hole.some(h => h.suit === suit)) draw = 0.36;
  }

  // 스트레이트 드로우: 5칸 윈도우에 4랭크 (홀카드가 기여해야 함)
  const windowHits = (vals: Set<number>): number => {
    let best = 0;
    for (let low = 1; low <= 10; low++) {
      let cnt = 0;
      for (let v = low; v < low + 5; v++) if (vals.has(v)) cnt++;
      best = Math.max(best, cnt);
    }
    return best;
  };
  const collect = (cards: Card[]): Set<number> => {
    const vals = new Set<number>();
    for (const c of cards) {
      const v = rankValue(c.rank);
      vals.add(v);
      if (v === 14) vals.add(1); // A는 양방향
    }
    return vals;
  };
  if (windowHits(collect(all)) >= 4 && windowHits(collect(community)) < 4) {
    draw = draw > 0 ? 0.52 : Math.max(draw, 0.30); // 콤보 드로우 부스트
  }

  return draw;
}

/** 메이드 핸드 강도(0-1) + 드로우 에퀴티 */
function analyzeHand(player: Player, community: Card[]): { strength: number; draw: number } {
  const made = evaluateHand(player.holeCards, community);
  const usesHole = made.cards.filter(c =>
    player.holeCards.some(h => h.rank === c.rank && h.suit === c.suit),
  ).length;

  let strength: number;
  switch (made.rank) {
    case 'royal-flush':
    case 'straight-flush': strength = 1; break;
    case 'four-of-a-kind': strength = 0.97; break;
    case 'full-house': strength = 0.92; break;
    case 'flush': strength = 0.87; break;
    case 'straight': strength = 0.80; break;
    case 'three-of-a-kind': strength = 0.74; break;
    case 'two-pair': strength = 0.66; break;
    case 'one-pair': strength = pairQuality(player, community); break;
    default: strength = highCardQuality(player, community);
  }
  // 베스트 5장이 전부 보드 — 상대도 같은 핸드를 갖는다
  if (usesHole === 0) strength = Math.min(strength, 0.36);

  return { strength, draw: detectDraw(player.holeCards, community) };
}

export interface BotDecision {
  action: ActionType;
  amount: number;
}

// --- 액션 헬퍼 (엔진 검증 통과가 보장되는 금액만 생성) ---

function potTotal(state: GameState): number {
  return state.pots.reduce((s, p) => s + p.amount, 0);
}

/** 총액 기준 레이즈 — [currentBet+minRaise, chips+currentBet] 범위로 클램프 */
function raiseTo(state: GameState, player: Player, target: number): BotDecision {
  const minTotal = state.currentBet + state.minRaise;
  const maxTotal = player.chips + player.currentBet;
  const amount = Math.max(minTotal, Math.min(Math.round(target), maxTotal));
  return { action: 'raise', amount };
}

/** 팟 대비 비율 벳/레이즈 */
function raiseByPot(state: GameState, player: Player, frac: number): BotDecision {
  const target = state.currentBet + Math.max(state.minRaise, Math.round(potTotal(state) * frac));
  return raiseTo(state, player, target);
}

// --- 포지션 판정 ---

/** 딜링에 참여 중인 좌석(폴드 포함) 기준으로 버튼/컷오프/SB 여부 — 스틸 스팟 판정용 */
function isLatePosition(player: Player, state: GameState): boolean {
  const inHand = state.players.filter(p =>
    p.status === 'active' || p.status === 'all-in' || p.status === 'folded',
  );
  if (inHand.length === 0) return false;
  const seats = inHand.map(p => p.seatIndex).sort((a, b) => a - b);
  const dealerSeat = state.players[state.dealerIndex]?.seatIndex ?? seats[0];
  const idx = (seat: number) => seats.indexOf(seat);
  const dealerPos = idx(dealerSeat);
  if (dealerPos < 0) return false;
  const myPos = idx(player.seatIndex);
  if (myPos < 0) return false;
  const n = seats.length;
  const cutoffPos = (dealerPos - 1 + n) % n;
  const sbPos = (dealerPos + 1) % n;
  return myPos === dealerPos || myPos === cutoffPos || myPos === sbPos;
}

/** 아직 아무도 레이즈/림프하지 않은 오픈 팟 (블라인드만 깔린 상태) */
function isUnopenedPot(state: GameState): boolean {
  return state.currentBet <= state.bigBlind
    && potTotal(state) <= (state.smallBlind + state.bigBlind) * 1.01;
}

/**
 * 방 난이도에 따른 스탯 변조 — 캐릭터별 상대적 개성은 유지한 채 전체 수위만 조절.
 * easy: 덜 공격적이고 예측 가능(블러프↓, 압박에 잘 접음) — 초보가 밸류 벳으로 이기기 쉬움.
 * hard: 더 공격적(블러프↑, 3벳↑, 잘 안 접음).
 */
export function adjustForSkill(p: BotPersonality, skill?: RoomDifficulty): BotPersonality {
  if (!skill || skill === 'normal') return p;
  const c = (v: number) => Math.max(0, Math.min(100, v));
  if (skill === 'easy') {
    return {
      ...p,
      pfr: c(p.pfr * 0.7),
      steal: c(p.steal * 0.5),
      threeBet: c(p.threeBet * 0.5),
      aggression: c(p.aggression * 0.6),
      riverBluff: c(p.riverBluff * 0.5),
      semiBluff: c(p.semiBluff * 0.6),
      cbetFlop: c(p.cbetFlop * 0.8),
      cbetTurn: c(p.cbetTurn * 0.8),
      checkRaise: c(p.checkRaise * 0.5),
      donkBet: c(p.donkBet * 0.5),
      foldToCbet: c(p.foldToCbet * 1.35),
      foldToThreeBet: c(p.foldToThreeBet * 1.2),
      wtsd: c(p.wtsd * 1.15),
    };
  }
  return {
    ...p,
    steal: c(p.steal * 1.3),
    threeBet: c(p.threeBet * 1.25),
    aggression: c(p.aggression * 1.15),
    riverBluff: c(p.riverBluff * 1.3),
    semiBluff: c(p.semiBluff * 1.2),
    cbetFlop: c(p.cbetFlop * 1.1),
    cbetTurn: c(p.cbetTurn * 1.1),
    foldToCbet: c(p.foldToCbet * 0.8),
    foldToThreeBet: c(p.foldToThreeBet * 0.85),
  };
}

export function decideBotAction(
  player: Player,
  gameState: GameState,
  validActions: ActionType[],
  rng: Rng = Math.random,
  /** 현재 어그레서(lastAggressorId)의 최근 공격성 — 휴먼 상대일 때만 전달 (없으면 기본 전략) */
  aggro?: OpponentAggro,
): BotDecision {
  const base = BOT_PERSONALITIES[player.personalityId || 'hana'] || BOT_PERSONALITIES['hana'];
  const personality = adjustForSkill(base, player.botSkill);

  if (gameState.street === 'preflop') {
    return decidePreflopAction(player, gameState, validActions, personality, rng, aggro);
  }

  return decidePostflopAction(player, gameState, validActions, personality, rng, aggro);
}

/** 빈도 스탯 독립시행 — rng() < stat% */
function roll(rng: Rng, statPct: number): boolean {
  return rng() * 100 < statPct;
}

function decidePreflopAction(
  player: Player,
  gameState: GameState,
  validActions: ActionType[],
  p: BotPersonality,
  rng: Rng,
  aggro?: OpponentAggro,
): BotDecision {
  const tier = getPreflopTier(player.holeCards);
  const pct = handPercentile(player.holeCards); // 0=최강 ~ 1=최약
  const callAmount = gameState.currentBet - player.currentBet;
  const bb = gameState.bigBlind || 1;
  const stackBB = (player.chips + player.currentBet) / bb;
  const canCheck = validActions.includes('check');
  const canCall = validActions.includes('call');
  const canRaise = validActions.includes('raise');

  // --- 숏스택 푸시/폴드 (토너먼트 블라인드 압박 표준 로직 — 결정론, 스탯 무관) ---
  // 10BB 이하에선 림프/미니레이즈 대신 쇼브. 스택이 얕을수록 레인지를 넓힌다.
  // (이게 없으면 봇들이 블라인드만 내다가 게임이 교착된다 — 특히 헤즈업)
  if (stackBB <= 10) {
    const shoveTier = stackBB <= 3 ? 0 : stackBB <= 5 ? 1 : 2;
    if (tier >= shoveTier) {
      if (validActions.includes('all-in')) return { action: 'all-in', amount: 0 };
      if (canCall) return { action: 'call', amount: callAmount };
      if (canCheck) return { action: 'check', amount: 0 };
    }
    // 팟 커밋: 이미 스택의 40% 이상이 들어가 있으면 웬만하면 콜
    if (
      canCall &&
      tier >= 1 &&
      player.currentBet >= (player.currentBet + player.chips) * 0.4
    ) {
      return { action: 'call', amount: callAmount };
    }
  }

  const facingRaise = gameState.currentBet > bb;

  if (!facingRaise) {
    // --- 오픈 상황 (아직 레이즈 없음: 림프/블라인드만) ---
    // 오픈 레인지 = pfr (+ 레이트 포지션 스틸 가산, 오픈 팟일 때만)
    const stealSpot = isUnopenedPot(gameState) && isLatePosition(player, gameState);
    const openRange = (p.pfr + (stealSpot ? p.steal : 0)) / 100;

    // 프리미엄은 무조건 레이즈 (결정론 — 몬스터 림프로 팟을 놓치지 않음)
    if (tier === 4) {
      if (canRaise) return raiseTo(gameState, player, bb * (p.openRaiseBB + rng()));
      if (canCall) return { action: 'call', amount: callAmount };
      return { action: 'check', amount: 0 };
    }

    if (pct <= openRange) {
      if (canRaise) return raiseTo(gameState, player, bb * (p.openRaiseBB + rng() * 0.5));
      if (canCheck) return { action: 'check', amount: 0 };
      if (canCall) return { action: 'call', amount: callAmount };
    }

    if (pct <= p.vpip / 100) {
      // vpip-pfr 갭 레인지: 림프 성향 시행 — 갭 상위권은 롤 실패해도 림프 (참여율 보전)
      if (canCheck) return { action: 'check', amount: 0 };
      if (canCall && callAmount <= bb && (roll(rng, p.limp) || pct <= (p.vpip / 100) * 0.6)) {
        return { action: 'call', amount: callAmount }; // 림프/SB 컴플리트
      }
    }

    if (canCheck) return { action: 'check', amount: 0 };
    return { action: 'fold', amount: 0 };
  }

  // --- 레이즈 직면 ---
  const raiseSizeBB = gameState.currentBet / bb;
  const commitFrac = callAmount / (player.chips + player.currentBet); // 콜 시 스택 커밋 비율
  const deep = stackBB > 15;
  // 내가 이미 이 스트리트에 레이즈를 넣었는데 3벳/4벳으로 되돌아옴
  const reRaisedPreflop = player.currentBet > bb;
  // 상습 쇼버 대응 — 한두 번은 접지만(트리거 미만) 반복되면 이 티어부터 큰 커밋에 맞선다
  const fightBackTier = aggro === undefined ? null
    : aggro.shoves >= AGGRO_SHOVE_HEAVY ? 2
      : aggro.shoves >= AGGRO_SHOVE_TRIGGER ? 3
        : null;
  // 상습 레이저 대응 — 3벳/컨티뉴 레인지 확대 + 폴드 성향 반감
  const vsSerialRaiser = (aggro?.raises ?? 0) >= AGGRO_RAISE_TRIGGER;

  if (tier === 4) {
    if (canRaise && rng() < 0.8) {
      return raiseTo(gameState, player, gameState.currentBet * 3);
    }
    if (canCall) return { action: 'call', amount: callAmount };
    if (validActions.includes('all-in')) return { action: 'all-in', amount: 0 };
  }

  // 딥스택에서 스택 40%+를 커밋하는 콜/레이즈는 프리미엄 전용 (올인 캐스케이드 차단 — 결정론).
  // 예외: 상습 쇼버(fightBackTier)에겐 강한 핸드로 맞선다 — "올인만 하면 다 접는" 착취 차단
  if (deep && commitFrac >= 0.4) {
    if (fightBackTier !== null && tier >= fightBackTier) {
      if (canCall) return { action: 'call', amount: callAmount };
      if (validActions.includes('all-in')) return { action: 'all-in', amount: 0 };
    }
    if (canCheck) return { action: 'check', amount: 0 };
    return { action: 'fold', amount: 0 };
  }

  // 내 오픈이 3벳을 맞음 — foldToThreeBet 시행 (상위 레인지는 계속, 상습 레이저에겐 반만 접음)
  if (reRaisedPreflop) {
    const continue3bet = pct <= (p.threeBet / 100) * 0.8; // 3벳 레인지 상위권만 4벳/콜 고려
    if (!continue3bet && roll(rng, p.foldToThreeBet * (vsSerialRaiser ? 0.5 : 1))) {
      if (canCheck) return { action: 'check', amount: 0 };
      return { action: 'fold', amount: 0 };
    }
    if (canCall && commitFrac <= 0.35) return { action: 'call', amount: callAmount };
    if (canCheck) return { action: 'check', amount: 0 };
    return { action: 'fold', amount: 0 };
  }

  // 3벳 레인지 — 상대 레이즈가 작을 때만 (레이즈 전쟁 금지). 상습 레이저에겐 레인지·사이즈 확대
  const threeBetRange = (p.threeBet / 100) * (vsSerialRaiser ? 1.5 : 1);
  if (pct <= threeBetRange && canRaise && raiseSizeBB <= (vsSerialRaiser ? 8 : 6) && tier >= 3) {
    return raiseTo(gameState, player, gameState.currentBet * 3);
  }

  // 콜드콜 레인지 (threeBet + coldCall = 컨티뉴 레인지) — 상습 레이저에겐 넓힌다
  const continueRange = ((p.threeBet + p.coldCall) / 100) * (vsSerialRaiser ? 1.5 : 1);
  if (pct <= continueRange && canCall) {
    // 가격 가드: 레이즈가 크면 상위 레인지만, 커밋 25% 이하 (상습 레이저에겐 30%)
    const affordable = commitFrac <= (vsSerialRaiser ? 0.3 : 0.25);
    if (raiseSizeBB <= (vsSerialRaiser ? 6 : 4) && affordable) {
      return { action: 'call', amount: callAmount };
    }
    if (raiseSizeBB <= (vsSerialRaiser ? 9 : 6) && affordable && pct <= continueRange * 0.5) {
      return { action: 'call', amount: callAmount };
    }
  }

  // 셋마이닝: 포켓페어 스몰콜 (wtsd 성향 시행)
  if (
    canCall && raiseSizeBB <= 3.5 && commitFrac <= 0.1 && tier >= 1 &&
    player.holeCards.length === 2 && player.holeCards[0].rank === player.holeCards[1].rank &&
    roll(rng, p.wtsd)
  ) {
    return { action: 'call', amount: callAmount };
  }

  if (canCheck) return { action: 'check', amount: 0 };
  return { action: 'fold', amount: 0 };
}

function decidePostflopAction(
  player: Player,
  gameState: GameState,
  validActions: ActionType[],
  p: BotPersonality,
  rng: Rng,
  aggro?: OpponentAggro,
): BotDecision {
  const { strength, draw } = analyzeHand(player, gameState.communityCards);
  const callAmount = gameState.currentBet - player.currentBet;
  const pot = potTotal(gameState);
  const potOdds = callAmount > 0 ? callAmount / (pot + callAmount) : 0;
  const canCheck = validActions.includes('check');
  const canCall = validActions.includes('call');
  const canRaise = validActions.includes('raise');
  const isRiver = gameState.communityCards.length >= 5;
  const isFlop = gameState.communityCards.length === 3;
  const isTurn = gameState.communityCards.length === 4;

  const stackTotal = player.chips + player.currentBet;
  const commitFrac = callAmount > 0 ? callAmount / stackTotal : 0; // 콜 시 스택 커밋 비율
  const deep = stackTotal / (gameState.bigBlind || 1) > 15;
  // 이번 스트리트에 이미 액션했는데 레이즈로 되돌아옴 — 상대가 강하다는 신호, 레이즈 전쟁 금지
  const reRaised = callAmount > 0 && player.currentBet > 0;
  // 내가 직전 어그레서인가 (c벳 스팟 판정)
  const isAggressor = gameState.lastAggressorId === player.id;
  // 상습 쇼버/레이저의 벳 직면 — 블러프캐처(페어류) 콜 다운을 넓힌다 (특별 케이스 익스플로잇)
  const aggroPressure = (aggro?.shoves ?? 0) >= AGGRO_SHOVE_TRIGGER
    || (aggro?.raises ?? 0) >= AGGRO_RAISE_TRIGGER;
  // 스트리트별 사이징: 플랍은 작게(레인지 벳), 턴/리버는 표준
  const sizeMult = isFlop ? 0.8 : 1;
  const betFrac = p.betSizePot / 100;

  // 1) 몬스터 (0.85+) — 밸류 극대화, 슬로플레이 시행
  if (strength >= 0.85) {
    const slowPlay = !isRiver && callAmount === 0 && roll(rng, p.slowPlay);
    if (!slowPlay) {
      if (canRaise) {
        return raiseByPot(gameState, player, Math.min(betFrac + rng() * 0.4, 1) * sizeMult);
      }
      if (validActions.includes('all-in')) return { action: 'all-in', amount: 0 };
    }
    if (canCall) return { action: 'call', amount: callAmount };
    return { action: 'check', amount: 0 };
  }

  // 2) 강한 핸드 (0.65+) — 투페어/셋/스트레이트급
  if (strength >= 0.65) {
    if (callAmount === 0) {
      // 체크레이즈 트랩 시행 — 어그레서가 아닐 때 체크로 유인 (레이즈는 상대 벳 후 자연 발생)
      if (!isAggressor && !isRiver && roll(rng, p.checkRaise)) {
        return { action: 'check', amount: 0 };
      }
      if (canRaise && roll(rng, p.aggression)) {
        return raiseByPot(gameState, player, betFrac * sizeMult);
      }
      return { action: 'check', amount: 0 };
    }
    // 벳 위 레이즈는 절반 빈도, 리레이즈/빅커밋 상황은 레이즈 금지 (콜 위주)
    const raiseOk = canRaise && !reRaised && commitFrac < 0.35;
    if (raiseOk && roll(rng, p.aggression * 0.5)) {
      return raiseByPot(gameState, player, betFrac * sizeMult);
    }
    // 강한 핸드는 거의 접지 않음 — 오버팟 사이즈 압박에만 성향껏 폴드
    if (callAmount > pot * 1.2 && roll(rng, p.foldToCbet * 0.5)) {
      return { action: 'fold', amount: 0 };
    }
    if (canCall) return { action: 'call', amount: callAmount };
    return { action: 'check', amount: 0 };
  }

  // 3) 미들 핸드 (0.42+) — 페어류
  if (strength >= 0.42) {
    if (callAmount === 0) {
      if (canRaise && roll(rng, p.aggression * 0.55)) {
        return raiseByPot(gameState, player, betFrac * 0.8 * sizeMult);
      }
      return { action: 'check', amount: 0 };
    }
    // 딥스택에서 미들 페어로 스택 40%+ 커밋 금지 (결정론 — 콜링 스테이션 포함).
    // 예외: 상습 쇼버의 압박엔 톱페어급(0.5+)으로 맞선다 — 블러프캐처 다운 확대
    if (deep && commitFrac >= 0.4) {
      if ((aggro?.shoves ?? 0) >= AGGRO_SHOVE_TRIGGER && strength >= 0.5 && canCall) {
        return { action: 'call', amount: callAmount };
      }
      if (canCheck) return { action: 'check', amount: 0 };
      return { action: 'fold', amount: 0 };
    }
    // 가격이 맞으면 콜 — wtsd(쇼다운 지향)가 높을수록 넓게, 큰 벳엔 foldToCbet 시행
    // (상습 쇼버/레이저의 큰 벳엔 폴드 성향 반감 — 블러프 비중이 높다)
    const priceOk = potOdds <= 0.24 + (p.wtsd / 100) * 0.5;
    const bigBet = callAmount > pot * 0.8;
    if (priceOk && !(bigBet && roll(rng, p.foldToCbet * (aggroPressure ? 0.5 : 1))) && canCall) {
      return { action: 'call', amount: callAmount };
    }
    if (canCheck) return { action: 'check', amount: 0 };
    return { action: 'fold', amount: 0 };
  }

  // 4) 드로우 — 세미블러프 시행 또는 오즈 콜
  if (draw > 0) {
    // 세미블러프는 스택을 크게 커밋하지 않을 때만, 리레이즈 상황 금지
    const semiTarget = (callAmount + pot * 0.6) / stackTotal;
    const semiOk = canRaise && !reRaised && semiTarget < 0.35;
    if (semiOk && roll(rng, p.semiBluff * (callAmount > 0 ? 0.6 : 1))) {
      return raiseByPot(gameState, player, 0.6); // 세미블러프
    }
    if (callAmount === 0) return { action: 'check', amount: 0 };
    // 오즈 콜 — 성향 콜은 커밋이 작을 때만 (드로우로 스택 올인 금지)
    if (canCall && (potOdds <= draw + (p.wtsd / 100) * 0.1 || (commitFrac < 0.3 && roll(rng, p.wtsd * 0.4)))) {
      return { action: 'call', amount: callAmount };
    }
    if (canCheck) return { action: 'check', amount: 0 };
    return { action: 'fold', amount: 0 };
  }

  // 5) 에어 — 벳 기회면 c벳/스탭 시행, 벳 직면 시 foldToCbet 시행
  if (callAmount === 0) {
    if (canRaise) {
      // 어그레서: 스트리트별 c벳 시행 (플랍 c벳 70 = 10번 중 7번)
      if (isAggressor) {
        const cbetStat = isFlop ? p.cbetFlop : isTurn ? p.cbetTurn : p.riverBluff;
        if (roll(rng, cbetStat)) {
          return raiseByPot(gameState, player, (0.5 + rng() * 0.2) * sizeMult);
        }
      } else {
        // 논어그레서: 돈크벳/스탭 시행 (리버는 riverBluff)
        const stabStat = isRiver ? p.riverBluff : p.donkBet;
        if (roll(rng, stabStat)) {
          return raiseByPot(gameState, player, 0.55 + rng() * 0.25);
        }
      }
    }
    return { action: 'check', amount: 0 };
  }
  // 벳 직면: foldToCbet 시행 — 실패(=끈질김)면 저렴할 때 플로트 콜
  if (roll(rng, p.foldToCbet)) {
    if (canCheck) return { action: 'check', amount: 0 };
    return { action: 'fold', amount: 0 };
  }
  if (canCall && strength >= 0.22 && potOdds <= 0.2 && roll(rng, p.wtsd)) {
    return { action: 'call', amount: callAmount };
  }
  if (canCheck) return { action: 'check', amount: 0 };
  return { action: 'fold', amount: 0 };
}
