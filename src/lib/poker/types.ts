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
  status: PlayerStatus;
  hasActed: boolean;
  personalityId?: string; // for bots
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
}

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
