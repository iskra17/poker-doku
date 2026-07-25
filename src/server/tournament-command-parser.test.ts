import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { isTournamentStatePair } from '../lib/tournament/tournament-state';
import {
  parseCreateTournamentCommand,
  parseRegisterTournamentCommand,
} from './tournament-command-parser';

const NOW = Date.UTC(2026, 6, 25, 12);
const MINUTE = 60_000;

const LEVELS = [
  {
    kind: 'level' as const,
    durationMs: 8 * MINUTE,
    smallBlind: 50,
    bigBlind: 100,
    bigBlindAnte: 0,
  },
  {
    kind: 'level' as const,
    durationMs: 8 * MINUTE,
    smallBlind: 75,
    bigBlind: 150,
    bigBlindAnte: 0,
  },
  {
    kind: 'level' as const,
    durationMs: 8 * MINUTE,
    smallBlind: 100,
    bigBlind: 200,
    bigBlindAnte: 200,
  },
];

function freeroll(overrides: Record<string, unknown> = {}) {
  return {
    requestId: randomUUID(),
    economyMode: 'freeroll',
    minEntrants: 8,
    maxEntrants: 24,
    botFillToMinimum: true,
    prizePool: { kind: 'promotion-funded', totalPrize: 100_000 },
    ...overrides,
  };
}

function wallet(overrides: Record<string, unknown> = {}) {
  return {
    requestId: randomUUID(),
    economyMode: 'wallet',
    minEntrants: 8,
    maxEntrants: 24,
    botFillToMinimum: false,
    prizePool: { kind: 'entry-pool' },
    ...overrides,
  };
}

describe('parseCreateTournamentCommand', () => {
  it('normalizes legacy practice only at ingress and emits freeroll', () => {
    const parsed = parseCreateTournamentCommand(
      freeroll({ economyMode: 'practice' }),
      NOW,
    );

    expect(parsed.config.economy.mode).toBe('freeroll');
    expect(JSON.stringify(parsed)).not.toContain('practice');
  });

  it('rejects wallet bot fill instead of coercing it', () => {
    expect(() => parseCreateTournamentCommand(
      wallet({ botFillToMinimum: true }),
      NOW,
    )).toThrow('wallet-bot-fill');
  });

  it.each([
    ['fractional minimum', { minEntrants: 2.5 }],
    ['unsafe minimum', { minEntrants: Number.MAX_SAFE_INTEGER + 1 }],
    ['minimum below two', { minEntrants: 1 }],
    ['maximum below minimum', { minEntrants: 20, maxEntrants: 19 }],
    ['maximum above 48', { maxEntrants: 49 }],
  ])('rejects invalid field bounds: %s', (_label, override) => {
    expect(() => parseCreateTournamentCommand(freeroll(override), NOW))
      .toThrow('field-policy');
  });

  it.each([
    ['freeroll', { kind: 'promotion-funded', totalPrize: 1 }],
    ['wallet', { kind: 'entry-pool' }],
  ])('accepts the legal %s economy and prize combination', (mode, prizePool) => {
    const parsed = parseCreateTournamentCommand(
      mode === 'freeroll' ? freeroll({ prizePool }) : wallet({ prizePool }),
      NOW,
    );

    expect(parsed.config.economy.mode).toBe(mode);
    expect(parsed.config.prizePool).toEqual(prizePool);
  });

  it.each([
    ['freeroll with entry pool', freeroll({ prizePool: { kind: 'entry-pool' } })],
    [
      'wallet with promotion funding',
      wallet({ prizePool: { kind: 'promotion-funded', totalPrize: 100_000 } }),
    ],
    [
      'promotion prize below one',
      freeroll({ prizePool: { kind: 'promotion-funded', totalPrize: 0 } }),
    ],
    [
      'promotion prize above the safe domain maximum',
      freeroll({
        prizePool: { kind: 'promotion-funded', totalPrize: 2_000_000_001 },
      }),
    ],
  ])('rejects illegal prize policy: %s', (_label, command) => {
    expect(() => parseCreateTournamentCommand(command, NOW))
      .toThrow('economy-prize');
  });

  it('accepts ordered automatic schedules', () => {
    const parsed = parseCreateTournamentCommand(freeroll({
      schedule: {
        visibleAt: NOW + MINUTE,
        registrationOpensAt: NOW + 2 * MINUTE,
        startsAt: NOW + 10 * MINUTE,
        manualStartExpiresAt: null,
      },
    }), NOW);

    expect(parsed.schedule.startsAt).toBe(NOW + 10 * MINUTE);
    expect(parsed.firstStartsAt).toBeNull();
    expect(parsed.recurrenceEndsAt).toBeNull();
  });

  it.each([
    {
      visibleAt: NOW,
      registrationOpensAt: NOW,
      startsAt: NOW + MINUTE,
      manualStartExpiresAt: NOW + 2 * MINUTE,
    },
    {
      visibleAt: NOW,
      registrationOpensAt: NOW + 2 * MINUTE,
      startsAt: NOW + MINUTE,
      manualStartExpiresAt: null,
    },
    {
      visibleAt: NOW,
      registrationOpensAt: NOW,
      startsAt: null,
      manualStartExpiresAt: null,
    },
    {
      visibleAt: -1,
      registrationOpensAt: NOW,
      startsAt: NOW + MINUTE,
      manualStartExpiresAt: null,
    },
  ])('rejects mixed, incomplete, or unordered schedules', (schedule) => {
    expect(() => parseCreateTournamentCommand(freeroll({ schedule }), NOW))
      .toThrow('schedule');
  });

  it('rejects a wallet manual registration window over 20 minutes', () => {
    expect(() => parseCreateTournamentCommand(wallet({
      schedule: {
        visibleAt: NOW,
        registrationOpensAt: NOW,
        startsAt: null,
        manualStartExpiresAt: NOW + 20 * MINUTE + 1,
      },
    }), NOW)).toThrow('wallet-registration-window');
  });

  it('validates recurrence bounds, lead ordering, and automatic scheduling', () => {
    const schedule = {
      visibleAt: NOW,
      registrationOpensAt: NOW + MINUTE,
      startsAt: NOW + 10 * MINUTE,
      manualStartExpiresAt: null,
    };
    const parsed = parseCreateTournamentCommand(freeroll({
      schedule,
      recurrence: { kind: 'weekly', weekday: 6, hour: 23, minute: 59 },
      firstStartsAt: schedule.startsAt,
      recurrenceEndsAt: schedule.startsAt + 28 * 24 * 60 * MINUTE,
      visibleLeadMs: 7 * 24 * 60 * MINUTE,
      registrationLeadMs: 6 * 24 * 60 * MINUTE,
    }), NOW);
    expect(parsed.recurrence?.kind).toBe('weekly');
    expect(parsed.firstStartsAt).toBe(schedule.startsAt);

    expect(() => parseCreateTournamentCommand(freeroll({
      schedule,
      recurrence: { kind: 'hourly', minute: 60 },
      firstStartsAt: schedule.startsAt,
      recurrenceEndsAt: schedule.startsAt + 60 * MINUTE,
      visibleLeadMs: MINUTE,
      registrationLeadMs: MINUTE,
    }), NOW)).toThrow('recurrence');

    expect(() => parseCreateTournamentCommand(freeroll({
      schedule,
      recurrence: { kind: 'daily', hour: 12, minute: 0 },
      firstStartsAt: schedule.startsAt,
      recurrenceEndsAt: schedule.startsAt + 24 * 60 * MINUTE,
      visibleLeadMs: MINUTE,
      registrationLeadMs: 2 * MINUTE,
    }), NOW)).toThrow('recurrence-lead');

    expect(() => parseCreateTournamentCommand(wallet({
      schedule,
      recurrence: { kind: 'daily', hour: 12, minute: 0 },
      firstStartsAt: schedule.startsAt,
      recurrenceEndsAt: schedule.startsAt + 24 * 60 * MINUTE,
      visibleLeadMs: 21 * MINUTE,
      registrationLeadMs: 20 * MINUTE + 1,
    }), NOW)).toThrow('wallet-registration-window');

    expect(() => parseCreateTournamentCommand(freeroll({
      schedule: {
        visibleAt: NOW,
        registrationOpensAt: NOW,
        startsAt: null,
        manualStartExpiresAt: NOW + 6 * 60 * MINUTE,
      },
      recurrence: { kind: 'hourly', minute: 0 },
      firstStartsAt: NOW + 10 * MINUTE,
      recurrenceEndsAt: NOW + 70 * MINUTE,
      visibleLeadMs: MINUTE,
      registrationLeadMs: MINUTE,
    }), NOW)).toThrow('recurrence-schedule');

    expect(() => parseCreateTournamentCommand(freeroll({
      schedule,
      recurrence: { kind: 'hourly', minute: 0 },
      firstStartsAt: schedule.startsAt,
      recurrenceEndsAt: null,
      visibleLeadMs: MINUTE,
      registrationLeadMs: MINUTE,
    }), NOW)).toThrow('recurrence-boundary');

    expect(() => parseCreateTournamentCommand(freeroll({
      schedule,
      recurrence: { kind: 'hourly', minute: 0 },
      firstStartsAt: schedule.startsAt,
      recurrenceEndsAt: schedule.startsAt - 1,
      visibleLeadMs: MINUTE,
      registrationLeadMs: MINUTE,
    }), NOW)).toThrow('recurrence-boundary');
  });

  it('accepts ordered structure segments and rejects blind regression', () => {
    const structure = {
      sourcePresetId: null,
      startingStack: 10_000,
      segments: [
        LEVELS[0],
        LEVELS[1],
        { kind: 'break' as const, durationMs: 5 * MINUTE },
        LEVELS[2],
      ],
    };
    const parsed = parseCreateTournamentCommand(freeroll({ structure }), NOW);
    expect(parsed.config.structure).toEqual(structure);

    expect(() => parseCreateTournamentCommand(freeroll({
      structure: {
        ...structure,
        segments: [
          LEVELS[0],
          LEVELS[1],
          {
            ...LEVELS[2],
            smallBlind: 25,
            bigBlind: 50,
            bigBlindAnte: 0,
          },
        ],
      },
    }), NOW)).toThrow('structure-order');
  });

  it.each([
    [
      'too few levels',
      [LEVELS[0], LEVELS[1]],
    ],
    [
      'leading break',
      [{ kind: 'break', durationMs: MINUTE }, ...LEVELS],
    ],
    [
      'consecutive breaks',
      [
        LEVELS[0],
        { kind: 'break', durationMs: MINUTE },
        { kind: 'break', durationMs: MINUTE },
        LEVELS[1],
        LEVELS[2],
      ],
    ],
  ])('rejects invalid segment ordering: %s', (_label, segments) => {
    expect(() => parseCreateTournamentCommand(freeroll({
      structure: {
        sourcePresetId: null,
        startingStack: 10_000,
        segments,
      },
    }), NOW)).toThrow('structure');
  });

  it.each([
    [{ enabled: false, durationLevels: 0, minStartingStackBb: 20 }, 0],
    [{ enabled: true, durationLevels: 1, minStartingStackBb: 20 }, 1],
    [{ enabled: true, durationLevels: 3, minStartingStackBb: 20 }, 3],
  ])('accepts late registration policy at level boundary %s', (policy, levels) => {
    const parsed = parseCreateTournamentCommand(
      freeroll({ lateRegistration: policy }),
      NOW,
    );
    expect(parsed.config.lateRegistration.durationLevels).toBe(levels);
  });

  it.each([
    { enabled: true, durationLevels: 0, minStartingStackBb: 20 },
    { enabled: false, durationLevels: 1, minStartingStackBb: 20 },
    { enabled: true, durationLevels: 4, minStartingStackBb: 20 },
    { enabled: true, durationLevels: 2.5, minStartingStackBb: 20 },
    { enabled: true, durationLevels: 2, minStartingStackBb: 19 },
  ])('rejects invalid late registration policy %#', (lateRegistration) => {
    expect(() => parseCreateTournamentCommand(
      freeroll({ lateRegistration }),
      NOW,
    )).toThrow('late-registration');
  });

  it('rejects malformed request UUIDs', () => {
    expect(() => parseCreateTournamentCommand(
      freeroll({ requestId: 'not-a-uuid' }),
      NOW,
    )).toThrow('request-id');
  });

  it('rejects a negative server epoch', () => {
    expect(() => parseCreateTournamentCommand(freeroll(), -1))
      .toThrow('server-time');
  });

  it('deep-freezes the normalized command snapshot', () => {
    const parsed = parseCreateTournamentCommand(freeroll({
      structure: {
        sourcePresetId: null,
        startingStack: 10_000,
        segments: LEVELS,
      },
    }), NOW);

    expect(Object.isFrozen(parsed)).toBe(true);
    expect(Object.isFrozen(parsed.schedule)).toBe(true);
    expect(Object.isFrozen(parsed.config)).toBe(true);
    expect(Object.isFrozen(parsed.config.economy)).toBe(true);
    expect(Object.isFrozen(parsed.config.field)).toBe(true);
    expect(Object.isFrozen(parsed.config.structure)).toBe(true);
    expect(Object.isFrozen(parsed.config.structure.segments)).toBe(true);
    expect(parsed.config.structure.segments.every(Object.isFrozen)).toBe(true);
    expect(Object.isFrozen(parsed.config.prizePool)).toBe(true);
    expect(Object.isFrozen(parsed.config.payout)).toBe(true);
    expect(Object.isFrozen(parsed.config.lateRegistration)).toBe(true);
  });
});

describe('parseRegisterTournamentCommand', () => {
  it('parses a tournament id and idempotency UUID', () => {
    const requestId = randomUUID();
    expect(parseRegisterTournamentCommand({
      tournamentId: 'mtt-2026-07-25',
      requestId,
    })).toEqual({ tournamentId: 'mtt-2026-07-25', requestId });
  });

  it('trims a bounded server-issued tournament id', () => {
    const requestId = randomUUID();
    expect(parseRegisterTournamentCommand({
      tournamentId: '  mtt-2026-07-25  ',
      requestId,
    })).toEqual({ tournamentId: 'mtt-2026-07-25', requestId });
  });

  it.each([
    { tournamentId: '', requestId: randomUUID() },
    { tournamentId: '   ', requestId: randomUUID() },
    { tournamentId: 'mtt-1\nforged', requestId: randomUUID() },
    { tournamentId: 'mtt-1\n', requestId: randomUUID() },
    { tournamentId: 'mtt-1\u0085', requestId: randomUUID() },
    { tournamentId: `mtt-${'x'.repeat(125)}`, requestId: randomUUID() },
    { tournamentId: 'mtt-1', requestId: 'not-a-uuid' },
    {
      tournamentId: 'mtt-1',
      requestId: `${randomUUID()}\n`,
    },
    { tournamentId: 'mtt-1', requestId: '   ' },
    { tournamentId: 123, requestId: randomUUID() },
  ])('rejects malformed registration commands %#', (command) => {
    expect(() => parseRegisterTournamentCommand(command))
      .toThrow('register-command');
  });
});

describe('tournament lifecycle and registration state', () => {
  it('accepts exactly the legal full lifecycle and registration matrix', () => {
    const statuses = [
      'scheduled-hidden',
      'scheduled-visible',
      'registering',
      'start-delayed',
      'starting',
      'running',
      'payout-pending',
      'refund-pending',
      'completed',
      'cancelled',
    ] as const;
    const registrationStates = [
      'not-open',
      'open-prestart',
      'locked-for-start',
      'open-late',
      'closing',
      'closed',
    ] as const;
    const legal = new Set([
      'scheduled-hidden:not-open',
      'scheduled-visible:not-open',
      'registering:open-prestart',
      'start-delayed:locked-for-start',
      'starting:locked-for-start',
      'running:open-late',
      'running:closing',
      'running:closed',
      'payout-pending:closed',
      'refund-pending:closed',
      'completed:closed',
      'cancelled:closed',
    ]);

    for (const status of statuses) {
      for (const registrationState of registrationStates) {
        expect(
          isTournamentStatePair(status, registrationState),
          `${status} × ${registrationState}`,
        ).toBe(legal.has(`${status}:${registrationState}`));
      }
    }
  });
});
