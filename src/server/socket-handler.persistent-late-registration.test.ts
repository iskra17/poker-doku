import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createSocketTestHarness,
  type SocketTestHarness,
  type SocketTestHarnessOptions,
} from './socket-test-harness';
import { createPersistentLateRegistrationPorts } from './socket-handler';

function snapshot() {
  return {
    id: 'persistent-runtime-wiring',
    status: 'starting',
    economyMode: 'freeroll',
    directorProfileId: 'director-1',
    registrationState: 'open-late',
    registrationGeneration: 1,
    registrationOwnerToken: null,
    config: {
      version: 2,
      name: 'Persistent runtime wiring',
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
        enabled: true,
        durationLevels: 2,
        minStartingStackBb: 20,
      },
    },
  } as const;
}

describe('persistent late-registration production runtime wiring', () => {
  let harness: SocketTestHarness | undefined;

  afterEach(async () => {
    await harness?.close();
  });

  it('adapts instance reads and enrollment commits without an allow fallback', () => {
    const instance = {
      status: 'running',
      registrationState: 'closing',
      registrationGeneration: 4,
      registrationOwnerToken: 'close-owner',
    };
    const getInstance = vi.fn(() => instance);
    const commitLateMttBatch = vi.fn();
    const ports = createPersistentLateRegistrationPorts(
      { getInstance },
      { commitLateMttBatch },
    );

    expect(ports.readInstance('mtt-1')).toBe(instance);
    ports.commitLateMttBatch('mtt-1', [], 2);
    expect(getInstance).toHaveBeenCalledWith('mtt-1');
    expect(commitLateMttBatch).toHaveBeenCalledWith('mtt-1', [], 2);
  });

  it('passes the persistent repository adapter into every live MTT gate', async () => {
    const readInstance = vi.fn(() => ({
      status: 'running',
      registrationState: 'open-late',
      registrationGeneration: 1,
      registrationOwnerToken: null,
    }));
    const options = {
      persistentRuntimeEnabled: true,
      persistentLateRegistration: {
        readInstance,
        commitLateMttBatch: vi.fn(),
      },
    };
    harness = await createSocketTestHarness(
      options as SocketTestHarnessOptions,
    );
    const prepared = harness.runtime.tournamentManager.prepareFromInstance(
      snapshot(),
      [{ id: 'human-1', name: 'Human 1', avatar: 'ara' }],
      'owner-1',
    );
    harness.runtime.tournamentManager.activatePreparedTournament(
      snapshot().id,
      'owner-1',
      Date.now(),
    );

    expect(harness.runtime.tournamentManager.roomHooks.checkNextHandGate?.(
      prepared.roomIds[0]!,
    )).toEqual({ status: 'allow' });
    expect(readInstance).toHaveBeenCalledWith(snapshot().id);
  });
});
