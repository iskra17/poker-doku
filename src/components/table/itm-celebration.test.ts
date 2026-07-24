import { describe, expect, it } from 'vitest';
import type { TournamentMilestone } from '@/lib/poker/types';
import { shouldShowItmCelebration } from './itm-celebration';

const milestone: TournamentMilestone = {
  seq: 3,
  kind: 'itm',
  reachedAt: 1_000,
  expiresAt: 5_500,
  paidPlaces: 4,
};

describe('shouldShowItmCelebration', () => {
  it('shows a fresh ITM milestone before its server deadline', () => {
    expect(shouldShowItmCelebration(milestone, 5_499, 2)).toBe(true);
  });

  it('does not replay a sequence already seen on the table', () => {
    expect(shouldShowItmCelebration(milestone, 3_000, 3)).toBe(false);
  });

  it('does not replay an expired snapshot after reconnecting', () => {
    expect(shouldShowItmCelebration(milestone, 5_500, null)).toBe(false);
  });

  it('does not congratulate the player who busted on the bubble', () => {
    expect(shouldShowItmCelebration(milestone, 3_000, null, 5)).toBe(false);
    expect(shouldShowItmCelebration(milestone, 3_000, null, 4)).toBe(true);
  });
});
