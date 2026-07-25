import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CreateTournamentRequest } from '../lib/realtime/protocol';
import { RoomManager } from './room-manager';
import { TournamentManager } from './tournament-manager';
import {
  TournamentCommandService,
  parseTournamentOperatorIds,
} from './tournament-command-service';
import { eventLog } from './event-log';

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
});
