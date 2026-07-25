import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  TournamentConfigSnapshotV2,
  TournamentRecurrence,
} from '@/lib/tournament/tournament-config';
import { openPokerDatabase, type PokerDatabase } from './persistence/database';
import { PromotionFundRepository } from './promotion-fund-repository';
import {
  TournamentInstanceRepository,
  type CreateInstanceCommand,
  type CreateTemplateCommand,
} from './tournament-instance-repository';
import {
  TournamentScheduler,
  kstOccurrenceStarts,
} from './tournament-scheduler';

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const NOW = Date.now() - 10_000;
const RECURRENCE_NOW = Date.parse('2026-07-25T01:10:00.000Z'); // 10:10 KST

function config(
  economy: 'freeroll' | 'wallet' = 'wallet',
): TournamentConfigSnapshotV2 {
  return {
    version: 2,
    name: economy === 'freeroll' ? '주말 프리롤' : '주말 메인',
    economy: economy === 'freeroll'
      ? { mode: 'freeroll', promotionAccountId: 'global' }
      : { mode: 'wallet', productVersion: 1, buyIn: 1_500, fee: 150 },
    tableSize: 6,
    field: { minEntrants: 2, maxEntrants: 24, botFillToMinimum: false },
    turnTimeSeconds: 15,
    structure: {
      sourcePresetId: 'standard',
      startingStack: 1_500,
      segments: [{
        kind: 'level',
        durationMs: 480_000,
        smallBlind: 10,
        bigBlind: 20,
        bigBlindAnte: 0,
      }],
    },
    prizePool: economy === 'freeroll'
      ? { kind: 'promotion-funded', totalPrize: 10_000 }
      : { kind: 'entry-pool' },
    payout: {
      tableVersion: 2,
      presetId: 'standard',
      paidFieldPercent: 15,
    },
    lateRegistration: {
      enabled: false,
      durationLevels: 0,
      minStartingStackBb: 20,
    },
  };
}

function templateCommand(
  id: string,
  recurrence: TournamentRecurrence,
  overrides: Partial<CreateTemplateCommand> = {},
): CreateTemplateCommand {
  return {
    id,
    idempotencyKey: `create-${id}`,
    name: id,
    enabled: true,
    timezone: 'Asia/Seoul',
    recurrence,
    visibleLeadMs: 24 * HOUR,
    registrationLeadMs: 20 * MINUTE,
    config: config(),
    createdBy: { kind: 'backoffice-admin', profileId: 'admin' },
    now: NOW,
    ...overrides,
  };
}

function manualCommand(
  id: string,
  economy: 'freeroll' | 'wallet',
  registrationOpensAt: number,
  manualStartExpiresAt: number,
): CreateInstanceCommand {
  return {
    id,
    templateId: null,
    templateRevision: null,
    idempotencyKey: `create-${id}`,
    occurrenceKey: id,
    schedule: {
      visibleAt: registrationOpensAt,
      registrationOpensAt,
      startsAt: null,
      manualStartExpiresAt,
    },
    config: config(economy),
    createdBy: { kind: 'backoffice-admin', profileId: 'admin' },
    now: Math.min(NOW, registrationOpensAt),
  };
}

describe('TournamentScheduler', () => {
  let database: PokerDatabase;
  let instances: TournamentInstanceRepository;
  let funds: PromotionFundRepository;

  beforeEach(() => {
    database = openPokerDatabase(':memory:');
    instances = new TournamentInstanceRepository(database, () => NOW);
    funds = new PromotionFundRepository(database);
  });

  afterEach(() => database.close());

  it('generates hourly daily and weekly occurrences across the full horizon', () => {
    const cases: TournamentRecurrence[] = [
      { kind: 'hourly', minute: 30 },
      { kind: 'daily', hour: 12, minute: 0 },
      { kind: 'weekly', weekday: 6, hour: 12, minute: 0 },
    ];
    const [hourly, daily, weekly] = cases.map(recurrence =>
      kstOccurrenceStarts(recurrence, RECURRENCE_NOW, 7 * 24 * HOUR));

    expect(hourly[0]).toBe(Date.parse('2026-07-25T01:30:00.000Z'));
    expect(hourly.at(-1)).toBeGreaterThanOrEqual(
      RECURRENCE_NOW + 7 * 24 * HOUR,
    );
    expect(daily.slice(0, 2)).toEqual([
      Date.parse('2026-07-25T03:00:00.000Z'),
      Date.parse('2026-07-26T03:00:00.000Z'),
    ]);
    expect(weekly.slice(0, 2)).toEqual([
      Date.parse('2026-07-25T03:00:00.000Z'),
      Date.parse('2026-08-01T03:00:00.000Z'),
    ]);
  });

  it('reconciles the same template without duplicate occurrences', () => {
    instances.createTemplate(templateCommand(
      'hourly-main',
      { kind: 'hourly', minute: 30 },
    ));
    const scheduler = new TournamentScheduler({ database, clock: () => NOW });

    scheduler.reconcileTemplates();
    const once = database.db.prepare(
      `SELECT COUNT(*) AS count FROM tournament_instance`,
    ).get() as { count: number };
    scheduler.reconcileTemplates();
    const twice = database.db.prepare(
      `SELECT COUNT(*) AS count FROM tournament_instance`,
    ).get() as { count: number };

    expect(twice.count).toBe(once.count);
    expect(once.count).toBeGreaterThan(48);
  });

  it('disabling a template preserves every already generated occurrence', () => {
    const template = instances.createTemplate(templateCommand(
      'disabled-preserves',
      { kind: 'hourly', minute: 30 },
    ));
    const scheduler = new TournamentScheduler({ database, clock: () => NOW });
    scheduler.reconcileTemplates();
    const before = database.db.prepare(`
      SELECT id, status FROM tournament_instance
      WHERE template_id = ? ORDER BY id
    `).all(template.id);
    expect(before.length).toBeGreaterThan(0);
    expect(instances.patchTemplateIfRevision(template.id, 1, {
      enabled: false,
      updatedAt: NOW + 1,
    }).status).toBe('updated');

    scheduler.reconcileTemplates(NOW + 1);

    expect(database.db.prepare(`
      SELECT id, status FROM tournament_instance
      WHERE template_id = ? ORDER BY id
    `).all(template.id)).toEqual(before);
  });

  it('generates only while holding the requested template revision', () => {
    const template = instances.createTemplate(templateCommand(
      'revision-lease',
      { kind: 'daily', hour: 12, minute: 0 },
    ));
    const scheduler = new TournamentScheduler({ database, clock: () => NOW });
    expect(instances.patchTemplateIfRevision(template.id, 1, {
      name: 'revision two',
      updatedAt: NOW + 1,
    }).status).toBe('updated');

    const generate = (
      scheduler as unknown as {
        generateTemplateOccurrencesIfRevision?: (
          id: string,
          revision: number,
          at: number,
        ) => { status: string; actualRevision?: number; generated?: number };
      }
    ).generateTemplateOccurrencesIfRevision;
    expect(generate).toBeTypeOf('function');
    if (!generate) return;
    expect(generate.call(scheduler, template.id, 1, NOW + 1)).toEqual({
      status: 'revision-conflict',
      actualRevision: 2,
    });
    expect(database.db.prepare(`
      SELECT COUNT(*) AS count FROM tournament_instance
      WHERE template_id = ?
    `).get(template.id)).toEqual({ count: 0 });
  });

  it('tombstones superseded hidden occurrences and preserves visible occupancy', () => {
    const original = instances.createTemplate(templateCommand(
      'daily-main',
      { kind: 'daily', hour: 12, minute: 0 },
    ));
    const scheduler = new TournamentScheduler({ database, clock: () => NOW });
    scheduler.reconcileTemplates();
    const rows = database.db.prepare(`
      SELECT id FROM tournament_instance
      WHERE template_id = ? ORDER BY starts_at
    `).all(original.id) as Array<{ id: string }>;
    database.db.prepare(`
      UPDATE tournament_instance
      SET status = 'scheduled-visible'
      WHERE id = ?
    `).run(rows[0]!.id);
    const updated = instances.patchTemplateIfRevision(original.id, 1, {
      recurrence: { kind: 'daily', hour: 13, minute: 0 },
      updatedAt: NOW + 1,
    });
    expect(updated.status).toBe('updated');

    scheduler.reconcileTemplates(NOW + 1);
    const preserved = instances.getInstance(rows[0]!.id);
    const superseded = database.db.prepare(`
      SELECT COUNT(*) AS count FROM tournament_instance
      WHERE template_id = ? AND template_revision = 1
        AND status = 'cancelled' AND status_reason = 'template-superseded'
    `).get(original.id) as { count: number };
    expect(preserved?.status).toBe('scheduled-visible');
    expect(superseded.count).toBeGreaterThan(0);
  });

  it('funds and exposes a freeroll once at visibleAt', () => {
    funds.adjustFund({
      requestId: '00000000-0000-4000-8000-000000000001',
      delta: 20_000,
      reason: 'Seed scheduler test fund',
      actor: { kind: 'backoffice-admin', id: 'admin' },
      at: NOW,
    });
    const command = manualCommand(
      'manual-freeroll',
      'freeroll',
      NOW + MINUTE,
      NOW + 2 * HOUR,
    );
    instances.createInstance(command);
    const scheduler = new TournamentScheduler({ database, clock: () => NOW });

    scheduler.reconcileDue(NOW + MINUTE);
    scheduler.reconcileDue(NOW + MINUTE);

    expect(instances.getInstance(command.id)?.status).toBe('registering');
    const escrow = database.db.prepare(`
      SELECT COUNT(*) AS count FROM tournament_prize_escrow
      WHERE instance_id = ?
    `).get(command.id) as { count: number };
    expect(escrow.count).toBe(1);
    expect(funds.getFundPage({ limit: 10 }).availableBalance).toBe(10_000);
  });

  it('honors wallet twenty-minute registration and manual expiry', () => {
    const command = manualCommand(
      'manual-wallet',
      'wallet',
      NOW - 20 * MINUTE,
      NOW,
    );
    instances.createInstance(command);
    const scheduler = new TournamentScheduler({ database, clock: () => NOW });

    scheduler.reconcileDue(NOW - 1);
    expect(instances.getInstance(command.id)?.status).toBe('registering');
    scheduler.reconcileDue(NOW);
    expect(instances.getInstance(command.id)?.status).toBe('cancelled');
  });

  it('keeps starting plus running at or below four', () => {
    const onStartClaim = vi.fn();
    const scheduler = new TournamentScheduler({
      database,
      clock: () => NOW,
      startProcessingEnabled: true,
      onStartClaim,
      onStartLeaseExpired: vi.fn(),
    });
    for (let index = 0; index < 5; index += 1) {
      const id = `scheduled-${index}`;
      instances.createInstance({
        ...manualCommand(id, 'wallet', NOW, NOW + 20 * MINUTE),
        schedule: {
          visibleAt: NOW,
          registrationOpensAt: NOW,
          startsAt: NOW,
          manualStartExpiresAt: null,
        },
      });
    }
    scheduler.reconcileDue(NOW);

    const active = database.db.prepare(`
      SELECT COUNT(*) AS count FROM tournament_instance
      WHERE status IN ('starting', 'running')
    `).get() as { count: number };
    expect(active.count).toBe(4);
    expect(onStartClaim).toHaveBeenCalledTimes(4);
  });

  it('recovers a missed start within ten minutes and cancels beyond it', () => {
    const scheduler = new TournamentScheduler({
      database,
      clock: () => NOW,
      startProcessingEnabled: true,
      onStartClaim: vi.fn(),
      onStartLeaseExpired: vi.fn(),
    });
    for (const [id, startsAt] of [
      ['within-grace', NOW - 10 * MINUTE],
      ['beyond-grace', NOW - 10 * MINUTE - 1],
    ] as const) {
      instances.createInstance({
        ...manualCommand(id, 'wallet', startsAt, startsAt + 20 * MINUTE),
        schedule: {
          visibleAt: startsAt,
          registrationOpensAt: startsAt,
          startsAt,
          manualStartExpiresAt: null,
        },
        now: startsAt,
      });
    }

    scheduler.reconcileDue(NOW);
    expect(instances.getInstance('within-grace')?.status).toBe('starting');
    expect(instances.getInstance('beyond-grace')).toMatchObject({
      status: 'cancelled',
      statusReason: 'missed-start',
    });
  });

  it('rechecks the persisted deadline and CAS when a timer fires early', () => {
    let clock = NOW;
    let callback: (() => void) | undefined;
    const command = manualCommand(
      'timer-recheck',
      'wallet',
      NOW + MINUTE,
      NOW + 2 * MINUTE,
    );
    instances.createInstance(command);
    const scheduler = new TournamentScheduler({
      database,
      clock: () => clock,
      setTimer: ((work: () => void) => {
        callback = work;
        return 1 as unknown as ReturnType<typeof setTimeout>;
      }) as typeof setTimeout,
      clearTimer: vi.fn() as unknown as typeof clearTimeout,
    });
    scheduler.hydrateTimers();

    callback?.();
    expect(instances.getInstance(command.id)?.status).toBe('scheduled-hidden');

    clock = NOW + MINUTE;
    scheduler.reconcileDue();
    expect(instances.getInstance(command.id)?.status).toBe('registering');
    scheduler.close();
  });

  it('holds due starts unless a prepared-start handler is explicitly enabled', () => {
    const id = 'held-without-prepared-handler';
    instances.createInstance({
      ...manualCommand(id, 'wallet', NOW, NOW + 20 * MINUTE),
      schedule: {
        visibleAt: NOW,
        registrationOpensAt: NOW,
        startsAt: NOW,
        manualStartExpiresAt: null,
      },
    });
    const scheduler = new TournamentScheduler({ database, clock: () => NOW });

    scheduler.reconcileDue();

    expect(instances.getInstance(id)?.status).toBe('registering');
  });

  it('requires start and expired-lease watchdog handlers together', () => {
    expect(() => new TournamentScheduler({
      database,
      startProcessingEnabled: true,
      onStartClaim: vi.fn(),
    })).toThrowError(/lease/i);
  });

  it('reports expired start leases to the watchdog contract', () => {
    let clock = NOW;
    const watchdog = vi.fn();
    const id = 'start-watchdog';
    instances.createInstance({
      ...manualCommand(id, 'wallet', NOW, NOW + 20 * MINUTE),
      schedule: {
        visibleAt: NOW,
        registrationOpensAt: NOW,
        startsAt: NOW,
        manualStartExpiresAt: null,
      },
    });
    const scheduler = new TournamentScheduler({
      database,
      clock: () => clock,
      startProcessingEnabled: true,
      onStartClaim: vi.fn(),
      onStartLeaseExpired: watchdog,
    });
    scheduler.reconcileDue();
    clock = NOW + 30_000;

    scheduler.reconcileDue();

    expect(watchdog).toHaveBeenCalledWith(expect.objectContaining({ id }));
  });

  it('records timer errors and schedules a bounded database recheck', () => {
    let callback: (() => void) | undefined;
    const delays: number[] = [];
    const onError = vi.fn();
    const id = 'timer-error-retry';
    instances.createInstance({
      ...manualCommand(id, 'wallet', NOW, NOW + 2 * MINUTE),
      schedule: {
        visibleAt: NOW,
        registrationOpensAt: NOW,
        startsAt: NOW,
        manualStartExpiresAt: null,
      },
    });
    const scheduler = new TournamentScheduler({
      database,
      clock: () => NOW,
      startProcessingEnabled: true,
      onStartClaim: () => {
        throw new Error('prepared start failed');
      },
      onStartLeaseExpired: vi.fn(),
      onError,
      setTimer: ((work: () => void, delay?: number) => {
        callback = work;
        delays.push(delay ?? 0);
        return delays.length as unknown as ReturnType<typeof setTimeout>;
      }) as typeof setTimeout,
      clearTimer: vi.fn() as unknown as typeof clearTimeout,
    });
    scheduler.hydrateTimers();

    expect(() => callback?.()).not.toThrow();
    expect(onError).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({ instanceId: id, phase: 'timer' }),
    );
    expect(delays.at(-1)).toBeGreaterThanOrEqual(1_000);
    expect(delays.at(-1)).toBeLessThanOrEqual(30_000);
  });
});
