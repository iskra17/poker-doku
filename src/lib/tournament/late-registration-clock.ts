import type { TournamentStructureSegment } from './tournament-config';
import type { RegistrationCloseReason } from './tournament-state';

function nonnegativeSafeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function positiveSafeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}

export function lateRegistrationClosesAt(
  segments: readonly TournamentStructureSegment[],
  actualStartedAt: number,
  durationLevels: 1 | 2 | 3,
): number {
  if (
    !Array.isArray(segments)
    || !nonnegativeSafeInteger(actualStartedAt)
    || !Number.isSafeInteger(durationLevels)
    || durationLevels < 1
    || durationLevels > 3
    || segments.some(segment => (
      !segment
      || (segment.kind !== 'level' && segment.kind !== 'break')
      || !positiveSafeInteger(segment.durationMs)
    ))
  ) {
    throw new Error('invalid-late-registration-clock');
  }
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
  const closesAt = actualStartedAt
    + levelDurations.reduce((sum, durationMs) => sum + durationMs, 0);
  if (!nonnegativeSafeInteger(closesAt)) {
    throw new Error('invalid-late-registration-clock');
  }
  return closesAt;
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
  if (
    typeof input.enabled !== 'boolean'
    || typeof input.everMultiTable !== 'boolean'
    || !nonnegativeSafeInteger(input.now)
    || !nonnegativeSafeInteger(input.lateRegistrationClosesAt)
    || !nonnegativeSafeInteger(input.acceptedEntrants)
    || !positiveSafeInteger(input.maxEntrants)
    || input.maxEntrants > 48
    || input.acceptedEntrants > input.maxEntrants
    || !positiveSafeInteger(input.startingStack)
    || !positiveSafeInteger(input.currentBigBlind)
    || !nonnegativeSafeInteger(input.paidPlaces)
    || input.paidPlaces > input.maxEntrants
    || !nonnegativeSafeInteger(input.aliveSeated)
    || input.aliveSeated > input.acceptedEntrants
    || !nonnegativeSafeInteger(input.pendingLateEntrants)
    || input.aliveSeated + input.pendingLateEntrants
      > input.acceptedEntrants
    || !nonnegativeSafeInteger(input.previousEffectiveRemaining)
    || input.previousEffectiveRemaining > input.maxEntrants
    || !positiveSafeInteger(input.tableSize)
    || input.tableSize > 6
  ) {
    throw new Error('invalid-registration-close-evaluation');
  }
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
