import type { Socket } from 'socket.io-client';
import type {
  ActionType,
  ChatMessage,
  FinalTableTheme,
  GameState,
  TournamentHoldReason,
  TournamentStage,
} from '../poker/types';
import type { MttSpeed } from '../poker/mtt-structure';
import type { PayoutPresetId } from '../poker/payout-table';
import type {
  ProgressionRewardSummary,
  ProgressionSnapshot,
} from '../progression/types';
import type { ArenaTier } from '../arena/types';
import type {
  LateRegistrationPolicy,
  PrizePoolPolicy,
  TournamentPayoutPolicy,
  TournamentRecurrence,
  TournamentStructure,
  TournamentStructureSegment,
} from '../tournament/tournament-config';
import type {
  RegistrationCloseReason,
  TournamentInstanceStatusReason,
  TournamentRegistrationState,
  TournamentRegistrationStatus,
} from '../tournament/tournament-state';

export type { MttSpeed };

export type RealtimeErrorCode =
  | 'invalid-payload'
  | 'forbidden'
  | 'rate-limited'
  | 'room-not-found'
  | 'room-full'
  | 'bad-password'
  | 'sng-started'
  | 'practice-occupied'
  | 'session-replaced'
  | 'stale-state'
  | 'not-your-turn'
  | 'action-rejected'
  | 'join-timeout'
  | 'arena-disabled'
  | 'arena-unavailable'
  | 'arena-ineligible'
  | 'arena-busy'
  | 'arena-reserved'
  | 'server-error';

export type RealtimeAck<T = undefined> =
  | { ok: true; data?: T }
  | { ok: false; code: RealtimeErrorCode; message: string };

export type AckCallback<T = undefined> = (ack: RealtimeAck<T>) => void;

export interface RoomListItem {
  id: string;
  name: string;
  playerCount: number;
  maxPlayers: number;
  blinds: string;
  status: string;
  mode?: string;
  locked?: boolean;
  hasPassword?: boolean;
  /** 6자리 초대 코드 — 링크를 못 쓰는 자리(음성·오프라인)용 보조 수단 */
  inviteCode?: string | null;
  bigBlind?: number;
  minBuyIn?: number;
  maxBuyIn?: number;
  economyMode?: 'practice' | 'wallet' | 'arena';
  entryBuyIn?: number;
  entryFee?: number;
  difficulty?: 'easy' | 'normal' | 'hard';
  turnTime?: number;
  humanCount?: number;
  tableType?: 'bots' | 'mixed' | 'humans';
  mySeat?: { chips: number; sittingOut: boolean };
}

export interface JoinRoomRequest {
  roomId: string;
  buyIn: number;
  seatIndex: number;
  password?: string;
}

export interface CreateRoomRequest {
  name: string;
  bigBlind: number;
  turnTime: number;
  gameMode: 'cash' | 'sng';
  difficulty: 'easy' | 'normal' | 'hard';
  tableType: 'bots' | 'mixed' | 'humans';
  botCount: number;
  password?: string;
  /**
   * SnG 참가 방식 (기본 'wallet'). wallet은 지갑 칩 바이인+수수료 에스크로라 사람 6명 전용 —
   * 봇 채우기는 'practice'(무료, 지갑 무관)에서만 가능하다. 캐시 게임에는 적용되지 않는다.
   */
  economyMode?: 'wallet' | 'practice';
}

export interface LeaveRoomRequest {
  /**
   * exit/sitout은 즉시 퇴장. reserve-*는 나가기 예약 (캐시 전용):
   * reserve-hand=이번 핸드 종료 시, reserve-bb=다음 빅블라인드 직전, reserve-cancel=예약 취소.
   * 예약이 즉시 실행 조건이면(핸드 미진행 등) 서버가 그 자리에서 exit로 처리하고
   * ack data.status='left'로 알린다 — 클라이언트는 이때만 방 상태를 정리한다.
   */
  mode: 'exit' | 'sitout' | 'reserve-hand' | 'reserve-bb' | 'reserve-cancel';
}

/** leave-room reserve-* 요청의 ack data */
export interface LeaveReserveAckData {
  status: 'reserved' | 'cleared' | 'left';
}

export interface PlayerActionRequest {
  roomId: string;
  action: ActionType;
  amount?: number;
  expectedHandNumber: number;
  expectedActionSeq: number;
}

export interface GameUpdatePayload {
  roomId: string;
  state: GameState;
}

/** throw-item 요청 payload — 서버가 itemId를 THROWABLE_MAP으로 재검증한다 */
export interface ThrowItemRequest {
  itemId: string;
  targetPlayerId: string;
}

/**
 * 투척 브로드캐스트. 게임 상태와 무관한 즉발 연출 이벤트라 game-update와 분리.
 * roomId envelope는 game-update와 같은 계약 — 클라이언트는 currentRoomId 일치를 검증한다.
 * seatIndex는 emit 시점 스냅샷이라 수신 시 store 상태와 어긋나도 연출은 그대로 가능.
 */
export interface ThrowableThrownPayload {
  roomId: string;
  /** 연출 dedup/react key용 서버 발급 id */
  throwId: string;
  itemId: string;
  fromPlayerId: string;
  fromSeatIndex: number;
  targetPlayerId: string;
  targetSeatIndex: number;
}

export interface RoomJoinedPayload {
  roomId: string;
  gameState: GameState;
  chatHistory: ChatMessage[];
}

// --- MTT (멀티테이블 토너먼트) ---

export type TournamentPhase = 'registering' | 'running' | 'completed' | 'cancelled';

export type PublicTournamentLifecycle =
  | 'upcoming'
  | 'registering'
  | 'start-delayed'
  | 'starting'
  | 'running'
  | 'payout-pending'
  | 'refund-pending'
  | 'completed'
  | 'cancelled';

export interface PublicTournamentSchedule {
  visibleAt: number;
  registrationOpensAt: number;
  scheduledStartsAt: number | null;
  manualStartExpiresAt: number | null;
  actualStartedAt: number | null;
}

export interface PublicTournamentStructure {
  sourcePresetId: 'standard' | 'turbo' | 'hyper' | null;
  startingStack: number;
  segments: readonly TournamentStructureSegment[];
  currentSegmentIndex: number | null;
  currentSegmentEndsAt: number | null;
}

export interface PublicTournamentPayout {
  tableVersion: number;
  presetId: 'top-heavy' | 'standard' | 'flat';
  paidFieldPercent: 10 | 15 | 20;
  status: 'provisional' | 'final';
  totalPrize: number;
  payouts: ReadonlyArray<{ place: number; percent: number; amount: number }>;
  fundingStatus:
    | 'entry-funded'
    | 'promotion-reserved'
    | 'payout-pending'
    | 'settled';
}

export interface PublicTournamentSeat {
  roomId: string;
  tableNo: number;
  seatIndex: number;
}

export interface TournamentSummary {
  id: string;
  name: string;
  lifecycle?: PublicTournamentLifecycle;
  statusReason?: TournamentInstanceStatusReason | null;
  /** @deprecated One-release adapter. New clients use lifecycle. */
  phase: TournamentPhase;
  speed: MttSpeed;
  entrantCount: number; // 등록 인원 (시작 후엔 봇 포함 확정 인원)
  maxEntrants: number;
  tableSize: number;
  remaining: number;
  tableCount: number;
  prizePool: number;
  startAt: number | null;
  startedAt: number | null;
  botFill: boolean;
  hostId: string;
  level: number;
  /** 디렉터 일시정지 중 — 시계 동결·전 테이블 다음 핸드 보류 (Phase 2) */
  paused: boolean;
  /** wallet = 지갑 바이인 에스크로·리얼 칩 상금 (봇 충원 불가). 기본 practice */
  /**
   * v2 projections emit only freeroll or wallet. The practice member keeps the
   * unwired v1 projection type-safe for one compatibility release.
   */
  economyMode: 'freeroll' | 'wallet' | 'practice';
  entryBuyIn: number; // wallet 바이인 (practice는 0)
  entryFee: number; // wallet 수수료 (practice는 0)
  registered?: boolean; // 요청자 기준 등록 여부 (개인화 필드)
  myTableRoomId?: string; // 참가 중이면 내 테이블
  payoutPreset: PayoutPresetId;
  /** 6자리 초대 코드 — 방과 같은 코드 공간 */
  inviteCode?: string | null;
  stage?: TournamentStage;
  holdReasons?: TournamentHoldReason[];
  stageEndsAt?: number;
  finalTheme?: FinalTableTheme;
  schedule?: PublicTournamentSchedule;
  structure?: PublicTournamentStructure;
  payout?: PublicTournamentPayout;
  registrationState?: TournamentRegistrationState;
  registrationCloseReason?: RegistrationCloseReason | null;
  lateRegistrationClosesAt?: number | null;
  minEntrants?: number;
  initialEntrants?: number;
  acceptedEntrants?: number;
  pendingLateEntrants?: number;
  aliveSeated?: number;
  finalEntrants?: number | null;
  botFillToMinimum?: boolean;
  myRegistrationStatus?: TournamentRegistrationStatus | null;
  mySeat?: PublicTournamentSeat | null;
  canRegister?: boolean;
  canCancelRegistration?: boolean;
}

/**
 * Canonical v2 lobby projection. The legacy TournamentSummary stays on the
 * current array wire until the scheduler/runtime integration switches over.
 */
export type PublicTournamentSummary = Omit<
  TournamentSummary,
  | 'lifecycle'
  | 'statusReason'
  | 'phase'
  | 'economyMode'
  | 'schedule'
  | 'structure'
  | 'payout'
  | 'registrationState'
  | 'registrationCloseReason'
  | 'lateRegistrationClosesAt'
  | 'minEntrants'
  | 'initialEntrants'
  | 'acceptedEntrants'
  | 'pendingLateEntrants'
  | 'aliveSeated'
  | 'finalEntrants'
  | 'botFillToMinimum'
  | 'myRegistrationStatus'
  | 'mySeat'
  | 'canRegister'
  | 'canCancelRegistration'
> & {
  lifecycle: PublicTournamentLifecycle;
  statusReason: TournamentInstanceStatusReason | null;
  /** @deprecated One-release adapter. New clients use lifecycle. */
  phase?: TournamentPhase;
  economyMode: 'freeroll' | 'wallet';
  schedule: PublicTournamentSchedule;
  structure: PublicTournamentStructure;
  payout: PublicTournamentPayout;
  registrationState: TournamentRegistrationState;
  registrationCloseReason: RegistrationCloseReason | null;
  lateRegistrationClosesAt: number | null;
  minEntrants: number;
  initialEntrants: number;
  acceptedEntrants: number;
  pendingLateEntrants: number;
  aliveSeated: number;
  finalEntrants: number | null;
  botFillToMinimum: boolean;
  myRegistrationStatus: TournamentRegistrationStatus | null;
  mySeat: PublicTournamentSeat | null;
  canRegister: boolean;
  canCancelRegistration: boolean;
};

export interface TournamentListPayload {
  serverNow: number;
  tournaments: PublicTournamentSummary[];
}

export interface TournamentStandingRow {
  playerId: string;
  name: string;
  chips: number; // 탈락자는 0
  tableNo: number | null;
  place: number | null;
  prize: number;
}

export interface TournamentDetailView {
  summary: TournamentSummary;
  levels: Array<{ level: number; smallBlind: number; bigBlind: number; ante: number }>;
  levelDurationMs: number;
  payouts: Array<{ place: number; prize: number }>;
  entrants: Array<{ id: string; name: string; avatar: string }>;
  standings: TournamentStandingRow[];
  clock: { level: number; onBreak: boolean; segmentRemainingMs: number | null } | null;
  stage?: TournamentStage;
  holdReasons?: TournamentHoldReason[];
  stageEndsAt?: number;
  finalTheme?: FinalTableTheme;
}

export interface CreateTournamentRequest {
  name: string;
  payoutPreset: PayoutPresetId;
  speed: MttSpeed;
  maxEntrants: number; // 8~48
  startAt: number | null; // 예약 시각 (null = 호스트 수동 시작)
  botFill: boolean;
  turnTime: number;
  /** 'wallet' = 지갑 바이인 에스크로 (봇 충원 불가). 생략 시 practice */
  economyMode?: 'practice' | 'wallet';
}

/** Canonical persistent-v2 command emitted by the reviewed seven-stage UI. */
export interface CreatePersistentTournamentRequest {
  requestId: string;
  name: string;
  economyMode: 'freeroll' | 'wallet';
  minEntrants: number;
  maxEntrants: number;
  botFillToMinimum: boolean;
  prizePool: PrizePoolPolicy;
  schedule: {
    visibleAt: number;
    registrationOpensAt: number;
    startsAt: number | null;
    manualStartExpiresAt: number | null;
  };
  recurrence: TournamentRecurrence | null;
  /** 반복 템플릿의 첫 회차 (schedule.startsAt과 같아야 한다). 단발성은 null */
  firstStartsAt: number | null;
  /** 반복 템플릿의 마지막 회차 (포함). 단발성은 null */
  recurrenceEndsAt: number | null;
  visibleLeadMs: number | null;
  registrationLeadMs: number | null;
  turnTimeSeconds: 8 | 15 | 30;
  structure: TournamentStructure;
  payout: TournamentPayoutPolicy;
  lateRegistration: LateRegistrationPolicy;
}

export interface RegisterTournamentCommand {
  tournamentId: string;
  requestId: string;
}

export type RegisterTournamentResult =
  | {
      ok: true;
      status: 'registered' | 'seating' | 'seated';
      tournamentId: string;
      requestId: string;
    }
  | {
      ok: false;
      requestId: string;
      reason: 'request-terminal';
      terminalStatus:
        | 'cancelled'
        | 'refunded'
        | 'no-show'
        | 'eliminated'
        | 'finished';
    }
  | {
      ok: false;
      requestId: string;
      reason:
        | 'not-open'
        | 'late-registration-closed'
        | 'full'
        | 'already-entered'
        | 'eliminated'
        | 'insufficient-balance'
        | 'other-tournament'
        | 'seating-failed';
    };

export interface TournamentSeatAssigned {
  tournamentId: string;
  roomId: string;
  state: GameState;
  chat: ChatMessage[];
}

export interface TournamentResyncRequest {
  tournamentId: string;
  requestId: string;
}

export interface LateRegistrationSeatingPayload {
  tournamentId: string;
  requestId: string;
  status: 'seating';
}

/**
 * 서버 주도 테이블 이동 — room-lost(로비행)와 달리 로비를 경유하지 않고
 * currentRoomId를 새 테이블로 교체한다. gameState는 이동 직후 개인화 스냅샷.
 */
export interface TableMovePayload {
  tournamentId: string;
  fromRoomId: string;
  roomId: string;
  gameState: GameState;
  chatHistory: ChatMessage[];
}

export interface ArenaQueueState {
  status: 'idle' | 'queued' | 'forming' | 'training-offered';
  joinedAt?: number;
}

export interface ArenaResultPayload {
  resultId: string;
  matchId: string;
  training: boolean;
  place: number;
  points: number;
  weeklyRankBefore: number | null;
  weeklyRankAfter: number | null;
  placementGames: number;
  placementMatches: number;
  tier: ArenaTier | null;
}

export interface ArenaStateReplay {
  roomId: string;
  matchId: string;
  training: boolean;
  finished: boolean;
  result: ArenaResultPayload | null;
}

export interface ServerToClientEvents {
  session: (data: {
    playerId: string;
    capabilities: { createTournament: boolean };
  }) => void;
  'session-replaced': (data: { message: string }) => void;
  'room-list': (rooms: RoomListItem[]) => void;
  'tournament-list': (payload: TournamentListPayload) => void;
  'tournament-update': (tournament: PublicTournamentSummary) => void;
  'late-registration-seating': (data: LateRegistrationSeatingPayload) => void;
  'tournament-seat-assigned': (data: TournamentSeatAssigned) => void;
  'table-move': (data: TableMovePayload) => void;
  'room-joined': (data: RoomJoinedPayload) => void;
  'room-lost': (data?: { message?: string }) => void;
  'room-created': (data: { roomId: string }) => void;
  'game-update': (data: GameUpdatePayload) => void;
  'game-update-public': (data: GameUpdatePayload) => void;
  'chat-message': (message: ChatMessage) => void;
  'throwable-thrown': (data: ThrowableThrownPayload) => void;
  'progression-update': (snapshot: ProgressionSnapshot) => void;
  'reward-summary': (summary: ProgressionRewardSummary) => void;
  'arena-queue-update': (data: ArenaQueueState) => void;
  'arena-training-offered': (
    data: { offerId: string; expiresAt: number },
  ) => void;
  'arena-match-found': (
    data: { matchId: string; training: boolean },
  ) => void;
  'arena-result': (data: ArenaResultPayload) => void;
  'arena-state-replay': (data: ArenaStateReplay) => void;
}

export interface ClientToServerEvents {
  resync: (dataOrAck?: unknown, ack?: AckCallback) => void;
  'get-rooms': (ack?: AckCallback) => void;
  /**
   * ack data.status 'waiting' = 만석(봇 포함) 방에 착석 대기로 입장 — room-joined는 즉시 오고,
   * 본인 좌석은 진행 중 핸드 종료 후 game-update에 나타난다 (클라는 players 내 본인 유무로 판별).
   */
  'join-room': (
    data: unknown,
    ack?: AckCallback<{ roomId: string; status?: 'waiting' }>,
  ) => void;
  'leave-room': (data?: unknown, ack?: AckCallback<LeaveReserveAckData>) => void;
  'player-action': (
    data: unknown,
    ack?: AckCallback<{ handNumber: number; actionSeq: number }>,
  ) => void;
  'toggle-sit-out': (ack?: AckCallback) => void;
  /**
   * 캐시 좌석 칩 추가(바이인 탑업). `targetChips`는 채우고 싶은 **최종 스택**이다.
   * 핸드 중이면 서버가 예약하고 status 'queued'를 준다.
   */
  'cash-top-up': (
    payload: { targetChips: number },
    ack?: AckCallback<{ status: 'applied' | 'queued'; chips: number }>,
  ) => void;
  'cancel-cash-top-up': (ack?: AckCallback) => void;
  /** 초대 코드 → 대상. 방/토너먼트를 구분해 돌려준다 (무차별 대입 방지 레이트리밋 필수) */
  'resolve-invite': (
    payload: { code: string },
    ack?: AckCallback<{ kind: 'room' | 'tournament'; id: string }>,
  ) => void;
  'use-time-bank': (ack?: AckCallback) => void;
  'send-chat': (data: unknown, ack?: AckCallback) => void;
  'throw-item': (data: unknown, ack?: AckCallback<{ cooldownMs: number }>) => void;
  'create-room': (data: unknown, ack?: AckCallback<{ roomId: string }>) => void;
  'sng-fill-bots': (ack?: AckCallback) => void;
  'get-tournaments': (ack?: AckCallback<TournamentListPayload>) => void;
  'get-tournament': (data: unknown, ack?: AckCallback<TournamentDetailView>) => void;
  'create-tournament': (
    data: unknown,
    ack?: AckCallback<{ tournamentId: string }>,
  ) => void;
  'register-tournament': (
    data: unknown,
    ack?: AckCallback<RegisterTournamentResult>,
  ) => void;
  'unregister-tournament': (data: unknown, ack?: AckCallback) => void;
  'start-tournament': (data: unknown, ack?: AckCallback) => void;
  /** 디렉터 콘솔 — 개설자 전용 운영 개입 (pause/resume/set-level/remove-player/cancel) */
  'tournament-admin': (data: unknown, ack?: AckCallback) => void;
  'arena-queue-join': (ack?: AckCallback) => void;
  'arena-queue-leave': (ack?: AckCallback) => void;
  'arena-training-accept': (
    data: { offerId: string },
    ack?: AckCallback<{ matchId: string }>,
  ) => void;
  'arena-training-reject': (
    data: { offerId: string },
    ack?: AckCallback,
  ) => void;
}

export type PokerClientSocket = Socket<ServerToClientEvents, ClientToServerEvents>;
