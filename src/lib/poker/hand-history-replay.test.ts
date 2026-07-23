import { describe, expect, it } from 'vitest';
import type { HandHistoryAction } from './hand-history';
import {
  applyReplayContribution,
  createReplayContributionState,
  formatReplayAction,
} from './hand-history-replay';

const UNCALLED_ACTIONS: HandHistoryAction[] = [
  { street: 'preflop', playerId: 'p1', kind: 'post-sb', amount: 10 },
  { street: 'preflop', playerId: 'p2', kind: 'post-bb', amount: 20 },
  { street: 'preflop', playerId: 'p1', kind: 'all-in', amount: 1000 },
  { street: 'preflop', playerId: 'p2', kind: 'call', amount: 130 },
  { street: 'preflop', playerId: 'p1', kind: 'uncalled-return', amount: 850 },
];

describe('hand history replay', () => {
  it('subtracts an uncalled return from the pot and the player street bet', () => {
    let state = createReplayContributionState();

    for (const action of UNCALLED_ACTIONS) {
      state = applyReplayContribution(state, action);
    }

    expect(state.pot).toBe(300);
    expect(state.streetBets.get('p1')).toBe(150);
    expect(state.streetBets.get('p2')).toBe(150);
  });

  it('renders an uncalled return with a Korean replay label', () => {
    expect(formatReplayAction('uncalled-return', '850')).toBe('미응수 반환 850');
  });
});
