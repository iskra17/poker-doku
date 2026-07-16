import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PokerEngine } from '../lib/poker/engine';
import type { Player, RoomConfig } from '../lib/poker/types';
import { EconomyRepository, EconomyDomainError } from './economy-repository';
import { EconomyRuntime } from './economy-runtime';
import { EconomyService } from './economy-service';
import { openPokerDatabase, type PokerDatabase } from './persistence/database';
import { RoomManager } from './room-manager';

const databases: PokerDatabase[] = [];
const tempDirectories: string[] = [];

afterEach(() => {
  vi.useRealTimers();
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
    const cancellationProbe = new EconomyService(
      new EconomyRepository(database),
      () => 101,
    );
    expect(cancellationProbe.cancelPreparedCashHand('room-1', 1)).toBe(false);
    expect(database.db.prepare(`
      SELECT status FROM cash_hand_settlements
      WHERE room_id = 'room-1' AND settlement_seq = 1
    `).get()).toEqual({ status: 'settled' });

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

  it('rejects a duplicate settlement that omits an original zero-delta human', () => {
    const database = openDatabase();
    seedProfile(database, 'human-1');
    seedProfile(database, 'human-2');
    const service = new EconomyService(new EconomyRepository(database), () => 100);
    service.openCashEscrow('human-1', 'room-1', 4_000);
    service.openCashEscrow('human-2', 'room-1', 4_000);
    service.checkpointCashHand('room-1', 1, [
      { profileId: 'human-1', amount: 4_000 },
      { profileId: 'human-2', amount: 4_000 },
    ]);
    service.settleCashHand('room-1', 1, [
      { profileId: 'human-1', startAmount: 4_000, endAmount: 4_100 },
      { profileId: 'human-2', startAmount: 4_000, endAmount: 4_000 },
    ], -100, 0);

    expect(() => service.settleCashHand('room-1', 1, [
      { profileId: 'human-1', startAmount: 4_000, endAmount: 4_100 },
    ], -100, 0)).toThrowError(
      expect.objectContaining({ code: 'IDEMPOTENCY_KEY_CONFLICT' }),
    );
  });

  it('uses a new durable hand identity when the same room id starts over at hand one', () => {
    const database = openDatabase();
    seedProfile(database, 'human-1');
    const runtime = createRuntime(database);

    const playSession = (humanEnd: number): PokerEngine => {
      runtime.openCashEscrow('human-1', 'persistent-room', 4_000);
      const engine = new PokerEngine(walletCashConfig, 'persistent-room');
      engine.addPlayer(makePlayer('human-1', 'human', 4_000, 0));
      engine.addPlayer(makePlayer('bot-1', 'bot', 4_000, 1));
      runtime.beforeHand('persistent-room', engine);
      engine.startHand();
      engine.state.players[0].chips = humanEnd;
      engine.state.players[1].chips = 8_000 - humanEnd;
      engine.state.handRake = 0;
      engine.state.isHandInProgress = false;
      runtime.afterHand('persistent-room', engine);
      return engine;
    };

    const first = playSession(4_100);
    runtime.settleExit('persistent-room', first.state.players[0]);
    const second = playSession(4_200);

    expect(second.state.handNumber).toBe(1);
    expect(activeEscrow(database, 'human-1')).toMatchObject({ amount: 4_200 });
    expect(database.db.prepare(`
      SELECT idempotency_key FROM chip_ledger
      WHERE idempotency_key LIKE 'cash-hand:persistent-room:%:bot'
      ORDER BY idempotency_key
    `).all()).toEqual([
      { idempotency_key: 'cash-hand:persistent-room:1:bot' },
      { idempotency_key: 'cash-hand:persistent-room:2:bot' },
    ]);
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

  it('does not prepare a hand after a delayed departure and starts cleanly with a replacement', () => {
    vi.useFakeTimers();
    const database = openDatabase();
    for (const id of ['human-1', 'human-2', 'human-3']) seedProfile(database, id);
    const runtime = createRuntime(database);
    const manager = new RoomManager(() => {}, () => {}, undefined, {
      economy: runtime,
    });
    const roomId = manager.createRoom({
      ...walletCashConfig,
      botCount: 0,
      tableType: 'humans',
    });
    for (const [id, seat] of [['human-1', 0], ['human-2', 1]] as const) {
      runtime.openCashEscrow(id, roomId, 4_000);
      manager.joinRoom(roomId, makePlayer(id, 'human', 4_000, seat));
    }

    manager.leaveRoom(roomId, 'human-2');
    vi.advanceTimersByTime(2_001);

    expect(manager.getRoom(roomId)!.engine.state.handNumber).toBe(0);
    expect(database.db.prepare(`
      SELECT COUNT(*) AS count FROM cash_hand_settlements
      WHERE room_id = ? AND status = 'prepared'
    `).get(roomId)).toEqual({ count: 0 });

    runtime.openCashEscrow('human-3', roomId, 4_000);
    manager.joinRoom(roomId, makePlayer('human-3', 'human', 4_000, 1));
    vi.advanceTimersByTime(2_001);

    expect(manager.getRoom(roomId)!.engine.state.handNumber).toBe(1);
    expect(manager.getRoom(roomId)!.engine.state.isHandInProgress).toBe(true);
    manager.shutdown();
  });

  it('cancels only the exact prepared identity when startHand returns without starting', () => {
    vi.useFakeTimers();
    const database = openDatabase();
    seedProfile(database, 'human-1');
    seedProfile(database, 'human-2');
    const runtime = createRuntime(database);
    const manager = new RoomManager(() => {}, () => {}, undefined, {
      economy: runtime,
    });
    const roomId = manager.createRoom({
      ...walletCashConfig,
      botCount: 0,
      tableType: 'humans',
    });
    for (const [id, seat] of [['human-1', 0], ['human-2', 1]] as const) {
      runtime.openCashEscrow(id, roomId, 4_000);
      manager.joinRoom(roomId, makePlayer(id, 'human', 4_000, seat));
    }
    const room = manager.getRoom(roomId)!;
    const start = vi.spyOn(room.engine, 'startHand').mockImplementationOnce(() => {});

    vi.advanceTimersByTime(2_001);

    expect(start).toHaveBeenCalledOnce();
    expect(database.db.prepare(`
      SELECT status FROM cash_hand_settlements
      WHERE room_id = ? ORDER BY settlement_seq DESC LIMIT 1
    `).get(roomId)).toEqual({ status: 'voided' });
    start.mockRestore();
    manager.resumeRoom(roomId);
    vi.advanceTimersByTime(2_001);
    expect(room.engine.state.handNumber).toBe(1);
    manager.shutdown();
  });

  it('allows an explicit retry after startHand throws before mutating engine state', () => {
    vi.useFakeTimers();
    const database = openDatabase();
    seedProfile(database, 'human-1');
    seedProfile(database, 'human-2');
    const runtime = createRuntime(database);
    const manager = new RoomManager(() => {}, () => {}, undefined, {
      economy: runtime,
    });
    const roomId = manager.createRoom({
      ...walletCashConfig,
      botCount: 0,
      tableType: 'humans',
    });
    for (const [id, seat] of [['human-1', 0], ['human-2', 1]] as const) {
      runtime.openCashEscrow(id, roomId, 4_000);
      manager.joinRoom(roomId, makePlayer(id, 'human', 4_000, seat));
    }
    const room = manager.getRoom(roomId)!;
    const start = vi.spyOn(room.engine, 'startHand').mockImplementationOnce(() => {
      throw new Error('transient engine failure');
    });

    vi.advanceTimersByTime(2_001);

    expect(start).toHaveBeenCalledOnce();
    expect(room.engine.state.handNumber).toBe(0);
    expect(room.engine.state.isHandInProgress).toBe(false);
    expect(manager.getRuntimeStats().pendingStartTimers).toBe(0);
    expect(database.db.prepare(`
      SELECT settlement_seq, engine_hand_number, status
      FROM cash_hand_settlements
      WHERE room_id = ? ORDER BY settlement_seq
    `).all(roomId)).toEqual([
      { settlement_seq: 1, engine_hand_number: 1, status: 'voided' },
    ]);
    expect(manager.getChatHistory(roomId).at(-1)?.message)
      .toBe('저장 연결을 확인 중이에요');

    vi.advanceTimersByTime(10_000);
    expect(start).toHaveBeenCalledOnce();
    expect(manager.getRuntimeStats().pendingStartTimers).toBe(0);

    start.mockRestore();
    manager.resumeRoom(roomId);
    expect(manager.getRuntimeStats().pendingStartTimers).toBe(1);
    vi.advanceTimersByTime(2_001);

    expect(room.engine.state.handNumber).toBe(1);
    expect(room.engine.state.isHandInProgress).toBe(true);
    expect(database.db.prepare(`
      SELECT settlement_seq, engine_hand_number, status
      FROM cash_hand_settlements
      WHERE room_id = ? ORDER BY settlement_seq
    `).all(roomId)).toEqual([
      { settlement_seq: 1, engine_hand_number: 1, status: 'voided' },
      { settlement_seq: 2, engine_hand_number: 1, status: 'prepared' },
    ]);
    manager.shutdown();
  });

  it('records zero human and bot deltas with neutral ledger reasons', () => {
    const database = openDatabase();
    seedProfile(database, 'human-1');
    const service = new EconomyService(new EconomyRepository(database), () => 100);
    service.openCashEscrow('human-1', 'room-neutral', 4_000);
    service.checkpointCashHand('room-neutral', 1, [
      { profileId: 'human-1', amount: 4_000 },
    ]);

    service.settleCashHand('room-neutral', 1, [
      { profileId: 'human-1', startAmount: 4_000, endAmount: 4_000 },
    ], 0, 0);

    expect(database.db.prepare(`
      SELECT account, reason FROM chip_ledger
      WHERE idempotency_key LIKE 'cash-hand:room-neutral:1:%'
      ORDER BY account
    `).all()).toEqual([
      { account: 'bot', reason: 'BOT_NET_NEUTRAL' },
      { account: 'burn', reason: 'RAKE_BURN' },
      { account: 'escrow', reason: 'CASH_HAND_NEUTRAL' },
    ]);
  });
});

describe('EconomyRuntime startup recovery', () => {
  it('keeps an unresolved completed hand checkpoint through shutdown for startup recovery', () => {
    vi.useFakeTimers();
    const database = openDatabase();
    seedProfile(database, 'human-1');
    const runtime = createRuntime(database);
    const voidRoom = vi.fn((roomId: string) => runtime.voidRoom(roomId));
    const manager = new RoomManager(() => {}, () => {}, undefined, {
      economy: {
        beforeHand: (roomId, engine) => runtime.beforeHand(roomId, engine),
        cancelPreparedHand: (roomId, engine) => (
          runtime.cancelPreparedHand(roomId, engine)
        ),
        afterHand: () => { throw new Error('settlement write failed'); },
        settleExit: (roomId, player) => runtime.settleExit(roomId, player),
        voidRoom,
      },
    });
    const roomId = manager.createRoom({
      ...walletCashConfig,
      name: 'Blocked',
      botCount: 0,
      tableType: 'humans',
    }, true);
    runtime.openCashEscrow('human-1', roomId, 4_000);
    manager.joinRoom(roomId, makePlayer('human-1', 'human', 4_000, 0));
    manager.joinRoom(roomId, makePlayer('bot-1', 'bot', 4_000, 1));
    vi.advanceTimersByTime(2_001);
    const room = manager.getRoom(roomId)!;
    const originalEngine = room.engine;
    manager.leaveRoom(roomId, 'human-1');

    expect(room.engine.state.isHandInProgress).toBe(false);
    expect(manager.getRoom(roomId)?.engine).toBe(originalEngine);
    expect(manager.disposeRoom(roomId)).toBe(false);
    manager.shutdown();
    expect(voidRoom).not.toHaveBeenCalled();
    expect(activeEscrow(database, 'human-1')).toMatchObject({
      checkpoint_amount: 4_000,
      checkpoint_hand: 1,
    });
    expect(runtime.recoverActiveEscrows()).toBe(1);
    expect(walletBalance(database, 'human-1')).toBe(10_000);
    vi.useRealTimers();
  });

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
        idempotency_key: expect.stringMatching(
          /^void:between-hands:room-b:1:s1:e[0-9a-f-]+$/,
        ),
      }),
      expect.objectContaining({
        profile_id: 'in-hand',
        delta: 4_000,
        idempotency_key: expect.stringMatching(
          /^void:in-hand:room-a:1:s1:e[0-9a-f-]+$/,
        ),
      }),
    ]);
  });

  it('does not reuse a void key when the same profile and room restart at hand one again', () => {
    const database = openDatabase();
    seedProfile(database, 'human-1');
    const runtime = createRuntime(database);

    for (let incarnation = 0; incarnation < 2; incarnation += 1) {
      runtime.openCashEscrow('human-1', 'persistent-room', 4_000);
      const engine = new PokerEngine(walletCashConfig, 'persistent-room');
      engine.addPlayer(makePlayer('human-1', 'human', 4_000, 0));
      engine.addPlayer(makePlayer(`bot-${incarnation}`, 'bot', 4_000, 1));
      runtime.beforeHand('persistent-room', engine);
      engine.startHand();
      expect(engine.state.handNumber).toBe(1);
      expect(runtime.recoverActiveEscrows()).toBe(1);
      expect(walletBalance(database, 'human-1')).toBe(10_000);
    }

    const keys = database.db.prepare(`
      SELECT idempotency_key FROM chip_ledger
      WHERE profile_id = 'human-1'
        AND account = 'wallet'
        AND reason = 'CASH_VOID_REFUND'
      ORDER BY created_at, idempotency_key
    `).all().map(row => (row as { idempotency_key: string }).idempotency_key);
    expect(keys).toHaveLength(2);
    expect(new Set(keys).size).toBe(2);
    expect(keys[0]).toContain(':1:s1:e');
    expect(keys[1]).toContain(':1:s2:e');
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
