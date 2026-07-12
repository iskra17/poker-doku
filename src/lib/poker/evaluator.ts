import { Card, EvaluatedHand, HandRank, Rank } from './types';
import { rankValue } from './deck';

const HAND_RANK_VALUES: Record<HandRank, number> = {
  'high-card': 1,
  'one-pair': 2,
  'two-pair': 3,
  'three-of-a-kind': 4,
  'straight': 5,
  'flush': 6,
  'full-house': 7,
  'four-of-a-kind': 8,
  'straight-flush': 9,
  'royal-flush': 10,
};

/** 핸드 랭크 한국어 표기 — 서버/클라 공용 단일 소스 (시스템 채팅·배지·로그가 모두 참조) */
export const HAND_RANK_KO: Record<HandRank, string> = {
  'high-card': '하이카드',
  'one-pair': '원페어',
  'two-pair': '투페어',
  'three-of-a-kind': '트리플',
  straight: '스트레이트',
  flush: '플러시',
  'full-house': '풀하우스',
  'four-of-a-kind': '포카드',
  'straight-flush': '스트레이트 플러시',
  'royal-flush': '로열 플러시',
};

function getCombinations(cards: Card[], k: number): Card[][] {
  const result: Card[][] = [];
  function combine(start: number, combo: Card[]) {
    if (combo.length === k) {
      result.push([...combo]);
      return;
    }
    for (let i = start; i < cards.length; i++) {
      combo.push(cards[i]);
      combine(i + 1, combo);
      combo.pop();
    }
  }
  combine(0, []);
  return result;
}

function isFlush(cards: Card[]): boolean {
  return cards.every(c => c.suit === cards[0].suit);
}

function isStraight(cards: Card[]): boolean {
  const values = cards.map(c => rankValue(c.rank)).sort((a, b) => a - b);
  // Check for A-2-3-4-5 (wheel)
  if (values[4] === 14 && values[0] === 2 && values[1] === 3 && values[2] === 4 && values[3] === 5) {
    return true;
  }
  for (let i = 1; i < values.length; i++) {
    if (values[i] !== values[i - 1] + 1) return false;
  }
  return true;
}

function getStraightHighCard(cards: Card[]): number {
  const values = cards.map(c => rankValue(c.rank)).sort((a, b) => a - b);
  // Wheel: A-2-3-4-5 -> high card is 5
  if (values[4] === 14 && values[0] === 2 && values[3] === 5) {
    return 5;
  }
  return values[4];
}

function getRankCounts(cards: Card[]): Map<Rank, number> {
  const counts = new Map<Rank, number>();
  for (const card of cards) {
    counts.set(card.rank, (counts.get(card.rank) || 0) + 1);
  }
  return counts;
}

function evaluate5(cards: Card[]): EvaluatedHand {
  const flush = isFlush(cards);
  const straight = isStraight(cards);
  const counts = getRankCounts(cards);
  const values = cards.map(c => rankValue(c.rank)).sort((a, b) => b - a);

  // Group by count for kicker comparison
  const groups: { rank: Rank; count: number; value: number }[] = [];
  counts.forEach((count, rank) => {
    groups.push({ rank, count, value: rankValue(rank) });
  });
  // Sort by count desc, then value desc
  groups.sort((a, b) => b.count - a.count || b.value - a.value);

  // Build score: base from hand rank, then kickers
  function makeScore(handRank: HandRank): number {
    const base = HAND_RANK_VALUES[handRank] * 10_000_000_000;
    let kicker = 0;
    for (let i = 0; i < groups.length; i++) {
      kicker += groups[i].value * Math.pow(15, 4 - i);
    }
    return base + kicker;
  }

  function makeStraightScore(handRank: HandRank): number {
    const base = HAND_RANK_VALUES[handRank] * 10_000_000_000;
    return base + getStraightHighCard(cards);
  }

  if (flush && straight) {
    const high = getStraightHighCard(cards);
    if (high === 14) {
      return { rank: 'royal-flush', value: makeStraightScore('royal-flush'), cards, description: 'Royal Flush' };
    }
    return { rank: 'straight-flush', value: makeStraightScore('straight-flush'), cards, description: `Straight Flush, ${high} high` };
  }

  const countValues = Array.from(counts.values()).sort((a, b) => b - a);

  if (countValues[0] === 4) {
    const quadRank = groups[0].rank;
    return { rank: 'four-of-a-kind', value: makeScore('four-of-a-kind'), cards, description: `Four of a Kind, ${quadRank}s` };
  }

  if (countValues[0] === 3 && countValues[1] === 2) {
    const tripRank = groups[0].rank;
    const pairRank = groups[1].rank;
    return { rank: 'full-house', value: makeScore('full-house'), cards, description: `Full House, ${tripRank}s full of ${pairRank}s` };
  }

  if (flush) {
    return { rank: 'flush', value: makeScore('flush'), cards, description: `Flush, ${values[0]} high` };
  }

  if (straight) {
    const high = getStraightHighCard(cards);
    return { rank: 'straight', value: makeStraightScore('straight'), cards, description: `Straight, ${high} high` };
  }

  if (countValues[0] === 3) {
    const tripRank = groups[0].rank;
    return { rank: 'three-of-a-kind', value: makeScore('three-of-a-kind'), cards, description: `Three of a Kind, ${tripRank}s` };
  }

  if (countValues[0] === 2 && countValues[1] === 2) {
    const highPair = groups[0].rank;
    const lowPair = groups[1].rank;
    return { rank: 'two-pair', value: makeScore('two-pair'), cards, description: `Two Pair, ${highPair}s and ${lowPair}s` };
  }

  if (countValues[0] === 2) {
    const pairRank = groups[0].rank;
    return { rank: 'one-pair', value: makeScore('one-pair'), cards, description: `Pair of ${pairRank}s` };
  }

  return { rank: 'high-card', value: makeScore('high-card'), cards, description: `High Card ${groups[0].rank}` };
}

export function evaluateHand(holeCards: Card[], communityCards: Card[]): EvaluatedHand {
  const allCards = [...holeCards, ...communityCards];
  const combinations = getCombinations(allCards, 5);

  let best: EvaluatedHand | null = null;
  for (const combo of combinations) {
    const result = evaluate5(combo);
    if (!best || result.value > best.value) {
      best = result;
    }
  }

  return best!;
}

export function compareHands(a: EvaluatedHand, b: EvaluatedHand): number {
  return a.value - b.value;
}
