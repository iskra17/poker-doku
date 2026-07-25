import { randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { TournamentConfigSnapshotV2 } from '@/lib/tournament/tournament-config';
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
  loadTournamentRecoveryPlan,
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

  it('quarantines config-mismatched reserved entries without active registration', () => {
    const database = testDatabase();
    const instances = new TournamentInstanceRepository(database, () => NOW);
    const economy = new EconomyRepository(database);
    const economyService = new EconomyService(economy, () => NOW);
    const enrollment = new TournamentEnrollmentRepository(
      database,
      economy,
      () => NOW,
    );
    instances.createInstance(instanceCommand('config-mismatch'));
    database.db.prepare(`
      UPDATE tournament_instance
      SET status = 'registering', registration_state = 'open-prestart',
          updated_at = ?
      WHERE id = 'config-mismatch'
    `).run(NOW);
    seedProfile(database, 'mismatch-player', 5_000);
    enrollment.registerPreStart({
      tournamentId: 'config-mismatch',
      profileId: 'mismatch-player',
      requestId: randomUUID(),
      publicPlayer: {
        id: 'mismatch-player',
        name: 'Mismatch',
        avatar: 'sakura',
      },
      at: NOW,
    });
    database.db.exec(`
      DROP TRIGGER protect_tournament_instance_identity;
      UPDATE tournament_instance
      SET config_json = json_set(
        config_json,
        '$.economy.buyIn',
        1600
      )
      WHERE id = 'config-mismatch';
    `);

    const plan = loadTournamentRecoveryPlan(database, NOW);
    expect(plan.preserveReservedMttEntries.has('config-mismatch')).toBe(false);
    expect(plan.refundInstanceIds).toContain('config-mismatch');
    expect(plan.refundReasons.get('config-mismatch')).toBe(
      'financial-invariant',
    );

    resumeTournamentRefund({
      database,
      instances,
      funds: new PromotionFundRepository(database),
      voidWallet: (id, at) => economyService.voidMttTournament(id, at),
    }, instances.getInstance('config-mismatch')!, NOW, 'financial-invariant');

    expect(instances.getInstance('config-mismatch')).toMatchObject({
      status: 'cancelled',
      statusReason: 'financial-invariant',
    });
    expect(database.db.prepare(`
      SELECT status FROM tournament_registration
      WHERE instance_id = 'config-mismatch'
    `).get()).toEqual({ status: 'refunded' });
    expect(database.db.prepare(`
      SELECT status FROM sng_entries
      WHERE tournament_id = 'config-mismatch'
    `).get()).toEqual({ status: 'refunded' });
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
