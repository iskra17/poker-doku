import { randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { TournamentConfigSnapshotV2 } from '@/lib/tournament/tournament-config';
import { openPokerDatabase, type PokerDatabase } from './persistence/database';
import { TournamentInstanceRepository } from './tournament-instance-repository';
import { TournamentScheduler } from './tournament-scheduler';
import {
  commitPersistentRunningRegistrationPolicy,
  initializeMttRollout,
  shouldKeepPersistentLateRegistrationOpen,
} from './mtt-rollout';

const NOW = Date.parse('2026-07-25T03:00:00.000Z');

function config(): TournamentConfigSnapshotV2 {
  return {
    version: 2,
    name: 'Rollout flag fixture',
    economy: { mode: 'freeroll', promotionAccountId: 'global' },
    tableSize: 6,
    field: { minEntrants: 2, maxEntrants: 12, botFillToMinimum: true },
    turnTimeSeconds: 15,
    structure: {
      sourcePresetId: 'standard',
      startingStack: 10_000,
      segments: [{
        kind: 'level',
        durationMs: 480_000,
        smallBlind: 50,
        bigBlind: 100,
        bigBlindAnte: 0,
      }],
    },
    prizePool: { kind: 'promotion-funded', totalPrize: 100_000 },
    payout: {
      tableVersion: 2,
      presetId: 'standard',
      paidFieldPercent: 15,
    },
    lateRegistration: {
      enabled: true,
      durationLevels: 2,
      minStartingStackBb: 20,
    },
  };
}

describe('ordered MTT rollout initialization', () => {
  let database: PokerDatabase | undefined;
  let constructedScheduler: TournamentScheduler | undefined;

  afterEach(() => {
    constructedScheduler?.close();
    database?.close();
    constructedScheduler = undefined;
    database = undefined;
  });

  it('uses only legacy recovery and leaves every v2 row untouched by default', () => {
    database = openPokerDatabase(':memory:');
    const instances = new TournamentInstanceRepository(database, () => NOW);
    instances.createTemplate({
      id: 'rollout-template',
      idempotencyKey: 'rollout-template-create',
      name: 'Rollout template',
      enabled: true,
      timezone: 'Asia/Seoul',
      recurrence: { kind: 'daily', hour: 20, minute: 0 },
      visibleLeadMs: 24 * 60 * 60_000,
      registrationLeadMs: 20 * 60_000,
      config: config(),
      createdBy: { kind: 'backoffice-admin', profileId: 'admin' },
      now: NOW,
    });
    const hiddenId = randomUUID();
    const hidden = instances.createInstance({
      id: hiddenId,
      templateId: null,
      templateRevision: null,
      idempotencyKey: randomUUID(),
      occurrenceKey: hiddenId,
      schedule: {
        visibleAt: NOW,
        registrationOpensAt: NOW,
        startsAt: NOW + 60 * 60_000,
        manualStartExpiresAt: null,
      },
      config: config(),
      createdBy: { kind: 'backoffice-admin', profileId: 'admin' },
      now: NOW,
    });
    const recoverLegacy = vi.fn();
    const recoverV2 = vi.fn((scheduler: TournamentScheduler) => {
      scheduler.reconcileAndHydrate(NOW);
    });
    const createRegistrationPorts = vi.fn(() => ({ kind: 'registration' }));
    const createScheduler = vi.fn(() => {
      constructedScheduler = new TournamentScheduler({
        database: database!,
        clock: () => NOW,
      });
      return constructedScheduler;
    });

    const rollout = initializeMttRollout(
      {
        schedulerV2: false,
        lateRegistration: false,
        walletLateRegistration: false,
      },
      {
        createScheduler,
        createRegistrationPorts,
        recoverV2,
        recoverLegacy,
      },
    );

    expect(rollout).toEqual({});
    expect(recoverLegacy).toHaveBeenCalledOnce();
    expect(createScheduler).not.toHaveBeenCalled();
    expect(createRegistrationPorts).not.toHaveBeenCalled();
    expect(recoverV2).not.toHaveBeenCalled();
    expect(instances.getInstance(hidden.id)?.status).toBe('scheduled-hidden');
    expect(instances.listAdminProjections(NOW)).toHaveLength(1);
  });

  it('constructs prestart registration before optionally exposing live gates', () => {
    const registration = { kind: 'registration' };
    const factories = {
      createScheduler: () => ({ kind: 'scheduler' }),
      createRegistrationPorts: () => registration,
      recoverV2: vi.fn(),
      recoverLegacy: vi.fn(),
    };
    const schedulerOnly = initializeMttRollout(
      {
        schedulerV2: true,
        lateRegistration: false,
        walletLateRegistration: false,
      },
      factories,
    );
    expect(schedulerOnly.registration).toBe(registration);
    expect(schedulerOnly.lateRegistration).toBeUndefined();
    expect(factories.recoverLegacy).not.toHaveBeenCalled();

    const freerollLate = initializeMttRollout(
      {
        schedulerV2: true,
        lateRegistration: true,
        walletLateRegistration: false,
      },
      factories,
    );
    expect(freerollLate.registration).toBe(registration);
    expect(freerollLate.lateRegistration).toBe(registration);
  });

  it('keeps config-enabled late registration open only when the rollout gate is enabled', () => {
    expect(shouldKeepPersistentLateRegistrationOpen({
      schedulerV2: true,
      lateRegistration: false,
      walletLateRegistration: false,
    }, config())).toBe(false);
    expect(shouldKeepPersistentLateRegistrationOpen({
      schedulerV2: true,
      lateRegistration: true,
      walletLateRegistration: false,
    }, config())).toBe(true);
    expect(shouldKeepPersistentLateRegistrationOpen({
      schedulerV2: true,
      lateRegistration: true,
      walletLateRegistration: false,
    }, {
      ...config(),
      lateRegistration: {
        enabled: false,
        durationLevels: 0,
        minStartingStackBb: 20,
      },
    })).toBe(false);
  });

  it('does not claim registration close while both late gates remain enabled', () => {
    const commitRunning = vi.fn(() => true);
    const claimClose = vi.fn(() => ({ status: 'claimed' }));

    expect(commitPersistentRunningRegistrationPolicy(
      {
        schedulerV2: true,
        lateRegistration: true,
        walletLateRegistration: false,
      },
      config(),
      'late-disabled:test',
      commitRunning,
      claimClose,
    )).toBe(true);
    expect(commitRunning).toHaveBeenCalledOnce();
    expect(claimClose).not.toHaveBeenCalled();
  });
});
