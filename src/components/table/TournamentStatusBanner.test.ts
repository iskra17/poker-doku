import { describe, expect, it } from 'vitest';
import type { TournamentHoldReason } from '@/lib/poker/types';
import {
  getTournamentActionDockMode,
  resolveTournamentStatus,
  shouldBlockTournamentActions,
} from './TournamentStatusBanner';

describe('resolveTournamentStatus', () => {
  it('uses the release priority when multiple tournament holds overlap', () => {
    const reasons: TournamentHoldReason[] = [
      'h4h-barrier',
      'final-intro',
      'final-forming',
      'scheduled-break',
      'director-pause',
    ];

    expect(resolveTournamentStatus(reasons)?.reason).toBe('director-pause');
    expect(resolveTournamentStatus(reasons.slice(0, 4))?.reason).toBe('scheduled-break');
    expect(resolveTournamentStatus(reasons.slice(0, 3))?.reason).toBe('final-forming');
    expect(resolveTournamentStatus(reasons.slice(0, 2))?.reason).toBe('final-intro');
    expect(resolveTournamentStatus(reasons.slice(0, 1))?.reason).toBe('h4h-barrier');
  });

  it('returns no banner when play is not held', () => {
    expect(resolveTournamentStatus([])).toBeNull();
    expect(resolveTournamentStatus(undefined)).toBeNull();
  });

  it('blocks inputs at a held hand boundary without freezing a hand already in progress', () => {
    expect(shouldBlockTournamentActions(['final-intro'], false)).toBe(true);
    expect(shouldBlockTournamentActions(['scheduled-break'], false)).toBe(true);
    expect(shouldBlockTournamentActions(['director-pause'], true)).toBe(false);
    expect(shouldBlockTournamentActions([], false)).toBe(false);
  });

  it('keeps game recovery available for a sitting-out player while betting is held', () => {
    expect(getTournamentActionDockMode(['final-intro'], false, false)).toBe('held');
    expect(getTournamentActionDockMode(['final-intro'], false, true)).toBe('held-seat-management');
    expect(getTournamentActionDockMode(['director-pause'], true, true)).toBe('actions');
  });
});
