import { describe, expect, it } from 'vitest';
import { ARENA_CONFIG_V1 } from './config';
import {
  compareWeeklyStandings,
  pointsForPlace,
  rankWeeklyStandings,
  selectWeeklyMoves,
  softResetMmr,
  softResetTier,
  tierForPlacementTotal,
} from './rules';
import type { ArenaTier, WeeklyStanding } from './types';

function standing(
  profileId: string,
  points: number,
  overrides: Partial<Omit<WeeklyStanding, 'profileId' | 'points'>> = {},
): WeeklyStanding {
  return {
    profileId,
    points,
    wins: 0,
    top3: 0,
    placeSum: 12,
    matches: 3,
    scoreReachedAt: 1_000,
    ...overrides,
  };
}

function group(size: number): WeeklyStanding[] {
  return Array.from({ length: size }, (_, index) =>
    standing(`p${String(index + 1).padStart(2, '0')}`, size - index),
  );
}

describe('arena version 1 configuration and scoring', () => {
  it('keeps every approved version 1 constant immutable', () => {
    expect(ARENA_CONFIG_V1).toEqual({
      version: 1,
      seasonWeeks: 4,
      startingTickets: 2,
      dailyTickets: 2,
      ticketCap: 10,
      queueTimeoutMs: 60_000,
      queueInitialMmrRange: 100,
      queueRangeStep: 50,
      queueRangeStepMs: 10_000,
      queueFallbackAtMs: 60_000,
      minimumHumansForOfficial: 2,
      seats: 6,
      startingStack: 1_500,
      placementMatches: 5,
      pointsByPlace: [100, 60, 35, 15, 5, 0],
      promotionGamesRequired: 3,
      weeklyMoveRate: 0.2,
      targetGroupMin: 20,
      targetGroupMax: 30,
      initialMmr: 1_000,
      placementMmrK: 48,
      normalMmrK: 32,
      mmrDeltaCap: 32,
      botVersion: 'arena-v1-hard',
    });
    expect(Object.isFrozen(ARENA_CONFIG_V1)).toBe(true);
    expect(Object.isFrozen(ARENA_CONFIG_V1.pointsByPlace)).toBe(true);
  });

  it('awards the exact points for all six places', () => {
    expect([1, 2, 3, 4, 5, 6].map(pointsForPlace))
      .toEqual([100, 60, 35, 15, 5, 0]);
  });

  it('maps every placement boundary to bronze, silver, or gold', () => {
    expect(tierForPlacementTotal(0)).toBe('bronze');
    expect(tierForPlacementTotal(174)).toBe('bronze');
    expect(tierForPlacementTotal(175)).toBe('silver');
    expect(tierForPlacementTotal(324)).toBe('silver');
    expect(tierForPlacementTotal(325)).toBe('gold');
    expect(tierForPlacementTotal(500)).toBe('gold');
  });

  it('rejects impossible places and placement totals', () => {
    for (const place of [0, 7, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => pointsForPlace(place)).toThrowError('ARENA_PLACE_INVALID');
    }
    for (const total of [-1, 501, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => tierForPlacementTotal(total))
        .toThrowError('ARENA_PLACEMENT_TOTAL_INVALID');
    }
  });
});

describe('weekly arena ranking', () => {
  it('orders by points, wins, top-three finishes, average place, reached time, then profile id', () => {
    const rows = [
      standing('points-low', 99, { wins: 99, top3: 99, placeSum: 100, matches: 100 }),
      standing('wins-low', 100, { wins: 1, top3: 3, placeSum: 3, matches: 3 }),
      standing('top3-low', 100, { wins: 2, top3: 2, placeSum: 3, matches: 3 }),
      standing('average-low', 100, { wins: 2, top3: 3, placeSum: 6, matches: 3 }),
      standing('reached-late', 100, { wins: 2, top3: 3, placeSum: 3, matches: 3, scoreReachedAt: 2_000 }),
      standing('b-id', 100, { wins: 2, top3: 3, placeSum: 3, matches: 3, scoreReachedAt: 1_000 }),
      standing('a-id', 100, { wins: 2, top3: 3, placeSum: 3, matches: 3, scoreReachedAt: 1_000 }),
    ];

    expect(rankWeeklyStandings(rows).map(row => row.profileId)).toEqual([
      'a-id',
      'b-id',
      'reached-late',
      'average-low',
      'top3-low',
      'wins-low',
      'points-low',
    ]);
  });

  it('compares average place numerically and puts zero-match rows last without exposing an average', () => {
    const exactThird = standing('third', 10, { placeSum: 9, matches: 3 });
    const worse = standing('worse', 10, { placeSum: 10, matches: 3 });
    const noGames = standing('none', 10, { placeSum: 0, matches: 0 });

    expect(compareWeeklyStandings(exactThird, worse)).toBeLessThan(0);
    expect(compareWeeklyStandings(worse, noGames)).toBeLessThan(0);
    expect(Object.keys(noGames)).not.toContain('averagePlace');
  });

  it('returns a new sorted array without mutating rows or input order', () => {
    const first = Object.freeze(standing('first', 1));
    const second = Object.freeze(standing('second', 2));
    const input = Object.freeze([first, second]);

    const ranked = rankWeeklyStandings(input);

    expect(ranked.map(row => row.profileId)).toEqual(['second', 'first']);
    expect(input.map(row => row.profileId)).toEqual(['first', 'second']);
    expect(ranked[0]).toBe(second);
  });

  it('uses binary profile ordering rather than locale-sensitive sorting', () => {
    const upper = standing('Z', 10);
    const lower = standing('a', 10);
    expect(rankWeeklyStandings([lower, upper]).map(row => row.profileId))
      .toEqual(['Z', 'a']);
  });

  it('rejects malformed standing values instead of producing NaN or unstable output', () => {
    const valid = standing('valid', 1);
    const invalidRows: WeeklyStanding[] = [
      { ...valid, profileId: '' },
      { ...valid, points: Number.NaN },
      { ...valid, wins: -1 },
      { ...valid, top3: 4 },
      { ...valid, matches: 2.5 },
      { ...valid, placeSum: Number.POSITIVE_INFINITY },
      { ...valid, scoreReachedAt: -1 },
    ];
    for (const row of invalidRows) {
      expect(() => compareWeeklyStandings(valid, row))
        .toThrowError('ARENA_STANDING_INVALID');
    }
  });
});

describe('weekly promotion and demotion', () => {
  it.each([
    [5, 1],
    [20, 4],
    [30, 6],
  ])('moves 20 percent of a %i-person group (%i each way)', (size, count) => {
    const moves = selectWeeklyMoves('gold', group(size));
    expect(moves.promotedProfileIds).toHaveLength(count);
    expect(moves.demotedProfileIds).toHaveLength(count);
    expect(moves.promotedProfileIds).toEqual(
      group(size).slice(0, count).map(row => row.profileId),
    );
    expect(moves.demotedProfileIds).toEqual(
      group(size).slice(-count).reverse().map(row => row.profileId),
    );
  });

  it('fills promotion slots from the highest ranked eligible candidates', () => {
    const rows = group(5).map((row, index) => ({
      ...row,
      matches: index === 0 ? 2 : 3,
    }));
    expect(selectWeeklyMoves('gold', rows).promotedProfileIds).toEqual(['p02']);
  });

  it('demotes from the bottom regardless of games and never selects one profile twice', () => {
    const rows = group(5).map((row, index) => ({
      ...row,
      matches: index === 4 ? 3 : 2,
    }));
    const moves = selectWeeklyMoves('gold', rows);
    expect(moves.promotedProfileIds).toEqual(['p05']);
    expect(moves.demotedProfileIds).toEqual(['p04']);
  });

  it('does not demote small groups and promotes only their best eligible player', () => {
    const rows = group(4).map((row, index) => ({
      ...row,
      matches: index === 0 ? 2 : 3,
    }));
    expect(selectWeeklyMoves('silver', rows)).toEqual({
      promotedProfileIds: ['p02'],
      demotedProfileIds: [],
    });
  });

  it('returns no small-group promotion when nobody completed three games', () => {
    const rows = group(4).map(row => ({ ...row, matches: 2 }));
    expect(selectWeeklyMoves('silver', rows).promotedProfileIds).toEqual([]);
  });

  it('prevents bronze demotion and master promotion', () => {
    expect(selectWeeklyMoves('bronze', group(5))).toEqual({
      promotedProfileIds: ['p01'],
      demotedProfileIds: [],
    });
    expect(selectWeeklyMoves('master', group(5))).toEqual({
      promotedProfileIds: [],
      demotedProfileIds: ['p05'],
    });
  });
});

describe('arena season soft reset', () => {
  it.each<[ArenaTier, ArenaTier]>([
    ['bronze', 'bronze'],
    ['silver', 'bronze'],
    ['gold', 'silver'],
    ['platinum', 'gold'],
    ['diamond', 'platinum'],
    ['master', 'diamond'],
  ])('moves %s exactly one tier down to %s', (from, to) => {
    expect(softResetTier(from)).toBe(to);
  });

  it('regresses hidden MMR halfway toward 1000 with deterministic rounding', () => {
    expect(softResetMmr(1_400)).toBe(1_200);
    expect(softResetMmr(600)).toBe(800);
    expect(softResetMmr(1_001)).toBe(1_001);
    expect(softResetMmr(999)).toBe(1_000);
  });

  it('rejects an unsafe hidden MMR', () => {
    for (const mmr of [1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => softResetMmr(mmr)).toThrowError('ARENA_MMR_INVALID');
    }
  });
});
