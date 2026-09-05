import type { CompletedHandRecord } from '../lib/poker/hand-history';
import { applyReplayContribution, createReplayContributionState } from '../lib/poker/hand-history-replay';
import type { ActionType, Street } from '../lib/poker/types';
import { assessOpponentResponse, opponentResponseStrength } from '../lib/story/opponent-response';
import type { DecisionVerdict } from '../lib/story/views';
export function reviewOpponentResponses(record: CompletedHandRecord, heroId: string, identities: readonly { seatIndex: number; personalityId: string }[]): DecisionVerdict[] {
  const hero = record.players.find(p => p.id === heroId);
  if (!hero?.holeCards || record.board.length < 5) return [];
  // All-in prices and side pots are outside this deliberately narrow lesson.
  let hasAllIn = false;
  const living = new Set(record.players.map(p => p.id));
  let contribution = createReplayContributionState();
  let street: Street = 'preflop';
  const verdicts: DecisionVerdict[] = [];
  for (const action of record.actions) {
    if (action.street !== street) { contribution = { ...contribution, streetBets: new Map() }; street = action.street; }
    if (action.playerId === heroId && street === 'river') {
      const opponents = record.players.filter(p => p.id !== heroId && living.has(p.id));
      const personality = opponents.length === 1 ? identities.find(i => i.seatIndex === opponents[0].seatIndex)?.personalityId : null;
      const type = personality === 'chloe' ? 'station' : personality === 'gumi' ? 'bluffer' : personality === 'choco' ? 'honest' : personality === 'mochi' ? 'nit' : null;
      const maxBet = Math.max(0, ...contribution.streetBets.values());
      const ownBet = contribution.streetBets.get(heroId) ?? 0;
      // Exclude raises over an earlier hero bet: these need a richer range/price lesson.
      if (type && !hasAllIn && ownBet === 0 && ['check','fold','call','raise','all-in'].includes(action.kind)) {
        const facingBet = maxBet > 0;
        const decision = action.kind === 'all-in' && action.amount <= maxBet ? 'call' : action.kind as ActionType;
        const assessment = assessOpponentResponse({ type, street, opponents: opponents.length, facingBet,
          betToPot: contribution.pot > maxBet ? maxBet / (contribution.pot - maxBet) : 0,
          ...opponentResponseStrength(hero.holeCards, record.board.slice(0, 5)), action: decision });
        if (assessment) verdicts.push({ street, action: decision, amount: action.amount, mark: assessment.correct ? 'good' : 'warn', reason: assessment.reason, facts: {} });
      }
    }
    // The current hero shove is a decision; only earlier all-ins invalidate its price.
    if (action.kind === 'all-in') hasAllIn = true;
    if (action.kind === 'fold') living.delete(action.playerId);
    contribution = applyReplayContribution(contribution, action);
  }
  return verdicts;
}
