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
  revealed?: boolean; // 서버가 명시하는 홀카드 공개 여부 (쇼다운 생존자만 true)
  personalityId?: string; // for bots
  botSkill?: RoomDifficulty; // 봇 난이도 — 방 난이도에 따라 성향 수치를 변조 (기본 normal)
  finishPlace?: number; // 시트앤고 최종 순위 (탈락/우승 시 확정)
  handStartChips?: number; // 핸드 시작 시점 스택 — 동시 탈락 순위 판정용
  sitOutNext?: boolean; // 자리비움 — 캐시: 다음 핸드부터 sitting-out / SnG: 딜인 유지 + 자동 폴드(away)
  sitOutSinceHand?: number; // 캐시 자리비움 시작 시점의 handNumber — 경과 핸드로 미납 블라인드(≈오르빗) 산정
  timeBankChips?: number; // 타임칩 보유 수 (내 턴에 사용해 시간 연장)
  handsPlayed?: number; // 참여 핸드 수 — 타임칩 적립 기준
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
  winners: WinResult[] | null;
  handRake: number;
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
  password?: string; // 방 비밀번호 — 서버 전용, 절대 gameState로 노출하지 말 것
  hostId?: string; // 방 생성자 playerId (서버가 create-room 시 세팅)
  difficulty?: RoomDifficulty; // 봇 난이도 (기본 'normal')
  botCount?: number; // 캐시 게임 봇 충원 수 0~5 (기본 2) — 친구 방은 0으로 좌석 확보
  tableType?: TableType; // 인원 구성 (기본 'mixed') — 'bots'는 휴먼 1명 제한
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
