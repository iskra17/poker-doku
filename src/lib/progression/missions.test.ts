import { describe, expect, it } from 'vitest';
import {
  MISSION_CATALOG,
  assignDailyMissions,
  selectRerollMission,
} from './missions';

describe('daily progression missions', () => {
  it('contains exactly the six immutable non-distorting completion missions', () => {
    expect(MISSION_CATALOG).toHaveLength(6);
    expect(MISSION_CATALOG.map(mission => mission.id)).toEqual([
      'COMPLETE_HANDS_ANY_10',
      'COMPLETE_HANDS_CASH_10',
      'COMPLETE_HANDS_PRACTICE_10',
      'COMPLETE_HANDS_ANY_20',
      'COMPLETE_ONE_SNG',
      'COMPLETE_TWO_MODES',
    ]);
    expect(new Set(MISSION_CATALOG.map(mission => mission.id)).size).toBe(6);
    expect(MISSION_CATALOG.map(mission => mission.metric)).toEqual([
      'handsAny',
      'handsCash',
      'handsPractice',
      'handsAny',
      'sngCompleted',
      'modesCompleted',
    ]);
    expect(MISSION_CATALOG.map(mission => mission.target)).toEqual([
      10, 10, 10, 20, 1, 2,
    ]);
    expect(Object.isFrozen(MISSION_CATALOG)).toBe(true);
    expect(MISSION_CATALOG.every(Object.isFrozen)).toBe(true);

    const serialized = JSON.stringify(MISSION_CATALOG);
    for (const forbidden of [
      'wins', 'showdowns', 'allIns', 'raises', 'betSize', 'cards', 'actions',
      'chips',
    ]) {
      expect(serialized).not.toContain(forbidden);
    }
  });

  it('assigns three unique missions deterministically from stable inputs', () => {
    const first = assignDailyMissions('profile-a', '2026-07-17', 1);
    const restart = assignDailyMissions('profile-a', '2026-07-17', 1);

    expect(first).toEqual(restart);
    expect(first).toHaveLength(3);
    expect(new Set(first.map(mission => mission.id)).size).toBe(3);
    expect(first.every(mission => MISSION_CATALOG.includes(mission))).toBe(true);
    expect(Object.isFrozen(first)).toBe(true);
  });

  it('varies assignments across profiles and dates without losing determinism', () => {
    const assignments = [
      assignDailyMissions('profile-a', '2026-07-17', 1),
      assignDailyMissions('profile-b', '2026-07-17', 1),
      assignDailyMissions('profile-a', '2026-07-18', 1),
    ].map(value => value.map(mission => mission.id).join(','));

    expect(new Set(assignments).size).toBeGreaterThan(1);
  });

  it('selects one deterministic reroll outside current and discarded IDs', () => {
    const assigned = assignDailyMissions('profile-a', '2026-07-17', 1);
    const discarded = assigned[1];
    const replacement = selectRerollMission(
      'profile-a',
      '2026-07-17',
      1,
      assigned.map(mission => mission.id),
      discarded.id,
    );
    const restarted = selectRerollMission(
      'profile-a',
      '2026-07-17',
      1,
      assigned.map(mission => mission.id),
      discarded.id,
    );

    expect(replacement).toEqual(restarted);
    expect(assigned.map(mission => mission.id)).not.toContain(replacement.id);
    expect(replacement.id).not.toBe(discarded.id);
  });

  it.each([
    ['', '2026-07-17', 1],
    ['profile:☃', '2026-07-17', 1],
    ['profile-a', '2026-02-30', 1],
    ['profile-a', '2026-7-17', 1],
    ['profile-a', '2026-07-17', 0],
    ['profile-a', '2026-07-17', Number.MAX_SAFE_INTEGER + 1],
  ])('rejects invalid assignment input %#', (profileId, date, version) => {
    expect(() => assignDailyMissions(profileId, date, version))
      .toThrowError('MISSION_INPUT_INVALID');
  });
});
