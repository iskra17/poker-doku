import { randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { TournamentConfigSnapshotV2 } from '@/lib/tournament/tournament-config';
import { buildTournamentPayoutFreeze } from '@/lib/tournament/tournament-settlement';
import { EconomyRepository } from './economy-repository';
import { EconomyService } from './economy-service';
import { openPokerDatabase, type PokerDatabase } from './persistence/database';
import { PromotionFundRepository } from './promotion-fund-repository';
import { TournamentEnrollmentRepository } from './tournament-enrollment-repository';
import {
  TournamentInstanceRepository,
  type CreateInstanceCommand,
} from './tournament-instance-repository';
import {
  listTournamentSettlementParticipants,
  loadTournamentRecoveryPlan,
  persistTournamentPayoutFreeze,
  resumeTournamentPayout,
  resumeTournamentRefund,
  TournamentRecoveryError,
  TournamentRecoveryService,
  type TournamentRecoveryPlan,
} from './tournament-recovery-service';

const NOW = Date.now() - 10_000;
const databases: PokerDatabase[] = [];

afterEach(() => {
  while (databases.length > 0) databases.pop()!.close();
});

describe('TournamentRecoveryService', () => {
  it('preserves prestart entries before generic recovery and resumes pending money work', () => {
    const calls: string[] = [];
    const plan: TournamentRecoveryPlan = {
      preserveReservedMttEntries: new Map([
        ['registering', new Map([
          ['profile-1', {
            economyEntryAttempt: 2,
            productVersion: 7,
            buyIn: 1_500,
            fee: 150,
          }],
        ])],
      ]),
      deferToMttVoidInstanceIds: new Set(['refund-wallet', 'refund-freeroll']),
      refundInstanceIds: ['refund-wallet', 'refund-freeroll'],
      refundReasons: new Map([
        ['refund-wallet', 'server-restart-unrecoverable'],
        ['refund-freeroll', 'server-restart-unrecoverable'],
      ]),
      payoutInstanceIds: ['payout-pending'],
    };
    const service = new TournamentRecoveryService({
      loadAndValidate: vi.fn(() => {
        calls.push('load');
        return plan;
      }),
      recoverGeneric: vi.fn(options => {
        calls.push('generic');
        expect(options.preserveReservedMttEntries).toBe(
          plan.preserveReservedMttEntries,
        );
        expect(options.deferToMttVoidInstanceIds).toBe(
          plan.deferToMttVoidInstanceIds,
        );
        return recoveryResult();
      }),
      resumeRefund: vi.fn(instanceId => calls.push(`refund:${instanceId}`)),
      resumePayout: vi.fn(instanceId => calls.push(`payout:${instanceId}`)),
      reconcileTemplatesAndTimers: vi.fn(() => calls.push('scheduler')),
    });

    service.recoverBeforeListen();

    expect(calls).toEqual([
      'load',
      'generic',
      'refund:refund-wallet',
      'refund:refund-freeroll',
      'payout:payout-pending',
      'scheduler',
    ]);
  });

  it('never converts payout-pending work into a refund', () => {
    const resumeRefund = vi.fn();
    const resumePayout = vi.fn();
    const service = new TournamentRecoveryService({
      loadAndValidate: () => ({
        preserveReservedMttEntries: new Map(),
        deferToMttVoidInstanceIds: new Set(),
        refundInstanceIds: [],
        refundReasons: new Map(),
        payoutInstanceIds: ['payout-only'],
      }),
      recoverGeneric: vi.fn(() => recoveryResult()),
      resumeRefund,
      resumePayout,
      reconcileTemplatesAndTimers: vi.fn(),
    });

    service.recoverBeforeListen();

    expect(resumeRefund).not.toHaveBeenCalled();
    expect(resumePayout).toHaveBeenCalledWith('payout-only');
  });

  it.each(['wallet', 'freeroll'] as const)(
    'resumes the exact persisted %s payout executor and requires completion',
    economyMode => {
      let status: 'payout-pending' | 'completed' = 'payout-pending';
      const settleWallet = vi.fn(() => {
        status = 'completed';
      });
      const settleFreeroll = vi.fn(() => {
        status = 'completed';
      });

      resumeTournamentPayout({
        getInstance: () => ({
          id: `payout-${economyMode}`,
          economyMode,
          status,
        }),
        settleWallet,
        settleFreeroll,
      }, `payout-${economyMode}`, NOW);

      expect(settleWallet).toHaveBeenCalledTimes(economyMode === 'wallet' ? 1 : 0);
      expect(settleFreeroll).toHaveBeenCalledTimes(
        economyMode === 'freeroll' ? 1 : 0,
      );
      expect(status).toBe('completed');
    },
  );

  it('keeps failed recovery payout-pending and never invokes a refund path', () => {
    const resumeRefund = vi.fn();
    const settleWallet = vi.fn(() => {
      throw new Error('wallet unavailable');
    });
    const persisted = {
      id: 'payout-retry',
      economyMode: 'wallet' as const,
      status: 'payout-pending' as const,
    };

    expect(() => resumeTournamentPayout({
      getInstance: () => persisted,
      settleWallet,
      settleFreeroll: vi.fn(),
    }, persisted.id, NOW)).toThrowError(TournamentRecoveryError);
    expect(settleWallet).toHaveBeenCalledWith(persisted.id, NOW);
    expect(persisted.status).toBe('payout-pending');
    expect(resumeRefund).not.toHaveBeenCalled();
  });

  it('freezes a closing field once and resolves provisional human identities', () => {
    const {
      database,
      id,
      instances,
      playerId,
    } = createRunningClosingEnrollment('freeze-field');
    const close = instances.getInstance(id)!;
    const freeze = buildTournamentPayoutFreeze({
      version: 1,
      finalEntrants: 1,
      prizePool: 1_500,
      payouts: [1_500],
    });
    const input = {
      instanceId: id,
      generation: close.registrationGeneration,
      ownerToken: close.registrationOwnerToken,
      freeze,
      eliminatedPlayerIds: [playerId],
      now: NOW,
    };

    expect(persistTournamentPayoutFreeze(database, input)).toBe(true);
    expect(persistTournamentPayoutFreeze(database, input)).toBe(true);
    expect(instances.getInstance(id)).toMatchObject({
      status: 'running',
      registrationState: 'closed',
      registrationOwnerToken: null,
      finalEntrants: 1,
      payoutFreezeVersion: 1,
    });
    expect(database.db.prepare(`
      SELECT status FROM tournament_registration
      WHERE instance_id = ? AND profile_id = ?
    `).get(id, playerId)).toEqual({ status: 'eliminated' });
    expect(listTournamentSettlementParticipants(database, id)).toEqual([{
      playerId,
      profileId: playerId,
      registrationAttempt: 1,
      displayName: 'Recovery',
    }]);
  });

  it('rejects a stale freeze owner without changing registration', () => {
    const {
      database,
      id,
      instances,
      playerId,
    } = createRunningClosingEnrollment('stale-freeze-owner');
    const close = instances.getInstance(id)!;
    const freeze = buildTournamentPayoutFreeze({
      version: 1,
      finalEntrants: 1,
      prizePool: 1_500,
      payouts: [1_500],
    });

    expect(persistTournamentPayoutFreeze(database, {
      instanceId: id,
      generation: close.registrationGeneration,
      ownerToken: 'different-owner',
      freeze,
      eliminatedPlayerIds: [playerId],
      now: NOW,
    })).toBe(false);
    expect(instances.getInstance(id)).toMatchObject({
      registrationState: 'closing',
      registrationOwnerToken: 'close-owner',
      finalEntrants: null,
    });
  });

  it('aborts before money work when generic recovery reports failures', () => {
    const resumeRefund = vi.fn();
    const service = new TournamentRecoveryService({
      loadAndValidate: () => ({
        preserveReservedMttEntries: new Map(),
        deferToMttVoidInstanceIds: new Set(['refund']),
        refundInstanceIds: ['refund'],
        refundReasons: new Map([
          ['refund', 'server-restart-unrecoverable'],
        ]),
        payoutInstanceIds: [],
      }),
      recoverGeneric: () => ({
        refunded: 0,
        failed: 1,
        preserved: 0,
        deferred: 1,
      }),
      resumeRefund,
      resumePayout: vi.fn(),
      reconcileTemplatesAndTimers: vi.fn(),
    });

    expect(() => service.recoverBeforeListen()).toThrowError(
      TournamentRecoveryError,
    );
    expect(resumeRefund).not.toHaveBeenCalled();
  });

  it('fails closed when a stale closing owner prevents refund ownership', () => {
    const database = testDatabase();
    const instances = new TournamentInstanceRepository(database, () => NOW);
    instances.createInstance(instanceCommand('old-closing-owner'));
    seedProfileAndLiability(database, 'old-closing-owner');
    makeRunningOpenLate(database, 'old-closing-owner');
    instances.claimRegistrationClose(
      'old-closing-owner',
      'old-owner',
      'time',
    );

    expect(() => resumeTournamentRefund({
      database,
      instances,
      funds: new PromotionFundRepository(database),
      voidWallet: () => {
        throw new Error('must not reach wallet void');
      },
    }, instances.getInstance('old-closing-owner')!, NOW)).toThrowError(
      TournamentRecoveryError,
    );
    expect(instances.getInstance('old-closing-owner')).toMatchObject({
      status: 'running',
      registrationState: 'closing',
      registrationOwnerToken: 'old-owner',
    });
  });

  it.each([
    {
      name: 'valid exact reserved incarnation',
      valid: true,
      corrupt: () => undefined,
    },
    {
      name: 'missing economy entry',
      valid: false,
      corrupt: (database: PokerDatabase, id: string) => {
        database.db.prepare(
          `DELETE FROM sng_entries WHERE tournament_id = ?`,
        ).run(id);
      },
    },
    {
      name: 'refunded economy entry',
      valid: false,
      corrupt: (database: PokerDatabase, id: string) => {
        database.db.prepare(`
          UPDATE sng_entries SET status = 'refunded'
          WHERE tournament_id = ?
        `).run(id);
      },
    },
    {
      name: 'started economy entry',
      valid: false,
      corrupt: (database: PokerDatabase, id: string) => {
        database.db.prepare(`
          UPDATE sng_entries SET status = 'started', start_attempt = 1
          WHERE tournament_id = ?
        `).run(id);
      },
    },
    {
      name: 'wrong economy incarnation',
      valid: false,
      corrupt: (database: PokerDatabase, id: string) => {
        database.db.prepare(`
          UPDATE sng_entries SET entry_attempt = 2
          WHERE tournament_id = ?
        `).run(id);
      },
    },
    {
      name: 'wrong room incarnation',
      valid: false,
      corrupt: corruptRoomIncarnation,
    },
    {
      name: 'multiple active economy links',
      valid: false,
      corrupt: addConflictingEntry,
    },
    {
      name: 'config product mismatch',
      valid: false,
      corrupt: (database: PokerDatabase, id: string) => {
        database.db.exec(`
          DROP TRIGGER protect_tournament_instance_identity;
        `);
        database.db.prepare(`
          UPDATE tournament_instance
          SET config_json = json_set(config_json, '$.economy.buyIn', 1600)
          WHERE id = ?
        `).run(id);
      },
    },
  ])('classifies $name from the complete prestart registration set', ({
    name,
    valid,
    corrupt,
  }) => {
    const { database, id } = createRecoveryEnrollment(
      name.replaceAll(' ', '-'),
    );
    corrupt(database, id);

    const plan = loadTournamentRecoveryPlan(database, NOW);

    expect(plan.preserveReservedMttEntries.has(id)).toBe(valid);
    expect(plan.refundInstanceIds.includes(id)).toBe(!valid);
    expect(plan.deferToMttVoidInstanceIds.has(id)).toBe(!valid);
    expect(plan.refundReasons.get(id)).toBe(
      valid ? undefined : 'financial-invariant',
    );
    if (valid) {
      expect(plan.preserveReservedMttEntries.get(id)?.get(`${id}-player`))
        .toEqual({
          economyEntryAttempt: 1,
          productVersion: 7,
          buyIn: 1_500,
          fee: 150,
        });
    }
  });

  it('terminalizes the registration claim before an incoherent void fails', () => {
    const {
      database,
      economyService,
      id,
      instances,
    } = createRecoveryEnrollment('conflicting-terminalization');
    addConflictingEntry(database, id);
    const plan = loadTournamentRecoveryPlan(database, NOW);

    expect(() => resumeTournamentRefund({
      database,
      instances,
      funds: new PromotionFundRepository(database),
      voidWallet: (instanceId, at) =>
        economyService.voidMttTournament(instanceId, at),
    }, instances.getInstance(id)!, NOW, 'financial-invariant')).toThrowError(
      TournamentRecoveryError,
    );

    expect(database.db.prepare(`
      SELECT status FROM tournament_registration WHERE instance_id = ?
    `).get(id)).toEqual({ status: 'refunded' });
    expect(database.db.prepare(`
      SELECT status FROM tournament_registration_attempt
      WHERE instance_id = ?
    `).get(id)).toEqual({ status: 'refunded' });
    expect(instances.getInstance(id)).toMatchObject({
      status: 'refund-pending',
      statusReason: 'financial-invariant',
    });
    expect(plan.deferToMttVoidInstanceIds.has(id)).toBe(true);
  });

  it('quarantines a wrong room incarnation before generic recovery', () => {
    const {
      database,
      economyService,
      id,
      instances,
    } = createRecoveryEnrollment('wrong-room-fail-closed');
    corruptRoomIncarnation(database, id);

    const plan = loadTournamentRecoveryPlan(database, NOW);
    expect(plan.preserveReservedMttEntries.has(id)).toBe(false);
    expect(plan.refundReasons.get(id)).toBe('financial-invariant');
    expect(plan.deferToMttVoidInstanceIds.has(id)).toBe(true);

    expect(() => resumeTournamentRefund({
      database,
      instances,
      funds: new PromotionFundRepository(database),
      voidWallet: (instanceId, at) =>
        economyService.voidMttTournament(instanceId, at),
    }, instances.getInstance(id)!, NOW, 'financial-invariant')).toThrowError(
      TournamentRecoveryError,
    );

    expect(database.db.prepare(`
      SELECT status FROM tournament_registration WHERE instance_id = ?
    `).get(id)).toEqual({ status: 'refunded' });
    expect(database.db.prepare(`
      SELECT status FROM tournament_registration_attempt
      WHERE instance_id = ?
    `).get(id)).toEqual({ status: 'refunded' });
    expect(instances.getInstance(id)).toMatchObject({
      status: 'refund-pending',
      statusReason: 'financial-invariant',
    });
  });
});

function recoveryResult(failed = 0) {
  return { refunded: 0, failed, preserved: 0, deferred: 0 };
}

function testDatabase(): PokerDatabase {
  const database = openPokerDatabase(':memory:');
  databases.push(database);
  return database;
}

function createRecoveryEnrollment(id: string): {
  readonly database: PokerDatabase;
  readonly economyService: EconomyService;
  readonly id: string;
  readonly instances: TournamentInstanceRepository;
} {
  const database = testDatabase();
  const instances = new TournamentInstanceRepository(database, () => NOW);
  const economy = new EconomyRepository(database);
  const economyService = new EconomyService(economy, () => NOW);
  const enrollment = new TournamentEnrollmentRepository(
    database,
    economy,
    () => NOW,
  );
  instances.createInstance(instanceCommand(id));
  database.db.prepare(`
    UPDATE tournament_instance
    SET status = 'registering', registration_state = 'open-prestart',
        updated_at = ?
    WHERE id = ?
  `).run(NOW, id);
  seedProfile(database, `${id}-player`, 5_000);
  enrollment.registerPreStart({
    tournamentId: id,
    profileId: `${id}-player`,
    requestId: randomUUID(),
    publicPlayer: {
      id: `${id}-player`,
      name: 'Recovery',
      avatar: 'sakura',
    },
    at: NOW,
  });
  return { database, economyService, id, instances };
}

function createRunningClosingEnrollment(id: string): {
  readonly database: PokerDatabase;
  readonly id: string;
  readonly instances: TournamentInstanceRepository;
  readonly playerId: string;
} {
  const {
    database,
    id: instanceId,
    instances,
  } = createRecoveryEnrollment(id);
  const economy = new EconomyRepository(database);
  const enrollment = new TournamentEnrollmentRepository(
    database,
    economy,
    () => NOW,
  );
  const playerId = `${instanceId}-player`;
  const claim = instances.claimStart(
    instanceId,
    'starter',
    NOW + 30_000,
  );
  if (claim.status !== 'claimed') throw new Error('start claim failed');
  enrollment.claimStartingRoster({
    tournamentId: instanceId,
    ownerId: 'starter',
    startAttempt: claim.startAttempt,
    checkedInProfileIds: [playerId],
    at: NOW,
  });
  if (!enrollment.commitStartingRoster({
    tournamentId: instanceId,
    ownerId: 'starter',
    startAttempt: claim.startAttempt,
    humanEntrants: 1,
    initialEntrants: 1,
    initialBotEntrants: 0,
    committedEntrants: 1,
    everMultiTable: false,
    actualStartedAt: NOW,
  })) {
    throw new Error('running commit failed');
  }
  const close = instances.claimRegistrationClose(
    instanceId,
    'close-owner',
    'time',
  );
  if (close.status !== 'claimed') throw new Error('close claim failed');
  return { database, id: instanceId, instances, playerId };
}

function addConflictingEntry(database: PokerDatabase, id: string): void {
  database.db.exec(`DROP INDEX one_active_sng_entry_per_profile;`);
  database.db.prepare(`
    INSERT INTO sng_entries (
      id, tournament_id, room_id, profile_id, buy_in, fee, status,
      place, prize, start_attempt, entry_attempt, created_at, updated_at
    ) VALUES (?, ?, ?, ?, 1500, 150, 'reserved',
      NULL, 0, 0, 2, ?, ?)
  `).run(
    `conflict-${id}`,
    id,
    id,
    `${id}-player`,
    NOW,
    NOW,
  );
}

function corruptRoomIncarnation(database: PokerDatabase, id: string): void {
  database.db.prepare(`
    UPDATE sng_entries SET room_id = ?
    WHERE tournament_id = ?
  `).run(`${id}-other-room`, id);
}

function walletConfig(): TournamentConfigSnapshotV2 {
  return {
    version: 2,
    name: 'Recovery wallet',
    economy: { mode: 'wallet', productVersion: 7, buyIn: 1_500, fee: 150 },
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
    prizePool: { kind: 'entry-pool' },
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

function instanceCommand(id: string): CreateInstanceCommand {
  return {
    id,
    templateId: null,
    templateRevision: null,
    idempotencyKey: `instance:${id}`,
    occurrenceKey: id,
    schedule: {
      visibleAt: NOW - 10_000,
      registrationOpensAt: NOW - 5_000,
      startsAt: NOW + 300_000,
      manualStartExpiresAt: null,
    },
    config: walletConfig(),
    createdBy: { kind: 'system', profileId: null },
    now: NOW - 20_000,
  };
}

function seedProfile(
  database: PokerDatabase,
  id: string,
  balance: number,
): void {
  database.db.prepare(`
    INSERT INTO profiles (
      id, credential_hash, credential_lookup, recovery_hash, recovery_lookup,
      alias, avatar_id, adult_confirmed_at, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, 'sakura', 1, ?, ?)
  `).run(
    id,
    `credential-hash:${id}`,
    `credential-lookup:${id}`,
    `recovery-hash:${id}`,
    `recovery-lookup:${id}`,
    id,
    NOW,
    NOW,
  );
  database.db.prepare(`
    INSERT INTO wallets (profile_id, balance, updated_at) VALUES (?, ?, ?)
  `).run(id, balance, NOW);
}

function seedProfileAndLiability(
  database: PokerDatabase,
  instanceId: string,
): void {
  seedProfile(database, 'profile-a', 5_000);
  database.db.prepare(`
    INSERT INTO sng_entries (
      id, tournament_id, room_id, profile_id, buy_in, fee, status,
      place, prize, start_attempt, entry_attempt, created_at, updated_at
    ) VALUES (?, ?, ?, 'profile-a', 1500, 150, 'reserved',
      NULL, 0, 0, 1, ?, ?)
  `).run(`entry-${instanceId}`, instanceId, instanceId, NOW, NOW);
}

function makeRunningOpenLate(
  database: PokerDatabase,
  instanceId: string,
): void {
  database.db.prepare(`
    UPDATE tournament_instance
    SET status = 'registering', registration_state = 'open-prestart',
        updated_at = ?
    WHERE id = ?
  `).run(NOW, instanceId);
  database.db.prepare(`
    UPDATE tournament_instance
    SET status = 'starting', registration_state = 'locked-for-start',
        start_attempt = 1, start_owner_id = 'starter',
        start_lease_until = ?, updated_at = ?
    WHERE id = ?
  `).run(NOW + 30_000, NOW, instanceId);
  database.db.prepare(`
    UPDATE tournament_instance
    SET status = 'running', registration_state = 'open-late',
        initial_entrants = 2, initial_bot_entrants = 0,
        committed_entrants = 2, actual_started_at = ?,
        start_owner_id = NULL, start_lease_until = NULL, updated_at = ?
    WHERE id = ?
  `).run(NOW, NOW, instanceId);
}
