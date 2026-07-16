import { describe, expect, it, vi } from 'vitest';
import type { PokerClientSocket } from '@/lib/realtime/protocol';
import type {
  ProgressionRewardSummary,
  ProgressionSnapshot,
} from '@/lib/progression/types';
import { createProgressionStore, selectDisplayReward } from './progression-store';

function snapshot(level = 1): ProgressionSnapshot {
  return {
    profile: {
      profileId: 'profile-1', balanceVersion: 1, dojoLevel: level,
      dojoXpMilli: 0, selectedCharacterId: 'sakura', practiceDate: null,
      practiceHands: 0, completedHands: 0, cashHands: 0,
      practiceHandsTotal: 0, sngCompletions: 0, bestStreak: 0,
      createdAt: 1, updatedAt: 1,
    },
    affinities: [],
    streak: {
      profileId: 'profile-1', currentStreak: 0, restPasses: 0,
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

    await store.getState().load();
    store.getState().receiveSnapshot(snapshot(3));

    expect(fetcher).toHaveBeenCalledWith('/api/progression', expect.objectContaining({
      cache: 'no-store', credentials: 'same-origin',
    }));
    expect(store.getState().snapshot?.profile.dojoLevel).toBe(3);
  });

  it('deduplicates reward event ids and consumes a FIFO queue one at a time', () => {
    const store = createProgressionStore({ fetch: vi.fn() });

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
    const store = createProgressionStore({ fetch: vi.fn() });

    const firstCleanup = store.getState().bindSocket(socket);
    const secondCleanup = store.getState().bindSocket(socket);
    listeners.get('progression-update')?.(snapshot(4) as never);
    listeners.get('reward-summary')?.(reward('socket-event') as never);

    expect(socket.on).toHaveBeenCalledTimes(2);
    expect(store.getState().snapshot?.profile.dojoLevel).toBe(4);
    expect(store.getState().activeReward?.eventId).toBe('socket-event');
    firstCleanup();
    expect(socket.off).not.toHaveBeenCalled();
    secondCleanup();
    expect(socket.off).toHaveBeenCalledTimes(2);
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
