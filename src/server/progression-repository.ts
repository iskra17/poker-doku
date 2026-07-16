import type { PokerDatabase } from './persistence/database';
import {
  getBalance,
  type ProgressionBalance,
} from '@/lib/progression/balance';
import {
  assignDailyMissions,
  getMissionDefinition,
  type DailyMission,
  type DailyMissionDaySnapshot,
  type MissionMetric,
  type ProgressionMode,
} from '@/lib/progression/missions';

export type {
  DailyMission,
  DailyMissionDaySnapshot,
} from '@/lib/progression/missions';

export const PLAYABLE_CHARACTER_IDS = [
  'sakura',
  'ara',
  'hana',
  'chloe',
  'vivian',
  'elena',
] as const;

export type PlayableCharacterId = typeof PLAYABLE_CHARACTER_IDS[number];
export type EquipmentSlot = 'title' | 'frame' | 'skin' | 'cutin';

const EQUIPMENT_SLOTS: readonly EquipmentSlot[] = [
  'title',
  'frame',
  'skin',
  'cutin',
];
const SUPPORTED_BALANCE_VERSION = 1;
const CANONICAL_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const WEEK_KEY_PATTERN = /^(\d{4})-W(\d{2})$/;
const CATALOG_ITEM_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;
const DANGEROUS_SUMMARY_KEYS = new Set([
  '__proto__',
  'constructor',
  'prototype',
]);

export const PROGRESSION_SUMMARY_LIMITS = {
  maxDepth: 64,
  maxNodes: 4_096,
  maxUtf8Bytes: 64 * 1_024,
} as const;

export type ProgressionErrorCode =
  | 'PROGRESSION_PROFILE_NOT_FOUND'
  | 'PROGRESSION_CHARACTER_INVALID'
  | 'PROGRESSION_TIME_INVALID'
  | 'PROGRESSION_VALUE_INVALID'
  | 'PROGRESSION_TRANSACTION_REQUIRED'
  | 'PROGRESSION_CONFLICT'
  | 'PROGRESSION_EVENT_CONFLICT'
  | 'PROGRESSION_MISSION_NOT_FOUND'
  | 'PROGRESSION_MISSION_COMPLETED'
  | 'PROGRESSION_MISSION_REROLL_USED'
  | 'PROGRESSION_PERSISTENCE_INVALID';

export class ProgressionPersistenceError extends Error {
  constructor(readonly code: ProgressionErrorCode) {
    super(code);
    this.name = 'ProgressionPersistenceError';
  }
}

export interface ProgressionCore {
  balanceVersion: number;
  dojoLevel: number;
  dojoXpMilli: number;
  selectedCharacterId: PlayableCharacterId;
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

export interface ProgressionProfile extends ProgressionCore, ProgressionCounters {
  profileId: string;
  createdAt: number;
  updatedAt: number;
}

export interface CharacterAffinity {
  profileId: string;
  characterId: PlayableCharacterId;
  level: number;
  xpMilli: number;
}

export interface StreakState {
  profileId: string;
  currentStreak: number;
  restPasses: number;
  lastQualifiedDate: string | null;
  lastWeekKey: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface InventoryItem {
  profileId: string;
  itemId: string;
  quantity: number;
  grantedAt: number;
  updatedAt: number;
}

export interface ProgressionSnapshot {
  profile: ProgressionProfile;
  affinities: CharacterAffinity[];
  streak: StreakState;
  inventory: InventoryItem[];
  equipment: Record<EquipmentSlot, string | null>;
}

export interface ProgressionEvent {
  idempotencyKey: string;
  profileId: string;
  eventType: string;
  balanceVersion: number;
  summary: Record<string, unknown>;
  createdAt: number;
}

export type NewProgressionEvent = ProgressionEvent;

export type InsertProgressionEventResult =
  | { status: 'inserted'; event: ProgressionEvent }
  | { status: 'duplicate'; event: ProgressionEvent };

export interface ProgressionCoreUpdate {
  profileId: string;
  expected: ProgressionCore;
  next: ProgressionCore;
  updatedAt: number;
}

export interface ProgressionCountersUpdate {
  profileId: string;
  expected: ProgressionCounters;
  next: ProgressionCounters;
  updatedAt: number;
}

export interface AffinityUpdate {
  profileId: string;
  characterId: string;
  expected: Pick<CharacterAffinity, 'level' | 'xpMilli'>;
  next: Pick<CharacterAffinity, 'level' | 'xpMilli'>;
}

export interface DailyMissionProgressUpdate {
  profileId: string;
  missionDate: string;
  balanceVersion: number;
  metricDeltas: Partial<Record<Exclude<MissionMetric, 'modesCompleted'>, number>>;
  completedAt: number;
}

export interface DailyMissionReplacement {
  profileId: string;
  missionDate: string;
  balanceVersion: number;
  slot: number;
  replacementMissionId: string;
  replacedAt: number;
}

export interface StreakMutableState {
  currentStreak: number;
  restPasses: number;
  lastQualifiedDate: string | null;
  lastWeekKey: string | null;
}

export interface StreakStateUpdate {
  profileId: string;
  expected: StreakMutableState & { updatedAt: number };
  next: StreakMutableState;
  updatedAt: number;
}

export interface StreakDailyProgress {
  profileId: string;
  kstDate: string;
  hands: number;
  sngs: number;
  qualifiedAt: number | null;
}

export interface StreakDailyProgressResult {
  progress: StreakDailyProgress;
  becameQualified: boolean;
}

export interface StreakDailyProgressUpdate {
  profileId: string;
  kstDate: string;
  kind: 'hand' | 'sng';
  completedAt: number;
}

export interface StackableInventoryGrant {
  idempotencyKey: string;
  profileId: string;
  itemId: string;
  balanceVersion: number;
  grantedAt: number;
  source: 'streak';
  sourceRef: string;
  sourceDate: string;
}

export interface ProgressionItemGrantReceipt {
  idempotencyKey: string;
  profileId: string;
  itemId: string;
  source: 'streak';
  sourceRef: string;
  sourceDate: string;
  quantity: 1;
  grantedAt: number;
}

interface ProgressionProfileRow {
  profile_id: string;
  balance_version: number;
  dojo_level: number;
  dojo_xp_milli: number;
  selected_character_id: string;
  practice_date: string | null;
  practice_hands: number;
  completed_hands: number;
  cash_hands: number;
  practice_hands_total: number;
  sng_completions: number;
  best_streak: number;
  created_at: number;
  updated_at: number;
}

interface CharacterAffinityRow {
  profile_id: string;
  character_id: string;
  level: number;
  xp_milli: number;
}

interface StreakStateRow {
  profile_id: string;
  current_streak: number;
  rest_passes: number;
  last_qualified_date: string | null;
  last_week_key: string | null;
  created_at: number;
  updated_at: number;
}

interface InventoryItemRow {
  profile_id: string;
  item_id: string;
  quantity: number;
  granted_at: number;
  updated_at: number;
}

interface EquipmentRow {
  profile_id: string;
  slot: string;
  item_id: string | null;
  updated_at: number;
}

interface ProgressionEventRow {
  idempotency_key: string;
  profile_id: string;
  event_type: string;
  balance_version: number;
  summary_json: string;
  created_at: number;
}

interface DailyMissionRow {
  profile_id: string;
  mission_date: string;
  slot: number;
  mission_id: string;
  target: number;
  progress: number;
  balance_version: number;
  reroll_count: number;
  assigned_at: number;
  completed_at: number | null;
  rewarded_at: number | null;
}

interface DailyMissionModeRow {
  profile_id: string;
  mission_date: string;
  mode: string;
  created_at: number;
}

interface StreakDailyProgressRow {
  profile_id: string;
  kst_date: string;
  hands: number;
  sngs: number;
  qualified_at: number | null;
}

interface ProgressionItemGrantRow {
  idempotency_key: string;
  profile_id: string;
  item_id: string;
  source: string;
  source_ref: string;
  source_date: string;
  quantity: number;
  granted_at: number;
}

export class ProgressionRepository {
  constructor(private readonly database: PokerDatabase) {}

  getOrCreate(
    profileId: string,
    selectedCharacterId: string,
    at = Date.now(),
  ): ProgressionSnapshot {
    assertProfileId(profileId);
    assertPlayableCharacter(selectedCharacterId);
    assertTimestamp(at, 'PROGRESSION_TIME_INVALID');
    try {
      return this.database.transaction(() => this.getOrCreateInTransaction(
        profileId,
        selectedCharacterId,
        at,
      ));
    } catch (error) {
      rethrowUnexpected(error, 'PROGRESSION_PERSISTENCE_INVALID');
    }
  }

  /** Must be called inside a caller-owned PokerDatabase transaction. */
  getOrCreateInTransaction(
    profileId: string,
    selectedCharacterId: string,
    at = Date.now(),
  ): ProgressionSnapshot {
    this.assertTransaction();
    assertProfileId(profileId);
    const characterId = assertPlayableCharacter(selectedCharacterId);
    assertTimestamp(at, 'PROGRESSION_TIME_INVALID');
    try {
      if (!this.profileExists(profileId)) {
        throw new ProgressionPersistenceError('PROGRESSION_PROFILE_NOT_FOUND');
      }

      const inserted = this.database.db.prepare(`
      INSERT INTO progression_profiles (
        profile_id, balance_version, dojo_level, dojo_xp_milli,
        selected_character_id, practice_date, practice_hands,
        completed_hands, cash_hands, practice_hands_total, sng_completions,
        best_streak, created_at, updated_at
      ) VALUES (?, 1, 1, 0, ?, NULL, 0, 0, 0, 0, 0, 0, ?, ?)
      ON CONFLICT(profile_id) DO NOTHING
      `).run(profileId, characterId, at, at);

      if (inserted.changes === 1) {
        const insertEquipment = this.database.db.prepare(`
        INSERT INTO profile_equipment (profile_id, slot, item_id, updated_at)
        VALUES (?, ?, NULL, ?)
      `);
        for (const slot of EQUIPMENT_SLOTS) {
          insertEquipment.run(profileId, slot, at);
        }
      }

      this.database.db.prepare(`
      INSERT INTO character_affinity (
        profile_id, character_id, level, xp_milli
      ) VALUES (?, ?, 1, 0)
      ON CONFLICT(profile_id, character_id) DO NOTHING
    `).run(profileId, characterId);

      return this.getSnapshotInTransaction(profileId);
    } catch (error) {
      rethrowUnexpected(error, 'PROGRESSION_PERSISTENCE_INVALID');
    }
  }

  /** Must be called inside a caller-owned PokerDatabase transaction. */
  getSnapshotInTransaction(profileId: string): ProgressionSnapshot {
    this.assertTransaction();
    assertProfileId(profileId);
    try {
      const profileRow = this.database.db.prepare(`
      SELECT
        profile_id, balance_version, dojo_level, dojo_xp_milli,
        selected_character_id, practice_date, practice_hands,
        completed_hands, cash_hands, practice_hands_total, sng_completions,
        best_streak, created_at, updated_at
      FROM progression_profiles WHERE profile_id = ?
    `).get(profileId) as ProgressionProfileRow | undefined;
      if (!profileRow) {
        throw new ProgressionPersistenceError('PROGRESSION_PROFILE_NOT_FOUND');
      }
      const profile = mapProgressionProfile(profileRow);

      const affinityRows = this.database.db.prepare(`
      SELECT profile_id, character_id, level, xp_milli
      FROM character_affinity
      WHERE profile_id = ?
      ORDER BY character_id
    `).all(profileId) as unknown as CharacterAffinityRow[];
      const affinities = affinityRows.map(row => mapCharacterAffinity(
        row,
        profile.balanceVersion,
      ));
      if (
        affinities.length === 0
        || !affinities.some(value => (
          value.characterId === profile.selectedCharacterId
        ))
      ) {
        throw persistenceInvalid();
      }

      const streakRow = this.database.db.prepare(`
      SELECT
        profile_id, current_streak, rest_passes, last_qualified_date,
        last_week_key, created_at, updated_at
      FROM streak_state WHERE profile_id = ?
    `).get(profileId) as StreakStateRow | undefined;
      if (!streakRow) throw persistenceInvalid();
      const streak = mapStreakState(streakRow);
      if (streak.currentStreak > profile.bestStreak) throw persistenceInvalid();

      const inventoryRows = this.database.db.prepare(`
      SELECT profile_id, item_id, quantity, granted_at, updated_at
      FROM inventory_items WHERE profile_id = ? ORDER BY item_id
    `).all(profileId) as unknown as InventoryItemRow[];
      const inventory = inventoryRows.map(mapInventoryItem);
      const ownedItems = new Set(inventory.map(item => item.itemId));

      const equipmentRows = this.database.db.prepare(`
      SELECT profile_id, slot, item_id, updated_at
      FROM profile_equipment WHERE profile_id = ? ORDER BY slot
    `).all(profileId) as unknown as EquipmentRow[];
      const equipment = emptyEquipment();
      const seenSlots = new Set<EquipmentSlot>();
      for (const row of equipmentRows) {
        if (
          row.profile_id !== profileId
          || !isEquipmentSlot(row.slot)
          || seenSlots.has(row.slot)
          || (row.item_id !== null && (
            typeof row.item_id !== 'string'
            || row.item_id.length === 0
            || !ownedItems.has(row.item_id)
          ))
        ) {
          throw persistenceInvalid();
        }
        assertStoredTimestamp(row.updated_at);
        seenSlots.add(row.slot);
        equipment[row.slot] = row.item_id;
      }
      if (seenSlots.size !== EQUIPMENT_SLOTS.length) throw persistenceInvalid();

      return { profile, affinities, streak, inventory, equipment };
    } catch (error) {
      if (error instanceof ProgressionPersistenceError) throw error;
      throw persistenceInvalid();
    }
  }

  /** Must be called inside a caller-owned PokerDatabase transaction. */
  compareAndUpdateProgressionInTransaction(
    update: ProgressionCoreUpdate,
  ): void {
    this.assertTransaction();
    const safeUpdate = copyCoreUpdate(update);
    assertProfileId(safeUpdate.profileId);
    assertProgressionCore(safeUpdate.expected, 'PROGRESSION_VALUE_INVALID');
    assertProgressionCore(safeUpdate.next, 'PROGRESSION_VALUE_INVALID');
    assertTimestamp(safeUpdate.updatedAt, 'PROGRESSION_TIME_INVALID');
    try {
      const result = this.database.db.prepare(`
      UPDATE progression_profiles
      SET balance_version = ?, dojo_level = ?, dojo_xp_milli = ?,
          selected_character_id = ?, updated_at = ?
      WHERE profile_id = ?
        AND balance_version = ?
        AND dojo_level = ?
        AND dojo_xp_milli = ?
        AND selected_character_id = ?
      `).run(
        safeUpdate.next.balanceVersion,
        safeUpdate.next.dojoLevel,
        safeUpdate.next.dojoXpMilli,
        safeUpdate.next.selectedCharacterId,
        safeUpdate.updatedAt,
        safeUpdate.profileId,
        safeUpdate.expected.balanceVersion,
        safeUpdate.expected.dojoLevel,
        safeUpdate.expected.dojoXpMilli,
        safeUpdate.expected.selectedCharacterId,
      );
      if (result.changes !== 1) {
        throw new ProgressionPersistenceError('PROGRESSION_CONFLICT');
      }
      this.database.db.prepare(`
      INSERT INTO character_affinity (
        profile_id, character_id, level, xp_milli
      ) VALUES (?, ?, 1, 0)
      ON CONFLICT(profile_id, character_id) DO NOTHING
      `).run(safeUpdate.profileId, safeUpdate.next.selectedCharacterId);
    } catch (error) {
      rethrowUnexpected(error, 'PROGRESSION_PERSISTENCE_INVALID');
    }
  }

  /** Must be called inside a caller-owned PokerDatabase transaction. */
  compareAndUpdateCountersInTransaction(
    update: ProgressionCountersUpdate,
  ): void {
    this.assertTransaction();
    const safeUpdate = copyCountersUpdate(update);
    assertProfileId(safeUpdate.profileId);
    assertProgressionCounters(safeUpdate.expected, 'PROGRESSION_VALUE_INVALID');
    assertProgressionCounters(safeUpdate.next, 'PROGRESSION_VALUE_INVALID');
    assertTimestamp(safeUpdate.updatedAt, 'PROGRESSION_TIME_INVALID');
    try {
      const result = this.database.db.prepare(`
      UPDATE progression_profiles
      SET practice_date = ?, practice_hands = ?, completed_hands = ?,
          cash_hands = ?, practice_hands_total = ?, sng_completions = ?,
          best_streak = ?, updated_at = ?
      WHERE profile_id = ?
        AND practice_date IS ?
        AND practice_hands = ?
        AND completed_hands = ?
        AND cash_hands = ?
        AND practice_hands_total = ?
        AND sng_completions = ?
        AND best_streak = ?
      `).run(
        safeUpdate.next.practiceDate,
        safeUpdate.next.practiceHands,
        safeUpdate.next.completedHands,
        safeUpdate.next.cashHands,
        safeUpdate.next.practiceHandsTotal,
        safeUpdate.next.sngCompletions,
        safeUpdate.next.bestStreak,
        safeUpdate.updatedAt,
        safeUpdate.profileId,
        safeUpdate.expected.practiceDate,
        safeUpdate.expected.practiceHands,
        safeUpdate.expected.completedHands,
        safeUpdate.expected.cashHands,
        safeUpdate.expected.practiceHandsTotal,
        safeUpdate.expected.sngCompletions,
        safeUpdate.expected.bestStreak,
      );
      if (result.changes !== 1) {
        throw new ProgressionPersistenceError('PROGRESSION_CONFLICT');
      }
    } catch (error) {
      rethrowUnexpected(error, 'PROGRESSION_PERSISTENCE_INVALID');
    }
  }

  /** Must be called inside a caller-owned PokerDatabase transaction. */
  compareAndUpdateAffinityInTransaction(update: AffinityUpdate): void {
    this.assertTransaction();
    const safeUpdate = copyAffinityUpdate(update);
    assertProfileId(safeUpdate.profileId);
    const characterId = assertPlayableCharacter(safeUpdate.characterId);
    assertAffinityValue(safeUpdate.expected, 'PROGRESSION_VALUE_INVALID');
    assertAffinityValue(safeUpdate.next, 'PROGRESSION_VALUE_INVALID');
    try {
      const result = this.database.db.prepare(`
      UPDATE character_affinity
      SET level = ?, xp_milli = ?
      WHERE profile_id = ? AND character_id = ?
        AND level = ? AND xp_milli = ?
      `).run(
      safeUpdate.next.level,
      safeUpdate.next.xpMilli,
      safeUpdate.profileId,
      characterId,
      safeUpdate.expected.level,
      safeUpdate.expected.xpMilli,
    );
      if (result.changes !== 1) {
        throw new ProgressionPersistenceError('PROGRESSION_CONFLICT');
      }
    } catch (error) {
      rethrowUnexpected(error, 'PROGRESSION_PERSISTENCE_INVALID');
    }
  }

  /** Must be called inside a caller-owned PokerDatabase transaction. */
  compareAndUpdateStreakInTransaction(update: StreakStateUpdate): void {
    this.assertTransaction();
    const safe = copyStreakStateUpdate(update);
    assertProfileId(safe.profileId);
    assertStreakMutableState(safe.expected, 'PROGRESSION_VALUE_INVALID');
    assertStreakMutableState(safe.next, 'PROGRESSION_VALUE_INVALID');
    assertTimestamp(safe.expected.updatedAt, 'PROGRESSION_TIME_INVALID');
    assertTimestamp(safe.updatedAt, 'PROGRESSION_TIME_INVALID');
    if (safe.updatedAt < safe.expected.updatedAt) {
      throw new ProgressionPersistenceError('PROGRESSION_TIME_INVALID');
    }
    try {
      const result = this.database.db.prepare(`
        UPDATE streak_state
        SET current_streak = ?, rest_passes = ?, last_qualified_date = ?,
            last_week_key = ?, updated_at = ?
        WHERE profile_id = ?
          AND current_streak = ?
          AND rest_passes = ?
          AND last_qualified_date IS ?
          AND last_week_key IS ?
          AND updated_at = ?
      `).run(
        safe.next.currentStreak,
        safe.next.restPasses,
        safe.next.lastQualifiedDate,
        safe.next.lastWeekKey,
        safe.updatedAt,
        safe.profileId,
        safe.expected.currentStreak,
        safe.expected.restPasses,
        safe.expected.lastQualifiedDate,
        safe.expected.lastWeekKey,
        safe.expected.updatedAt,
      );
      if (result.changes !== 1) {
        throw new ProgressionPersistenceError('PROGRESSION_CONFLICT');
      }
    } catch (error) {
      rethrowUnexpected(error, 'PROGRESSION_PERSISTENCE_INVALID');
    }
  }

  /** Must be called inside a caller-owned PokerDatabase transaction. */
  ensureDailyMissionsInTransaction(
    profileId: string,
    missionDate: string,
    balanceVersion: number,
    assignedAt: number,
  ): DailyMissionDaySnapshot {
    this.assertTransaction();
    assertMissionIdentity(profileId, missionDate, balanceVersion);
    assertTimestamp(assignedAt, 'PROGRESSION_TIME_INVALID');
    try {
      const existing = this.selectDailyMissionRows(profileId, missionDate);
      if (existing.length === 0) {
        const usedDay = this.database.db.prepare(`
          SELECT 1 FROM daily_mission_modes
          WHERE profile_id = ? AND mission_date = ? LIMIT 1
        `).get(profileId, missionDate);
        if (usedDay) throw persistenceInvalid();
        if (!this.profileExists(profileId)) {
          throw new ProgressionPersistenceError('PROGRESSION_PROFILE_NOT_FOUND');
        }
        const insert = this.database.db.prepare(`
          INSERT INTO daily_missions (
            profile_id, mission_date, slot, mission_id, target, progress,
            balance_version, reroll_count, assigned_at, completed_at,
            rewarded_at
          ) VALUES (?, ?, ?, ?, ?, 0, ?, 0, ?, NULL, NULL)
        `);
        const assigned = assignDailyMissions(
          profileId,
          missionDate,
          balanceVersion,
        );
        assigned.forEach((definition, slot) => {
          insert.run(
            profileId,
            missionDate,
            slot,
            definition.id,
            definition.target,
            balanceVersion,
            assignedAt,
          );
        });
      }
      return this.readDailyMissionDayInTransaction(
        profileId,
        missionDate,
        balanceVersion,
      );
    } catch (error) {
      rethrowUnexpected(error, 'PROGRESSION_PERSISTENCE_INVALID');
    }
  }

  /** Must be called inside a caller-owned PokerDatabase transaction. */
  readDailyMissionDayInTransaction(
    profileId: string,
    missionDate: string,
    balanceVersion: number,
  ): DailyMissionDaySnapshot {
    this.assertTransaction();
    assertMissionIdentity(profileId, missionDate, balanceVersion);
    try {
      const rows = this.selectDailyMissionRows(profileId, missionDate);
      if (rows.length === 0) {
        throw new ProgressionPersistenceError('PROGRESSION_MISSION_NOT_FOUND');
      }
      const missions = rows.map(row => mapDailyMission(
        row,
        profileId,
        missionDate,
        balanceVersion,
      ));
      validateDailyMissionSet(missions);
      const modeRows = this.database.db.prepare(`
        SELECT profile_id, mission_date, mode, created_at
        FROM daily_mission_modes
        WHERE profile_id = ? AND mission_date = ?
        ORDER BY mode
      `).all(profileId, missionDate) as unknown as DailyMissionModeRow[];
      const modes = modeRows.map(row => mapDailyMissionMode(
        row,
        profileId,
        missionDate,
      ));
      if (new Set(modes).size !== modes.length) throw persistenceInvalid();
      return freezeMissionDay({
        profileId,
        missionDate,
        balanceVersion,
        missions,
        modes,
      });
    } catch (error) {
      if (error instanceof ProgressionPersistenceError) throw error;
      throw persistenceInvalid();
    }
  }

  /** Must be called inside a caller-owned PokerDatabase transaction. */
  insertDailyMissionModeInTransaction(
    profileId: string,
    missionDate: string,
    mode: ProgressionMode,
    createdAt: number,
  ): boolean {
    this.assertTransaction();
    assertMissionProfileId(profileId);
    assertMissionDate(missionDate);
    assertProgressionMode(mode);
    assertTimestamp(createdAt, 'PROGRESSION_TIME_INVALID');
    try {
      const missionRows = this.selectDailyMissionRows(profileId, missionDate);
      if (missionRows.length === 0) {
        throw new ProgressionPersistenceError('PROGRESSION_MISSION_NOT_FOUND');
      }
      const storedVersion = missionRows[0]?.balance_version;
      if (!Number.isSafeInteger(storedVersion)) throw persistenceInvalid();
      const missions = missionRows.map(row => mapDailyMission(
        row,
        profileId,
        missionDate,
        storedVersion,
      ));
      validateDailyMissionSet(missions);
      const result = this.database.db.prepare(`
        INSERT INTO daily_mission_modes (
          profile_id, mission_date, mode, created_at
        ) VALUES (?, ?, ?, ?)
        ON CONFLICT(profile_id, mission_date, mode) DO NOTHING
      `).run(profileId, missionDate, mode, createdAt);
      return result.changes === 1;
    } catch (error) {
      rethrowUnexpected(error, 'PROGRESSION_PERSISTENCE_INVALID');
    }
  }

  /** Must be called inside a caller-owned PokerDatabase transaction. */
  advanceDailyMissionsInTransaction(
    update: DailyMissionProgressUpdate,
  ): readonly DailyMission[] {
    this.assertTransaction();
    const safeUpdate = copyDailyMissionProgressUpdate(update);
    assertMissionIdentity(
      safeUpdate.profileId,
      safeUpdate.missionDate,
      safeUpdate.balanceVersion,
    );
    assertMetricDeltas(safeUpdate.metricDeltas);
    assertTimestamp(safeUpdate.completedAt, 'PROGRESSION_TIME_INVALID');
    try {
      const day = this.readDailyMissionDayInTransaction(
        safeUpdate.profileId,
        safeUpdate.missionDate,
        safeUpdate.balanceVersion,
      );
      const completed: DailyMission[] = [];
      for (const current of day.missions) {
        if (current.completedAt !== null) continue;
        const definition = getMissionDefinition(current.missionId);
        if (!definition) throw persistenceInvalid();
        const nextProgress = definition.metric === 'modesCompleted'
          ? Math.min(current.target, day.modes.length)
          : clampedAdd(
            current.progress,
            safeUpdate.metricDeltas[definition.metric] ?? 0,
            current.target,
          );
        if (nextProgress === current.progress) continue;
        const completedNow = nextProgress === current.target;
        const completedAt = completedNow ? safeUpdate.completedAt : null;
        const result = this.database.db.prepare(`
          UPDATE daily_missions
          SET progress = ?, completed_at = ?, rewarded_at = ?
          WHERE profile_id = ? AND mission_date = ? AND slot = ?
            AND mission_id = ? AND target = ? AND progress = ?
            AND balance_version = ? AND reroll_count = ?
            AND assigned_at = ? AND completed_at IS NULL
            AND rewarded_at IS NULL
        `).run(
          nextProgress,
          completedAt,
          completedAt,
          current.profileId,
          current.missionDate,
          current.slot,
          current.missionId,
          current.target,
          current.progress,
          current.balanceVersion,
          current.rerollCount,
          current.assignedAt,
        );
        if (result.changes !== 1) {
          throw new ProgressionPersistenceError('PROGRESSION_CONFLICT');
        }
        if (completedNow) {
          completed.push(Object.freeze({
            ...current,
            progress: nextProgress,
            completedAt,
            rewardedAt: completedAt,
          }));
        }
      }
      return Object.freeze(
        completed.sort((left, right) => left.slot - right.slot),
      );
    } catch (error) {
      rethrowUnexpected(error, 'PROGRESSION_PERSISTENCE_INVALID');
    }
  }

  /** Must be called inside a caller-owned PokerDatabase transaction. */
  replaceDailyMissionInTransaction(
    replacement: DailyMissionReplacement,
  ): DailyMissionDaySnapshot {
    this.assertTransaction();
    const safe = copyDailyMissionReplacement(replacement);
    assertMissionIdentity(
      safe.profileId,
      safe.missionDate,
      safe.balanceVersion,
    );
    if (!Number.isSafeInteger(safe.slot) || safe.slot < 0 || safe.slot > 2) {
      throw new ProgressionPersistenceError('PROGRESSION_VALUE_INVALID');
    }
    const definition = getMissionDefinition(safe.replacementMissionId);
    if (!definition) {
      throw new ProgressionPersistenceError('PROGRESSION_VALUE_INVALID');
    }
    assertTimestamp(safe.replacedAt, 'PROGRESSION_TIME_INVALID');
    try {
      const day = this.readDailyMissionDayInTransaction(
        safe.profileId,
        safe.missionDate,
        safe.balanceVersion,
      );
      if (day.missions.some(mission => mission.rerollCount !== 0)) {
        throw new ProgressionPersistenceError(
          'PROGRESSION_MISSION_REROLL_USED',
        );
      }
      const current = day.missions[safe.slot];
      if (!current) throw persistenceInvalid();
      if (current.completedAt !== null || current.rewardedAt !== null) {
        throw new ProgressionPersistenceError('PROGRESSION_MISSION_COMPLETED');
      }
      if (day.missions.some(mission => (
        mission.missionId === definition.id
      ))) {
        throw new ProgressionPersistenceError('PROGRESSION_VALUE_INVALID');
      }
      const result = this.database.db.prepare(`
        UPDATE daily_missions
        SET mission_id = ?, target = ?, progress = 0, reroll_count = 1,
            assigned_at = ?, completed_at = NULL, rewarded_at = NULL
        WHERE profile_id = ? AND mission_date = ? AND slot = ?
          AND mission_id = ? AND target = ? AND progress = ?
          AND balance_version = ? AND reroll_count = 0
          AND assigned_at = ? AND completed_at IS NULL
          AND rewarded_at IS NULL
      `).run(
        definition.id,
        definition.target,
        safe.replacedAt,
        current.profileId,
        current.missionDate,
        current.slot,
        current.missionId,
        current.target,
        current.progress,
        current.balanceVersion,
        current.assignedAt,
      );
      if (result.changes !== 1) {
        throw new ProgressionPersistenceError('PROGRESSION_CONFLICT');
      }
      return this.readDailyMissionDayInTransaction(
        safe.profileId,
        safe.missionDate,
        safe.balanceVersion,
      );
    } catch (error) {
      rethrowUnexpected(error, 'PROGRESSION_PERSISTENCE_INVALID');
    }
  }

  /** Must be called inside a caller-owned PokerDatabase transaction. */
  advanceStreakDailyProgressInTransaction(
    update: StreakDailyProgressUpdate,
  ): StreakDailyProgressResult {
    this.assertTransaction();
    const safe = copyStreakDailyProgressUpdate(update);
    assertMissionProfileId(safe.profileId);
    assertMissionDate(safe.kstDate);
    if (safe.kind !== 'hand' && safe.kind !== 'sng') {
      throw new ProgressionPersistenceError('PROGRESSION_VALUE_INVALID');
    }
    assertTimestamp(safe.completedAt, 'PROGRESSION_TIME_INVALID');
    try {
      const row = this.database.db.prepare(`
        SELECT profile_id, kst_date, hands, sngs, qualified_at
        FROM streak_daily_progress
        WHERE profile_id = ? AND kst_date = ?
      `).get(safe.profileId, safe.kstDate) as StreakDailyProgressRow | undefined;
      const current = row
        ? mapStreakDailyProgress(row, safe.profileId, safe.kstDate)
        : null;
      const hands = safe.kind === 'hand'
        ? Math.min(10, (current?.hands ?? 0) + 1)
        : current?.hands ?? 0;
      const sngs = safe.kind === 'sng'
        ? Math.min(1, (current?.sngs ?? 0) + 1)
        : current?.sngs ?? 0;
      const qualifiedAt = current?.qualifiedAt
        ?? (hands === 10 || sngs === 1 ? safe.completedAt : null);
      const next = Object.freeze({
        profileId: safe.profileId,
        kstDate: safe.kstDate,
        hands,
        sngs,
        qualifiedAt,
      });

      if (!current) {
        if (!this.profileExists(safe.profileId)) {
          throw new ProgressionPersistenceError('PROGRESSION_PROFILE_NOT_FOUND');
        }
        this.database.db.prepare(`
          INSERT INTO streak_daily_progress (
            profile_id, kst_date, hands, sngs, qualified_at
          ) VALUES (?, ?, ?, ?, ?)
        `).run(
          next.profileId,
          next.kstDate,
          next.hands,
          next.sngs,
          next.qualifiedAt,
        );
      } else if (
        current.hands !== next.hands
        || current.sngs !== next.sngs
        || current.qualifiedAt !== next.qualifiedAt
      ) {
        const result = this.database.db.prepare(`
          UPDATE streak_daily_progress
          SET hands = ?, sngs = ?, qualified_at = ?
          WHERE profile_id = ? AND kst_date = ?
            AND hands = ? AND sngs = ? AND qualified_at IS ?
        `).run(
          next.hands,
          next.sngs,
          next.qualifiedAt,
          current.profileId,
          current.kstDate,
          current.hands,
          current.sngs,
          current.qualifiedAt,
        );
        if (result.changes !== 1) {
          throw new ProgressionPersistenceError('PROGRESSION_CONFLICT');
        }
      }
      return Object.freeze({
        progress: next,
        becameQualified: current?.qualifiedAt === null
          ? qualifiedAt !== null
          : current === null && qualifiedAt !== null,
      });
    } catch (error) {
      rethrowUnexpected(error, 'PROGRESSION_PERSISTENCE_INVALID');
    }
  }

  /** Must be called inside a caller-owned PokerDatabase transaction. */
  grantStackableInventoryItemInTransaction(
    grant: StackableInventoryGrant,
  ): boolean {
    this.assertTransaction();
    const safe = copyStackableInventoryGrant(grant);
    assertNonemptyString(safe.idempotencyKey, 'PROGRESSION_VALUE_INVALID');
    assertProfileId(safe.profileId);
    if (!CATALOG_ITEM_ID_PATTERN.test(safe.itemId)) {
      throw new ProgressionPersistenceError('PROGRESSION_VALUE_INVALID');
    }
    if (safe.balanceVersion !== SUPPORTED_BALANCE_VERSION) {
      throw new ProgressionPersistenceError('PROGRESSION_VALUE_INVALID');
    }
    if (safe.source !== 'streak') {
      throw new ProgressionPersistenceError('PROGRESSION_VALUE_INVALID');
    }
    assertNonemptyString(safe.sourceRef, 'PROGRESSION_VALUE_INVALID');
    assertMissionDate(safe.sourceDate);
    assertTimestamp(safe.grantedAt, 'PROGRESSION_TIME_INVALID');
    try {
      const existingRow = this.database.db.prepare(`
        SELECT idempotency_key, profile_id, item_id, source, source_ref,
               source_date, quantity, granted_at
        FROM progression_item_grants WHERE idempotency_key = ?
      `).get(safe.idempotencyKey) as ProgressionItemGrantRow | undefined;
      if (existingRow) {
        const existing = mapProgressionItemGrant(existingRow);
        if (
          existing.profileId !== safe.profileId
          || existing.itemId !== safe.itemId
          || existing.source !== safe.source
          || existing.sourceRef !== safe.sourceRef
          || existing.sourceDate !== safe.sourceDate
          || existing.grantedAt !== safe.grantedAt
        ) {
          throw new ProgressionPersistenceError('PROGRESSION_EVENT_CONFLICT');
        }
        this.assertFragmentInventoryCorrespondence(safe.profileId, safe.itemId);
        return false;
      }

      this.database.db.prepare(`
        INSERT INTO progression_item_grants (
          idempotency_key, profile_id, item_id, source, source_ref,
          source_date, quantity, granted_at
        ) VALUES (?, ?, ?, ?, ?, ?, 1, ?)
      `).run(
        safe.idempotencyKey,
        safe.profileId,
        safe.itemId,
        safe.source,
        safe.sourceRef,
        safe.sourceDate,
        safe.grantedAt,
      );
      this.assertFragmentInventoryCorrespondence(safe.profileId, safe.itemId);
      return true;
    } catch (error) {
      rethrowUnexpected(error, 'PROGRESSION_PERSISTENCE_INVALID');
    }
  }

  /** Must be called inside a caller-owned PokerDatabase transaction. */
  getFragmentGrantForSourceInTransaction(
    profileId: string,
    sourceRef: string,
  ): ProgressionItemGrantReceipt | null {
    this.assertTransaction();
    assertProfileId(profileId);
    assertNonemptyString(sourceRef, 'PROGRESSION_VALUE_INVALID');
    try {
      const row = this.database.db.prepare(`
        SELECT idempotency_key, profile_id, item_id, source, source_ref,
               source_date, quantity, granted_at
        FROM progression_item_grants
        WHERE profile_id = ? AND item_id = 'streak-fragment'
          AND source = 'streak' AND source_ref = ?
      `).get(profileId, sourceRef) as ProgressionItemGrantRow | undefined;
      if (!row) return null;
      const receipt = mapProgressionItemGrant(row);
      this.assertFragmentInventoryCorrespondence(profileId, receipt.itemId);
      return receipt;
    } catch (error) {
      rethrowUnexpected(error, 'PROGRESSION_PERSISTENCE_INVALID');
    }
  }

  /** Must be called inside a caller-owned PokerDatabase transaction. */
  getProgressionEvent(idempotencyKey: string): ProgressionEvent | null {
    this.assertTransaction();
    assertNonemptyString(idempotencyKey, 'PROGRESSION_VALUE_INVALID');
    try {
      const row = this.database.db.prepare(`
        SELECT
          idempotency_key, profile_id, event_type, balance_version,
          summary_json, created_at
        FROM progression_events WHERE idempotency_key = ?
      `).get(idempotencyKey) as ProgressionEventRow | undefined;
      return row ? mapProgressionEvent(row) : null;
    } catch (error) {
      if (error instanceof ProgressionPersistenceError) throw error;
      throw persistenceInvalid();
    }
  }

  /** Must be called inside a caller-owned PokerDatabase transaction. */
  insertProgressionEvent(
    event: NewProgressionEvent,
  ): InsertProgressionEventResult {
    this.assertTransaction();
    const identity = copyEventIdentity(event);
    assertNonemptyString(identity.idempotencyKey, 'PROGRESSION_VALUE_INVALID');
    assertProfileId(identity.profileId);
    assertNonemptyString(identity.eventType, 'PROGRESSION_VALUE_INVALID');
    assertPositiveSafeInteger(
      identity.balanceVersion,
      'PROGRESSION_VALUE_INVALID',
    );
    const existing = this.getProgressionEvent(identity.idempotencyKey);
    if (existing) {
      if (
        existing.profileId !== identity.profileId
        || existing.eventType !== identity.eventType
        || existing.balanceVersion !== identity.balanceVersion
      ) {
        throw new ProgressionPersistenceError('PROGRESSION_EVENT_CONFLICT');
      }
      return { status: 'duplicate', event: existing };
    }
    if (identity.balanceVersion !== SUPPORTED_BALANCE_VERSION) {
      throw new ProgressionPersistenceError('PROGRESSION_VALUE_INVALID');
    }
    const createdAt = copyEventCreatedAt(event);
    assertTimestamp(createdAt, 'PROGRESSION_TIME_INVALID');
    let canonical: CanonicalSummary;
    try {
      canonical = canonicalizeSummary(
        event.summary,
        'PROGRESSION_VALUE_INVALID',
      );
    } catch {
      throw new ProgressionPersistenceError('PROGRESSION_VALUE_INVALID');
    }
    try {
      if (!this.profileExists(identity.profileId)) {
        throw new ProgressionPersistenceError('PROGRESSION_PROFILE_NOT_FOUND');
      }
      this.database.db.prepare(`
        INSERT INTO progression_events (
          idempotency_key, profile_id, event_type, balance_version,
          summary_json, created_at
        ) VALUES (?, ?, ?, ?, ?, ?)
      `).run(
        identity.idempotencyKey,
        identity.profileId,
        identity.eventType,
        identity.balanceVersion,
        canonical.json,
        createdAt,
      );
      return {
        status: 'inserted',
        event: { ...identity, summary: canonical.value, createdAt },
      };
    } catch (error) {
      rethrowUnexpected(error, 'PROGRESSION_PERSISTENCE_INVALID');
    }
  }

  private assertTransaction(): void {
    try {
      this.database.assertTransactionActive();
    } catch {
      throw new ProgressionPersistenceError(
        'PROGRESSION_TRANSACTION_REQUIRED',
      );
    }
  }

  private profileExists(profileId: string): boolean {
    return this.database.db.prepare(`
      SELECT 1 FROM profiles WHERE id = ?
    `).get(profileId) !== undefined;
  }

  private assertFragmentInventoryCorrespondence(
    profileId: string,
    itemId: string,
  ): void {
    const receiptCount = this.database.db.prepare(`
      SELECT COUNT(*) AS count FROM progression_item_grants
      WHERE profile_id = ? AND item_id = ? AND source = 'streak'
    `).get(profileId, itemId) as { count: number };
    const inventoryRow = this.database.db.prepare(`
      SELECT profile_id, item_id, quantity, granted_at, updated_at
      FROM inventory_items WHERE profile_id = ? AND item_id = ?
    `).get(profileId, itemId) as InventoryItemRow | undefined;
    if (
      !Number.isSafeInteger(receiptCount.count)
      || receiptCount.count < 1
      || !inventoryRow
      || mapInventoryItem(inventoryRow).quantity !== receiptCount.count
    ) {
      throw persistenceInvalid();
    }
  }

  private selectDailyMissionRows(
    profileId: string,
    missionDate: string,
  ): DailyMissionRow[] {
    return this.database.db.prepare(`
      SELECT
        profile_id, mission_date, slot, mission_id, target, progress,
        balance_version, reroll_count, assigned_at, completed_at, rewarded_at
      FROM daily_missions
      WHERE profile_id = ? AND mission_date = ?
      ORDER BY slot
    `).all(profileId, missionDate) as unknown as DailyMissionRow[];
  }
}

function copyCoreUpdate(update: ProgressionCoreUpdate): ProgressionCoreUpdate {
  try {
    return {
      profileId: update.profileId,
      expected: copyCore(update.expected),
      next: copyCore(update.next),
      updatedAt: update.updatedAt,
    };
  } catch {
    throw new ProgressionPersistenceError('PROGRESSION_VALUE_INVALID');
  }
}

function copyCore(value: ProgressionCore): ProgressionCore {
  return {
    balanceVersion: value.balanceVersion,
    dojoLevel: value.dojoLevel,
    dojoXpMilli: value.dojoXpMilli,
    selectedCharacterId: value.selectedCharacterId,
  };
}

function copyCountersUpdate(
  update: ProgressionCountersUpdate,
): ProgressionCountersUpdate {
  try {
    return {
      profileId: update.profileId,
      expected: copyCounters(update.expected),
      next: copyCounters(update.next),
      updatedAt: update.updatedAt,
    };
  } catch {
    throw new ProgressionPersistenceError('PROGRESSION_VALUE_INVALID');
  }
}

function copyCounters(value: ProgressionCounters): ProgressionCounters {
  return {
    practiceDate: value.practiceDate,
    practiceHands: value.practiceHands,
    completedHands: value.completedHands,
    cashHands: value.cashHands,
    practiceHandsTotal: value.practiceHandsTotal,
    sngCompletions: value.sngCompletions,
    bestStreak: value.bestStreak,
  };
}

function copyAffinityUpdate(update: AffinityUpdate): AffinityUpdate {
  try {
    return {
      profileId: update.profileId,
      characterId: update.characterId,
      expected: {
        level: update.expected.level,
        xpMilli: update.expected.xpMilli,
      },
      next: {
        level: update.next.level,
        xpMilli: update.next.xpMilli,
      },
    };
  } catch {
    throw new ProgressionPersistenceError('PROGRESSION_VALUE_INVALID');
  }
}

function copyDailyMissionProgressUpdate(
  update: DailyMissionProgressUpdate,
): DailyMissionProgressUpdate {
  try {
    return {
      profileId: update.profileId,
      missionDate: update.missionDate,
      balanceVersion: update.balanceVersion,
      metricDeltas: { ...update.metricDeltas },
      completedAt: update.completedAt,
    };
  } catch {
    throw new ProgressionPersistenceError('PROGRESSION_VALUE_INVALID');
  }
}

function copyDailyMissionReplacement(
  replacement: DailyMissionReplacement,
): DailyMissionReplacement {
  try {
    return {
      profileId: replacement.profileId,
      missionDate: replacement.missionDate,
      balanceVersion: replacement.balanceVersion,
      slot: replacement.slot,
      replacementMissionId: replacement.replacementMissionId,
      replacedAt: replacement.replacedAt,
    };
  } catch {
    throw new ProgressionPersistenceError('PROGRESSION_VALUE_INVALID');
  }
}

function copyStreakStateUpdate(update: StreakStateUpdate): StreakStateUpdate {
  try {
    return {
      profileId: update.profileId,
      expected: {
        currentStreak: update.expected.currentStreak,
        restPasses: update.expected.restPasses,
        lastQualifiedDate: update.expected.lastQualifiedDate,
        lastWeekKey: update.expected.lastWeekKey,
        updatedAt: update.expected.updatedAt,
      },
      next: {
        currentStreak: update.next.currentStreak,
        restPasses: update.next.restPasses,
        lastQualifiedDate: update.next.lastQualifiedDate,
        lastWeekKey: update.next.lastWeekKey,
      },
      updatedAt: update.updatedAt,
    };
  } catch {
    throw new ProgressionPersistenceError('PROGRESSION_VALUE_INVALID');
  }
}

function copyStreakDailyProgressUpdate(
  update: StreakDailyProgressUpdate,
): StreakDailyProgressUpdate {
  try {
    return {
      profileId: update.profileId,
      kstDate: update.kstDate,
      kind: update.kind,
      completedAt: update.completedAt,
    };
  } catch {
    throw new ProgressionPersistenceError('PROGRESSION_VALUE_INVALID');
  }
}

function copyStackableInventoryGrant(
  grant: StackableInventoryGrant,
): StackableInventoryGrant {
  try {
    return {
      idempotencyKey: grant.idempotencyKey,
      profileId: grant.profileId,
      itemId: grant.itemId,
      balanceVersion: grant.balanceVersion,
      grantedAt: grant.grantedAt,
      source: grant.source,
      sourceRef: grant.sourceRef,
      sourceDate: grant.sourceDate,
    };
  } catch {
    throw new ProgressionPersistenceError('PROGRESSION_VALUE_INVALID');
  }
}

function copyEventIdentity(event: NewProgressionEvent): Pick<
  ProgressionEvent,
  'idempotencyKey' | 'profileId' | 'eventType' | 'balanceVersion'
> {
  try {
    return {
      idempotencyKey: event.idempotencyKey,
      profileId: event.profileId,
      eventType: event.eventType,
      balanceVersion: event.balanceVersion,
    };
  } catch {
    throw new ProgressionPersistenceError('PROGRESSION_VALUE_INVALID');
  }
}

function copyEventCreatedAt(event: NewProgressionEvent): number {
  try {
    return event.createdAt;
  } catch {
    throw new ProgressionPersistenceError('PROGRESSION_VALUE_INVALID');
  }
}

function mapProgressionProfile(row: ProgressionProfileRow): ProgressionProfile {
  if (typeof row.profile_id !== 'string' || row.profile_id.length === 0) {
    throw persistenceInvalid();
  }
  const core: ProgressionCore = {
    balanceVersion: row.balance_version,
    dojoLevel: row.dojo_level,
    dojoXpMilli: row.dojo_xp_milli,
    selectedCharacterId: row.selected_character_id as PlayableCharacterId,
  };
  const counters: ProgressionCounters = {
    practiceDate: row.practice_date,
    practiceHands: row.practice_hands,
    completedHands: row.completed_hands,
    cashHands: row.cash_hands,
    practiceHandsTotal: row.practice_hands_total,
    sngCompletions: row.sng_completions,
    bestStreak: row.best_streak,
  };
  assertProgressionCore(core, 'PROGRESSION_PERSISTENCE_INVALID');
  assertProgressionCounters(counters, 'PROGRESSION_PERSISTENCE_INVALID');
  assertStoredTimestamp(row.created_at);
  assertStoredTimestamp(row.updated_at);
  if (row.updated_at < row.created_at) throw persistenceInvalid();
  return {
    profileId: row.profile_id,
    ...core,
    ...counters,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapCharacterAffinity(
  row: CharacterAffinityRow,
  balanceVersion: number,
): CharacterAffinity {
  if (typeof row.profile_id !== 'string' || row.profile_id.length === 0) {
    throw persistenceInvalid();
  }
  let characterId: PlayableCharacterId;
  try {
    characterId = assertPlayableCharacter(row.character_id);
    assertAffinityValue(
      { level: row.level, xpMilli: row.xp_milli },
      'PROGRESSION_PERSISTENCE_INVALID',
      balanceVersion,
    );
  } catch {
    throw persistenceInvalid();
  }
  return {
    profileId: row.profile_id,
    characterId,
    level: row.level,
    xpMilli: row.xp_milli,
  };
}

function mapStreakState(row: StreakStateRow): StreakState {
  if (
    typeof row.profile_id !== 'string'
    || row.profile_id.length === 0
    || !isNonnegativeSafeInteger(row.current_streak)
    || !Number.isSafeInteger(row.rest_passes)
    || row.rest_passes < 0
    || row.rest_passes > 1
    || !isCanonicalNullableDate(row.last_qualified_date)
    || !isCanonicalNullableWeekKey(row.last_week_key)
  ) {
    throw persistenceInvalid();
  }
  assertStoredTimestamp(row.created_at);
  assertStoredTimestamp(row.updated_at);
  if (row.updated_at < row.created_at) throw persistenceInvalid();
  return {
    profileId: row.profile_id,
    currentStreak: row.current_streak,
    restPasses: row.rest_passes,
    lastQualifiedDate: row.last_qualified_date,
    lastWeekKey: row.last_week_key,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapInventoryItem(row: InventoryItemRow): InventoryItem {
  if (
    typeof row.profile_id !== 'string'
    || row.profile_id.length === 0
    || typeof row.item_id !== 'string'
    || row.item_id.length === 0
    || !Number.isSafeInteger(row.quantity)
    || row.quantity <= 0
  ) {
    throw persistenceInvalid();
  }
  assertStoredTimestamp(row.granted_at);
  assertStoredTimestamp(row.updated_at);
  if (row.updated_at < row.granted_at) throw persistenceInvalid();
  return {
    profileId: row.profile_id,
    itemId: row.item_id,
    quantity: row.quantity,
    grantedAt: row.granted_at,
    updatedAt: row.updated_at,
  };
}

function mapProgressionEvent(row: ProgressionEventRow): ProgressionEvent {
  if (
    typeof row.idempotency_key !== 'string'
    || row.idempotency_key.length === 0
    || typeof row.profile_id !== 'string'
    || row.profile_id.length === 0
    || typeof row.event_type !== 'string'
    || row.event_type.length === 0
    || row.balance_version !== SUPPORTED_BALANCE_VERSION
  ) {
    throw persistenceInvalid();
  }
  assertStoredTimestamp(row.created_at);
  if (
    typeof row.summary_json !== 'string'
    || Buffer.byteLength(row.summary_json, 'utf8')
      > PROGRESSION_SUMMARY_LIMITS.maxUtf8Bytes
  ) {
    throw persistenceInvalid();
  }
  let summary: unknown;
  try {
    summary = JSON.parse(row.summary_json);
  } catch {
    throw persistenceInvalid();
  }
  const canonical = canonicalizeSummary(
    summary,
    'PROGRESSION_PERSISTENCE_INVALID',
  );
  return {
    idempotencyKey: row.idempotency_key,
    profileId: row.profile_id,
    eventType: row.event_type,
    balanceVersion: row.balance_version,
    summary: canonical.value,
    createdAt: row.created_at,
  };
}

function mapDailyMission(
  row: DailyMissionRow,
  expectedProfileId: string,
  expectedDate: string,
  expectedBalanceVersion: number,
): DailyMission {
  const definition = typeof row.mission_id === 'string'
    ? getMissionDefinition(row.mission_id)
    : null;
  if (
    row.profile_id !== expectedProfileId
    || row.mission_date !== expectedDate
    || !Number.isSafeInteger(row.slot)
    || row.slot < 0
    || row.slot > 2
    || !definition
    || row.target !== definition.target
    || !Number.isSafeInteger(row.progress)
    || row.progress < 0
    || row.progress > row.target
    || row.balance_version !== expectedBalanceVersion
    || row.balance_version !== SUPPORTED_BALANCE_VERSION
    || !Number.isSafeInteger(row.reroll_count)
    || row.reroll_count < 0
    || row.reroll_count > 1
  ) {
    throw persistenceInvalid();
  }
  assertStoredTimestamp(row.assigned_at);
  if (row.completed_at !== null) assertStoredTimestamp(row.completed_at);
  if (row.rewarded_at !== null) assertStoredTimestamp(row.rewarded_at);
  if (
    (row.progress < row.target && (
      row.completed_at !== null || row.rewarded_at !== null
    ))
    || (row.progress === row.target && (
      row.completed_at === null
      || row.rewarded_at === null
      || row.rewarded_at !== row.completed_at
    ))
  ) {
    throw persistenceInvalid();
  }
  return Object.freeze({
    profileId: row.profile_id,
    missionDate: row.mission_date,
    slot: row.slot,
    missionId: definition.id,
    target: row.target,
    progress: row.progress,
    balanceVersion: row.balance_version,
    rerollCount: row.reroll_count,
    assignedAt: row.assigned_at,
    completedAt: row.completed_at,
    rewardedAt: row.rewarded_at,
  });
}

function mapDailyMissionMode(
  row: DailyMissionModeRow,
  expectedProfileId: string,
  expectedDate: string,
): ProgressionMode {
  if (
    row.profile_id !== expectedProfileId
    || row.mission_date !== expectedDate
  ) {
    throw persistenceInvalid();
  }
  assertProgressionMode(row.mode, 'PROGRESSION_PERSISTENCE_INVALID');
  assertStoredTimestamp(row.created_at);
  return row.mode as ProgressionMode;
}

function mapStreakDailyProgress(
  row: StreakDailyProgressRow,
  profileId: string,
  kstDate: string,
): StreakDailyProgress {
  if (
    row.profile_id !== profileId
    || row.kst_date !== kstDate
    || !isNonnegativeSafeInteger(row.hands)
    || row.hands > 10
    || !isNonnegativeSafeInteger(row.sngs)
    || row.sngs > 1
    || (row.qualified_at !== null && (
      !Number.isSafeInteger(row.qualified_at)
      || row.qualified_at < 0
    ))
    || (row.qualified_at === null) !== (row.hands < 10 && row.sngs === 0)
  ) {
    throw persistenceInvalid();
  }
  if (row.qualified_at !== null) assertStoredTimestamp(row.qualified_at);
  return Object.freeze({
    profileId: row.profile_id,
    kstDate: row.kst_date,
    hands: row.hands,
    sngs: row.sngs,
    qualifiedAt: row.qualified_at,
  });
}

function mapProgressionItemGrant(
  row: ProgressionItemGrantRow,
): ProgressionItemGrantReceipt {
  if (
    typeof row.idempotency_key !== 'string'
    || row.idempotency_key.length === 0
    || typeof row.profile_id !== 'string'
    || row.profile_id.length === 0
    || row.item_id !== 'streak-fragment'
    || row.source !== 'streak'
    || typeof row.source_ref !== 'string'
    || row.source_ref.length === 0
    || !isCanonicalDate(row.source_date)
    || row.quantity !== 1
  ) {
    throw persistenceInvalid();
  }
  assertStoredTimestamp(row.granted_at);
  return Object.freeze({
    idempotencyKey: row.idempotency_key,
    profileId: row.profile_id,
    itemId: row.item_id,
    source: 'streak',
    sourceRef: row.source_ref,
    sourceDate: row.source_date,
    quantity: 1,
    grantedAt: row.granted_at,
  });
}

function validateDailyMissionSet(missions: readonly DailyMission[]): void {
  if (
    missions.length !== 3
    || missions.some((mission, index) => mission.slot !== index)
    || new Set(missions.map(mission => mission.missionId)).size !== 3
    || missions.reduce((sum, mission) => sum + mission.rerollCount, 0) > 1
  ) {
    throw persistenceInvalid();
  }
}

function freezeMissionDay(
  day: DailyMissionDaySnapshot,
): DailyMissionDaySnapshot {
  Object.freeze(day.missions);
  Object.freeze(day.modes);
  return Object.freeze(day);
}

function assertProgressionCore(
  value: ProgressionCore,
  code: ProgressionErrorCode,
): void {
  const balance = getSupportedBalance(value.balanceVersion, code);
  if (
    !Number.isSafeInteger(value.dojoLevel)
    || value.dojoLevel < 1
    || value.dojoLevel > balance.dojoMaxLevel
    || !isNonnegativeSafeInteger(value.dojoXpMilli)
    || (value.dojoLevel === balance.dojoMaxLevel
      && value.dojoXpMilli !== 0)
    || (value.dojoLevel < balance.dojoMaxLevel
      && value.dojoXpMilli >= balance.dojoXpForNextLevel(value.dojoLevel))
  ) {
    throw new ProgressionPersistenceError(code);
  }
  try {
    assertPlayableCharacter(value.selectedCharacterId);
  } catch {
    throw new ProgressionPersistenceError(code);
  }
}

function assertProgressionCounters(
  value: ProgressionCounters,
  code: ProgressionErrorCode,
): void {
  if (
    !isCanonicalNullableDate(value.practiceDate)
    || !isNonnegativeSafeInteger(value.practiceHands)
    || !isNonnegativeSafeInteger(value.completedHands)
    || !isNonnegativeSafeInteger(value.cashHands)
    || !isNonnegativeSafeInteger(value.practiceHandsTotal)
    || !isNonnegativeSafeInteger(value.sngCompletions)
    || !isNonnegativeSafeInteger(value.bestStreak)
    || (value.practiceDate === null && value.practiceHands !== 0)
  ) {
    throw new ProgressionPersistenceError(code);
  }
}

function assertStreakMutableState(
  value: StreakMutableState,
  code: ProgressionErrorCode,
): void {
  if (
    !isNonnegativeSafeInteger(value.currentStreak)
    || !Number.isSafeInteger(value.restPasses)
    || value.restPasses < 0
    || value.restPasses > 1
    || (value.lastQualifiedDate === null) !== (value.currentStreak === 0)
    || !isCanonicalNullableDate(value.lastQualifiedDate)
    || !isCanonicalNullableWeekKey(value.lastWeekKey)
  ) {
    throw new ProgressionPersistenceError(code);
  }
}

function assertAffinityValue(
  value: Pick<CharacterAffinity, 'level' | 'xpMilli'>,
  code: ProgressionErrorCode,
  balanceVersion = SUPPORTED_BALANCE_VERSION,
): void {
  const balance = getSupportedBalance(balanceVersion, code);
  if (
    !Number.isSafeInteger(value.level)
    || value.level < 1
    || value.level > balance.affinityMaxLevel
    || !isNonnegativeSafeInteger(value.xpMilli)
    || (value.level === balance.affinityMaxLevel && value.xpMilli !== 0)
    || (value.level < balance.affinityMaxLevel
      && value.xpMilli >= balance.affinityForNextLevel(value.level))
  ) {
    throw new ProgressionPersistenceError(code);
  }
}

function getSupportedBalance(
  version: number,
  code: ProgressionErrorCode,
): ProgressionBalance {
  if (version !== SUPPORTED_BALANCE_VERSION) {
    throw new ProgressionPersistenceError(code);
  }
  try {
    return getBalance(version);
  } catch {
    throw new ProgressionPersistenceError(code);
  }
}

function assertPlayableCharacter(value: string): PlayableCharacterId {
  if (!(PLAYABLE_CHARACTER_IDS as readonly string[]).includes(value)) {
    throw new ProgressionPersistenceError('PROGRESSION_CHARACTER_INVALID');
  }
  return value as PlayableCharacterId;
}

function assertProfileId(value: string): void {
  assertNonemptyString(value, 'PROGRESSION_VALUE_INVALID');
}

function assertMissionIdentity(
  profileId: string,
  missionDate: string,
  balanceVersion: number,
): void {
  assertMissionProfileId(profileId);
  assertMissionDate(missionDate);
  if (balanceVersion !== SUPPORTED_BALANCE_VERSION) {
    throw new ProgressionPersistenceError('PROGRESSION_VALUE_INVALID');
  }
}

function assertMissionProfileId(value: string): void {
  if (
    typeof value !== 'string'
    || !/^[A-Za-z0-9_-]{1,128}$/.test(value)
  ) {
    throw new ProgressionPersistenceError('PROGRESSION_VALUE_INVALID');
  }
}

function assertMissionDate(value: string): void {
  if (!isCanonicalDate(value)) {
    throw new ProgressionPersistenceError('PROGRESSION_VALUE_INVALID');
  }
}

function assertProgressionMode(
  value: string,
  code: ProgressionErrorCode = 'PROGRESSION_VALUE_INVALID',
): asserts value is ProgressionMode {
  if (value !== 'cash' && value !== 'practice' && value !== 'sng') {
    throw new ProgressionPersistenceError(code);
  }
}

function assertMetricDeltas(
  value: DailyMissionProgressUpdate['metricDeltas'],
): void {
  const allowed = new Set([
    'handsAny',
    'handsCash',
    'handsPractice',
    'sngCompleted',
  ]);
  const keys = Object.keys(value);
  if (
    keys.some(key => !allowed.has(key))
    || keys.some(key => !isNonnegativeSafeInteger(
      value[key as keyof typeof value] as number,
    ))
  ) {
    throw new ProgressionPersistenceError('PROGRESSION_VALUE_INVALID');
  }
}

function clampedAdd(current: number, delta: number, target: number): number {
  const remaining = target - current;
  return delta >= remaining ? target : current + delta;
}

function assertNonemptyString(
  value: string,
  code: ProgressionErrorCode,
): void {
  if (typeof value !== 'string' || value.length === 0) {
    throw new ProgressionPersistenceError(code);
  }
}

function assertTimestamp(value: number, code: ProgressionErrorCode): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new ProgressionPersistenceError(code);
  }
  const date = new Date(value);
  if (
    !Number.isFinite(date.getTime())
    || date.getUTCFullYear() < 1
    || date.getUTCFullYear() > 9_999
  ) {
    throw new ProgressionPersistenceError(code);
  }
}

function assertStoredTimestamp(value: number): void {
  assertTimestamp(value, 'PROGRESSION_PERSISTENCE_INVALID');
}

function assertPositiveSafeInteger(
  value: number,
  code: ProgressionErrorCode,
): void {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new ProgressionPersistenceError(code);
  }
}

function isNonnegativeSafeInteger(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0;
}

function isCanonicalNullableDate(value: string | null): boolean {
  return value === null || isCanonicalDate(value);
}

function isCanonicalDate(value: string): boolean {
  if (typeof value !== 'string') return false;
  const match = CANONICAL_DATE_PATTERN.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (year < 1 || year > 9_999 || month < 1 || month > 12) return false;
  const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [
    31,
    leapYear ? 29 : 28,
    31,
    30,
    31,
    30,
    31,
    31,
    30,
    31,
    30,
    31,
  ];
  return day >= 1 && day <= days[month - 1];
}

function isCanonicalNullableWeekKey(value: string | null): boolean {
  if (value === null) return true;
  if (typeof value !== 'string') return false;
  const match = WEEK_KEY_PATTERN.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const week = Number(match[2]);
  return year >= 1 && year <= 9_999 && week >= 1 && week <= 53;
}

function emptyEquipment(): Record<EquipmentSlot, string | null> {
  return { title: null, frame: null, skin: null, cutin: null };
}

function isEquipmentSlot(value: string): value is EquipmentSlot {
  return (EQUIPMENT_SLOTS as readonly string[]).includes(value);
}

type CanonicalJsonPrimitive = null | string | boolean | number;
type CanonicalJsonValue =
  | CanonicalJsonPrimitive
  | CanonicalJsonObject
  | CanonicalJsonValue[];
interface CanonicalJsonObject {
  [key: string]: CanonicalJsonValue;
}

interface CanonicalSummary {
  value: Record<string, unknown>;
  json: string;
}

interface CloneFrame {
  source: object;
  target: CanonicalJsonObject | CanonicalJsonValue[];
  depth: number;
  ancestors: ReadonlySet<object>;
}

function canonicalizeSummary(
  summary: unknown,
  code: ProgressionErrorCode,
): CanonicalSummary {
  try {
    if (summary === null || typeof summary !== 'object' || Array.isArray(summary)) {
      throw new ProgressionPersistenceError(code);
    }
    const rootPrototype = Object.getPrototypeOf(summary);
    if (rootPrototype !== Object.prototype && rootPrototype !== null) {
      throw new ProgressionPersistenceError(code);
    }

    const root = Object.create(null) as CanonicalJsonObject;
    const stack: CloneFrame[] = [{
      source: summary,
      target: root,
      depth: 0,
      ancestors: new Set([summary]),
    }];
    let nodeCount = 1;

    const cloneValue = (
      value: unknown,
      depth: number,
      ancestors: ReadonlySet<object>,
    ): CanonicalJsonValue => {
      nodeCount += 1;
      if (nodeCount > PROGRESSION_SUMMARY_LIMITS.maxNodes) {
        throw new ProgressionPersistenceError(code);
      }
      if (
        value === null
        || typeof value === 'string'
        || typeof value === 'boolean'
      ) {
        return value;
      }
      if (typeof value === 'number') {
        if (!Number.isSafeInteger(value)) {
          throw new ProgressionPersistenceError(code);
        }
        return Object.is(value, -0) ? 0 : value;
      }
      if (typeof value !== 'object' || depth > PROGRESSION_SUMMARY_LIMITS.maxDepth) {
        throw new ProgressionPersistenceError(code);
      }
      if (ancestors.has(value)) throw new ProgressionPersistenceError(code);
      const childAncestors = new Set(ancestors);
      childAncestors.add(value);
      const child: CanonicalJsonObject | CanonicalJsonValue[] = Array.isArray(value)
        ? []
        : Object.create(null) as CanonicalJsonObject;
      stack.push({
        source: value,
        target: child,
        depth,
        ancestors: childAncestors,
      });
      return child;
    };

    while (stack.length > 0) {
      const frame = stack.pop() as CloneFrame;
      if (frame.depth > PROGRESSION_SUMMARY_LIMITS.maxDepth) {
        throw new ProgressionPersistenceError(code);
      }
      const prototype = Object.getPrototypeOf(frame.source);
      const descriptors = Object.getOwnPropertyDescriptors(frame.source);
      const ownKeys = Reflect.ownKeys(descriptors);

      if (Array.isArray(frame.source)) {
        if (prototype !== Array.prototype || !Array.isArray(frame.target)) {
          throw new ProgressionPersistenceError(code);
        }
        if (ownKeys.some(key => typeof key === 'symbol')) {
          throw new ProgressionPersistenceError(code);
        }
        const lengthDescriptor = descriptors.length;
        if (
          !lengthDescriptor
          || !('value' in lengthDescriptor)
          || lengthDescriptor.enumerable
          || !Number.isSafeInteger(lengthDescriptor.value)
          || lengthDescriptor.value < 0
        ) {
          throw new ProgressionPersistenceError(code);
        }
        const length = lengthDescriptor.value as number;
        const indexKeys = (ownKeys as string[]).filter(key => key !== 'length');
        if (
          indexKeys.length !== length
          || length > PROGRESSION_SUMMARY_LIMITS.maxNodes
        ) {
          throw new ProgressionPersistenceError(code);
        }
        indexKeys.sort((left, right) => Number(left) - Number(right));
        for (const key of indexKeys) {
          const index = Number(key);
          const descriptor = descriptors[key];
          if (
            !Number.isSafeInteger(index)
            || index < 0
            || index >= length
            || String(index) !== key
            || !descriptor
            || !descriptor.enumerable
            || !('value' in descriptor)
          ) {
            throw new ProgressionPersistenceError(code);
          }
          frame.target[index] = cloneValue(
            descriptor.value,
            frame.depth + 1,
            frame.ancestors,
          );
        }
      } else {
        if (
          (prototype !== Object.prototype && prototype !== null)
          || Array.isArray(frame.target)
        ) {
          throw new ProgressionPersistenceError(code);
        }
        if (ownKeys.some(key => typeof key === 'symbol')) {
          throw new ProgressionPersistenceError(code);
        }
        const keys = ownKeys as string[];
        if (keys.length > PROGRESSION_SUMMARY_LIMITS.maxNodes) {
          throw new ProgressionPersistenceError(code);
        }
        keys.sort();
        for (const key of keys) {
          const descriptor = descriptors[key];
          if (
            DANGEROUS_SUMMARY_KEYS.has(key)
            || !descriptor
            || !descriptor.enumerable
            || !('value' in descriptor)
          ) {
            throw new ProgressionPersistenceError(code);
          }
          Object.defineProperty(frame.target, key, {
            value: cloneValue(
              descriptor.value,
              frame.depth + 1,
              frame.ancestors,
            ),
            enumerable: true,
            configurable: false,
            writable: false,
          });
        }
      }
      Object.freeze(frame.target);
    }

    const json = JSON.stringify(root);
    if (Buffer.byteLength(json, 'utf8') > PROGRESSION_SUMMARY_LIMITS.maxUtf8Bytes) {
      throw new ProgressionPersistenceError(code);
    }
    return { value: root, json };
  } catch {
    throw new ProgressionPersistenceError(code);
  }
}

function rethrowUnexpected(
  error: unknown,
  code: ProgressionErrorCode,
): never {
  if (error instanceof ProgressionPersistenceError) throw error;
  throw new ProgressionPersistenceError(code);
}

function persistenceInvalid(): ProgressionPersistenceError {
  return new ProgressionPersistenceError('PROGRESSION_PERSISTENCE_INVALID');
}
