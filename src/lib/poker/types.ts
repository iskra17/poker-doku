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
  finishPlace?: number; // 시트앤고 최종 순위 (탈락/우승 시 확정)
  handStartChips?: number; // 핸드 시작 시점 스택 — 동시 탈락 순위 판정용
  sitOutNext?: boolean; // 자리비움 예약 — 다음 핸드부터 sitting-out
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
  lastAction: PlayerAction | null;
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
  turnTime: number; // seconds
  gameMode?: GameMode; // 기본 'cash'
  startingStack?: number; // 시트앤고 시작 스택
  password?: string; // 방 비밀번호 — 서버 전용, 절대 gameState로 노출하지 말 것
  hostId?: string; // 방 생성자 playerId (서버가 create-room 시 세팅)
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
