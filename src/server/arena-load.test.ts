import { describe, expect, it, vi } from 'vitest';
import { ArenaMatchmaker } from './arena-matchmaker';

const SECOND = 1_000;

describe('Arena preseason queue load', () => {
  it('drives 100 queued profiles into valid officials within sixty seconds', async () => {
    vi.useFakeTimers();
    try {
      const started: Array<{
        matchId: string;
        profiles: string[];
        seats: number;
      }> = [];
      const offers: string[] = [];
      let reserveCalls = 0;
      let matchCounter = 0;
      const matchmaker = new ArenaMatchmaker({
        now: () => 0,
        reserveOfficial: async () => {
          reserveCalls += 1;
          if (reserveCalls === 1) return null;
          return { matchId: `match-${++matchCounter}` };
        },
        createOfficialRoom: async (reservation, candidate) => {
          started.push({
            matchId: reservation.matchId,
            profiles: candidate.entries.map(entry => entry.profileId),
            seats: candidate.entries.length + candidate.botCount,
          });
          return true;
        },
        rollbackOfficialRoom: async () => undefined,
        voidOfficial: async () => undefined,
        createTrainingRoom: async () => ({ matchId: 'training-room' }),
        rollbackTrainingRoom: async () => undefined,
        onTrainingOffered: socketId => {
          offers.push(socketId);
        },
      });

      for (let index = 0; index < 99; index += 1) {
        matchmaker.join({
          profileId: `p-${index}`,
          socketId: `s-${index}`,
          mmr: 800 + index * 6,
          joinedAt: 0,
        });
      }
      for (let second = 0; second <= 70; second += 1) {
        if (second === 2) {
          matchmaker.join({
            profileId: 'solo',
            socketId: 's-solo',
            mmr: 3_000,
            joinedAt: 2 * SECOND,
          });
        }
        await matchmaker.tick(second * SECOND);
      }

      const seatCounts = new Map<string, number>();
      for (const match of started) {
        expect(match.profiles.length).toBeGreaterThanOrEqual(2);
        expect(match.profiles.length).toBeLessThanOrEqual(6);
        expect(match.seats).toBe(6);
        for (const profileId of match.profiles) {
          seatCounts.set(profileId, (seatCounts.get(profileId) ?? 0) + 1);
        }
      }
      expect([...seatCounts.values()].every(count => count === 1)).toBe(true);
      expect(offers.length).toBeLessThanOrEqual(1);
      expect(seatCounts.size + offers.length).toBe(100);
      for (const socketId of offers) {
        expect(seatCounts.has(socketId.replace('s-', 'p-'))).toBe(false);
      }
      expect(matchmaker.inspectQueue()).toEqual([]);

      const closing = matchmaker.close();
      await vi.runAllTimersAsync();
      await closing;
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it('offers training to exactly the single leftover after formation', async () => {
    vi.useFakeTimers();
    try {
      const started: string[][] = [];
      const offers: string[] = [];
      let matchCounter = 0;
      const matchmaker = new ArenaMatchmaker({
        now: () => 0,
        reserveOfficial: async () => ({ matchId: `match-${++matchCounter}` }),
        createOfficialRoom: async (_reservation, candidate) => {
          started.push(candidate.entries.map(entry => entry.profileId));
          return true;
        },
        rollbackOfficialRoom: async () => undefined,
        voidOfficial: async () => undefined,
        createTrainingRoom: async () => ({ matchId: 'training-room' }),
        rollbackTrainingRoom: async () => undefined,
        onTrainingOffered: socketId => {
          offers.push(socketId);
        },
      });

      for (let index = 0; index < 97; index += 1) {
        matchmaker.join({
          profileId: `p-${index}`,
          socketId: `s-${index}`,
          mmr: 1_000,
          joinedAt: 0,
        });
      }
      for (let second = 0; second <= 70; second += 1) {
        await matchmaker.tick(second * SECOND);
      }

      expect(started).toHaveLength(16);
      expect(started.every(profiles => profiles.length === 6)).toBe(true);
      expect(offers).toHaveLength(1);
      expect(matchmaker.inspectQueue()).toEqual([]);

      const closing = matchmaker.close();
      await vi.runAllTimersAsync();
      await closing;
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });
});
