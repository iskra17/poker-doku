import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { TournamentConfigSnapshotV2 } from '@/lib/tournament/tournament-config';
import {
  buildTournamentPayoutFreeze,
  buildTournamentSettlementPlan,
} from '@/lib/tournament/tournament-settlement';
import { EconomyRepository } from './economy-repository';
import { openPokerDatabase, type PokerDatabase } from './persistence/database';
import { PromotionFundRepository } from './promotion-fund-repository';
import { RoomManager } from './room-manager';
import { TournamentEnrollmentRepository } from './tournament-enrollment-repository';
import {
  TournamentInstanceRepository,
  type CreateInstanceCommand,
  type TournamentInstanceRecord,
} from './tournament-instance-repository';
import {
  loadTournamentRecoveryPlan,
  persistTournamentPayoutFreeze,
  resumeTournamentPayout,
  resumeTournamentRefund,
} from './tournament-recovery-service';
import {
  commitPersistentRunningRegistrationPolicy,
  shouldKeepPersistentLateRegistrationOpen,
} from './mtt-rollout';
import { TournamentManager } from './tournament-manager';
import { TournamentScheduler } from './tournament-scheduler';

const BASE = Date.now() - 1_000;
const temporaryDirectories: string[] = [];

afterEach(() => {
  while (temporaryDirectories.length > 0) {
    const directory = temporaryDirectories.pop()!;
    rmSync(directory, { recursive: true, force: true });
  }
});

describe('persistent scheduled MTT integrated lifecycle', () => {
  it('closes and freezes a config-enabled field when the live late gate is off', () => {
    const database = openPokerDatabase(':memory:');
    const now = BASE + 10;
    const instances = new TournamentInstanceRepository(database, () => now);
    const economy = new EconomyRepository(database);
    const enrollments = new TournamentEnrollmentRepository(
      database,
      economy,
      () => now,
    );
    const funds = new PromotionFundRepository(database);
    funds.adjustFund({
      requestId: randomUUID(),
      delta: 10_000,
      reason: 'scheduler-only start integration',
      actor: { kind: 'backoffice-admin', id: 'admin' },
      at: BASE,
    });
    instances.createInstance(instanceCommand(
      'scheduler-only-close',
      freerollConfig(),
      {
        visibleAt: BASE,
        registrationOpensAt: BASE,
        startsAt: BASE + 1_000,
        manualStartExpiresAt: null,
      },
    ));
    funds.reserveFreerollPrize({
      instanceId: 'scheduler-only-close',
      amount: 10_000,
      idempotencyKey: randomUUID(),
      actor: { kind: 'system', id: 'scheduler' },
      at: BASE,
    });
    for (const playerId of ['scheduler-player-a', 'scheduler-player-b']) {
      seedProfile(database, playerId, 0);
      enrollments.registerPreStart({
        tournamentId: 'scheduler-only-close',
        profileId: playerId,
        requestId: randomUUID(),
        publicPlayer: {
          id: playerId,
          name: playerId,
          avatar: 'sakura',
        },
        at: BASE,
      });
    }
    const candidates = enrollments.listStartingCandidates(
      'scheduler-only-close',
    );
    const start = instances.claimStart(
      'scheduler-only-close',
      'scheduler-owner',
      now + 30_000,
    );
    if (start.status !== 'claimed') throw new Error('start claim failed');
    enrollments.claimStartingRoster({
      tournamentId: start.instance.id,
      ownerId: start.ownerId,
      startAttempt: start.startAttempt,
      checkedInProfileIds: candidates.map(player => player.id),
      at: now,
    });

    const rooms = new RoomManager(() => {}, () => {});
    const manager = new TournamentManager(rooms, {}, {
      persistentRuntimeEnabled: true,
      persistentRuntimeRegistration: {
        readInstance: id => instances.getInstance(id),
      },
      persistentSettlement: {
        freezeRegistration: input =>
          persistTournamentPayoutFreeze(database, input),
        listParticipants: () => [],
        claimPayoutPending: () => 'not-claimable',
        settlePayout: () => {},
      },
    });
    const prepared = manager.prepareFromInstance(
      start.instance,
      candidates,
      start.ownerId,
    );
    const schedulerOnlyFlags = {
      schedulerV2: true,
      lateRegistration: false,
      walletLateRegistration: false,
    };
    expect(shouldKeepPersistentLateRegistrationOpen(
      schedulerOnlyFlags,
      start.instance.config,
    )).toBe(false);
    expect(commitPersistentRunningRegistrationPolicy(
      schedulerOnlyFlags,
      start.instance.config,
      'late-disabled:test',
      () => enrollments.commitStartingRoster({
        tournamentId: start.instance.id,
        ownerId: start.ownerId,
        startAttempt: start.startAttempt,
        humanEntrants: 2,
        initialEntrants: 2,
        initialBotEntrants: 0,
        committedEntrants: 2,
        everMultiTable: false,
        actualStartedAt: now,
      }),
      ownerToken => instances.claimRegistrationClose(
        start.instance.id,
        ownerToken,
        'late-reg-disabled',
      ),
    )).toBe(true);
    expect(instances.getInstance(start.instance.id)).toMatchObject({
      registrationState: 'closing',
      registrationOwnerToken: 'late-disabled:test',
    });

    manager.activatePreparedTournament(
      start.instance.id,
      start.ownerId,
      now,
    );

    expect(instances.getInstance(start.instance.id)).toMatchObject({
      status: 'running',
      registrationState: 'closed',
      registrationOwnerToken: null,
      finalEntrants: 2,
      payoutFreezeVersion: 1,
    });
    expect(manager.roomHooks.checkNextHandGate?.(prepared.roomIds[0]!))
      .toEqual({ status: 'allow' });
    manager.shutdown();
    rooms.shutdown();
    database.close();
  });

  it('runs scheduled visible register start late-seat close freeze settle across restart', () => {
    const { database, path } = fileDatabase();
    let now = BASE;
    const instances = new TournamentInstanceRepository(database, () => now);
    const economy = new EconomyRepository(database);
    const enrollments = new TournamentEnrollmentRepository(
      database,
      economy,
      () => now,
    );
    instances.createInstance(instanceCommand('lifecycle', walletConfig(), {
      visibleAt: BASE + 100,
      registrationOpensAt: BASE + 200,
      startsAt: BASE + 300,
      manualStartExpiresAt: null,
    }));
    let startClaim: TournamentInstanceRecord | undefined;
    const scheduler = new TournamentScheduler({
      database,
      clock: () => now,
      ownerId: 'lifecycle-scheduler',
      startProcessingEnabled: true,
      onStartClaim: instance => {
        startClaim = instance;
      },
      onStartLeaseExpired: vi.fn(),
    });

    now = BASE + 100;
    scheduler.reconcileDue();
    expect(instances.getInstance('lifecycle')?.status)
      .toBe('scheduled-visible');
    now = BASE + 200;
    scheduler.reconcileDue();
    expect(instances.getInstance('lifecycle')).toMatchObject({
      status: 'registering',
      registrationState: 'open-prestart',
    });

    for (const id of ['player-a', 'player-b']) {
      seedProfile(database, id, 5_000);
      enrollments.registerPreStart({
        tournamentId: 'lifecycle',
        profileId: id,
        requestId: randomUUID(),
        publicPlayer: { id, name: id, avatar: 'sakura' },
        at: now + 1,
      });
    }
    now = BASE + 300;
    scheduler.reconcileDue();
    expect(startClaim).toMatchObject({
      status: 'starting',
      registrationState: 'locked-for-start',
    });
    const roster = enrollments.claimStartingRoster({
      tournamentId: 'lifecycle',
      ownerId: 'lifecycle-scheduler',
      startAttempt: startClaim!.startAttempt,
      checkedInProfileIds: ['player-a', 'player-b'],
      at: now,
    });
    expect(roster.entries).toHaveLength(2);
    economy.startMttTournament(
      'lifecycle',
      ['player-a', 'player-b'],
      1_500,
      150,
      now,
    );
    expect(enrollments.commitStartingRoster({
      tournamentId: 'lifecycle',
      ownerId: 'lifecycle-scheduler',
      startAttempt: startClaim!.startAttempt,
      humanEntrants: 2,
      initialEntrants: 2,
      initialBotEntrants: 0,
      committedEntrants: 2,
      everMultiTable: false,
      actualStartedAt: now,
    })).toBe(true);

    seedProfile(database, 'player-c', 5_000);
    now += 1;
    const late = enrollments.reserveLateMttEntry(
      'player-c',
      'lifecycle',
      randomUUID(),
      'late-close-owner',
    );
    expect(late.status).toBe('reserved');
    if (late.status !== 'reserved') throw new Error('late reserve failed');
    enrollments.commitLateMttBatch('lifecycle', [late.key], 1);
    const close = instances.claimRegistrationClose(
      'lifecycle',
      'close-owner',
      'time',
    );
    expect(close.status).toBe('claimed');
    if (close.status !== 'claimed') throw new Error('close claim failed');

    const freeze = buildTournamentPayoutFreeze({
      version: 1,
      finalEntrants: 3,
      prizePool: 4_500,
      payouts: [4_500, 0, 0],
    });
    expect(persistTournamentPayoutFreeze(database, {
      instanceId: 'lifecycle',
      generation: close.generation,
      ownerToken: close.ownerToken,
      freeze,
      eliminatedPlayerIds: ['player-b', 'player-c'],
      now: now + 1,
    })).toBe(true);
    const settlement = buildTournamentSettlementPlan({
      instanceId: 'lifecycle',
      configVersion: 2,
      freeze,
      results: [
        settlementResult(1, 'player-a', 4_500),
        settlementResult(2, 'player-b', 0),
        settlementResult(3, 'player-c', 0),
      ],
      now: now + 2,
    });
    expect(instances.claimPayoutPending('lifecycle', settlement).status)
      .toBe('claimed');
    scheduler.close();
    database.close();

    const restarted = openPokerDatabase(path);
    const restartedInstances = new TournamentInstanceRepository(restarted);
    const restartedEconomy = new EconomyRepository(restarted);
    const plan = loadTournamentRecoveryPlan(restarted, now + 3);
    expect(plan.payoutInstanceIds).toEqual(['lifecycle']);
    resumeTournamentPayout({
      getInstance: id => restartedInstances.getInstance(id),
      settleWallet: (id, at) =>
        restartedEconomy.settlePersistedMttPayout(id, at),
      settleFreeroll: vi.fn(),
    }, 'lifecycle', now + 3);

    expect(restartedInstances.getInstance('lifecycle')).toMatchObject({
      status: 'completed',
      registrationState: 'closed',
      finalEntrants: 3,
      payoutFreezeVersion: 1,
    });
    expect(walletBalance(restarted, 'player-a')).toBe(7_850);
    restarted.close();
  });

  it('returns a cancelled freeroll prize and a short wallet field exactly once', () => {
    const database = openPokerDatabase(':memory:');
    const instances = new TournamentInstanceRepository(database, () => BASE);
    const economy = new EconomyRepository(database);
    const enrollments = new TournamentEnrollmentRepository(
      database,
      economy,
      () => BASE,
    );
    const funds = new PromotionFundRepository(database);
    funds.adjustFund({
      requestId: randomUUID(),
      delta: 10_000,
      reason: 'integration seed',
      actor: { kind: 'backoffice-admin', id: 'admin' },
      at: BASE,
    });
    instances.createInstance(instanceCommand(
      'cancelled-freeroll',
      freerollConfig(),
      {
        visibleAt: BASE,
        registrationOpensAt: BASE,
        startsAt: BASE + 1_000,
        manualStartExpiresAt: null,
      },
    ));
    funds.reserveFreerollPrize({
      instanceId: 'cancelled-freeroll',
      amount: 10_000,
      idempotencyKey: randomUUID(),
      actor: { kind: 'system', id: 'scheduler' },
      at: BASE,
    });

    instances.createInstance(instanceCommand('short-wallet', walletConfig(), {
      visibleAt: BASE,
      registrationOpensAt: BASE,
      startsAt: BASE + 1_000,
      manualStartExpiresAt: null,
    }));
    database.db.prepare(`
      UPDATE tournament_instance
      SET status = 'registering', registration_state = 'open-prestart'
      WHERE id = 'short-wallet'
    `).run();
    seedProfile(database, 'short-player', 5_000);
    enrollments.registerPreStart({
      tournamentId: 'short-wallet',
      profileId: 'short-player',
      requestId: randomUUID(),
      publicPlayer: {
        id: 'short-player',
        name: 'short-player',
        avatar: 'sakura',
      },
      at: BASE,
    });
    expect(instances.claimRefundPending(
      'cancelled-freeroll',
      'server-restart-unrecoverable',
      'refund-owner-freeroll',
    ).status).toBe('claimed');
    expect(instances.claimRefundPending(
      'short-wallet',
      'server-restart-unrecoverable',
      'refund-owner-wallet',
    ).status).toBe('claimed');

    const recoverRefundPass = (at: number) => {
      const plan = loadTournamentRecoveryPlan(database, at);
      for (const id of plan.refundInstanceIds) {
        resumeTournamentRefund({
          database,
          instances,
          funds,
          voidWallet: (instanceId, refundAt) =>
            economy.voidMttTournament(instanceId, refundAt),
        }, instances.getInstance(id)!, at, plan.refundReasons.get(id));
      }
      return plan;
    };
    const firstPlan = recoverRefundPass(BASE + 2_000);
    const secondPlan = recoverRefundPass(BASE + 2_001);

    expect(firstPlan.refundInstanceIds).toEqual([
      'cancelled-freeroll',
      'short-wallet',
    ]);
    expect(secondPlan.refundInstanceIds).toEqual([]);
    expect(instances.getInstance('cancelled-freeroll')?.status)
      .toBe('cancelled');
    expect(instances.getInstance('short-wallet')?.status).toBe('cancelled');
    expect(walletBalance(database, 'short-player')).toBe(5_000);
    expect(funds.getFundPage({ limit: 10 })).toMatchObject({
      availableBalance: 10_000,
      reservedTotal: 0,
    });
    expect(database.db.prepare(`
      SELECT COUNT(*) AS count
      FROM promotion_fund_ledger
      WHERE instance_id = 'cancelled-freeroll'
        AND kind = 'freeroll-prize-refund'
    `).get()).toEqual({ count: 1 });
    database.close();
  });

  it('keeps payout-pending immutable and resumes the frozen plan after restart', () => {
    const { database, path } = fileDatabase();
    const { instances, freeze, settlement } =
      preparePendingWalletPayout(database, 'pending-restart');
    const persisted = instances.getInstance('pending-restart')!;
    expect(instances.claimRefundPending(
      'pending-restart',
      'server-restart-unrecoverable',
      'must-not-refund',
    ).status).toBe('not-claimable');
    database.close();

    const restarted = openPokerDatabase(path);
    const restartedInstances = new TournamentInstanceRepository(restarted);
    const recovered = restartedInstances.getInstance('pending-restart')!;
    expect(recovered.status).toBe('payout-pending');
    expect(recovered.payoutFreeze).toEqual(persisted.payoutFreeze);
    expect(restartedInstances.claimPayoutPending(
      'pending-restart',
      settlement,
    ).status).toBe('already-pending');
    expect(recovered.payoutFreeze).toEqual({
      version: freeze.version,
      finalEntrants: freeze.finalEntrants,
      prizePool: freeze.prizePool,
      payouts: freeze.payouts,
    });

    const restartedEconomy = new EconomyRepository(restarted);
    resumeTournamentPayout({
      getInstance: id => restartedInstances.getInstance(id),
      settleWallet: (id, at) =>
        restartedEconomy.settlePersistedMttPayout(id, at),
      settleFreeroll: vi.fn(),
    }, 'pending-restart', BASE + 10_000);
    expect(restartedInstances.getInstance('pending-restart')?.status)
      .toBe('completed');
    restarted.close();
  });
});

function fileDatabase(): { database: PokerDatabase; path: string } {
  const directory = mkdtempSync(join(tmpdir(), 'poker-doku-mtt-'));
  temporaryDirectories.push(directory);
  const path = join(directory, 'poker.sqlite');
  return { database: openPokerDatabase(path), path };
}

function walletConfig(): TournamentConfigSnapshotV2 {
  return {
    version: 2,
    name: 'Persistent wallet',
    economy: { mode: 'wallet', productVersion: 1, buyIn: 1_500, fee: 150 },
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
      durationLevels: 1,
      minStartingStackBb: 20,
    },
  };
}

function freerollConfig(): TournamentConfigSnapshotV2 {
  return {
    ...walletConfig(),
    name: 'Persistent freeroll',
    economy: { mode: 'freeroll', promotionAccountId: 'global' },
    prizePool: { kind: 'promotion-funded', totalPrize: 10_000 },
  };
}

function instanceCommand(
  id: string,
  config: TournamentConfigSnapshotV2,
  schedule: CreateInstanceCommand['schedule'],
): CreateInstanceCommand {
  return {
    id,
    templateId: null,
    templateRevision: null,
    idempotencyKey: `instance:${id}`,
    occurrenceKey: id,
    schedule,
    config,
    createdBy: { kind: 'system', profileId: null },
    now: BASE,
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
    BASE,
    BASE,
  );
  database.db.prepare(`
    INSERT INTO wallets (profile_id, balance, updated_at) VALUES (?, ?, ?)
  `).run(id, balance, BASE);
}

function walletBalance(database: PokerDatabase, profileId: string): number {
  return (database.db.prepare(`
    SELECT balance FROM wallets WHERE profile_id = ?
  `).get(profileId) as { balance: number }).balance;
}

function settlementResult(place: number, playerId: string, prize: number) {
  return {
    place,
    playerId,
    participantType: 'human' as const,
    profileId: playerId,
    registrationAttempt: 1,
    displayName: playerId,
    prize,
    disposition: prize > 0 ? 'wallet-credit' as const : 'none' as const,
  };
}

function preparePendingWalletPayout(
  database: PokerDatabase,
  id: string,
) {
  let now = BASE;
  const instances = new TournamentInstanceRepository(database, () => now);
  const economy = new EconomyRepository(database);
  const enrollments = new TournamentEnrollmentRepository(
    database,
    economy,
    () => now,
  );
  instances.createInstance(instanceCommand(id, walletConfig(), {
    visibleAt: BASE,
    registrationOpensAt: BASE,
    startsAt: BASE + 1_000,
    manualStartExpiresAt: null,
  }));
  database.db.prepare(`
    UPDATE tournament_instance
    SET status = 'registering', registration_state = 'open-prestart'
    WHERE id = ?
  `).run(id);
  for (const playerId of [`${id}-a`, `${id}-b`]) {
    seedProfile(database, playerId, 5_000);
    enrollments.registerPreStart({
      tournamentId: id,
      profileId: playerId,
      requestId: randomUUID(),
      publicPlayer: {
        id: playerId,
        name: playerId,
        avatar: 'sakura',
      },
      at: BASE,
    });
  }
  const start = instances.claimStart(id, 'start-owner', BASE + 30_000);
  if (start.status !== 'claimed') throw new Error('start claim failed');
  const players = [`${id}-a`, `${id}-b`];
  enrollments.claimStartingRoster({
    tournamentId: id,
    ownerId: 'start-owner',
    startAttempt: start.startAttempt,
    checkedInProfileIds: players,
    at: BASE + 1,
  });
  economy.startMttTournament(id, players, 1_500, 150, BASE + 1);
  expect(enrollments.commitStartingRoster({
    tournamentId: id,
    ownerId: 'start-owner',
    startAttempt: start.startAttempt,
    humanEntrants: 2,
    initialEntrants: 2,
    initialBotEntrants: 0,
    committedEntrants: 2,
    everMultiTable: false,
    actualStartedAt: BASE + 1,
  })).toBe(true);
  const close = instances.claimRegistrationClose(id, 'close-owner', 'time');
  if (close.status !== 'claimed') throw new Error('close claim failed');
  const freeze = buildTournamentPayoutFreeze({
    version: 1,
    finalEntrants: 2,
    prizePool: 3_000,
    payouts: [3_000, 0],
  });
  expect(persistTournamentPayoutFreeze(database, {
    instanceId: id,
    generation: close.generation,
    ownerToken: close.ownerToken,
    freeze,
    eliminatedPlayerIds: [players[1]!],
    now: BASE + 2,
  })).toBe(true);
  const settlement = buildTournamentSettlementPlan({
    instanceId: id,
    configVersion: 2,
    freeze,
    results: [
      settlementResult(1, players[0]!, 3_000),
      settlementResult(2, players[1]!, 0),
    ],
    now: BASE + 3,
  });
  expect(instances.claimPayoutPending(id, settlement).status).toBe('claimed');
  now = BASE + 3;
  return { instances, freeze, settlement };
}
