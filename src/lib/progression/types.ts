import type { MissionId } from './missions';
import type { DailyMissionDaySnapshot } from './missions';

export const PROGRESSION_CHARACTER_IDS = [
  'sakura',
  'ara',
  'hana',
  'chloe',
  'vivian',
  'elena',
] as const;

export type ProgressionCharacterId =
  typeof PROGRESSION_CHARACTER_IDS[number];
export type ProgressionEquipmentSlot = 'title' | 'frame' | 'skin' | 'cutin';

export interface ProgressionCore {
  balanceVersion: number;
  dojoLevel: number;
  dojoXpMilli: number;
  selectedCharacterId: ProgressionCharacterId;
}

export interface ProgressionCounters {
  practiceDate: string | null;
  practiceHands: number;
  completedHands: number;
  cashHands: number;
  practiceHandsTotal: number;
  sngCompletions: number;
  bestStreak: number;
}

export interface ProgressionProfile extends ProgressionCore,
  ProgressionCounters {
  profileId: string;
  createdAt: number;
  updatedAt: number;
}

export interface CharacterAffinity {
  profileId: string;
  characterId: ProgressionCharacterId;
  level: number;
  xpMilli: number;
}

export interface ProgressionStreak {
  profileId: string;
  currentStreak: number;
  restPasses: number;
  lastQualifiedDate: string | null;
  lastWeekKey: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface ProgressionInventoryItem {
  profileId: string;
  itemId: string;
  quantity: number;
  grantedAt: number;
  updatedAt: number;
}

export interface ProgressionSnapshot {
  profile: ProgressionProfile;
  affinities: CharacterAffinity[];
  streak: ProgressionStreak;
  inventory: ProgressionInventoryItem[];
  equipment: Record<ProgressionEquipmentSlot, string | null>;
}

export interface ProgressionView {
  progression: ProgressionSnapshot;
  missions: DailyMissionDaySnapshot;
}

/** A completed mission's immutable reward receipt. */
export interface MissionCompletion {
  missionId: MissionId;
  slot: number;
  dojoXpMilli: number;
}

/** The before/after values emitted when a qualifying day changes a streak. */
export interface StreakChange {
  previousStreak: number;
  currentStreak: number;
  restPassUsed: boolean;
}

export interface ProgressionRewardSummary {
  eventId: string;
  dojoXpMilli: number;
  dojoLevelsGained: number[];
  characterId: string;
  affinityMilli: number;
  affinityLevelsGained: number[];
  missionCompletions: MissionCompletion[];
  streak?: StreakChange;
  grantedItemIds: string[];
}
