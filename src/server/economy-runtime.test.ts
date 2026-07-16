import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { PokerEngine } from '../lib/poker/engine';
import type { Player, RoomConfig } from '../lib/poker/types';
import { EconomyRepository, EconomyDomainError } from './economy-repository';
import { EconomyRuntime } from './economy-runtime';
import { EconomyService } from './economy-service';
import { openPokerDatabase, type PokerDatabase } from './persistence/database';

const databases: PokerDatabase[] = [];
const tempDirectories: string[] = [];

afterEach(() => {
  while (databases.length > 0) databases.pop()?.close();
  while (tempDirectories.length > 0) {
    rmSync(tempDirectories.pop()!, { recursive: true, force: true });
  }
});

function openDatabase(path = ':memory:'): PokerDatabase {
  const database = openPokerDatabase(path);
  databases.push(database);
  return database;
}

function seedProfile(
  database: PokerDatabase,
  profileId: string,
  balance = 10_000,
): void {
  database.db.prepare(`
    INSERT INTO profiles (
      id, credential_hash, credential_lookup, recovery_hash, recovery_lookup,
      alias, avatar_id, adult_confirmed_at, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, 'sakura', 1, 1, 1)
  `).run(
    profileId,
    `credential-hash:${profileId}`,
    `credential-lookup:${profileId}`,
    `recovery-hash:${profileId}`,
    `recovery-lookup:${profileId}`,
    `alias:${profileId}`,
  );
  database.db.prepare(`
    INSERT INTO wallets (profile_id, balance, updated_at) VALUES (?, ?, 1)
  `).run(profileId, balance);
}

function walletBalance(database: PokerDatabase, profileId: string): number {
  return (database.db.prepare(`
    SELECT balance FROM wallets WHERE profile_id = ?
  `).get(profileId) as { balance: number }).balance;
}

function activeEscrow(
  database: PokerDatabase,
  profileId: string,
): {
  room_id: string;
  amount: number;
  checkpoint_amount: number;
  checkpoint_hand: number;
} | undefined {
  return database.db.prepare(`
    SELECT room_id, amount, checkpoint_amount, checkpoint_hand
    FROM seat_escrows
    WHERE profile_id = ? AND status = 'active'
  `).get(profileId) as {
    room_id: string;
    amount: number;
    checkpoint_amount: number;
    checkpoint_hand: number;
  } | undefined;
}

function makePlayer(
  id: string,
  type: 'human' | 'bot',
  chips: number,
  seatIndex: number,
): Player {
  return {
    id,
    name: id,
    type,
    avatar: type === 'bot' ? 'bot' : 'sakura',
    chips,
    seatIndex,
    holeCards: [],
    currentBet: 0,
    totalContributed: 0,
    status: 'waiting',
    hasActed: false,
  };
}

const walletCashConfig: RoomConfig = {
  name: 'Wallet cash',
  smallBlind: 10,
  bigBlind: 20,
  minBuyIn: 800,
  maxBuyIn: 4_000,
  maxPlayers: 6,
  economyMode: 'wallet',
  gameMode: 'cash',
  turnTime: 8,
};

function createRuntime(database: PokerDatabase, now = 100): EconomyRuntime {
  return new EconomyRuntime(
    new EconomyService(new EconomyRepository(database), () => now),
  );
}

describe('EconomyRuntime wallet cash lifecycle', () => {
  it('opens, checkpoints, settles a hand exactly once, and returns the final stack on exit', () => {
    const database = openDatabase();
    seedProfile(database, 'human-1');
    const runtime = createRuntime(database);
    const engine = new PokerEngine(walletCashConfig, 'room-1');

    runtime.openCashEscrow('human-1', 'room-1', 4_000);
    expect(walletBalance(database, 'human-1')).toBe(6_000);
    expect(activeEscrow(database, 'human-1')).toMatchObject({
      room_id: 'room-1',
      amount: 4_000,
      checkpoint_amount: 4_000,
      checkpoint_hand: 0,
    });

    engine.addPlayer(makePlayer('human-1', 'human', 4_000, 0));
    engine.addPlayer(makePlayer('bot-1', 'bot', 4_000, 1));
    runtime.beforeHand('room-1', engine);
    expect(activeEscrow(database, 'human-1')).toMatchObject({
      checkpoint_amount: 4_000,
      checkpoint_hand: 1,
    });

    engine.startHand();
    engine.state.players.find(player => player.id === 'human-1')!.chips = 4_700;
    engine.state.players.find(player => player.id === 'bot-1')!.chips = 3_200;
    engine.state.handRake = 100;
    engine.state.isHandInProgress = false;

    expect(runtime.afterHand('room-1', engine)).toEqual({
      paidTotal: 0,
      rake: 100,
    });
    expect(runtime.afterHand('room-1', engine)).toEqual({
      paidTotal: 0,
      rake: 100,
    });
    expect(activeEscrow(database, 'human-1')).toMatchObject({
      amount: 4_700,
      checkpoint_amount: 4_700,
      checkpoint_hand: 1,
    });

    const handLedger = database.db.prepare(`
      SELECT account, delta, reason, idempotency_key
      FROM chip_ledger
      WHERE idempotency_key LIKE 'cash-hand:room-1:1:%'
      ORDER BY account, idempotency_key
    `).all();
    expect(handLedger).toEqual([
      expect.objectContaining({ account: 'bot', delta: -800, reason: 'BOT_NET_LOSS' }),
      expect.objectContaining({ account: 'burn', delta: 100, reason: 'RAKE_BURN' }),
      expect.objectContaining({ account: 'escrow', delta: 700, reason: 'CASH_HAND_WIN' }),
    ]);

    runtime.settleExit('room-1', engine.state.players[0]);
    runtime.settleExit('room-1', engine.state.players[0]);
    expect(walletBalance(database, 'human-1')).toBe(10_700);
    expect(activeEscrow(database, 'human-1')).toBeUndefined();
  });

  it('rolls back the whole hand settlement when conservation is invalid', () => {
    const database = openDatabase();
    seedProfile(database, 'human-1');
    const runtime = createRuntime(database);
    const engine = new PokerEngine(walletCashConfig, 'room-1');
    runtime.openCashEscrow('human-1', 'room-1', 4_000);
    engine.addPlayer(makePlayer('human-1', 'human', 4_000, 0));
    engine.addPlayer(makePlayer('bot-1', 'bot', 4_000, 1));
    runtime.beforeHand('room-1', engine);
    engine.startHand();
    engine.state.players[0].chips = 4_700;
    engine.state.players[1].chips = 3_300;
    engine.state.handRake = 100;
    engine.state.isHandInProgress = false;

    expect(() => runtime.afterHand('room-1', engine)).toThrowError(
      expect.objectContaining({ code: 'CASH_CONSERVATION_INVALID' }),
    );
    expect(activeEscrow(database, 'human-1')).toMatchObject({
      amount: 4_000,
      checkpoint_amount: 4_000,
      checkpoint_hand: 1,
    });
    expect(database.db.prepare(`
      SELECT COUNT(*) AS count FROM chip_ledger
      WHERE idempotency_key LIKE 'cash-hand:room-1:1:%'
    `).get()).toEqual({ count: 0 });
  });

  it('rejects a conflicting duplicate even when aggregate bot and rake rows match', () => {
    const database = openDatabase();
    seedProfile(database, 'human-1');
    seedProfile(database, 'human-2');
    const runtime = createRuntime(database);
    runtime.openCashEscrow('human-1', 'room-1', 4_000);
    runtime.openCashEscrow('human-2', 'room-1', 4_000);
    const engine = new PokerEngine(walletCashConfig, 'room-1');
    engine.addPlayer(makePlayer('human-1', 'human', 4_000, 0));
    engine.addPlayer(makePlayer('human-2', 'human', 4_000, 1));
    engine.addPlayer(makePlayer('bot-1', 'bot', 4_000, 2));
    runtime.beforeHand('room-1', engine);
    engine.startHand();
    engine.state.players[0].chips = 4_500;
    engine.state.players[1].chips = 3_800;
    engine.state.players[2].chips = 3_600;
    engine.state.handRake = 100;
    engine.state.isHandInProgress = false;
    runtime.afterHand('room-1', engine);

    engine.state.players[0].chips = 4_400;
    engine.state.players[1].chips = 3_900;
    expect(() => runtime.afterHand('room-1', engine)).toThrowError(
      expect.objectContaining({ code: 'IDEMPOTENCY_KEY_CONFLICT' }),
    );
  });

  it('validates admission and compensates a failed seat without minting chips', () => {
    const database = openDatabase();
    seedProfile(database, 'human-1', 3_999);
    const runtime = createRuntime(database);

    expect(() => runtime.openCashEscrow('human-1', 'room-1', 4_000))
      .toThrowError(expect.objectContaining({ code: 'INSUFFICIENT_BALANCE' }));
    expect(() => runtime.openCashEscrow('human-1', 'room-1', 1.5))
      .toThrowError(expect.objectContaining({ code: 'CASH_BUY_IN_INVALID' }));

    runtime.openCashEscrow('human-1', 'room-1', 3_000);
    runtime.cancelCashEscrow('human-1', 'room-1');
    runtime.cancelCashEscrow('human-1', 'room-1');
    expect(walletBalance(database, 'human-1')).toBe(3_999);
    expect(activeEscrow(database, 'human-1')).toBeUndefined();
  });

  it('rolls back every pre-hand checkpoint if one human escrow is missing', () => {
    const database = openDatabase();
    seedProfile(database, 'human-1');
    seedProfile(database, 'human-2');
    const runtime = createRuntime(database);
    runtime.openCashEscrow('human-1', 'room-1', 4_000);
    const engine = new PokerEngine(walletCashConfig, 'room-1');
    engine.addPlayer(makePlayer('human-1', 'human', 4_000, 0));
    engine.addPlayer(makePlayer('human-2', 'human', 4_000, 1));

    expect(() => runtime.beforeHand('room-1', engine)).toThrowError(
      expect.objectContaining({ code: 'CASH_ESCROW_NOT_FOUND' }),
    );
    expect(activeEscrow(database, 'human-1')).toMatchObject({
      checkpoint_amount: 4_000,
      checkpoint_hand: 0,
    });
  });
});

describe('EconomyRuntime startup recovery', () => {
  it('void-refunds persisted checkpoints, not transient engine stacks, for every active cash escrow', () => {
    const directory = mkdtempSync(join(tmpdir(), 'poker-doku-economy-'));
    tempDirectories.push(directory);
    const path = join(directory, 'poker.sqlite');
    const firstDatabase = openDatabase(path);
    seedProfile(firstDatabase, 'in-hand');
    seedProfile(firstDatabase, 'between-hands');
    const firstRuntime = createRuntime(firstDatabase);
    firstRuntime.openCashEscrow('in-hand', 'room-a', 4_000);
    firstRuntime.openCashEscrow('between-hands', 'room-b', 4_700);

    const transientEngine = new PokerEngine(walletCashConfig, 'room-a');
    transientEngine.addPlayer(makePlayer('in-hand', 'human', 4_000, 0));
    transientEngine.addPlayer(makePlayer('bot-a', 'bot', 4_000, 1));
    firstRuntime.beforeHand('room-a', transientEngine);
    transientEngine.startHand();
    transientEngine.state.players[0].chips = 2_500;
    expect(transientEngine.state.players[0].chips).toBe(2_500);

    const betweenHandsEngine = new PokerEngine(walletCashConfig, 'room-b');
    betweenHandsEngine.addPlayer(makePlayer('between-hands', 'human', 4_700, 0));
    betweenHandsEngine.addPlayer(makePlayer('bot-b', 'bot', 4_700, 1));
    firstRuntime.beforeHand('room-b', betweenHandsEngine);
    betweenHandsEngine.startHand();
    betweenHandsEngine.state.players[0].chips = 4_700;
    betweenHandsEngine.state.players[1].chips = 4_700;
    betweenHandsEngine.state.isHandInProgress = false;
    firstRuntime.afterHand('room-b', betweenHandsEngine);

    firstDatabase.close();
    databases.splice(databases.indexOf(firstDatabase), 1);
    const restartedDatabase = openDatabase(path);
    const restartedRuntime = createRuntime(restartedDatabase, 200);

    expect(restartedRuntime.recoverActiveEscrows()).toBe(2);
    expect(restartedRuntime.recoverActiveEscrows()).toBe(0);
    expect(walletBalance(restartedDatabase, 'in-hand')).toBe(10_000);
    expect(walletBalance(restartedDatabase, 'between-hands')).toBe(10_000);
    expect(activeEscrow(restartedDatabase, 'in-hand')).toBeUndefined();
    expect(activeEscrow(restartedDatabase, 'between-hands')).toBeUndefined();
    expect(restartedDatabase.db.prepare(`
      SELECT profile_id, delta, reason, idempotency_key
      FROM chip_ledger
      WHERE reason = 'CASH_VOID_REFUND' AND account = 'wallet'
      ORDER BY profile_id
    `).all()).toEqual([
      expect.objectContaining({
        profile_id: 'between-hands',
        delta: 4_700,
        idempotency_key: 'void:between-hands:room-b:1',
      }),
      expect.objectContaining({
        profile_id: 'in-hand',
        delta: 4_000,
        idempotency_key: 'void:in-hand:room-a:1',
      }),
    ]);
  });

  it('keeps all active escrows open if any recovery row is invalid', () => {
    const database = openDatabase();
    seedProfile(database, 'human-1');
    seedProfile(database, 'human-2');
    const runtime = createRuntime(database);
    runtime.openCashEscrow('human-1', 'room-1', 4_000);
    runtime.openCashEscrow('human-2', 'room-2', 4_000);
    database.db.exec('PRAGMA ignore_check_constraints = ON');
    database.db.prepare(`
      UPDATE seat_escrows SET checkpoint_amount = -1 WHERE profile_id = 'human-2'
    `).run();
    database.db.exec('PRAGMA ignore_check_constraints = OFF');

    expect(() => runtime.recoverActiveEscrows()).toThrowError(EconomyDomainError);
    expect(walletBalance(database, 'human-1')).toBe(6_000);
    expect(activeEscrow(database, 'human-1')).toBeDefined();
    expect(activeEscrow(database, 'human-2')).toBeDefined();
  });
});
