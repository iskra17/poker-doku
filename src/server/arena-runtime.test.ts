import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ARENA_CONFIG_V1 } from '@/lib/arena/config';
import { SNG_BLIND_SCHEDULE } from '@/lib/poker/blind-schedule';
import {
  ArenaMatchmaker,
  type ArenaOfficialCandidate,
} from './arena-matchmaker';
import { ArenaRepository } from './arena-repository';
import { ArenaRuntime } from './arena-runtime';
import { ArenaService } from './arena-service';
import { openPokerDatabase, type PokerDatabase } from './persistence/database';
import { RoomManager } from './room-manager';

const EPOCH = Date.parse('2026-07-20T00:00:00+09:00');

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
    });
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
      })),
    });
    await vi.advanceTimersByTimeAsync(10_000);
    expect(completeOfficial).toHaveBeenCalledTimes(2);
    expect(completeSng).not.toHaveBeenCalled();
    manager.shutdown();
    vi.useRealTimers();
  });

  function createRuntime(overrides: {
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
  } = {}): ArenaRuntime {
    return new ArenaRuntime(roomManager, service, {
      clock: () => EPOCH + 10,
      rng: overrides.rng ?? (() => 0.5),
      onOfficialRoomCreated: overrides.onOfficialRoomCreated,
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
