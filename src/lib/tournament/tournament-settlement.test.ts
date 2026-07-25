import { describe, expect, it } from 'vitest';
import {
  appendProvisionalEliminationBatch,
  buildTournamentPayoutFreeze,
  buildTournamentSettlementPlan,
  TournamentSettlementContractError,
  type TournamentSettlementResult,
} from './tournament-settlement';

const RESULTS: readonly TournamentSettlementResult[] = [
  {
    place: 1,
    playerId: 'bot-winner',
    participantType: 'bot',
    profileId: null,
    registrationAttempt: null,
    displayName: '미야코',
    prize: 50_000,
    disposition: 'promotion-return',
  },
  {
    place: 2,
    playerId: 'player-a',
    participantType: 'human',
    profileId: 'profile-a',
    registrationAttempt: 1,
    displayName: 'A',
    prize: 30_000,
    disposition: 'wallet-credit',
  },
  {
    place: 3,
    playerId: 'player-b',
    participantType: 'human',
    profileId: 'profile-b',
    registrationAttempt: 2,
    displayName: 'B',
    prize: 20_000,
    disposition: 'wallet-credit',
  },
  {
    place: 4,
    playerId: 'player-c',
    participantType: 'human',
    profileId: 'profile-c',
    registrationAttempt: 1,
    displayName: 'C',
    prize: 0,
    disposition: 'none',
  },
] as const;

describe('tournament settlement contract', () => {
  it('keeps open-late eliminations provisional with monotonic batch sequence', () => {
    const first = appendProvisionalEliminationBatch([], {
      sequence: 1,
      playerIds: ['player-c'],
    });
    const second = appendProvisionalEliminationBatch(first, {
      sequence: 2,
      playerIds: ['player-b', 'player-a'],
    });

    expect(second).toEqual([
      { sequence: 1, playerIds: ['player-c'] },
      { sequence: 2, playerIds: ['player-b', 'player-a'] },
    ]);
    expect(() => appendProvisionalEliminationBatch(second, {
      sequence: 2,
      playerIds: ['player-new'],
    })).toThrowError(TournamentSettlementContractError);
    expect(() => appendProvisionalEliminationBatch(second, {
      sequence: 3,
      playerIds: ['player-c'],
    })).toThrowError(TournamentSettlementContractError);
  });

  it('freezes final entrants and every place payout once at close', () => {
    const freeze = buildTournamentPayoutFreeze({
      version: 1,
      finalEntrants: 4,
      prizePool: 100_000,
      payouts: [50_000, 30_000, 20_000, 0],
    });

    expect(freeze).toMatchObject({
      version: 1,
      finalEntrants: 4,
      prizePool: 100_000,
      payouts: [
        { place: 1, amount: 50_000 },
        { place: 2, amount: 30_000 },
        { place: 3, amount: 20_000 },
        { place: 4, amount: 0 },
      ],
    });
    expect(buildTournamentPayoutFreeze({
      version: 1,
      finalEntrants: 4,
      prizePool: 100_000,
      payouts: [50_000, 30_000, 20_000, 0],
    })).toEqual(freeze);
    expect(() => buildTournamentPayoutFreeze({
      version: 1,
      finalEntrants: 4,
      prizePool: 100_000,
      payouts: [60_000, 30_000, 20_000, 0],
    })).toThrowError(TournamentSettlementContractError);
  });

  it('requires a continuous one-to-n result with every participant once', () => {
    const freeze = buildTournamentPayoutFreeze({
      version: 1,
      finalEntrants: 4,
      prizePool: 100_000,
      payouts: [50_000, 30_000, 20_000, 0],
    });
    const plan = buildTournamentSettlementPlan({
      instanceId: 'instance-a',
      configVersion: 2,
      freeze,
      results: RESULTS,
      now: 100,
    });

    expect(plan.results).toEqual(RESULTS);
    expect(plan.fingerprint).toMatch(/^[0-9a-f]{64}$/);
    expect(() => buildTournamentSettlementPlan({
      instanceId: 'instance-a',
      configVersion: 2,
      freeze,
      results: [
        RESULTS[0],
        { ...RESULTS[1], place: 3 },
        { ...RESULTS[2], place: 4 },
        { ...RESULTS[3], place: 5 },
      ],
      now: 100,
    })).toThrowError(TournamentSettlementContractError);
    expect(() => buildTournamentSettlementPlan({
      instanceId: 'instance-a',
      configVersion: 2,
      freeze,
      results: [
        RESULTS[0],
        RESULTS[1],
        { ...RESULTS[2], playerId: RESULTS[1].playerId },
        RESULTS[3],
      ],
      now: 100,
    })).toThrowError(TournamentSettlementContractError);
  });

  it('rejects a changed settlement fingerprint replay', () => {
    const freeze = buildTournamentPayoutFreeze({
      version: 1,
      finalEntrants: 4,
      prizePool: 100_000,
      payouts: [50_000, 30_000, 20_000, 0],
    });
    const first = buildTournamentSettlementPlan({
      instanceId: 'instance-a',
      configVersion: 2,
      freeze,
      results: RESULTS,
      now: 100,
    });
    const same = buildTournamentSettlementPlan({
      instanceId: 'instance-a',
      configVersion: 2,
      freeze,
      results: RESULTS,
      now: 101,
    });
    const changed = buildTournamentSettlementPlan({
      instanceId: 'instance-a',
      configVersion: 2,
      freeze,
      results: [
        { ...RESULTS[0], playerId: 'bot-other' },
        ...RESULTS.slice(1),
      ],
      now: 101,
    });

    expect(same.fingerprint).toBe(first.fingerprint);
    expect(changed.fingerprint).not.toBe(first.fingerprint);
  });
});
