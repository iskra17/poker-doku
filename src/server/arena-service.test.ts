import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ArenaRepository } from './arena-repository';
import {
  ArenaDomainError,
  ArenaService,
  calculateArenaSeasonWindow,
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

  it('consumes escrow exactly once without changing ticket balances', () => {
    service.reserveMatchTickets('match-a', ['profile-a', 'profile-b'], EPOCH);
    service.consumeMatchTickets('match-a', EPOCH + 1);
    service.consumeMatchTickets('match-a', EPOCH + 2);
    expect(repository.requireTicketEscrow('match-a', 'profile-a')).toMatchObject({
      status: 'consumed', settledAt: EPOCH + 1,
    });
    expect(repository.requireProfile('arena-v1-0', 'profile-a').availableTickets)
      .toBe(1);
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

  it('does not refund consumed tickets', () => {
    service.reserveMatchTickets('match-a', ['profile-a', 'profile-b'], EPOCH);
    service.consumeMatchTickets('match-a', EPOCH + 1);
    expectDomain(
      () => service.voidMatch('match-a', EPOCH + 2),
      'ARENA_TICKET_TERMINAL',
    );
    expect(repository.requireProfile('arena-v1-0', 'profile-a').availableTickets)
      .toBe(1);
  });

  it('reconciles the same current season repeatedly without duplicate rows', () => {
    service.reconcile(EPOCH);
    service.reconcile(EPOCH);
    expect(countRows(database, 'arena_seasons')).toBe(1);
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

function expectDomain(work: () => unknown, code: ArenaDomainError['code']): void {
  try {
    work();
    throw new Error('expected ArenaDomainError');
  } catch (error) {
    expect(error).toBeInstanceOf(ArenaDomainError);
    expect((error as ArenaDomainError).code).toBe(code);
  }
}
