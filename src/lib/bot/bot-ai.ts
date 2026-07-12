import { Player, ActionType, GameState, Card, Rank } from '../poker/types';
import { rankValue } from '../poker/deck';
import { evaluateHand } from '../poker/evaluator';
import { BotPersonality, BOT_PERSONALITIES } from './personalities';

// Preflop hand strength tiers (simplified)
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

export function decideBotAction(
  player: Player,
  gameState: GameState,
  validActions: ActionType[],
): BotDecision {
  const personality = BOT_PERSONALITIES[player.personalityId || 'hana'] || BOT_PERSONALITIES['hana'];

  if (gameState.street === 'preflop') {
    return decidePreflopAction(player, gameState, validActions, personality);
  }

  return decidePostflopAction(player, gameState, validActions, personality);
}

function decidePreflopAction(
  player: Player,
  gameState: GameState,
  validActions: ActionType[],
  p: BotPersonality,
): BotDecision {
  const tier = getPreflopTier(player.holeCards);
  const callAmount = gameState.currentBet - player.currentBet;
  const bb = gameState.bigBlind || 1;
  const stackBB = (player.chips + player.currentBet) / bb;
  const canCheck = validActions.includes('check');
  const canCall = validActions.includes('call');
  const canRaise = validActions.includes('raise');

  // --- 숏스택 푸시/폴드 (토너먼트 블라인드 압박 표준 로직) ---
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
    if (tier === 4) {
      if (canRaise) return raiseTo(gameState, player, bb * (3 + Math.random()));
      if (canCall) return { action: 'call', amount: callAmount };
      return { action: 'check', amount: 0 };
    }
    if (tier === 3) {
      if (canRaise && Math.random() < p.pfr + 0.4) {
        return raiseTo(gameState, player, bb * (2.5 + Math.random()));
      }
      if (canCheck) return { action: 'check', amount: 0 };
      if (canCall) return { action: 'call', amount: callAmount };
    }
    if (tier === 2) {
      if (canRaise && Math.random() < p.pfr * 0.9) {
        return raiseTo(gameState, player, bb * (2.5 + Math.random() * 0.5));
      }
      if (Math.random() < p.vpip + 0.2) {
        if (canCheck) return { action: 'check', amount: 0 };
        if (canCall) return { action: 'call', amount: callAmount }; // 림프
      }
      if (canCheck) return { action: 'check', amount: 0 };
      return { action: 'fold', amount: 0 };
    }
    if (tier === 1) {
      // 투기 핸드: 루즈하면 림프/오픈, LAG는 가끔 스틸
      if (canRaise && Math.random() < p.pfr * 0.4) {
        return raiseTo(gameState, player, bb * 2.5);
      }
      if (Math.random() < p.vpip) {
        if (canCheck) return { action: 'check', amount: 0 };
        if (canCall && callAmount <= bb) return { action: 'call', amount: callAmount };
      }
      if (canCheck) return { action: 'check', amount: 0 };
      return { action: 'fold', amount: 0 };
    }
    // tier 0 — 트래시: 체크 가능하면 체크, 공격적 봇은 가끔 스틸, 루즈 봇은 림프로 플랍 구경
    if (canRaise && Math.random() < p.bluffFrequency * 0.25) {
      return raiseTo(gameState, player, bb * 2.5);
    }
    if (canCheck) return { action: 'check', amount: 0 };
    if (canCall && callAmount <= bb && Math.random() < p.vpip * 0.5) {
      return { action: 'call', amount: callAmount }; // 림프/SB 컴플리트
    }
    return { action: 'fold', amount: 0 };
  }

  // --- 레이즈 직면 ---
  const raiseSizeBB = gameState.currentBet / bb;
  const commitFrac = callAmount / (player.chips + player.currentBet); // 콜 시 스택 커밋 비율
  const deep = stackBB > 15;

  if (tier === 4) {
    if (canRaise && Math.random() < 0.8) {
      return raiseTo(gameState, player, gameState.currentBet * 3);
    }
    if (canCall) return { action: 'call', amount: callAmount };
    if (validActions.includes('all-in')) return { action: 'all-in', amount: 0 };
  }
  if (tier === 3) {
    // 딥스택에서 스택 40%+를 커밋하는 콜/레이즈는 프리미엄 전용 (올인 캐스케이드 차단 — 결정론)
    if (deep && commitFrac >= 0.4) {
      if (canCheck) return { action: 'check', amount: 0 };
      return { action: 'fold', amount: 0 };
    }
    // 3벳은 상대 레이즈가 작을 때만 — JJ/AQ로 4벳 전쟁 금지
    if (canRaise && raiseSizeBB <= 6 && Math.random() < p.threeBet) {
      return raiseTo(gameState, player, gameState.currentBet * 3);
    }
    if (canCall && (raiseSizeBB <= 4 || (commitFrac <= 0.25 && Math.random() > p.foldToPressure * 0.6))) {
      return { action: 'call', amount: callAmount };
    }
    if (canCheck) return { action: 'check', amount: 0 };
    return { action: 'fold', amount: 0 };
  }
  if (tier === 2) {
    // 미들 핸드: 콜링 스테이션은 넓게 콜, 타이트는 크기 보고 접음
    const affordable = callAmount <= (player.chips + player.currentBet) * 0.2;
    if (canCall && raiseSizeBB <= 5 && affordable && Math.random() < Math.max(p.callDown, p.vpip * 0.7)) {
      return { action: 'call', amount: callAmount };
    }
    if (canCheck) return { action: 'check', amount: 0 };
    return { action: 'fold', amount: 0 };
  }
  if (tier === 1) {
    if (canCall && raiseSizeBB <= 3.5 && Math.random() < p.vpip * 0.5) {
      return { action: 'call', amount: callAmount }; // 셋마이닝/수딧커넥터 스몰콜
    }
    if (canCheck) return { action: 'check', amount: 0 };
    return { action: 'fold', amount: 0 };
  }
  // tier 0 트래시는 레이즈 앞에서 항상 폴드 (결정론 — 봇 실력의 기본기)
  if (canCheck) return { action: 'check', amount: 0 };
  return { action: 'fold', amount: 0 };
}

function decidePostflopAction(
  player: Player,
  gameState: GameState,
  validActions: ActionType[],
  p: BotPersonality,
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

  const stackTotal = player.chips + player.currentBet;
  const commitFrac = callAmount > 0 ? callAmount / stackTotal : 0; // 콜 시 스택 커밋 비율
  const deep = stackTotal / (gameState.bigBlind || 1) > 15;
  // 이번 스트리트에 이미 액션했는데 레이즈로 되돌아옴 — 상대가 강하다는 신호, 레이즈 전쟁 금지
  const reRaised = callAmount > 0 && player.currentBet > 0;
  // 스트리트별 사이징: 플랍은 작게(레인지 벳), 턴/리버는 표준
  const sizeMult = isFlop ? 0.8 : 1;

  // 1) 몬스터 (0.85+) — 밸류 극대화, 가끔 플랍 슬로플레이
  if (strength >= 0.85) {
    const slowPlay = !isRiver && callAmount === 0 && Math.random() < p.slowPlay;
    if (!slowPlay) {
      if (canRaise) {
        return raiseByPot(gameState, player, Math.min(p.betSizing + Math.random() * 0.4, 1) * sizeMult);
      }
      if (validActions.includes('all-in')) return { action: 'all-in', amount: 0 };
    }
    if (canCall) return { action: 'call', amount: callAmount };
    return { action: 'check', amount: 0 };
  }

  // 2) 강한 핸드 (0.65+) — 투페어/셋/스트레이트급
  if (strength >= 0.65) {
    // 벳은 성향껏, 벳 위 레이즈는 절반 빈도, 리레이즈/빅커밋 상황은 레이즈 금지 (콜 위주)
    const raiseOk = canRaise && !reRaised && commitFrac < 0.35;
    if (raiseOk && Math.random() < p.aggression * (callAmount > 0 ? 0.5 : 1)) {
      return raiseByPot(gameState, player, p.betSizing * sizeMult);
    }
    if (callAmount > 0) {
      // 강한 핸드는 거의 접지 않음 — 오버팟 사이즈 압박에만 성향껏 폴드
      if (callAmount > pot * 1.2 && Math.random() < p.foldToPressure * 0.5) {
        return { action: 'fold', amount: 0 };
      }
      if (canCall) return { action: 'call', amount: callAmount };
    }
    return { action: 'check', amount: 0 };
  }

  // 3) 미들 핸드 (0.42+) — 페어류
  if (strength >= 0.42) {
    if (callAmount === 0) {
      if (canRaise && Math.random() < p.aggression * 0.55) {
        return raiseByPot(gameState, player, p.betSizing * 0.8 * sizeMult);
      }
      return { action: 'check', amount: 0 };
    }
    // 딥스택에서 미들 페어로 스택 40%+ 커밋 금지 (결정론 — 콜링 스테이션 포함)
    if (deep && commitFrac >= 0.4) {
      if (canCheck) return { action: 'check', amount: 0 };
      return { action: 'fold', amount: 0 };
    }
    // 가격이 맞으면 콜 — 콜링 스테이션은 훨씬 넓게, 록은 큰 벳에 접음
    const priceOk = potOdds <= 0.28 + p.callDown * 0.22;
    const pressure = callAmount > pot * 0.8 ? 1 : 0.45;
    if (priceOk && Math.random() > p.foldToPressure * pressure) {
      if (canCall) return { action: 'call', amount: callAmount };
    }
    if (canCheck) return { action: 'check', amount: 0 };
    return { action: 'fold', amount: 0 };
  }

  // 4) 드로우 — 세미블러프 또는 오즈 콜
  if (draw > 0) {
    // 세미블러프는 스택을 크게 커밋하지 않을 때만, 리레이즈 상황 금지
    const semiTarget = (callAmount + pot * 0.6) / stackTotal;
    const semiOk = canRaise && !reRaised && semiTarget < 0.35;
    const semiFreq = (p.bluffFrequency + p.aggression * 0.15) * (callAmount > 0 ? 0.6 : 1);
    if (semiOk && Math.random() < semiFreq) {
      return raiseByPot(gameState, player, 0.6); // 세미블러프
    }
    if (callAmount === 0) return { action: 'check', amount: 0 };
    // 오즈 콜 — 성향 콜은 커밋이 작을 때만 (드로우로 스택 올인 금지)
    if (canCall && (potOdds <= draw + p.callDown * 0.1 || (commitFrac < 0.3 && Math.random() < p.callDown * 0.4))) {
      return { action: 'call', amount: callAmount };
    }
    if (canCheck) return { action: 'check', amount: 0 };
    return { action: 'fold', amount: 0 };
  }

  // 5) 에어 — 체크 가능하면 블러프/체크, 벳 직면 시 대부분 폴드
  if (callAmount === 0) {
    if (canRaise && Math.random() < p.bluffFrequency * (isRiver ? 0.8 : 1)) {
      return raiseByPot(gameState, player, 0.55 + Math.random() * 0.25);
    }
    return { action: 'check', amount: 0 };
  }
  // 콜링 스테이션은 하이카드로도 가끔 스몰벳 콜
  if (canCall && strength >= 0.22 && potOdds <= 0.2 && Math.random() < p.callDown * 0.35) {
    return { action: 'call', amount: callAmount };
  }
  if (canCheck) return { action: 'check', amount: 0 };
  return { action: 'fold', amount: 0 };
}
