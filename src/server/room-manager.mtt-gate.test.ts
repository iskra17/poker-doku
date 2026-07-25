import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  RoomManager,
  type MttRoomHooks,
  type NextHandGateResult,
} from './room-manager';
import type { Player, RoomConfig } from '../lib/poker/types';

function config(): RoomConfig {
  return {
    name: 'gate',
    smallBlind: 10,
    bigBlind: 20,
    minBuyIn: 1_500,
    maxBuyIn: 1_500,
    maxPlayers: 6,
    economyMode: 'practice',
    turnTime: 15,
    gameMode: 'mtt',
    startingStack: 1_500,
    ante: 0,
    tournamentId: 'tournament-1',
    hostId: 'host',
    difficulty: 'normal',
    botCount: 0,
    tableType: 'mixed',
  };
}

function player(id: string, seatIndex: number): Player {
  return {
    id,
    name: id,
    type: 'human',
    avatar: 'ara',
    chips: 1_500,
    seatIndex,
    holeCards: [],
    currentBet: 0,
    totalContributed: 0,
    status: 'waiting',
    hasActed: false,
  };
}

describe('RoomManager MTT next-hand gate', () => {
  let manager: RoomManager;

  beforeEach(() => {
    vi.useFakeTimers();
    manager = new RoomManager(() => {}, () => {});
  });

  afterEach(() => {
    manager.shutdown();
    vi.useRealTimers();
  });

  it('fails the next-hand gate closed during db read faults and resumes once', () => {
    let reads = 0;
    const hooks: MttRoomHooks = {
      applyLevel: () => {},
      onHandStartFailed: () => {},
      onHandStarted: () => {},
      onHandComplete: () => 'continue',
      isHeld: () => false,
      checkNextHandGate: vi.fn((): NextHandGateResult => {
        reads += 1;
        return reads < 3
          ? {
              status: 'retry',
              generation: 7,
              ownerToken: 'reconcile-owner',
            }
          : { status: 'allow' };
      }),
      onPlayerLeave: () => {},
      onPlayerLeft: () => {},
    };
    manager.setMttHooks(hooks);
    const roomId = manager.createRoom(config());
    manager.getRoom(roomId)!.engine.setTournamentField(2, [], false);
    manager.joinRoom(roomId, player('p1', 0));
    manager.joinRoom(roomId, player('p2', 1));

    vi.advanceTimersByTime(2_000);
    expect(manager.getRoom(roomId)!.engine.state.handNumber).toBe(0);
    vi.advanceTimersByTime(250);
    expect(manager.getRoom(roomId)!.engine.state.handNumber).toBe(0);
    vi.advanceTimersByTime(500);

    expect(manager.getRoom(roomId)!.engine.state.handNumber).toBe(1);
    expect(hooks.checkNextHandGate).toHaveBeenCalledTimes(3);
    expect(manager.getRuntimeStats().mttGateRetryTimers).toBe(0);
  });

  it('clears a pending gate retry when the room becomes terminal', () => {
    let terminal = false;
    const hooks: MttRoomHooks = {
      applyLevel: () => {},
      onHandStartFailed: () => {},
      onHandStarted: () => {},
      onHandComplete: () => 'continue',
      isHeld: () => false,
      checkNextHandGate: () => terminal
        ? { status: 'terminal' }
        : { status: 'retry', generation: 2, ownerToken: 'owner' },
      onPlayerLeave: () => {},
      onPlayerLeft: () => {},
    };
    manager.setMttHooks(hooks);
    const roomId = manager.createRoom(config());
    manager.getRoom(roomId)!.engine.setTournamentField(2, [], false);
    manager.joinRoom(roomId, player('p1', 0));
    manager.joinRoom(roomId, player('p2', 1));
    vi.advanceTimersByTime(2_000);
    expect(manager.getRuntimeStats().mttGateRetryTimers).toBe(1);

    terminal = true;
    vi.advanceTimersByTime(250);
    expect(manager.getRuntimeStats().mttGateRetryTimers).toBe(0);
    expect(manager.getRoom(roomId)!.engine.state.handNumber).toBe(0);
  });
});
