import { Player, ActionType, GameState, Card, Rank } from '../poker/types';
import { rankValue } from '../poker/deck';
import { BotPersonality, BOT_PERSONALITIES } from './personalities';

// Preflop hand strength tiers (simplified)
const PREMIUM_HANDS = ['AA', 'KK', 'QQ', 'AKs', 'AKo'];
const STRONG_HANDS = ['JJ', 'TT', 'AQs', 'AQo', 'AJs', 'KQs'];
const PLAYABLE_HANDS = ['99', '88', '77', 'ATs', 'AJo', 'KJs', 'KQo', 'QJs', 'JTs'];
const SPECULATIVE_HANDS = ['66', '55', '44', '33', '22', 'A9s', 'A8s', 'A7s', 'A6s', 'A5s', 'A4s', 'A3s', 'A2s', 'KTs', 'QTs', 'J9s', 'T9s', '98s', '87s', '76s', '65s', '54s'];

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

function getPostflopStrength(player: Player, communityCards: Card[]): number {
  // Simplified post-flop strength estimation (0-1)
  const allCards = [...player.holeCards, ...communityCards];
  const suits = allCards.map(c => c.suit);

  const holeRanks = player.holeCards.map(c => rankValue(c.rank));

  // Check for pairs with board
  let pairCount = 0;
  let topPair = false;
  let overpair = false;

  const boardRanks = communityCards.map(c => rankValue(c.rank));
  const maxBoardRank = Math.max(...boardRanks, 0);

  for (const hr of holeRanks) {
    if (boardRanks.includes(hr)) {
      pairCount++;
      if (hr === maxBoardRank) topPair = true;
    }
    if (holeRanks[0] === holeRanks[1] && holeRanks[0] > maxBoardRank) {
      overpair = true;
    }
  }

  // Count flush draws
  const suitCounts = new Map<string, number>();
  for (const s of suits) suitCounts.set(s, (suitCounts.get(s) || 0) + 1);
  const maxSuitCount = Math.max(...suitCounts.values());
  const flushDraw = maxSuitCount === 4;
  const hasFlush = maxSuitCount >= 5;

  // Simple strength score
  let strength = 0;

  if (hasFlush) strength = 0.85;
  else if (overpair) strength = 0.75;
  else if (topPair) strength = 0.65;
  else if (pairCount > 0) strength = 0.50;
  else if (flushDraw) strength = 0.40;
  else if (Math.max(...holeRanks) >= 12) strength = 0.30; // high cards
  else strength = 0.15;

  // Two pair or better
  if (pairCount >= 2) strength = 0.80;

  return strength;
}

export interface BotDecision {
  action: ActionType;
  amount: number;
}

export function decideBotAction(
  player: Player,
  gameState: GameState,
  validActions: ActionType[],
): BotDecision {
  const personality = BOT_PERSONALITIES[player.personalityId || 'hana'] || BOT_PERSONALITIES['hana'];
  const random = Math.random();

  if (gameState.street === 'preflop') {
    return decidePreflopAction(player, gameState, validActions, personality, random);
  }

  return decidePostflopAction(player, gameState, validActions, personality, random);
}

function decidePreflopAction(
  player: Player,
  gameState: GameState,
  validActions: ActionType[],
  personality: BotPersonality,
  random: number,
): BotDecision {
  const tier = getPreflopTier(player.holeCards);
  const callAmount = gameState.currentBet - player.currentBet;
  const potSize = gameState.pots.reduce((s, p) => s + p.amount, 0);

  // Premium hands - always raise/re-raise
  if (tier === 4) {
    if (validActions.includes('raise')) {
      const raiseAmount = Math.min(
        gameState.currentBet + gameState.minRaise * 3,
        player.chips + player.currentBet,
      );
      return { action: 'raise', amount: raiseAmount };
    }
    return { action: 'call', amount: callAmount };
  }

  // Strong hands - raise or call based on personality
  if (tier === 3) {
    if (validActions.includes('raise') && random < personality.pfr) {
      const raiseAmount = gameState.currentBet + gameState.minRaise * 2;
      return { action: 'raise', amount: Math.min(raiseAmount, player.chips + player.currentBet) };
    }
    if (validActions.includes('call')) return { action: 'call', amount: callAmount };
    if (validActions.includes('check')) return { action: 'check', amount: 0 };
    return { action: 'fold', amount: 0 };
  }

  // Playable hands - play based on personality looseness
  if (tier === 2) {
    if (random < personality.vpip) {
      if (validActions.includes('raise') && random < personality.pfr * 0.7) {
        const raiseAmount = gameState.currentBet + gameState.minRaise;
        return { action: 'raise', amount: Math.min(raiseAmount, player.chips + player.currentBet) };
      }
      if (validActions.includes('call') && callAmount < potSize) {
        return { action: 'call', amount: callAmount };
      }
      if (validActions.includes('check')) return { action: 'check', amount: 0 };
    }
    if (validActions.includes('check')) return { action: 'check', amount: 0 };
    return { action: 'fold', amount: 0 };
  }

  // Speculative hands - only play if personality is loose
  if (tier === 1) {
    if (random < personality.vpip * 0.6) {
      if (validActions.includes('check')) return { action: 'check', amount: 0 };
      if (validActions.includes('call') && callAmount <= gameState.bigBlind * 2) {
        return { action: 'call', amount: callAmount };
      }
    }
    if (validActions.includes('check')) return { action: 'check', amount: 0 };
    return { action: 'fold', amount: 0 };
  }

  // Trash hands - fold unless check or maniac personality
  if (random < personality.vpip * 0.3) {
    if (validActions.includes('check')) return { action: 'check', amount: 0 };
    if (validActions.includes('call') && callAmount <= gameState.bigBlind) {
      return { action: 'call', amount: callAmount };
    }
  }
  if (validActions.includes('check')) return { action: 'check', amount: 0 };
  return { action: 'fold', amount: 0 };
}

function decidePostflopAction(
  player: Player,
  gameState: GameState,
  validActions: ActionType[],
  personality: BotPersonality,
  random: number,
): BotDecision {
  const strength = getPostflopStrength(player, gameState.communityCards);
  const callAmount = gameState.currentBet - player.currentBet;
  const potSize = gameState.pots.reduce((s, p) => s + p.amount, 0);
  const potOdds = callAmount > 0 ? callAmount / (potSize + callAmount) : 0;

  // Very strong hand - bet/raise aggressively
  if (strength >= 0.75) {
    if (validActions.includes('raise') && random < personality.aggression) {
      const raiseSize = Math.floor(potSize * (0.5 + random * 0.5));
      const raiseAmount = gameState.currentBet + Math.max(raiseSize, gameState.minRaise);
      return { action: 'raise', amount: Math.min(raiseAmount, player.chips + player.currentBet) };
    }
    if (validActions.includes('call')) return { action: 'call', amount: callAmount };
    if (validActions.includes('check')) return { action: 'check', amount: 0 };
  }

  // Decent hand - play based on personality
  if (strength >= 0.50) {
    if (validActions.includes('raise') && random < personality.aggression * 0.6) {
      const raiseAmount = gameState.currentBet + gameState.minRaise;
      return { action: 'raise', amount: Math.min(raiseAmount, player.chips + player.currentBet) };
    }
    if (callAmount > 0 && random < personality.callDown) {
      if (validActions.includes('call')) return { action: 'call', amount: callAmount };
    }
    if (validActions.includes('check')) return { action: 'check', amount: 0 };
    if (random < personality.foldToPressure && callAmount > potSize * 0.5) {
      return { action: 'fold', amount: 0 };
    }
    if (validActions.includes('call')) return { action: 'call', amount: callAmount };
    return { action: 'fold', amount: 0 };
  }

  // Draws - call if pot odds are good
  if (strength >= 0.35) {
    if (potOdds < 0.3 && validActions.includes('call')) {
      return { action: 'call', amount: callAmount };
    }
    // Semi-bluff
    if (validActions.includes('raise') && random < personality.bluffFrequency) {
      const raiseAmount = gameState.currentBet + gameState.minRaise;
      return { action: 'raise', amount: Math.min(raiseAmount, player.chips + player.currentBet) };
    }
    if (validActions.includes('check')) return { action: 'check', amount: 0 };
    return { action: 'fold', amount: 0 };
  }

  // Weak hand - bluff or fold
  if (random < personality.bluffFrequency && validActions.includes('raise')) {
    const raiseAmount = gameState.currentBet + Math.floor(potSize * 0.66);
    return { action: 'raise', amount: Math.min(raiseAmount, player.chips + player.currentBet) };
  }

  if (validActions.includes('check')) return { action: 'check', amount: 0 };
  return { action: 'fold', amount: 0 };
}
