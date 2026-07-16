import {
  applyAffinityXp,
  applyDojoXp,
  getBalance,
  scaleReward,
  type ProgressionBalance,
} from '@/lib/progression/balance';
import {
  getMissionDefinition,
  selectRerollMission,
} from '@/lib/progression/missions';
import {
  advanceStreakDay,
  reconcileWeeklyRestPass,
} from '@/lib/progression/streak';
import { STREAK_FRAGMENT_ITEM } from '@/lib/collection/catalog';
import type {
  MissionCompletion,
  ProgressionRewardSummary,
} from '@/lib/progression/types';
import type { PokerDatabase } from './persistence/database';
import {
  PLAYABLE_CHARACTER_IDS,
  ProgressionPersistenceError,
  ProgressionRepository,
  type CharacterAffinity,
  type DailyMissionDaySnapshot,
  type PlayableCharacterId,
  type ProgressionCounters,
  type ProgressionEvent,
  type ProgressionProfile,
  type ProgressionSnapshot,
  type StreakState,
} from './progression-repository';
import { getKstDateKey } from './economy-service';

const EVENT_TYPE_COMPLETED_HAND = 'completed-hand';
const EVENT_TYPE_SNG_FINISH = 'sng-finish';
const MAX_EVENT_ID_COMPONENT_LENGTH = 128;
const MAX_EVENT_ID_LENGTH = 384;
const INTERNAL_ID_PATTERN = /^[A-Za-z0-9_-]+$/;
const CATALOG_ITEM_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;
const REQUIRED_SUMMARY_KEYS = [
  'eventId',
  'dojoXpMilli',
  'dojoLevelsGained',
  'characterId',
  'affinityMilli',
  'affinityLevelsGained',
  'missionCompletions',
  'grantedItemIds',
] as const;

export type ProgressionServiceErrorCode =
  | 'PROGRESSION_INPUT_INVALID'
  | 'PROGRESSION_CHARACTER_STALE'
  | 'PROGRESSION_COUNTER_OVERFLOW'
  | 'PROGRESSION_STORED_SUMMARY_INVALID'
  | 'PROGRESSION_PROFILE_NOT_FOUND'
  | 'PROGRESSION_MISSION_NOT_FOUND'
  | 'PROGRESSION_MISSION_COMPLETED'
  | 'PROGRESSION_MISSION_REROLL_USED';

export class ProgressionServiceError extends Error {
  constructor(readonly code: ProgressionServiceErrorCode) {
    super(code);
    this.name = 'ProgressionServiceError';
  }
}

export interface CompletedHandInput {
  profileId: string;
  roomId: string;
  handNumber: number;
  mode: 'cash' | 'practice';
  selectedCharacterId: string;
  completedAt: number;
}

export interface SngFinishInput {
  profileId: string;
  roomId: string;
  place: number;
  selectedCharacterId: string;
  completedAt: number;
}

interface ValidCompletedHandInput extends Omit<
  CompletedHandInput,
  'selectedCharacterId'
> {
  selectedCharacterId: PlayableCharacterId;
  kstDate: string;
}

interface ValidSngFinishInput extends Omit<SngFinishInput, 'selectedCharacterId'> {
  selectedCharacterId: PlayableCharacterId;
  kstDate: string;
}

interface StreakReward {
  change?: ProgressionRewardSummary['streak'];
  grantedItemIds: string[];
  bestStreak: number;
}

export class ProgressionService {
  private readonly repository: ProgressionRepository;

  constructor(
    private readonly database: PokerDatabase,
    repository?: ProgressionRepository,
  ) {
    this.repository = repository ?? new ProgressionRepository(database);
  }

  getSnapshot(
    profileId: string,
    selectedCharacterId: string,
    at = Date.now(),
  ): ProgressionSnapshot {
    assertBoundedId(profileId);
    const characterId = assertCharacter(selectedCharacterId);
    assertTimestamp(at);
    return this.database.transaction(() => {
      const snapshot = this.repository.getOrCreateInTransaction(
        profileId,
        characterId,
        at,
      );
      assertAuthoritativeCharacter(
        snapshot.profile.selectedCharacterId,
        characterId,
      );
      return this.reconcileWeeklyRestPass(snapshot, at);
    });
  }

  recordCompletedHand(input: CompletedHandInput): ProgressionRewardSummary {
    const safeInput = validateCompletedHandInput(input);
    const eventId = buildCompletedHandEventId(
      safeInput.profileId,
      safeInput.roomId,
      safeInput.handNumber,
    );

    return this.database.transaction(() => {
      const duplicate = this.getDuplicate(
        eventId,
        safeInput.profileId,
        EVENT_TYPE_COMPLETED_HAND,
        safeInput.completedAt,
      );
      if (duplicate) return duplicate;

      let snapshot = this.repository.getOrCreateInTransaction(
        safeInput.profileId,
        safeInput.selectedCharacterId,
        safeInput.completedAt,
      );
      assertAuthoritativeCharacter(
        snapshot.profile.selectedCharacterId,
        safeInput.selectedCharacterId,
      );
      snapshot = this.reconcileWeeklyRestPass(snapshot, safeInput.completedAt);
      const balance = getBalance(snapshot.profile.balanceVersion);
      const affinity = getSelectedAffinity(
        snapshot.affinities,
        snapshot.profile.selectedCharacterId,
      );
      const missionCompletions = this.progressDailyMissions(
        safeInput.profileId,
        safeInput.kstDate,
        snapshot.profile.balanceVersion,
        safeInput.mode,
        safeInput.completedAt,
      );
      const nextPracticeHands = safeInput.mode === 'practice'
        ? snapshot.profile.practiceDate === safeInput.kstDate
          ? safeIncrement(snapshot.profile.practiceHands)
          : 1
        : snapshot.profile.practiceHands;
      const ratePermille = safeInput.mode === 'practice'
        && nextPracticeHands > balance.practiceFullRewardHandsPerKstDay
        ? balance.practiceReducedRatePermille
        : 1_000;
      const baseDojoReward = scaleReward(
        balance.dojoXpPerCompletedHand,
        ratePermille,
      );
      const dojoReward = addMissionRewards(
        baseDojoReward,
        missionCompletions,
      );
      const affinityReward = scaleReward(
        balance.affinityPerCompletedHand,
        ratePermille,
      );
      const streakReward = this.progressStreak(
        snapshot,
        eventId,
        safeInput.kstDate,
        'hand',
        safeInput.completedAt,
      );
      const nextCounters: ProgressionCounters = {
        practiceDate: safeInput.mode === 'practice'
          ? safeInput.kstDate
          : snapshot.profile.practiceDate,
        practiceHands: nextPracticeHands,
        completedHands: safeIncrement(snapshot.profile.completedHands),
        cashHands: safeInput.mode === 'cash'
          ? safeIncrement(snapshot.profile.cashHands)
          : snapshot.profile.cashHands,
        practiceHandsTotal: safeInput.mode === 'practice'
          ? safeIncrement(snapshot.profile.practiceHandsTotal)
          : snapshot.profile.practiceHandsTotal,
        sngCompletions: snapshot.profile.sngCompletions,
        bestStreak: streakReward.bestStreak,
      };

      return this.applyReward({
        eventId,
        eventType: EVENT_TYPE_COMPLETED_HAND,
        profile: snapshot.profile,
        counters: nextCounters,
        affinity,
        balance,
        dojoReward,
        affinityReward,
        missionCompletions,
        streakChange: streakReward.change,
        grantedItemIds: streakReward.grantedItemIds,
        completedAt: safeInput.completedAt,
      });
    });
  }

  recordSngFinish(input: SngFinishInput): ProgressionRewardSummary {
    const safeInput = validateSngFinishInput(input);
    const eventId = buildSngFinishEventId(
      safeInput.profileId,
      safeInput.roomId,
    );

    return this.database.transaction(() => {
      const duplicate = this.getDuplicate(
        eventId,
        safeInput.profileId,
        EVENT_TYPE_SNG_FINISH,
        safeInput.completedAt,
      );
      if (duplicate) return duplicate;

      let snapshot = this.repository.getOrCreateInTransaction(
        safeInput.profileId,
        safeInput.selectedCharacterId,
        safeInput.completedAt,
      );
      assertAuthoritativeCharacter(
        snapshot.profile.selectedCharacterId,
        safeInput.selectedCharacterId,
      );
      snapshot = this.reconcileWeeklyRestPass(snapshot, safeInput.completedAt);
      const balance = getBalance(snapshot.profile.balanceVersion);
      const affinity = getSelectedAffinity(
        snapshot.affinities,
        snapshot.profile.selectedCharacterId,
      );
      const missionCompletions = this.progressDailyMissions(
        safeInput.profileId,
        safeInput.kstDate,
        snapshot.profile.balanceVersion,
        'sng',
        safeInput.completedAt,
      );
      const placeIndex = safeInput.place - 1;
      const baseDojoReward = balance.dojoXpPerSngPlace[placeIndex];
      const affinityReward = balance.affinityPerSngPlace[placeIndex];
      if (baseDojoReward === undefined || affinityReward === undefined) {
        throw new ProgressionServiceError('PROGRESSION_INPUT_INVALID');
      }
      const dojoReward = addMissionRewards(
        baseDojoReward,
        missionCompletions,
      );
      const streakReward = this.progressStreak(
        snapshot,
        eventId,
        safeInput.kstDate,
        'sng',
        safeInput.completedAt,
      );
      const nextCounters: ProgressionCounters = {
        practiceDate: snapshot.profile.practiceDate,
        practiceHands: snapshot.profile.practiceHands,
        completedHands: snapshot.profile.completedHands,
        cashHands: snapshot.profile.cashHands,
        practiceHandsTotal: snapshot.profile.practiceHandsTotal,
        sngCompletions: safeIncrement(snapshot.profile.sngCompletions),
        bestStreak: streakReward.bestStreak,
      };

      return this.applyReward({
        eventId,
        eventType: EVENT_TYPE_SNG_FINISH,
        profile: snapshot.profile,
        counters: nextCounters,
        affinity,
        balance,
        dojoReward,
        affinityReward,
        missionCompletions,
        streakChange: streakReward.change,
        grantedItemIds: streakReward.grantedItemIds,
        completedAt: safeInput.completedAt,
      });
    });
  }

  rerollMission(
    profileId: string,
    kstDate: string,
    slot: number,
    requestedAt = Date.now(),
  ): DailyMissionDaySnapshot {
    assertBoundedId(profileId);
    if (!Number.isSafeInteger(slot) || slot < 0 || slot > 2) {
      throw new ProgressionServiceError('PROGRESSION_INPUT_INVALID');
    }
    assertTimestamp(requestedAt);
    try {
      if (getKstDateKey(requestedAt) !== kstDate) {
        throw new ProgressionServiceError('PROGRESSION_INPUT_INVALID');
      }
    } catch (error) {
      if (error instanceof ProgressionServiceError) throw error;
      throw new ProgressionServiceError('PROGRESSION_INPUT_INVALID');
    }

    try {
      return this.database.transaction(() => {
        const snapshot = this.repository.getSnapshotInTransaction(profileId);
        const day = this.repository.readDailyMissionDayInTransaction(
          profileId,
          kstDate,
          snapshot.profile.balanceVersion,
        );
        const current = day.missions[slot];
        if (!current) {
          throw new ProgressionServiceError('PROGRESSION_INPUT_INVALID');
        }
        const replacement = selectRerollMission(
          profileId,
          kstDate,
          snapshot.profile.balanceVersion,
          day.missions.map(mission => mission.missionId),
          current.missionId,
        );
        return this.repository.replaceDailyMissionInTransaction({
          profileId,
          missionDate: kstDate,
          balanceVersion: snapshot.profile.balanceVersion,
          slot,
          replacementMissionId: replacement.id,
          replacedAt: requestedAt,
        });
      });
    } catch (error) {
      throwMissionServiceError(error);
    }
  }

  private reconcileWeeklyRestPass(
    snapshot: ProgressionSnapshot,
    at: number,
  ): ProgressionSnapshot {
    const balance = getBalance(snapshot.profile.balanceVersion);
    let reconciled;
    try {
      reconciled = reconcileWeeklyRestPass({
        restPasses: snapshot.streak.restPasses,
        lastWeekKey: snapshot.streak.lastWeekKey,
      }, at, balance);
    } catch {
      throw new ProgressionPersistenceError('PROGRESSION_PERSISTENCE_INVALID');
    }
    if (
      reconciled.restPasses === snapshot.streak.restPasses
      && reconciled.lastWeekKey === snapshot.streak.lastWeekKey
    ) {
      return snapshot;
    }
    const updatedAt = Math.max(snapshot.streak.updatedAt, at);
    this.repository.compareAndUpdateStreakInTransaction({
      profileId: snapshot.profile.profileId,
      expected: mutableStreakWithTimestamp(snapshot.streak),
      next: {
        currentStreak: snapshot.streak.currentStreak,
        restPasses: reconciled.restPasses,
        lastQualifiedDate: snapshot.streak.lastQualifiedDate,
        lastWeekKey: reconciled.lastWeekKey,
      },
      updatedAt,
    });
    return {
      ...snapshot,
      streak: {
        ...snapshot.streak,
        restPasses: reconciled.restPasses,
        lastWeekKey: reconciled.lastWeekKey,
        updatedAt,
      },
    };
  }

  private progressStreak(
    snapshot: ProgressionSnapshot,
    eventId: string,
    kstDate: string,
    kind: 'hand' | 'sng',
    completedAt: number,
  ): StreakReward {
    const daily = this.repository.advanceStreakDailyProgressInTransaction({
      profileId: snapshot.profile.profileId,
      kstDate,
      kind,
      completedAt,
    });
    if (!daily.becameQualified) {
      return {
        grantedItemIds: [],
        bestStreak: snapshot.profile.bestStreak,
      };
    }

    const balance = getBalance(snapshot.profile.balanceVersion);
    let advanced;
    try {
      advanced = advanceStreakDay({
        currentStreak: snapshot.streak.currentStreak,
        restPasses: snapshot.streak.restPasses,
        lastQualifiedDate: snapshot.streak.lastQualifiedDate,
      }, kstDate, balance);
    } catch {
      throw new ProgressionPersistenceError('PROGRESSION_PERSISTENCE_INVALID');
    }
    if (!advanced.changed) {
      return {
        grantedItemIds: [],
        bestStreak: snapshot.profile.bestStreak,
      };
    }

    this.repository.compareAndUpdateStreakInTransaction({
      profileId: snapshot.profile.profileId,
      expected: mutableStreakWithTimestamp(snapshot.streak),
      next: {
        currentStreak: advanced.currentStreak,
        restPasses: advanced.restPasses,
        lastQualifiedDate: advanced.lastQualifiedDate,
        lastWeekKey: snapshot.streak.lastWeekKey,
      },
      updatedAt: Math.max(snapshot.streak.updatedAt, completedAt),
    });

    const grantedItemIds: string[] = [];
    if (advanced.fragmentDue) {
      const granted = this.repository.grantStackableInventoryItemInTransaction({
        idempotencyKey: `streak-fragment:${snapshot.profile.profileId}:${kstDate}`,
        profileId: snapshot.profile.profileId,
        itemId: STREAK_FRAGMENT_ITEM.id,
        balanceVersion: snapshot.profile.balanceVersion,
        grantedAt: completedAt,
        source: 'streak',
        sourceRef: eventId,
        sourceDate: kstDate,
      });
      if (granted) grantedItemIds.push(STREAK_FRAGMENT_ITEM.id);
    }
    return {
      change: {
        previousStreak: advanced.previousStreak,
        currentStreak: advanced.currentStreak,
        restPassUsed: advanced.restPassUsed,
      },
      grantedItemIds,
      bestStreak: Math.max(
        snapshot.profile.bestStreak,
        advanced.currentStreak,
      ),
    };
  }

  private progressDailyMissions(
    profileId: string,
    missionDate: string,
    balanceVersion: number,
    mode: 'cash' | 'practice' | 'sng',
    completedAt: number,
  ): MissionCompletion[] {
    this.repository.ensureDailyMissionsInTransaction(
      profileId,
      missionDate,
      balanceVersion,
      completedAt,
    );
    this.repository.insertDailyMissionModeInTransaction(
      profileId,
      missionDate,
      mode,
      completedAt,
    );
    const metricDeltas = mode === 'cash'
      ? { handsAny: 1, handsCash: 1 }
      : mode === 'practice'
        ? { handsAny: 1, handsPractice: 1 }
        : { sngCompleted: 1 };
    const completed = this.repository.advanceDailyMissionsInTransaction({
      profileId,
      missionDate,
      balanceVersion,
      metricDeltas,
      completedAt,
    });
    const balance = getBalance(balanceVersion);
    return completed.map(mission => ({
      missionId: mission.missionId,
      slot: mission.slot,
      dojoXpMilli: balance.dojoXpPerMission,
    }));
  }

  private getDuplicate(
    eventId: string,
    profileId: string,
    eventType: string,
    completedAt: number,
  ): ProgressionRewardSummary | null {
    const existing = this.repository.getProgressionEvent(eventId);
    if (!existing) return null;
    const duplicate = this.repository.insertProgressionEvent({
      idempotencyKey: eventId,
      profileId,
      eventType,
      balanceVersion: existing.balanceVersion,
      summary: {},
      createdAt: completedAt,
    });
    const summary = parseStoredSummary(duplicate.event, eventId);
    this.validateStoredFragmentClaim(duplicate.event, summary);
    return summary;
  }

  private validateStoredFragmentClaim(
    event: ProgressionEvent,
    summary: ProgressionRewardSummary,
  ): void {
    try {
      const claimsFragment = summary.grantedItemIds.includes(
        STREAK_FRAGMENT_ITEM.id,
      );
      const fragmentDue = summary.streak !== undefined
        && summary.streak.currentStreak % getBalance(
          event.balanceVersion,
        ).streakFragmentEveryDays === 0;
      if (claimsFragment !== fragmentDue) {
        throw new Error('fragment summary mismatch');
      }
      const receipt = this.repository.getFragmentGrantForSourceInTransaction(
        event.profileId,
        event.idempotencyKey,
      );
      if (!fragmentDue) {
        if (receipt !== null) throw new Error('unexpected fragment receipt');
        return;
      }
      const sourceDate = getKstDateKey(event.createdAt);
      if (
        receipt === null
        || receipt.itemId !== STREAK_FRAGMENT_ITEM.id
        || receipt.source !== 'streak'
        || receipt.sourceRef !== event.idempotencyKey
        || receipt.sourceDate !== sourceDate
        || receipt.idempotencyKey !== (
          `streak-fragment:${event.profileId}:${sourceDate}`
        )
        || receipt.quantity !== 1
        || receipt.grantedAt !== event.createdAt
      ) {
        throw new Error('fragment receipt mismatch');
      }
    } catch {
      throw new ProgressionServiceError('PROGRESSION_STORED_SUMMARY_INVALID');
    }
  }

  private applyReward(input: {
    eventId: string;
    eventType: string;
    profile: ProgressionProfile;
    counters: ProgressionCounters;
    affinity: CharacterAffinity;
    balance: ProgressionBalance;
    dojoReward: number;
    affinityReward: number;
    missionCompletions: MissionCompletion[];
    streakChange?: ProgressionRewardSummary['streak'];
    grantedItemIds: string[];
    completedAt: number;
  }): ProgressionRewardSummary {
    const nextDojo = applyDojoXp(
      { level: input.profile.dojoLevel, xpMilli: input.profile.dojoXpMilli },
      input.dojoReward,
      input.balance,
    );
    const nextAffinity = applyAffinityXp(
      { level: input.affinity.level, xpMilli: input.affinity.xpMilli },
      input.affinityReward,
      input.balance,
    );
    const summary: ProgressionRewardSummary = {
      eventId: input.eventId,
      dojoXpMilli: input.dojoReward,
      dojoLevelsGained: levelsBetween(
        input.profile.dojoLevel,
        nextDojo.level,
      ),
      characterId: input.profile.selectedCharacterId,
      affinityMilli: input.affinityReward,
      affinityLevelsGained: levelsBetween(
        input.affinity.level,
        nextAffinity.level,
      ),
      missionCompletions: input.missionCompletions,
      grantedItemIds: input.grantedItemIds,
    };
    if (input.streakChange) summary.streak = input.streakChange;
    const updatedAt = Math.max(input.profile.updatedAt, input.completedAt);

    this.repository.compareAndUpdateProgressionInTransaction({
      profileId: input.profile.profileId,
      expected: {
        balanceVersion: input.profile.balanceVersion,
        dojoLevel: input.profile.dojoLevel,
        dojoXpMilli: input.profile.dojoXpMilli,
        selectedCharacterId: input.profile.selectedCharacterId,
      },
      next: {
        balanceVersion: input.profile.balanceVersion,
        dojoLevel: nextDojo.level,
        dojoXpMilli: nextDojo.xpMilli,
        selectedCharacterId: input.profile.selectedCharacterId,
      },
      updatedAt,
    });
    this.repository.compareAndUpdateCountersInTransaction({
      profileId: input.profile.profileId,
      expected: countersFromProfile(input.profile),
      next: input.counters,
      updatedAt,
    });
    this.repository.compareAndUpdateAffinityInTransaction({
      profileId: input.profile.profileId,
      characterId: input.affinity.characterId,
      expected: {
        level: input.affinity.level,
        xpMilli: input.affinity.xpMilli,
      },
      next: nextAffinity,
    });
    const inserted = this.repository.insertProgressionEvent({
      idempotencyKey: input.eventId,
      profileId: input.profile.profileId,
      eventType: input.eventType,
      balanceVersion: input.profile.balanceVersion,
      summary: { ...summary },
      createdAt: input.completedAt,
    });
    return parseStoredSummary(inserted.event, input.eventId);
  }
}

export function buildCompletedHandEventId(
  profileId: string,
  roomId: string,
  handNumber: number,
): string {
  assertBoundedId(profileId);
  assertBoundedId(roomId);
  if (!Number.isSafeInteger(handNumber) || handNumber < 1) {
    throw new ProgressionServiceError('PROGRESSION_INPUT_INVALID');
  }
  const eventId = `completed-hand:${lengthPrefixed(roomId)}:${handNumber}:` +
    lengthPrefixed(profileId);
  assertEventIdLength(eventId);
  return eventId;
}

export function buildSngFinishEventId(profileId: string, roomId: string): string {
  assertBoundedId(profileId);
  assertBoundedId(roomId);
  const eventId = `sng-finish:${lengthPrefixed(roomId)}:` +
    lengthPrefixed(profileId);
  assertEventIdLength(eventId);
  return eventId;
}

function lengthPrefixed(value: string): string {
  return `${value.length}:${value}`;
}

function validateCompletedHandInput(
  input: CompletedHandInput,
): ValidCompletedHandInput {
  let copy: CompletedHandInput;
  try {
    copy = {
      profileId: input.profileId,
      roomId: input.roomId,
      handNumber: input.handNumber,
      mode: input.mode,
      selectedCharacterId: input.selectedCharacterId,
      completedAt: input.completedAt,
    };
  } catch {
    throw new ProgressionServiceError('PROGRESSION_INPUT_INVALID');
  }
  assertBoundedId(copy.profileId);
  assertBoundedId(copy.roomId);
  if (!Number.isSafeInteger(copy.handNumber) || copy.handNumber < 1) {
    throw new ProgressionServiceError('PROGRESSION_INPUT_INVALID');
  }
  if (copy.mode !== 'cash' && copy.mode !== 'practice') {
    throw new ProgressionServiceError('PROGRESSION_INPUT_INVALID');
  }
  const selectedCharacterId = assertCharacter(copy.selectedCharacterId);
  assertTimestamp(copy.completedAt);
  let kstDate: string;
  try {
    kstDate = getKstDateKey(copy.completedAt);
  } catch {
    throw new ProgressionServiceError('PROGRESSION_INPUT_INVALID');
  }
  return { ...copy, selectedCharacterId, kstDate };
}

function validateSngFinishInput(input: SngFinishInput): ValidSngFinishInput {
  let copy: SngFinishInput;
  try {
    copy = {
      profileId: input.profileId,
      roomId: input.roomId,
      place: input.place,
      selectedCharacterId: input.selectedCharacterId,
      completedAt: input.completedAt,
    };
  } catch {
    throw new ProgressionServiceError('PROGRESSION_INPUT_INVALID');
  }
  assertBoundedId(copy.profileId);
  assertBoundedId(copy.roomId);
  if (!Number.isSafeInteger(copy.place) || copy.place < 1 || copy.place > 6) {
    throw new ProgressionServiceError('PROGRESSION_INPUT_INVALID');
  }
  const selectedCharacterId = assertCharacter(copy.selectedCharacterId);
  assertTimestamp(copy.completedAt);
  let kstDate: string;
  try {
    kstDate = getKstDateKey(copy.completedAt);
  } catch {
    throw new ProgressionServiceError('PROGRESSION_INPUT_INVALID');
  }
  return { ...copy, selectedCharacterId, kstDate };
}

function assertBoundedId(value: string): void {
  if (
    typeof value !== 'string'
    || !INTERNAL_ID_PATTERN.test(value)
    || value.length > MAX_EVENT_ID_COMPONENT_LENGTH
  ) {
    throw new ProgressionServiceError('PROGRESSION_INPUT_INVALID');
  }
}

function assertEventIdLength(value: string): void {
  if (value.length > MAX_EVENT_ID_LENGTH) {
    throw new ProgressionServiceError('PROGRESSION_INPUT_INVALID');
  }
}

function assertCharacter(value: string): PlayableCharacterId {
  if (
    typeof value !== 'string'
    || !(PLAYABLE_CHARACTER_IDS as readonly string[]).includes(value)
  ) {
    throw new ProgressionServiceError('PROGRESSION_INPUT_INVALID');
  }
  return value as PlayableCharacterId;
}

function assertTimestamp(value: number): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new ProgressionServiceError('PROGRESSION_INPUT_INVALID');
  }
  const date = new Date(value);
  if (
    !Number.isFinite(date.getTime())
    || date.getUTCFullYear() < 1
    || date.getUTCFullYear() > 9_999
  ) {
    throw new ProgressionServiceError('PROGRESSION_INPUT_INVALID');
  }
}

function assertAuthoritativeCharacter(
  authoritative: PlayableCharacterId,
  requested: PlayableCharacterId,
): void {
  if (authoritative !== requested) {
    throw new ProgressionServiceError('PROGRESSION_CHARACTER_STALE');
  }
}

function getSelectedAffinity(
  affinities: readonly CharacterAffinity[],
  characterId: PlayableCharacterId,
): CharacterAffinity {
  const affinity = affinities.find(value => value.characterId === characterId);
  if (!affinity) {
    throw new ProgressionPersistenceError('PROGRESSION_PERSISTENCE_INVALID');
  }
  return affinity;
}

function safeIncrement(value: number): number {
  if (!Number.isSafeInteger(value) || value < 0 || value === Number.MAX_SAFE_INTEGER) {
    throw new ProgressionServiceError('PROGRESSION_COUNTER_OVERFLOW');
  }
  return value + 1;
}

function addMissionRewards(
  baseReward: number,
  completions: readonly MissionCompletion[],
): number {
  let total = BigInt(baseReward);
  for (const completion of completions) {
    total += BigInt(completion.dojoXpMilli);
  }
  if (total > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new ProgressionServiceError('PROGRESSION_COUNTER_OVERFLOW');
  }
  return Number(total);
}

function throwMissionServiceError(error: unknown): never {
  if (error instanceof ProgressionServiceError) throw error;
  if (error instanceof ProgressionPersistenceError) {
    if (
      error.code === 'PROGRESSION_PROFILE_NOT_FOUND'
      || error.code === 'PROGRESSION_MISSION_NOT_FOUND'
      || error.code === 'PROGRESSION_MISSION_COMPLETED'
      || error.code === 'PROGRESSION_MISSION_REROLL_USED'
    ) {
      throw new ProgressionServiceError(error.code);
    }
  }
  throw error;
}

function countersFromProfile(profile: ProgressionProfile): ProgressionCounters {
  return {
    practiceDate: profile.practiceDate,
    practiceHands: profile.practiceHands,
    completedHands: profile.completedHands,
    cashHands: profile.cashHands,
    practiceHandsTotal: profile.practiceHandsTotal,
    sngCompletions: profile.sngCompletions,
    bestStreak: profile.bestStreak,
  };
}

function mutableStreakWithTimestamp(streak: StreakState) {
  return {
    currentStreak: streak.currentStreak,
    restPasses: streak.restPasses,
    lastQualifiedDate: streak.lastQualifiedDate,
    lastWeekKey: streak.lastWeekKey,
    updatedAt: streak.updatedAt,
  };
}

function levelsBetween(previous: number, next: number): number[] {
  return Array.from(
    { length: next - previous },
    (_, index) => previous + index + 1,
  );
}

function parseStoredSummary(
  event: ProgressionEvent,
  expectedEventId: string,
): ProgressionRewardSummary {
  try {
    const value = event.summary;
    if (
      !hasExactSummaryKeys(value)
      || value.eventId !== expectedEventId
      || !isNonnegativeSafeInteger(value.dojoXpMilli)
      || !isConsecutiveLevelArray(value.dojoLevelsGained, 50)
      || typeof value.characterId !== 'string'
      || !(PLAYABLE_CHARACTER_IDS as readonly string[])
        .includes(value.characterId)
      || !isNonnegativeSafeInteger(value.affinityMilli)
      || !isConsecutiveLevelArray(value.affinityLevelsGained, 20)
      || !isMissionCompletionArray(
        value.missionCompletions,
        event.balanceVersion,
      )
      || !isUniqueCatalogItemIdArray(value.grantedItemIds)
      || (hasOwn(value, 'streak') && !isStreakChange(value.streak))
    ) {
      throw new Error('invalid summary');
    }
    const missionRewardTotal = sumMissionCompletionRewards(
      value.missionCompletions,
    );
    if (
      missionRewardTotal === null
      || value.dojoXpMilli < missionRewardTotal
    ) {
      throw new Error('invalid summary');
    }
    return value as unknown as ProgressionRewardSummary;
  } catch {
    throw new ProgressionServiceError('PROGRESSION_STORED_SUMMARY_INVALID');
  }
}

function isNonnegativeSafeInteger(value: unknown): value is number {
  return typeof value === 'number'
    && Number.isSafeInteger(value)
    && value >= 0;
}

function isConsecutiveLevelArray(
  value: unknown,
  maxLevel: number,
): value is number[] {
  return Array.isArray(value) && value.every((level, index) => (
    Number.isSafeInteger(level)
    && level >= 2
    && level <= maxLevel
    && (index === 0 || level === value[index - 1] + 1)
  ));
}

function hasExactSummaryKeys(value: unknown): value is Record<string, unknown> {
  if (!isPlainObject(value)) return false;
  const keys = getOwnStringKeys(value);
  if (!keys) return false;
  const hasStreak = hasOwn(value, 'streak');
  if (keys.length !== REQUIRED_SUMMARY_KEYS.length + (hasStreak ? 1 : 0)) {
    return false;
  }
  return REQUIRED_SUMMARY_KEYS.every(key => hasOwn(value, key))
    && keys.every(key => (
      (REQUIRED_SUMMARY_KEYS as readonly string[]).includes(key)
      || key === 'streak'
    ));
}

function isMissionCompletionArray(
  value: unknown,
  balanceVersion: number,
): value is MissionCompletion[] {
  if (!Array.isArray(value)) return false;
  let expectedReward: number;
  try {
    expectedReward = getBalance(balanceVersion).dojoXpPerMission;
  } catch {
    return false;
  }
  const missionIds = new Set<string>();
  const slots = new Set<number>();
  return value.every(item => {
    if (!hasExactKeys(item, ['missionId', 'slot', 'dojoXpMilli'])) {
      return false;
    }
    const { missionId, slot, dojoXpMilli } = item;
    const definition = typeof missionId === 'string'
      ? getMissionDefinition(missionId)
      : null;
    if (
      !definition
      || missionIds.has(definition.id)
      || typeof slot !== 'number'
      || !Number.isSafeInteger(slot)
      || slot < 0
      || slot > 2
      || slots.has(slot)
      || dojoXpMilli !== expectedReward
    ) {
      return false;
    }
    missionIds.add(definition.id);
    slots.add(slot);
    return true;
  });
}

function sumMissionCompletionRewards(
  completions: readonly MissionCompletion[],
): number | null {
  let total = BigInt(0);
  for (const completion of completions) {
    total += BigInt(completion.dojoXpMilli);
  }
  if (total > BigInt(Number.MAX_SAFE_INTEGER)) return null;
  return Number(total);
}

function isStreakChange(value: unknown): boolean {
  if (!hasExactKeys(value, [
    'previousStreak',
    'currentStreak',
    'restPassUsed',
  ])) {
    return false;
  }
  if (
    !isNonnegativeSafeInteger(value.previousStreak)
    || !isNonnegativeSafeInteger(value.currentStreak)
    || value.currentStreak < 1
    || typeof value.restPassUsed !== 'boolean'
    || (
      value.currentStreak !== 1
      && value.currentStreak !== value.previousStreak + 1
    )
    || (
      value.restPassUsed
      && (
        value.previousStreak === 0
        || value.currentStreak !== value.previousStreak + 1
      )
    )
  ) {
    return false;
  }
  return true;
}

function isUniqueCatalogItemIdArray(value: unknown): value is string[] {
  if (!Array.isArray(value)) return false;
  const seen = new Set<string>();
  return value.every(item => {
    if (
      typeof item !== 'string'
      || !CATALOG_ITEM_ID_PATTERN.test(item)
      || seen.has(item)
    ) {
      return false;
    }
    seen.add(item);
    return true;
  });
}

function hasExactKeys(
  value: unknown,
  expected: readonly string[],
): value is Record<string, unknown> {
  if (!isPlainObject(value)) return false;
  const keys = getOwnStringKeys(value);
  if (!keys) return false;
  return keys.length === expected.length
    && expected.every(key => hasOwn(value, key));
}

function getOwnStringKeys(value: object): string[] | null {
  const keys = Reflect.ownKeys(value);
  return keys.every((key): key is string => typeof key === 'string')
    ? keys
    : null;
}

function hasOwn(value: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}
