import { ARENA_CONFIG_V1 } from '@/lib/arena/config';
import { createBot } from '@/lib/bot/bot-manager';
import { SNG_BLIND_SCHEDULE } from '@/lib/poker/blind-schedule';
import type { Player, RoomConfig } from '@/lib/poker/types';
import type { ArenaResultPayload } from '@/lib/realtime/protocol';
import type {
  ArenaOfficialCandidate,
  ArenaReservation,
} from './arena-matchmaker';
import type { RoomManager } from './room-manager';
import type { ArenaService } from './arena-service';

export interface ArenaHumanIdentity {
  readonly name: string;
  readonly avatar: string;
}

export interface ArenaRuntimeOptions {
  readonly resolveHuman: (
    profileId: string,
    socketId: string,
  ) => ArenaHumanIdentity | null;
  readonly onOfficialRoomCreated?: (
    input: {
      matchId: string;
      roomId: string;
      candidate: ArenaOfficialCandidate;
    },
  ) => void;
  readonly onResult?: (
    profileId: string,
    result: ArenaResultPayload,
  ) => void;
  readonly clock?: () => number;
  readonly rng?: () => number;
}

type ArenaSeat =
  | {
      readonly type: 'human';
      readonly profileId: string;
      readonly identity: ArenaHumanIdentity;
    }
  | { readonly type: 'bot' };

export class ArenaRuntime {
  readonly #roomManager: RoomManager;
  readonly #service: ArenaService;
  readonly #resolveHuman: ArenaRuntimeOptions['resolveHuman'];
  readonly #onOfficialRoomCreated:
    ArenaRuntimeOptions['onOfficialRoomCreated'];
  readonly #onResult: ArenaRuntimeOptions['onResult'];
  readonly #clock: () => number;
  readonly #rng: () => number;
  readonly #roomsByMatch = new Map<string, string>();
  readonly #resultsByMatch = new Map<
    string,
    Map<string, ArenaResultPayload>
  >();
  #trainingSequence = 0;

  constructor(
    roomManager: RoomManager,
    service: ArenaService,
    options: ArenaRuntimeOptions,
  ) {
    this.#roomManager = roomManager;
    this.#service = service;
    this.#resolveHuman = options.resolveHuman;
    this.#onOfficialRoomCreated = options.onOfficialRoomCreated;
    this.#onResult = options.onResult;
    this.#clock = options.clock ?? Date.now;
    this.#rng = options.rng ?? Math.random;
  }

  getRoomId(matchId: string): string | null {
    return this.#roomsByMatch.get(matchId) ?? null;
  }

  getResult(
    matchId: string,
    profileId: string,
  ): ArenaResultPayload | null {
    const result = this.#resultsByMatch.get(matchId)?.get(profileId);
    return result ? { ...result } : null;
  }

  handleRoomDisposed(matchId: string, roomId: string): void {
    if (this.#roomsByMatch.get(matchId) === roomId) {
      this.#roomsByMatch.delete(matchId);
      this.#resultsByMatch.delete(matchId);
    }
  }

  async createOfficialRoom(
    reservation: ArenaReservation,
    candidate: ArenaOfficialCandidate,
  ): Promise<boolean> {
    if (this.#roomsByMatch.has(reservation.matchId)) return false;
    const reserved = this.#service.getReservedMatch(reservation.matchId);
    const profileIds = candidate.entries.map(entry => entry.profileId);
    if (
      reserved.match.status !== 'forming'
      || reserved.match.configVersion !== ARENA_CONFIG_V1.version
      || reserved.match.botVersion !== ARENA_CONFIG_V1.botVersion
      || reserved.match.botCount !== candidate.botCount
      || !sameIdentifiers(
        profileIds,
        reserved.entries.map(entry => entry.profileId),
      )
    ) return false;

    const humanSeats: ArenaSeat[] = [];
    for (const entry of candidate.entries) {
      const identity = this.#resolveHuman(entry.profileId, entry.socketId);
      if (!identity || !validIdentity(identity)) return false;
      humanSeats.push({
        type: 'human',
        profileId: entry.profileId,
        identity,
      });
    }
    const seats = shuffle([
      ...humanSeats,
      ...Array.from(
        { length: reserved.match.botCount },
        (): ArenaSeat => ({ type: 'bot' }),
      ),
    ], this.#rng);
    const created = this.#createRoom(
      reservation.matchId,
      'arena-official',
      seats,
      () => this.#service.markMatchPlaying(
        reservation.matchId,
        this.#clock(),
      ),
    );
    if (!created) return false;
    const roomId = this.#roomsByMatch.get(reservation.matchId);
    if (!roomId) return false;
    try {
      this.#onOfficialRoomCreated?.({
        matchId: reservation.matchId,
        roomId,
        candidate,
      });
      return true;
    } catch {
      this.#disposeTrackedRoom(reservation.matchId);
      return false;
    }
  }

  async rollbackOfficialRoom(
    reservation: ArenaReservation,
    candidate?: ArenaOfficialCandidate,
  ): Promise<void> {
    void candidate;
    this.#disposeTrackedRoom(reservation.matchId);
  }

  async createTrainingRoom(
    profileId: string,
    socketId: string,
  ): Promise<ArenaReservation | null> {
    const identity = this.#resolveHuman(profileId, socketId);
    if (!identity || !validIdentity(identity)) return null;
    const matchId = [
      'arena-training',
      this.#clock(),
      ++this.#trainingSequence,
    ].join('-');
    const seats = shuffle([
      { type: 'human', profileId, identity } satisfies ArenaSeat,
      ...Array.from(
        { length: ARENA_CONFIG_V1.seats - 1 },
        (): ArenaSeat => ({ type: 'bot' }),
      ),
    ], this.#rng);
    const created = this.#createRoom(
      matchId,
      'arena-training',
      seats,
      () => undefined,
    );
    return created ? { matchId } : null;
  }

  async rollbackTrainingRoom(
    _profileId: string,
    _socketId: string,
    _offerId: string,
    result: ArenaReservation | null,
  ): Promise<void> {
    if (result) this.#disposeTrackedRoom(result.matchId);
  }

  recoverUnfinishedMatches(at = this.#clock()): string[] {
    return this.#service.recoverUnfinishedMatches(at);
  }

  completeOfficial(input: {
    matchId: string;
    results: readonly {
      playerId: string;
      place: number;
      type: Player['type'];
    }[];
  }) {
    const at = this.#clock();
    const summary = this.#service.settleOfficialMatch(
      input.matchId,
      input.results,
      at,
    );
    for (const result of summary.results) {
      try {
        const current = this.#service.getPublicResultViewForMatch(
          summary.matchId,
          result.profileId,
        );
        this.#emitResult(result.profileId, {
          resultId: `${summary.matchId}:${result.profileId}`,
          matchId: summary.matchId,
          training: false,
          place: result.place,
          points: result.points,
          weeklyRankBefore: current.weeklyRankBefore,
          weeklyRankAfter: current.weeklyRankAfter,
          placementGames: current.placementGames,
          placementMatches: current.placementMatches,
          tier: current.tier,
        });
      } catch {
        // Durable settlement succeeded. Reconnect can retry public projection.
      }
    }
    return summary;
  }

  completeTraining(input: {
    matchId: string;
    results: readonly {
      playerId: string;
      place: number;
      type: Player['type'];
    }[];
  }): void {
    for (const result of input.results) {
      if (result.type !== 'human') continue;
      const current = this.#service.getPublicResultView(
        result.playerId,
        this.#clock(),
      );
      this.#emitResult(result.playerId, {
        resultId: `${input.matchId}:${result.playerId}`,
        matchId: input.matchId,
        training: true,
        place: result.place,
        points: 0,
        weeklyRankBefore: current.weeklyRank,
        weeklyRankAfter: current.weeklyRank,
        placementGames: current.placementGames,
        placementMatches: current.placementMatches,
        tier: current.tier,
      });
    }
  }

  #emitResult(profileId: string, result: ArenaResultPayload): void {
    let results = this.#resultsByMatch.get(result.matchId);
    if (!results) {
      results = new Map();
      this.#resultsByMatch.set(result.matchId, results);
    }
    results.set(profileId, { ...result });
    try {
      this.#onResult?.(profileId, result);
    } catch {
      // Settlement is durable; clients recover their public snapshot later.
    }
  }

  #createRoom(
    matchId: string,
    competitionMode: NonNullable<RoomConfig['competitionMode']>,
    seats: readonly ArenaSeat[],
    commit: () => unknown,
  ): boolean {
    if (seats.length !== ARENA_CONFIG_V1.seats) return false;
    let roomId: string | null = null;
    try {
      roomId = this.#roomManager.createRoom({
        name: competitionMode === 'arena-official'
          ? '포커 아레나 공식전'
          : '포커 아레나 연습전',
        smallBlind: SNG_BLIND_SCHEDULE[0].smallBlind,
        bigBlind: SNG_BLIND_SCHEDULE[0].bigBlind,
        minBuyIn: ARENA_CONFIG_V1.startingStack,
        maxBuyIn: ARENA_CONFIG_V1.startingStack,
        maxPlayers: 6,
        economyMode: 'arena',
        turnTime: 8,
        gameMode: 'sng',
        startingStack: ARENA_CONFIG_V1.startingStack,
        difficulty: 'hard',
        botCount: seats.filter(seat => seat.type === 'bot').length,
        tableType: 'mixed',
        competitionMode,
        arenaMatchId: matchId,
        arenaBotVersion: ARENA_CONFIG_V1.botVersion,
        arenaParticipantIds: seats
          .filter((seat): seat is Extract<ArenaSeat, { type: 'human' }> => (
            seat.type === 'human'
          ))
          .map(seat => seat.profileId),
      });
      const usedCharacters = seats
        .filter((seat): seat is Extract<ArenaSeat, { type: 'human' }> => (
          seat.type === 'human'
        ))
        .map(seat => seat.identity.avatar);
      for (let seatIndex = 0; seatIndex < seats.length; seatIndex += 1) {
        const seat = seats[seatIndex];
        const player = seat.type === 'human'
          ? createHumanPlayer(seat, seatIndex)
          : createBot(
            seatIndex,
            ARENA_CONFIG_V1.startingStack,
            usedCharacters,
            'hard',
          );
        if (!this.#roomManager.joinRoom(roomId, player)) {
          throw new Error('ARENA_ROOM_SEAT_FAILED');
        }
        if (player.type === 'bot' && player.personalityId) {
          usedCharacters.push(player.personalityId);
        }
      }
      commit();
      this.#roomsByMatch.set(matchId, roomId);
      return true;
    } catch {
      if (roomId) {
        this.#roomManager.disposeRoom(roomId, 'arena-rollback', false);
      }
      return false;
    }
  }

  #disposeTrackedRoom(matchId: string): void {
    const roomId = this.#roomsByMatch.get(matchId);
    if (!roomId) return;
    if (!this.#roomManager.getRoom(roomId)) {
      this.handleRoomDisposed(matchId, roomId);
      return;
    }
    if (!this.#roomManager.disposeRoom(roomId, 'arena-rollback')) {
      throw new Error('ARENA_ROOM_ROLLBACK_FAILED');
    }
    this.handleRoomDisposed(matchId, roomId);
  }
}

function createHumanPlayer(
  seat: Extract<ArenaSeat, { type: 'human' }>,
  seatIndex: number,
): Player {
  return {
    id: seat.profileId,
    name: seat.identity.name,
    type: 'human',
    avatar: seat.identity.avatar,
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

function shuffle<T>(values: readonly T[], rng: () => number): T[] {
  const shuffled = [...values];
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const roll = rng();
    if (!Number.isFinite(roll) || roll < 0 || roll >= 1) {
      throw new Error('ARENA_RNG_INVALID');
    }
    const otherIndex = Math.floor(roll * (index + 1));
    [shuffled[index], shuffled[otherIndex]] = [
      shuffled[otherIndex],
      shuffled[index],
    ];
  }
  return shuffled;
}

function sameIdentifiers(
  left: readonly string[],
  right: readonly string[],
): boolean {
  if (left.length !== right.length) return false;
  const leftSet = new Set(left);
  return leftSet.size === left.length
    && right.every(identifier => leftSet.has(identifier));
}

function validIdentity(identity: ArenaHumanIdentity): boolean {
  return identity.name.length > 0 && identity.avatar.length > 0;
}
