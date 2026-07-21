export type Suit = 'hearts' | 'diamonds' | 'clubs' | 'spades';
export type Rank = '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9' | '10' | 'J' | 'Q' | 'K' | 'A';

export interface Card {
  suit: Suit;
  rank: Rank;
}

export type HandRank =
  | 'royal-flush'
  | 'straight-flush'
  | 'four-of-a-kind'
  | 'full-house'
  | 'flush'
  | 'straight'
  | 'three-of-a-kind'
  | 'two-pair'
  | 'one-pair'
  | 'high-card';

export interface EvaluatedHand {
  rank: HandRank;
  value: number;       // numeric score for comparison (higher = better)
  cards: Card[];       // best 5-card hand
  description: string; // e.g., "Pair of Aces"
}

export type PlayerStatus = 'waiting' | 'active' | 'folded' | 'all-in' | 'sitting-out';
export type PlayerType = 'human' | 'bot';

export interface PlayerPublicCosmetics {
  titleId: string | null;
  frameId: string | null;
}

export interface Player {
  id: string;
  name: string;
  type: PlayerType;
  avatar: string;
  chips: number;
  seatIndex: number;
  holeCards: Card[];
  currentBet: number;
  totalContributed: number; // 이번 핸드 누적 팟 기여금 (스트리트 무관)
  status: PlayerStatus;
  hasActed: boolean;
  pendingRemoval?: boolean; // 핸드 진행 중 이탈 → 다음 핸드 시작 전 제거 예약
  isDisconnected?: boolean; // 재접속 유예(grace) 중
  /**
   * grace 만료 시 좌석이 실제로 제거되는 경우에만 세팅되는 회수 예정 시각 (epoch ms).
   * 클라이언트가 오프라인 좌석에 회수 카운트다운 타임바를 그리는 용도 —
   * SnG(좌석 무조건 보존)·자리비움 좌석에는 세팅하지 않는다.
   */
  disconnectGraceDeadline?: number;
  /**
   * 캐시 파산(0칩) 좌석의 리바이 유예 만료 시각 (epoch ms) — 유예 내 리바이가 없으면 좌석 회수.
   * BustNotice가 카운트다운을 그리는 용도. 리바이 재입장(handleSeatRejoin) 시 해제.
   */
  bustReclaimDeadline?: number;
  revealed?: boolean; // 서버가 명시하는 홀카드 공개 여부 (쇼다운 생존자만 true)
  personalityId?: string; // for bots
  botSkill?: RoomDifficulty; // 봇 난이도 — 방 난이도에 따라 성향 수치를 변조 (기본 normal)
  finishPlace?: number; // 시트앤고 최종 순위 (탈락/우승 시 확정)
  handStartChips?: number; // 핸드 시작 시점 스택 — 동시 탈락 순위 판정용
  sitOutNext?: boolean; // 자리비움 — 캐시: 다음 핸드부터 sitting-out / SnG: 딜인 유지 + 자동 폴드(away)
  /**
   * 턴 시간 초과로 인한 자동 자리비움 마킹 (명시적 자리비움과 구분).
   * 같은 핸드 안에서는 매 스트리트 기본 턴 시간을 그대로 주고(1초 자동 처리 제외),
   * 본인이 액션하면 마킹째 해제된다. 핸드가 끝나면 소멸 — 다음 핸드부터는 일반 자리비움 취급.
   */
  sitOutAuto?: boolean;
  sitOutSinceHand?: number; // 캐시 자리비움 시작 시점의 handNumber — 경과 핸드로 미납 블라인드(≈오르빗) 산정
  timeBankChips?: number; // 타임칩 보유 수 (내 턴에 사용해 시간 연장)
  handsPlayed?: number; // 참여 핸드 수 — 타임칩 적립 기준
  /** 다른 좌석에 공개해도 되는 최소 꾸미기 정보. */
  publicCosmetics?: PlayerPublicCosmetics;
}

export type ActionType = 'fold' | 'check' | 'call' | 'raise' | 'all-in';

export interface PlayerAction {
  playerId: string;
  type: ActionType;
  amount: number;
}

export type Street = 'preflop' | 'flop' | 'turn' | 'river' | 'showdown';

export interface Pot {
  amount: number;
  eligiblePlayerIds: string[];
}

export interface GameState {
  id: string;
  players: Player[];
  communityCards: Card[];
  pots: Pot[];
  currentBet: number;
  minRaise: number;
  street: Street;
  dealerIndex: number;
  activePlayerIndex: number;
  smallBlind: number;
  bigBlind: number;
  isHandInProgress: boolean;
  /**
   * 단계별 올인 런아웃 진행 중 — 응수 가능한 플레이어가 없어(전원 올인 등) 베팅이 닫혔고,
   * RoomManager가 dealRunoutStreet()를 시간차로 호출해 스트리트를 순차 공개한다.
   * 이 동안 생존자의 홀카드는 getPublicState가 공개(revealed)한다 (표준 룰: 올인 확정 시 핸드 오픈).
   */
  allInRunout?: boolean;
  winners: WinResult[] | null;
  handRake: number;
  economyMode?: 'practice' | 'wallet' | 'arena';
  lastAction: PlayerAction | null;
  /** 이번 핸드 마지막 벳/레이즈 주체 — 봇 c벳(연속 베팅) 판정용 */
  lastAggressorId?: string | null;
  turnTimer: number; // seconds remaining
  turnTimeRemaining?: number; // ms — 서버→클라 전용 (전송 시 주입)
  handNumber: number; // 핸드 카운터 — 클라 diff 이벤트 파생용
  actionSeq: number; // 유효 액션 카운터 — 클라 diff 이벤트 파생용
  tournament?: TournamentState; // 시트앤고 진행 정보 (캐시 게임엔 없음)
  hostId?: string; // 방 생성자 playerId — Sit & Go 봇 채우기 권한 판단용
}

/** 시트앤고 진행 상태 — getPublicState로 자동 브로드캐스트 */
export interface TournamentState {
  level: number; // 1-based 블라인드 레벨
  smallBlind: number;
  bigBlind: number;
  nextSmallBlind: number | null; // 마지막 레벨이면 null
  nextBigBlind: number | null;
  levelEndsAt: number; // epoch ms — 다음 인상 시각 (0 = 카운트다운 없음)
  entrants: number; // 시작 인원 (0 = 아직 미시작)
  prizes: number[]; // 순위별 상금 (1위부터)
  finished: boolean;
  results: TournamentResult[];
}

export interface TournamentResult {
  playerId: string;
  name: string;
  place: number; // 1-based
  prize: number;
}

export type GameMode = 'cash' | 'sng';

/** 방 난이도 — 봇들의 성향 수치를 변조한다 (easy=순하고 예측 가능, hard=공격적) */
export type RoomDifficulty = 'easy' | 'normal' | 'hard';

/**
 * 테이블 인원 구성. UI 라벨은 '혼자 연습'/'봇+사람'/'사람만' — bots를 '봇 전용'으로 부르지 말 것
 * (AI끼리 논다는 오해를 부른다. 이 방의 차별점은 봇 상대가 아니라 다른 사람이 못 낀다는 점).
 * - bots: 혼자 연습 — 휴먼 1명만 착석 가능 (서버가 강제), 봇 5명 충원
 * - mixed: 봇+사람 — 봇이 충원되지만 휴먼이 오면 자리를 양보 (기존 기본 동작)
 * - humans: 사람만 — 봇 충원 없음
 */
export type TableType = 'bots' | 'mixed' | 'humans';
export type CompetitionMode = 'arena-official' | 'arena-training';

export interface WinResult {
  playerId: string;
  amount: number;
  hand: EvaluatedHand | null;
  potIndex: number;
}

export interface RoomConfig {
  name: string;
  smallBlind: number;
  bigBlind: number;
  minBuyIn: number;
  maxBuyIn: number;
  maxPlayers: 6;
  economyMode?: 'practice' | 'wallet' | 'arena';
  turnTime: number; // seconds
  gameMode?: GameMode; // 기본 'cash'
  startingStack?: number; // 시트앤고 시작 스택
  entryBuyIn?: number; // wallet Sit & Go 참가 바이인 — 엔진 칩/상금 풀에만 포함
  entryFee?: number; // wallet Sit & Go 참가 수수료 — 엔진 밖에서 소각
  password?: string; // 방 비밀번호 — 서버 전용, 절대 gameState로 노출하지 말 것
  hostId?: string; // 방 생성자 playerId (서버가 create-room 시 세팅)
  difficulty?: RoomDifficulty; // 봇 난이도 (기본 'normal')
  botCount?: number; // 캐시 게임 봇 충원 수 0~5 (기본 2) — 친구 방은 0으로 좌석 확보
  tableType?: TableType; // 인원 구성 (기본 'mixed') — 'bots'는 휴먼 1명 제한
  competitionMode?: CompetitionMode;
  arenaMatchId?: string;
  arenaBotVersion?: string;
  /** 서버 전용 Arena 입장 allowlist — GameState/RoomList/로그에 투영하지 말 것 */
  arenaParticipantIds?: readonly string[];
}

export interface Room {
  id: string;
  config: RoomConfig;
  gameState: GameState;
  createdAt: number;
}

export interface ChatMessage {
  id: string;
  roomId: string;
  playerId: string;
  playerName: string;
  message: string;
  timestamp: number;
  type: 'player' | 'bot' | 'system';
}
