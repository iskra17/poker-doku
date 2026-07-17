import { describe, expect, it } from 'vitest';
import {
  ArenaMatchmaker,
  areArenaEntriesCompatible,
  arenaMmrRangeForWait,
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
      voidOfficial: async () => undefined,
      createTrainingRoom: async () => {
        trainingCalls += 1;
        return { matchId: 'training-room' };
      },
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
      voidOfficial: async matchId => {
        voided.push(matchId);
      },
      createTrainingRoom: async () => null,
    });
    matchmaker.join({ profileId: 'a', socketId: 'sa', mmr: 1_000, joinedAt: 0 });
    matchmaker.join({ profileId: 'b', socketId: 'sb', mmr: 1_000, joinedAt: 0 });
    await matchmaker.tick(60_000);
    expect(voided).toEqual(['reserved']);
    expect(matchmaker.inspectQueue().map(entry => entry.joinedAt))
      .toEqual([70_000, 70_000]);
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
      voidOfficial: async () => undefined,
      createTrainingRoom: async () => null,
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
});

function testMatchmaker(
  reserveOfficial: ConstructorParameters<typeof ArenaMatchmaker>[0]['reserveOfficial'],
): ArenaMatchmaker {
  return new ArenaMatchmaker({
    now: () => 70_000,
    reserveOfficial,
    createOfficialRoom: async () => true,
    voidOfficial: async () => undefined,
    createTrainingRoom: async () => null,
  });
}
