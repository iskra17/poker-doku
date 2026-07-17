import type { ArenaConfig, ArenaTier } from './types';

export const ARENA_TIERS: readonly ArenaTier[] = Object.freeze([
  'bronze',
  'silver',
  'gold',
  'platinum',
  'diamond',
  'master',
]);

export const ARENA_CONFIG_V1 = Object.freeze({
  version: 1,
  seasonWeeks: 4,
  startingTickets: 2,
  dailyTickets: 2,
  ticketCap: 10,
  queueTimeoutMs: 60_000,
  queueInitialMmrRange: 100,
  queueRangeStep: 50,
  queueRangeStepMs: 10_000,
  queueFallbackAtMs: 60_000,
  minimumHumansForOfficial: 2,
  seats: 6,
  startingStack: 1_500,
  placementMatches: 5,
  pointsByPlace: Object.freeze([100, 60, 35, 15, 5, 0]),
  promotionGamesRequired: 3,
  weeklyMoveRate: 0.20,
  targetGroupMin: 20,
  targetGroupMax: 30,
  initialMmr: 1_000,
  placementMmrK: 48,
  normalMmrK: 32,
  mmrDeltaCap: 32,
  botVersion: 'arena-v1-hard',
}) satisfies ArenaConfig;
