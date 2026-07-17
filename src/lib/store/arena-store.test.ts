import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import type {
  ArenaResultPayload,
  PokerClientSocket,
  ServerToClientEvents,
} from '@/lib/realtime/protocol';
import { createArenaStore } from './arena-store';

describe('arena store state machine', () => {
  it('accepts only the ordered queue to result path and ignores duplicates', () => {
    const { store } = harness();
    const result = officialResult('match-a');

    store.getState().receiveMatchFound({ matchId: 'stale-match', training: false });
    expect(store.getState().phase).toBe('idle');

    store.getState().receiveQueueState({ status: 'queued', joinedAt: 100 });
    store.getState().receiveTrainingOffer({
      offerId: 'offer-a',
      expiresAt: 5_000,
    });
    store.getState().receiveTrainingOffer({
      offerId: 'offer-a',
      expiresAt: 9_000,
    });
    expect(store.getState()).toMatchObject({
      phase: 'training-offered',
      offer: { offerId: 'offer-a', expiresAt: 5_000 },
    });

    store.getState().receiveMatchFound({ matchId: 'match-a', training: true });
    store.getState().receiveMatchFound({ matchId: 'match-a', training: true });
    store.getState().receiveRoomJoined({ roomId: 'room-a' });
    store.getState().receiveQueueState({ status: 'idle' });
    store.getState().receiveResult(result);
    store.getState().receiveResult({ ...result, points: 999 });

    expect(store.getState()).toMatchObject({
      phase: 'result',
      matchId: 'match-a',
      result: { resultId: 'match-a:profile-self', points: 60 },
    });
  });

  it('cancels queue and safely resets on room loss', () => {
    const { store } = harness();
    store.getState().receiveQueueState({ status: 'queued', joinedAt: 100 });
    store.getState().receiveQueueState({ status: 'idle' });
    expect(store.getState().phase).toBe('idle');

    store.getState().receiveQueueState({ status: 'queued', joinedAt: 200 });
    store.getState().receiveMatchFound({ matchId: 'match-b', training: false });
    store.getState().receiveRoomJoined({ roomId: 'room-b' });
    store.getState().receiveRoomLost();
    expect(store.getState()).toMatchObject({
      phase: 'idle',
      matchId: null,
      result: null,
      offer: null,
    });
  });

  it('derives a countdown only from the injected timer callback', () => {
    const { store, advance, runTimer } = harness();
    store.getState().receiveQueueState({ status: 'queued', joinedAt: 100 });
    store.getState().receiveTrainingOffer({
      offerId: 'offer-timer',
      expiresAt: 5_000,
    });
    expect(store.getState().remainingMs).toBe(5_000);

    advance(1_250);
    expect(store.getState().remainingMs).toBe(5_000);
    runTimer();
    expect(store.getState().remainingMs).toBe(3_750);

    advance(4_000);
    runTimer();
    expect(store.getState()).toMatchObject({
      phase: 'idle',
      offer: null,
      remainingMs: 0,
    });
  });

  it('binds socket listeners once, restores queue state, and cleans up by reference', () => {
    const { store } = harness();
    const socket = new FakeSocket();
    const first = store.getState().bindSocket(socket as unknown as PokerClientSocket);
    const second = store.getState().bindSocket(socket as unknown as PokerClientSocket);

    expect(socket.listenerCount('arena-queue-update')).toBe(1);
    socket.serverEmit('arena-queue-update', { status: 'queued', joinedAt: 42 });
    expect(store.getState().phase).toBe('queued');

    first();
    expect(socket.listenerCount('arena-queue-update')).toBe(1);
    second();
    expect(socket.listenerCount('arena-queue-update')).toBe(0);
  });

  it('loads an authenticated snapshot and never defines a hidden rating field', async () => {
    const { store, fetch } = harness();
    await expect(store.getState().load()).resolves.toBe('ready');
    expect(fetch).toHaveBeenCalledWith('/api/arena', expect.objectContaining({
      credentials: 'same-origin',
      cache: 'no-store',
    }));
    expect(store.getState().snapshot).toMatchObject({
      enabled: true,
      profile: { availableTickets: 2 },
    });
    const source = readFileSync(resolve(
      process.cwd(),
      'src/lib/store/arena-store.ts',
    ), 'utf8');
    expect(source).not.toMatch(/\bmmr\b/iu);
  });
});

function officialResult(matchId: string): ArenaResultPayload {
  return {
    resultId: `${matchId}:profile-self`,
    matchId,
    training: false,
    place: 2,
    points: 60,
    weeklyRankBefore: 5,
    weeklyRankAfter: 3,
    placementGames: 5,
    placementMatches: 5,
    tier: 'gold',
  };
}

function harness() {
  let now = 0;
  let timer: (() => void) | null = null;
  const fetch = vi.fn(async () => new Response(JSON.stringify({
    enabled: true,
    season: {
      startsAt: 0,
      endsAt: 100_000,
      remainingMs: 100_000,
      preseason: true,
      preseasonScarceRewardsSuppressed: true,
    },
    profile: {
      availableTickets: 2,
      placementGames: 0,
      placementMatches: 5,
      placementPoints: 0,
      tier: null,
    },
    weekly: {
      groupAssigned: false,
      rank: null,
      score: 0,
      matches: 0,
      memberCount: 0,
      tier: null,
    },
  }), { status: 200 }));
  const store = createArenaStore({
    fetch,
    now: () => now,
    setTimer: callback => {
      timer = callback;
      return 1;
    },
    clearTimer: () => {
      timer = null;
    },
  });
  return {
    store,
    fetch,
    advance: (milliseconds: number) => {
      now += milliseconds;
    },
    runTimer: () => timer?.(),
  };
}

class FakeSocket {
  readonly listeners = new Map<string, Set<(...args: never[]) => void>>();

  on<Event extends keyof ServerToClientEvents>(
    event: Event,
    listener: ServerToClientEvents[Event],
  ): this {
    const listeners = this.listeners.get(event) ?? new Set();
    listeners.add(listener as (...args: never[]) => void);
    this.listeners.set(event, listeners);
    return this;
  }

  off<Event extends keyof ServerToClientEvents>(
    event: Event,
    listener: ServerToClientEvents[Event],
  ): this {
    this.listeners.get(event)?.delete(listener as (...args: never[]) => void);
    return this;
  }

  emit(): boolean {
    return true;
  }

  listenerCount(event: keyof ServerToClientEvents): number {
    return this.listeners.get(event)?.size ?? 0;
  }

  serverEmit<Event extends keyof ServerToClientEvents>(
    event: Event,
    ...args: Parameters<ServerToClientEvents[Event]>
  ): void {
    for (const listener of this.listeners.get(event) ?? []) {
      listener(...args as unknown as never[]);
    }
  }
}
