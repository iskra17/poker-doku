import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ArenaTier, WeeklyStanding } from '@/lib/arena/types';
import { ArenaRepository } from './arena-repository';
import {
  ArenaDomainError,
  ArenaService,
  calculateArenaSeasonWindow,
  getArenaKstWeekKey,
  parseArenaRuntimeConfig,
} from './arena-service';
import { openPokerDatabase, type PokerDatabase } from './persistence/database';

const EPOCH_TEXT = '2026-07-20T00:00:00+09:00';
const EPOCH = Date.parse(EPOCH_TEXT);
const DAY = 24 * 60 * 60 * 1_000;

describe('Arena season configuration and windows', () => {
  it('is disabled by default and requires explicit valid config when enabled', () => {
    expect(parseArenaRuntimeConfig({})).toMatchObject({ enabled: false });
    expect(() => parseArenaRuntimeConfig({ ARENA_ENABLED: 'true' }))
      .toThrowError('ARENA_SEASON_EPOCH_REQUIRED');
    expect(() => parseArenaRuntimeConfig({ ARENA_ENABLED: 'yes' }))
      .toThrowError('ARENA_ENABLED_INVALID');
  });

  it.each([
    '2026-07-20T00:00:00Z',
    '2026-07-20T00:00:00+08:00',
    '2026-07-20T01:00:00+09:00',
    '2026-07-21T00:00:00+09:00',
    '2026-02-30T00:00:00+09:00',
    '9999-12-06T00:00:00+09:00',
  ])('rejects an invalid explicit KST Monday epoch: %s', epoch => {
    expect(() => parseArenaRuntimeConfig({
      ARENA_ENABLED: 'true',
      ARENA_SEASON_EPOCH_KST: epoch,
    })).toThrowError('ARENA_SEASON_EPOCH_INVALID');
  });

  it('parses the exact enabled defaults and rejects malformed preseason counts', () => {
    expect(parseArenaRuntimeConfig({
      ARENA_ENABLED: 'true',
      ARENA_SEASON_EPOCH_KST: EPOCH_TEXT,
    })).toEqual({ enabled: true, epochMs: EPOCH, preseasonCount: 1 });
    for (const value of ['-1', '1.5', 'x', '']) {
      expect(() => parseArenaRuntimeConfig({
        ARENA_ENABLED: 'true',
        ARENA_SEASON_EPOCH_KST: EPOCH_TEXT,
        ARENA_PRESEASON_COUNT: value,
      })).toThrowError('ARENA_PRESEASON_COUNT_INVALID');
    }
  });

  it('calculates four exact KST weeks and only the first segment as preseason', () => {
    const config = { epochMs: EPOCH, preseasonCount: 1 };
    expect(calculateArenaSeasonWindow(EPOCH, config)).toEqual({
      id: 'arena-v1-0', ordinal: 0, preseason: true,
      startsAt: EPOCH, endsAt: EPOCH + 28 * DAY, week: 1,
    });
    expect(calculateArenaSeasonWindow(EPOCH + 7 * DAY - 1, config).week).toBe(1);
    expect(calculateArenaSeasonWindow(EPOCH + 7 * DAY, config).week).toBe(2);
    expect(calculateArenaSeasonWindow(EPOCH + 21 * DAY, config).week).toBe(4);
    expect(calculateArenaSeasonWindow(EPOCH + 28 * DAY, config)).toEqual({
      id: 'arena-v1-1', ordinal: 1, preseason: false,
      startsAt: EPOCH + 28 * DAY,
      endsAt: EPOCH + 56 * DAY,
      week: 1,
    });
    expect(() => calculateArenaSeasonWindow(EPOCH - 1, config))
      .toThrowError('ARENA_SEASON_NOT_STARTED');
  });

  it('keeps Fly production disabled with the approved epoch and preseason', () => {
    const fly = readFileSync(resolve(process.cwd(), 'fly.toml'), 'utf8');
    expect(fly).toContain('ARENA_ENABLED = "false"');
    expect(fly).toContain(`ARENA_SEASON_EPOCH_KST = "${EPOCH_TEXT}"`);
    expect(fly).toContain('ARENA_PRESEASON_COUNT = "1"');
  });
});

describe('ArenaService free ticket lifecycle', () => {
  let database: PokerDatabase;
  let repository: ArenaRepository;
  let service: ArenaService;
  let inMemoryOccupied: Set<string>;

  beforeEach(() => {
    database = openPokerDatabase(':memory:');
    repository = new ArenaRepository(database);
    for (const id of ['profile-a', 'profile-b', 'profile-c']) {
      insertBaseProfile(database, id);
    }
    inMemoryOccupied = new Set();
    service = new ArenaService(repository, {
      epochMs: EPOCH,
      preseasonCount: 1,
      clock: () => EPOCH,
      isProfileInNonArenaSeat: profileId => (
        hasActiveWalletSeat(database, profileId)
        || inMemoryOccupied.has(profileId)
      ),
    });
  });

  afterEach(() => database.close());

  it('lazily creates one season/profile and gives only two creation-day tickets', () => {
    expect(service.getSnapshot('profile-a', EPOCH).profile.availableTickets).toBe(2);
    expect(service.getSnapshot('profile-a', EPOCH + DAY - 1).profile.availableTickets)
      .toBe(2);
    expect(repository.requireProfile('arena-v1-0', 'profile-a')).toMatchObject({
      availableTickets: 2,
      lastDailyGrantDate: '2026-07-20',
      placementGames: 0,
      placementPoints: 0,
      tier: null,
      mmr: 1_000,
    });
    expect(countRows(database, 'arena_seasons')).toBe(1);
    expect(countRows(database, 'arena_profiles')).toBe(1);
  });

  it('grants exactly two once on a later KST date without missed-day carry', () => {
    expect(service.getSnapshot('profile-a', EPOCH).profile.availableTickets).toBe(2);
    expect(service.getSnapshot('profile-a', EPOCH + DAY).profile.availableTickets)
      .toBe(4);
    expect(service.getSnapshot('profile-a', EPOCH + DAY + 1).profile.availableTickets)
      .toBe(4);
    expect(service.getSnapshot('profile-a', EPOCH + 10 * DAY).profile.availableTickets)
      .toBe(6);
    expect(repository.requireProfile('arena-v1-0', 'profile-a').lastDailyGrantDate)
      .toBe('2026-07-30');
  });

  it('caps a 9-ticket profile at 10 and advances the grant date while capped', () => {
    service.getSnapshot('profile-a', EPOCH);
    updateAvailable(repository, 'profile-a', 9, EPOCH);
    expect(service.getSnapshot('profile-a', EPOCH + DAY).profile.availableTickets)
      .toBe(10);
    expect(service.getSnapshot('profile-a', EPOCH + 2 * DAY).profile.availableTickets)
      .toBe(10);
    expect(repository.requireProfile('arena-v1-0', 'profile-a').lastDailyGrantDate)
      .toBe('2026-07-22');
  });

  it('reserves every participant atomically and creates forming entries', () => {
    const match = service.reserveMatchTickets(
      'match-a', ['profile-a', 'profile-b'], EPOCH,
    );
    expect(match).toMatchObject({
      id: 'match-a', seasonId: 'arena-v1-0', humanCount: 2, botCount: 4,
      status: 'forming', botVersion: 'arena-v1-hard', botMmr: 1_000,
    });
    expect(repository.requireProfile('arena-v1-0', 'profile-a').availableTickets)
      .toBe(1);
    expect(repository.requireProfile('arena-v1-0', 'profile-b').availableTickets)
      .toBe(1);
    expect(repository.listMatchEntries('match-a').map(row => row.profileId))
      .toEqual(['profile-a', 'profile-b']);
    expect(repository.findActiveTicketEscrow('profile-a')?.status).toBe('escrow');
  });

  it('rounds the human MMR average to 50 and clamps the bot snapshot', () => {
    service.getSnapshot('profile-a', EPOCH);
    service.getSnapshot('profile-b', EPOCH);
    updateMmr(repository, 'profile-a', 100);
    updateMmr(repository, 'profile-b', 200);
    expect(service.reserveMatchTickets(
      'match-low',
      ['profile-a', 'profile-b'],
      EPOCH,
    ).botMmr).toBe(800);
    service.voidMatch('match-low', EPOCH + 1);

    updateMmr(repository, 'profile-a', 1_900);
    updateMmr(repository, 'profile-b', 2_000);
    expect(service.reserveMatchTickets(
      'match-high',
      ['profile-a', 'profile-b'],
      EPOCH + 2,
    ).botMmr).toBe(1_400);
  });

  it('rolls back every reservation write on insufficient tickets', () => {
    service.getSnapshot('profile-b', EPOCH);
    updateAvailable(repository, 'profile-b', 0, EPOCH);
    expectDomain(
      () => service.reserveMatchTickets('match-a', ['profile-a', 'profile-b'], EPOCH),
      'ARENA_TICKET_INSUFFICIENT',
    );
    expect(repository.findMatch('match-a')).toBeNull();
    expect(repository.findProfile('arena-v1-0', 'profile-a')).toBeNull();
    expect(repository.requireProfile('arena-v1-0', 'profile-b').availableTickets)
      .toBe(0);
  });

  it('rechecks an active wallet seat escrow inside the reservation transaction', () => {
    service.getSnapshot('profile-a', EPOCH);
    service.getSnapshot('profile-b', EPOCH);
    database.db.prepare(`
      INSERT INTO seat_escrows (
        id, profile_id, room_id, mode, amount, checkpoint_amount,
        checkpoint_hand, status, updated_at
      ) VALUES ('cash-seat-b', 'profile-b', 'cash-room', 'cash', 1000, 1000,
        0, 'active', ?)
    `).run(EPOCH);

    expectDomain(
      () => service.reserveMatchTickets('match-a', ['profile-a', 'profile-b'], EPOCH),
      'ARENA_NON_ARENA_SEAT_ACTIVE',
    );
    expect(repository.findMatch('match-a')).toBeNull();
    expect(repository.requireProfile('arena-v1-0', 'profile-a').availableTickets)
      .toBe(2);
    expect(repository.requireProfile('arena-v1-0', 'profile-b').availableTickets)
      .toBe(2);
  });

  it('catches a casual/practice/SnG seat that appears after the earlier check', () => {
    service.getSnapshot('profile-a', EPOCH);
    service.getSnapshot('profile-b', EPOCH);
    inMemoryOccupied.add('profile-b');

    expectDomain(
      () => service.reserveMatchTickets('match-a', ['profile-a', 'profile-b'], EPOCH),
      'ARENA_NON_ARENA_SEAT_ACTIVE',
    );
    expect(repository.findMatch('match-a')).toBeNull();
    expect(repository.requireProfile('arena-v1-0', 'profile-a').availableTickets)
      .toBe(2);
    expect(repository.requireProfile('arena-v1-0', 'profile-b').availableTickets)
      .toBe(2);
  });

  it('rolls back lazy initialization when the participation authority throws', () => {
    const guarded = new ArenaService(repository, {
      epochMs: EPOCH,
      preseasonCount: 1,
      isProfileInNonArenaSeat: profileId => {
        if (profileId === 'profile-b') throw new Error('guard-unavailable');
        return false;
      },
    });

    expect(() => guarded.reserveMatchTickets(
      'match-a', ['profile-a', 'profile-b'], EPOCH,
    )).toThrowError('guard-unavailable');
    expect(repository.findMatch('match-a')).toBeNull();
    expect(repository.findProfile('arena-v1-0', 'profile-a')).toBeNull();
    expect(repository.findProfile('arena-v1-0', 'profile-b')).toBeNull();
  });

  it('rejects duplicate players, active escrow, and stale season atomically', () => {
    expectDomain(
      () => service.reserveMatchTickets('dup', ['profile-a', 'profile-a'], EPOCH),
      'ARENA_PROFILE_LIST_INVALID',
    );
    service.reserveMatchTickets('match-a', ['profile-a', 'profile-b'], EPOCH);
    expectDomain(
      () => service.reserveMatchTickets('match-b', ['profile-a', 'profile-c'], EPOCH),
      'ARENA_TICKET_ALREADY_ESCROWED',
    );
    expect(repository.findMatch('match-b')).toBeNull();
    expect(repository.findProfile('arena-v1-0', 'profile-c')).toBeNull();
    expectDomain(
      () => service.reserveMatchTickets(
        'stale', ['profile-b', 'profile-c'], EPOCH + 28 * DAY, 'arena-v1-0',
      ),
      'ARENA_SEASON_MISMATCH',
    );
    expect(repository.findMatch('stale')).toBeNull();
  });

  it('does not expose premature ticket consumption outside result settlement', () => {
    expect('consumeMatchTickets' in service).toBe(false);
  });

  it('voids and refunds exactly once while respecting escrow-aware cap', () => {
    service.getSnapshot('profile-a', EPOCH);
    service.getSnapshot('profile-b', EPOCH);
    updateAvailable(repository, 'profile-a', 9, EPOCH);
    updateAvailable(repository, 'profile-b', 9, EPOCH);
    service.reserveMatchTickets('match-a', ['profile-a', 'profile-b'], EPOCH);
    expect(service.getSnapshot('profile-a', EPOCH + DAY).profile.availableTickets)
      .toBe(9);
    service.voidMatch('match-a', EPOCH + DAY + 1);
    service.voidMatch('match-a', EPOCH + DAY + 2);
    expect(repository.requireProfile('arena-v1-0', 'profile-a').availableTickets)
      .toBe(10);
    expect(repository.requireTicketEscrow('match-a', 'profile-a')).toMatchObject({
      status: 'refunded', settledAt: EPOCH + DAY + 1,
    });
    expect(repository.requireMatch('match-a').status).toBe('void');
  });

  it('reconciles the same current season repeatedly without duplicate rows', () => {
    service.reconcile(EPOCH);
    service.reconcile(EPOCH);
    expect(countRows(database, 'arena_seasons')).toBe(1);
  });

  it('settles an official result exactly once and returns the stable public summary', () => {
    service.reserveMatchTickets('match-a', ['profile-a', 'profile-b'], EPOCH);
    service.markMatchPlaying('match-a', EPOCH + 1);
    const result = sixSeatResult([
      ['profile-a', 1],
      ['profile-b', 4],
    ]);

    const first = service.settleOfficialMatch('match-a', result, EPOCH + 2);
    const duplicate = service.settleOfficialMatch(
      'match-a',
      sixSeatResult([
        ['profile-a', 6],
        ['profile-b', 5],
      ]),
      EPOCH + 3,
    );

    expect(duplicate).toEqual(first);
    expect(first).toEqual({
      matchId: 'match-a',
      finishedAt: EPOCH + 2,
      results: [
        { profileId: 'profile-a', place: 1, points: 100 },
        { profileId: 'profile-b', place: 4, points: 15 },
      ],
    });
    expect(JSON.stringify(first)).not.toMatch(/mmr|bot|ticket/iu);
    expect(repository.requireMatch('match-a')).toMatchObject({
      status: 'finished',
      finishedAt: EPOCH + 2,
    });
    expect(repository.requireTicketEscrow('match-a', 'profile-a')).toMatchObject({
      status: 'consumed',
      settledAt: EPOCH + 2,
    });
    expect(repository.requireProfile('arena-v1-0', 'profile-a')).toMatchObject({
      availableTickets: 1,
      placementGames: 1,
      placementPoints: 100,
      tier: null,
      mmr: 1_024,
    });
    expect(repository.requireProfile('arena-v1-0', 'profile-b')).toMatchObject({
      availableTickets: 1,
      placementGames: 1,
      placementPoints: 15,
      tier: null,
      mmr: 995,
    });
    expect(repository.listMatchEntries('match-a')).toEqual([
      expect.objectContaining({
        profileId: 'profile-a', place: 1, points: 100, mmrAfter: 1_024,
        resultKey: 'match-a:profile-a', settledAt: EPOCH + 2,
      }),
      expect.objectContaining({
        profileId: 'profile-b', place: 4, points: 15, mmrAfter: 995,
        resultKey: 'match-a:profile-b', settledAt: EPOCH + 2,
      }),
    ]);
  });

  it('assigns the initial tier on the fifth placement result', () => {
    service.getSnapshot('profile-a', EPOCH);
    seedPlacement(repository, 'profile-a', [60, 60, 60, 60]);
    service.reserveMatchTickets('match-a', ['profile-a', 'profile-b'], EPOCH);
    service.markMatchPlaying('match-a', EPOCH + 1);

    service.settleOfficialMatch(
      'match-a',
      sixSeatResult([
        ['profile-a', 1],
        ['profile-b', 6],
      ]),
      EPOCH + 2,
    );

    expect(repository.requireProfile('arena-v1-0', 'profile-a')).toMatchObject({
      placementGames: 5,
      placementPoints: 340,
      tier: 'gold',
    });
    const weekKey = getArenaKstWeekKey(EPOCH);
    expect(repository.findGroupMember(
      'arena-v1-0',
      weekKey,
      'profile-a',
    )).toBeNull();
    expect(countRows(database, 'arena_groups')).toBe(0);

    service.reserveMatchTickets(
      'match-b',
      ['profile-a', 'profile-b'],
      EPOCH + 3,
    );
    service.markMatchPlaying('match-b', EPOCH + 3);
    service.settleOfficialMatch(
      'match-b',
      sixSeatResult([
        ['profile-a', 2],
        ['profile-b', 6],
      ]),
      EPOCH + 4,
    );

    const member = repository.findGroupMember(
      'arena-v1-0',
      weekKey,
      'profile-a',
    );
    expect(member).toMatchObject({
      profileId: 'profile-a',
      points: 60,
      wins: 0,
      top3: 1,
      placeSum: 2,
      matches: 1,
      scoreReachedAt: EPOCH + 4,
      joinedAt: EPOCH + 4,
      updatedAt: EPOCH + 4,
    });
    expect(repository.requireGroup(member!.groupId)).toMatchObject({
      seasonId: 'arena-v1-0',
      weekKey,
      tier: 'gold',
      status: 'open',
    });
  });

  it('updates the current weekly group stats only for an already placed profile', () => {
    service.getSnapshot('profile-a', EPOCH);
    seedPlacement(repository, 'profile-a', [35, 35, 35, 35, 35]);
    const weekKey = getArenaKstWeekKey(EPOCH);
    repository.transaction(tx => {
      tx.insertGroup({
        id: 'group-a',
        seasonId: 'arena-v1-0',
        weekKey,
        tier: 'silver',
        status: 'open',
        createdAt: EPOCH,
        settledAt: null,
      });
      tx.insertGroupMember({
        groupId: 'group-a',
        seasonId: 'arena-v1-0',
        weekKey,
        profileId: 'profile-a',
        points: 60,
        wins: 0,
        top3: 1,
        placeSum: 3,
        matches: 1,
        scoreReachedAt: EPOCH,
        joinedAt: EPOCH,
        updatedAt: EPOCH,
      });
    });
    service.reserveMatchTickets('match-a', ['profile-a', 'profile-b'], EPOCH);
    service.markMatchPlaying('match-a', EPOCH + 1);

    service.settleOfficialMatch(
      'match-a',
      sixSeatResult([
        ['profile-a', 1],
        ['profile-b', 2],
      ]),
      EPOCH + 2,
    );

    expect(repository.listGroupMembers('group-a')).toEqual([
      expect.objectContaining({
        profileId: 'profile-a',
        points: 160,
        wins: 1,
        top3: 2,
        placeSum: 4,
        matches: 2,
        scoreReachedAt: EPOCH + 2,
        updatedAt: EPOCH + 2,
      }),
    ]);
    service.settleOfficialMatch(
      'match-a',
      sixSeatResult([
        ['profile-a', 6],
        ['profile-b', 1],
      ]),
      EPOCH + 3,
    );
    expect(repository.listGroupMembers('group-a')).toEqual([
      expect.objectContaining({
        profileId: 'profile-a',
        points: 160,
        wins: 1,
        top3: 2,
        placeSum: 4,
        matches: 2,
        scoreReachedAt: EPOCH + 2,
        updatedAt: EPOCH + 2,
      }),
    ]);

    service.reserveMatchTickets('match-b', ['profile-a', 'profile-c'], EPOCH + 3);
    service.markMatchPlaying('match-b', EPOCH + 3);
    service.settleOfficialMatch(
      'match-b',
      sixSeatResult([
        ['profile-a', 6],
        ['profile-c', 1],
      ]),
      EPOCH + 4,
    );
    expect(repository.listGroupMembers('group-a')).toEqual([
      expect.objectContaining({
        profileId: 'profile-a',
        points: 160,
        wins: 1,
        top3: 2,
        placeSum: 10,
        matches: 3,
        scoreReachedAt: EPOCH + 2,
        updatedAt: EPOCH + 4,
      }),
    ]);
  });

  it('fills the oldest weekly tier group to 30 before creating another group', () => {
    service.getSnapshot('profile-a', EPOCH);
    service.getSnapshot('profile-b', EPOCH);
    seedPlacement(repository, 'profile-a', [35, 35, 35, 35, 35]);
    seedPlacement(repository, 'profile-b', [35, 35, 35, 35, 35]);
    const weekKey = getArenaKstWeekKey(EPOCH);
    const oldestIds = seedPlacedGroupMembers(
      database,
      repository,
      'oldest',
      'group-oldest',
      weekKey,
      'silver',
      29,
      EPOCH,
    );
    const fullIds = seedPlacedGroupMembers(
      database,
      repository,
      'full',
      'group-full',
      weekKey,
      'silver',
      30,
      EPOCH + 1,
    );

    service.reserveMatchTickets(
      'match-cap',
      ['profile-a', 'profile-b'],
      EPOCH + 2,
    );
    service.markMatchPlaying('match-cap', EPOCH + 2);
    service.settleOfficialMatch(
      'match-cap',
      sixSeatResult([
        ['profile-a', 1],
        ['profile-b', 2],
      ]),
      EPOCH + 3,
    );

    expect(repository.listGroupMembers('group-oldest')).toHaveLength(30);
    expect(repository.listGroupMembers('group-full')).toHaveLength(30);
    expect(repository.findGroupMember(
      'arena-v1-0',
      weekKey,
      'profile-a',
    )?.groupId).toBe('group-oldest');
    const secondMember = repository.findGroupMember(
      'arena-v1-0',
      weekKey,
      'profile-b',
    );
    expect(secondMember?.groupId).not.toBe('group-oldest');
    expect(secondMember?.groupId).not.toBe('group-full');
    expect(countRows(database, 'arena_groups')).toBe(3);
    expect(new Set([
      ...oldestIds,
      ...fullIds,
      'profile-a',
      'profile-b',
    ]).size).toBe(61);
  });

  it('uses one deterministic uncapped Master group for the KST week', () => {
    service.getSnapshot('profile-a', EPOCH);
    service.getSnapshot('profile-b', EPOCH);
    seedPlacement(repository, 'profile-a', [35, 35, 35, 35, 35]);
    seedPlacement(repository, 'profile-b', [35, 35, 35, 35, 35]);
    setProfileTier(repository, 'profile-a', 'master', EPOCH);
    setProfileTier(repository, 'profile-b', 'master', EPOCH);
    const weekKey = getArenaKstWeekKey(EPOCH);
    const masterId = `master-global:arena-v1-0:${weekKey}`;
    seedPlacedGroupMembers(
      database,
      repository,
      'master',
      masterId,
      weekKey,
      'master',
      30,
      EPOCH,
    );

    service.reserveMatchTickets(
      'match-master',
      ['profile-a', 'profile-b'],
      EPOCH + 1,
    );
    service.markMatchPlaying('match-master', EPOCH + 1);
    service.settleOfficialMatch(
      'match-master',
      sixSeatResult([
        ['profile-a', 1],
        ['profile-b', 6],
      ]),
      EPOCH + 2,
    );

    expect(repository.listGroupMembers(masterId)).toHaveLength(32);
    expect(repository.findGroupMember(
      'arena-v1-0',
      weekKey,
      'profile-a',
    )?.groupId).toBe(masterId);
    expect(repository.findGroupMember(
      'arena-v1-0',
      weekKey,
      'profile-b',
    )?.groupId).toBe(masterId);
    expect(countRows(database, 'arena_groups')).toBe(1);
  });

  it('settles weekly moves once while preserving the closed group audit', () => {
    service.reconcile(EPOCH);
    const weekKey = getArenaKstWeekKey(EPOCH);
    const standings = weeklyStandings('move', 5);
    seedWeeklyGroup(
      database,
      repository,
      'group-moves',
      weekKey,
      'silver',
      standings,
      EPOCH,
    );
    const beforeMembers = repository.listGroupMembers('group-moves');
    const boundary = EPOCH + 7 * DAY;

    service.reconcile(boundary);

    expect(repository.requireProfile(
      'arena-v1-0',
      standings[0].profileId,
    ).tier).toBe('gold');
    expect(repository.requireProfile(
      'arena-v1-0',
      standings[4].profileId,
    ).tier).toBe('bronze');
    expect(repository.requireProfile(
      'arena-v1-0',
      standings[2].profileId,
    ).tier).toBe('silver');
    expect(repository.requireGroup('group-moves')).toMatchObject({
      status: 'settled',
      settledAt: boundary,
    });
    expect(repository.findWeeklySettlement(
      'arena-v1-0',
      weekKey,
      'group-moves',
    )).toEqual({
      seasonId: 'arena-v1-0',
      weekKey,
      groupId: 'group-moves',
      settledAt: boundary,
    });
    expect(repository.listGroupMembers('group-moves')).toEqual(beforeMembers);

    service.reconcile(boundary + 1);
    expect(repository.findWeeklySettlement(
      'arena-v1-0',
      weekKey,
      'group-moves',
    )?.settledAt).toBe(boundary);
    expect(repository.listGroupMembers('group-moves')).toEqual(beforeMembers);
  });

  it('commits each weekly group independently and retries after the first failure', () => {
    service.reconcile(EPOCH);
    const weekKey = getArenaKstWeekKey(EPOCH);
    seedWeeklyGroup(
      database,
      repository,
      'group-a',
      weekKey,
      'silver',
      weeklyStandings('retry-a', 5),
      EPOCH,
    );
    seedWeeklyGroup(
      database,
      repository,
      'group-b',
      weekKey,
      'silver',
      weeklyStandings('retry-b', 5),
      EPOCH + 1,
    );
    const requireProfile = repository.requireProfile.bind(repository);
    const failure = vi.spyOn(repository, 'requireProfile')
      .mockImplementation((seasonId, profileId) => {
        if (profileId.startsWith('retry-b')) throw new Error('group-b-failed');
        return requireProfile(seasonId, profileId);
      });
    const boundary = EPOCH + 7 * DAY;

    expect(() => service.reconcile(boundary)).toThrow('group-b-failed');
    failure.mockRestore();

    expect(repository.requireGroup('group-a').status).toBe('settled');
    expect(repository.findWeeklySettlement(
      'arena-v1-0',
      weekKey,
      'group-a',
    )?.settledAt).toBe(boundary);
    expect(repository.requireGroup('group-b').status).toBe('open');
    expect(repository.findWeeklySettlement(
      'arena-v1-0',
      weekKey,
      'group-b',
    )).toBeNull();

    service.reconcile(boundary + 1);
    expect(repository.findWeeklySettlement(
      'arena-v1-0',
      weekKey,
      'group-a',
    )?.settledAt).toBe(boundary);
    expect(repository.findWeeklySettlement(
      'arena-v1-0',
      weekKey,
      'group-b',
    )?.settledAt).toBe(boundary + 1);
  });

  it('settles week four before creating the next season at the shared boundary', () => {
    service.reconcile(EPOCH);
    const weekFourAt = EPOCH + 21 * DAY;
    const weekKey = getArenaKstWeekKey(weekFourAt);
    seedWeeklyGroup(
      database,
      repository,
      'week-four',
      weekKey,
      'silver',
      weeklyStandings('week-four', 5),
      weekFourAt,
    );
    const requireProfile = repository.requireProfile.bind(repository);
    const failure = vi.spyOn(repository, 'requireProfile')
      .mockImplementation((seasonId, profileId) => {
        if (profileId.startsWith('week-four')) {
          throw new Error('week-four-failed');
        }
        return requireProfile(seasonId, profileId);
      });
    const seasonBoundary = EPOCH + 28 * DAY;

    expect(() => service.reconcile(seasonBoundary))
      .toThrow('week-four-failed');
    expect(repository.findSeason('arena-v1-1')).toBeNull();
    failure.mockRestore();

    service.reconcile(seasonBoundary);
    expect(repository.findWeeklySettlement(
      'arena-v1-0',
      weekKey,
      'week-four',
    )).not.toBeNull();
    expect(repository.findSeason('arena-v1-1')).not.toBeNull();
  });

  it('rolls the whole result transaction back on an invalid six-seat result', () => {
    service.reserveMatchTickets('match-a', ['profile-a', 'profile-b'], EPOCH);
    service.markMatchPlaying('match-a', EPOCH + 1);
    const beforeA = repository.requireProfile('arena-v1-0', 'profile-a');

    expectDomain(
      () => service.settleOfficialMatch('match-a', [
        { playerId: 'profile-a', place: 1, type: 'human' },
        { playerId: 'profile-b', place: 1, type: 'human' },
      ], EPOCH + 2),
      'ARENA_RESULT_INVALID',
    );

    expect(repository.requireMatch('match-a').status).toBe('playing');
    expect(repository.requireProfile('arena-v1-0', 'profile-a')).toEqual(beforeA);
    expect(repository.requireTicketEscrow('match-a', 'profile-a').status)
      .toBe('escrow');
    expect(repository.listMatchEntries('match-a').every(
      entry => entry.resultKey === null,
    )).toBe(true);
  });

  it('rejects every mismatched official human set without mutation and remains voidable', () => {
    service.reserveMatchTickets('match-a', ['profile-a', 'profile-b'], EPOCH);
    service.markMatchPlaying('match-a', EPOCH + 1);
    const beforeA = repository.requireProfile('arena-v1-0', 'profile-a');
    const invalidResults = [
      [
        { playerId: 'profile-a', place: 1, type: 'human' as const },
        { playerId: 'intruder', place: 2, type: 'human' as const },
        { playerId: 'profile-b', place: 3, type: 'bot' as const },
        { playerId: 'bot-1', place: 4, type: 'bot' as const },
        { playerId: 'bot-2', place: 5, type: 'bot' as const },
        { playerId: 'bot-3', place: 6, type: 'bot' as const },
      ],
      [
        { playerId: 'profile-a', place: 1, type: 'human' as const },
        { playerId: 'intruder', place: 2, type: 'human' as const },
        { playerId: 'bot-1', place: 3, type: 'bot' as const },
        { playerId: 'bot-2', place: 4, type: 'bot' as const },
        { playerId: 'bot-3', place: 5, type: 'bot' as const },
        { playerId: 'bot-4', place: 6, type: 'bot' as const },
      ],
      [
        { playerId: 'profile-a', place: 1, type: 'human' as const },
        { playerId: 'profile-a', place: 2, type: 'human' as const },
        { playerId: 'profile-b', place: 3, type: 'human' as const },
        { playerId: 'bot-1', place: 4, type: 'bot' as const },
        { playerId: 'bot-2', place: 5, type: 'bot' as const },
        { playerId: 'bot-3', place: 6, type: 'bot' as const },
      ],
      [
        { playerId: 'profile-a', place: 1, type: 'human' as const },
        { playerId: 'profile-b', place: 1, type: 'human' as const },
        { playerId: 'bot-1', place: 3, type: 'bot' as const },
        { playerId: 'bot-2', place: 4, type: 'bot' as const },
        { playerId: 'bot-3', place: 5, type: 'bot' as const },
        { playerId: 'bot-4', place: 6, type: 'bot' as const },
      ],
    ];

    for (const results of invalidResults) {
      expectDomain(
        () => service.settleOfficialMatch('match-a', results, EPOCH + 2),
        'ARENA_RESULT_INVALID',
      );
    }

    expect(repository.requireMatch('match-a').status).toBe('playing');
    expect(repository.requireProfile('arena-v1-0', 'profile-a')).toEqual(beforeA);
    expect(repository.listMatchEntries('match-a').every(
      entry => entry.resultKey === null,
    )).toBe(true);
    expect(repository.requireTicketEscrow('match-a', 'profile-a').status)
      .toBe('escrow');

    service.voidMatch('match-a', EPOCH + 3);
    expect(repository.requireMatch('match-a').status).toBe('void');
    expect(repository.requireTicketEscrow('match-a', 'profile-a').status)
      .toBe('refunded');
    expect(repository.requireProfile('arena-v1-0', 'profile-a').availableTickets)
      .toBe(2);
  });
});

function insertBaseProfile(database: PokerDatabase, id: string): void {
  database.db.prepare(`
    INSERT INTO profiles (
      id, credential_hash, credential_lookup, recovery_hash, recovery_lookup,
      alias, avatar_id, adult_confirmed_at, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, 'sakura', 1, 1, 1)
  `).run(id, `ch-${id}`, `cl-${id}`, `rh-${id}`, `rl-${id}`, `alias-${id}`);
}

function hasActiveWalletSeat(database: PokerDatabase, profileId: string): boolean {
  return database.db.prepare(`
    SELECT 1 FROM seat_escrows
    WHERE profile_id = ? AND status = 'active'
    LIMIT 1
  `).get(profileId) !== undefined;
}

function countRows(database: PokerDatabase, table: string): number {
  const row = database.db.prepare(
    `SELECT COUNT(*) AS count FROM ${table}`,
  ).get() as unknown as { count: number };
  return row.count;
}

function updateAvailable(
  repository: ArenaRepository,
  profileId: string,
  availableTickets: number,
  at: number,
): void {
  const profile = repository.requireProfile('arena-v1-0', profileId);
  repository.transaction(tx => tx.updateProfile({
    ...profile,
    availableTickets,
    updatedAt: Math.max(profile.updatedAt, at),
  }));
}

function updateMmr(
  repository: ArenaRepository,
  profileId: string,
  mmr: number,
): void {
  const profile = repository.requireProfile('arena-v1-0', profileId);
  repository.transaction(tx => tx.updateProfile({
    ...profile,
    mmr,
  }));
}

function expectDomain(work: () => unknown, code: ArenaDomainError['code']): void {
  try {
    work();
    throw new Error('expected ArenaDomainError');
  } catch (error) {
    expect(error).toBeInstanceOf(ArenaDomainError);
    expect((error as ArenaDomainError).code).toBe(code);
  }
}

function sixSeatResult(
  humans: readonly (readonly [profileId: string, place: number])[],
): Array<{ playerId: string; place: number; type: 'human' | 'bot' }> {
  const occupiedPlaces = new Set(humans.map(([, place]) => place));
  const bots = [1, 2, 3, 4, 5, 6]
    .filter(place => !occupiedPlaces.has(place))
    .map((place, index) => ({
      playerId: `bot-${index}`,
      place,
      type: 'bot' as const,
    }));
  return [
    ...humans.map(([playerId, place]) => ({
      playerId,
      place,
      type: 'human' as const,
    })),
    ...bots,
  ];
}

function seedPlacement(
  repository: ArenaRepository,
  profileId: string,
  points: readonly number[],
): void {
  points.forEach((point, index) => {
    const profile = repository.requireProfile('arena-v1-0', profileId);
    repository.transaction(tx => tx.updateProfile({
      ...profile,
      placementGames: index + 1,
      placementPoints: profile.placementPoints + point,
      tier: index === 4 ? 'silver' : null,
      updatedAt: profile.updatedAt,
    }));
  });
}

function setProfileTier(
  repository: ArenaRepository,
  profileId: string,
  tier: ArenaTier,
  at: number,
): void {
  const profile = repository.requireProfile('arena-v1-0', profileId);
  repository.transaction(tx => tx.updateProfile({
    ...profile,
    tier,
    updatedAt: Math.max(profile.updatedAt, at),
  }));
}

function seedPlacedGroupMembers(
  database: PokerDatabase,
  repository: ArenaRepository,
  prefix: string,
  groupId: string,
  weekKey: string,
  tier: ArenaTier,
  count: number,
  at: number,
): string[] {
  const profileIds = Array.from(
    { length: count },
    (_, index) => `${prefix}-${String(index + 1).padStart(2, '0')}`,
  );
  for (const profileId of profileIds) insertBaseProfile(database, profileId);
  repository.transaction(tx => {
    tx.insertGroup({
      id: groupId,
      seasonId: 'arena-v1-0',
      weekKey,
      tier,
      status: 'open',
      createdAt: at,
      settledAt: null,
    });
    for (const profileId of profileIds) {
      tx.insertProfile({
        seasonId: 'arena-v1-0',
        profileId,
        availableTickets: 2,
        lastDailyGrantDate: '2026-07-20',
        placementGames: 5,
        placementPoints: 175,
        tier,
        mmr: 1_000,
        createdAt: at,
        updatedAt: at,
      });
      tx.insertGroupMember({
        groupId,
        seasonId: 'arena-v1-0',
        weekKey,
        profileId,
        points: 0,
        wins: 0,
        top3: 0,
        placeSum: 0,
        matches: 0,
        scoreReachedAt: at,
        joinedAt: at,
        updatedAt: at,
      });
    }
  });
  return profileIds;
}

function weeklyStandings(prefix: string, count: number): WeeklyStanding[] {
  return Array.from({ length: count }, (_, index) => ({
    profileId: `${prefix}-${String(index + 1).padStart(2, '0')}`,
    points: count - index,
    wins: 0,
    top3: 0,
    placeSum: 18,
    matches: 3,
    scoreReachedAt: EPOCH,
  }));
}

function seedWeeklyGroup(
  database: PokerDatabase,
  repository: ArenaRepository,
  groupId: string,
  weekKey: string,
  tier: ArenaTier,
  standings: readonly WeeklyStanding[],
  at: number,
): void {
  for (const row of standings) insertBaseProfile(database, row.profileId);
  repository.transaction(tx => {
    tx.insertGroup({
      id: groupId,
      seasonId: 'arena-v1-0',
      weekKey,
      tier,
      status: 'open',
      createdAt: at,
      settledAt: null,
    });
    for (const row of standings) {
      tx.insertProfile({
        seasonId: 'arena-v1-0',
        profileId: row.profileId,
        availableTickets: 2,
        lastDailyGrantDate: '2026-07-20',
        placementGames: 5,
        placementPoints: 175,
        tier,
        mmr: 1_000,
        createdAt: at,
        updatedAt: at,
      });
      const scoreReachedAt = Math.max(row.scoreReachedAt, at);
      tx.insertGroupMember({
        groupId,
        seasonId: 'arena-v1-0',
        weekKey,
        profileId: row.profileId,
        points: row.points,
        wins: row.wins,
        top3: row.top3,
        placeSum: row.placeSum,
        matches: row.matches,
        scoreReachedAt,
        joinedAt: at,
        updatedAt: scoreReachedAt,
      });
    }
  });
}
