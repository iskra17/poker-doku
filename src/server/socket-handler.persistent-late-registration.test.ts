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
    const engagement = {
      tournamentId: 'mtt-1',
      profileId: 'profile-1',
      requestId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      status: 'late-pending' as const,
    };
    const readTournamentEngagement = vi.fn(() => engagement);
    const ports = createPersistentLateRegistrationPorts(
      { getInstance },
      { commitLateMttBatch, readTournamentEngagement },
    );

    expect(ports.readInstance('mtt-1')).toBe(instance);
    ports.commitLateMttBatch('mtt-1', [], 2);
    expect(ports.readTournamentEngagement?.('mtt-1', 'profile-1'))
      .toBe(engagement);
    expect(getInstance).toHaveBeenCalledWith('mtt-1');
    expect(commitLateMttBatch).toHaveBeenCalledWith('mtt-1', [], 2);
    expect(readTournamentEngagement)
      .toHaveBeenCalledWith('mtt-1', 'profile-1');
  });

  it('keeps wallet late registration behind its dependent feature flag', () => {
    const instance = {
      status: 'running',
      economyMode: 'wallet' as const,
      registrationState: 'open-late',
      registrationGeneration: 1,
      registrationOwnerToken: null,
    };
    const reserveLateMttEntry = vi.fn(() => ({
      status: 'reserved' as const,
      key: {
        profileId: 'profile-1',
        economyMode: 'wallet' as const,
        requestId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        registrationAttempt: 1,
        economyEntryAttempt: 1,
        entryId: 'entry-1',
      },
      acceptedAt: Date.now(),
    }));
    const input = {
      command: {
        tournamentId: 'mtt-wallet',
        requestId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      },
      profileId: 'profile-1',
      publicPlayer: { id: 'profile-1', name: 'Player', avatar: 'ara' },
    };
    const disabled = createPersistentLateRegistrationPorts(
      { getInstance: () => instance },
      {
        commitLateMttBatch: vi.fn(),
        registerPreStart: vi.fn(),
        reserveLateMttEntry,
      },
      { lateRegistrationEnabled: true },
    );
    expect(disabled.registerTournament?.(input)).toEqual({
      ok: false,
      requestId: input.command.requestId,
      reason: 'not-open',
    });
    expect(reserveLateMttEntry).not.toHaveBeenCalled();

    const enabled = createPersistentLateRegistrationPorts(
      { getInstance: () => instance },
      {
        commitLateMttBatch: vi.fn(),
        registerPreStart: vi.fn(),
        reserveLateMttEntry,
      },
      {
        lateRegistrationEnabled: true,
        walletLateRegistrationEnabled: true,
      },
    );
    expect(enabled.registerTournament?.(input)).toMatchObject({
      ok: true,
      status: 'seating',
    });
    expect(reserveLateMttEntry).toHaveBeenCalledOnce();
  });

  it('keeps prestart registration available in scheduler-only mode', () => {
    let instance = {
      status: 'registering',
      economyMode: 'freeroll' as const,
      registrationState: 'open-prestart',
      registrationGeneration: 0,
      registrationOwnerToken: null,
    };
    const registerPreStart = vi.fn(() => ({
      status: 'reserved' as const,
      key: {
        profileId: 'profile-1',
        economyMode: 'freeroll' as const,
        requestId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
        registrationAttempt: 1,
      },
      acceptedAt: Date.now(),
    }));
    const reserveLateMttEntry = vi.fn(() => ({
      status: 'reserved' as const,
      key: {
        profileId: 'profile-1',
        economyMode: 'freeroll' as const,
        requestId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
        registrationAttempt: 1,
      },
      acceptedAt: Date.now(),
    }));
    const ports = createPersistentLateRegistrationPorts(
      { getInstance: () => instance },
      {
        commitLateMttBatch: vi.fn(),
        registerPreStart,
        reserveLateMttEntry,
      },
      {
        lateRegistrationEnabled: false,
        walletLateRegistrationEnabled: false,
      },
    );
    const input = {
      command: {
        tournamentId: 'mtt-freeroll',
        requestId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      },
      profileId: 'profile-1',
      publicPlayer: { id: 'profile-1', name: 'Player', avatar: 'ara' },
    };

    expect(ports.registerTournament?.(input)).toMatchObject({
      ok: true,
      status: 'registered',
    });
    expect(registerPreStart).toHaveBeenCalledOnce();

    instance = {
      ...instance,
      status: 'running',
      registrationState: 'open-late',
    };
    expect(ports.registerTournament?.(input)).toEqual({
      ok: false,
      requestId: input.command.requestId,
      reason: 'not-open',
    });
    expect(reserveLateMttEntry).not.toHaveBeenCalled();
  });

  it('allows freeroll live reserves when late registration is enabled', () => {
    const reserveLateMttEntry = vi.fn(() => ({
      status: 'reserved' as const,
      key: {
        profileId: 'profile-1',
        economyMode: 'freeroll' as const,
        requestId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
        registrationAttempt: 1,
      },
      acceptedAt: Date.now(),
    }));
    const ports = createPersistentLateRegistrationPorts(
      {
        getInstance: () => ({
          status: 'running',
          economyMode: 'freeroll' as const,
          registrationState: 'open-late',
          registrationGeneration: 1,
          registrationOwnerToken: null,
        }),
      },
      {
        commitLateMttBatch: vi.fn(),
        registerPreStart: vi.fn(),
        reserveLateMttEntry,
      },
      {
        lateRegistrationEnabled: true,
        walletLateRegistrationEnabled: false,
      },
    );
    const requestId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
    expect(ports.registerTournament?.({
      command: { tournamentId: 'mtt-freeroll', requestId },
      profileId: 'profile-1',
      publicPlayer: { id: 'profile-1', name: 'Player', avatar: 'ara' },
    })).toMatchObject({ ok: true, status: 'seating' });
    expect(reserveLateMttEntry).toHaveBeenCalledOnce();
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
