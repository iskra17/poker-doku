import { describe, expect, it } from 'vitest';
import type { TournamentStructureSegment } from './tournament-config';
import {
  evaluateRegistrationClose,
  lateRegistrationClosesAt,
} from './late-registration-clock';

const MINUTE = 60_000;
const START = Date.UTC(2026, 6, 25, 12);
const SEGMENTS: readonly TournamentStructureSegment[] = [
  {
    kind: 'level',
    durationMs: 5 * MINUTE,
    smallBlind: 50,
    bigBlind: 100,
    bigBlindAnte: 0,
  },
  { kind: 'break', durationMs: 10 * MINUTE },
  {
    kind: 'level',
    durationMs: 7 * MINUTE,
    smallBlind: 100,
    bigBlind: 200,
    bigBlindAnte: 200,
  },
  {
    kind: 'level',
    durationMs: 9 * MINUTE,
    smallBlind: 150,
    bigBlind: 300,
    bigBlindAnte: 300,
  },
];

describe('lateRegistrationClosesAt', () => {
  it.each([
    [1, 5],
    [2, 12],
    [3, 21],
  ] as const)(
    'closes after level %i by absolute actual-start time',
    (durationLevels, elapsedMinutes) => {
      expect(lateRegistrationClosesAt(
        SEGMENTS,
        START,
        durationLevels,
      )).toBe(START + elapsedMinutes * MINUTE);
    },
  );

  it('does not extend late registration for pause or break', () => {
    const closeAt = lateRegistrationClosesAt(SEGMENTS, START, 2);

    expect(closeAt).toBe(START + 12 * MINUTE);
    expect(closeAt).toBeLessThan(START + 5 * MINUTE + 10 * MINUTE + 7 * MINUTE);
  });
});

describe('evaluateRegistrationClose', () => {
  const open = {
    enabled: true,
    now: START,
    lateRegistrationClosesAt: START + 30 * MINUTE,
    acceptedEntrants: 10,
    maxEntrants: 24,
    startingStack: 10_000,
    currentBigBlind: 400,
    paidPlaces: 2,
    aliveSeated: 10,
    pendingLateEntrants: 0,
    previousEffectiveRemaining: 10,
    tableSize: 6,
    everMultiTable: true,
  } as const;

  it.each([
    ['time', { now: START + 30 * MINUTE }],
    ['full', { acceptedEntrants: 24 }],
    ['stack-floor', { currentBigBlind: 501 }],
    ['bubble', { aliveSeated: 3 }],
    [
      'final-table',
      { previousEffectiveRemaining: 7, aliveSeated: 6, paidPlaces: 1 },
    ],
    ['last-player', { aliveSeated: 1 }],
  ] as const)('closes at the %s boundary', (reason, override) => {
    expect(evaluateRegistrationClose({ ...open, ...override })).toBe(reason);
  });

  it('uses canonical close priority when boundaries coincide', () => {
    expect(evaluateRegistrationClose({
      ...open,
      now: START + 30 * MINUTE,
      acceptedEntrants: 24,
      currentBigBlind: 1_000,
      aliveSeated: 1,
      previousEffectiveRemaining: 7,
    })).toBe('last-player');
  });

  it('uses effectiveRemaining = aliveSeated + pending entrants', () => {
    expect(evaluateRegistrationClose({
      ...open,
      aliveSeated: 1,
      pendingLateEntrants: 7,
      previousEffectiveRemaining: 9,
    })).toBeNull();
  });

  it('closes disabled late registration before dynamic evaluation', () => {
    expect(evaluateRegistrationClose({
      ...open,
      enabled: false,
      aliveSeated: 1,
    })).toBe('late-reg-disabled');
  });
});
