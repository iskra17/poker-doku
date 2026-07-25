import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CreateTournamentRequest } from '../lib/realtime/protocol';
import { RoomManager } from './room-manager';
import { TournamentManager } from './tournament-manager';
import {
  TournamentCommandService,
  parseTournamentOperatorIds,
} from './tournament-command-service';
import * as tournamentCommandModule from './tournament-command-service';
import { eventLog } from './event-log';
import { randomUUID } from 'node:crypto';
import { openPokerDatabase } from './persistence/database';
import { PromotionFundRepository } from './promotion-fund-repository';
import { TournamentInstanceRepository } from './tournament-instance-repository';
import { TournamentScheduler } from './tournament-scheduler';

const ADMIN_NOW = Date.parse('2026-07-25T12:00:00+09:00');

function persistentFreeroll(overrides: Record<string, unknown> = {}) {
  return {
    requestId: randomUUID(),
    name: 'Persistent freeroll',
    economyMode: 'freeroll',
    minEntrants: 8,
    maxEntrants: 24,
    botFillToMinimum: true,
    prizePool: { kind: 'promotion-funded', totalPrize: 100_000 },
    schedule: {
      visibleAt: ADMIN_NOW + 60_000,
      registrationOpensAt: ADMIN_NOW + 120_000,
      startsAt: ADMIN_NOW + 600_000,
      manualStartExpiresAt: null,
    },
    ...overrides,
  };
}

const DRAFT: CreateTournamentRequest = {
  name: '운영 토너먼트',
  speed: 'standard',
  maxEntrants: 8,
  startAt: null,
  botFill: true,
  turnTime: 15,
  economyMode: 'practice',
  payoutPreset: 'standard',
};

function persistentSnapshot(id = 'persistent-mtt') {
  return {
    id,
    status: 'starting',
    startOwnerId: 'owner-1',
    startAttempt: 1,
    economyMode: 'freeroll',
    config: {
      version: 2,
      name: 'Persistent MTT',
      economy: { mode: 'freeroll', promotionAccountId: 'global' },
      tableSize: 6,
      field: {
        minEntrants: 8,
        maxEntrants: 12,
        botFillToMinimum: true,
      },
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
        enabled: false,
        durationLevels: 0,
        minStartingStackBb: 20,
      },
    },
  } as const;
}

describe('TournamentCommandService', () => {
  let rooms: RoomManager;
  let manager: TournamentManager;
  let service: TournamentCommandService;

  beforeEach(() => {
    vi.useFakeTimers();
    rooms = new RoomManager(() => {}, () => {});
    manager = new TournamentManager(rooms, { isConnected: () => true });
    service = new TournamentCommandService(manager, new Set(['operator-1', 'operator-2']));
  });

  afterEach(() => {
    manager.shutdown();
    rooms.shutdown();
    vi.useRealTimers();
  });

  it('parses a trimmed, unique operator allowlist', () => {
    expect(parseTournamentOperatorIds(' operator-1, ,operator-2,operator-1 '))
      .toEqual(new Set(['operator-1', 'operator-2']));
    expect(parseTournamentOperatorIds(undefined)).toEqual(new Set());
  });

  it('rejects ordinary profiles before tournament creation', () => {
    expect(service.create(
      { kind: 'operator-profile', profileId: 'guest' },
      DRAFT,
    )).toEqual({ ok: false, reason: 'forbidden' });
    expect(manager.listTournaments()).toHaveLength(0);
  });

  it('allows operator profiles and backoffice to create without registering a player', () => {
    const operatorCreated = service.create(
      { kind: 'operator-profile', profileId: 'operator-1' },
      DRAFT,
    );
    const backofficeCreated = service.create(
      { kind: 'backoffice' },
      { ...DRAFT, name: '백오피스 토너먼트' },
    );

    expect(operatorCreated.ok).toBe(true);
    expect(backofficeCreated.ok).toBe(true);
    if (!backofficeCreated.ok) throw new Error('backoffice create failed');
    expect(manager.listTournaments()).toHaveLength(2);
    for (const summary of manager.listTournaments()) {
      expect(summary.entrantCount).toBe(0);
    }
    expect(eventLog.recent({ type: 'mtt-create' }).at(-1)?.data).toMatchObject({
      tournamentId: backofficeCreated.tournamentId,
      authorityKind: 'backoffice',
    });
    expect(eventLog.recent({ type: 'mtt-create' }).at(-1)?.data)
      .not.toHaveProperty('operatorProfileId');
  });

  it('allows a different operator to administer an existing tournament', () => {
    const created = service.create(
      { kind: 'operator-profile', profileId: 'operator-1' },
      DRAFT,
    );
    if (!created.ok) throw new Error('create failed');

    expect(service.act(
      { kind: 'operator-profile', profileId: 'operator-2' },
      created.tournamentId,
      { kind: 'cancel' },
    )).toBe('ok');
    expect(manager.getDetail(created.tournamentId)?.summary.phase).toBe('cancelled');
    expect(eventLog.recent({ type: 'mtt-create' }).at(-1)?.data).toMatchObject({
      tournamentId: created.tournamentId,
      authorityKind: 'operator-profile',
      operatorProfileId: 'operator-1',
    });
    expect(eventLog.recent({ type: 'mtt-director-action' }).at(-1)?.data).toMatchObject({
      tournamentId: created.tournamentId,
      action: 'cancel',
      authorityKind: 'operator-profile',
      operatorProfileId: 'operator-2',
    });
  });

  it('rejects ordinary profile start and director commands', () => {
    const created = service.create({ kind: 'backoffice' }, DRAFT);
    if (!created.ok) throw new Error('create failed');
    const guest = { kind: 'operator-profile', profileId: 'guest' } as const;

    expect(service.start(guest, created.tournamentId)).toBe('forbidden');
    expect(service.act(guest, created.tournamentId, { kind: 'cancel' })).toBe('forbidden');
    expect(manager.getDetail(created.tournamentId)?.summary.phase).toBe('registering');
  });

  it('keeps registration open when an operator starts before enough players check in', () => {
    const created = service.create(
      { kind: 'operator-profile', profileId: 'operator-1' },
      { ...DRAFT, botFill: false },
    );
    if (!created.ok) throw new Error('create failed');

    expect(service.start(
      { kind: 'operator-profile', profileId: 'operator-2' },
      created.tournamentId,
    )).toBe('not-enough');
    expect(manager.getDetail(created.tournamentId)?.summary.phase).toBe('registering');
  });

  it('discards every prepared room when the durable running CAS fails', () => {
    const prepare = vi.spyOn(manager, 'prepareFromInstance');
    const discard = vi.spyOn(manager, 'discardPreparedTournament');
    const persistent = {
      claimStartingRoster: vi.fn(() => ({
        roster: [{ id: 'human-1', name: 'Human 1', avatar: 'ara' }],
      })),
      startEconomy: vi.fn(),
      commitRunning: vi.fn(() => false),
      handoffRefund: vi.fn(),
    };
    const durableService = new TournamentCommandService(
      manager,
      new Set(['operator-1']),
      persistent,
    );
    const snapshot = persistentSnapshot();

    expect(durableService.processStartClaim(snapshot)).toBe('rollback');
    expect(prepare).toHaveBeenCalledOnce();
    expect(discard).toHaveBeenCalledWith(
      'persistent-mtt',
      'owner-1',
      'mtt-start-rollback',
    );
    expect(persistent.handoffRefund).toHaveBeenCalledWith(
      snapshot,
      'owner-1',
      expect.any(Error),
    );
    expect(rooms.getAdminRoomSummaries()).toHaveLength(0);
  });

  it('disposes prepared rooms when activation fails after the running CAS', () => {
    const snapshot = persistentSnapshot('activation-failure');
    const persistent = {
      claimStartingRoster: vi.fn(() => ({
        roster: [{ id: 'human-1', name: 'Human 1', avatar: 'ara' }],
      })),
      startEconomy: vi.fn(),
      commitRunning: vi.fn(() => true),
      handoffRefund: vi.fn(),
    };
    const durableService = new TournamentCommandService(
      manager,
      new Set(['operator-1']),
      persistent,
    );
    vi.spyOn(manager, 'activatePreparedTournament')
      .mockImplementation(() => {
        throw new Error('activation failed');
      });

    expect(durableService.processStartClaim(snapshot)).toBe('rollback');
    expect(persistent.commitRunning).toHaveBeenCalledWith(expect.objectContaining({
      initialEntrants: 8,
      initialBotEntrants: 7,
      committedEntrants: 8,
      everMultiTable: true,
    }));
    expect(rooms.getAdminRoomSummaries()).toHaveLength(0);
    expect(persistent.handoffRefund).toHaveBeenCalledOnce();
  });

  it('notifies projected sessions when a fallible activation hook rolls back', () => {
    const snapshot = persistentSnapshot('projection-failure');
    const persistent = {
      claimStartingRoster: vi.fn(() => ({
        roster: [{ id: 'human-1', name: 'Human 1', avatar: 'ara' }],
      })),
      startEconomy: vi.fn(),
      commitRunning: vi.fn(() => true),
      handoffRefund: vi.fn(),
    };
    const durableService = new TournamentCommandService(
      manager,
      new Set(['operator-1']),
      persistent,
    );
    const dispose = vi.spyOn(rooms, 'disposeRoom');
    (
      manager as unknown as {
        hooks: { onSeated?: () => void };
      }
    ).hooks.onSeated = () => {
      throw new Error('projection failed');
    };

    expect(durableService.processStartClaim(snapshot)).toBe('rollback');
    expect(dispose).toHaveBeenCalledWith(
      expect.any(String),
      'mtt-start-rollback',
      true,
    );
    expect(rooms.getAdminRoomSummaries()).toHaveLength(0);
  });

  it('hands a zero-human freeroll to durable cancellation without preparing rooms', () => {
    const persistent = {
      claimStartingRoster: vi.fn(() => ({ roster: [] })),
      startEconomy: vi.fn(),
      commitRunning: vi.fn(() => true),
      handoffRefund: vi.fn(),
    };
    const durableService = new TournamentCommandService(
      manager,
      new Set(['operator-1']),
      persistent,
    );
    const prepare = vi.spyOn(manager, 'prepareFromInstance');

    expect(durableService.processStartClaim(persistentSnapshot('empty')))
      .toBe('not-enough');
    expect(prepare).not.toHaveBeenCalled();
    expect(persistent.startEconomy).not.toHaveBeenCalled();
    expect(persistent.handoffRefund).toHaveBeenCalledOnce();
  });

  it('restores the exact durable source pair after an early manual not-enough result', () => {
    const source = {
      status: 'start-delayed',
      registrationState: 'locked-for-start',
      statusReason: 'capacity',
      nextRetryAt: Date.now() + 30_000,
    } as const;
    const snapshot = {
      ...persistentSnapshot('manual-not-enough'),
      startSource: source,
    };
    const persistent = {
      claimManualStart: vi.fn(() => snapshot),
      claimStartingRoster: vi.fn(() => ({ roster: [] })),
      startEconomy: vi.fn(),
      commitRunning: vi.fn(() => true),
      handoffRefund: vi.fn(),
      restoreStartSource: vi.fn(),
    };
    const durableService = new TournamentCommandService(
      manager,
      new Set(['operator-1']),
      persistent,
    );

    expect(durableService.start(
      { kind: 'operator-profile', profileId: 'operator-1' },
      snapshot.id,
    )).toBe('not-enough');
    expect(persistent.restoreStartSource).toHaveBeenCalledWith(
      snapshot,
      'owner-1',
      source,
    );
    expect(persistent.handoffRefund).not.toHaveBeenCalled();
  });

  it('parses persistent v2 commands before mutation and audit logging', () => {
    const database = openPokerDatabase(':memory:');
    const instances = new TournamentInstanceRepository(
      database,
      () => ADMIN_NOW,
    );
    const scheduler = new TournamentScheduler({
      database,
      clock: () => ADMIN_NOW,
    });
    const durableService = new TournamentCommandService(
      manager,
      new Set(['operator-1']),
      undefined,
      { database, instances, scheduler, now: () => ADMIN_NOW },
    );
    new PromotionFundRepository(database).adjustFund({
      requestId: randomUUID(),
      delta: 500_000,
      reason: 'Persistent command test funding',
      actor: { kind: 'backoffice-admin', id: 'test' },
      at: ADMIN_NOW,
    });
    const auditBefore = eventLog.recent({ type: 'mtt-instance-generate' });

    expect(durableService.createPersistentInstance(
      { kind: 'operator-profile', profileId: 'guest' },
      { malformed: true },
      ADMIN_NOW,
    )).toEqual({ ok: false, code: 'forbidden' });
    expect(durableService.createPersistentInstance(
      { kind: 'operator-profile', profileId: 'operator-1' },
      { malformed: true },
      ADMIN_NOW,
    )).toEqual({ ok: false, code: 'invalid-payload' });
    expect(instances.listAdminProjections(ADMIN_NOW)).toEqual([]);
    expect(eventLog.recent({ type: 'mtt-instance-generate' }))
      .toEqual(auditBefore);

    const command = persistentFreeroll();
    const result = durableService.createPersistentInstance(
      { kind: 'operator-profile', profileId: 'operator-1' },
      command,
      ADMIN_NOW,
    );
    expect(result).toMatchObject({
      ok: true,
      instance: {
        id: command.requestId,
        config: { version: 2 },
        createdBy: {
          kind: 'operator-profile',
          profileId: 'operator-1',
        },
      },
    });
    expect(eventLog.recent({ type: 'mtt-instance-generate' }).at(-1)?.data)
      .toMatchObject({
        tournamentId: command.requestId,
        authorityKind: 'operator-profile',
        operatorProfileId: 'operator-1',
      });

    scheduler.close();
    database.close();
  });

  it('keeps profile operators outside the separate promotion adjustment boundary', () => {
    expect(service.canOperateProfile('operator-1')).toBe(true);
    expect('adjustPromotionFund' in service).toBe(false);
  });

  it('routes known persistent actions to durable cancel/refund paths', () => {
    const actionNow = Date.now();
    const database = openPokerDatabase(':memory:');
    const instances = new TournamentInstanceRepository(database, () => actionNow);
    const scheduler = new TournamentScheduler({
      database,
      clock: () => actionNow,
    });
    const onRefundPending = vi.fn();
    new PromotionFundRepository(database).adjustFund({
      requestId: randomUUID(),
      delta: 500_000,
      reason: 'Persistent action test funding',
      actor: { kind: 'backoffice-admin', id: 'test' },
      at: actionNow,
    });
    const persistent = {
      claimManualStart: vi.fn(() => null),
      claimStartingRoster: vi.fn(),
      startEconomy: vi.fn(),
      commitRunning: vi.fn(),
      handoffRefund: vi.fn(),
    };
    const durableService = new TournamentCommandService(
      manager,
      new Set(['operator-1']),
      persistent,
      {
        database,
        instances,
        scheduler,
        now: () => actionNow,
        onRefundPending,
      },
    );
    const create = (schedule: Record<string, unknown>) => {
      const command = persistentFreeroll({ schedule });
      expect(durableService.createPersistentInstance(
        { kind: 'backoffice' },
        command,
        actionNow,
      ).ok).toBe(true);
      return command.requestId;
    };
    const hiddenId = create({
      visibleAt: actionNow + 60_000,
      registrationOpensAt: actionNow + 120_000,
      startsAt: actionNow + 600_000,
      manualStartExpiresAt: null,
    });
    const fundedId = create({
      visibleAt: actionNow,
      registrationOpensAt: actionNow,
      startsAt: actionNow + 600_000,
      manualStartExpiresAt: null,
    });
    const knownId = create({
      visibleAt: actionNow + 180_000,
      registrationOpensAt: actionNow + 240_000,
      startsAt: actionNow + 900_000,
      manualStartExpiresAt: null,
    });

    expect(durableService.act(
      { kind: 'backoffice' },
      hiddenId,
      { kind: 'cancel' },
    )).toBe('ok');
    expect(instances.getInstance(hiddenId)?.status).toBe('cancelled');

    expect(durableService.act(
      { kind: 'backoffice' },
      fundedId,
      { kind: 'cancel' },
    )).toBe('ok');
    expect(instances.getInstance(fundedId)?.status).toBe('refund-pending');
    expect(onRefundPending).toHaveBeenCalledWith(expect.objectContaining({
      id: fundedId,
      status: 'refund-pending',
    }));

    expect(durableService.act(
      { kind: 'backoffice' },
      knownId,
      { kind: 'pause' },
    )).toBe('bad-state');
    expect(durableService.start({ kind: 'backoffice' }, knownId))
      .toBe('not-registering');

    scheduler.close();
    database.close();
  });

  it('keeps ordered persistent tournament flags off and enforces dependencies', () => {
    const resolve = (
      tournamentCommandModule as unknown as {
        resolveMttFeatureFlags?: (
          env: Record<string, string | undefined>,
        ) => {
          schedulerV2: boolean;
          lateRegistration: boolean;
          walletLateRegistration: boolean;
        };
      }
    ).resolveMttFeatureFlags;
    expect(resolve).toBeTypeOf('function');
    if (!resolve) return;

    expect(resolve({})).toEqual({
      schedulerV2: false,
      lateRegistration: false,
      walletLateRegistration: false,
    });
    expect(() => resolve({ MTT_LATE_REG_ENABLED: 'true' }))
      .toThrow('MTT_SCHEDULER_V2_ENABLED');
    expect(() => resolve({
      MTT_SCHEDULER_V2_ENABLED: 'true',
      MTT_WALLET_LATE_REG_ENABLED: 'true',
    })).toThrow('MTT_LATE_REG_ENABLED');
    expect(resolve({
      MTT_SCHEDULER_V2_ENABLED: 'true',
      MTT_LATE_REG_ENABLED: 'true',
      MTT_WALLET_LATE_REG_ENABLED: 'true',
    })).toEqual({
      schedulerV2: true,
      lateRegistration: true,
      walletLateRegistration: true,
    });
  });
});
