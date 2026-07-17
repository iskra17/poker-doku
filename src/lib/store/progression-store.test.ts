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

  it('binds personal socket events once and removes only its listeners on cleanup', () => {
    const listeners = new Map<string, (...args: never[]) => void>();
    const socket = {
      on: vi.fn((name: string, listener: (...args: never[]) => void) => {
        listeners.set(name, listener);
      }),
      off: vi.fn((name: string, listener: (...args: never[]) => void) => {
        if (listeners.get(name) === listener) listeners.delete(name);
      }),
    } as unknown as PokerClientSocket;
    const fetcher = vi.fn();
    const store = createProgressionStore({ fetch: fetcher });
    store.getState().setProfileIdentity('profile-1');

    const firstCleanup = store.getState().bindSocket(socket);
    const secondCleanup = store.getState().bindSocket(socket);
    listeners.get('progression-update')?.(snapshot(4) as never);
    listeners.get('reward-summary')?.(reward('socket-event') as never);

    expect(socket.on).toHaveBeenCalledTimes(2);
    expect(store.getState().snapshot?.profile.dojoLevel).toBe(4);
    expect(store.getState().activeReward?.eventId).toBe('socket-event');
    expect(store.getState().action).toBeNull();
    expect(fetcher).not.toHaveBeenCalled();
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

  it('lets an authoritative socket snapshot invalidate an in-flight mutation', async () => {
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
    const mutation = store.getState().setEquipment('frame', null);

    store.getState().receiveSnapshot(snapshot(9));
    expect(requestSignal.aborted).toBe(true);
    resolveRequest(new Response(JSON.stringify({ progression: snapshot(3) }), { status: 200 }));
    await mutation;

    expect(store.getState().snapshot?.profile.dojoLevel).toBe(9);
    expect(store.getState()).toMatchObject({ action: null, error: null });
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

function viewResponse(progression: ProgressionSnapshot): Response {
  return new Response(JSON.stringify({
    progression,
    missions: {
      profileId: progression.profile.profileId,
      missionDate: '2026-07-17', balanceVersion: 1, missions: [], modes: [],
    },
  }), { status: 200, headers: { 'content-type': 'application/json' } });
}
