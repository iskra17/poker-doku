export type ArenaTier =
  | 'bronze'
  | 'silver'
  | 'gold'
  | 'platinum'
  | 'diamond'
  | 'master';

export interface ArenaConfig {
  readonly version: number;
  readonly seasonWeeks: number;
  readonly startingTickets: number;
  readonly dailyTickets: number;
  readonly ticketCap: number;
  readonly queueTimeoutMs: number;
  readonly queueInitialMmrRange: number;
  readonly queueRangeStep: number;
  readonly queueRangeStepMs: number;
  readonly queueFallbackAtMs: number;
  readonly minimumHumansForOfficial: number;
  readonly seats: number;
  readonly startingStack: number;
  readonly placementMatches: number;
  readonly pointsByPlace: readonly number[];
  readonly promotionGamesRequired: number;
  readonly weeklyMoveRate: number;
  readonly targetGroupMin: number;
  readonly targetGroupMax: number;
  readonly initialMmr: number;
  readonly placementMmrK: number;
  readonly normalMmrK: number;
  readonly mmrDeltaCap: number;
  readonly botVersion: string;
}

export interface WeeklyStanding {
  readonly profileId: string;
  readonly points: number;
  readonly wins: number;
  readonly top3: number;
  readonly placeSum: number;
  readonly matches: number;
  readonly scoreReachedAt: number;
}

export interface WeeklyMoves {
  readonly promotedProfileIds: readonly string[];
  readonly demotedProfileIds: readonly string[];
}

export interface MmrDeltaInput {
  readonly playerMmr: number;
  readonly opponentMmrs: readonly number[];
  readonly place: number;
  readonly k: number;
}
