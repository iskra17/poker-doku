import { evaluateHand } from '../poker/evaluator';
import { rankValue } from '../poker/deck';
import { handRankOrder } from '../poker/learning';
import type { Card } from '../poker/types';
import type { ActionType, Street } from '../poker/types';
/** The input deliberately has no opponent cards or hand outcome. */
export function assessOpponentResponse(input: { type: 'station' | 'honest' | 'bluffer' | 'nit'; street: Street; topPairOrBetter: boolean; strongMade?: boolean; opponents: number; facingBet: boolean; betToPot: number; action: ActionType }): { correct: boolean; reason: string } | null {
  if (input.street !== 'river' || input.opponents !== 1) return null;
  if (input.type === 'station' && input.topPairOrBetter && !input.facingBet) {
    return { correct: input.action === 'raise' || input.action === 'all-in', reason: '콜링 스테이션 상대 톱페어+는 리버 밸류벳 기회예요.' };
  }
  if (!input.facingBet || input.betToPot < 0.33 || input.betToPot > 0.75) return null;
  if ((input.type === 'honest' || input.type === 'nit') && !input.topPairOrBetter) {
    return { correct: input.action === 'fold', reason: '정직한 상대의 리버 공격에는 약한 핸드를 폴드해요.' };
  }
  if (input.type === 'bluffer' && input.topPairOrBetter) {
    if (input.strongMade && (input.action === 'raise' || input.action === 'all-in')) return null;
    return { correct: input.action === 'call', reason: '블러프가 잦은 상대의 합리적인 크기 리버 벳에는 톱페어+ 콜을 고려해요.' };
  }
  return null;
}

/** Ch7 only: board-only strength and kicker-only improvements are not made-hand contribution. */
export function opponentResponseStrength(hole: readonly Card[], board: readonly Card[]): {topPairOrBetter:boolean; strongMade:boolean} {
  if (hole.length !== 2 || board.length !== 5) return {topPairOrBetter:false,strongMade:false};
  const made = evaluateHand([...hole], [...board]);
  const boardHand = evaluateHand([], [...board]);
  const contributes = made.value > boardHand.value;
  const order = handRankOrder(made.rank);
  const boardOrder = handRankOrder(boardHand.rank);
  const top = Math.max(...board.map(c=>rankValue(c.rank)));
  const pocket = hole[0].rank === hole[1].rank;
  const topPair = pocket ? rankValue(hole[0].rank) > top : hole.some(c=>rankValue(c.rank)===top);
  // Same-rank board hands can improve only through kickers; exclude those conservatively.
  const strongerMade = contributes && order > boardOrder && order >= handRankOrder('two-pair');
  const topPairOrBetter = contributes && (topPair || strongerMade);
  return {topPairOrBetter, strongMade: strongerMade && order >= handRankOrder('three-of-a-kind')};
}
