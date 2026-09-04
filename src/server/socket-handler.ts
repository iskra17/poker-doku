import { Server, Socket } from 'socket.io';
import { randomUUID } from 'node:crypto';
import { RoomManager, type RoomHandHistoryHooks } from './room-manager';
import { cfg } from './game-config/live';
import { SessionManager, type Session } from './session-manager';
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
  PublicTournamentSummary,
  RegisterTournamentCommand,
  RegisterTournamentResult,
  ServerToClientEvents,
  TournamentListPayload,
  TournamentDetailView,
} from '../lib/realtime/protocol';
import {
  isRecord,
  parseCreateRoomRequest,
  parseJoinRoomRequest,
  parseLeaveRoomRequest,
  parsePlayerActionRequest,
  parseRegisterTournamentCommand,
  parseTournamentResyncRequest,
} from './socket-payload';
import { SOCKET_RATE_LIMITS, SocketRateLimiter } from './socket-rate-limit';
import { StoryRunCoordinator, type CoordinatorResult } from './story-run-coordinator';
import type { StoryRewardService } from './story-reward-service';
import { LiveTableAdapter } from './story-live-adapter';
import { operatorAccessFromSet, resolveOperatorAccess } from './operator-access';
import type { StoryRepository } from './story-repository';
import {
  parseAbandonStoryRequest,
  parseRetryStorySparringRequest,
  parseStartStoryChapterRequest,
  parseStoryAdvanceRequest,
  parseStoryChoiceRequest,
  parseStoryDrillRequest,
  parseStoryQuizRequest,
} from './story-payload';
import type { StoryDrillAck, StoryProgressView } from '../lib/story/views';
import type { Chapter } from '../lib/story/types';
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
  MttAdmissionEconomy,
  RoomEconomyHooks,
  SngAdmissionEconomy,
} from './economy-runtime';
import { ECONOMY_RULES } from './economy-service';
import {
  MTT_WALLET_ENTRY_COST,
} from '../lib/economy/mtt-entry';
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
import {
  TournamentManager,
  type PersistentLateRegistrationInstance,
  type PersistentLateRegistrationPorts,
  type PersistentPendingLateEntry,
  type PersistentRegistrationCloseClaim,
  type PersistentTournamentRuntimeRegistrationPorts,
  type PersistentTournamentSettlementPorts,
} from './tournament-manager';
import {
  TournamentEnrollmentError,
  type EnrollmentReservationResult,
  type LateEntryKey,
  type PublicTournamentPlayer,
  type TournamentRegistrationEngagement,
} from './tournament-enrollment-repository';
import {
  TournamentCommandService,
  parseTournamentOperatorIds,
  type PersistentTournamentStartPorts,
} from './tournament-command-service';
import { legacyPhase } from './tournament-instance-repository';
import type { MttSpeed } from '../lib/poker/mtt-structure';
import type { RegistrationCloseReason } from '../lib/tournament/tournament-state';
import { PAYOUT_PRESET_IDS } from '../lib/poker/payout-table';

const VALID_DIFFICULTIES: RoomDifficulty[] = ['easy', 'normal', 'hard'];
const VALID_TABLE_TYPES: TableType[] = ['bots', 'mixed', 'humans'];
const VALID_MTT_SPEEDS: MttSpeed[] = ['standard', 'turbo', 'hyper'];
const VALID_TURN_TIMES = [8, 15, 30];
/** 탈락 안내(EliminationNotice) 표시 후 로비 복귀까지의 여유 */
const MTT_ELIMINATION_EXIT_MS = 8_000;
// 방 수 상한은 핫 컨피그 cfg('table.maxRooms') — 하향해도 기존 방은 유지, 생성만 차단
const MIN_BUYIN_BB = 40; // 캐시 게임 바이인 하한 (BB 배수)
const MAX_BUYIN_BB = 200; // 캐시 게임 바이인 상한 (BB 배수)

export interface PersistentTournamentSocketPorts {
  listPublicTournaments(
    profileId: string | undefined,
    now: number,
  ): PublicTournamentSummary[];
  registerTournament(input: {
    command: RegisterTournamentCommand;
    profileId: string;
    publicPlayer: PublicTournamentPlayer;
  }): RegisterTournamentResult;
  readTournamentEngagement(
    tournamentId: string,
    profileId: string,
  ): TournamentRegistrationEngagement | null;
}

export type PersistentTournamentRuntimePorts = PersistentLateRegistrationPorts
  & Partial<PersistentTournamentSocketPorts>;

function registrationResult(
  command: RegisterTournamentCommand,
  instanceStatus: string,
  result: EnrollmentReservationResult,
): RegisterTournamentResult {
  if (result.status === 'terminal') {
    return {
      ok: false,
      requestId: command.requestId,
      reason: 'request-terminal',
      terminalStatus: result.resultCode,
    };
  }
  return {
    ok: true,
    status: result.status === 'seated'
      ? 'seated'
      : instanceStatus === 'running' ? 'seating' : 'registered',
    tournamentId: command.tournamentId,
    requestId: command.requestId,
  };
}

export function createPersistentLateRegistrationPorts(
  instances: {
    getInstance(
      tournamentId: string,
    ): PersistentLateRegistrationInstance | null;
    listPublicProjections?(
      profileId: string | undefined,
      now: number,
    ): PublicTournamentSummary[];
    /** 등록 마감 CAS — 주입돼야 TournamentManager의 마감 드라이버가 켜진다 */
    claimRegistrationClose?(
      tournamentId: string,
      ownerToken: string,
      reason: RegistrationCloseReason,
    ): PersistentRegistrationCloseClaim;
  },
  enrollments: {
    commitLateMttBatch(
      tournamentId: string,
      entries: readonly LateEntryKey[],
      tableCount: number,
    ): void;
    /** 미착석 late-pending 열거 + 취소·환불 — 마감 드라이버의 드레인 경로 */
    listPendingLateEntries?(
      tournamentId: string,
    ): readonly PersistentPendingLateEntry[];
    releaseLateMttEntry?(
      tournamentId: string,
      entry: LateEntryKey,
      closeCandidate: null,
    ): { readonly status: string };
    registerPreStart?(input: {
      tournamentId: string;
      profileId: string;
      requestId: string;
      publicPlayer: PublicTournamentPlayer;
    }): EnrollmentReservationResult;
    reserveLateMttEntry?(
      profileId: string,
      tournamentId: string,
      requestId: string,
      candidateCloseOwnerToken: string,
    ): EnrollmentReservationResult;
    readTournamentEngagement?(
      tournamentId: string,
      profileId: string,
    ): TournamentRegistrationEngagement | null;
  },
  options: {
    readonly lateRegistrationEnabled?: boolean;
    readonly walletLateRegistrationEnabled?: boolean;
  } = {},
): PersistentTournamentRuntimePorts {
  return {
    readInstance: tournamentId => instances.getInstance(tournamentId),
    commitLateMttBatch: (tournamentId, entries, tableCount) => {
      enrollments.commitLateMttBatch(tournamentId, entries, tableCount);
    },
    ...(instances.listPublicProjections
      ? {
          listPublicTournaments: (
            profileId: string | undefined,
            now: number,
          ) => instances.listPublicProjections!(profileId, now),
        }
      : {}),
    // 마감 드라이버 3종은 전부 옵셔널 — 하나라도 빠지면 매니저가 드라이버를 켜지 않는다
    ...(instances.claimRegistrationClose
      ? {
          claimRegistrationClose: (
            tournamentId: string,
            ownerToken: string,
            reason: RegistrationCloseReason,
          ) => instances.claimRegistrationClose!(
            tournamentId,
            ownerToken,
            reason,
          ),
        }
      : {}),
    ...(enrollments.listPendingLateEntries
      ? {
          listPendingLateEntries: (tournamentId: string) => (
            enrollments.listPendingLateEntries!(tournamentId)
          ),
        }
      : {}),
    ...(enrollments.releaseLateMttEntry
      ? {
          releaseLateMttEntry: (
            tournamentId: string,
            entry: LateEntryKey,
          ) => enrollments.releaseLateMttEntry!(tournamentId, entry, null),
        }
      : {}),
    ...(enrollments.readTournamentEngagement
      ? {
          readTournamentEngagement: (
            tournamentId: string,
            profileId: string,
          ) => enrollments.readTournamentEngagement!(tournamentId, profileId),
        }
      : {}),
    ...(enrollments.registerPreStart && enrollments.reserveLateMttEntry
      ? {
          registerTournament: (input: {
            command: RegisterTournamentCommand;
            profileId: string;
            publicPlayer: PublicTournamentPlayer;
          }): RegisterTournamentResult => {
            const { command, profileId, publicPlayer } = input;
            const instance = instances.getInstance(command.tournamentId);
            if (!instance) {
              return {
                ok: false,
                requestId: command.requestId,
                reason: 'not-open',
              };
            }
            if (
              instance.status === 'running'
              && options.lateRegistrationEnabled !== true
            ) {
              return {
                ok: false,
                requestId: command.requestId,
                reason: 'not-open',
              };
            }
            if (
              instance.status === 'running'
              && instance.economyMode === 'wallet'
              && options.walletLateRegistrationEnabled !== true
            ) {
              return {
                ok: false,
                requestId: command.requestId,
                reason: 'not-open',
              };
            }
            try {
              const result = instance.status === 'running'
                ? enrollments.reserveLateMttEntry!(
                    profileId,
                    command.tournamentId,
                    command.requestId,
                    `socket-late-close:${randomUUID()}`,
                  )
                : enrollments.registerPreStart!({
                    tournamentId: command.tournamentId,
                    profileId,
                    requestId: command.requestId,
                    publicPlayer,
                  });
              return registrationResult(command, instance.status, result);
            } catch (error) {
              const reason:
                | 'not-open'
                | 'late-registration-closed'
                | 'full'
                | 'already-entered'
                | 'insufficient-balance'
                | 'other-tournament'
                | 'seating-failed' = error instanceof EconomyDomainError
                  && error.code === 'INSUFFICIENT_BALANCE'
                ? 'insufficient-balance'
                : error instanceof TournamentEnrollmentError
                  ? error.code === 'capacity'
                    ? 'full'
                    : error.code === 'active-registration'
                      ? 'other-tournament'
                      : error.code === 'registration-closed'
                        ? instance.status === 'running'
                          ? 'late-registration-closed'
                          : 'not-open'
                        : error.code === 'not-found'
                          ? 'not-open'
                          : 'seating-failed'
                  : 'seating-failed';
              return {
                ok: false,
                requestId: command.requestId,
                reason,
              };
            }
          },
        }
      : {}),
  };
}

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
  economy?: CashAdmissionEconomy & SngAdmissionEconomy & MttAdmissionEconomy & RoomEconomyHooks;
  tournamentOperatorProfileIds?: ReadonlySet<string>;
  /** 운영자 프로필(세션 capability `operator` — 잠긴 챕터 시작·스텝 건너뛰기). 생략 시 env(OPERATOR_PROFILE_IDS ∪ 토너먼트 운영자, dev는 전원) */
  operatorProfileIds?: ReadonlySet<string>;
  persistentTournamentStart?: PersistentTournamentStartPorts;
  persistentRuntimeEnabled?: boolean;
  persistentTournamentRegistration?:
    Partial<PersistentTournamentSocketPorts>;
  persistentTournamentRuntimeRegistration?:
    PersistentTournamentRuntimeRegistrationPorts;
  persistentLateRegistration?: PersistentLateRegistrationPorts;
  persistentSettlement?: PersistentTournamentSettlementPorts;
  progressionService?: ProgressionRuntimeService;
  handHistory?: RoomHandHistoryHooks;
  /** 수련 스토리 영속 — 주어지면 StoryRunCoordinator를 켜고 story-* 이벤트를 받는다 */
  storyRepository?: StoryRepository;
  /** 수련 스토리 카탈로그 보상(아이템·칩) — progressionService와 함께 있을 때만 코디네이터 포트에 실린다 */
  storyRewards?: StoryRewardService;
  /** 챕터 레지스트리 오버라이드 (테스트 픽스처용 — 기본 STORY_CHAPTERS) */
  storyChapters?: readonly Chapter[];
  arena?: {
    service: ArenaService;
    matchIdFactory?: () => string;
    metrics?: ArenaQueueMetrics & ArenaRoomMetrics;
  };
}

export interface SocketRuntime {
  roomManager: RoomManager;
  tournamentManager: TournamentManager;
  tournamentCommands: TournamentCommandService;
  sessions: SessionManager;
  revokeProfile: (profileId: string) => void;
  refreshPublicCosmetics: (
    profileId: string,
    snapshot: import('../lib/progression/types').ProgressionSnapshot,
  ) => boolean;
  /** 프로필 아바타 변경 전파 — 라이브 소켓의 인증 스냅샷과 앉아 있는 좌석 아바타를 함께 갱신 */
  refreshAvatar: (profileId: string, avatarId: string) => void;
  /** 수련 스토리 진행 요약 (GET /api/story 늦은 바인딩) — 스토리 비활성이면 null */
  storyProgress: (profileId: string) => StoryProgressView | null;
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
    sngRetentionMs,
    economy,
    progressionService,
    handHistory,
    storyRepository,
    storyRewards,
    arena,
  } = options;
  const sessions = new SessionManager();
  const persistentTournamentPorts =
    options.persistentTournamentRegistration
    ?? (
      options.persistentLateRegistration as
        PersistentTournamentRuntimePorts | undefined
    );
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

  // 수련 스토리 런 코디네이터 — 방과 무관한 개인 상태 머신. story-update는 최신 소켓 하나에만 간다.
  const storyCoordinator = storyRepository
    ? new StoryRunCoordinator({
      repository: storyRepository,
      chapters: options.storyChapters,
      // 보상은 progression 런타임이 있을 때만 — 없으면(테스트·비활성) XP 없이 진행.
      // 카탈로그 아이템·칩(storyRewards)은 XP와 별개 트랜잭션(reconcile) — 새 지급이 있으면 인벤토리·코스메틱이
      // 바뀌었으므로 progression-update 스냅샷을 한 번 더 밀어 로비(갤러리·옷장)가 즉시 반영한다.
      rewards: progression
        ? {
          completeChapter: input => {
            const result = progression.completeStoryChapter(input);
            return { duplicate: result.duplicate, affinityTransitions: result.affinityTransitions };
          },
          completeDaily: input => ({ duplicate: progression.completeStoryDaily(input).duplicate }),
          ...(storyRewards
            ? {
              reconcile: (profileId: string, now: number) => {
                const result = storyRewards.reconcile(profileId, now);
                if (result.granted.length > 0 || result.chips > 0) {
                  queueMicrotask(() => {
                    const session = sessions.getByPlayerId(profileId);
                    if (!session?.socketId || !progressionService) return;
                    const target = io.sockets.sockets.get(session.socketId);
                    if (!target) return;
                    try {
                      target.emit('progression-update', progressionService.getRuntimeSnapshot(profileId, 'sakura'));
                    } catch {
                      // 스냅샷 재조회 실패는 다음 /api/progression 조회가 메운다
                    }
                  });
                }
                return result;
              },
              preview: (profileId: string) => storyRewards.preview(profileId),
              grantDailyChips: (profileId: string, kstDate: string, now: number) =>
                storyRewards.grantDailyChips(profileId, kstDate, now),
            }
            : {}),
        }
        : undefined,
      emit: (profileId, view) => {
        const session = sessions.getByPlayerId(profileId);
        if (!session?.socketId) return;
        io.sockets.sockets.get(session.socketId)?.emit('story-update', view);
      },
      partnerOf: profileId => {
        if (!progressionService) return null;
        try {
          return progressionService.getRuntimeSnapshot(profileId, 'sakura').profile.selectedCharacterId;
        } catch {
          return null;
        }
      },
    })
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
      // 착석 대기자도 개인 game-update 수신 — 좌석이 없어 홀카드는 전부 마스킹된 관전 뷰
      for (const waiterId of roomManager.getSeatWaiterIds(roomId)) {
        const waiterSession = sessions.getByPlayerId(waiterId);
        if (!waiterSession?.socketId || waiterSession.roomId !== roomId) continue;
        const waiterSocket = io.sockets.sockets.get(waiterSession.socketId);
        if (waiterSocket) {
          waiterSocket.emit('game-update', {
            roomId,
            state: {
              ...engine.getPublicState(waiterId),
              turnTimeRemaining,
            },
          });
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
          } else if (reason === 'mtt-break') {
            socket?.emit('room-lost', {
              message: '토너먼트 테이블이 통합되어 로비로 돌아왔어요.',
            });
          } else if (reason === 'mtt-cancel') {
            socket?.emit('room-lost', {
              message: '토너먼트가 취소되어 로비로 돌아왔어요.',
            });
          } else if (reason === 'mtt-start-rollback') {
            socket?.emit('room-lost', {
              message: '토너먼트 시작을 완료하지 못해 안전하게 로비로 돌아왔어요.',
            });
          } else if (reason === 'story-end') {
            // 스토리 라이브 스텝 종료/포기 — 곧이어 story-update가 다음 스텝(또는 종료)을 실어 온다
            socket?.emit('room-lost', {
              message: '수련 테이블을 정리했어요 — 이야기를 이어갈게요.',
              reason: 'story-end',
            });
          }
          session.roomId = null;
          sessions.releaseIfIdle(session);
        }
      },
    },
  );

  // 라이브 스텝 어댑터 (Phase 1b) — 코디네이터가 있을 때만. 히어로 착석은 소켓 계층이 담당한다:
  // Player 구성(별칭·아바타·코스메틱) → joinRoom → 세션 roomId 교체·socket.join → room-joined.
  // hold는 어댑터가 착석 전에 세팅하므로 joinRoom의 tryStartGame이 핸드를 시작하지 않는다.
  const storyLiveAdapter = storyCoordinator
    ? new LiveTableAdapter({
      roomManager,
      hero: {
        seatHero: (profileId, roomId, seat) => {
          const targetSession = sessions.getByPlayerId(profileId);
          const targetSocket = targetSession?.socketId
            ? io.sockets.sockets.get(targetSession.socketId)
            : undefined;
          const room = roomManager.getRoom(roomId);
          if (!targetSession || !targetSocket || !room) return false;
          const alias = targetSocket.data.profileAlias;
          const avatar = targetSocket.data.profileAvatarId;
          if (!alias || !avatar) return false;
          let publicCosmetics: Player['publicCosmetics'];
          if (progression) {
            try {
              publicCosmetics = buildPublicCosmetics(progression.getSnapshot(profileId, avatar));
            } catch {
              return false;
            }
          }
          // 1세션 1테이블 — 다른 방의 보존 좌석은 먼저 정리한다 (commitRoomMembership과 동일 규칙)
          const previousRoomId = targetSession.roomId;
          if (previousRoomId && previousRoomId !== roomId) {
            if (!roomManager.leaveRoom(previousRoomId, profileId)) return false;
            targetSocket.leave(previousRoomId);
            targetSession.roomId = null;
          }
          if (!roomManager.leaveAllSeatsExcept(profileId, roomId)) return false;
          const player: Player = {
            id: profileId,
            name: alias,
            type: 'human',
            avatar,
            chips: seat.chips,
            seatIndex: seat.seatIndex,
            holeCards: [],
            currentBet: 0,
            totalContributed: 0,
            status: 'waiting',
            hasActed: false,
            timeBankChips: 1,
            ...(publicCosmetics ? { publicCosmetics } : {}),
          };
          if (!roomManager.joinRoom(roomId, player)) return false;
          targetSession.roomId = roomId;
          targetSocket.join(roomId);
          eventLog.log('join-room:seated', {
            roomId,
            playerId: profileId,
            data: { seat: seat.seatIndex, chips: seat.chips, story: true },
          });
          targetSocket.emit('room-joined', {
            roomId,
            gameState: {
              ...room.engine.getPublicState(profileId),
              turnTimeRemaining: roomManager.getTurnTimeRemaining(roomId),
            },
            chatHistory: roomManager.getChatHistory(roomId),
          });
          return true;
        },
      },
    })
    : undefined;
  if (storyCoordinator && storyLiveAdapter) {
    roomManager.setStoryHooks(storyLiveAdapter);
    storyCoordinator.setLiveAdapter(storyLiveAdapter);
  }

  // 소켓별 개인화(등록 여부·내 테이블) 토너먼트 목록 브로드캐스트 — room-list와 같은 계약
  function publicTournamentList(
    playerId: string | undefined,
  ): TournamentListPayload {
    const serverNow = Date.now();
    let tournaments: PublicTournamentSummary[] = [];
    try {
      tournaments = persistentTournamentPorts?.listPublicTournaments?.(
        playerId,
        serverNow,
      ) ?? [];
    } catch {
      // Persistent public state fails closed. A later poll/resync retries it.
    }
    // 목록에 뜬 토너먼트마다 초대 코드를 보장한다 (이미 있으면 그대로 유지).
    // 방과 같은 코드 공간을 쓰므로 사용자는 코드가 어느 쪽인지 몰라도 된다.
    for (const tournament of tournaments) {
      roomManager.invites.issue('tournament', tournament.id);
    }
    return {
      serverNow,
      tournaments: tournaments.map(tournament => ({
        ...tournament,
        inviteCode: roomManager.invites.codeFor('tournament', tournament.id),
      })),
    };
  }

  /**
   * 시작 전(=인메모리 런타임이 아직 없는) 영속 토너먼트의 상세 뷰.
   *
   * `TournamentManager`는 `activatePreparedTournament()` 시점에야 런타임을 만들기 때문에
   * 예약 토너먼트는 등록 기간 내내 인메모리 맵에 없다. 목록(`listPublicTournaments`)은 DB를
   * 보고 상세만 인메모리를 보면 "로비 카드는 등록 중인데 열어보면 종료됨"이 되고, 등록 버튼이
   * 상세 모달에만 있으므로 **참가 자체가 불가능**해진다 (2026-07-26 QA).
   * 목록과 같은 공개 투영을 재료로 상세를 구성해 그 비대칭을 없앤다.
   */
  function persistentTournamentDetail(
    tournamentId: string,
    playerId: string | undefined,
  ): TournamentDetailView | null {
    const summary = publicTournamentList(playerId).tournaments
      .find(candidate => candidate.id === tournamentId);
    if (!summary) return null;
    const levels: TournamentDetailView['levels'] = [];
    let levelDurationMs = 0;
    for (const segment of summary.structure.segments) {
      if (segment.kind !== 'level') continue;
      if (levelDurationMs === 0) levelDurationMs = segment.durationMs;
      levels.push({
        level: levels.length + 1,
        smallBlind: segment.smallBlind,
        bigBlind: segment.bigBlind,
        ante: segment.bigBlindAnte,
      });
    }
    return {
      // `phase`는 구 클라이언트용 어댑터라 공개 투영에서 optional이다.
      // 목록과 동일한 매핑으로 채워 상세/목록이 어긋나지 않게 한다.
      summary: { ...summary, phase: summary.phase ?? legacyPhase(summary.lifecycle) },
      levels,
      levelDurationMs,
      payouts: summary.payout.payouts.map(row => ({
        place: row.place,
        prize: row.amount,
      })),
      // 시작 전에는 좌석도 순위도 없다. 시계는 런타임이 생긴 뒤에만 의미가 있다.
      entrants: [],
      standings: [],
      clock: null,
    };
  }

  /**
   * 라이브(인메모리 런타임이 있는) 토너먼트의 상세.
   *
   * 런타임은 좌석·순위·시계를 알지만 `summary`는 레거시 v1 투영이라 v2 필드
   * (`structure`/`schedule`/`payout`/`registrationState`/`mySeat`)가 전부 비어 있다.
   * 그대로 내보내면 상세 모달이 `structure.segments`를 읽다 죽어서 페이지 전체가
   * 날아간다 (2026-07-26 프리롤 실주행 — 로비 카드·게임 중 배지 양쪽에서 재현).
   * 등록 상태·일정·상금 계단표의 정본은 영속 v2이므로 **목록과 같은 공개 투영**을
   * summary로 싣고 런타임 사실만 런타임에서 가져온다.
   *
   * 목록 투영에 없으면 상세도 주지 않는다 — 그 상태는 정리된 토너먼트이고,
   * 클라이언트가 "종료되어 정리되었습니다"를 보여주는 것이 옳다. 여기서 v1을
   * v2처럼 꾸며 내보내면 같은 종류의 비대칭이 다시 생긴다.
   */
  function liveTournamentDetail(
    tournamentId: string,
    playerId: string | undefined,
  ): TournamentDetailView | null {
    const runtime = tournamentManager.getDetail(tournamentId, playerId);
    if (!runtime) return null;
    const canonical = publicTournamentList(playerId).tournaments
      .find(candidate => candidate.id === tournamentId);
    if (!canonical) return null;
    return {
      ...runtime,
      // 런타임의 v1 summary는 여기서 v2 정본으로 **덮어쓴다**.
      summary: {
        ...canonical,
        phase: canonical.phase ?? legacyPhase(canonical.lifecycle),
      },
    };
  }

  function broadcastTournamentList(): void {
    for (const [socketId, sock] of io.sockets.sockets) {
      sock.emit(
        'tournament-list',
        publicTournamentList(sessions.getBySocketId(socketId)?.playerId),
      );
    }
  }

  function projectLateTournamentSeat(
    targetSession: Session,
    tournamentId: string,
    roomId: string,
  ): boolean {
    const engagement = targetSession.tournamentEngagement;
    const targetSocket = targetSession.socketId
      ? io.sockets.sockets.get(targetSession.socketId)
      : undefined;
    if (
      !engagement
      || engagement.tournamentId !== tournamentId
      || targetSession.roomId !== null
      || !targetSocket
      || !sessions.isCurrentSocket(targetSession.playerId, targetSocket.id)
    ) return false;
    let registration: PublicTournamentSummary | undefined;
    try {
      registration = persistentTournamentPorts?.listPublicTournaments?.(
        targetSession.playerId,
        Date.now(),
      ).find(tournament => tournament.id === tournamentId);
    } catch {
      return false;
    }
    const room = roomManager.getRoom(roomId);
    const liveSeat = room?.engine.state.players.find(
      player => player.id === targetSession.playerId && !player.pendingRemoval,
    );
    if (
      registration?.myRegistrationStatus !== 'seated'
      || !room
      || room.config.tournamentId !== tournamentId
      || !liveSeat
    ) return false;
    targetSession.tournamentEngagement = null;
    targetSession.roomId = roomId;
    targetSocket.join(roomId);
    targetSocket.emit('tournament-seat-assigned', {
      tournamentId,
      roomId,
      state: {
        ...room.engine.getPublicState(targetSession.playerId),
        turnTimeRemaining: roomManager.getTurnTimeRemaining(roomId),
      },
      chat: roomManager.getChatHistory(roomId),
    });
    return true;
  }

  function findLiveTournamentRoom(
    tournamentId: string,
    playerId: string,
  ): string | undefined {
    return roomManager.getAdminRoomSummaries()
      .map(summary => summary.id)
      .find(roomId => {
        const room = roomManager.getRoom(roomId);
        return room?.config.tournamentId === tournamentId
          && room.engine.state.players.some(
            player => player.id === playerId && !player.pendingRemoval,
          );
      });
  }

  const tournamentManager = new TournamentManager(roomManager, {
    // 체크인 = 시작 시점 접속 (노쇼 방지 — 미접속 등록자는 착석 제외)
    isConnected: playerId => {
      const targetSession = sessions.getByPlayerId(playerId);
      return !!(targetSession?.socketId
        && io.sockets.sockets.get(targetSession.socketId));
    },
    // 시작 착석 — 기존 좌석 정리 후 세션을 토너 테이블로 전환하고 room-joined를 push
    onSeated: ({ tournamentId, playerId, roomId }) => {
      const targetSession = sessions.getByPlayerId(playerId);
      if (!targetSession) return;
      const targetSocket = targetSession.socketId
        ? io.sockets.sockets.get(targetSession.socketId)
        : undefined;
      if (targetSession.tournamentEngagement) {
        projectLateTournamentSeat(targetSession, tournamentId, roomId);
        return;
      }
      if (targetSession.roomId && targetSession.roomId !== roomId) {
        roomManager.leaveRoom(targetSession.roomId, playerId);
        targetSocket?.leave(targetSession.roomId);
      }
      roomManager.leaveAllSeatsExcept(playerId, roomId);
      targetSession.roomId = roomId;
      if (!targetSocket) return;
      targetSocket.join(roomId);
      const room = roomManager.getRoom(roomId);
      if (!room) return;
      targetSocket.emit('room-joined', {
        roomId,
        gameState: {
          ...room.engine.getPublicState(playerId),
          turnTimeRemaining: roomManager.getTurnTimeRemaining(roomId),
        },
        chatHistory: roomManager.getChatHistory(roomId),
      });
    },
    // 서버 주도 테이블 이동 — 로비 경유 없이 currentRoomId를 교체하는 table-move 계약
    onPlayerMoved: ({ tournamentId, playerId, fromRoomId, toRoomId }) => {
      const targetSession = sessions.getByPlayerId(playerId);
      if (!targetSession) return;
      const targetSocket = targetSession.socketId
        ? io.sockets.sockets.get(targetSession.socketId)
        : undefined;
      targetSocket?.emit(
        'tournament-list',
        publicTournamentList(playerId),
      );
      if (targetSession.roomId !== fromRoomId) return;
      targetSession.roomId = toRoomId;
      if (!targetSocket) return;
      targetSocket.leave(fromRoomId);
      targetSocket.join(toRoomId);
      const room = roomManager.getRoom(toRoomId);
      if (!room) return;
      targetSocket.emit('table-move', {
        tournamentId,
        fromRoomId,
        roomId: toRoomId,
        gameState: {
          ...room.engine.getPublicState(playerId),
          turnTimeRemaining: roomManager.getTurnTimeRemaining(toRoomId),
        },
        chatHistory: roomManager.getChatHistory(toRoomId),
      });
    },
    // 탈락: EliminationNotice(스냅샷 finishPlace)가 순위를 보여준 뒤 로비로 복귀.
    // 파이널에서 토너먼트가 끝났으면 결과 오버레이 관람을 위해 보존 만료까지 좌석을 유지한다.
    onEliminated: ({ roomId, playerId, place, prize }) => {
      setTimeout(() => {
        const room = roomManager.getRoom(roomId);
        if (room?.engine.state.tournament?.finished) return;
        const targetSession = sessions.getByPlayerId(playerId);
        if (!targetSession || targetSession.roomId !== roomId) return;
        targetSession.roomId = null;
        const targetSocket = targetSession.socketId
          ? io.sockets.sockets.get(targetSession.socketId)
          : undefined;
        targetSocket?.leave(roomId);
        targetSocket?.emit('room-lost', {
          message: prize > 0
            ? `🏆 ${place}위 입상! 상금 ${prize.toLocaleString()} 칩을 획득했어요.`
            : `${place}위로 토너먼트를 마쳤어요 — 수고하셨습니다!`,
        });
        sessions.releaseIfIdle(targetSession);
      }, MTT_ELIMINATION_EXIT_MS);
    },
    // 등록 마감으로 미착석 지각 등록이 취소·환불됐다 — 세션 잠김을 풀고 로비로 돌려보낸다.
    // (이 통지가 없으면 클라이언트가 '좌석 배정 대기' 화면에 영원히 갇힌다)
    onLateRegistrationReleased: ({ tournamentId, profileId }) => {
      const targetSession = sessions.getByPlayerId(profileId);
      if (!targetSession) return;
      const engagement = targetSession.tournamentEngagement;
      if (engagement && engagement.tournamentId !== tournamentId) return;
      targetSession.tournamentEngagement = null;
      const targetSocket = targetSession.socketId
        ? io.sockets.sockets.get(targetSession.socketId)
        : undefined;
      targetSocket?.emit('room-lost', {
        message: '등록이 마감돼 지각 등록이 취소됐어요 — 참가비는 환불됩니다.',
      });
      sessions.releaseIfIdle(targetSession);
    },
    onTournamentsChanged: () => broadcastTournamentList(),
    // v1 상세(순위표)는 get-tournament 폴링 — 상세 브로드캐스트는 확장 시 도입
    onTournamentUpdate: () => {},
    // wallet MTT 토너 단위 에스크로 — economy 미주입(테스트 등)이면 wallet 개설이 거부된다
    economy: economy
      ? {
          reserveEntry: (profileId, tournamentId, maxEntrants) => {
            economy.reserveMttEntry(profileId, tournamentId, maxEntrants);
          },
          refundEntry: (profileId, tournamentId) => {
            economy.cancelMttEntry(profileId, tournamentId);
          },
          startEscrow: (tournamentId, profileIds) => {
            economy.startMttTournament(tournamentId, profileIds);
          },
          settle: (tournamentId, results, payoutPreset, tableVersion) => {
            economy.settleMttTournament(
              tournamentId,
              results,
              payoutPreset,
              tableVersion,
            );
          },
          refundAll: tournamentId => economy.voidMttTournament(tournamentId),
        }
      : undefined,
  }, {
    persistentRuntimeEnabled: options.persistentRuntimeEnabled
      ?? options.persistentTournamentStart !== undefined,
    persistentRuntimeRegistration:
      options.persistentTournamentRuntimeRegistration,
    persistentLateRegistration: options.persistentLateRegistration,
    persistentSettlement: options.persistentSettlement,
  });
  const tournamentCommands = new TournamentCommandService(
    tournamentManager,
    options.tournamentOperatorProfileIds
      ?? parseTournamentOperatorIds(process.env.TOURNAMENT_OPERATOR_PROFILE_IDS),
    options.persistentTournamentStart,
  );
  const operatorAccess = options.operatorProfileIds
    ? operatorAccessFromSet(options.operatorProfileIds)
    : resolveOperatorAccess(process.env);

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

  // Create default rooms — persistent: 유휴 정리 대상에서 제외. 바이인 범위는 40~200BB 표준.
  //
  // **스테이크 사다리** — 세 방이 블라인드·난이도·경제로 한 줄에 꿰인다:
  //   Practice Dojo(10/20 · 무료 · 혼자) → Sakura Lounge(25/50 · 지갑 · 봇+사람)
  //   → Moonlight Table(50/100 · 지갑 · 고수).
  // 이전엔 Dojo와 Sakura가 둘 다 10/20이라 로비에서 같은 방으로 보였다 — 실제 차이는
  // '혼자만/사람도'와 '무료/지갑'인데 이름과 블라인드가 그걸 전혀 전달하지 못했다
  // (2026-07-26 유저 지적). 방을 늘리지 말고 각 방에 뚜렷한 이유를 줄 것.
  if (createDefaultRooms) {
    // 입구: 휴먼 1명 제한 — 다른 사람 방해 없이 봇들과 연습. 무료라 지갑 부담도 없다
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

    // 첫 실전: 사람이 낄 수 있는 가장 낮은 지갑 테이블
    roomManager.createRoom({
      name: 'Sakura Lounge',
      smallBlind: 25,
      bigBlind: 50,
      minBuyIn: 50 * MIN_BUYIN_BB,
      maxBuyIn: 50 * MAX_BUYIN_BB,
      maxPlayers: 6,
      turnTime: 15,
      difficulty: 'normal',
      botCount: 5, // 캐릭터 쇼케이스 — 휴먼이 오면 봇이 양보
      tableType: 'mixed',
      economyMode: 'wallet',
    }, true);

    // 상위: 공격적인 봇 + 높은 블라인드
    roomManager.createRoom({
      name: 'Moonlight Table',
      smallBlind: 50,
      bigBlind: 100,
      minBuyIn: 100 * MIN_BUYIN_BB,
      maxBuyIn: 100 * MAX_BUYIN_BB,
      maxPlayers: 6,
      turnTime: 15,
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
        storyCoordinator?.sweepExpired();
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
    // 착석 대기석은 grace 없이 즉시 회수 — 지킬 좌석/칩이 없다 (escrow는 hooks가 환불)
    if (roomManager.cancelSeatWaiter(roomId, session.playerId, 'disconnect')) {
      session.roomId = null;
      sessions.releaseIfIdle(session);
      broadcastRoomList();
      return;
    }
    // 유예 시간은 끊기는 시점마다 읽는다 — 핫 컨피그 변경이 이후의 끊김부터 적용 (테스트 오버라이드 우선)
    const graceMs = options.graceMs ?? cfg('timer.graceMs');
    // grace 만료로 좌석이 제거되는 경우 클라이언트가 회수 카운트다운 타임바를 그릴 수 있게 만료 시각 전달
    roomManager.handleDisconnect(roomId, session.playerId, Date.now() + graceMs);
    sessions.startGrace(session, graceMs, () => {
      if (sessions.getByPlayerId(session.playerId) !== session) return;
      const currentRoomId = session.roomId;
      if (!currentRoomId) {
        sessions.releaseIfIdle(session);
        return;
      }
      const seatKept = roomManager.handleGraceExpired(currentRoomId, session.playerId);
      eventLog.log('grace-expired', {
        roomId: currentRoomId,
        playerId: session.playerId,
        data: { seatKept, seats: seatSnapshot(currentRoomId) },
      });
      if (
        !seatKept
        && sessions.getByPlayerId(session.playerId) === session
        && session.roomId === currentRoomId
      ) {
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

    // 클라이언트에 공개 playerId 통지 (히어로 식별용) + 권한. operator는 접속 시점에 한 번 판정한다.
    const isOperator = operatorAccess.has(session.playerId);
    socket.emit('session', {
      playerId: session.playerId,
      capabilities: {
        createTournament: tournamentCommands.canOperateProfile(session.playerId),
        operator: isOperator,
      },
    });

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
    socket.emit('tournament-list', publicTournamentList(session.playerId));

    // 재접속 복원: 세션에 방이 남아 있고 좌석이 유지되어 있으면 그대로 복귀.
    // 방/좌석이 사라졌으면(유휴 정리·grace 만료) room-lost로 클라이언트를 로비로 돌려보낸다.
    const restoreOrEvict = (): void => {
      if (!session.roomId) return;
      const room = roomManager.getRoom(session.roomId);
      const seated = room?.engine.state.players.find(
        p => p.id === session.playerId && !p.pendingRemoval,
      );
      // 착석 대기 중 resync — 대기 상태 그대로 방 스냅샷 재전송 (끊김 시엔 대기가 취소되므로
      // 이 분기는 라이브 소켓의 resync에서만 탄다)
      const waiting = !!room && !seated
        && roomManager.isSeatWaiter(session.roomId, session.playerId);
      if (room && (seated || waiting)) {
        socket.join(session.roomId);
        if (seated) roomManager.handleReconnect(session.roomId, session.playerId);
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
    // 방 없는 스토리 런(드릴·VN 중 새로고침)도 복원 — 방 복원과 독립
    storyCoordinator?.resend(session.playerId);
    socket.emit(
      'arena-queue-update',
      arenaMatchmaker?.getPublicState(session.playerId) ?? { status: 'idle' },
    );

    // --- 수련 스토리 모드: 방 무관 개인 런 (소유권 → payload → 레이트리밋 → 코디네이터) ---
    const storyUnavailable = <T>(ack?: AckCallback<T>): boolean => {
      if (storyCoordinator) return false;
      ack?.({ ok: false, code: 'server-error', message: '수련 스토리를 지금은 사용할 수 없어요.' });
      return true;
    };
    const replyStory = <T>(ack: AckCallback<T> | undefined, result: CoordinatorResult<T>): void => {
      if (result.ok) ack?.({ ok: true, data: result.value });
      else ack?.({ ok: false, code: result.code, message: result.message });
    };
    // 스토리 런이 살아 있는 동안(방 없는 씬·드릴 포함)은 다른 테이블 착석/개설/아레나 대기열/토너 등록을
    // 거절한다 — 일반 membership 전환(commitRoomMembership)·토너 착석·아레나 매칭이 스토리 방 좌석을
    // leaveRoom으로 회수하면 abandon-story를 거치지 않은 이탈이 되고, 방 없는 런은 뒤늦게 열리는 라이브
    // 스텝이 토너/아레나 좌석을 밀어낸다 (이탈은 abandon-story 단일 경로, 런과 실전 참가는 상호 배타)
    const rejectDuringStoryRun = <T>(ack?: AckCallback<T>): boolean => {
      const inStoryRoom = !!session.roomId && !!roomManager.getRoom(session.roomId)?.config.storyChapterId;
      if (!inStoryRoom && !storyCoordinator?.getActiveRun(session.playerId)) return false;
      ack?.({
        ok: false,
        code: 'action-rejected',
        message: '수련 중에는 다른 테이블에 앉을 수 없어요 — 먼저 [수련 그만두기]를 눌러 주세요.',
      });
      return true;
    };
    // 반대 방향: 테이블 착석·토너 배정/등록·아레나 대기 중엔 스토리 런을 시작하지 않는다
    const rejectStoryStartWhileBusy = <T>(ack?: AckCallback<T>): boolean => {
      const registeredTournament = publicTournamentList(session.playerId).tournaments.some(tournament => {
        if (!tournament.registered) return false;
        const stage = tournament.lifecycle ?? 'registering';
        return stage !== 'completed' && stage !== 'cancelled';
      });
      if (
        !session.roomId
        && !session.tournamentEngagement
        && !arenaMatchmaker?.hasBlockingParticipation(session.playerId)
        && !registeredTournament
      ) {
        return false;
      }
      ack?.({
        ok: false,
        code: 'action-rejected',
        message: '테이블·토너먼트·아레나 참가를 먼저 마친 뒤 수련을 시작할 수 있어요.',
      });
      return true;
    };
    const storyNotReady = <T>(ack?: AckCallback<T>): void => {
      ack?.({ ok: false, code: 'action-rejected', message: '이 기능은 아직 준비 중이에요.' });
    };

    socket.on('get-story-progress', (...rawArgs: unknown[]) => {
      const args = parsePayloadlessArgs<StoryProgressView>(rawArgs);
      if (!args.ok) {
        invalidPayload(args.ack);
        return;
      }
      const { ack } = args;
      if (!ensureOwnership(ack)) return;
      if (storyUnavailable(ack)) return;
      if (!ensureRateLimit('story', '요청이 너무 빨라요. 잠시 후 다시 시도해 주세요.', ack)) return;
      ack?.({ ok: true, data: storyCoordinator!.getProgress(session.playerId) });
    });

    socket.on('retry-story-sparring', (...rawArgs: unknown[]) => {
      const args = parseRequiredPayloadArgs<{ runId: string }>(rawArgs);
      if (!args.ok) { invalidPayload(args.ack); return; }
      const { payload, ack } = args;
      if (!ensureOwnership(ack)) return;
      const parsed = parseRetryStorySparringRequest(payload);
      if (!parsed.ok) { invalidPayload(ack); return; }
      if (storyUnavailable(ack)) return;
      if (!ensureRateLimit('storyStart', '챕터 시작 요청이 너무 빨라요.', ack)) return;
      // The existing retry owns its live room: an ACK retransmission must not fail table admission.
      if (!storyCoordinator!.currentSparringRetry(session.playerId, parsed.value.failedRunId)
        && rejectStoryStartWhileBusy(ack)) return;
      replyStory(ack, storyCoordinator!.retrySparring(session.playerId, parsed.value.failedRunId));
    });

    socket.on('start-story-chapter', (...rawArgs: unknown[]) => {
      const args = parseRequiredPayloadArgs<{ runId: string }>(rawArgs);
      if (!args.ok) {
        invalidPayload(args.ack);
        return;
      }
      const { payload, ack } = args;
      if (!ensureOwnership(ack)) return;
      const parsed = parseStartStoryChapterRequest(payload);
      if (!parsed.ok) {
        invalidPayload(ack);
        return;
      }
      if (storyUnavailable(ack)) return;
      if (!ensureRateLimit('storyStart', '챕터 시작 요청이 너무 빨라요.', ack)) return;
      if (rejectStoryStartWhileBusy(ack)) return;
      const mode = parsed.value.mode ?? 'full';
      const started = storyCoordinator!.start(session.playerId, parsed.value.chapterId, mode, { operator: isOperator });
      if (started.ok) eventLog.log('story-step', { playerId: session.playerId, data: { chapterId: parsed.value.chapterId, runId: started.value.runId, step: 'start', mode } });
      replyStory(ack, started);
    });

    socket.on('story-advance', (...rawArgs: unknown[]) => {
      const args = parseRequiredPayloadArgs(rawArgs);
      if (!args.ok) {
        invalidPayload(args.ack);
        return;
      }
      const { payload, ack } = args;
      if (!ensureOwnership(ack)) return;
      const parsed = parseStoryAdvanceRequest(payload);
      if (!parsed.ok) {
        invalidPayload(ack);
        return;
      }
      if (storyUnavailable(ack)) return;
      if (!ensureRateLimit('story', '요청이 너무 빨라요. 잠시 후 다시 시도해 주세요.', ack)) return;
      const advanced = storyCoordinator!.advance(session.playerId, parsed.value, { operator: isOperator });
      if (advanced.ok) {
        const view = storyCoordinator!.getView(session.playerId);
        eventLog.log('story-step', { playerId: session.playerId, data: { runId: parsed.value.runId, from: parsed.value.expectedStepIndex, target: parsed.value.target, to: view?.stepIndex ?? null, phase: view?.phase ?? 'ended' } });
      }
      replyStory(ack, advanced);
    });

    socket.on('story-choice', (...rawArgs: unknown[]) => {
      const args = parseRequiredPayloadArgs(rawArgs);
      if (!args.ok) {
        invalidPayload(args.ack);
        return;
      }
      const { payload, ack } = args;
      if (!ensureOwnership(ack)) return;
      const parsed = parseStoryChoiceRequest(payload);
      if (!parsed.ok) {
        invalidPayload(ack);
        return;
      }
      if (storyUnavailable(ack)) return;
      if (!ensureRateLimit('story', '요청이 너무 빨라요. 잠시 후 다시 시도해 주세요.', ack)) return;
      replyStory(ack, storyCoordinator!.choose(session.playerId, parsed.value));
    });

    socket.on('story-drill', (...rawArgs: unknown[]) => {
      const args = parseRequiredPayloadArgs(rawArgs);
      if (!args.ok) {
        invalidPayload(args.ack);
        return;
      }
      const { payload, ack } = args;
      if (!ensureOwnership(ack)) return;
      const parsed = parseStoryDrillRequest(payload);
      if (!parsed.ok) {
        invalidPayload(ack);
        return;
      }
      if (storyUnavailable(ack)) return;
      if (!ensureRateLimit('story', '요청이 너무 빨라요. 잠시 후 다시 시도해 주세요.', ack)) return;
      const drilled = storyCoordinator!.drill(session.playerId, parsed.value);
      if (drilled.ok && drilled.value.action === 'answer') {
        eventLog.log('drill-answer', { playerId: session.playerId, data: { runId: parsed.value.runId, setId: parsed.value.setId, index: parsed.value.index, templateId: drilled.value.result.templateId, correct: drilled.value.result.correct, hintsUsed: drilled.value.result.hintsUsed, streak: drilled.value.result.streak } });
      }
      replyStory(ack as AckCallback<StoryDrillAck> | undefined, drilled);
    });

    socket.on('story-quiz', (...rawArgs: unknown[]) => {
      const args = parseRequiredPayloadArgs(rawArgs);
      if (!args.ok) {
        invalidPayload(args.ack);
        return;
      }
      const { payload, ack } = args;
      if (!ensureOwnership(ack)) return;
      if (!parseStoryQuizRequest(payload).ok) {
        invalidPayload(ack);
        return;
      }
      if (storyUnavailable(ack)) return;
      if (!ensureRateLimit('story', '요청이 너무 빨라요. 잠시 후 다시 시도해 주세요.', ack)) return;
      storyNotReady(ack); // Phase 2: 라이브 리딩 퀴즈
    });

    socket.on('story-daily', (...rawArgs: unknown[]) => {
      const args = parseOptionalPayloadArgs<{ runId: string }>(rawArgs);
      if (!args.ok) {
        invalidPayload(args.ack);
        return;
      }
      const { ack } = args;
      if (!ensureOwnership(ack)) return;
      if (storyUnavailable(ack)) return;
      if (!ensureRateLimit('storyStart', '오늘의 수련 시작 요청이 너무 빨라요.', ack)) return;
      const daily = storyCoordinator!.startDaily(session.playerId);
      if (daily.ok) eventLog.log('daily-drill', { playerId: session.playerId, data: { runId: daily.value.runId, step: 'start' } });
      replyStory(ack, daily);
    });

    socket.on('abandon-story', (...rawArgs: unknown[]) => {
      const args = parseRequiredPayloadArgs(rawArgs);
      if (!args.ok) {
        invalidPayload(args.ack);
        return;
      }
      const { payload, ack } = args;
      if (!ensureOwnership(ack)) return;
      const parsed = parseAbandonStoryRequest(payload);
      if (!parsed.ok) {
        invalidPayload(ack);
        return;
      }
      if (storyUnavailable(ack)) return;
      if (!ensureRateLimit('story', '요청이 너무 빨라요. 잠시 후 다시 시도해 주세요.', ack)) return;
      replyStory(ack, storyCoordinator!.abandon(session.playerId, parsed.value.runId));
    });

    socket.on('arena-queue-join', (...rawArgs: unknown[]) => {
      const args = parsePayloadlessArgs(rawArgs);
      if (!args.ok) {
        invalidPayload(args.ack);
        return;
      }
      const { ack } = args;
      if (!ensureOwnership(ack)) return;
      if (rejectDuringStoryRun(ack)) return;
      if (session.tournamentEngagement) {
        ack?.({
          ok: false,
          code: 'action-rejected',
          message: '토너먼트 좌석을 배정 중이에요.',
        });
        return;
      }
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
      const args = parseOptionalPayloadArgs(rawArgs);
      if (!args.ok) {
        invalidPayload(args.ack);
        return;
      }
      const { payload, ack } = args;
      if (!ensureOwnership(ack)) return;
      const parsed = parseTournamentResyncRequest(payload);
      if (!parsed.ok) {
        invalidPayload(ack);
        return;
      }
      if (!ensureRateLimit('roomSync', '동기화 요청이 너무 빠릅니다. 잠시 후 다시 시도해 주세요.', ack)) return;
      if (session.roomId) {
        restoreOrEvict();
      } else {
        const storedEngagement = session.tournamentEngagement;
        if (
          storedEngagement
          && parsed.value
          && (
            parsed.value.tournamentId !== storedEngagement.tournamentId
            || parsed.value.requestId !== storedEngagement.requestId
          )
        ) {
          ack?.({
            ok: false,
            code: 'action-rejected',
            message: '현재 좌석 배정 요청과 일치하지 않아요.',
          });
          return;
        }
        const requested = storedEngagement ?? parsed.value ?? undefined;
        if (requested) {
          let durableEngagement: TournamentRegistrationEngagement | null = null;
          let tournament: PublicTournamentSummary | undefined;
          try {
            durableEngagement = persistentTournamentPorts
              ?.readTournamentEngagement?.(
                requested.tournamentId,
                session.playerId,
              ) ?? null;
            tournament = persistentTournamentPorts?.listPublicTournaments?.(
              session.playerId,
              Date.now(),
            ).find(candidate => candidate.id === requested.tournamentId);
          } catch {
            durableEngagement = null;
            tournament = undefined;
          }
          if (
            !storedEngagement
            && durableEngagement
            && requested.requestId !== durableEngagement.requestId
          ) {
            ack?.({
              ok: false,
              code: 'action-rejected',
              message: '현재 토너먼트 등록 요청과 일치하지 않아요.',
            });
            return;
          }
          const durableMatchesStored = !storedEngagement || (
            durableEngagement?.tournamentId === storedEngagement.tournamentId
            && durableEngagement.requestId === storedEngagement.requestId
          );
          if (
            !durableEngagement
            || durableEngagement.tournamentId !== requested.tournamentId
            || !durableMatchesStored
            || !tournament
          ) {
            session.tournamentEngagement = null;
            sessions.releaseIfIdle(session);
            socket.emit('room-lost', {
              message: '토너먼트 좌석 배정 세션이 만료되어 로비로 돌아왔어요.',
            });
            ack?.({ ok: true });
            return;
          }
          const canonicalRequestId = durableEngagement.requestId;
          if (
            durableEngagement.status === 'late-pending'
            && tournament.myRegistrationStatus === 'late-pending'
          ) {
            session.tournamentEngagement = {
              kind: 'late-pending',
              tournamentId: durableEngagement.tournamentId,
              requestId: canonicalRequestId,
            };
            socket.emit('late-registration-seating', {
              tournamentId: durableEngagement.tournamentId,
              requestId: canonicalRequestId,
              status: 'seating',
            });
            ack?.({ ok: true });
            return;
          }
          if (
            durableEngagement.status === 'seated'
            && tournament.myRegistrationStatus === 'seated'
          ) {
            session.tournamentEngagement = {
              kind: 'late-pending',
              tournamentId: durableEngagement.tournamentId,
              requestId: canonicalRequestId,
            };
            const roomId = findLiveTournamentRoom(
              durableEngagement.tournamentId,
              session.playerId,
            );
            if (roomId) {
              const projected = projectLateTournamentSeat(
                session,
                durableEngagement.tournamentId,
                roomId,
              );
              if (!projected) {
                session.tournamentEngagement = null;
                sessions.releaseIfIdle(session);
                socket.emit('room-lost', {
                  message: '토너먼트 좌석을 복구하지 못해 로비로 돌아왔어요.',
                });
              }
            }
            ack?.({ ok: true });
            return;
          }
          session.tournamentEngagement = null;
          sessions.releaseIfIdle(session);
          socket.emit('room-lost', {
            message: '토너먼트 좌석 배정이 종료되어 로비로 돌아왔어요.',
          });
          ack?.({ ok: true });
          return;
        }
        // 방 없는 스토리 런(드릴·VN 진행 중) — room-lost 대신 스토리 뷰를 재전송
        if (storyCoordinator?.resend(session.playerId)) {
          ack?.({ ok: true });
          return;
        }
        // roomId 없음 = 서버 재시작·grace 만료·다른 탭 퇴장 등 여러 원인 — 원인 단정 없이 중립 안내
        socket.emit('room-lost', { message: '게임 세션이 만료되어 로비로 돌아왔어요. 다시 입장해 주세요.' });
      }
      ack?.({ ok: true });
    });

    // Join room
    socket.on('join-room', (...rawArgs: unknown[]) => {
      const args = parseRequiredPayloadArgs<{ roomId: string; status?: 'waiting' }>(rawArgs);
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
      if (session.tournamentEngagement) {
        ack?.({
          ok: false,
          code: 'action-rejected',
          message: '토너먼트 좌석을 배정 중이에요.',
        });
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
      // 스토리 방 히어로의 본인 방 재입장(게임 복귀)은 허용, 다른 방 착석은 거절
      if (session.roomId !== roomId && rejectDuringStoryRun(ack)) return;
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
      if (roomManager.isPreparedMttRoom(roomId)) {
        eventLog.log('join-room:reject', {
          roomId,
          playerId: session.playerId,
          data: { reason: 'mtt-setup' },
        });
        ack?.({
          ok: false,
          code: 'action-rejected',
          message: '토너먼트 테이블을 준비 중이에요. 잠시 후 다시 시도해 주세요.',
        });
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
      // MTT 테이블은 직접 입장 불가 — 좌석 배정·이동은 전부 TournamentManager가 주도한다.
      // 예외: 자리비움으로 떠난 본인의 생존 좌석 복귀(게임 복귀)는 허용 — 아래 멱등
      // 재입장 경로가 새 Player를 만들지 않고 기존 좌석에 세션만 다시 붙인다.
      if (room.config.tournamentId) {
        const myAliveSeat = room.engine.state.players.some(p => (
          p.id === session.playerId && !p.finishPlace && !p.pendingRemoval
        ));
        if (!myAliveSeat) {
          eventLog.log('join-room:reject', {
            roomId,
            playerId: session.playerId,
            data: { reason: 'mtt-table' },
          });
          ack?.({
            ok: false,
            code: 'action-rejected',
            message: '토너먼트 테이블은 로비에서 등록해 참가해요.',
          });
          return;
        }
      }
      // 스토리 라이브 스텝 방은 직접 입장 불가 — 어댑터가 앉힌 히어로 본인의 재입장(게임 복귀)만
      // 허용한다. 목록에도 없는 방이므로 존재를 드러내지 않고 room-not-found로 답한다.
      if (room.config.storyChapterId) {
        const mySeat = room.engine.state.players.some(p => p.id === session.playerId && !p.pendingRemoval);
        if (!mySeat) {
          eventLog.log('join-room:reject', {
            roomId, playerId: session.playerId, data: { reason: 'story-room' },
          });
          ack?.({ ok: false, code: 'room-not-found', message: '방을 찾을 수 없어요.' });
          return;
        }
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
          // 토너먼트(SnG/MTT) 좌석은 리바이 불가 — MTT 복귀 좌석이 칩을 새로 받으면 안 된다
          if (
            room.config.gameMode !== 'sng'
            && room.config.gameMode !== 'mtt'
            && !room.config.storyChapterId // 스토리 방 파산은 리바이가 아니라 어댑터의 실패 분기
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

      // 착석 대기 중 재요청(더블클릭/새 시도) — 멱등 응답으로 대기 유지
      if (roomManager.isSeatWaiter(roomId, session.playerId)) {
        socket.emit('room-joined', {
          roomId,
          gameState: {
            ...room.engine.getPublicState(session.playerId),
            turnTimeRemaining: roomManager.getTurnTimeRemaining(roomId),
          },
          chatHistory: roomManager.getChatHistory(roomId),
        });
        ack?.({ ok: true, data: { roomId, status: 'waiting' } });
        return;
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
      // 핸드 진행 중 splice는 인덱스를 밀어 핸드를 깨뜨리므로 즉시 착석은 불가 — 대신
      // 관전 대기(seat waiter)로 입장시키고, 핸드가 끝나면 봇 퇴장→착석을 순차 진행한다.
      let botToRemove: Player | null = null;
      let waitForSeat = false;
      if (room.engine.state.players.length >= 6) {
        if (room.engine.state.isHandInProgress) {
          const bot = room.engine.state.players.find(p => p.type === 'bot' && !p.pendingRemoval);
          if (!bot) {
            eventLog.log('join-room:reject', {
              roomId, playerId: session.playerId, data: { reason: 'room-full-humans' },
            });
            ack?.({
              ok: false,
              code: 'room-full',
              message: '자리가 모두 찼어요 — 새 방을 만들어 바로 시작해 보세요!',
            });
            return;
          }
          // 봇 양보 마킹은 enqueueSeatWaiter가 대기 등록과 함께 수행 (아래 waiting 경로)
          waitForSeat = true;
        } else {
          // 핸드 사이: 예약된 봇(pendingRemoval) 포함 아무 봇이나 즉시 정리하고 그 자리에 착석
          botToRemove = room.engine.state.players.find(p => p.type === 'bot') ?? null;
          if (!botToRemove) {
            ack?.({
              ok: false,
              code: 'room-full',
              message: '자리가 모두 찼어요 — 새 방을 만들어 바로 시작해 보세요!',
            });
            return;
          }
          assignedSeat = botToRemove.seatIndex;
        }
      }

      // 빈 좌석 탐색이 실패하면 assignedSeat이 -1로 남는다 — 그대로 앉히면 좌석 좌표가 없는
      // 유령 플레이어가 생겨(팟에는 참여) 테이블이 어그러진다. 여기서 끊는다.
      // (착석 대기는 좌석을 나중에 배정받으므로 예외)
      if (!waitForSeat && (assignedSeat < 0 || assignedSeat > 5)) {
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
        // 착석 대기는 좌석 미정(-1) — 실제 좌석은 착석 시점에 RoomManager가 배정
        seatIndex: waitForSeat ? -1 : assignedSeat,
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

      // 착석 대기 경로 — escrow까지 연 상태로 대기 등록. 취소(이탈/끊김/방 정리) 시 hooks가
      // escrow 환불과 room-lost 안내를 수행한다. 착석 자체는 핸드 종료 후 RoomManager가 진행.
      if (waitForSeat) {
        let escrowActive = admissionOpened !== null;
        const refundWaiterEscrow = (): void => {
          if (!escrowActive) return;
          escrowActive = false;
          try {
            if (admissionOpened === 'sng') {
              economy?.cancelSngEntry(session.playerId, roomId);
            } else if (admissionOpened === 'cash') {
              economy?.cancelCashEscrow(session.playerId, roomId);
            }
          } catch {
            eventLog.log('join-room:compensation-failed', {
              roomId,
              playerId: session.playerId,
              data: { reason: 'economy-unavailable' },
            });
          }
        };
        const enqueued = roomManager.enqueueSeatWaiter(roomId, player, {
          onCancelled: (reason, message) => {
            refundWaiterEscrow();
            // self-leave는 leave-room ack가 클라이언트 상태를 정리한다 — room-lost 불필요
            if (reason === 'self-leave') return;
            const waiterSession = sessions.getByPlayerId(session.playerId);
            if (!waiterSession || waiterSession.roomId !== roomId) return;
            waiterSession.roomId = null;
            const waiterSocket = waiterSession.socketId
              ? io.sockets.sockets.get(waiterSession.socketId)
              : undefined;
            if (waiterSocket) {
              waiterSocket.leave(roomId);
              waiterSocket.emit('room-lost', { message });
            }
          },
        });
        if (enqueued !== 'waiting') {
          refundWaiterEscrow();
          eventLog.log('join-room:reject', {
            roomId,
            playerId: session.playerId,
            data: { reason: `seat-waiter-${enqueued}`, seats: seatSnapshot(roomId) },
          });
          ack?.({
            ok: false,
            code: 'room-full',
            message: '자리가 모두 찼어요 — 새 방을 만들어 바로 시작해 보세요!',
          });
          return;
        }
        if (!commitRoomMembership(roomId)) {
          // cancelSeatWaiter가 hooks 경유로 escrow를 환불한다 (roomId 미커밋이라 room-lost는 생략됨)
          roomManager.cancelSeatWaiter(roomId, session.playerId, 'seat-unavailable');
          ack?.({
            ok: false,
            code: 'server-error',
            message: '저장 연결을 확인 중이에요. 잠시 후 다시 시도해 주세요.',
          });
          return;
        }
        eventLog.log('join-room:waiting', {
          roomId,
          playerId: session.playerId,
          data: { name: playerName, chips: player.chips, seats: seatSnapshot(roomId) },
        });
        socket.emit('room-joined', {
          roomId,
          gameState: {
            ...room.engine.getPublicState(session.playerId),
            turnTimeRemaining: roomManager.getTurnTimeRemaining(roomId),
          },
          chatHistory: roomManager.getChatHistory(roomId),
        });
        ack?.({ ok: true, data: { roomId, status: 'waiting' } });
        return;
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
        // 착석 대기 중 나가기 — 대기 취소 (hooks가 escrow 환불, 클라 정리는 이 ack가 담당)
        if (roomManager.cancelSeatWaiter(roomId, session.playerId, 'self-leave')) {
          socket.leave(roomId);
          session.roomId = null;
          broadcastRoomList();
          ack?.({ ok: true });
          return;
        }
        // 스토리 라이브 스텝 방은 leave-room 전 모드를 거절한다 — 이탈은 abandon-story 단일 경로.
        // (자리비움/예약 퇴장/즉시 퇴장 모두 히어로 좌석 회수 → 빈 방 dispose → 런 사망으로 이어진다)
        if (roomManager.getRoom(roomId)?.config.storyChapterId) {
          ack?.({
            ok: false,
            code: 'action-rejected',
            message: '수련 중에는 [수련 그만두기]로만 테이블을 나갈 수 있어요.',
          });
          return;
        }
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
        // MTT 생존 좌석의 퇴장은 전부 자리비움으로 — 즉시 기권 탈락은 없다 (TDA 30:
        // 자리에 없어도 딜인되고 블라인드·앤티가 계속 나간다 → 칩 소진 시 자연 탈락).
        // 탈락 확정/종료 후 관전 좌석은 아래 일반 leave 경로로 정리된다.
        const leavingRoom = roomManager.getRoom(roomId);
        const mttAliveSeat = leavingRoom?.config.gameMode === 'mtt'
          && !leavingRoom.engine.state.tournament?.finished
          && leavingRoom.engine.state.players.some(p => (
            p.id === session.playerId && !p.finishPlace && !p.pendingRemoval
          ));
        if (data.mode === 'sitout' || mttAliveSeat) {
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

    // 칩 추가(바이인 탑업) — 목표 스택까지 지갑에서 채운다
    socket.on('cash-top-up', (...rawArgs: unknown[]) => {
      const args = parseRequiredPayloadArgs<{
        status: 'applied' | 'queued';
        chips: number;
      }>(rawArgs);
      if (!args.ok) {
        invalidPayload(args.ack);
        return;
      }
      const { payload, ack } = args;
      if (!ensureOwnership(ack)) return;
      if (!isRecord(payload) || !Number.isSafeInteger(payload.targetChips)) {
        invalidPayload(ack);
        return;
      }
      if (!session.roomId) {
        ack?.({ ok: false, code: 'action-rejected', message: '현재 참가 중인 방이 없어요.' });
        return;
      }
      if (!ensureRateLimit('playerAction', '요청이 너무 빠릅니다. 잠시 후 다시 시도해 주세요.', ack)) return;
      const result = roomManager.requestCashTopUp(
        session.roomId,
        session.playerId,
        payload.targetChips as number,
      );
      if (result.status === 'applied') {
        ack?.({ ok: true, data: { status: 'applied', chips: result.chips } });
        return;
      }
      if (result.status === 'queued') {
        ack?.({ ok: true, data: { status: 'queued', chips: result.target } });
        return;
      }
      const message = result.status === 'invalid'
        ? `현재 스택보다 많고 ${result.maxTarget.toLocaleString()} 이하로 정해 주세요.`
        : result.status === 'busted'
          ? '칩이 모두 떨어졌어요 — 리바이로 다시 앉아 주세요.'
          : result.status === 'declined'
            ? '지갑 잔액이 부족하거나 지금은 칩을 추가할 수 없어요.'
            : result.status === 'not-cash'
              ? '토너먼트에서는 칩을 추가할 수 없어요.'
              : '지금은 칩을 추가할 수 없어요.';
      ack?.({ ok: false, code: 'action-rejected', message });
    });

    // 초대 코드 조회 — 6자리는 인증이 아니라 조회 키다. 무차별 대입을 막으려면
    // 반드시 레이트리밋을 건다(입장 버킷 공유: 5회/10초).
    socket.on('resolve-invite', (...rawArgs: unknown[]) => {
      const args = parseRequiredPayloadArgs<{
        kind: 'room' | 'tournament';
        id: string;
      }>(rawArgs);
      if (!args.ok) {
        invalidPayload(args.ack);
        return;
      }
      const { payload, ack } = args;
      if (!ensureOwnership(ack)) return;
      if (!isRecord(payload) || typeof payload.code !== 'string') {
        invalidPayload(ack);
        return;
      }
      if (!ensureRateLimit('joinRoom', '코드 확인이 너무 잦습니다. 잠시 후 다시 시도해 주세요.', ack)) return;
      const target = roomManager.invites.resolve(payload.code);
      // 방은 살아 있어야 의미가 있다 (토너먼트는 매니저가 다시 확인한다)
      const alive = target?.kind === 'room'
        ? roomManager.resolveRoomInvite(payload.code) !== null
        : target !== null;
      if (!target || !alive) {
        ack?.({
          ok: false,
          code: 'room-not-found',
          message: '그런 초대 코드는 없어요. 다시 확인해 주세요.',
        });
        return;
      }
      ack?.({ ok: true, data: { kind: target.kind, id: target.id } });
    });

    socket.on('cancel-cash-top-up', (...rawArgs: unknown[]) => {
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
      if (!ensureRateLimit('playerAction', '요청이 너무 빠릅니다. 잠시 후 다시 시도해 주세요.', ack)) return;
      roomManager.cancelCashTopUp(session.roomId, session.playerId);
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
      if (rejectDuringStoryRun(ack)) return;
      const config = parsed.value;
      // 운영 가드: 방 수 상한
      if (roomManager.getRoomCount() >= cfg('table.maxRooms')) {
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
        turnTime: Math.min(Math.max(Number(config.turnTime) || 15, 5), 60),
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

    // --- MTT (멀티테이블 토너먼트) ---

    socket.on('get-tournaments', (...rawArgs: unknown[]) => {
      const args = parsePayloadlessArgs<TournamentListPayload>(rawArgs);
      if (!args.ok) {
        invalidPayload(args.ack);
        return;
      }
      const { ack } = args;
      if (!ensureOwnership(ack)) return;
      if (!ensureRateLimit('roomSync', '동기화 요청이 너무 빠릅니다. 잠시 후 다시 시도해 주세요.', ack)) return;
      const list = publicTournamentList(session.playerId);
      socket.emit('tournament-list', list);
      ack?.({ ok: true, data: list });
    });

    socket.on('get-tournament', (...rawArgs: unknown[]) => {
      const args = parseRequiredPayloadArgs<TournamentDetailView>(rawArgs);
      if (!args.ok) {
        invalidPayload(args.ack);
        return;
      }
      const { payload, ack } = args;
      if (!ensureOwnership(ack)) return;
      if (!isRecord(payload) || typeof payload.tournamentId !== 'string') {
        invalidPayload(ack);
        return;
      }
      if (!ensureRateLimit('roomSync', '동기화 요청이 너무 빠릅니다. 잠시 후 다시 시도해 주세요.', ack)) return;
      const detail = liveTournamentDetail(payload.tournamentId, session.playerId)
        ?? persistentTournamentDetail(payload.tournamentId, session.playerId);
      if (!detail) {
        ack?.({ ok: false, code: 'room-not-found', message: '토너먼트를 찾을 수 없어요.' });
        return;
      }
      ack?.({ ok: true, data: detail });
    });

    socket.on('create-tournament', (...rawArgs: unknown[]) => {
      const args = parseRequiredPayloadArgs<{ tournamentId: string }>(rawArgs);
      if (!args.ok) {
        invalidPayload(args.ack);
        return;
      }
      const { payload, ack } = args;
      if (!ensureOwnership(ack)) return;
      const authority = { kind: 'operator-profile', profileId: session.playerId } as const;
      if (!tournamentCommands.canOperateProfile(session.playerId)) {
        ack?.({
          ok: false,
          code: 'forbidden',
          message: '운영자만 토너먼트를 개설할 수 있어요.',
        });
        return;
      }
      if (!ensureRateLimit('createRoom', '토너먼트 개설 요청이 너무 빠릅니다. 잠시 후 다시 시도해 주세요.', ack)) return;
      // Canonical v2 commands never fall through to the lossy legacy adapter,
      // even while the runtime rollout flag keeps legacy commands available.
      if (isRecord(payload) && 'requestId' in payload) {
        const created = tournamentCommands.createPersistentInstance(
          authority,
          payload,
        );
        if (!created.ok) {
          ack?.({
            ok: false,
            code: created.code === 'forbidden'
              ? 'forbidden'
              : created.code === 'invalid-payload'
                ? 'invalid-payload'
                : 'action-rejected',
            message: created.code === 'promotion-insufficient'
              ? '프리롤 운영 기금이 부족해 토너먼트를 개설하지 못했습니다.'
              : created.code === 'invalid-payload'
                ? '토너먼트 설정이 올바르지 않아요.'
                : '토너먼트를 개설하지 못했습니다.',
          });
          return;
        }
        ack?.({
          ok: true,
          data: { tournamentId: created.instance.id },
        });
        return;
      }
      if (
        !isRecord(payload)
        || typeof payload.name !== 'string'
        || payload.name.trim().length === 0
        || payload.name.trim().length > 30
        || !VALID_MTT_SPEEDS.includes(payload.speed as MttSpeed)
        || typeof payload.maxEntrants !== 'number'
        || !Number.isInteger(payload.maxEntrants)
        || typeof payload.botFill !== 'boolean'
        || typeof payload.turnTime !== 'number'
        || !VALID_TURN_TIMES.includes(payload.turnTime)
        || !(payload.economyMode === undefined
          || payload.economyMode === 'practice'
          || payload.economyMode === 'wallet')
        || !PAYOUT_PRESET_IDS.includes(payload.payoutPreset as never)
        || !(payload.startAt === null
          || (typeof payload.startAt === 'number'
            && payload.startAt > Date.now() - 10_000
            && payload.startAt < Date.now() + 24 * 60 * 60_000))
      ) {
        invalidPayload(ack);
        return;
      }
      const economyMode = payload.economyMode === 'wallet' ? 'wallet' : 'practice';
      if (economyMode === 'wallet' && payload.botFill) {
        ack?.({
          ok: false,
          code: 'action-rejected',
          message: '지갑 토너먼트는 봇을 채울 수 없어요.',
        });
        return;
      }
      const created = tournamentCommands.create(authority, {
        name: payload.name.trim(),
        speed: payload.speed as MttSpeed,
        maxEntrants: payload.maxEntrants,
        startAt: payload.startAt,
        botFill: payload.botFill,
        turnTime: payload.turnTime,
        economyMode,
        payoutPreset: payload.payoutPreset as (typeof PAYOUT_PRESET_IDS)[number],
      });
      if (!created.ok) {
        ack?.({
          ok: false,
          code: 'action-rejected',
          message: created.reason === 'host-limit'
            ? '한 개설자가 등록 중으로 열어둘 수 있는 토너먼트는 2개까지예요.'
            : created.reason === 'limit'
              ? '동시에 열 수 있는 토너먼트 수를 초과했어요. 잠시 후 다시 시도해 주세요.'
              : '토너먼트 설정이 올바르지 않아요.',
        });
        return;
      }
      ack?.({ ok: true, data: { tournamentId: created.tournamentId } });
    });

    socket.on('register-tournament', (...rawArgs: unknown[]) => {
      const args = parseRequiredPayloadArgs<RegisterTournamentResult>(rawArgs);
      if (!args.ok) {
        invalidPayload(args.ack);
        return;
      }
      const { payload, ack } = args;
      if (!ensureOwnership(ack)) return;
      const parsed = parseRegisterTournamentCommand(payload);
      if (!parsed.ok) {
        invalidPayload(ack);
        return;
      }
      if (rejectDuringStoryRun(ack)) return;
      const command = parsed.value;
      const existing = session.tournamentEngagement;
      if (
        existing
        && options.persistentRuntimeEnabled
        && (
          existing.tournamentId !== command.tournamentId
          || existing.requestId !== command.requestId
        )
      ) {
        ack?.({
          ok: true,
          data: {
            ok: false,
            requestId: command.requestId,
            reason: 'other-tournament',
          },
        });
        return;
      }
      if (existing && !options.persistentRuntimeEnabled) {
        ack?.({
          ok: false,
          code: 'action-rejected',
          message: '이미 참가 중인 토너먼트가 있어요.',
        });
        return;
      }
      if (!ensureRateLimit('joinRoom', '등록 요청이 너무 빠릅니다. 잠시 후 다시 시도해 주세요.', ack)) return;
      if (options.persistentRuntimeEnabled) {
        const result = persistentTournamentPorts?.registerTournament?.({
          command,
          profileId: session.playerId,
          publicPlayer: {
            id: session.playerId,
            name: profileAlias,
            avatar: socket.data.profileAvatarId ?? profileAvatarId,
          },
        }) ?? {
          ok: false as const,
          requestId: command.requestId,
          reason: 'seating-failed' as const,
        };
        if (result.ok && result.status === 'seating') {
          session.tournamentEngagement = {
            kind: 'late-pending',
            tournamentId: result.tournamentId,
            requestId: result.requestId,
          };
          socket.emit('late-registration-seating', {
            tournamentId: result.tournamentId,
            requestId: result.requestId,
            status: 'seating',
          });
        } else if (result.ok && result.status === 'seated') {
          session.tournamentEngagement = {
            kind: 'late-pending',
            tournamentId: result.tournamentId,
            requestId: result.requestId,
          };
          const roomId = findLiveTournamentRoom(
            result.tournamentId,
            session.playerId,
          );
          if (roomId) {
            projectLateTournamentSeat(
              session,
              result.tournamentId,
              roomId,
            );
          }
        } else if (
          !result.ok
          && result.reason === 'request-terminal'
          && existing?.requestId === result.requestId
        ) {
          session.tournamentEngagement = null;
        }
        ack?.({ ok: true, data: result });
        socket.emit('tournament-list', publicTournamentList(session.playerId));
        return;
      }
      if (session.tournamentEngagement
        || tournamentManager.hasActiveEngagement(session.playerId)) {
        ack?.({
          ok: false,
          code: 'action-rejected',
          message: '이미 참가 중인 토너먼트가 있어요 — 한 번에 하나만 참가할 수 있어요.',
        });
        return;
      }
      let result: 'ok' | 'not-found' | 'closed' | 'full' | 'already';
      try {
        result = tournamentManager.register(command.tournamentId, {
          id: session.playerId,
          name: profileAlias,
          avatar: socket.data.profileAvatarId ?? profileAvatarId,
        });
      } catch (error) {
        // wallet 에스크로 예약 실패 — 잔액 부족/이중 좌석을 구분해 안내
        const code = error instanceof EconomyDomainError ? error.code : null;
        ack?.({
          ok: false,
          code: 'action-rejected',
          message: code === 'INSUFFICIENT_BALANCE'
            ? `보유 칩이 부족해요 (참가비 ${MTT_WALLET_ENTRY_COST.toLocaleString()}).`
            : code === 'SNG_ACTIVE_SEAT'
              ? '이미 다른 게임 좌석이나 참가 예약이 있어요 — 먼저 정리해 주세요.'
              : '참가비 예약에 실패했어요. 잠시 후 다시 시도해 주세요.',
        });
        return;
      }
      if (result === 'ok') {
        ack?.({
          ok: true,
          data: {
            ok: true,
            status: 'registered',
            tournamentId: command.tournamentId,
            requestId: command.requestId,
          },
        });
        return;
      }
      const message = {
        'not-found': '토너먼트를 찾을 수 없어요.',
        closed: '등록이 마감된 토너먼트예요.',
        full: '정원이 가득 찼어요.',
        already: '이미 등록되어 있어요.',
      }[result];
      ack?.({
        ok: false,
        code: result === 'not-found' ? 'room-not-found' : 'action-rejected',
        message,
      });
    });

    socket.on('unregister-tournament', (...rawArgs: unknown[]) => {
      const args = parseRequiredPayloadArgs(rawArgs);
      if (!args.ok) {
        invalidPayload(args.ack);
        return;
      }
      const { payload, ack } = args;
      if (!ensureOwnership(ack)) return;
      if (!isRecord(payload) || typeof payload.tournamentId !== 'string') {
        invalidPayload(ack);
        return;
      }
      if (!ensureRateLimit('joinRoom', '요청이 너무 빠릅니다. 잠시 후 다시 시도해 주세요.', ack)) return;
      if (!tournamentManager.unregister(payload.tournamentId, session.playerId)) {
        ack?.({
          ok: false,
          code: 'action-rejected',
          message: '등록을 취소할 수 없어요 (이미 시작됐거나 등록 내역이 없어요).',
        });
        return;
      }
      ack?.({ ok: true });
    });

    socket.on('start-tournament', (...rawArgs: unknown[]) => {
      const args = parseRequiredPayloadArgs(rawArgs);
      if (!args.ok) {
        invalidPayload(args.ack);
        return;
      }
      const { payload, ack } = args;
      if (!ensureOwnership(ack)) return;
      const authority = { kind: 'operator-profile', profileId: session.playerId } as const;
      if (!tournamentCommands.canOperateProfile(session.playerId)) {
        ack?.({ ok: false, code: 'forbidden', message: '운영자만 시작할 수 있어요.' });
        return;
      }
      if (!isRecord(payload) || typeof payload.tournamentId !== 'string') {
        invalidPayload(ack);
        return;
      }
      if (!ensureRateLimit('joinRoom', '요청이 너무 빠릅니다. 잠시 후 다시 시도해 주세요.', ack)) return;
      const result = tournamentCommands.start(authority, payload.tournamentId);
      if (result === 'ok') {
        ack?.({ ok: true });
        return;
      }
      const message = {
        'not-found': '토너먼트를 찾을 수 없어요.',
        forbidden: '운영자만 시작할 수 있어요.',
        'not-registering': '이미 시작됐거나 종료된 토너먼트예요.',
        'not-enough': '시작하려면 접속 중인 참가자가 더 필요해요.',
        economy: '참가비 처리에 실패했어요 — 잠시 후 다시 시도해 주세요.',
      }[result];
      ack?.({
        ok: false,
        code: result === 'not-found'
          ? 'room-not-found'
          : result === 'forbidden'
            ? 'forbidden'
            : 'action-rejected',
        message,
      });
    });

    // 디렉터 콘솔 — 허용된 운영자 프로필 전용. 권한은 공유 명령 계층에서 검증한다.
    socket.on('tournament-admin', (...rawArgs: unknown[]) => {
      const args = parseRequiredPayloadArgs(rawArgs);
      if (!args.ok) {
        invalidPayload(args.ack);
        return;
      }
      const { payload, ack } = args;
      if (!ensureOwnership(ack)) return;
      const authority = { kind: 'operator-profile', profileId: session.playerId } as const;
      if (!tournamentCommands.canOperateProfile(session.playerId)) {
        ack?.({ ok: false, code: 'forbidden', message: '운영자만 관리할 수 있어요.' });
        return;
      }
      if (!isRecord(payload) || typeof payload.tournamentId !== 'string') {
        invalidPayload(ack);
        return;
      }
      if (!ensureRateLimit('joinRoom', '요청이 너무 빠릅니다. 잠시 후 다시 시도해 주세요.', ack)) return;
      let action:
        | { kind: 'pause' }
        | { kind: 'resume' }
        | { kind: 'set-level'; level: number }
        | { kind: 'remove-player'; playerId: string }
        | { kind: 'cancel' };
      switch (payload.action) {
        case 'pause':
        case 'resume':
        case 'cancel':
          action = { kind: payload.action };
          break;
        case 'set-level':
          if (typeof payload.level !== 'number' || !Number.isInteger(payload.level)) {
            invalidPayload(ack);
            return;
          }
          action = { kind: 'set-level', level: payload.level };
          break;
        case 'remove-player':
          if (typeof payload.playerId !== 'string' || payload.playerId.length === 0) {
            invalidPayload(ack);
            return;
          }
          action = { kind: 'remove-player', playerId: payload.playerId };
          break;
        default:
          invalidPayload(ack);
          return;
      }
      const result = tournamentCommands.act(authority, payload.tournamentId, action);
      if (result === 'ok') {
        ack?.({ ok: true });
        return;
      }
      const message = {
        'not-found': '토너먼트를 찾을 수 없어요.',
        forbidden: '운영자만 관리할 수 있어요.',
        'bad-state': '지금 상태에서는 할 수 없는 작업이에요.',
        invalid: '요청 값이 올바르지 않아요.',
      }[result];
      ack?.({
        ok: false,
        code: result === 'not-found'
          ? 'room-not-found'
          : result === 'forbidden'
            ? 'forbidden'
            : 'action-rejected',
        message,
      });
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
    tournamentManager,
    tournamentCommands,
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
    storyProgress: profileId => storyCoordinator?.getProgress(profileId) ?? null,
    revokeProfile: profileId => {
      storyCoordinator?.clearProfile(profileId);
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
      tournamentManager.shutdown();
      storyCoordinator?.dispose();
      storyLiveAdapter?.shutdown();
      sessions.shutdown();
      roomManager.shutdown();
      return report;
    },
  };
}
