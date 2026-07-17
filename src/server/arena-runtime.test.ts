import {
  afterEach,
  beforeEach,
  describe,
  expect,
  expectTypeOf,
  it,
  vi,
} from 'vitest';
import { ARENA_CONFIG_V1 } from '@/lib/arena/config';
import { SNG_BLIND_SCHEDULE } from '@/lib/poker/blind-schedule';
import type { Player, RoomConfig } from '@/lib/poker/types';
import type { ArenaResultPayload } from '@/lib/realtime/protocol';
import {
  ArenaMatchmaker,
  type ArenaOfficialCandidate,
} from './arena-matchmaker';
import { ArenaRepository } from './arena-repository';
import { ArenaRuntime } from './arena-runtime';
import {
  ArenaService,
  getArenaKstWeekKey,
  type ArenaOfficialSummary,
} from './arena-service';
import { openPokerDatabase, type PokerDatabase } from './persistence/database';
import { RoomManager, type RoomArenaHooks } from './room-manager';

const EPOCH = Date.parse('2026-07-20T00:00:00+09:00');
const DAY = 24 * 60 * 60 * 1_000;

describe('ArenaRuntime', () => {
  let database: PokerDatabase;
  let repository: ArenaRepository;
  let service: ArenaService;
  let roomManager: RoomManager;

  beforeEach(() => {
    database = openPokerDatabase(':memory:');
    repository = new ArenaRepository(database);
    for (const profileId of [
      'profile-a', 'profile-b', 'profile-c', 'profile-d',
      'profile-e', 'profile-f',
    ]) {
      insertBaseProfile(database, profileId);
    }
    service = new ArenaService(repository, {
      epochMs: EPOCH,
      preseasonCount: 1,
      clock: () => EPOCH,
      isProfileInNonArenaSeat: () => false,
    });
    roomManager = new RoomManager(() => undefined, () => undefined);
  });

  afterEach(() => {
    vi.useRealTimers();
    roomManager.shutdown();
    database.close();
  });

  it('keeps the official completion hook on a synchronous summary contract', () => {
    expectTypeOf<ReturnType<RoomArenaHooks['completeOfficial']>>()
      .toEqualTypeOf<ArenaOfficialSummary>();
  });

  it('creates a hidden shuffled official 6-max room from the durable match snapshot', async () => {
    service.getSnapshot('profile-a');
    service.getSnapshot('profile-b');
    setMmr(repository, 'profile-a', 812);
    setMmr(repository, 'profile-b', 1_287);
    const match = service.reserveMatchTickets(
      'match-a',
      ['profile-a', 'profile-b'],
    );
    const rng = vi.fn()
      .mockReturnValueOnce(0.9)
      .mockReturnValueOnce(0.1)
      .mockReturnValue(0.5);
    const runtime = createRuntime({ rng });

    await expect(runtime.createOfficialRoom(
      { matchId: match.id },
      candidate(['profile-a', 'profile-b']),
    )).resolves.toBe(true);

    const roomId = runtime.getRoomId('match-a');
    expect(roomId).not.toBeNull();
    const room = roomManager.getRoom(roomId!)!;
    expect(room.config).toMatchObject({
      competitionMode: 'arena-official',
      arenaMatchId: 'match-a',
      arenaBotVersion: ARENA_CONFIG_V1.botVersion,
      gameMode: 'sng',
      economyMode: 'arena',
      tableType: 'mixed',
      maxPlayers: 6,
      startingStack: ARENA_CONFIG_V1.startingStack,
      smallBlind: SNG_BLIND_SCHEDULE[0].smallBlind,
      bigBlind: SNG_BLIND_SCHEDULE[0].bigBlind,
      difficulty: 'hard',
    });
    expect(room.engine.state.players).toHaveLength(6);
    expect(room.engine.state.players.every(
      player => player.chips === ARENA_CONFIG_V1.startingStack,
    )).toBe(true);
    expect(room.engine.state.players.filter(player => player.type === 'human')
      .map(player => player.id).sort()).toEqual(['profile-a', 'profile-b']);
    expect(room.engine.state.players.filter(player => player.type === 'bot'))
      .toHaveLength(4);
    expect(new Set(room.engine.state.players.map(player => player.seatIndex)).size)
      .toBe(6);
    expect(rng).toHaveBeenCalled();
    expect(repository.requireMatch('match-a')).toMatchObject({
      status: 'playing',
      configVersion: ARENA_CONFIG_V1.version,
      botVersion: ARENA_CONFIG_V1.botVersion,
      botMmr: 1_050,
      humanCount: 2,
      botCount: 4,
    });
    expect(roomManager.getRoomList()).toEqual([]);
    expect([...room.config.arenaParticipantIds!].sort())
      .toEqual(['profile-a', 'profile-b']);
    expect(JSON.stringify(room.engine.getPublicState('profile-a')))
      .not.toContain('arenaParticipantIds');
  });

  it('publishes the official room binding synchronously with room creation', async () => {
    const match = service.reserveMatchTickets(
      'match-a',
      ['profile-a', 'profile-b'],
    );
    const onOfficialRoomCreated = vi.fn();
    const runtime = createRuntime({ onOfficialRoomCreated });
    const officialCandidate = candidate(['profile-a', 'profile-b']);

    const creation = runtime.createOfficialRoom(
      { matchId: match.id },
      officialCandidate,
    );

    expect(onOfficialRoomCreated).toHaveBeenCalledWith({
      matchId: match.id,
      roomId: runtime.getRoomId(match.id),
      candidate: officialCandidate,
    });
    await expect(creation).resolves.toBe(true);
  });

  it('creates and rolls back training without tickets, score, MMR, or groups', async () => {
    service.getSnapshot('profile-a');
    const before = repository.requireProfile('arena-v1-0', 'profile-a');
    const runtime = createRuntime();

    const reservation = await runtime.createTrainingRoom(
      'profile-a',
      'socket-a',
    );

    expect(reservation).not.toBeNull();
    const roomId = runtime.getRoomId(reservation!.matchId);
    const room = roomManager.getRoom(roomId!)!;
    expect(room.config).toMatchObject({
      competitionMode: 'arena-training',
      economyMode: 'arena',
      gameMode: 'sng',
      tableType: 'mixed',
      startingStack: ARENA_CONFIG_V1.startingStack,
    });
    expect(room.engine.state.players).toHaveLength(6);
    expect(repository.requireProfile('arena-v1-0', 'profile-a')).toEqual(before);
    expect(repository.listUnfinishedMatches()).toEqual([]);
    expect(roomManager.getRoomList('profile-a')).toEqual([]);

    await runtime.rollbackTrainingRoom(
      'profile-a',
      'socket-a',
      'offer-a',
      reservation,
    );
    expect(roomManager.getRoom(roomId!)).toBeUndefined();
  });

  it('publishes public official and training result summaries without hidden fields', () => {
    const onResult = vi.fn();
    const runtime = createRuntime({ onResult });
    service.reserveMatchTickets('result-match', ['profile-a', 'profile-b']);
    service.markMatchPlaying('result-match');
    const results = [
      { playerId: 'profile-a', place: 1, type: 'human' as const },
      { playerId: 'profile-b', place: 2, type: 'human' as const },
      ...[3, 4, 5, 6].map(place => ({
        playerId: `bot-${place}`,
        place,
        type: 'bot' as const,
      })),
    ];

    runtime.completeOfficial({ matchId: 'result-match', results });
    runtime.completeTraining({
      matchId: 'training-match',
      results: [
        { playerId: 'profile-a', place: 3, type: 'human' },
        ...results.filter(result => result.type === 'bot'),
      ],
    });

    expect(onResult).toHaveBeenCalledWith(
      'profile-a',
      expect.objectContaining({
        resultId: 'result-match:profile-a',
        matchId: 'result-match',
        training: false,
        place: 1,
        points: 100,
        placementGames: 1,
        placementMatches: 5,
      }),
    );
    expect(onResult).toHaveBeenCalledWith(
      'profile-a',
      expect.objectContaining({
        resultId: 'training-match:profile-a',
        training: true,
        place: 3,
        points: 0,
      }),
    );
    expect(JSON.stringify(onResult.mock.calls)).not.toMatch(
      /mmr|credential|wallet|recovery/iu,
    );
  });

  it('settles a same-season official result before building its public view', () => {
    service.reserveMatchTickets('ordered-match', ['profile-a', 'profile-b']);
    service.markMatchPlaying('ordered-match', EPOCH + 1);
    const order: string[] = [];
    const settle = service.settleOfficialMatch.bind(service);
    const publicView = service.getPublicResultViewForMatch.bind(service);
    vi.spyOn(service, 'settleOfficialMatch').mockImplementation((
      matchId,
      results,
      at,
    ) => {
      order.push('settle');
      return settle(matchId, results, at);
    });
    vi.spyOn(service, 'getPublicResultViewForMatch').mockImplementation((
      matchId,
      profileId,
    ) => {
      order.push('public-view');
      return publicView(matchId, profileId);
    });

    createRuntime().completeOfficial({
      matchId: 'ordered-match',
      results: officialResults('profile-a', 'profile-b'),
    });

    expect(order[0]).toBe('settle');
  });

  it('finishes and consumes an official match after its season boundary', () => {
    service.reserveMatchTickets(
      'cross-season-match',
      ['profile-a', 'profile-b'],
      EPOCH,
    );
    service.markMatchPlaying('cross-season-match', EPOCH + 1);
    const onResult = vi.fn();
    const runtime = createRuntime({
      clock: () => EPOCH + 28 * DAY + 1,
      onResult,
    });

    expect(() => runtime.completeOfficial({
      matchId: 'cross-season-match',
      results: officialResults('profile-a', 'profile-b'),
    })).not.toThrow();

    expect(repository.requireMatch('cross-season-match').status).toBe('finished');
    expect(repository.requireTicketEscrow(
      'cross-season-match',
      'profile-a',
    ).status).toBe('consumed');
    expect(onResult).toHaveBeenCalledWith(
      'profile-a',
      expect.objectContaining({
        matchId: 'cross-season-match',
        placementGames: 1,
      }),
    );
  });

  it('replays persisted weekly rank movement after standings drift', () => {
    service.getSnapshot('profile-a', EPOCH);
    service.getSnapshot('profile-b', EPOCH);
    seedPlacedWeeklyGroup(repository, [
      ['profile-a', 60],
      ['profile-b', 100],
    ]);
    service.reserveMatchTickets('rank-match', ['profile-a', 'profile-b'], EPOCH);
    service.markMatchPlaying('rank-match', EPOCH + 1);
    const onResult = vi.fn();
    const runtime = createRuntime({ onResult });
    const rankResults = [
      { playerId: 'profile-a', place: 1, type: 'human' as const },
      { playerId: 'profile-b', place: 6, type: 'human' as const },
      ...[2, 3, 4, 5].map(place => ({
        playerId: `bot-${place}`,
        place,
        type: 'bot' as const,
      })),
    ];

    runtime.completeOfficial({ matchId: 'rank-match', results: rankResults });

    expect(onResult).toHaveBeenCalledWith(
      'profile-a',
      expect.objectContaining({
        matchId: 'rank-match',
        weeklyRankBefore: 2,
        weeklyRankAfter: 1,
      }),
    );
    expect(onResult).toHaveBeenCalledWith(
      'profile-b',
      expect.objectContaining({
        matchId: 'rank-match',
        weeklyRankBefore: 1,
        weeklyRankAfter: 2,
      }),
    );

    service.reserveMatchTickets(
      'drift-match',
      ['profile-a', 'profile-b'],
      EPOCH + 11,
    );
    service.markMatchPlaying('drift-match', EPOCH + 12);
    service.settleOfficialMatch(
      'drift-match',
      [
        { playerId: 'profile-b', place: 1, type: 'human' },
        { playerId: 'profile-a', place: 6, type: 'human' },
        ...[2, 3, 4, 5].map(place => ({
          playerId: `bot-${place}`,
          place,
          type: 'bot' as const,
        })),
      ],
      EPOCH + 13,
    );
    const replayed = vi.fn();
    createRuntime({ onResult: replayed }).completeOfficial({
      matchId: 'rank-match',
      results: rankResults,
    });

    expect(replayed).toHaveBeenCalledWith(
      'profile-a',
      expect.objectContaining({
        matchId: 'rank-match',
        weeklyRankBefore: 2,
        weeklyRankAfter: 1,
      }),
    );
  });

  it('keeps a durable result retryable when public view construction faults', () => {
    service.reserveMatchTickets('view-fault-match', ['profile-a', 'profile-b']);
    service.markMatchPlaying('view-fault-match', EPOCH + 1);
    const onResult = vi.fn();
    const runtime = createRuntime({ onResult });
    const publicView = vi.spyOn(service, 'getPublicResultViewForMatch')
      .mockImplementation(() => {
        throw new Error('public-view-fault');
      });

    let first: ArenaOfficialSummary | undefined;
    expect(() => {
      first = runtime.completeOfficial({
        matchId: 'view-fault-match',
        results: officialResults('profile-a', 'profile-b'),
      });
    }).not.toThrow();
    expect(repository.requireMatch('view-fault-match').status).toBe('finished');
    expect(repository.requireTicketEscrow(
      'view-fault-match',
      'profile-a',
    ).status).toBe('consumed');
    expect(onResult).not.toHaveBeenCalled();
    expect(runtime.getResult(
      'view-fault-match',
      'profile-a',
    )).toBeNull();

    publicView.mockRestore();
    const duplicate = runtime.completeOfficial({
      matchId: 'view-fault-match',
      results: officialResults('profile-a', 'profile-b'),
    });

    expect(duplicate).toEqual(first);
    expect(onResult).toHaveBeenCalled();
    expect(runtime.getResult(
      'view-fault-match',
      'profile-a',
    )).toMatchObject({
      resultId: 'view-fault-match:profile-a',
      matchId: 'view-fault-match',
      training: false,
      place: 1,
    });
    expect(repository.requireProfile(
      'arena-v1-0',
      'profile-a',
    ).placementGames).toBe(1);
  });

  it('cleans an official match mapping on normal disposal and tolerates late rollback', async () => {
    service.reserveMatchTickets('match-a', ['profile-a', 'profile-b']);
    roomManager.shutdown();
    roomManager = new RoomManager(
      () => undefined,
      () => undefined,
      undefined,
      {
        arena: {
          completeOfficial: input => runtime.completeOfficial(input),
        },
        onRoomDisposed: (
          disposedRoomId,
          _playerIds,
          _reason,
          arenaMatchId,
        ) => {
          if (arenaMatchId) {
            runtime.handleRoomDisposed(arenaMatchId, disposedRoomId);
          }
        },
      },
    );
    const runtime = createRuntime();
    const officialCandidate = candidate(['profile-a', 'profile-b']);
    await expect(runtime.createOfficialRoom(
      { matchId: 'match-a' },
      officialCandidate,
    )).resolves.toBe(true);
    const roomId = runtime.getRoomId('match-a')!;
    const room = roomManager.getRoom(roomId)!;

    runtime.handleRoomDisposed('match-a', 'stale-room-id');
    expect(runtime.getRoomId('match-a')).toBe(roomId);
    const tournament = room.engine.state.tournament!;
    tournament.entrants = 6;
    tournament.finished = true;
    tournament.results = room.engine.state.players.map((player, index) => ({
      playerId: player.id,
      name: player.name,
      place: index + 1,
      prize: 0,
    }));

    expect(roomManager.disposeRoom(roomId, 'sng-expired')).toBe(true);
    expect(runtime.getRoomId('match-a')).toBeNull();
    expect(roomManager.getRoom(roomId)).toBeUndefined();
    await expect(runtime.rollbackOfficialRoom(
      { matchId: 'match-a' },
      officialCandidate,
    )).resolves.toBeUndefined();
    await expect(runtime.rollbackOfficialRoom(
      { matchId: 'match-a' },
      officialCandidate,
    )).resolves.toBeUndefined();
  });

  it('cleans a training match mapping on empty disposal and keeps rollback idempotent', async () => {
    roomManager.shutdown();
    roomManager = new RoomManager(
      () => undefined,
      () => undefined,
      undefined,
      {
        onRoomDisposed: (
          disposedRoomId,
          _playerIds,
          _reason,
          arenaMatchId,
        ) => {
          if (arenaMatchId) {
            runtime.handleRoomDisposed(arenaMatchId, disposedRoomId);
          }
        },
      },
    );
    const runtime = createRuntime();
    const reservation = await runtime.createTrainingRoom(
      'profile-a',
      'socket-a',
    );
    const matchId = reservation!.matchId;
    const roomId = runtime.getRoomId(matchId)!;

    runtime.handleRoomDisposed(matchId, 'stale-room-id');
    expect(runtime.getRoomId(matchId)).toBe(roomId);
    expect(roomManager.disposeRoom(roomId, 'empty')).toBe(true);
    expect(runtime.getRoomId(matchId)).toBeNull();
    await expect(runtime.rollbackTrainingRoom(
      'profile-a',
      'socket-a',
      'offer-a',
      reservation,
    )).resolves.toBeUndefined();
    await expect(runtime.rollbackTrainingRoom(
      'profile-a',
      'socket-a',
      'offer-a',
      reservation,
    )).resolves.toBeUndefined();
  });

  it.each(['arena-official', 'arena-training'] as const)(
    'rejects a non-reserved human at the RoomManager boundary for %s',
    competitionMode => {
      const config: RoomConfig & {
        arenaParticipantIds: readonly string[];
      } = {
        name: 'Arena allowlist',
        smallBlind: 10,
        bigBlind: 20,
        minBuyIn: 1_500,
        maxBuyIn: 1_500,
        maxPlayers: 6,
        turnTime: 8,
        competitionMode,
        arenaMatchId: 'match-guard',
        arenaBotVersion: ARENA_CONFIG_V1.botVersion,
        arenaParticipantIds: ['reserved'],
      };
      const roomId = roomManager.createRoom(config);
      const reserved = testHuman('reserved', 0);
      const intruder = testHuman('intruder', 1);

      expect(roomManager.joinRoom(roomId, reserved)).toBe(true);
      const before = roomManager.getRoom(roomId)!.engine.state.players.map(
        player => ({ id: player.id, type: player.type, seatIndex: player.seatIndex }),
      );

      expect(roomManager.joinRoom(roomId, intruder)).toBe(false);
      expect(roomManager.getRoom(roomId)!.engine.state.players.map(
        player => ({ id: player.id, type: player.type, seatIndex: player.seatIndex }),
      )).toEqual(before);
    },
  );

  it('fails closed on a missing reserved identity without leaving a room behind', async () => {
    const match = service.reserveMatchTickets(
      'match-a',
      ['profile-a', 'profile-b'],
    );
    const runtime = createRuntime({
      resolveHuman: profileId => profileId === 'profile-a'
        ? { name: 'A', avatar: 'sakura' }
        : null,
    });

    await expect(runtime.createOfficialRoom(
      { matchId: match.id },
      candidate(['profile-a', 'profile-b']),
    )).resolves.toBe(false);

    expect(runtime.getRoomId(match.id)).toBeNull();
    expect(roomManager.getRoomCount()).toBe(0);
    expect(repository.requireMatch(match.id).status).toBe('forming');
  });

  it('rolls a failed official room back and voids the reservation through matchmaking', async () => {
    const profileIds = [
      'profile-a', 'profile-b', 'profile-c',
      'profile-d', 'profile-e', 'profile-f',
    ];
    const runtime = createRuntime({
      resolveHuman: profileId => profileId === 'profile-f'
        ? null
        : { name: `alias-${profileId}`, avatar: 'sakura' },
    });
    const matchmaker = new ArenaMatchmaker({
      now: () => EPOCH,
      reserveOfficial: async (officialCandidate, isValid) => {
        if (!isValid()) return null;
        const match = service.reserveMatchTickets(
          'match-failure',
          officialCandidate.entries.map(entry => entry.profileId),
          EPOCH,
        );
        return { matchId: match.id };
      },
      createOfficialRoom: (reservation, officialCandidate) =>
        runtime.createOfficialRoom(reservation, officialCandidate),
      rollbackOfficialRoom: (reservation, officialCandidate) =>
        runtime.rollbackOfficialRoom(reservation, officialCandidate),
      voidOfficial: async matchId => {
        service.voidMatch(matchId, EPOCH + 1);
      },
      createTrainingRoom: async () => null,
      rollbackTrainingRoom: async () => undefined,
    });
    profileIds.forEach((profileId, index) => {
      matchmaker.join({
        profileId,
        socketId: `socket-${index}`,
        mmr: 1_000,
        joinedAt: EPOCH,
      });
    });

    await matchmaker.tick(EPOCH);

    expect(roomManager.getRoomCount()).toBe(0);
    expect(repository.requireMatch('match-failure').status).toBe('void');
    for (const profileId of profileIds) {
      expect(repository.requireProfile('arena-v1-0', profileId).availableTickets)
        .toBe(2);
      expect(repository.requireTicketEscrow('match-failure', profileId).status)
        .toBe('refunded');
    }
    await matchmaker.close();
  });

  it('voids and refunds every forming or playing match during startup recovery', async () => {
    service.reserveMatchTickets('forming', ['profile-a', 'profile-b']);
    service.reserveMatchTickets('playing', ['profile-c', 'profile-d'], EPOCH + 1);
    service.markMatchPlaying('playing', EPOCH + 2);
    const runtime = createRuntime();

    expect(runtime.recoverUnfinishedMatches(EPOCH + 3))
      .toEqual(['forming', 'playing']);

    for (const matchId of ['forming', 'playing']) {
      expect(repository.requireMatch(matchId).status).toBe('void');
      const secondProfileId = matchId === 'forming' ? 'profile-b' : 'profile-d';
      expect(repository.requireTicketEscrow(matchId, secondProfileId).status)
        .toBe('refunded');
    }
    expect(repository.requireProfile('arena-v1-0', 'profile-a').availableTickets)
      .toBe(2);
    expect(repository.requireProfile('arena-v1-0', 'profile-b').availableTickets)
      .toBe(2);
    expect(repository.requireProfile('arena-v1-0', 'profile-c').availableTickets)
      .toBe(2);
    expect(repository.requireProfile('arena-v1-0', 'profile-d').availableTickets)
      .toBe(2);
    expect(roomManager.getRoomCount()).toBe(0);
  });

  it('retains and retries official completion exactly once without casual progression', async () => {
    vi.useFakeTimers();
    const completeOfficial = vi.fn()
      .mockImplementationOnce(() => {
        throw new Error('temporary database failure');
      })
      .mockReturnValue(undefined);
    const completeSng = vi.fn();
    const manager = new RoomManager(
      () => undefined,
      () => undefined,
      undefined,
      {
        sngRetentionMs: 60_000,
        arena: { completeOfficial },
        progression: {
          captureHandStart: vi.fn(),
          confirmHandStart: vi.fn(),
          cancelHand: vi.fn(),
          completeHand: vi.fn(),
          completeSng,
          disposeRoom: vi.fn(),
        },
      },
    );
    const roomId = manager.createRoom({
      name: 'Arena retry',
      smallBlind: 1,
      bigBlind: 2,
      minBuyIn: 1,
      maxBuyIn: 2,
      maxPlayers: 6,
      turnTime: 8,
      competitionMode: 'arena-official',
      arenaMatchId: 'match-retry',
      arenaBotVersion: ARENA_CONFIG_V1.botVersion,
      arenaParticipantIds: ['profile-1', 'profile-2'],
    });
    for (let place = 1; place <= 6; place += 1) {
      const player = testHuman(
        place <= 2 ? `profile-${place}` : `bot-${place}`,
        place - 1,
      );
      if (place > 2) player.type = 'bot';
      expect(manager.joinRoom(roomId, player)).toBe(true);
    }
    const tournament = manager.getRoom(roomId)!.engine.state.tournament!;
    tournament.entrants = 6;
    tournament.finished = true;
    tournament.results = [1, 2, 3, 4, 5, 6].map(place => ({
      playerId: place <= 2 ? `profile-${place}` : `bot-${place}`,
      name: `player-${place}`,
      place,
      prize: 0,
    }));

    expect(manager.disposeRoom(roomId)).toBe(false);
    expect(manager.getRoom(roomId)).toBeDefined();
    expect(completeOfficial).toHaveBeenCalledTimes(1);
    expect(completeSng).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1_000);
    expect(completeOfficial).toHaveBeenCalledTimes(2);
    expect(completeOfficial).toHaveBeenLastCalledWith({
      matchId: 'match-retry',
      results: tournament.results.map(({ playerId, place }) => ({
        playerId,
        place,
        type: playerId.startsWith('profile-') ? 'human' : 'bot',
      })),
    });
    await vi.advanceTimersByTimeAsync(10_000);
    expect(completeOfficial).toHaveBeenCalledTimes(2);
    expect(completeSng).not.toHaveBeenCalled();
    manager.shutdown();
    vi.useRealTimers();
  });

  function createRuntime(overrides: {
    clock?: () => number;
    rng?: () => number;
    resolveHuman?: (
      profileId: string,
      socketId: string,
    ) => { name: string; avatar: string } | null;
    onOfficialRoomCreated?: (
      input: {
        matchId: string;
        roomId: string;
        candidate: ArenaOfficialCandidate;
      },
    ) => void;
    onResult?: (profileId: string, result: ArenaResultPayload) => void;
  } = {}): ArenaRuntime {
    return new ArenaRuntime(roomManager, service, {
      clock: overrides.clock ?? (() => EPOCH + 10),
      rng: overrides.rng ?? (() => 0.5),
      onOfficialRoomCreated: overrides.onOfficialRoomCreated,
      onResult: overrides.onResult,
      resolveHuman: overrides.resolveHuman
        ?? (profileId => ({
          name: `alias-${profileId}`,
          avatar: profileId === 'profile-a' ? 'sakura' : 'hana',
        })),
    });
  }
});

function candidate(profileIds: readonly string[]): ArenaOfficialCandidate {
  return {
    candidateId: 'candidate-a',
    botCount: ARENA_CONFIG_V1.seats - profileIds.length,
    entries: profileIds.map((profileId, index) => ({
      profileId,
      socketId: `socket-${index}`,
      mmr: 1_000,
      joinedAt: EPOCH,
    })),
  };
}

function officialResults(
  firstProfileId: string,
  secondProfileId: string,
): Array<{ playerId: string; place: number; type: Player['type'] }> {
  return [
    { playerId: firstProfileId, place: 1, type: 'human' },
    { playerId: secondProfileId, place: 2, type: 'human' },
    ...[3, 4, 5, 6].map(place => ({
      playerId: `bot-${place}`,
      place,
      type: 'bot' as const,
    })),
  ];
}

function seedPlacedWeeklyGroup(
  repository: ArenaRepository,
  members: readonly (readonly [profileId: string, points: number])[],
): void {
  const weekKey = getArenaKstWeekKey(EPOCH);
  for (const [profileId] of members) {
    for (let games = 1; games <= 5; games += 1) {
      const profile = repository.requireProfile('arena-v1-0', profileId);
      repository.transaction(tx => tx.updateProfile({
        ...profile,
        placementGames: games,
        placementPoints: profile.placementPoints + 35,
        tier: games === 5 ? 'silver' : null,
      }));
    }
  }
  repository.transaction(tx => {
    tx.insertGroup({
      id: 'group-rank',
      seasonId: 'arena-v1-0',
      weekKey,
      tier: 'silver',
      status: 'open',
      createdAt: EPOCH,
      settledAt: null,
    });
    for (const [profileId, points] of members) {
      tx.insertGroupMember({
        groupId: 'group-rank',
        seasonId: 'arena-v1-0',
        weekKey,
        profileId,
        points,
        wins: 0,
        top3: 1,
        placeSum: 2,
        matches: 1,
        scoreReachedAt: EPOCH,
        joinedAt: EPOCH,
        updatedAt: EPOCH,
      });
    }
  });
}

function insertBaseProfile(database: PokerDatabase, profileId: string): void {
  database.db.prepare(`
    INSERT INTO profiles (
      id, credential_hash, credential_lookup, recovery_hash, recovery_lookup,
      alias, avatar_id, adult_confirmed_at, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, 'sakura', 1, 1, 1)
  `).run(
    profileId,
    `ch-${profileId}`,
    `cl-${profileId}`,
    `rh-${profileId}`,
    `rl-${profileId}`,
    `alias-${profileId}`,
  );
}

function setMmr(
  repository: ArenaRepository,
  profileId: string,
  mmr: number,
): void {
  const profile = repository.requireProfile('arena-v1-0', profileId);
  repository.transaction(tx => tx.updateProfile({
    ...profile,
    mmr,
  }));
}

function testHuman(id: string, seatIndex: number): Player {
  return {
    id,
    name: id,
    type: 'human',
    avatar: 'sakura',
    chips: ARENA_CONFIG_V1.startingStack,
    seatIndex,
    holeCards: [],
    currentBet: 0,
    totalContributed: 0,
    status: 'waiting',
    hasActed: false,
    timeBankChips: 1,
  };
}
