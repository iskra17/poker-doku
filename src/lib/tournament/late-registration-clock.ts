import type { TournamentStructureSegment } from './tournament-config';
import type { RegistrationCloseReason } from './tournament-state';

export function lateRegistrationClosesAt(
  segments: readonly TournamentStructureSegment[],
  actualStartedAt: number,
  durationLevels: 1 | 2 | 3,
): number {
  const levelDurations = segments
    .filter((segment): segment is Extract<
      TournamentStructureSegment,
      { kind: 'level' }
    > => segment.kind === 'level')
    .slice(0, durationLevels)
    .map(segment => segment.durationMs);
  if (levelDurations.length !== durationLevels) {
    throw new Error('late-registration-levels-missing');
  }
  return actualStartedAt
    + levelDurations.reduce((sum, durationMs) => sum + durationMs, 0);
}

export interface RegistrationCloseEvaluation {
  readonly enabled: boolean;
  readonly now: number;
  readonly lateRegistrationClosesAt: number;
  readonly acceptedEntrants: number;
  readonly maxEntrants: number;
  readonly startingStack: number;
  readonly currentBigBlind: number;
  readonly paidPlaces: number;
  readonly aliveSeated: number;
  readonly pendingLateEntrants: number;
  readonly previousEffectiveRemaining: number;
  readonly tableSize: number;
  readonly everMultiTable: boolean;
}

export function evaluateRegistrationClose(
  input: RegistrationCloseEvaluation,
): RegistrationCloseReason | null {
  if (!input.enabled) return 'late-reg-disabled';
  const effectiveRemaining = input.aliveSeated + input.pendingLateEntrants;
  if (effectiveRemaining <= 1) return 'last-player';
  if (effectiveRemaining <= input.paidPlaces + 1) return 'bubble';
  if (
    input.everMultiTable
    && input.previousEffectiveRemaining > input.tableSize
    && effectiveRemaining <= input.tableSize
  ) {
    return 'final-table';
  }
  if (input.startingStack / input.currentBigBlind < 20) {
    return 'stack-floor';
  }
  if (input.acceptedEntrants >= input.maxEntrants) return 'full';
  if (input.now >= input.lateRegistrationClosesAt) return 'time';
  return null;
}
