import { describe, expect, it, vi } from 'vitest';
import type { PokerClientSocket } from '@/lib/realtime/protocol';
import type {
  ProgressionRewardSummary,
  ProgressionSnapshot,
} from '@/lib/progression/types';
import { createProgressionStore, selectDisplayReward } from './progression-store';

function snapshot(level = 1, profileId = 'profile-1'): ProgressionSnapshot {
  return {
    profile: {
      profileId, balanceVersion: 1, dojoLevel: level,
      dojoXpMilli: 0, selectedCharacterId: 'sakura', practiceDate: null,
      practiceHands: 0, completedHands: 0, cashHands: 0,
      practiceHandsTotal: 0, sngCompletions: 0, bestStreak: 0,
      createdAt: 1, updatedAt: 1,
    },
    affinities: [],
    streak: {
      profileId, currentStreak: 0, restPasses: 0,
      lastQualifiedDate: null, lastWeekKey: null, createdAt: 1, updatedAt: 1,
    },
    inventory: [],
    equipment: { title: null, frame: null, skin: null, cutin: null },
  };
}

function reward(eventId: string): ProgressionRewardSummary {
  return {
    eventId, dojoXpMilli: 10_000, dojoLevelsGained: [],
    characterId: 'sakura', affinityMilli: 2_000,
    affinityLevelsGained: [], missionCompletions: [], grantedItemIds: [],
  };
}

describe('progression store', () => {
  it('loads an HTTP view with no-store and replaces its snapshot from realtime', async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({
      progression: snapshot(2),
      missions: {
        profileId: 'profile-1', missionDate: '2026-07-17', balanceVersion: 1,
        missions: [], modes: [],
      },
    }), { status: 200, headers: { 'content-type': 'application/json' } }));
    const store = createProgressionStore({ fetch: fetcher });
    store.getState().setProfileIdentity('profile-1');

    await store.getState().load();
    store.getState().receiveSnapshot(snapshot(3));

    expect(fetcher).toHaveBeenCalledWith('/api/progression', expect.objectContaining({
      cache: 'no-store', credentials: 'same-origin',
    }));
    expect(store.getState().snapshot?.profile.dojoLevel).toBe(3);
  });

  it('deduplicates reward event ids and consumes a FIFO queue one at a time', () => {
    const fetcher = vi.fn();
    const store = createProgressionStore({ fetch: fetcher });

    store.getState().enqueueReward(reward('event-a'));
    store.getState().enqueueReward(reward('event-a'));
    store.getState().enqueueReward(reward('event-b'));

    expect(store.getState().activeReward?.eventId).toBe('event-a');
    store.getState().consumeReward('event-b');
    expect(store.getState().activeReward?.eventId).toBe('event-a');
    store.getState().consumeReward('event-a');
    expect(store.getState().activeReward?.eventId).toBe('event-b');
    store.getState().consumeReward('event-b');
    expect(store.getState().activeReward).toBeNull();
  });

  it('defers reward display while a hand economy card is active, then resumes FIFO', () => {
    const store = createProgressionStore({ fetch: vi.fn() });
    store.getState().setEconomySummaryActive(true);
    store.getState().enqueueReward(reward('after-economy-a'));
    store.getState().enqueueReward(reward('after-economy-b'));

    expect(selectDisplayReward(store.getState())).toBeNull();
    store.getState().setEconomySummaryActive(false);
    expect(selectDisplayReward(store.getState())?.eventId).toBe('after-economy-a');
    store.getState().consumeReward('after-economy-a');
    expect(selectDisplayReward(store.getState())?.eventId).toBe('after-economy-b');
  });

  it('shows a practice hand immediately when no economy summary is active', () => {
    const store = createProgressionStore({ fetch: vi.fn() });
    store.getState().enqueueReward(reward('completed-hand:practice-event'));
    expect(selectDisplayReward(store.getState())?.eventId)
      .toBe('completed-hand:practice-event');
  });

  it('shows a non-hand reward immediately', () => {
    const store = createProgressionStore({ fetch: vi.fn() });
    store.getState().enqueueReward(reward('sng-finish:event'));
    expect(selectDisplayReward(store.getState())?.eventId).toBe('sng-finish:event');
  });

  it('never accepts a replayed event id during the store lifetime', () => {
    const store = createProgressionStore({ fetch: vi.fn() });
    for (let index = 0; index < 300; index += 1) {
      store.getState().enqueueReward(reward(`event-${index}`));
    }
    while (store.getState().activeReward) {
      store.getState().consumeReward(store.getState().activeReward!.eventId);
    }

    store.getState().reset();
    store.getState().enqueueReward(reward('event-0'));

    expect(store.getState().activeReward).toBeNull();
  });

  it('binds personal socket events once and coalesces a reward mission refresh', async () => {
    const listeners = new Map<string, (...args: never[]) => void>();
    const socket = {
      on: vi.fn((name: string, listener: (...args: never[]) => void) => {
        listeners.set(name, listener);
      }),
      off: vi.fn((name: string, listener: (...args: never[]) => void) => {
        if (listeners.get(name) === listener) listeners.delete(name);
      }),
    } as unknown as PokerClientSocket;
    const fetcher = vi.fn(async () => viewResponse(snapshot(1), ['practice']));
    const store = createProgressionStore({ fetch: fetcher });
    store.getState().setProfileIdentity('profile-1');

    const firstCleanup = store.getState().bindSocket(socket);
    const secondCleanup = store.getState().bindSocket(socket);
    listeners.get('progression-update')?.(snapshot(4) as never);
    listeners.get('reward-summary')?.(reward('socket-event') as never);
    listeners.get('reward-summary')?.(reward('socket-event-2') as never);
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1));

    expect(socket.on).toHaveBeenCalledTimes(2);
    expect(store.getState().snapshot?.profile.dojoLevel).toBe(4);
    expect(store.getState().activeReward?.eventId).toBe('socket-event');
    expect(store.getState().action).toBeNull();
    expect(store.getState().missions?.modes).toEqual(['practice']);
    firstCleanup();
    expect(socket.off).not.toHaveBeenCalled();
    secondCleanup();
    expect(socket.off).toHaveBeenCalledTimes(2);
  });

  it('ignores a delayed old profile load after a newer identity load', async () => {
    const requests: Array<{
      signal: AbortSignal;
      resolve: (response: Response) => void;
    }> = [];
    const store = createProgressionStore({
      fetch: vi.fn((_input, init) => new Promise<Response>(resolve => {
        requests.push({ signal: init?.signal as AbortSignal, resolve });
      })),
    });
    store.getState().setProfileIdentity('old-profile');
    const oldLoad = store.getState().load();
    store.getState().setProfileIdentity('new-profile');
    const newLoad = store.getState().load();

    expect(requests[0].signal.aborted).toBe(true);
    requests[1].resolve(viewResponse(snapshot(8, 'new-profile')));
    await newLoad;
    requests[0].resolve(viewResponse(snapshot(2, 'old-profile')));
    await oldLoad;

    expect(store.getState().snapshot?.profile).toMatchObject({
      profileId: 'new-profile', dojoLevel: 8,
    });
    expect(store.getState()).toMatchObject({ action: null, error: null });
  });

  it('keeps newer socket progression but applies missions from an older pending load', async () => {
    let resolveRequest!: (response: Response) => void;
    let requestSignal!: AbortSignal;
    const store = createProgressionStore({
      fetch: vi.fn((_input, init) => new Promise<Response>(resolve => {
        requestSignal = init?.signal as AbortSignal;
        resolveRequest = resolve;
      })),
    });
    store.getState().setProfileIdentity('profile-1');
    const load = store.getState().load();

    store.getState().receiveSnapshot(snapshot(9));
    expect(requestSignal.aborted).toBe(false);
    resolveRequest(viewResponse(snapshot(3), ['practice']));
    await load;

    expect(store.getState().snapshot?.profile.dojoLevel).toBe(9);
    expect(store.getState().missions?.modes).toEqual(['practice']);
    expect(store.getState()).toMatchObject({ action: null, error: null });
  });

  it('keeps a committed character while accepting newer gameplay progression', async () => {
    let resolveRequest!: (response: Response) => void;
    let requestSignal!: AbortSignal;
    const store = createProgressionStore({
      fetch: vi.fn((_input, init) => new Promise<Response>(resolve => {
        requestSignal = init?.signal as AbortSignal;
        resolveRequest = resolve;
      })),
    });
    store.getState().setProfileIdentity('profile-1');
    store.getState().receiveSnapshot(snapshot(2));
    const mutation = store.getState().selectCharacter('hana');
    await vi.waitFor(() => expect(requestSignal).toBeDefined());

    const duringPost = snapshot(9);
    duringPost.profile.dojoXpMilli = 90_000;
    store.getState().receiveSnapshot(duringPost);
    expect(requestSignal.aborted).toBe(false);
    const committed = snapshot(3);
    committed.profile.selectedCharacterId = 'hana';
    resolveRequest(progressionResponse(committed));
    await mutation;

    const staleGameplay = snapshot(10);
    staleGameplay.profile.dojoXpMilli = 100_000;
    store.getState().receiveSnapshot(staleGameplay);
    expect(store.getState().snapshot?.profile).toMatchObject({
      dojoLevel: 10,
      dojoXpMilli: 100_000,
      selectedCharacterId: 'hana',
    });
  });

  it('keeps committed equipment when a stale gameplay socket arrives during and after POST', async () => {
    let resolveRequest!: (response: Response) => void;
    let requestSignal!: AbortSignal;
    const store = createProgressionStore({
      fetch: vi.fn((_input, init) => new Promise<Response>(resolve => {
        requestSignal = init?.signal as AbortSignal;
        resolveRequest = resolve;
      })),
    });
    store.getState().setProfileIdentity('profile-1');
    store.getState().receiveSnapshot(snapshot(2));
    const mutation = store.getState().setEquipment('frame', 'frame-sakura-2');
    await vi.waitFor(() => expect(requestSignal).toBeDefined());

    store.getState().receiveSnapshot(snapshot(8));
    expect(requestSignal.aborted).toBe(false);
    const committed = snapshot(3);
    committed.equipment.frame = 'frame-sakura-2';
    resolveRequest(progressionResponse(committed));
    await mutation;

    const staleGameplay = snapshot(11);
    staleGameplay.profile.dojoXpMilli = 110_000;
    store.getState().receiveSnapshot(staleGameplay);
    expect(store.getState().snapshot?.profile.dojoLevel).toBe(11);
    expect(store.getState().snapshot?.equipment.frame).toBe('frame-sakura-2');

    const caughtUp = snapshot(12);
    caughtUp.equipment.frame = 'frame-sakura-2';
    store.getState().receiveSnapshot(caughtUp);
    const newerAuthoritative = snapshot(13);
    newerAuthoritative.equipment.frame = null;
    store.getState().receiveSnapshot(newerAuthoritative);
    expect(store.getState().snapshot?.equipment.frame).toBeNull();
  });

  it('applies a reroll response without aborting it for a socket snapshot', async () => {
    let resolveRequest!: (response: Response) => void;
    let requestSignal!: AbortSignal;
    const store = createProgressionStore({
      fetch: vi.fn((_input, init) => new Promise<Response>(resolve => {
        requestSignal = init?.signal as AbortSignal;
        resolveRequest = resolve;
      })),
    });
    store.getState().setProfileIdentity('profile-1');
    store.getState().receiveSnapshot(snapshot(2));
    const mutation = store.getState().rerollMission(0);
    await vi.waitFor(() => expect(requestSignal).toBeDefined());

    store.getState().receiveSnapshot(snapshot(7));
    expect(requestSignal.aborted).toBe(false);
    resolveRequest(new Response(JSON.stringify({
      missions: missionDay('profile-1', ['cash']),
    }), { status: 200 }));
    await mutation;

    expect(store.getState().snapshot?.profile.dojoLevel).toBe(7);
    expect(store.getState().missions?.modes).toEqual(['cash']);
  });

  it('serializes mutations and retains each committed slice', async () => {
    const requests: Array<{ path: string; resolve: (response: Response) => void }> = [];
    const store = createProgressionStore({
      fetch: vi.fn((input) => new Promise<Response>(resolve => {
        requests.push({ path: String(input), resolve });
      })),
    });
    store.getState().setProfileIdentity('profile-1');
    store.getState().receiveSnapshot(snapshot(2));
    const character = store.getState().selectCharacter('hana');
    const equipment = store.getState().setEquipment('frame', 'frame-sakura-2');

    await vi.waitFor(() => expect(requests).toHaveLength(1));
    const characterResponse = snapshot(2);
    characterResponse.profile.selectedCharacterId = 'hana';
    requests[0].resolve(progressionResponse(characterResponse));
    await character;
    await vi.waitFor(() => expect(requests).toHaveLength(2));
    const equipmentResponse = snapshot(2);
    equipmentResponse.equipment.frame = 'frame-sakura-2';
    requests[1].resolve(progressionResponse(equipmentResponse));
    await equipment;

    expect(requests.map(request => request.path)).toEqual([
      '/api/progression/character', '/api/progression/equipment',
    ]);
    expect(store.getState().snapshot?.profile.selectedCharacterId).toBe('hana');
    expect(store.getState().snapshot?.equipment.frame).toBe('frame-sakura-2');
  });

  it('does not let a pre-mutation load overwrite a later committed mutation', async () => {
    const requests: Array<(response: Response) => void> = [];
    const store = createProgressionStore({
      fetch: vi.fn(() => new Promise<Response>(resolve => requests.push(resolve))),
    });
    store.getState().setProfileIdentity('profile-1');
    store.getState().receiveSnapshot(snapshot(6));
    const load = store.getState().load();
    const mutation = store.getState().selectCharacter('hana');
    await vi.waitFor(() => expect(requests).toHaveLength(2));
    const committed = snapshot(6);
    committed.profile.selectedCharacterId = 'hana';
    requests[1](progressionResponse(committed));
    await mutation;
    requests[0](viewResponse(snapshot(1), ['practice']));
    await load;

    expect(store.getState().snapshot?.profile).toMatchObject({
      dojoLevel: 6, selectedCharacterId: 'hana',
    });
    expect(store.getState().missions?.modes).toEqual(['practice']);
  });

  it('aborts an old-profile mutation and does not let it block or overwrite the new profile', async () => {
    const requests: Array<{
      signal: AbortSignal;
      resolve: (response: Response) => void;
    }> = [];
    const store = createProgressionStore({
      fetch: vi.fn((_input, init) => new Promise<Response>(resolve => {
        requests.push({ signal: init?.signal as AbortSignal, resolve });
      })),
    });
    store.getState().setProfileIdentity('old-profile');
    store.getState().receiveSnapshot(snapshot(2, 'old-profile'));
    const oldMutation = store.getState().selectCharacter('hana');
    await vi.waitFor(() => expect(requests).toHaveLength(1));

    store.getState().setProfileIdentity('new-profile');
    store.getState().receiveSnapshot(snapshot(8, 'new-profile'));
    expect(requests[0].signal.aborted).toBe(true);
    const newMutation = store.getState().setEquipment('frame', 'frame-sakura-2');
    await vi.waitFor(() => expect(requests).toHaveLength(2));
    const newResponse = snapshot(8, 'new-profile');
    newResponse.equipment.frame = 'frame-sakura-2';
    requests[1].resolve(progressionResponse(newResponse));
    await newMutation;
    const oldResponse = snapshot(3, 'old-profile');
    oldResponse.profile.selectedCharacterId = 'hana';
    requests[0].resolve(progressionResponse(oldResponse));
    await oldMutation;

    expect(store.getState().snapshot?.profile).toMatchObject({
      profileId: 'new-profile', dojoLevel: 8, selectedCharacterId: 'sakura',
    });
    expect(store.getState().snapshot?.equipment.frame).toBe('frame-sakura-2');
  });

  it('aborts pending work on reset without publishing a late error', async () => {
    let resolveRequest!: (response: Response) => void;
    let requestSignal!: AbortSignal;
    const store = createProgressionStore({
      fetch: vi.fn((_input, init) => new Promise<Response>(resolve => {
        requestSignal = init?.signal as AbortSignal;
        resolveRequest = resolve;
      })),
    });
    store.getState().setProfileIdentity('profile-1');
    const load = store.getState().load();
    store.getState().reset();
    expect(requestSignal.aborted).toBe(true);
    resolveRequest(new Response('{}', { status: 500 }));
    await load;
    expect(store.getState()).toMatchObject({
      profileId: null, snapshot: null, status: 'idle', action: null, error: null,
    });
  });

  it('reports authentication expiry so the caller can enter recovery', async () => {
    const store = createProgressionStore({
      fetch: vi.fn(async () => new Response('{}', { status: 401 })),
    });

    const outcome = await store.getState().load();

    expect(outcome).toBe('unauthorized');
    expect(store.getState()).toMatchObject({ status: 'error', authExpired: true });
  });
});

function missionDay(profileId: string, modes: Array<'cash' | 'practice' | 'sng'> = []) {
  return {
    profileId,
    missionDate: '2026-07-17',
    balanceVersion: 1,
    missions: [],
    modes,
  };
}

function viewResponse(
  progression: ProgressionSnapshot,
  modes: Array<'cash' | 'practice' | 'sng'> = [],
): Response {
  return new Response(JSON.stringify({
    progression,
    missions: missionDay(progression.profile.profileId, modes),
  }), { status: 200, headers: { 'content-type': 'application/json' } });
}

function progressionResponse(progression: ProgressionSnapshot): Response {
  return new Response(JSON.stringify({ progression }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}
