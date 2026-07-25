import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CreatePersistentTournamentRequest } from '../realtime/protocol';

const socketHarness = vi.hoisted(() => {
  const socket = {
    connected: true,
    on: vi.fn(),
    emit: vi.fn(),
    connect: vi.fn(),
    disconnect: vi.fn(),
    removeAllListeners: vi.fn(),
  };
  return { socket };
});

vi.mock('socket.io-client', () => ({
  io: () => socketHarness.socket,
}));

import { useGameStore } from './game-store';

afterEach(() => {
  useGameStore.setState({
    socket: null,
    connected: false,
    tournamentError: null,
  });
  vi.clearAllMocks();
});

describe('game store persistent tournament creation', () => {
  it('emits the reviewed canonical draft without remapping any field', async () => {
    const draft: CreatePersistentTournamentRequest = {
      requestId: '22222222-2222-4222-8222-222222222222',
      name: '스토어 경계 프리롤',
      economyMode: 'freeroll',
      minEntrants: 8,
      maxEntrants: 48,
      botFillToMinimum: true,
      prizePool: { kind: 'promotion-funded', totalPrize: 180_000 },
      schedule: {
        visibleAt: 1_800_000_000_000,
        registrationOpensAt: 1_800_000_600_000,
        startsAt: 1_800_001_800_000,
        manualStartExpiresAt: null,
      },
      recurrence: null,
      firstStartsAt: null,
      recurrenceEndsAt: null,
      visibleLeadMs: null,
      registrationLeadMs: null,
      turnTimeSeconds: 15,
      structure: {
        sourcePresetId: 'standard',
        startingStack: 10_000,
        segments: [
          {
            kind: 'level',
            durationMs: 480_000,
            smallBlind: 50,
            bigBlind: 100,
            bigBlindAnte: 0,
          },
          {
            kind: 'level',
            durationMs: 480_000,
            smallBlind: 75,
            bigBlind: 150,
            bigBlindAnte: 0,
          },
          {
            kind: 'level',
            durationMs: 480_000,
            smallBlind: 100,
            bigBlind: 200,
            bigBlindAnte: 200,
          },
        ],
      },
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
    socketHarness.socket.emit.mockImplementation(
      (event: string, payload: unknown, ack?: (value: unknown) => void) => {
        if (event === 'create-tournament') {
          expect(payload).toBe(draft);
          ack?.({
            ok: true,
            data: { tournamentId: draft.requestId },
          });
        }
      },
    );
    useGameStore.getState().connect();

    await expect(useGameStore.getState().createTournament(draft))
      .resolves.toBe(draft.requestId);
    expect(socketHarness.socket.emit).toHaveBeenCalledWith(
      'create-tournament',
      draft,
      expect.any(Function),
    );
  });
});
