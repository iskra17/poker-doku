import type { TournamentMilestone } from '@/lib/poker/types';

export function shouldShowItmCelebration(
  milestone: TournamentMilestone | undefined,
  now: number,
  seenSeq: number | null,
): boolean {
  return milestone?.kind === 'itm'
    && milestone.seq !== seenSeq
    && milestone.expiresAt > now;
}
