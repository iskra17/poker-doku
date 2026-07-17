import { describe, expect, it, vi } from 'vitest';
import {
  ArenaMatchmaker,
  areArenaEntriesCompatible,
  arenaMmrRangeForWait,
  type ArenaTrainingOffer,
} from './arena-matchmaker';

const SECOND = 1_000;

describe('ArenaMatchmaker rules', () => {
  it('widens mutual MMR range every ten seconds and removes it at sixty', () => {
    expect(arenaMmrRangeForWait(0)).toBe(100);
    expect(arenaMmrRangeForWait(10 * SECOND)).toBe(150);
    expect(arenaMmrRangeForWait(50 * SECOND)).toBe(350);
    expect(arenaMmrRangeForWait(60 * SECOND)).toBeNull();
    const a = { profileId: 'a', socketId: 'sa', mmr: 1_000, joinedAt: 0 };
    const b = { profileId: 'b', socketId: 'sb', mmr: 1_151, joinedAt: 0 };
    expect(areArenaEntriesCompatible(a, b, 10 * SECOND)).toBe(false);
    expect(areArenaEntriesCompatible(a, b, 20 * SECOND)).toBe(true);
    expect(areArenaEntriesCompatible(a, { ...b, mmr: 9_000 }, 60 * SECOND))
      .toBe(true);
  });

  it.each([0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])(
    'rejects invalid close deadline %s',
    closeDeadlineMs => {
      expect(() => new ArenaMatchmaker({
        closeDeadlineMs,
        now: () => 0,
        reserveOfficial: async () => null,
        createOfficialRoom: async () => false,
        rollbackOfficialRoom: async () => undefined,
        voidOfficial: async () => undefined,
        createTrainingRoom: async () => null,
        rollbackTrainingRoom: async () => undefined,
      })).toThrow('ARENA_CLOSE_DEADLINE_INVALID');
    },
  );

  it('uses the configured finite close deadline', async () => {
    let rollbackCalls = 0;
    const matchmaker = new ArenaMatchmaker({
      closeDeadlineMs: 10,
      now: () => 70_000,
      reserveOfficial: async () => ({ matchId: 'reserved' }),
      createOfficialRoom: async () => false,
      rollbackOfficialRoom: async () => {
        rollbackCalls += 1;
        if (rollbackCalls === 1) throw new Error('initial cleanup failure');
        await new Promise<void>(() => undefined);
      },
      voidOfficial: async () => undefined,
      createTrainingRoom: async () => null,
      rollbackTrainingRoom: async () => undefined,
    });
    matchmaker.join({ profileId: 'a', socketId: 'sa', mmr: 1_000, joinedAt: 0 });
    matchmaker.join({ profileId: 'b', socketId: 'sb', mmr: 1_000, joinedAt: 0 });
    await matchmaker.tick(60_000);

    vi.useFakeTimers();
    try {
      let settled = false;
      const closing = matchmaker.close().then(report => {
        settled = true;
        return report;
      });
      await vi.advanceTimersByTimeAsync(9);
      expect(settled).toBe(false);
      await vi.advanceTimersByTimeAsync(1);
      expect(settled).toBe(true);
      await expect(closing).resolves.toEqual({
        pendingOfficialMatchIds: ['reserved'],
        pendingTrainingOfferIds: [],
      });
      expect(rollbackCalls).toBe(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('forms oldest-first official candidates with two or six humans', async () => {
    const candidates: Array<{ profiles: string[]; botCount: number }> = [];
    const matchmaker = testMatchmaker(candidate => {
      candidates.push({
        profiles: candidate.entries.map(entry => entry.profileId),
        botCount: candidate.botCount,
      });
      return Promise.resolve({ matchId: `m-${candidates.length}` });
    });
    matchmaker.join({ profileId: 'b', socketId: 'sb', mmr: 3_000, joinedAt: 1 });
    matchmaker.join({ profileId: 'a', socketId: 'sa', mmr: 1_000, joinedAt: 1 });
    await matchmaker.tick(60_001);
    expect(candidates[0]).toEqual({ profiles: ['a', 'b'], botCount: 4 });

    for (let index = 0; index < 6; index += 1) {
      matchmaker.join({
        profileId: `p${index}`, socketId: `s${index}`,
        mmr: 800 + index * 500, joinedAt: 100_000 + index,
      });
    }
    await matchmaker.tick(160_001);
    expect(candidates[1]).toEqual({
      profiles: ['p0', 'p1', 'p2', 'p3', 'p4', 'p5'],
      botCount: 0,
    });
  });

  it('forms before sixty seconds only with entries in the anchor mutual range', async () => {
    const candidates: string[][] = [];
    const matchmaker = testMatchmaker(async candidate => {
      candidates.push(candidate.entries.map(entry => entry.profileId));
      return { matchId: `m-${candidates.length}` };
    });
    matchmaker.join({ profileId: 'anchor', socketId: 'sa', mmr: 1_000, joinedAt: 0 });
    matchmaker.join({ profileId: 'far', socketId: 'sf', mmr: 1_151, joinedAt: 0 });

    await matchmaker.tick(10 * SECOND);
    expect(candidates).toEqual([]);

    matchmaker.join({ profileId: 'near', socketId: 'sn', mmr: 1_149, joinedAt: 1 });
    await matchmaker.tick(10_001);
    expect(candidates).toEqual([['anchor', 'near']]);
    expect(matchmaker.inspectQueue().map(entry => entry.profileId)).toEqual(['far']);
  });

  it('records queue waits when officials form and training is offered', async () => {
    const waits: number[] = [];
    const matchmaker = new ArenaMatchmaker({
      now: () => 0,
      reserveOfficial: async () => ({ matchId: 'metric-match' }),
      createOfficialRoom: async () => true,
      rollbackOfficialRoom: async () => undefined,
      voidOfficial: async () => undefined,
      createTrainingRoom: async () => ({ matchId: 'training-room' }),
      rollbackTrainingRoom: async () => undefined,
      metrics: {
        recordQueueWait: waitMs => {
          waits.push(waitMs);
        },
      },
    });
    matchmaker.join({
      profileId: 'a', socketId: 'sa', mmr: 1_000, joinedAt: 1_000,
    });
    matchmaker.join({
      profileId: 'b', socketId: 'sb', mmr: 1_010, joinedAt: 5_000,
    });
    await matchmaker.tick(12_000);
    expect([...waits].sort((left, right) => left - right))
      .toEqual([7_000, 11_000]);

    matchmaker.join({
      profileId: 'solo', socketId: 'ss', mmr: 1_000, joinedAt: 20_000,
    });
    await matchmaker.tick(80_000);
    expect(waits).toHaveLength(3);
    expect(waits).toContain(60_000);
  });

  it('offers one private thirty-second training match without reserving', async () => {
    const offered: Array<{ socketId: string; offerId: string; expiresAt: number }> = [];
    let reserveCalls = 0;
    let trainingCalls = 0;
    const matchmaker = new ArenaMatchmaker({
      now: () => 0,
      reserveOfficial: async () => {
        reserveCalls += 1;
        return null;
      },
      createOfficialRoom: async () => false,
      rollbackOfficialRoom: async () => undefined,
      voidOfficial: async () => undefined,
      createTrainingRoom: async () => {
        trainingCalls += 1;
        return { matchId: 'training-room' };
      },
      rollbackTrainingRoom: async () => undefined,
      onTrainingOffered: (socketId, offer) => offered.push({ socketId, ...offer }),
    });
    matchmaker.join({ profileId: 'a', socketId: 'sa', mmr: 1_000, joinedAt: 0 });
    await matchmaker.tick(60_000);
    expect(offered).toEqual([{
      socketId: 'sa', offerId: expect.any(String), expiresAt: 90_000,
    }]);
    expect(reserveCalls).toBe(0);
    await expect(matchmaker.acceptTraining('a', 'sa', offered[0].offerId, 89_999))
      .resolves.toEqual({ matchId: 'training-room' });
    expect(trainingCalls).toBe(1);
    await expect(matchmaker.acceptTraining('a', 'sa', offered[0].offerId, 90_000))
      .resolves.toBeNull();
  });

  it('rejects only the exact active training offer and returns to idle', async () => {
    const offered: ArenaTrainingOffer[] = [];
    const states: string[] = [];
    const matchmaker = new ArenaMatchmaker({
      now: () => 0,
      reserveOfficial: async () => null,
      createOfficialRoom: async () => false,
      rollbackOfficialRoom: async () => undefined,
      voidOfficial: async () => undefined,
      createTrainingRoom: async () => ({ matchId: 'unused' }),
      rollbackTrainingRoom: async () => undefined,
      onTrainingOffered: (_socketId, offer) => offered.push(offer),
      onQueueState: (_socketId, state) => states.push(state.status),
    });
    matchmaker.join({
      profileId: 'a',
      socketId: 'sa',
      mmr: 1_000,
      joinedAt: 0,
    });
    await matchmaker.tick(60_000);

    expect(matchmaker.rejectTraining('a', 'sa', 'wrong-offer')).toBe(false);
    expect(matchmaker.rejectTraining('a', 'wrong-socket', offered[0].offerId))
      .toBe(false);
    expect(matchmaker.rejectTraining('a', 'sa', offered[0].offerId)).toBe(true);
    expect(matchmaker.getPublicState('a')).toEqual({ status: 'idle' });
    expect(states.at(-1)).toBe('idle');
  });

  it('keeps training blocking and suppresses stale success after disconnect', async () => {
    let resolveTraining!: (result: { matchId: string } | null) => void;
    let trainingStarted!: () => void;
    const started = new Promise<void>(resolve => {
      trainingStarted = resolve;
    });
    const matched: string[] = [];
    const rolledBack: Array<string | null> = [];
    const offered: ArenaTrainingOffer[] = [];
    const matchmaker = new ArenaMatchmaker({
      now: () => 70_000,
      reserveOfficial: async () => null,
      createOfficialRoom: async () => false,
      rollbackOfficialRoom: async () => undefined,
      voidOfficial: async () => undefined,
      createTrainingRoom: async () => new Promise(resolve => {
        resolveTraining = resolve;
        trainingStarted();
      }),
      rollbackTrainingRoom: async (_profileId, _socketId, _offerId, result) => {
        rolledBack.push(result?.matchId ?? null);
      },
      onMatchFound: socketId => matched.push(socketId),
      onTrainingOffered: (_socketId, offer) => offered.push(offer),
    });
    matchmaker.join({ profileId: 'a', socketId: 'sa', mmr: 1_000, joinedAt: 0 });
    await matchmaker.tick(60_000);
    const offer = matchmaker.getPublicState('a');
    expect(offer.status).toBe('training-offered');

    const accepting = matchmaker.acceptTraining(
      'a', 'sa', offered[0].offerId, 70_000,
    );
    await started;
    expect(matchmaker.hasBlockingParticipation('a')).toBe(true);
    matchmaker.disconnect('sa');
    resolveTraining({ matchId: 'training-room' });

    await expect(accepting).resolves.toBeNull();
    expect(matched).toEqual([]);
    expect(rolledBack).toEqual(['training-room']);
    expect(matchmaker.hasBlockingParticipation('a')).toBe(false);
  });

  it('rolls back a partial training create rejection before returning idle', async () => {
    const offered: ArenaTrainingOffer[] = [];
    const states: string[] = [];
    const rolledBack: Array<string | null> = [];
    const matchmaker = new ArenaMatchmaker({
      now: () => 70_000,
      reserveOfficial: async () => null,
      createOfficialRoom: async () => false,
      rollbackOfficialRoom: async () => undefined,
      voidOfficial: async () => undefined,
      createTrainingRoom: async () => {
        throw new Error('partial training room');
      },
      rollbackTrainingRoom: async (_profileId, _socketId, _offerId, result) => {
        rolledBack.push(result?.matchId ?? null);
      },
      onQueueState: (_socketId, state) => states.push(state.status),
      onTrainingOffered: (_socketId, offer) => offered.push(offer),
    });
    matchmaker.join({ profileId: 'a', socketId: 'sa', mmr: 1_000, joinedAt: 0 });
    await matchmaker.tick(60_000);

    await expect(matchmaker.acceptTraining(
      'a', 'sa', offered[0].offerId, 70_000,
    )).resolves.toBeNull();
    expect(rolledBack).toEqual([null]);
    expect(states.at(-1)).toBe('idle');
    expect(matchmaker.hasBlockingParticipation('a')).toBe(false);
  });

  it('closes while training creation is pending and ignores its late success', async () => {
    let resolveTraining!: (result: { matchId: string } | null) => void;
    let trainingStarted!: () => void;
    const started = new Promise<void>(resolve => {
      trainingStarted = resolve;
    });
    const offered: ArenaTrainingOffer[] = [];
    const matched: string[] = [];
    const rolledBack: string[] = [];
    const timers = new Map<ReturnType<typeof setTimeout>, number>();
    let nextTimer = 0;
    const matchmaker = new ArenaMatchmaker({
      now: () => 70_000,
      reserveOfficial: async () => null,
      createOfficialRoom: async () => false,
      rollbackOfficialRoom: async () => undefined,
      voidOfficial: async () => undefined,
      createTrainingRoom: async () => new Promise(resolve => {
        resolveTraining = resolve;
        trainingStarted();
      }),
      rollbackTrainingRoom: async (_profileId, _socketId, _offerId, result) => {
        if (result) rolledBack.push(result.matchId);
      },
      onMatchFound: socketId => matched.push(socketId),
      onTrainingOffered: (_socketId, offer) => offered.push(offer),
      setTimer: (_callback, delay) => {
        const handle = ++nextTimer as unknown as ReturnType<typeof setTimeout>;
        timers.set(handle, delay);
        return handle;
      },
      clearTimer: handle => {
        timers.delete(handle);
      },
    });
    matchmaker.start();
    matchmaker.join({ profileId: 'a', socketId: 'sa', mmr: 1_000, joinedAt: 0 });
    await matchmaker.tick(60_000);
    const accepting = matchmaker.acceptTraining(
      'a', 'sa', offered[0].offerId, 70_000,
    );
    await started;
    const closing = matchmaker.close();
    expect(matchmaker.close()).toBe(closing);
    const outcome = await settleWithin(closing);
    expect(outcome).toEqual({
      status: 'settled',
      value: {
        pendingOfficialMatchIds: [],
        pendingTrainingOfferIds: [offered[0].offerId],
      },
    });
    await expect(accepting).resolves.toBeNull();

    resolveTraining({ matchId: 'training-room' });
    await flushMicrotasks();
    expect(rolledBack).toEqual([]);
    expect(matched).toEqual([]);
    expect(timers.size).toBe(0);
  });

  it('does not duplicate an in-flight training cleanup while closing', async () => {
    const offered: ArenaTrainingOffer[] = [];
    const rollbackResolvers: Array<() => void> = [];
    let rollbackStarted!: () => void;
    const started = new Promise<void>(resolve => {
      rollbackStarted = resolve;
    });
    let rollbackCalls = 0;
    const callbacks: string[] = [];
    const matchmaker = new ArenaMatchmaker({
      now: () => 70_000,
      reserveOfficial: async () => null,
      createOfficialRoom: async () => false,
      rollbackOfficialRoom: async () => undefined,
      voidOfficial: async () => undefined,
      createTrainingRoom: async () => null,
      rollbackTrainingRoom: async () => {
        rollbackCalls += 1;
        if (rollbackCalls === 1) rollbackStarted();
        await new Promise<void>(resolve => {
          rollbackResolvers.push(resolve);
        });
      },
      onTrainingOffered: (_socketId, offer) => offered.push(offer),
      onQueueState: (_socketId, state) => callbacks.push(state.status),
      onMatchFound: socketId => callbacks.push(`matched:${socketId}`),
      onError: (_error, context) => callbacks.push(`error:${context}`),
    });
    matchmaker.join({ profileId: 'a', socketId: 'sa', mmr: 1_000, joinedAt: 0 });
    await matchmaker.tick(60_000);
    const accepting = matchmaker.acceptTraining(
      'a', 'sa', offered[0].offerId, 70_000,
    );
    await started;
    const callbacksBeforeClose = [...callbacks];

    expect(await settleWithin(matchmaker.close())).toEqual({
      status: 'settled',
      value: {
        pendingOfficialMatchIds: [],
        pendingTrainingOfferIds: [offered[0].offerId],
      },
    });
    await expect(accepting).resolves.toBeNull();
    expect(rollbackCalls).toBe(1);

    rollbackResolvers[0]();
    await flushMicrotasks();
    expect(rollbackCalls).toBe(1);
    expect(callbacks).toEqual(callbacksBeforeClose);
  });

  it('reports an offer without duplicating its in-flight cleanup retry on close', async () => {
    let now = 70_000;
    const offered: ArenaTrainingOffer[] = [];
    let resolveRetry!: () => void;
    let retryStarted!: () => void;
    const started = new Promise<void>(resolve => {
      retryStarted = resolve;
    });
    let rollbackCalls = 0;
    const callbacks: string[] = [];
    const matchmaker = new ArenaMatchmaker({
      now: () => now,
      reserveOfficial: async () => null,
      createOfficialRoom: async () => false,
      rollbackOfficialRoom: async () => undefined,
      voidOfficial: async () => undefined,
      createTrainingRoom: async () => null,
      rollbackTrainingRoom: async () => {
        rollbackCalls += 1;
        if (rollbackCalls === 1) throw new Error('initial cleanup failure');
        if (rollbackCalls === 2) {
          retryStarted();
          await new Promise<void>(resolve => {
            resolveRetry = resolve;
          });
        }
      },
      onTrainingOffered: (_socketId, offer) => offered.push(offer),
      onQueueState: (_socketId, state) => callbacks.push(state.status),
      onMatchFound: socketId => callbacks.push(`matched:${socketId}`),
      onError: (_error, context) => callbacks.push(`error:${context}`),
    });
    matchmaker.join({ profileId: 'a', socketId: 'sa', mmr: 1_000, joinedAt: 0 });
    await matchmaker.tick(60_000);
    const accepting = matchmaker.acceptTraining(
      'a', 'sa', offered[0].offerId, now,
    );
    await flushMicrotasks();
    expect(rollbackCalls).toBe(1);

    now += 100;
    const retrying = matchmaker.tick(now);
    await started;
    const callbacksBeforeClose = [...callbacks];
    expect(await settleWithin(matchmaker.close())).toEqual({
      status: 'settled',
      value: {
        pendingOfficialMatchIds: [],
        pendingTrainingOfferIds: [offered[0].offerId],
      },
    });
    await expect(accepting).resolves.toBeNull();
    expect(rollbackCalls).toBe(2);

    resolveRetry();
    await retrying;
    await flushMicrotasks();
    expect(rollbackCalls).toBe(2);
    expect(callbacks).toEqual(callbacksBeforeClose);
  });

  it('restores connected candidates with original time before reserve validation', async () => {
    let releaseReserve!: (value: null) => void;
    const matchmaker = testMatchmaker((_candidate, isValid) =>
      new Promise(resolve => {
        releaseReserve = value => resolve(isValid() ? value : null);
      }),
    );
    matchmaker.join({ profileId: 'a', socketId: 'sa', mmr: 1_000, joinedAt: 0 });
    matchmaker.join({ profileId: 'b', socketId: 'sb', mmr: 1_000, joinedAt: 5 });
    const ticking = matchmaker.tick(60_000);
    matchmaker.disconnect('sb');
    releaseReserve(null);
    await ticking;
    expect(matchmaker.inspectQueue()).toEqual([
      { profileId: 'a', socketId: 'sa', mmr: 1_000, joinedAt: 0 },
    ]);
  });

  it('voids after room failure and requeues connected players with new time', async () => {
    const voided: string[] = [];
    const matchmaker = new ArenaMatchmaker({
      now: () => 70_000,
      reserveOfficial: async () => ({ matchId: 'reserved' }),
      createOfficialRoom: async () => false,
      rollbackOfficialRoom: async () => undefined,
      voidOfficial: async matchId => {
        voided.push(matchId);
      },
      createTrainingRoom: async () => null,
      rollbackTrainingRoom: async () => undefined,
    });
    matchmaker.join({ profileId: 'a', socketId: 'sa', mmr: 1_000, joinedAt: 0 });
    matchmaker.join({ profileId: 'b', socketId: 'sb', mmr: 1_000, joinedAt: 0 });
    await matchmaker.tick(60_000);
    expect(voided).toEqual(['reserved']);
    expect(matchmaker.inspectQueue().map(entry => entry.joinedAt))
      .toEqual([70_000, 70_000]);
  });

  it('voids a created room when a candidate disconnects during room creation', async () => {
    let resolveRoom!: (created: boolean) => void;
    let roomCreationStarted!: () => void;
    const started = new Promise<void>(resolve => {
      roomCreationStarted = resolve;
    });
    const voided: string[] = [];
    const matched: string[] = [];
    const rolledBack: string[] = [];
    let tickets = 2;
    let nextTimer = 0;
    const timers = new Map<ReturnType<typeof setTimeout>, number>();
    const matchmaker = new ArenaMatchmaker({
      now: () => 70_000,
      reserveOfficial: async () => {
        tickets -= 2;
        return { matchId: 'reserved' };
      },
      createOfficialRoom: async () => new Promise(resolve => {
        resolveRoom = resolve;
        roomCreationStarted();
      }),
      rollbackOfficialRoom: async reservation => {
        rolledBack.push(reservation.matchId);
      },
      voidOfficial: async matchId => {
        voided.push(matchId);
        tickets += 2;
      },
      createTrainingRoom: async () => null,
      rollbackTrainingRoom: async () => undefined,
      onMatchFound: socketId => matched.push(socketId),
      setTimer: (_callback, delay) => {
        const handle = ++nextTimer as unknown as ReturnType<typeof setTimeout>;
        timers.set(handle, delay);
        return handle;
      },
      clearTimer: handle => {
        timers.delete(handle);
      },
    });
    matchmaker.start();
    matchmaker.join({ profileId: 'a', socketId: 'sa', mmr: 1_000, joinedAt: 0 });
    matchmaker.join({ profileId: 'b', socketId: 'sb', mmr: 1_000, joinedAt: 0 });
    const ticking = matchmaker.tick(60_000);
    await started;
    matchmaker.disconnect('sb');
    resolveRoom(true);
    await ticking;

    expect(voided).toEqual(['reserved']);
    expect(rolledBack).toEqual(['reserved']);
    expect(tickets).toBe(2);
    expect(matched).toEqual([]);
    expect(matchmaker.inspectQueue()).toEqual([
      { profileId: 'a', socketId: 'sa', mmr: 1_000, joinedAt: 70_000 },
    ]);
    expect([...timers.values()]).toEqual([60_000]);
  });

  it('voids only once when room creation fails after a candidate disconnects', async () => {
    let resolveRoom!: (created: boolean) => void;
    let roomCreationStarted!: () => void;
    const started = new Promise<void>(resolve => {
      roomCreationStarted = resolve;
    });
    const voided: string[] = [];
    const rolledBack: string[] = [];
    const matchmaker = new ArenaMatchmaker({
      now: () => 80_000,
      reserveOfficial: async () => ({ matchId: 'reserved' }),
      createOfficialRoom: async () => new Promise(resolve => {
        resolveRoom = resolve;
        roomCreationStarted();
      }),
      rollbackOfficialRoom: async reservation => {
        rolledBack.push(reservation.matchId);
      },
      voidOfficial: async matchId => {
        voided.push(matchId);
      },
      createTrainingRoom: async () => null,
      rollbackTrainingRoom: async () => undefined,
    });
    matchmaker.join({ profileId: 'a', socketId: 'sa', mmr: 1_000, joinedAt: 0 });
    matchmaker.join({ profileId: 'b', socketId: 'sb', mmr: 1_000, joinedAt: 0 });
    const ticking = matchmaker.tick(60_000);
    await started;
    matchmaker.disconnect('sb');
    resolveRoom(false);
    await ticking;

    expect(voided).toEqual(['reserved']);
    expect(rolledBack).toEqual(['reserved']);
    expect(matchmaker.inspectQueue()).toEqual([
      { profileId: 'a', socketId: 'sa', mmr: 1_000, joinedAt: 80_000 },
    ]);
  });

  it('closes while official room creation is pending and ignores its late rejection', async () => {
    let rejectRoom!: (error: Error) => void;
    let roomCreationStarted!: () => void;
    const started = new Promise<void>(resolve => {
      roomCreationStarted = resolve;
    });
    const voided: string[] = [];
    const rolledBack: string[] = [];
    const matched: string[] = [];
    const matchmaker = new ArenaMatchmaker({
      now: () => 90_000,
      reserveOfficial: async () => ({ matchId: 'reserved' }),
      createOfficialRoom: async () => new Promise((_resolve, reject) => {
        rejectRoom = reject;
        roomCreationStarted();
      }),
      rollbackOfficialRoom: async reservation => {
        rolledBack.push(reservation.matchId);
      },
      voidOfficial: async matchId => {
        voided.push(matchId);
      },
      createTrainingRoom: async () => null,
      rollbackTrainingRoom: async () => undefined,
      onMatchFound: socketId => matched.push(socketId),
    });
    matchmaker.join({ profileId: 'a', socketId: 'sa', mmr: 1_000, joinedAt: 0 });
    matchmaker.join({ profileId: 'b', socketId: 'sb', mmr: 1_000, joinedAt: 0 });
    const ticking = matchmaker.tick(60_000);
    await started;
    const outcome = await settleWithin(matchmaker.close());
    expect(outcome).toEqual({
      status: 'settled',
      value: {
        pendingOfficialMatchIds: ['reserved'],
        pendingTrainingOfferIds: [],
      },
    });

    rejectRoom(new Error('late room rejection'));
    await ticking;
    await flushMicrotasks();

    expect(rolledBack).toEqual([]);
    expect(voided).toEqual([]);
    expect(matched).toEqual([]);
    expect(matchmaker.inspectQueue()).toEqual([]);
  });

  it('keeps a candidate blocked and retries rollback then void after transient cleanup failures', async () => {
    let now = 70_000;
    let rollbackCalls = 0;
    let voidCalls = 0;
    let nextTimer = 0;
    const timers = new Map<ReturnType<typeof setTimeout>, number>();
    const matchmaker = new ArenaMatchmaker({
      now: () => now,
      reserveOfficial: async () => ({ matchId: 'reserved' }),
      createOfficialRoom: async () => {
        throw new Error('partial room create');
      },
      rollbackOfficialRoom: async () => {
        rollbackCalls += 1;
        if (rollbackCalls === 1) throw new Error('transient rollback');
      },
      voidOfficial: async () => {
        voidCalls += 1;
        if (voidCalls === 1) throw new Error('transient void');
      },
      createTrainingRoom: async () => null,
      rollbackTrainingRoom: async () => undefined,
      setTimer: (_callback, delay) => {
        const handle = ++nextTimer as unknown as ReturnType<typeof setTimeout>;
        timers.set(handle, delay);
        return handle;
      },
      clearTimer: handle => {
        timers.delete(handle);
      },
    });
    matchmaker.start();
    matchmaker.join({ profileId: 'a', socketId: 'sa', mmr: 1_000, joinedAt: 0 });
    matchmaker.join({ profileId: 'b', socketId: 'sb', mmr: 1_000, joinedAt: 0 });

    await expect(matchmaker.tick(60_000)).resolves.toBeUndefined();
    expect(matchmaker.hasBlockingParticipation('a')).toBe(true);
    expect(matchmaker.inspectQueue()).toEqual([]);
    expect(rollbackCalls).toBe(1);
    expect(voidCalls).toBe(0);
    expect([...timers.values()]).toEqual([100]);

    now += 100;
    await expect(matchmaker.tick(now)).resolves.toBeUndefined();
    expect(matchmaker.hasBlockingParticipation('a')).toBe(true);
    expect(rollbackCalls).toBe(2);
    expect(voidCalls).toBe(1);
    expect([...timers.values()]).toEqual([200]);

    now += 200;
    await expect(matchmaker.tick(now)).resolves.toBeUndefined();
    expect(rollbackCalls).toBe(2);
    expect(voidCalls).toBe(2);
    expect(matchmaker.hasBlockingParticipation('a')).toBe(true);
    expect(matchmaker.inspectQueue().map(entry => entry.joinedAt))
      .toEqual([now, now]);
    expect([...timers.values()]).toEqual([10_000]);
    await matchmaker.close();
    expect(timers.size).toBe(0);
  });

  it('removes queued and offered users immediately on disconnect and stores no identity metadata', async () => {
    const matchmaker = testMatchmaker(async () => null);
    matchmaker.join({ profileId: 'a', socketId: 'sa', mmr: 1_000, joinedAt: 0 });
    expect(Object.keys(matchmaker.inspectQueue()[0]).sort()).toEqual([
      'joinedAt', 'mmr', 'profileId', 'socketId',
    ]);
    matchmaker.disconnect('sa');
    expect(matchmaker.inspectQueue()).toEqual([]);
    matchmaker.join({ profileId: 'a', socketId: 'sa', mmr: 1_000, joinedAt: 0 });
    await matchmaker.tick(60_000);
    expect(matchmaker.hasBlockingParticipation('a')).toBe(true);
    matchmaker.disconnect('sa');
    expect(matchmaker.hasBlockingParticipation('a')).toBe(false);
  });

  it('uses one bounded timer, wakes immediately for a new pair, and clears it on close', () => {
    let nextHandle = 0;
    const timers = new Map<ReturnType<typeof setTimeout>, number>();
    const matchmaker = new ArenaMatchmaker({
      now: () => 0,
      reserveOfficial: async () => null,
      createOfficialRoom: async () => false,
      rollbackOfficialRoom: async () => undefined,
      voidOfficial: async () => undefined,
      createTrainingRoom: async () => null,
      rollbackTrainingRoom: async () => undefined,
      setTimer: (_callback, delay) => {
        const handle = ++nextHandle as unknown as ReturnType<typeof setTimeout>;
        timers.set(handle, delay);
        return handle;
      },
      clearTimer: handle => {
        timers.delete(handle);
      },
    });
    matchmaker.start();
    matchmaker.join({ profileId: 'a', socketId: 'sa', mmr: 1_000, joinedAt: 0 });
    expect([...timers.values()]).toEqual([60_000]);
    matchmaker.join({ profileId: 'b', socketId: 'sb', mmr: 1_000, joinedAt: 0 });
    expect([...timers.values()]).toEqual([1]);
    matchmaker.close();
    expect(timers.size).toBe(0);
  });

  it('isolates throwing notification hooks and still attempts every recipient', async () => {
    const queueAttempts: string[] = [];
    const matchAttempts: string[] = [];
    const reported: string[] = [];
    const matchmaker = new ArenaMatchmaker({
      now: () => 70_000,
      reserveOfficial: async () => ({ matchId: 'reserved' }),
      createOfficialRoom: async () => true,
      rollbackOfficialRoom: async () => undefined,
      voidOfficial: async () => undefined,
      createTrainingRoom: async () => null,
      rollbackTrainingRoom: async () => undefined,
      onQueueState: socketId => {
        queueAttempts.push(socketId);
        throw new Error(`queue:${socketId}`);
      },
      onMatchFound: ((socketId: string) => {
        matchAttempts.push(socketId);
        return Promise.reject(new Error(`match:${socketId}`));
      }) as unknown as (socketId: string, matchId: string) => void,
      onError: (error, context) => {
        reported.push(`${context}:${String(error)}`);
        throw new Error('reporter failed');
      },
    } as ConstructorParameters<typeof ArenaMatchmaker>[0]);

    expect(() => matchmaker.join({
      profileId: 'a', socketId: 'sa', mmr: 1_000, joinedAt: 0,
    })).not.toThrow();
    expect(() => matchmaker.join({
      profileId: 'b', socketId: 'sb', mmr: 1_000, joinedAt: 0,
    })).not.toThrow();
    await expect(matchmaker.tick(60_000)).resolves.toBeUndefined();
    await Promise.resolve();
    await Promise.resolve();

    expect(matchAttempts).toEqual(['sa', 'sb']);
    expect(queueAttempts).toEqual(expect.arrayContaining(['sa', 'sb']));
    expect(reported.some(item => item.startsWith('queue-state:'))).toBe(true);
    expect(reported.some(item => item.startsWith('match-found:'))).toBe(true);
    expect(matchmaker.hasBlockingParticipation('a')).toBe(false);
  });

  it('resolves training acceptance deterministically when notification hooks throw', async () => {
    const offered: ArenaTrainingOffer[] = [];
    const matchmaker = new ArenaMatchmaker({
      now: () => 70_000,
      reserveOfficial: async () => null,
      createOfficialRoom: async () => false,
      rollbackOfficialRoom: async () => undefined,
      voidOfficial: async () => undefined,
      createTrainingRoom: async () => ({ matchId: 'training-room' }),
      rollbackTrainingRoom: async () => undefined,
      onQueueState: () => {
        throw new Error('queue hook');
      },
      onTrainingOffered: (_socketId, offer) => {
        offered.push(offer);
        throw new Error('offer hook');
      },
      onMatchFound: () => {
        throw new Error('match hook');
      },
      onError: async () => {
        throw new Error('async reporter failed');
      },
    } as ConstructorParameters<typeof ArenaMatchmaker>[0]);

    expect(() => matchmaker.join({
      profileId: 'a', socketId: 'sa', mmr: 1_000, joinedAt: 0,
    })).not.toThrow();
    await expect(matchmaker.tick(60_000)).resolves.toBeUndefined();
    await expect(matchmaker.acceptTraining(
      'a', 'sa', offered[0].offerId, 70_000,
    )).resolves.toEqual({ matchId: 'training-room' });
    expect(matchmaker.hasBlockingParticipation('a')).toBe(false);

    const failedOffers: ArenaTrainingOffer[] = [];
    const failed = new ArenaMatchmaker({
      now: () => 70_000,
      reserveOfficial: async () => null,
      createOfficialRoom: async () => false,
      rollbackOfficialRoom: async () => undefined,
      voidOfficial: async () => undefined,
      createTrainingRoom: async () => null,
      rollbackTrainingRoom: async () => undefined,
      onQueueState: () => {
        throw new Error('idle hook');
      },
      onTrainingOffered: (_socketId, offer) => failedOffers.push(offer),
    });
    failed.join({ profileId: 'b', socketId: 'sb', mmr: 1_000, joinedAt: 0 });
    await failed.tick(60_000);
    await expect(failed.acceptTraining(
      'b', 'sb', failedOffers[0].offerId, 70_000,
    )).resolves.toBeNull();
    expect(failed.hasBlockingParticipation('b')).toBe(false);
  });

  it('closes with a finite report while official reservation is pending', async () => {
    let resolveReserve!: (value: { matchId: string }) => void;
    let reservationStarted!: () => void;
    const started = new Promise<void>(resolve => {
      reservationStarted = resolve;
    });
    const mutations: string[] = [];
    const callbacks: string[] = [];
    const matchmaker = new ArenaMatchmaker({
      now: () => 70_000,
      reserveOfficial: async () => new Promise(resolve => {
        resolveReserve = resolve;
        reservationStarted();
      }),
      createOfficialRoom: async reservation => {
        mutations.push(`create:${reservation.matchId}`);
        return true;
      },
      rollbackOfficialRoom: async reservation => {
        mutations.push(`rollback:${reservation.matchId}`);
      },
      voidOfficial: async matchId => {
        mutations.push(`void:${matchId}`);
      },
      createTrainingRoom: async () => null,
      rollbackTrainingRoom: async () => undefined,
      onMatchFound: socketId => callbacks.push(`matched:${socketId}`),
      onError: (_error, context) => callbacks.push(`error:${context}`),
    });
    matchmaker.join({ profileId: 'a', socketId: 'sa', mmr: 1_000, joinedAt: 0 });
    matchmaker.join({ profileId: 'b', socketId: 'sb', mmr: 1_000, joinedAt: 0 });
    const ticking = matchmaker.tick(60_000);
    await started;

    const closing = matchmaker.close();
    expect(matchmaker.close()).toBe(closing);
    expect(await settleWithin(closing)).toEqual({
      status: 'settled',
      value: {
        pendingOfficialMatchIds: [],
        pendingTrainingOfferIds: [],
      },
    });
    expect(matchmaker.hasBlockingParticipation('a')).toBe(false);

    resolveReserve({ matchId: 'late-reservation' });
    await ticking;
    await flushMicrotasks();
    expect(mutations).toEqual([]);
    expect(callbacks).toEqual([]);
  });

  it('bounds a never-settling close cleanup and freezes its unresolved report', async () => {
    let rollbackCalls = 0;
    let resolveLateRollback!: () => void;
    let voidCalls = 0;
    let nextTimer = 0;
    const timers = new Map<ReturnType<typeof setTimeout>, number>();
    const callbacks: string[] = [];
    const matchmaker = new ArenaMatchmaker({
      closeDeadlineMs: 25,
      now: () => 70_000,
      reserveOfficial: async () => ({ matchId: 'reserved' }),
      createOfficialRoom: async () => false,
      rollbackOfficialRoom: async () => {
        rollbackCalls += 1;
        if (rollbackCalls === 1) throw new Error('initial cleanup failure');
        await new Promise<void>(resolve => {
          resolveLateRollback = resolve;
        });
      },
      voidOfficial: async () => {
        voidCalls += 1;
      },
      createTrainingRoom: async () => null,
      rollbackTrainingRoom: async () => undefined,
      onQueueState: (_socketId, state) => callbacks.push(state.status),
      onMatchFound: socketId => callbacks.push(`matched:${socketId}`),
      onError: (_error, context) => callbacks.push(`error:${context}`),
      setTimer: (_callback, delay) => {
        const handle = ++nextTimer as unknown as ReturnType<typeof setTimeout>;
        timers.set(handle, delay);
        return handle;
      },
      clearTimer: handle => {
        timers.delete(handle);
      },
    });
    matchmaker.start();
    matchmaker.join({ profileId: 'a', socketId: 'sa', mmr: 1_000, joinedAt: 0 });
    matchmaker.join({ profileId: 'b', socketId: 'sb', mmr: 1_000, joinedAt: 0 });
    await matchmaker.tick(60_000);
    const callbacksBeforeClose = [...callbacks];

    const closing = matchmaker.close();
    expect(matchmaker.close()).toBe(closing);
    const outcome = await settleWithin(closing);
    expect(outcome.status).toBe('settled');
    if (outcome.status !== 'settled') return;
    expect(outcome.value).toEqual({
      pendingOfficialMatchIds: ['reserved'],
      pendingTrainingOfferIds: [],
    });
    expect(Object.isFrozen(outcome.value)).toBe(true);
    expect(Object.isFrozen(outcome.value.pendingOfficialMatchIds)).toBe(true);
    expect(Object.isFrozen(outcome.value.pendingTrainingOfferIds)).toBe(true);
    expect(rollbackCalls).toBe(2);
    expect(voidCalls).toBe(0);
    expect(timers.size).toBe(0);
    expect(matchmaker.hasBlockingParticipation('a')).toBe(false);

    resolveLateRollback();
    await flushMicrotasks();
    expect(rollbackCalls).toBe(2);
    expect(voidCalls).toBe(0);
    expect(callbacks).toEqual(callbacksBeforeClose);
  });

  it('returns the same close promise when cleanup re-enters close', async () => {
    let rollbackCalls = 0;
    let reentrantClose: ReturnType<ArenaMatchmaker['close']> | undefined;
    const matchmaker = new ArenaMatchmaker({
      now: () => 70_000,
      reserveOfficial: async () => ({ matchId: 'reserved' }),
      createOfficialRoom: async () => false,
      rollbackOfficialRoom: async () => {
        rollbackCalls += 1;
        if (rollbackCalls === 2) reentrantClose = matchmaker.close();
        throw new Error('cleanup failure');
      },
      voidOfficial: async () => undefined,
      createTrainingRoom: async () => null,
      rollbackTrainingRoom: async () => undefined,
    });
    matchmaker.join({ profileId: 'a', socketId: 'sa', mmr: 1_000, joinedAt: 0 });
    matchmaker.join({ profileId: 'b', socketId: 'sb', mmr: 1_000, joinedAt: 0 });
    await matchmaker.tick(60_000);

    const closing = matchmaker.close();
    expect(reentrantClose).toBe(closing);
    expect(await settleWithin(closing)).toEqual({
      status: 'settled',
      value: {
        pendingOfficialMatchIds: ['reserved'],
        pendingTrainingOfferIds: [],
      },
    });
    expect(rollbackCalls).toBe(4);
  });

  it('does not report a delayed notification rejection after close resolves', async () => {
    let rejectNotification!: (error: Error) => void;
    const notification = new Promise<void>((_resolve, reject) => {
      rejectNotification = reject;
    });
    const reported: string[] = [];
    const matchmaker = new ArenaMatchmaker({
      now: () => 70_000,
      reserveOfficial: async () => null,
      createOfficialRoom: async () => false,
      rollbackOfficialRoom: async () => undefined,
      voidOfficial: async () => undefined,
      createTrainingRoom: async () => null,
      rollbackTrainingRoom: async () => undefined,
      onQueueState: () => notification,
      onError: (_error, context) => reported.push(context),
    });
    matchmaker.join({ profileId: 'a', socketId: 'sa', mmr: 1_000, joinedAt: 0 });
    expect(await settleWithin(matchmaker.close())).toMatchObject({
      status: 'settled',
    });

    rejectNotification(new Error('late notification failure'));
    await flushMicrotasks();
    expect(reported).toEqual([]);
  });

  it('returns a finite close report when official cleanup permanently fails', async () => {
    let rollbackCalls = 0;
    let voidCalls = 0;
    let nextTimer = 0;
    const timers = new Map<ReturnType<typeof setTimeout>, number>();
    const matchmaker = new ArenaMatchmaker({
      now: () => 70_000,
      reserveOfficial: async () => ({ matchId: 'reserved' }),
      createOfficialRoom: async () => false,
      rollbackOfficialRoom: async () => {
        rollbackCalls += 1;
        throw new Error('permanent rollback failure');
      },
      voidOfficial: async () => {
        voidCalls += 1;
      },
      createTrainingRoom: async () => null,
      rollbackTrainingRoom: async () => undefined,
      setTimer: (_callback, delay) => {
        const handle = ++nextTimer as unknown as ReturnType<typeof setTimeout>;
        timers.set(handle, delay);
        return handle;
      },
      clearTimer: handle => {
        timers.delete(handle);
      },
    });
    matchmaker.start();
    matchmaker.join({ profileId: 'a', socketId: 'sa', mmr: 1_000, joinedAt: 0 });
    matchmaker.join({ profileId: 'b', socketId: 'sb', mmr: 1_000, joinedAt: 0 });
    await matchmaker.tick(60_000);

    const first = matchmaker.close();
    const second = matchmaker.close();
    expect(second).toBe(first);
    let timeout: ReturnType<typeof setTimeout> | undefined;
    let outcome;
    try {
      outcome = await Promise.race([
        first.then(report => ({ status: 'closed' as const, report })),
        new Promise<{ status: 'timeout' }>(resolve => {
          timeout = setTimeout(() => resolve({ status: 'timeout' }), 50);
        }),
      ]);
    } finally {
      if (timeout) clearTimeout(timeout);
    }

    expect(outcome).toEqual({
      status: 'closed',
      report: {
        pendingOfficialMatchIds: ['reserved'],
        pendingTrainingOfferIds: [],
      },
    });
    expect(rollbackCalls).toBe(4);
    expect(voidCalls).toBe(0);
    expect(timers.size).toBe(0);
    const callsAfterClose = rollbackCalls;
    await new Promise(resolve => setTimeout(resolve, 10));
    expect(rollbackCalls).toBe(callsAfterClose);
  });

  it('reports unresolved training cleanup and releases its pending acceptance on close', async () => {
    const offered: ArenaTrainingOffer[] = [];
    let rollbackCalls = 0;
    const matchmaker = new ArenaMatchmaker({
      now: () => 70_000,
      reserveOfficial: async () => null,
      createOfficialRoom: async () => false,
      rollbackOfficialRoom: async () => undefined,
      voidOfficial: async () => undefined,
      createTrainingRoom: async () => null,
      rollbackTrainingRoom: async () => {
        rollbackCalls += 1;
        throw new Error('permanent training rollback failure');
      },
      onTrainingOffered: (_socketId, offer) => offered.push(offer),
    });
    matchmaker.join({ profileId: 'a', socketId: 'sa', mmr: 1_000, joinedAt: 0 });
    await matchmaker.tick(60_000);
    const accepting = matchmaker.acceptTraining(
      'a', 'sa', offered[0].offerId, 70_000,
    );
    await flushMicrotasks();

    const report = await matchmaker.close();
    await expect(accepting).resolves.toBeNull();
    expect(report).toEqual({
      pendingOfficialMatchIds: [],
      pendingTrainingOfferIds: [offered[0].offerId],
    });
    expect(rollbackCalls).toBe(4);
    expect(matchmaker.hasBlockingParticipation('a')).toBe(false);
  });
});

function testMatchmaker(
  reserveOfficial: ConstructorParameters<typeof ArenaMatchmaker>[0]['reserveOfficial'],
): ArenaMatchmaker {
  return new ArenaMatchmaker({
    now: () => 70_000,
    reserveOfficial,
    createOfficialRoom: async () => true,
    rollbackOfficialRoom: async () => undefined,
    voidOfficial: async () => undefined,
    createTrainingRoom: async () => null,
    rollbackTrainingRoom: async () => undefined,
  });
}

async function settleWithin<T>(
  promise: Promise<T>,
  timeoutMs = 100,
): Promise<
  | { status: 'settled'; value: T }
  | { status: 'timeout' }
> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise.then(value => ({ status: 'settled' as const, value })),
      new Promise<{ status: 'timeout' }>(resolve => {
        timer = setTimeout(() => resolve({ status: 'timeout' }), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function flushMicrotasks(): Promise<void> {
  for (let index = 0; index < 10; index += 1) {
    await Promise.resolve();
  }
}
