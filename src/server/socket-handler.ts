import { Server, Socket } from 'socket.io';
import { randomUUID } from 'node:crypto';
import { RoomManager, type RoomHandHistoryHooks } from './room-manager';
import { SessionManager, GRACE_MS, type Session } from './session-manager';
import { RoomConfig, Player, ActionType, RoomDifficulty, TableType } from '../lib/poker/types';
import { CHAT_PRESET_MAP } from '../lib/chat/presets';
import { THROWABLE_MAP, THROW_COOLDOWN_MS } from '../lib/throwables/catalog';
import { SNG_BLIND_SCHEDULE, SNG_STARTING_STACK } from '../lib/poker/blind-schedule';
import { clientAddressFromHeaders } from './client-address';
import { eventLog, tokenHint } from './event-log';
import type {
  ArenaQueueMetrics,
  ArenaRoomMetrics,
} from './arena-metrics';
import type {
  AckCallback,
  ClientToServerEvents,
  ServerToClientEvents,
} from '../lib/realtime/protocol';
import {
  isRecord,
  parseCreateRoomRequest,
  parseJoinRoomRequest,
  parseLeaveRoomRequest,
  parsePlayerActionRequest,
} from './socket-payload';
import { SOCKET_RATE_LIMITS, SocketRateLimiter } from './socket-rate-limit';
import {
  parseOptionalPayloadArgs,
  parsePayloadlessArgs,
  parseRequiredPayloadArgs,
} from './socket-arguments';
import type { PublicProfile } from '../lib/profile/types';
import type {
  TransientHttpConcurrencyGate,
  TransientHttpRateLimiter,
} from './http-rate-limit';
import { readProfileCredentialCookie } from './profile-http';
import { EconomyDomainError } from './economy-repository';
import type {
  CashAdmissionEconomy,
  RoomEconomyHooks,
  SngAdmissionEconomy,
} from './economy-runtime';
import { ECONOMY_RULES } from './economy-service';
import {
  ProgressionRuntime,
  type ProgressionRuntimeService,
} from './progression-runtime';
import { buildPublicCosmetics } from '../lib/collection/public-cosmetics';
import {
  ArenaMatchmaker,
  type ArenaMatchmakerCloseReport,
} from './arena-matchmaker';
import { ArenaRuntime } from './arena-runtime';
import type { ArenaService } from './arena-service';

const VALID_DIFFICULTIES: RoomDifficulty[] = ['easy', 'normal', 'hard'];
const VALID_TABLE_TYPES: TableType[] = ['bots', 'mixed', 'humans'];
const MAX_ROOMS = 30; // 운영 가드: 동시 존재 가능한 방 수 상한
const MIN_BUYIN_BB = 40; // 캐시 게임 바이인 하한 (BB 배수)
const MAX_BUYIN_BB = 200; // 캐시 게임 바이인 상한 (BB 배수)

export interface SocketRuntimeOptions {
  profileAuth: {
    manager: {
      authenticateCredential(credential: string): Promise<PublicProfile | null>;
      isCredentialCurrent(profileId: string, credential: string): boolean;
    };
    rateLimiter: Pick<TransientHttpRateLimiter, 'allow'>;
    concurrencyGate: Pick<TransientHttpConcurrencyGate, 'run'>;
  };
  createDefaultRooms?: boolean;
  sweepIntervalMs?: number;
  graceMs?: number;
  sngRetentionMs?: number;
  /** 인증된 소켓 접속 시 호출 — 프로필 활동 지표(접속 횟수/마지막 활동) 기록용. 실패는 무시 */
  onProfileConnected?: (profileId: string) => void;
  economy?: CashAdmissionEconomy & SngAdmissionEconomy & RoomEconomyHooks;
  progressionService?: ProgressionRuntimeService;
  handHistory?: RoomHandHistoryHooks;
  arena?: {
    service: ArenaService;
    matchIdFactory?: () => string;
    metrics?: ArenaQueueMetrics & ArenaRoomMetrics;
  };
}

export interface SocketRuntime {
  roomManager: RoomManager;
  sessions: SessionManager;
  revokeProfile: (profileId: string) => void;
  refreshPublicCosmetics: (
    profileId: string,
    snapshot: import('../lib/progression/types').ProgressionSnapshot,
  ) => boolean;
  /** 프로필 아바타 변경 전파 — 라이브 소켓의 인증 스냅샷과 앉아 있는 좌석 아바타를 함께 갱신 */
  refreshAvatar: (profileId: string, avatarId: string) => void;
  startArena: () => void;
  close: () => Promise<ArenaMatchmakerCloseReport>;
}

export interface AuthenticatedSocketData {
  profileId?: string;
  profileAlias?: string;
  profileAvatarId?: string;
  hadTransportToken?: boolean;
  transportTokenHint?: string;
}

type PokerSocket = Socket<
  ClientToServerEvents,
  ServerToClientEvents,
  Record<string, never>,
  AuthenticatedSocketData
>;

type PokerServer = Server<
  ClientToServerEvents,
  ServerToClientEvents,
  Record<string, never>,
  AuthenticatedSocketData
>;

interface SafeTransportMetadata {
  hadTransportToken: boolean;
  transportTokenHint: string;
}

function consumeTransportMetadata(auth: unknown): SafeTransportMetadata | null {
  if (!auth || typeof auth !== 'object') {
    return { hadTransportToken: false, transportTokenHint: 'none' };
  }
  const record = auth as Record<string, unknown>;
  try {
    const value = record.sessionToken;
    const rawToken = typeof value === 'string' && value.length > 0
      ? value
      : undefined;
    delete record.sessionToken;
    if ('sessionToken' in record) return null;
    return {
      hadTransportToken: rawToken !== undefined,
      transportTokenHint: tokenHint(rawToken),
    };
  } catch {
    return null;
  }
}

export function setupSocketHandlers(
  io: PokerServer,
  options: SocketRuntimeOptions,
): SocketRuntime {
  const {
    profileAuth,
    createDefaultRooms = true,
    sweepIntervalMs = 60_000,
    graceMs = GRACE_MS,
    sngRetentionMs,
    economy,
    progressionService,
    handHistory,
    arena,
  } = options;
  const sessions = new SessionManager();
  // 투척 개인 쿨다운 — playerId 키의 공유 인스턴스라 재접속/탭 교체로 우회 불가.
  // (소켓별 rateLimiter는 커넥션 수명이라 쿨다운 저장소로 부적합)
  const throwCooldowns = new SocketRateLimiter();
  let arenaRuntime: ArenaRuntime | undefined;
  let arenaMatchmaker: ArenaMatchmaker | undefined;
  const progression = progressionService
    ? new ProgressionRuntime(
      progressionService,
      (profileId, snapshot, summary) => {
        // RoomManager가 같은 동기 스택에서 game-update를 먼저 emit하게 양보한다.
        // 따라서 클라이언트 summary coordinator가 economy 카드 유무를 확정한 뒤
        // progression reward를 받으며, practice처럼 카드가 없으면 즉시 표시된다.
        queueMicrotask(() => {
          const session = sessions.getByPlayerId(profileId);
          if (!session?.socketId) return;
          const target = io.sockets.sockets.get(session.socketId);
          if (!target) return;
          target.emit('progression-update', snapshot);
          target.emit('reward-summary', summary);
        });
      },
    )
    : undefined;

  io.use((socket, next) => {
    const transportMetadata = consumeTransportMetadata(socket.handshake.auth);
    if (!transportMetadata) {
      next(new Error('profile-required'));
      return;
    }
    const credential = readProfileCredentialCookie(socket.handshake.headers.cookie);
    if (!credential) {
      next(new Error('profile-required'));
      return;
    }
    const address = clientAddressFromHeaders(
      socket.handshake.headers,
      socket.conn.remoteAddress,
    );
    let allowed = false;
    try {
      allowed = profileAuth.rateLimiter.allow('profileAuth', address);
    } catch {
      next(new Error('profile-required'));
      return;
    }
    if (!allowed) {
      next(new Error('profile-required'));
      return;
    }
    void profileAuth.concurrencyGate.run(
      () => profileAuth.manager.authenticateCredential(credential),
    ).then(profile => {
      let current = false;
      try {
        current = !!profile && profileAuth.manager.isCredentialCurrent(
          profile.id,
          credential,
        );
      } catch {
        next(new Error('profile-required'));
        return;
      }
      if (!profile || !current) {
        next(new Error('profile-required'));
        return;
      }
      socket.data.profileId = profile.id;
      socket.data.profileAlias = profile.alias;
      socket.data.profileAvatarId = profile.avatarId;
      socket.data.hadTransportToken = transportMetadata.hadTransportToken;
      socket.data.transportTokenHint = transportMetadata.transportTokenHint;
      const rawHeaders = socket.request.rawHeaders;
      for (let index = rawHeaders.length - 2; index >= 0; index -= 2) {
        if (rawHeaders[index].toLowerCase() === 'cookie') {
          rawHeaders.splice(index, 2);
        }
      }
      delete socket.handshake.headers.cookie;
      delete socket.request.headers.cookie;
      // Final indexed credential check -> safe fields -> next has no await gap.
      next();
    },
      () => next(new Error('profile-required')),
    );
  });

  // 방 목록은 소켓별로 개인화해 보낸다 — 보존 중인 내 좌석(mySeat)이 실려야
  // 로비에서 바이인/비밀번호 없이 '게임 복귀'가 가능하다.
  function broadcastRoomList(): void {
    for (const [socketId, sock] of io.sockets.sockets) {
      sock.emit('room-list', roomManager.getRoomList(sessions.getBySocketId(socketId)?.playerId));
    }
  }

  const roomManager = new RoomManager(
    // onUpdate
    (roomId, engine) => {
      const turnTimeRemaining = roomManager.getTurnTimeRemaining(roomId);
      const players = engine.state.players;
      for (const player of players) {
        if (player.type === 'human') {
          const targetSession = sessions.getByPlayerId(player.id);
          if (!targetSession?.socketId || targetSession.roomId !== roomId) continue;
          const socket = io.sockets.sockets.get(targetSession.socketId);
          if (socket) {
            socket.emit('game-update', {
              roomId,
              state: {
                ...engine.getPublicState(player.id),
                turnTimeRemaining,
              },
            });
          }
        }
      }
      // Also broadcast to spectators / general room
      io.to(roomId).emit('game-update-public', {
        roomId,
        state: {
          ...engine.getPublicState(),
          turnTimeRemaining,
        },
      });
    },
    // onChat
    (roomId, message) => {
      io.to(roomId).emit('chat-message', message);
    },
    // onRoomsChanged — 서버 내부 자동 정리(미납 블라인드/방치 회수)도 로비에 즉시 반영
    () => broadcastRoomList(),
    {
      sngRetentionMs,
      economy,
      progression,
      handHistory,
      ...(arena
        ? {
          arena: {
            completeOfficial: (input: {
              matchId: string;
              results: readonly {
                playerId: string;
                place: number;
                type: Player['type'];
              }[];
            }) => {
              if (!arenaRuntime) throw new Error('Arena runtime is unavailable');
              return arenaRuntime.completeOfficial(input);
            },
            completeTraining: input => {
              if (!arenaRuntime) throw new Error('Arena runtime is unavailable');
              arenaRuntime.completeTraining(input);
            },
          },
        }
        : {}),
      // 서버 타이머(파산 리바이 유예·자리비움 방치·미납 BB)·나가기 예약 좌석 회수 —
      // 접속한 채 방에 남아 있는 클라이언트를 room-lost로 로비에 돌려보낸다
      onSeatReclaimed: (roomId, playerId, message) => {
        const targetSession = sessions.getByPlayerId(playerId);
        if (!targetSession || targetSession.roomId !== roomId) return;
        targetSession.roomId = null;
        const targetSocket = targetSession.socketId
          ? io.sockets.sockets.get(targetSession.socketId)
          : undefined;
        if (targetSocket) {
          targetSocket.leave(roomId);
          targetSocket.emit('room-lost', {
            message: message ?? '자리가 정리되어 로비로 돌아왔어요. 다시 입장할 수 있어요.',
          });
        }
        sessions.releaseIfIdle(targetSession);
      },
      onRoomDisposed: (roomId, playerIds, reason, arenaMatchId) => {
        if (arenaMatchId) {
          arenaRuntime?.handleRoomDisposed(arenaMatchId, roomId);
        }
        for (const playerId of playerIds) {
          const session = sessions.getByPlayerId(playerId);
          if (!session || session.roomId !== roomId) continue;
          const socket = session.socketId
            ? io.sockets.sockets.get(session.socketId)
            : undefined;
          socket?.leave(roomId);
          if (reason === 'sng-expired') {
            socket?.emit('room-lost', {
              message: '종료된 Sit & Go 보존 시간이 끝나 로비로 돌아왔어요.',
            });
          }
          session.roomId = null;
          sessions.releaseIfIdle(session);
        }
      },
    },
  );

  if (arena) {
    arenaRuntime = new ArenaRuntime(roomManager, arena.service, {
      resolveHuman: (profileId, socketId) => {
        const socket = io.sockets.sockets.get(socketId);
        const session = sessions.getBySocketId(socketId);
        if (
          !socket
          || !session
          || session.playerId !== profileId
          || socket.data.profileId !== profileId
          || !socket.data.profileAlias
          || !socket.data.profileAvatarId
        ) return null;
        return {
          name: socket.data.profileAlias,
          avatar: socket.data.profileAvatarId,
        };
      },
      onOfficialRoomCreated: ({ roomId, candidate }) => {
        for (const entry of candidate.entries) {
          const session = sessions.getByPlayerId(entry.profileId);
          const socket = io.sockets.sockets.get(entry.socketId);
          if (
            !session
            || session.socketId !== entry.socketId
            || !socket
            || (session.roomId !== null && session.roomId !== roomId)
          ) {
            throw new Error('Arena session binding is unavailable');
          }
          session.roomId = roomId;
          socket.join(roomId);
        }
      },
      onResult: (profileId, result) => {
        const session = sessions.getByPlayerId(profileId);
        if (!session?.socketId) return;
        io.sockets.sockets.get(session.socketId)?.emit('arena-result', result);
      },
      metrics: arena.metrics,
    });
    arenaMatchmaker = new ArenaMatchmaker({
      metrics: arena.metrics,
      reserveOfficial: async (candidate, isCandidateValid) => {
        if (!isCandidateValid()) return null;
        const at = Date.now();
        const seasonId = arena.service.getMatchmakingProfile(
          candidate.entries[0].profileId,
          at,
        ).seasonId;
        if (!isCandidateValid()) return null;
        const match = arena.service.reserveMatchTickets(
          arena.matchIdFactory?.() ?? `arena-${randomUUID()}`,
          candidate.entries.map(entry => entry.profileId),
          at,
          seasonId,
        );
        return { matchId: match.id };
      },
      createOfficialRoom: (reservation, candidate) =>
        arenaRuntime!.createOfficialRoom(reservation, candidate),
      rollbackOfficialRoom: (reservation, candidate) =>
        arenaRuntime!.rollbackOfficialRoom(reservation, candidate),
      voidOfficial: async matchId => {
        arena.service.voidMatch(matchId);
      },
      createTrainingRoom: (profileId, socketId) =>
        arenaRuntime!.createTrainingRoom(profileId, socketId),
      rollbackTrainingRoom: (
        profileId,
        socketId,
        offerId,
        result,
      ) => arenaRuntime!.rollbackTrainingRoom(
        profileId,
        socketId,
        offerId,
        result,
      ),
    });
  }

  arenaMatchmaker?.setEventHandlers({
    onQueueState: (socketId, state) => {
      io.sockets.sockets.get(socketId)?.emit('arena-queue-update', state);
    },
    onTrainingOffered: (socketId, offer) => {
      io.sockets.sockets.get(socketId)?.emit('arena-training-offered', offer);
    },
    onMatchFound: (socketId, matchId) => {
      const socket = io.sockets.sockets.get(socketId);
      const session = sessions.getBySocketId(socketId);
      const roomId = arenaRuntime?.getRoomId(matchId);
      const room = roomId ? roomManager.getRoom(roomId) : undefined;
      const seat = room?.engine.state.players.find(player => (
        player.id === session?.playerId && player.type === 'human'
      ));
      if (!socket || !session || !roomId || !room || !seat) return;
      session.roomId = roomId;
      socket.join(roomId);
      socket.emit('arena-match-found', {
        matchId,
        training: room.config.competitionMode === 'arena-training',
      });
      socket.emit('room-joined', {
        roomId,
        gameState: {
          ...room.engine.getPublicState(session.playerId),
          turnTimeRemaining: roomManager.getTurnTimeRemaining(roomId),
        },
        chatHistory: roomManager.getChatHistory(roomId),
      });
    },
  });

  // Create default rooms — persistent: 유휴 정리 대상에서 제외. 바이인 범위는 40~200BB 표준
  // 봇 전용 연습 방: 휴먼 1명 제한 — 다른 사람 방해 없이 봇들과 연습 (도장의 입구)
  if (createDefaultRooms) {
    roomManager.createRoom({
      name: 'Practice Dojo',
      smallBlind: 10,
      bigBlind: 20,
      minBuyIn: 20 * MIN_BUYIN_BB,
      maxBuyIn: 20 * MAX_BUYIN_BB,
      maxPlayers: 6,
      turnTime: 20,
      difficulty: 'easy',
      botCount: 5,
      tableType: 'bots',
      economyMode: 'practice',
    }, true);

    // 초보 방: 순한 봇 + 여유 턴 시간 (난이도 사다리의 입구)
    roomManager.createRoom({
      name: 'Sakura Lounge',
      smallBlind: 10,
      bigBlind: 20,
      minBuyIn: 20 * MIN_BUYIN_BB,
      maxBuyIn: 20 * MAX_BUYIN_BB,
      maxPlayers: 6,
      turnTime: 20,
      difficulty: 'easy',
      botCount: 5, // 솔로 쇼케이스 방 — 캐릭터 전원 등장 (휴먼이 오면 봇이 양보)
      tableType: 'mixed',
      economyMode: 'wallet',
    }, true);

    roomManager.createRoom({
      name: "Dragon's Den",
      smallBlind: 25,
      bigBlind: 50,
      minBuyIn: 50 * MIN_BUYIN_BB,
      maxBuyIn: 50 * MAX_BUYIN_BB,
      maxPlayers: 6,
      turnTime: 8,
      difficulty: 'normal',
      botCount: 5,
      tableType: 'mixed',
      economyMode: 'wallet',
    }, true);

    roomManager.createRoom({
      name: 'Moonlight Table',
      smallBlind: 50,
      bigBlind: 100,
      minBuyIn: 100 * MIN_BUYIN_BB,
      maxBuyIn: 100 * MAX_BUYIN_BB,
      maxPlayers: 6,
      turnTime: 8,
      difficulty: 'hard',
      botCount: 5,
      tableType: 'mixed',
      economyMode: 'wallet',
    }, true);
  }

  // 유저 생성 방 유휴 정리: 휴먼이 없는 방을 10분 후 삭제 (기본 방 제외)
  const sweepTimer = sweepIntervalMs > 0
    ? setInterval(() => {
        roomManager.sweepIdleRooms();
      }, sweepIntervalMs)
    : null;

  /** 방의 좌석 구성 스냅샷 — 중복 좌석/유령 좌석 역추적의 핵심 단서 */
  function seatSnapshot(roomId: string): Array<Record<string, unknown>> {
    const room = roomManager.getRoom(roomId);
    if (!room) return [];
    return room.engine.state.players.map(p => ({
      id: p.id,
      name: p.name,
      type: p.type,
      seat: p.seatIndex,
      chips: p.chips,
      status: p.status,
      ...(p.pendingRemoval ? { pendingRemoval: true } : {}),
      ...(p.isDisconnected ? { disconnected: true } : {}),
      ...(p.sitOutNext ? { sitOutNext: true } : {}),
    }));
  }

  function startDisconnectedGrace(session: Session): void {
    if (!session.roomId) {
      sessions.releaseIfIdle(session);
      return;
    }
    const roomId = session.roomId;
    // grace 만료로 좌석이 제거되는 경우 클라이언트가 회수 카운트다운 타임바를 그릴 수 있게 만료 시각 전달
    roomManager.handleDisconnect(roomId, session.playerId, Date.now() + graceMs);
    sessions.startGrace(session, graceMs, () => {
      const seatKept = roomManager.handleGraceExpired(roomId, session.playerId);
      eventLog.log('grace-expired', {
        roomId,
        playerId: session.playerId,
        data: { seatKept, seats: seatSnapshot(roomId) },
      });
      if (!seatKept) {
        session.roomId = null;
        sessions.releaseIfIdle(session);
      }
      broadcastRoomList();
    });
  }

  io.on('connection', (socket: PokerSocket) => {
    const profileId = socket.data.profileId;
    const profileAlias = socket.data.profileAlias;
    const profileAvatarId = socket.data.profileAvatarId;
    if (!profileId || !profileAlias || !profileAvatarId) {
      socket.disconnect(true);
      return;
    }
    const { session, replacedSocketId } = sessions.resolve(
      undefined,
      socket.id,
      profileId,
    );
    try {
      options.onProfileConnected?.(profileId);
    } catch {
      // 활동 지표 기록 실패가 접속을 막으면 안 된다
    }
    if (replacedSocketId) {
      const previousSocket = io.sockets.sockets.get(replacedSocketId);
      previousSocket?.emit('session-replaced', {
        message: '다른 탭에서 게임을 열어 이 연결을 종료했어요.',
      });
      previousSocket?.disconnect(true);
    }
    console.log(`Player connected: socket=${socket.id} player=${session.playerId}`);
    // 인증 profileId가 세션 재사용의 유일한 기준이다. transport 원문은 middleware에서 폐기되고
    // 프로세스 한정 opaque 진단값만 여기까지 전달된다.
    eventLog.log('connect', {
      playerId: session.playerId,
      data: {
        socketId: socket.id,
        tokenHint: socket.data.transportTokenHint ?? 'none',
        hadToken: socket.data.hadTransportToken ?? false,
        resumedRoomId: session.roomId ?? null,
      },
    });

    const rateLimiter = new SocketRateLimiter();
    const ownsSession = (): boolean => sessions.isCurrentSocket(session.playerId, socket.id);
    const ensureOwnership = <T>(ack?: AckCallback<T>): boolean => {
      if (ownsSession()) return true;
      ack?.({
        ok: false,
        code: 'session-replaced',
        message: '이 연결은 더 이상 현재 게임을 제어하지 않아요.',
      });
      return false;
    };
    const invalidPayload = <T>(ack?: AckCallback<T>): void => {
      ack?.({
        ok: false,
        code: 'invalid-payload',
        message: '요청 형식이 올바르지 않아요.',
      });
    };
    const ensureRateLimit = <T>(
      group: keyof typeof SOCKET_RATE_LIMITS,
      message: string,
      ack?: AckCallback<T>,
    ): boolean => {
      if (rateLimiter.allow(group, SOCKET_RATE_LIMITS[group])) return true;
      ack?.({ ok: false, code: 'rate-limited', message });
      return false;
    };
    const commitRoomMembership = (roomId: string): boolean => {
      const previousRoomId = session.roomId;
      if (previousRoomId && previousRoomId !== roomId) {
        if (!roomManager.leaveRoom(previousRoomId, session.playerId)) return false;
        socket.leave(previousRoomId);
        session.roomId = null;
      }
      if (!roomManager.leaveAllSeatsExcept(session.playerId, roomId)) return false;
      session.roomId = roomId;
      socket.join(roomId);
      return true;
    };

    // 클라이언트에 공개 playerId 통지 (히어로 식별용)
    socket.emit('session', { playerId: session.playerId });

    if (progression) {
      try {
        socket.emit(
          'progression-update',
          progression.getSnapshot(session.playerId, profileAvatarId),
        );
      } catch {
        socket.disconnect(true);
        return;
      }
    }

    // Send room list — 보존 중인 내 좌석(mySeat) 포함 개인화
    socket.emit('room-list', roomManager.getRoomList(session.playerId));

    // 재접속 복원: 세션에 방이 남아 있고 좌석이 유지되어 있으면 그대로 복귀.
    // 방/좌석이 사라졌으면(유휴 정리·grace 만료) room-lost로 클라이언트를 로비로 돌려보낸다.
    const restoreOrEvict = (): void => {
      if (!session.roomId) return;
      const room = roomManager.getRoom(session.roomId);
      const seated = room?.engine.state.players.find(
        p => p.id === session.playerId && !p.pendingRemoval,
      );
      if (room && seated) {
        socket.join(session.roomId);
        roomManager.handleReconnect(session.roomId, session.playerId);
        if (room.config.competitionMode && room.config.arenaMatchId) {
          const matchId = room.config.arenaMatchId;
          const training = room.config.competitionMode === 'arena-training';
          const tournament = room.engine.state.tournament;
          const finished = !!tournament?.finished;
          if (tournament?.finished && arenaRuntime) {
            try {
              const playerTypes = new Map(
                room.engine.state.players.map(player => [player.id, player.type]),
              );
              const results = tournament.results.map(result => {
                const type = playerTypes.get(result.playerId);
                if (!type) throw new Error('Arena result player is unavailable');
                return {
                  playerId: result.playerId,
                  place: result.place,
                  type,
                };
              });
              if (room.config.competitionMode === 'arena-official') {
                arenaRuntime.completeOfficial({
                  matchId,
                  results,
                });
              } else {
                arenaRuntime.completeTraining({
                  matchId,
                  results,
                });
              }
            } catch {
              // The room snapshot still restores; a later lobby load heals public data.
            }
          }
          socket.emit('arena-state-replay', {
            roomId: session.roomId,
            matchId,
            training,
            finished,
            result: finished
              ? arenaRuntime?.getResult(matchId, session.playerId) ?? null
              : null,
          });
        }
        socket.emit('room-joined', {
          roomId: session.roomId,
          gameState: {
            ...room.engine.getPublicState(session.playerId),
            turnTimeRemaining: roomManager.getTurnTimeRemaining(session.roomId),
          },
          chatHistory: roomManager.getChatHistory(session.roomId),
        });
      } else {
        session.roomId = null;
        socket.emit('room-lost', { message: '게임이 종료되어 로비로 돌아왔어요.' });
      }
    };
    restoreOrEvict();
    socket.emit(
      'arena-queue-update',
      arenaMatchmaker?.getPublicState(session.playerId) ?? { status: 'idle' },
    );

    socket.on('arena-queue-join', (...rawArgs: unknown[]) => {
      const args = parsePayloadlessArgs(rawArgs);
      if (!args.ok) {
        invalidPayload(args.ack);
        return;
      }
      const { ack } = args;
      if (!ensureOwnership(ack)) return;
      if (!ensureRateLimit(
        'joinRoom',
        '아레나 참가 요청이 너무 빠릅니다. 잠시 후 다시 시도해 주세요.',
        ack,
      )) return;
      if (!arenaMatchmaker || !arena) {
        ack?.({
          ok: false,
          code: 'arena-disabled',
          message: '현재 포커 아레나를 이용할 수 없습니다.',
        });
        return;
      }
      if (
        session.roomId
        || roomManager.getRoomList(session.playerId)
          .some(room => room.mySeat !== undefined)
      ) {
        ack?.({
          ok: false,
          code: 'arena-ineligible',
          message: '다른 게임 좌석을 먼저 정리해 주세요.',
        });
        return;
      }

      let eligibility: ReturnType<typeof arena.service.getMatchmakingProfile>;
      try {
        eligibility = arena.service.getMatchmakingProfile(session.playerId);
      } catch {
        ack?.({
          ok: false,
          code: 'server-error',
          message: '아레나 참가 자격을 확인하지 못했습니다.',
        });
        return;
      }
      if (eligibility.availableTickets < 1 || eligibility.activeArenaEscrow) {
        ack?.({
          ok: false,
          code: 'arena-ineligible',
          message: eligibility.activeArenaEscrow
            ? '이미 진행 중인 아레나 경기가 있습니다.'
            : '공식 경기 티켓이 부족합니다.',
        });
        return;
      }
      try {
        arenaMatchmaker.join({
          profileId: session.playerId,
          socketId: socket.id,
          mmr: eligibility.mmr,
          joinedAt: Date.now(),
        });
        ack?.({ ok: true });
      } catch {
        ack?.({
          ok: false,
          code: 'arena-busy',
          message: '이미 아레나 대기열 또는 경기 구성에 참여 중입니다.',
        });
      }
    });

    socket.on('arena-queue-leave', (...rawArgs: unknown[]) => {
      const args = parsePayloadlessArgs(rawArgs);
      if (!args.ok) {
        invalidPayload(args.ack);
        return;
      }
      const { ack } = args;
      if (!ensureOwnership(ack)) return;
      if (!ensureRateLimit(
        'roomSync',
        '아레나 요청이 너무 빠릅니다. 잠시 후 다시 시도해 주세요.',
        ack,
      )) return;
      if (!arenaMatchmaker) {
        ack?.({
          ok: false,
          code: 'arena-disabled',
          message: '현재 포커 아레나를 이용할 수 없습니다.',
        });
        return;
      }
      arenaMatchmaker.leave(session.playerId, socket.id);
      ack?.({ ok: true });
    });

    socket.on('arena-training-accept', (...rawArgs: unknown[]) => {
      const args = parseRequiredPayloadArgs<{ matchId: string }>(rawArgs);
      if (!args.ok) {
        invalidPayload(args.ack);
        return;
      }
      const { payload, ack } = args;
      if (!ensureOwnership(ack)) return;
      if (
        !isRecord(payload)
        || Object.keys(payload).length !== 1
        || typeof payload.offerId !== 'string'
        || payload.offerId.length === 0
      ) {
        invalidPayload(ack);
        return;
      }
      if (!ensureRateLimit(
        'roomSync',
        '아레나 요청이 너무 빠릅니다. 잠시 후 다시 시도해 주세요.',
        ack,
      )) return;
      if (!arenaMatchmaker) {
        ack?.({
          ok: false,
          code: 'arena-disabled',
          message: '현재 포커 아레나를 이용할 수 없습니다.',
        });
        return;
      }
      void arenaMatchmaker.acceptTraining(
        session.playerId,
        socket.id,
        payload.offerId,
      ).then(result => {
        if (!result) {
          ack?.({
            ok: false,
            code: 'arena-ineligible',
            message: '훈련 경기 제안이 만료되었거나 유효하지 않습니다.',
          });
          return;
        }
        ack?.({ ok: true, data: { matchId: result.matchId } });
      }).catch(() => {
        ack?.({
          ok: false,
          code: 'server-error',
          message: '훈련 경기를 만들지 못했습니다.',
        });
      });
    });

    socket.on('arena-training-reject', (...rawArgs: unknown[]) => {
      const args = parseRequiredPayloadArgs(rawArgs);
      if (!args.ok) {
        invalidPayload(args.ack);
        return;
      }
      const { payload, ack } = args;
      if (!ensureOwnership(ack)) return;
      if (
        !isRecord(payload)
        || Object.keys(payload).length !== 1
        || typeof payload.offerId !== 'string'
        || payload.offerId.length === 0
      ) {
        invalidPayload(ack);
        return;
      }
      if (!arenaMatchmaker) {
        ack?.({
          ok: false,
          code: 'arena-disabled',
          message: '현재 포커 아레나를 이용할 수 없습니다.',
        });
        return;
      }
      if (!arenaMatchmaker.rejectTraining(
        session.playerId,
        socket.id,
        payload.offerId,
      )) {
        ack?.({
          ok: false,
          code: 'arena-ineligible',
          message: '수련 매치 제안이 만료되었거나 유효하지 않습니다.',
        });
        return;
      }
      ack?.({ ok: true });
    });

    // 클라이언트 주도 재동기화 — 소켓 재연결 직후 방 상태 확인.
    // 서버가 재시작되면 세션이 초기화되어(roomId 없음) room-lost가 응답된다 —
    // 이게 없으면 클라이언트가 죽은 방의 마지막 스냅샷을 든 채 얼어붙는다 (와이프 화면 버그).
    socket.on('resync', (...rawArgs: unknown[]) => {
      const args = parsePayloadlessArgs(rawArgs);
      if (!args.ok) {
        invalidPayload(args.ack);
        return;
      }
      const { ack } = args;
      if (!ensureOwnership(ack)) return;
      if (!ensureRateLimit('roomSync', '동기화 요청이 너무 빠릅니다. 잠시 후 다시 시도해 주세요.', ack)) return;
      if (session.roomId) {
        restoreOrEvict();
      } else {
        // roomId 없음 = 서버 재시작·grace 만료·다른 탭 퇴장 등 여러 원인 — 원인 단정 없이 중립 안내
        socket.emit('room-lost', { message: '게임 세션이 만료되어 로비로 돌아왔어요. 다시 입장해 주세요.' });
      }
      ack?.({ ok: true });
    });

    // Join room
    socket.on('join-room', (...rawArgs: unknown[]) => {
      const args = parseRequiredPayloadArgs<{ roomId: string }>(rawArgs);
      if (!args.ok) {
        invalidPayload(args.ack);
        return;
      }
      const { payload: input, ack } = args;
      if (!ensureOwnership(ack)) return;
      const parsed = parseJoinRoomRequest(input);
      if (!parsed.ok) {
        invalidPayload(ack);
        return;
      }
      if (!ensureRateLimit('joinRoom', '입장 요청이 너무 빠릅니다. 잠시 후 다시 시도해 주세요.', ack)) return;
      if (arenaMatchmaker?.hasBlockingParticipation(session.playerId)) {
        ack?.({
          ok: false,
          code: 'arena-busy',
          message: '아레나 대기열을 먼저 나간 뒤 입장해 주세요.',
        });
        return;
      }
      const data = parsed.value;
      const { roomId, buyIn, seatIndex } = data;
      const playerName = profileAlias;
      // socket.data에서 라이브로 읽는다 — 연결 후 아바타를 변경해도(refreshAvatar) 새 착석에 반영
      const avatar = socket.data.profileAvatarId ?? profileAvatarId;

      const room = roomManager.getRoom(roomId);
      if (!room) {
        eventLog.log('join-room:reject', {
          roomId, playerId: session.playerId, data: { reason: 'room-not-found' },
        });
        ack?.({ ok: false, code: 'room-not-found', message: '방을 찾을 수 없어요.' });
        return;
      }
      if (
        room.config.competitionMode
        && !roomManager.isArenaParticipant(roomId, session.playerId)
      ) {
        eventLog.log('join-room:reject', {
          roomId,
          playerId: session.playerId,
          data: { reason: 'arena-reserved' },
        });
        ack?.({
          ok: false,
          code: 'arena-reserved',
          message: '예약된 아레나 참가자만 입장할 수 있어요.',
        });
        return;
      }

      eventLog.log('join-room:request', {
        roomId,
        playerId: session.playerId,
        data: {
          name: playerName,
          buyIn: Number(buyIn) || 0,
          seatIndex,
          mode: room.config.gameMode ?? 'cash',
          tableType: room.config.tableType ?? 'mixed',
          // 요청 시점의 좌석 구성 — 같은 이름/사람이 두 좌석을 잡는 순간을 여기서 짚을 수 있다
          seats: seatSnapshot(roomId),
        },
      });

      // 캐시 게임 바이인은 방 범위(40~200BB)로 검증/클램프 (신규 입장·리바이 공용)
      const safeBuyIn = Math.min(
        Math.max(Math.floor(Number(buyIn) || room.config.minBuyIn), room.config.minBuyIn),
        room.config.maxBuyIn,
      );
      const walletCash = (room.config.gameMode ?? 'cash') === 'cash'
        && room.config.economyMode === 'wallet';
      const walletSng = room.config.gameMode === 'sng'
        && room.config.economyMode === 'wallet';
      const walletAdmission = walletCash || walletSng;

      let publicCosmetics: Player['publicCosmetics'];
      if (progression) {
        try {
          publicCosmetics = buildPublicCosmetics(
            progression.getSnapshot(session.playerId, avatar),
          );
        } catch {
          eventLog.log('join-room:reject', {
            roomId,
            playerId: session.playerId,
            data: { reason: 'progression-unavailable' },
          });
          ack?.({
            ok: false,
            code: 'server-error',
            message: '저장 연결을 확인 중이에요. 잠시 후 다시 시도해 주세요.',
          });
          return;
        }
      }

      // 멱등/재입장 처리: 같은 playerId가 이미 좌석에 있으면 새 Player를 만들지 않는다.
      // 핸드 중 이탈은 splice 대신 pendingRemoval 마킹만 하므로, 그 좌석을 되살려
      // 동일 id의 Player가 둘 생기는 것(불변식 위반 + 새 스택 리바이 악용)을 막는다.
      let seated = room.engine.state.players.find(p => p.id === session.playerId);
      let retiredWalletSeat = false;
      if (walletCash && seated?.pendingRemoval) {
        if (!economy) {
          ack?.({
            ok: false,
            code: 'server-error',
            message: '저장 연결을 확인 중이에요. 잠시 후 다시 시도해 주세요.',
          });
          return;
        }
        let escrowBacked = false;
        try {
          escrowBacked = economy.hasActiveCashEscrow(session.playerId, roomId);
        } catch {
          ack?.({
            ok: false,
            code: 'server-error',
            message: '저장 연결을 확인 중이에요. 잠시 후 다시 시도해 주세요.',
          });
          return;
        }
        if (!escrowBacked) {
          if (!roomManager.retirePendingSeat(roomId, session.playerId)) {
            ack?.({
              ok: false,
              code: 'action-rejected',
              message: '이전 핸드 정리를 마친 뒤 다시 입장해 주세요.',
            });
            return;
          }
          seated = undefined;
          retiredWalletSeat = true;
        }
      }
      if (walletSng && seated) {
        if (!economy) {
          ack?.({
            ok: false,
            code: 'server-error',
            message: '저장 연결을 확인 중이에요. 잠시 후 다시 시도해 주세요.',
          });
          return;
        }
        let entryBacked = false;
        try {
          entryBacked = economy.hasActiveSngEntry(session.playerId, roomId);
        } catch {
          ack?.({
            ok: false,
            code: 'server-error',
            message: '저장 연결을 확인 중이에요. 잠시 후 다시 시도해 주세요.',
          });
          return;
        }
        if (!entryBacked) {
          if ((room.engine.state.tournament?.entrants ?? 0) > 0) {
            ack?.({
              ok: false,
              code: 'sng-started',
              message: '이미 시작된 Sit & Go입니다.',
            });
            return;
          }
          if (!roomManager.retireUnbackedWaitingSngSeat(roomId, session.playerId)) {
            ack?.({
              ok: false,
              code: 'server-error',
              message: '이전 참가 기록을 확인 중이에요. 잠시 후 다시 시도해 주세요.',
            });
            return;
          }
          seated = undefined;
          retiredWalletSeat = true;
        }
      }
      if (seated) {
        const startedTournament = !!room.engine.state.tournament && room.engine.state.tournament.entrants > 0;
        // 시작된 토너먼트에서 이탈은 탈락 확정이므로 되살리지 않고 아래 lock 체크로 넘긴다
        if (!seated.pendingRemoval || !startedTournament) {
          if (seated.pendingRemoval) {
            // 예약 취소 — 좌석 유지. 칩이 남아 있으면 그대로 (새 바이인 무시)
            seated.pendingRemoval = false;
            if (seated.chips > 0 && !seated.isDisconnected && !room.engine.state.isHandInProgress) {
              seated.status = 'waiting';
            }
          }
          // 캐시 파산 좌석 복귀는 새 바이인으로 리바이 — 0칩 좌석에 고착되는 문제 방지.
          // 다른 좌석들이 핸드를 치는 중이어도 파산 좌석은 그 핸드에 없으므로(0칩 좌석은
          // startHand가 sitting-out 처리) 즉시 리바이해 다음 핸드부터 딜인한다. 진행 중 핸드에
          // 살아 있는 올인 0칩(status active/all-in — 팟 지분 보유)만 제외.
          // (2026-07-21: '핸드 사이'로만 제한하던 조건 완화 — 파산 후 다음 핸드가 몇 초 만에
          // 시작돼 그 사이를 놓친 리바이가 조용히 무시되던 문제. BustNotice 바로 리바이의 전제)
          const inLiveHand = room.engine.state.isHandInProgress
            && (seated.status === 'active' || seated.status === 'all-in');
          if (
            room.config.gameMode !== 'sng'
            && seated.chips <= 0
            && !inLiveHand
          ) {
            if (walletCash) {
              if (!economy) {
                ack?.({
                  ok: false,
                  code: 'server-error',
                  message: '저장 연결을 확인 중이에요. 잠시 후 다시 시도해 주세요.',
                });
                return;
              }
              try {
                economy.rebuyCashEscrow(session.playerId, roomId, safeBuyIn);
              } catch (error) {
                const insufficient = error instanceof EconomyDomainError
                  && error.code === 'INSUFFICIENT_BALANCE';
                ack?.({
                  ok: false,
                  code: 'server-error',
                  message: insufficient
                    ? '보유한 무료 칩이 바이인보다 부족해요.'
                    : '저장 연결을 확인 중이에요. 잠시 후 다시 시도해 주세요.',
                });
                return;
              }
            }
            seated.chips = safeBuyIn;
            // 리바이는 명시적 '다시 플레이' 선언 — 자리비움 마킹을 함께 해제해 다음 핸드부터 딜인
            seated.sitOutNext = false;
            seated.sitOutAuto = undefined;
            seated.sitOutSinceHand = undefined;
            seated.sitOutSinceMs = undefined;
            if (!seated.isDisconnected) {
              seated.status = 'waiting';
            }
          }
          // 자리비움으로 떠났던 좌석 복귀 — 좌석은 자리비움 그대로 두고(본인이 '게임 복귀'로 참여),
          // 방치 회수 유예만 취소한다. (자동 복귀 대신 명시 복귀 — UI 안내와 일치)
          if (publicCosmetics) seated.publicCosmetics = publicCosmetics;
          roomManager.handleSeatRejoin(roomId, session.playerId);
          eventLog.log('join-room:rejoin', {
            roomId,
            playerId: session.playerId,
            data: { seat: seated.seatIndex, chips: seated.chips, status: seated.status, sitOutNext: !!seated.sitOutNext },
          });
          if (!commitRoomMembership(roomId)) {
            ack?.({
              ok: false,
              code: 'server-error',
              message: '저장 연결을 확인 중이에요. 잠시 후 다시 시도해 주세요.',
            });
            return;
          }
          socket.emit('room-joined', {
            roomId,
            gameState: {
              ...room.engine.getPublicState(session.playerId),
              turnTimeRemaining: roomManager.getTurnTimeRemaining(roomId),
            },
            chatHistory: roomManager.getChatHistory(roomId),
          });
          ack?.({ ok: true, data: { roomId } });
          // 리바이/복귀로 게임을 재개할 수 있으면 시작 (다른 좌석에도 상태 반영)
          roomManager.resumeRoom(roomId);
          return;
        }
      }

      // 비밀번호 방: 재입장(위 멱등 처리)이 아닌 신규 입장은 비밀번호 검증
      if (
        !retiredWalletSeat
        && room.config.password
        && String(data.password ?? '') !== room.config.password
      ) {
        eventLog.log('join-room:reject', { roomId, playerId: session.playerId, data: { reason: 'bad-password' } });
        ack?.({ ok: false, code: 'bad-password', message: '비밀번호가 틀렸어요.' });
        return;
      }

      // 시트앤고: 이미 시작된(또는 끝난) 토너먼트에는 참가 불가
      const tournament = room.engine.state.tournament;
      if (tournament && tournament.entrants > 0) {
        eventLog.log('join-room:reject', { roomId, playerId: session.playerId, data: { reason: 'sng-started' } });
        ack?.({ ok: false, code: 'sng-started', message: '이미 시작된 Sit & Go입니다.' });
        return;
      }

      // 봇 전용 연습 테이블: 휴먼 1명만 (재입장은 위 멱등 경로가 처리)
      if (
        room.config.tableType === 'bots'
        && room.engine.state.players.some(p => p.type === 'human' && !p.pendingRemoval && p.id !== session.playerId)
      ) {
        eventLog.log('join-room:reject', { roomId, playerId: session.playerId, data: { reason: 'practice-occupied' } });
        ack?.({
          ok: false,
          code: 'practice-occupied',
          message: '혼자 연습하는 테이블이에요 — 지금은 다른 플레이어가 연습 중입니다.',
        });
        return;
      }

      // Find first available seat — 요청 좌석은 0~5 정수만 유효, 그 외/점유 시 빈 자리 배정
      const requestedSeat = Number.isInteger(seatIndex) && seatIndex >= 0 && seatIndex <= 5 ? seatIndex : -1;
      let assignedSeat = requestedSeat;
      const occupiedSeats = new Set(room.engine.state.players.map(p => p.seatIndex));
      if (requestedSeat < 0 || occupiedSeats.has(requestedSeat)) {
        for (let s = 0; s < 6; s++) {
          if (!occupiedSeats.has(s)) {
            assignedSeat = s;
            break;
          }
        }
      }
      // 만석이면 봇이 휴먼에게 자리를 양보한다.
      // 핸드 진행 중 splice는 인덱스를 밀어 핸드를 깨뜨리므로, 핸드 사이에만 즉시 제거.
      let botToRemove: Player | null = null;
      if (room.engine.state.players.length >= 6) {
        if (room.engine.state.isHandInProgress) {
          const bot = room.engine.state.players.find(p => p.type === 'bot' && !p.pendingRemoval);
          if (!bot) {
            ack?.({ ok: false, code: 'room-full', message: '자리가 모두 찼어요 — 다른 테이블을 찾아보세요.' });
            return;
          }
          // leaveRoom 경유: 폴드로 핸드가 끝나는 경우의 승자 처리까지 위임
          if (!roomManager.leaveRoom(roomId, bot.id)) {
            ack?.({
              ok: false,
              code: 'server-error',
              message: '좌석 정리를 확인 중이에요. 잠시 후 다시 시도해 주세요.',
            });
            return;
          }
          ack?.({
            ok: false,
            code: 'bot-seat-pending',
            message: `${bot.name}이(가) 이번 핸드를 끝으로 자리를 비워줘요 — 몇 초 후 다시 참가해 주세요!`,
          });
          return;
        }
        // 핸드 사이: 예약된 봇(pendingRemoval) 포함 아무 봇이나 즉시 정리하고 그 자리에 착석
        botToRemove = room.engine.state.players.find(p => p.type === 'bot') ?? null;
        if (!botToRemove) {
          ack?.({ ok: false, code: 'room-full', message: '자리가 모두 찼어요 — 다른 테이블을 찾아보세요.' });
          return;
        }
        assignedSeat = botToRemove.seatIndex;
      }

      // 빈 좌석 탐색이 실패하면 assignedSeat이 -1로 남는다 — 그대로 앉히면 좌석 좌표가 없는
      // 유령 플레이어가 생겨(팟에는 참여) 테이블이 어그러진다. 여기서 끊는다.
      if (assignedSeat < 0 || assignedSeat > 5) {
        eventLog.log('join-room:reject', {
          roomId, playerId: session.playerId,
          data: { reason: 'no-seat', assignedSeat, seats: seatSnapshot(roomId) },
        });
        ack?.({ ok: false, code: 'room-full', message: '자리를 배정하지 못했어요 — 잠시 후 다시 시도해 주세요.' });
        return;
      }

      const player: Player = {
        id: session.playerId,
        name: playerName,
        type: 'human',
        avatar,
        // 시트앤고는 바이인 무관 고정 스택
        chips: walletSng
          ? ECONOMY_RULES.casualSngBuyIn
          : room.config.gameMode === 'sng'
            ? (room.config.startingStack ?? safeBuyIn)
            : safeBuyIn,
        seatIndex: assignedSeat,
        holeCards: [],
        currentBet: 0,
        totalContributed: 0,
        status: 'waiting',
        hasActed: false,
        timeBankChips: 1, // 입장 시 기본 타임칩 1개
        ...(publicCosmetics ? { publicCosmetics } : {}),
      };

      let admissionOpened: 'cash' | 'sng' | null = null;
      if (walletAdmission) {
        if (!economy) {
          ack?.({
            ok: false,
            code: 'server-error',
            message: '저장 연결을 확인 중이에요. 잠시 후 다시 시도해 주세요.',
          });
          return;
        }
        // 한 프로필당 active escrow는 하나다. 새 테이블 입장 직전에 기존 보존 좌석을
        // 정상 cash-out한 뒤 새 escrow를 연다. 대상 방의 모든 정적 검증은 이미 끝난 시점이다.
        const previousRoomId = session.roomId;
        if (previousRoomId && previousRoomId !== roomId) {
          const previousRoom = roomManager.getRoom(previousRoomId);
          const previousTournament = previousRoom?.engine.state.tournament;
          if (
            previousRoom?.engine.state.isHandInProgress
            || (
              previousRoom?.config.economyMode === 'wallet'
              && previousTournament
              && previousTournament.entrants > 0
              && !previousTournament.finished
            )
          ) {
            ack?.({
              ok: false,
              code: 'action-rejected',
              message: '현재 핸드가 끝난 뒤 다른 테이블로 이동해 주세요.',
            });
            return;
          }
          const previousRoomLeft = roomManager.leaveRoom(previousRoomId, session.playerId);
          if (!previousRoomLeft) {
            ack?.({
              ok: false,
              code: 'server-error',
              message: '기존 좌석 저장을 확인 중이에요. 잠시 후 다시 시도해 주세요.',
            });
            return;
          }
          const previousSeatStillExists = roomManager.getRoom(previousRoomId)
            ?.engine.state.players.some(player => (
              player.id === session.playerId && !player.pendingRemoval
            ));
          if (previousSeatStillExists) {
            ack?.({
              ok: false,
              code: 'server-error',
              message: '기존 좌석 저장을 확인 중이에요. 잠시 후 다시 시도해 주세요.',
            });
            return;
          }
          socket.leave(previousRoomId);
          session.roomId = null;
        }
        const activePreservedSeat = roomManager.getRoomList(session.playerId)
          .find(item => (
            item.id !== roomId
            && item.mySeat !== undefined
            && (() => {
              const preservedRoom = roomManager.getRoom(item.id);
              const preservedTournament = preservedRoom?.engine.state.tournament;
              return !!preservedRoom?.engine.state.isHandInProgress
                || !!(
                  preservedRoom?.config.economyMode === 'wallet'
                  && preservedTournament
                  && preservedTournament.entrants > 0
                  && !preservedTournament.finished
                );
            })()
          ));
        if (activePreservedSeat) {
          ack?.({
            ok: false,
            code: 'action-rejected',
            message: '기존 좌석의 핸드가 끝난 뒤 이동해 주세요.',
          });
          return;
        }
        if (!roomManager.leaveAllSeatsExcept(session.playerId, roomId)) {
          ack?.({
            ok: false,
            code: 'server-error',
            message: '기존 좌석 저장을 확인 중이에요. 잠시 후 다시 시도해 주세요.',
          });
          return;
        }
        const preservedElsewhere = roomManager.getRoomList(session.playerId)
          .some(item => item.id !== roomId && item.mySeat !== undefined);
        if (preservedElsewhere) {
          ack?.({
            ok: false,
            code: 'server-error',
            message: '기존 좌석 저장을 확인 중이에요. 잠시 후 다시 시도해 주세요.',
          });
          return;
        }
        try {
          if (walletSng) {
            economy.reserveSngEntry(
              session.playerId,
              roomId,
              ECONOMY_RULES.casualSngBuyIn,
              ECONOMY_RULES.casualSngFee,
            );
            admissionOpened = 'sng';
          } else {
            economy.openCashEscrow(session.playerId, roomId, safeBuyIn);
            admissionOpened = 'cash';
          }
        } catch (error) {
          const insufficient = error instanceof EconomyDomainError
            && error.code === 'INSUFFICIENT_BALANCE';
          eventLog.log('join-room:reject', {
            roomId,
            playerId: session.playerId,
            data: { reason: insufficient ? 'insufficient-chips' : 'economy-unavailable' },
          });
          ack?.({
            ok: false,
            code: 'server-error',
            message: insufficient
              ? '보유한 무료 칩이 바이인보다 부족해요.'
              : '저장 연결을 확인 중이에요. 잠시 후 다시 시도해 주세요.',
          });
          return;
        }
      }

      if (botToRemove) room.engine.processLeave(botToRemove.id);
      let success = false;
      try {
        success = roomManager.joinRoom(roomId, player);
      } catch {
        success = false;
      }
      if (!success && admissionOpened) {
        try {
          if (admissionOpened === 'sng') {
            economy?.cancelSngEntry(session.playerId, roomId);
          } else {
            economy?.cancelCashEscrow(session.playerId, roomId);
          }
        } catch {
          eventLog.log('join-room:compensation-failed', {
            roomId,
            playerId: session.playerId,
            data: { reason: 'economy-unavailable' },
          });
        }
      }
      eventLog.log(success ? 'join-room:seated' : 'join-room:reject', {
        roomId,
        playerId: session.playerId,
        data: success
          ? { name: playerName, seat: assignedSeat, chips: player.chips, seats: seatSnapshot(roomId) }
          : { reason: 'engine-rejected', seat: assignedSeat, seats: seatSnapshot(roomId) },
      });
      if (success) {
        if (!commitRoomMembership(roomId)) {
          if (!roomManager.leaveRoom(roomId, session.playerId)) {
            eventLog.log('join-room:compensation-failed', {
              roomId,
              playerId: session.playerId,
              data: { reason: 'economy-unavailable' },
            });
          }
          ack?.({
            ok: false,
            code: 'server-error',
            message: '저장 연결을 확인 중이에요. 잠시 후 다시 시도해 주세요.',
          });
          return;
        }
        // 파트너 우선 착석 — 혼자 연습(bots) 방이면 인연 파트너 캐릭터를 테이블에 보장.
        // 진행도 조회 실패는 착석에 영향 없음 (랜덤 봇 구성 그대로 진행)
        if ((room.config.tableType ?? 'mixed') === 'bots' && progression) {
          try {
            const partnerId = progression
              .getSnapshot(session.playerId, avatar)
              .profile.selectedCharacterId;
            roomManager.ensurePartnerBot(roomId, partnerId);
          } catch {
            // best-effort 연출 — 실패해도 입장은 유효
          }
        }
        socket.emit('room-joined', {
          roomId,
          gameState: room.engine.getPublicState(session.playerId),
          chatHistory: roomManager.getChatHistory(roomId),
        });
        ack?.({ ok: true, data: { roomId } });
        // Update room list for all
        broadcastRoomList();
      } else {
        ack?.({ ok: false, code: 'room-full', message: '방에 입장할 수 없어요.' });
      }
    });

    // Leave room — mode 'sitout'이면 좌석/칩을 유지한 채 자리비움으로 떠남 (재입장 시 복귀).
    // 'reserve-hand'/'reserve-bb'는 나가기 예약(방에 남음), 'reserve-cancel'은 예약 취소 —
    // 예약이 즉시 실행 조건이면 setLeaveReservation이 'leave-now'를 돌려주고 exit로 이어진다.
    socket.on('leave-room', (...rawArgs: unknown[]) => {
      const args = parseOptionalPayloadArgs<{ status: 'reserved' | 'cleared' | 'left' }>(rawArgs);
      if (!args.ok) {
        invalidPayload(args.ack);
        return;
      }
      const { payload: input, ack } = args;
      if (!ensureOwnership(ack)) return;
      const parsed = parseLeaveRoomRequest(input);
      if (!parsed.ok) {
        invalidPayload(ack);
        return;
      }
      const data = parsed.value;
      const isReserveMode = data.mode === 'reserve-hand'
        || data.mode === 'reserve-bb'
        || data.mode === 'reserve-cancel';
      let reserveLeftNow = false;
      if (session.roomId) {
        const roomId = session.roomId;
        eventLog.log('leave-room', {
          roomId, playerId: session.playerId,
          data: { mode: data.mode, seats: seatSnapshot(roomId) },
        });
        if (isReserveMode) {
          const kind = data.mode === 'reserve-hand'
            ? 'hand' as const
            : data.mode === 'reserve-bb' ? 'bb' as const : null;
          const result = roomManager.setLeaveReservation(roomId, session.playerId, kind);
          if (result === 'rejected') {
            ack?.({
              ok: false,
              code: 'action-rejected',
              message: '이 테이블에서는 나가기 예약을 쓸 수 없어요.',
            });
            return;
          }
          if (result !== 'leave-now') {
            ack?.({ ok: true, data: { status: result } });
            return;
          }
          // 'leave-now': 기다릴 핸드/블라인드가 없다 — 아래 즉시 퇴장 경로로 처리
          reserveLeftNow = true;
        }
        if (data.mode === 'sitout') {
          socket.leave(roomId);
          roomManager.sitOutAndLeave(roomId, session.playerId);
        } else {
          const leaveCompleted = roomManager.leaveRoom(roomId, session.playerId);
          const seatStillExists = roomManager.getRoom(roomId)?.engine.state.players
            .some(player => player.id === session.playerId) ?? false;
          if (!leaveCompleted && seatStillExists) {
            ack?.({
              ok: false,
              code: 'server-error',
              message: '저장 연결을 확인 중이에요. 잠시 후 다시 시도해 주세요.',
            });
            return;
          }
          socket.leave(roomId);
        }
        session.roomId = null;
        broadcastRoomList();
      }
      ack?.(reserveLeftNow ? { ok: true, data: { status: 'left' } } : { ok: true });
    });

    // Player action
    socket.on('player-action', (...rawArgs: unknown[]) => {
      const args = parseRequiredPayloadArgs<{ handNumber: number; actionSeq: number }>(rawArgs);
      if (!args.ok) {
        invalidPayload(args.ack);
        return;
      }
      const { payload: input, ack } = args;
      if (!ensureOwnership(ack)) return;
      const parsed = parsePlayerActionRequest(input);
      if (!parsed.ok) {
        invalidPayload(ack);
        return;
      }
      if (!ensureRateLimit('playerAction', '액션 요청이 너무 빠릅니다. 잠시 후 다시 시도해 주세요.', ack)) return;
      const data = parsed.value;
      if (!session.roomId) {
        ack?.({ ok: false, code: 'action-rejected', message: '현재 참가 중인 방이 없어요.' });
        return;
      }

      const roomId = session.roomId;
      if (data.roomId !== roomId) {
        ack?.({ ok: false, code: 'stale-state', message: '현재 테이블 상태가 바뀌었어요.' });
        return;
      }
      const room = roomManager.getRoom(roomId);
      const me = room?.engine.state.players.find(p => p.id === session.playerId);
      const st = room?.engine.state;
      if (
        !st
        || st.handNumber !== data.expectedHandNumber
        || st.actionSeq !== data.expectedActionSeq
      ) {
        ack?.({ ok: false, code: 'stale-state', message: '상태가 바뀌어 액션을 다시 선택해 주세요.' });
        return;
      }
      // 액션 처리 전 스냅샷 — 거부 사유를 재현하려면 '그 시점' 상태여야 한다
      const before = room && me && st
        ? {
            street: st.street,
            handNumber: st.handNumber,
            myChips: me.chips,
            myBet: me.currentBet,
            tableBet: st.currentBet,
            minRaise: st.minRaise,
            isMyTurn: st.players[st.activePlayerIndex]?.id === session.playerId,
            valid: room.engine.getValidActions(me),
          }
        : { noSeat: true };

      const accepted = roomManager.processPlayerAction(
        roomId,
        session.playerId,
        data.action as ActionType,
        typeof data.amount === 'number' ? data.amount : 0,
      );
      // 거부된 액션(accepted=false)이 곧 "버튼을 눌렀는데 아무 일도 안 일어남"의 정체다 —
      // 클라 버튼 조건이 서버 getValidActions와 어긋나면 여기 남는다.
      eventLog.log(accepted ? 'player-action' : 'player-action:rejected', {
        roomId,
        playerId: session.playerId,
        data: {
          action: data.action,
          amount: typeof data.amount === 'number' ? data.amount : 0,
          ...before,
        },
      });
      if (!accepted || !room) {
        ack?.({ ok: false, code: 'action-rejected', message: '지금은 그 액션을 실행할 수 없어요.' });
        return;
      }
      ack?.({
        ok: true,
        data: {
          handNumber: room.engine.state.handNumber,
          actionSeq: room.engine.state.actionSeq,
        },
      });
    });

    // 자리비움 토글
    socket.on('toggle-sit-out', (...rawArgs: unknown[]) => {
      const args = parsePayloadlessArgs(rawArgs);
      if (!args.ok) {
        invalidPayload(args.ack);
        return;
      }
      const { ack } = args;
      if (!ensureOwnership(ack)) return;
      if (!session.roomId) {
        ack?.({ ok: false, code: 'action-rejected', message: '현재 참가 중인 방이 없어요.' });
        return;
      }
      if (!ensureRateLimit('playerAction', '액션 요청이 너무 빠릅니다. 잠시 후 다시 시도해 주세요.', ack)) return;
      const applied = roomManager.toggleSitOut(session.roomId, session.playerId);
      if (!applied) {
        ack?.({ ok: false, code: 'action-rejected', message: '지금은 자리비움 상태를 바꿀 수 없어요.' });
        return;
      }
      ack?.({ ok: true });
    });

    // 타임칩 사용
    socket.on('use-time-bank', (...rawArgs: unknown[]) => {
      const args = parsePayloadlessArgs(rawArgs);
      if (!args.ok) {
        invalidPayload(args.ack);
        return;
      }
      const { ack } = args;
      if (!ensureOwnership(ack)) return;
      if (!session.roomId) {
        ack?.({ ok: false, code: 'action-rejected', message: '현재 참가 중인 방이 없어요.' });
        return;
      }
      const applied = roomManager.useTimeBank(session.roomId, session.playerId);
      if (!applied) {
        ack?.({ ok: false, code: 'action-rejected', message: '지금은 타임뱅크를 사용할 수 없어요.' });
        return;
      }
      ack?.({ ok: true });
    });

    // Chat message
    socket.on('send-chat', (...rawArgs: unknown[]) => {
      const args = parseRequiredPayloadArgs(rawArgs);
      if (!args.ok) {
        invalidPayload(args.ack);
        return;
      }
      const { payload: input, ack } = args;
      if (!ensureOwnership(ack)) return;
      if (!isRecord(input) || typeof input.presetId !== 'string') {
        invalidPayload(ack);
        return;
      }
      const text = CHAT_PRESET_MAP[input.presetId];
      if (!text) {
        invalidPayload(ack);
        return;
      }
      if (!ensureRateLimit('chat', '채팅은 잠시 후 다시 보내 주세요.', ack)) return;
      if (!session.roomId) {
        ack?.({ ok: false, code: 'action-rejected', message: '현재 참가 중인 방이 없어요.' });
        return;
      }

      const room = roomManager.getRoom(session.roomId);
      if (!room) {
        ack?.({ ok: false, code: 'room-not-found', message: '방을 찾을 수 없어요.' });
        return;
      }

      const player = room.engine.state.players.find(p => p.id === session.playerId);
      if (!player) {
        ack?.({ ok: false, code: 'action-rejected', message: '현재 좌석을 찾을 수 없어요.' });
        return;
      }

      // 프리셋만 허용 — 자유 텍스트는 욕설/비하 차단을 위해 받지 않는다.
      // 클라이언트가 보낸 텍스트는 신뢰하지 않고 서버 테이블에서 id→문구를 조회한다.
      roomManager.addChatMessage(session.roomId, session.playerId, player.name, text);
      ack?.({ ok: true });
    });

    // 아이템 투척 — 게임 상태와 무관한 즉발 연출이라 엔진을 건드리지 않고 방 브로드캐스트만.
    // 이벤트 로그는 남기지 않는다 (거절 payload가 로그를 증폭하지 않게 — send-chat과 동일 정책).
    socket.on('throw-item', (...rawArgs: unknown[]) => {
      const args = parseRequiredPayloadArgs<{ cooldownMs: number }>(rawArgs);
      if (!args.ok) {
        invalidPayload(args.ack);
        return;
      }
      const { payload: input, ack } = args;
      if (!ensureOwnership(ack)) return;
      if (!isRecord(input) || typeof input.itemId !== 'string' || typeof input.targetPlayerId !== 'string') {
        invalidPayload(ack);
        return;
      }
      // 클라이언트 문자열을 신뢰하지 않는다 — 카탈로그 조회가 유일한 판정
      const def = THROWABLE_MAP[input.itemId];
      if (!def) {
        invalidPayload(ack);
        return;
      }
      if (!ensureRateLimit('throwItem', '아이템 투척이 너무 빨라요.', ack)) return;
      if (!session.roomId) {
        ack?.({ ok: false, code: 'action-rejected', message: '현재 참가 중인 방이 없어요.' });
        return;
      }
      const room = roomManager.getRoom(session.roomId);
      if (!room) {
        ack?.({ ok: false, code: 'room-not-found', message: '방을 찾을 수 없어요.' });
        return;
      }
      const state = room.engine.state;
      const thrower = state.players.find(p => p.id === session.playerId);
      if (!thrower) {
        ack?.({ ok: false, code: 'action-rejected', message: '좌석에 앉아 있을 때만 던질 수 있어요.' });
        return;
      }
      // 관전 상태 차단 — GameRoomView busted 판정과 동일 계약 (파산 리바이 유예/SnG 탈락)
      const busted = thrower.chips <= 0
        && !(state.isHandInProgress && (thrower.status === 'active' || thrower.status === 'all-in'));
      if (busted || thrower.finishPlace) {
        ack?.({ ok: false, code: 'action-rejected', message: '관전 중에는 아이템을 던질 수 없어요.' });
        return;
      }
      const target = state.players.find(p => p.id === input.targetPlayerId);
      if (!target || target.id === thrower.id) {
        ack?.({ ok: false, code: 'action-rejected', message: '던질 상대를 찾을 수 없어요.' });
        return;
      }
      // 해금 검증 — MVP는 스타터만 존재. 2차(도장 레벨/미션) 추가 시 progression 스냅샷에서
      // dojoLevel/inventory를 뽑아 isThrowableUnlocked(input.itemId, ctx)로 교체할 것.
      if (def.unlock.kind !== 'starter') {
        ack?.({ ok: false, code: 'action-rejected', message: '아직 해금하지 않은 아이템이에요.' });
        return;
      }
      // 개인 쿨다운 (핸드 진행 여부는 보지 않는다 — 언제든 던질 수 있음)
      if (!throwCooldowns.allow(`throw:${session.playerId}`, { limit: 1, windowMs: THROW_COOLDOWN_MS })) {
        ack?.({ ok: false, code: 'rate-limited', message: '아이템은 잠시 후에 다시 던질 수 있어요.' });
        return;
      }
      io.to(session.roomId).emit('throwable-thrown', {
        roomId: session.roomId,
        throwId: randomUUID(),
        itemId: def.id,
        fromPlayerId: thrower.id,
        fromSeatIndex: thrower.seatIndex,
        targetPlayerId: target.id,
        targetSeatIndex: target.seatIndex,
      });
      if (target.type === 'bot') {
        roomManager.reactToThrowableHit(session.roomId, target.id, thrower.name, def.name);
      }
      ack?.({ ok: true, data: { cooldownMs: THROW_COOLDOWN_MS } });
    });

    // Create room
    socket.on('create-room', (...rawArgs: unknown[]) => {
      const args = parseRequiredPayloadArgs<{ roomId: string }>(rawArgs);
      if (!args.ok) {
        invalidPayload(args.ack);
        return;
      }
      const { payload: input, ack } = args;
      if (!ensureOwnership(ack)) return;
      const parsed = parseCreateRoomRequest(input);
      if (!parsed.ok) {
        invalidPayload(ack);
        return;
      }
      if (!ensureRateLimit('createRoom', '방 생성은 잠시 후 다시 시도해 주세요.', ack)) return;
      const config = parsed.value;
      // 운영 가드: 방 수 상한
      if (roomManager.getRoomCount() >= MAX_ROOMS) {
        ack?.({ ok: false, code: 'server-error', message: '방이 너무 많아요. 잠시 후 다시 시도해 주세요.' });
        return;
      }
      const isSng = config.gameMode === 'sng';
      const password = String(config.password ?? '').trim().slice(0, 20);
      // 상한 없이 받으면 min/maxBuyIn(×40/×200)이 안전 정수를 넘어 칩 회계 정밀도가 깨진다
      const bigBlind = Math.min(Math.max(Math.floor(Number(config.bigBlind) || 20), 2), 1_000);
      // 인원 구성 검증 — SnG는 방장 봇 채우기가 있는 혼합 테이블로 고정
      const tableType: TableType = isSng
        ? 'mixed'
        : VALID_TABLE_TYPES.includes(config.tableType as TableType)
          ? (config.tableType as TableType)
          : 'mixed';
      const safeConfig: RoomConfig = {
        ...config,
        maxPlayers: 6,
        turnTime: Math.min(Math.max(Number(config.turnTime) || 8, 5), 60),
        difficulty: VALID_DIFFICULTIES.includes(config.difficulty as RoomDifficulty)
          ? config.difficulty
          : 'normal',
        tableType,
        // 봇 충원 수는 구성이 결정: 사람만=0, 봇 전용=5, 혼합=1~5 (기본 2)
        botCount: isSng
          ? 0
          : tableType === 'humans'
            ? 0
            : tableType === 'bots'
              ? 5
              : Math.min(Math.max(Math.floor(Number(config.botCount ?? 2)), 1), 5),
        password: password || undefined,
        hostId: session.playerId, // 방장 — Sit & Go 봇 채우기 권한
        // 시트앤고는 고정 구조: 블라인드 스케줄 1레벨 시작 + 고정 스택.
        // wallet(기본)은 지갑 바이인+수수료 에스크로 — 휴먼 6명 전용이라 봇 채우기 불가.
        // practice는 지갑 무관 무료 — 방장 봇 채우기(fillWithBots)는 이 모드에서만 동작한다.
        ...(isSng
          ? {
              gameMode: 'sng' as const,
              smallBlind: SNG_BLIND_SCHEDULE[0].smallBlind,
              bigBlind: SNG_BLIND_SCHEDULE[0].bigBlind,
              ...(config.economyMode === 'practice'
                ? {
                    economyMode: 'practice' as const,
                    startingStack: SNG_STARTING_STACK,
                    minBuyIn: SNG_STARTING_STACK,
                    maxBuyIn: SNG_STARTING_STACK,
                    entryBuyIn: undefined,
                    entryFee: undefined,
                  }
                : {
                    economyMode: 'wallet' as const,
                    startingStack: ECONOMY_RULES.casualSngBuyIn,
                    minBuyIn: ECONOMY_RULES.casualSngBuyIn,
                    maxBuyIn: ECONOMY_RULES.casualSngBuyIn,
                    entryBuyIn: ECONOMY_RULES.casualSngBuyIn,
                    entryFee: ECONOMY_RULES.casualSngFee,
                  }),
            }
          : {
              gameMode: 'cash' as const,
              economyMode: 'wallet' as const,
              // 캐시 바이인 범위는 서버가 강제 (40~200BB)
              bigBlind,
              smallBlind: Math.max(Math.floor(bigBlind / 2), 1),
              minBuyIn: bigBlind * MIN_BUYIN_BB,
              maxBuyIn: bigBlind * MAX_BUYIN_BB,
            }),
      };
      const roomId = roomManager.createRoom(safeConfig);
      socket.emit('room-created', { roomId });
      ack?.({ ok: true, data: { roomId } });
      broadcastRoomList();
    });

    // 시트앤고 대기 중 봇 채우기 (방장)
    socket.on('sng-fill-bots', (...rawArgs: unknown[]) => {
      const args = parsePayloadlessArgs(rawArgs);
      if (!args.ok) {
        invalidPayload(args.ack);
        return;
      }
      const { ack } = args;
      if (!ensureOwnership(ack)) return;
      if (!session.roomId) {
        ack?.({ ok: false, code: 'action-rejected', message: '현재 참가 중인 방이 없어요.' });
        return;
      }
      const ok = roomManager.fillWithBots(session.roomId, session.playerId);
      if (ok) {
        broadcastRoomList();
        ack?.({ ok: true });
      } else {
        // wallet SnG는 지갑 에스크로 계약상 휴먼 6명 전용 — 이유를 명확히 안내
        const room = roomManager.getRoom(session.roomId);
        const walletSng = room?.config.gameMode === 'sng'
          && room.config.economyMode === 'wallet';
        ack?.({
          ok: false,
          code: 'action-rejected',
          message: walletSng
            ? '지갑 Sit & Go는 사람 6명이 모두 모여야 시작해요 — 봇과 하려면 연습 Sit & Go로 만들어 주세요.'
            : '지금은 봇으로 채울 수 없어요.',
        });
      }
    });

    // Request room list
    socket.on('get-rooms', (...rawArgs: unknown[]) => {
      const args = parsePayloadlessArgs(rawArgs);
      if (!args.ok) {
        invalidPayload(args.ack);
        return;
      }
      const { ack } = args;
      if (!ensureOwnership(ack)) return;
      if (!ensureRateLimit('roomSync', '동기화 요청이 너무 빠릅니다. 잠시 후 다시 시도해 주세요.', ack)) return;
      socket.emit('room-list', roomManager.getRoomList(session.playerId));
      ack?.({ ok: true });
    });

    // Disconnect: 즉시 제거하지 않고 grace period 동안 좌석/칩 보존
    socket.on('disconnect', () => {
      arenaMatchmaker?.disconnect(socket.id);
      const detached = sessions.detachSocket(socket.id);
      console.log(`Player disconnected: socket=${socket.id}`);
      eventLog.log('disconnect', {
        playerId: session.playerId,
        ...(detached?.roomId ? { roomId: detached.roomId } : {}),
        // detached=null이면 이미 새 소켓이 세션을 가져간 것(중복 탭) — grace를 걸지 않는 정상 경로
        data: { socketId: socket.id, graceStarted: !!detached?.roomId },
      });
      if (detached) startDisconnectedGrace(detached);
      delete socket.data.profileId;
      delete socket.data.profileAlias;
      delete socket.data.profileAvatarId;
      delete socket.data.hadTransportToken;
      delete socket.data.transportTokenHint;
    });
  });

  return {
    roomManager,
    sessions,
    refreshPublicCosmetics: (profileId, snapshot) => {
      const session = sessions.getByPlayerId(profileId);
      if (!session) return false;
      const roomId = session.roomId
        ?? roomManager.getRoomList(profileId).find(room => room.mySeat)?.id;
      if (!roomId) return false;
      return roomManager.refreshPlayerPublicCosmetics(
        roomId,
        profileId,
        buildPublicCosmetics(snapshot),
      );
    },
    refreshAvatar: (profileId, avatarId) => {
      const session = sessions.getByPlayerId(profileId);
      // 라이브 소켓의 인증 스냅샷 갱신 — 안 하면 다음 join-room이 옛 아바타로 착석한다
      const socket = session?.socketId ? io.sockets.sockets.get(session.socketId) : undefined;
      if (socket) socket.data.profileAvatarId = avatarId;
      const roomId = session?.roomId
        ?? roomManager.getRoomList(profileId).find(room => room.mySeat)?.id;
      if (roomId) roomManager.refreshPlayerAvatar(roomId, profileId, avatarId);
    },
    revokeProfile: profileId => {
      const revoked = sessions.revokeProfile(profileId);
      if (!revoked) return;
      startDisconnectedGrace(revoked.session);
      const socket = io.sockets.sockets.get(revoked.socketId);
      socket?.emit('session-replaced', {
        message: '프로필 인증 정보가 변경되어 연결을 다시 확인해 주세요.',
      });
      socket?.disconnect(true);
    },
    startArena: () => arenaMatchmaker?.start(),
    close: async () => {
      if (sweepTimer) clearInterval(sweepTimer);
      const report = await arenaMatchmaker?.close() ?? {
        pendingOfficialMatchIds: [],
        pendingTrainingOfferIds: [],
      };
      sessions.shutdown();
      roomManager.shutdown();
      return report;
    },
  };
}
