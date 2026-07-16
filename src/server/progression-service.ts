import {
  applyAffinityXp,
  applyDojoXp,
  getBalance,
  scaleReward,
  type ProgressionBalance,
} from '@/lib/progression/balance';
import {
  selectRerollMission,
} from '@/lib/progression/missions';
import {
  advanceStreakDay,
  reconcileWeeklyRestPass,
} from '@/lib/progression/streak';
import {
  STREAK_FRAGMENT_ITEM,
  getAffinityRewardItems,
  getCollectionItemDefinition,
  getDojoRewardItems,
} from '@/lib/collection/catalog';
import { parseProgressionRewardSummary } from '@/lib/progression/reward-summary';
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
  type EquipmentSlot,
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

export type ProgressionServiceErrorCode =
  | 'PROGRESSION_INPUT_INVALID'
  | 'PROGRESSION_CHARACTER_STALE'
  | 'PROGRESSION_COUNTER_OVERFLOW'
  | 'PROGRESSION_STORED_SUMMARY_INVALID'
  | 'PROGRESSION_PROFILE_NOT_FOUND'
  | 'PROGRESSION_MISSION_NOT_FOUND'
  | 'PROGRESSION_MISSION_COMPLETED'
  | 'PROGRESSION_MISSION_REROLL_USED'
  | 'PROGRESSION_ITEM_NOT_OWNED'
  | 'PROGRESSION_EQUIPMENT_SLOT_INVALID'
  | 'PROGRESSION_SKIN_CHARACTER_MISMATCH';

export class ProgressionServiceError extends Error {
  constructor(readonly code: ProgressionServiceErrorCode) {
    super(code);
    this.name = 'ProgressionServiceError';
  }
}

export interface CompletedHandInput {
  profileId: string;
  roomId: string;
  roomRunId?: string;
  handNumber: number;
  mode: 'cash' | 'practice';
  selectedCharacterId: string;
  completedAt: number;
}

export interface SngFinishInput {
  profileId: string;
  roomId: string;
  roomRunId?: string;
  place: number;
  selectedCharacterId: string;
  completedAt: number;
}

export interface ProgressionView {
  progression: ProgressionSnapshot;
  missions: DailyMissionDaySnapshot;
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

  /**
   * Trusted game-runtime lookup. The profile avatar is only an initialization
   * fallback; an existing progression selection remains authoritative.
   */
  getRuntimeSnapshot(
    profileId: string,
    fallbackCharacterId: string,
    at = Date.now(),
  ): ProgressionSnapshot {
    assertBoundedId(profileId);
    const fallback = assertCharacter(fallbackCharacterId);
    assertTimestamp(at);
    return this.database.transaction(() => {
      let snapshot: ProgressionSnapshot;
      try {
        snapshot = this.repository.getSnapshotInTransaction(profileId);
      } catch (error) {
        if (
          !(error instanceof ProgressionPersistenceError)
          || error.code !== 'PROGRESSION_PROFILE_NOT_FOUND'
        ) {
          throw error;
        }
        snapshot = this.repository.getOrCreateInTransaction(
          profileId,
          fallback,
          at,
        );
      }
      return this.reconcileWeeklyRestPass(snapshot, at);
    });
  }

  getView(
    profileId: string,
    selectedCharacterId: string,
    at = Date.now(),
  ): ProgressionView {
    assertBoundedId(profileId);
    const characterId = assertCharacter(selectedCharacterId);
    assertTimestamp(at);
    return this.database.transaction(() => {
      let snapshot = this.repository.getOrCreateInTransaction(
        profileId,
        characterId,
        at,
      );
      snapshot = this.reconcileWeeklyRestPass(snapshot, at);
      const missionDate = getKstDateKey(at);
      const missions = this.repository.ensureDailyMissionsInTransaction(
        profileId,
        missionDate,
        snapshot.profile.balanceVersion,
        at,
      );
      return { progression: snapshot, missions };
    });
  }

  selectCharacter(
    profileId: string,
    characterId: string,
    updatedAt = Date.now(),
  ): ProgressionSnapshot {
    assertBoundedId(profileId);
    const selectedCharacterId = assertCharacter(characterId);
    assertTimestamp(updatedAt);
    return this.database.transaction(() => {
      const snapshot = this.repository.getOrCreateInTransaction(
        profileId,
        selectedCharacterId,
        updatedAt,
      );
      const equippedSkinId = snapshot.equipment.skin;
      if (equippedSkinId !== null) {
        const equippedSkin = getCollectionItemDefinition(equippedSkinId);
        if (!equippedSkin || equippedSkin.kind !== 'skin') {
          throw new ProgressionPersistenceError(
            'PROGRESSION_PERSISTENCE_INVALID',
          );
        }
        if (equippedSkin.characterId !== selectedCharacterId) {
          this.repository.compareAndUpdateEquipmentInTransaction({
            profileId,
            slot: 'skin',
            expectedItemId: equippedSkinId,
            nextItemId: null,
            updatedAt,
          });
        }
      }
      if (snapshot.profile.selectedCharacterId !== selectedCharacterId) {
        this.repository.compareAndUpdateProgressionInTransaction({
          profileId,
          expected: {
            balanceVersion: snapshot.profile.balanceVersion,
            dojoLevel: snapshot.profile.dojoLevel,
            dojoXpMilli: snapshot.profile.dojoXpMilli,
            selectedCharacterId: snapshot.profile.selectedCharacterId,
          },
          next: {
            balanceVersion: snapshot.profile.balanceVersion,
            dojoLevel: snapshot.profile.dojoLevel,
            dojoXpMilli: snapshot.profile.dojoXpMilli,
            selectedCharacterId,
          },
          updatedAt: Math.max(snapshot.profile.updatedAt, updatedAt),
        });
      }
      return this.repository.getSnapshotInTransaction(profileId);
    });
  }

  setEquipment(
    profileId: string,
    slot: string,
    itemId: string | null,
    updatedAt = Date.now(),
  ): ProgressionSnapshot {
    assertBoundedId(profileId);
    const safeSlot = assertEquipmentSlot(slot);
    if (itemId !== null && typeof itemId !== 'string') {
      throw new ProgressionServiceError('PROGRESSION_INPUT_INVALID');
    }
    assertTimestamp(updatedAt);
    return this.database.transaction(() => {
      const snapshot = this.repository.getSnapshotInTransaction(profileId);
      if (itemId !== null) {
        const definition = getCollectionItemDefinition(itemId);
        if (!definition || definition.equipSlot !== safeSlot) {
          throw new ProgressionServiceError('PROGRESSION_EQUIPMENT_SLOT_INVALID');
        }
        if (!snapshot.inventory.some(item => item.itemId === itemId)) {
          throw new ProgressionServiceError('PROGRESSION_ITEM_NOT_OWNED');
        }
        if (
          definition.kind === 'skin'
          && definition.characterId !== snapshot.profile.selectedCharacterId
        ) {
          throw new ProgressionServiceError(
            'PROGRESSION_SKIN_CHARACTER_MISMATCH',
          );
        }
      }
      this.repository.compareAndUpdateEquipmentInTransaction({
        profileId,
        slot: safeSlot,
        expectedItemId: snapshot.equipment[safeSlot],
        nextItemId: itemId,
        updatedAt,
      });
      return this.repository.getSnapshotInTransaction(profileId);
    });
  }

  recordCompletedHand(input: CompletedHandInput): ProgressionRewardSummary {
    return this.recordCompletedHandInternal(input, true);
  }

  recordRuntimeCompletedHand(input: CompletedHandInput): ProgressionRewardSummary {
    return this.recordCompletedHandInternal(input, false);
  }

  private recordCompletedHandInternal(
    input: CompletedHandInput,
    requireCurrentCharacter: boolean,
  ): ProgressionRewardSummary {
    const safeInput = validateCompletedHandInput(input);
    const eventId = buildCompletedHandEventId(
      safeInput.profileId,
      safeInput.roomId,
      safeInput.handNumber,
      safeInput.roomRunId,
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
      if (requireCurrentCharacter) {
        assertAuthoritativeCharacter(
          snapshot.profile.selectedCharacterId,
          safeInput.selectedCharacterId,
        );
      }
      snapshot = this.reconcileWeeklyRestPass(snapshot, safeInput.completedAt);
      const balance = getBalance(snapshot.profile.balanceVersion);
      const affinity = getSelectedAffinity(
        snapshot.affinities,
        safeInput.selectedCharacterId,
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
    return this.recordSngFinishInternal(input, true);
  }

  recordRuntimeSngFinish(input: SngFinishInput): ProgressionRewardSummary {
    return this.recordSngFinishInternal(input, false);
  }

  private recordSngFinishInternal(
    input: SngFinishInput,
    requireCurrentCharacter: boolean,
  ): ProgressionRewardSummary {
    const safeInput = validateSngFinishInput(input);
    const eventId = buildSngFinishEventId(
      safeInput.profileId,
      safeInput.roomId,
      safeInput.roomRunId,
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
      if (requireCurrentCharacter) {
        assertAuthoritativeCharacter(
          snapshot.profile.selectedCharacterId,
          safeInput.selectedCharacterId,
        );
      }
      snapshot = this.reconcileWeeklyRestPass(snapshot, safeInput.completedAt);
      const balance = getBalance(snapshot.profile.balanceVersion);
      const affinity = getSelectedAffinity(
        snapshot.affinities,
        safeInput.selectedCharacterId,
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
        const day = this.repository.ensureDailyMissionsInTransaction(
          profileId,
          kstDate,
          snapshot.profile.balanceVersion,
          requestedAt,
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
      const grantId = `streak-fragment:${snapshot.profile.profileId}:${kstDate}`;
      const granted = this.repository.grantStackableInventoryItemInTransaction({
        idempotencyKey: grantId,
        profileId: snapshot.profile.profileId,
        itemId: STREAK_FRAGMENT_ITEM.id,
        balanceVersion: snapshot.profile.balanceVersion,
        grantedAt: completedAt,
        source: 'streak',
        sourceRef: grantId,
        sourceEventId: eventId,
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
    this.validateStoredPermanentClaims(duplicate.event, summary);
    return summary;
  }

  private validateStoredPermanentClaims(
    event: ProgressionEvent,
    summary: ProgressionRewardSummary,
  ): void {
    try {
      const claimed = summary.grantedItemIds
        .filter(itemId => itemId !== STREAK_FRAGMENT_ITEM.id)
        .sort();
      if (claimed.some(itemId => {
        const definition = getCollectionItemDefinition(itemId);
        return !definition || definition.source.kind === 'streak';
      })) {
        throw new Error('unknown permanent reward claim');
      }
      const receipts = this.repository
        .getPermanentGrantItemIdsForEventInTransaction(
          event.profileId,
          event.idempotencyKey,
        )
        .sort();
      if (
        claimed.length !== receipts.length
        || claimed.some((itemId, index) => itemId !== receipts[index])
      ) {
        throw new Error('permanent reward receipt mismatch');
      }
    } catch {
      throw new ProgressionServiceError('PROGRESSION_STORED_SUMMARY_INVALID');
    }
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
      const receipt = this.repository.getFragmentGrantForEventInTransaction(
        event.profileId,
        event.idempotencyKey,
      );
      if (!fragmentDue) {
        if (receipt !== null) throw new Error('unexpected fragment receipt');
        return;
      }
      const sourceDate = getKstDateKey(event.createdAt);
      const sourceRef = `streak-fragment:${event.profileId}:${sourceDate}`;
      if (
        receipt === null
        || receipt.itemId !== STREAK_FRAGMENT_ITEM.id
        || receipt.source !== 'streak'
        || receipt.sourceRef !== sourceRef
        || receipt.sourceEventId !== event.idempotencyKey
        || receipt.sourceDate !== sourceDate
        || receipt.idempotencyKey !== sourceRef
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
    const grantedItemIds = [...input.grantedItemIds];
    const permanentRewards = [
      ...getDojoRewardItems(input.profile.dojoLevel, nextDojo.level),
      ...getAffinityRewardItems(
        input.affinity.characterId,
        input.affinity.level,
        nextAffinity.level,
      ),
    ];
    const summary: ProgressionRewardSummary = {
      eventId: input.eventId,
      dojoXpMilli: input.dojoReward,
      dojoLevelsGained: levelsBetween(
        input.profile.dojoLevel,
        nextDojo.level,
      ),
      characterId: input.affinity.characterId,
      affinityMilli: input.affinityReward,
      affinityLevelsGained: levelsBetween(
        input.affinity.level,
        nextAffinity.level,
      ),
      missionCompletions: input.missionCompletions,
      grantedItemIds,
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
    for (const reward of permanentRewards) {
      const granted = this.repository.grantPermanentInventoryItemInTransaction({
        profileId: input.profile.profileId,
        itemId: reward.id,
        sourceEventId: input.eventId,
        source: reward.source,
        grantedAt: input.completedAt,
      });
      if (granted) grantedItemIds.push(reward.id);
    }
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
  roomRunId?: string,
): string {
  assertBoundedId(profileId);
  assertBoundedId(roomId);
  if (roomRunId !== undefined) assertBoundedId(roomRunId);
  if (!Number.isSafeInteger(handNumber) || handNumber < 1) {
    throw new ProgressionServiceError('PROGRESSION_INPUT_INVALID');
  }
  const eventId = roomRunId === undefined
    ? `completed-hand:${lengthPrefixed(roomId)}:${handNumber}:` +
      lengthPrefixed(profileId)
    : `completed-hand:${lengthPrefixed(roomId)}:run:${lengthPrefixed(roomRunId)}` +
      `:hand:${handNumber}:${lengthPrefixed(profileId)}`;
  assertEventIdLength(eventId);
  return eventId;
}

export function buildSngFinishEventId(
  profileId: string,
  roomId: string,
  roomRunId?: string,
): string {
  assertBoundedId(profileId);
  assertBoundedId(roomId);
  if (roomRunId !== undefined) assertBoundedId(roomRunId);
  const eventId = roomRunId === undefined
    ? `sng-finish:${lengthPrefixed(roomId)}:${lengthPrefixed(profileId)}`
    : `sng-finish:${lengthPrefixed(roomId)}:run:${lengthPrefixed(roomRunId)}` +
      `:tournament:${lengthPrefixed(profileId)}`;
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
      roomRunId: input.roomRunId,
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
  if (copy.roomRunId !== undefined) assertBoundedId(copy.roomRunId);
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
      roomRunId: input.roomRunId,
      place: input.place,
      selectedCharacterId: input.selectedCharacterId,
      completedAt: input.completedAt,
    };
  } catch {
    throw new ProgressionServiceError('PROGRESSION_INPUT_INVALID');
  }
  assertBoundedId(copy.profileId);
  assertBoundedId(copy.roomId);
  if (copy.roomRunId !== undefined) assertBoundedId(copy.roomRunId);
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

function assertEquipmentSlot(value: string): EquipmentSlot {
  if (!['title', 'frame', 'skin', 'cutin'].includes(value)) {
    throw new ProgressionServiceError('PROGRESSION_INPUT_INVALID');
  }
  return value as EquipmentSlot;
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
  const summary = parseProgressionRewardSummary(
    event.summary,
    expectedEventId,
    event.balanceVersion,
  );
  if (!summary) {
    throw new ProgressionServiceError('PROGRESSION_STORED_SUMMARY_INVALID');
  }
  return summary;
}
