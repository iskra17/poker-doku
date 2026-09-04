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
  ProgressionCosmeticSlot,
  ProgressionRewardSummary,
} from '@/lib/progression/types';
import { getStoryRewardDefinition } from '@/lib/story/rewards/catalog';
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
const EVENT_TYPE_STORY_CHAPTER = 'story-chapter';
const EVENT_TYPE_STORY_DAILY_DRILLS = 'story-daily-drills';
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

/**
 * 수련 스토리 보상 상한 — 보상액은 언제나 서버가 챕터 데이터에서 산출하지만,
 * 데이터 오타 하나가 진행도 곡선을 부수지 않도록 서비스에서 한 번 더 클램프한다.
 * (음수·비정수는 클램프가 아니라 거절 — 잘못 계산된 값은 조용히 넘기지 않는다)
 */
export const STORY_CHAPTER_MAX_DOJO_XP_MILLI = 5_000_000;
/** 챕터 1회 · 히로인 1명 인연 XP 상한 (A8 기준 챕터당 담당 +100 = 100_000밀리) */
export const STORY_CHAPTER_MAX_AFFINITY_MILLI = 500_000;
/** 오늘의 수련 문제 3개 완료 → 출제 히로인 인연 +5/일 (A8) */
export const STORY_DAILY_AFFINITY_MILLI = 5_000;
const STORY_MAX_AFFINITY_TARGETS = 64;
const STORY_GRADES = ['S', 'A', 'B'] as const;
/**
 * 스토리 보상이 진행도 프로필을 처음 만드는 극단 케이스의 시드.
 * 스토리는 파트너를 고르지 않는다 — 담당 히로인 인연은 비파트너 행으로 들어가고,
 * 이 시드는 `selected_character_id`가 비어 있을 수 없는 스키마를 채우기만 한다.
 */
const STORY_SEED_CHARACTER: PlayableCharacterId = 'sakura';

export type StoryChapterGrade = typeof STORY_GRADES[number];

/** 히로인별 인연 지급액. characterId는 `StoryHeroineId`와 같은 6인 유니온. */
export interface StoryAffinityGrant {
  characterId: PlayableCharacterId;
  milli: number;
}

export interface StoryChapterCompleteInput {
  profileId: string;
  /** 'act1-ch01' */
  chapterId: string;
  runId: string;
  /** true면 first 키(첫 완주 보상), false면 run 키(재도전 — 도장 XP replay만) */
  firstClear: boolean;
  grade: StoryChapterGrade;
  /** 챕터 데이터에서 산출한 도장 XP(등급 가산 포함). 0..STORY_CHAPTER_MAX_DOJO_XP_MILLI로 클램프 */
  dojoXpMilli: number;
  /** 히로인별 인연. 중복 characterId는 합산 후 캐릭터당 상한으로 클램프 */
  affinity: readonly StoryAffinityGrant[];
  completedAt: number;
}

export interface StoryDailyDrillsInput {
  profileId: string;
  /** KST 날짜 'YYYY-MM-DD' — completedAt의 KST 날짜와 일치해야 한다 */
  kstDate: string;
  teacherId: PlayableCharacterId;
  completedAt: number;
}

/** 히로인 인연 전후 레벨 — 코디네이터가 `findNewlyUnlockedScenes`로 새 인연 씬을 산출한다 */
export interface StoryAffinityTransition {
  characterId: PlayableCharacterId;
  previousLevel: number;
  nextLevel: number;
}

export interface StoryRewardResult {
  duplicate: boolean;
  snapshot: ProgressionSnapshot;
  summary: ProgressionRewardSummary;
  /**
   * 반환 객체에만 실린다 — `summary_json`(`ProgressionRewardSummary`)은 v13 뷰·파서가 키를 고정하므로
   * 여러 히로인의 전후 레벨을 거기 넣지 않는다. 중복 지급이면 빈 배열.
   */
  affinityTransitions: StoryAffinityTransition[];
}

export type StoryChapterCompleteResult = StoryRewardResult;
export type StoryDailyDrillsResult = StoryRewardResult;

interface ValidStoryChapterCompleteInput {
  profileId: string;
  chapterId: string;
  runId: string;
  firstClear: boolean;
  grade: StoryChapterGrade;
  dojoXpMilli: number;
  /** 최초 등장 순서로 중복 합산·클램프까지 끝난 목록 */
  affinity: StoryAffinityGrant[];
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
    const fallback = coerceSeedCharacter(fallbackCharacterId);
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
    const characterId = coerceSeedCharacter(selectedCharacterId);
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

  /**
   * 장착 — 기존 4슬롯(title/frame/skin/cutin)은 collection 카탈로그·`profile_equipment`,
   * 스토리 코스메틱은 slot 'card-back' | 'felt' | 'outfit:<heroine>'로 `setCosmetic`/`setCharacterOutfit`에
   * 라우팅한다(`POST /api/progression/equipment`의 slot 값이 그대로 들어온다).
   */
  setEquipment(
    profileId: string,
    slot: string,
    itemId: string | null,
    updatedAt = Date.now(),
  ): ProgressionSnapshot {
    if (typeof slot !== 'string') {
      throw new ProgressionServiceError('PROGRESSION_INPUT_INVALID');
    }
    if (slot === 'card-back' || slot === 'felt') {
      return this.setCosmetic(profileId, slot, itemId, updatedAt);
    }
    if (slot.startsWith('outfit:')) {
      return this.setCharacterOutfit(profileId, slot.slice('outfit:'.length), itemId, updatedAt);
    }
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
        // 컬렉션에 없으면 스토리 보상 카탈로그 폴백 — 칭호(equipSlot 'title')만 이 4슬롯에 든다
        // (card-back/felt/outfit은 슬롯이 달라 자연 거절, DB 트리거도 같은 조건).
        const storyDefinition = definition ? undefined : getStoryRewardDefinition(itemId);
        const equipSlot = definition?.equipSlot ?? storyDefinition?.equipSlot ?? null;
        if (equipSlot !== safeSlot) {
          throw new ProgressionServiceError('PROGRESSION_EQUIPMENT_SLOT_INVALID');
        }
        if (!snapshot.inventory.some(item => item.itemId === itemId)) {
          throw new ProgressionServiceError('PROGRESSION_ITEM_NOT_OWNED');
        }
        if (
          definition?.kind === 'skin'
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

  /**
   * 스토리 코스메틱(card-back/felt) 장착 — 아이템은 스토리 보상 카탈로그의 같은 equip_slot이어야 하고
   * 인벤토리에 있어야 한다(영수증 sync). null = 해제. 실전 수치 영향 없음.
   */
  setCosmetic(
    profileId: string,
    slot: ProgressionCosmeticSlot,
    itemId: string | null,
    updatedAt = Date.now(),
  ): ProgressionSnapshot {
    assertBoundedId(profileId);
    if (slot !== 'card-back' && slot !== 'felt') {
      throw new ProgressionServiceError('PROGRESSION_INPUT_INVALID');
    }
    if (itemId !== null && typeof itemId !== 'string') {
      throw new ProgressionServiceError('PROGRESSION_INPUT_INVALID');
    }
    assertTimestamp(updatedAt);
    return this.database.transaction(() => {
      const snapshot = this.repository.getSnapshotInTransaction(profileId);
      if (itemId !== null) {
        const definition = getStoryRewardDefinition(itemId);
        if (!definition || definition.equipSlot !== slot) {
          throw new ProgressionServiceError('PROGRESSION_EQUIPMENT_SLOT_INVALID');
        }
        if (!snapshot.inventory.some(item => item.itemId === itemId)) {
          throw new ProgressionServiceError('PROGRESSION_ITEM_NOT_OWNED');
        }
      }
      this.repository.setCosmeticInTransaction({ profileId, slot, itemId, updatedAt });
      return this.repository.getSnapshotInTransaction(profileId);
    });
  }

  /** 히로인 의상 장착 — kind 'outfit' + 담당 히로인 일치 + 소유. null = 기본 의상. 파트너 선택과 무관. */
  setCharacterOutfit(
    profileId: string,
    characterId: string,
    itemId: string | null,
    updatedAt = Date.now(),
  ): ProgressionSnapshot {
    assertBoundedId(profileId);
    const heroine = assertCharacter(characterId);
    if (itemId !== null && typeof itemId !== 'string') {
      throw new ProgressionServiceError('PROGRESSION_INPUT_INVALID');
    }
    assertTimestamp(updatedAt);
    return this.database.transaction(() => {
      const snapshot = this.repository.getSnapshotInTransaction(profileId);
      if (itemId !== null) {
        const definition = getStoryRewardDefinition(itemId);
        if (!definition || definition.kind !== 'outfit' || definition.equipSlot !== 'outfit') {
          throw new ProgressionServiceError('PROGRESSION_EQUIPMENT_SLOT_INVALID');
        }
        if (definition.characterId !== heroine) {
          throw new ProgressionServiceError('PROGRESSION_SKIN_CHARACTER_MISMATCH');
        }
        if (!snapshot.inventory.some(item => item.itemId === itemId)) {
          throw new ProgressionServiceError('PROGRESSION_ITEM_NOT_OWNED');
        }
      }
      this.repository.setCharacterOutfitInTransaction({
        profileId,
        characterId: heroine,
        itemId,
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

  /**
   * 수련 스토리 챕터 결산 보상. 보상액은 호출자(런 코디네이터)가 **챕터 데이터**에서
   * 산출해 넘긴다(클라 미신뢰) — 서비스는 상한 클램프와 멱등만 책임진다.
   *
   * 멱등 키: 첫 완주는 `story-chapter:<len:chapterId>:first:<len:profileId>`,
   * 재도전은 `story-chapter:<len:chapterId>:run:<len:runId>:<len:profileId>`.
   * 재도전 키는 런마다 새 키라 도장 XP replay는 반복 적립되고, 인연은 호출자가
   * 빈 목록을 보내 챕터당 1회로 묶는다(A8).
   *
   * 담당 히로인이 선택 파트너가 아니어도 인연을 준다 — `ensureAffinityInTransaction`이
   * 비파트너 행을 만들고 `selected_character_id`는 절대 바뀌지 않는다.
   */
  recordStoryChapterComplete(
    input: StoryChapterCompleteInput,
  ): StoryChapterCompleteResult {
    const safeInput = validateStoryChapterCompleteInput(input);
    const eventId = buildStoryChapterEventId(
      safeInput.profileId,
      safeInput.chapterId,
      safeInput.firstClear ? undefined : safeInput.runId,
    );
    return this.recordStoryReward({
      eventId,
      eventType: EVENT_TYPE_STORY_CHAPTER,
      profileId: safeInput.profileId,
      dojoXpMilli: safeInput.dojoXpMilli,
      affinity: safeInput.affinity,
      completedAt: safeInput.completedAt,
    });
  }

  /** 게임 런타임(스토리 코디네이터) 진입점 — 선택 파트너 권위 검사가 없는 것 외엔 동일. */
  recordRuntimeStoryChapterComplete(
    input: StoryChapterCompleteInput,
  ): StoryChapterCompleteResult {
    return this.recordStoryChapterComplete(input);
  }

  /** 오늘의 수련 문제 3개 완료 — 출제 히로인 인연 +5/일, 도장 XP 없음. 하루 1회 멱등. */
  recordStoryDailyDrills(
    input: StoryDailyDrillsInput,
  ): StoryDailyDrillsResult {
    const safeInput = validateStoryDailyDrillsInput(input);
    return this.recordStoryReward({
      eventId: buildStoryDailyDrillsEventId(
        safeInput.profileId,
        safeInput.kstDate,
      ),
      eventType: EVENT_TYPE_STORY_DAILY_DRILLS,
      profileId: safeInput.profileId,
      dojoXpMilli: 0,
      affinity: [{
        characterId: safeInput.teacherId,
        milli: STORY_DAILY_AFFINITY_MILLI,
      }],
      completedAt: safeInput.completedAt,
    });
  }

  recordRuntimeStoryDailyDrills(
    input: StoryDailyDrillsInput,
  ): StoryDailyDrillsResult {
    return this.recordStoryDailyDrills(input);
  }

  private recordStoryReward(input: {
    eventId: string;
    eventType: string;
    profileId: string;
    dojoXpMilli: number;
    affinity: readonly StoryAffinityGrant[];
    completedAt: number;
  }): StoryRewardResult {
    return this.database.transaction(() => {
      const duplicate = this.getDuplicate(
        input.eventId,
        input.profileId,
        input.eventType,
        input.completedAt,
      );
      if (duplicate) {
        return {
          duplicate: true,
          snapshot: this.repository.getSnapshotInTransaction(input.profileId),
          summary: duplicate,
          affinityTransitions: [],
        };
      }

      let snapshot = this.loadOrSeedStorySnapshot(
        input.profileId,
        input.completedAt,
      );
      snapshot = this.reconcileWeeklyRestPass(snapshot, input.completedAt);
      const { summary, affinityTransitions } = this.applyStoryReward({
        eventId: input.eventId,
        eventType: input.eventType,
        profile: snapshot.profile,
        balance: getBalance(snapshot.profile.balanceVersion),
        dojoRewardMilli: input.dojoXpMilli,
        affinity: input.affinity,
        completedAt: input.completedAt,
      });
      return {
        duplicate: false,
        snapshot: this.repository.getSnapshotInTransaction(input.profileId),
        summary,
        affinityTransitions,
      };
    });
  }

  /**
   * 스토리는 파트너를 고르는 경로가 아니므로 기존 진행도가 있으면 그대로 쓰고,
   * 진행도 행이 아직 없을 때만 시드로 만든다(`getRuntimeSnapshot`과 같은 폴백 규약).
   */
  private loadOrSeedStorySnapshot(
    profileId: string,
    at: number,
  ): ProgressionSnapshot {
    try {
      return this.repository.getSnapshotInTransaction(profileId);
    } catch (error) {
      if (
        !(error instanceof ProgressionPersistenceError)
        || error.code !== 'PROGRESSION_PROFILE_NOT_FOUND'
      ) {
        throw error;
      }
      return this.repository.getOrCreateInTransaction(
        profileId,
        STORY_SEED_CHARACTER,
        at,
      );
    }
  }

  /** 스토리 XP와 모든 히로인 레벨 보상을 한 트랜잭션에서 지급한다. */
  private applyStoryReward(input: {
    eventId: string;
    eventType: string;
    profile: ProgressionProfile;
    balance: ProgressionBalance;
    dojoRewardMilli: number;
    affinity: readonly StoryAffinityGrant[];
    completedAt: number;
  }): {
    summary: ProgressionRewardSummary;
    affinityTransitions: StoryAffinityTransition[];
  } {
    const nextDojo = applyDojoXp(
      { level: input.profile.dojoLevel, xpMilli: input.profile.dojoXpMilli },
      input.dojoRewardMilli,
      input.balance,
    );
    let primary: {
      characterId: PlayableCharacterId;
      milli: number;
      levelsGained: number[];
    } | null = null;
    const affinityTransitions: StoryAffinityTransition[] = [];

    for (const grant of input.affinity) {
      this.repository.ensureAffinityInTransaction(
        input.profile.profileId,
        grant.characterId,
      );
      const current = this.repository.getAffinityInTransaction(
        input.profile.profileId,
        grant.characterId,
      );
      if (!current) {
        throw new ProgressionPersistenceError('PROGRESSION_PERSISTENCE_INVALID');
      }
      const next = applyAffinityXp(
        { level: current.level, xpMilli: current.xpMilli },
        grant.milli,
        input.balance,
      );
      this.repository.compareAndUpdateAffinityInTransaction({
        profileId: input.profile.profileId,
        characterId: grant.characterId,
        expected: { level: current.level, xpMilli: current.xpMilli },
        next,
      });
      affinityTransitions.push({
        characterId: grant.characterId,
        previousLevel: current.level,
        nextLevel: next.level,
      });
      primary ??= {
        characterId: grant.characterId,
        milli: grant.milli,
        levelsGained: levelsBetween(current.level, next.level),
      };
    }

    // 요약은 단일 히로인 계약(`ProgressionRewardSummary`)이라 첫 대상만 싣는다.
    // 여러 히로인 지급의 전모는 함께 반환하는 스냅샷(affinities)이 갖는다.
    const summary: ProgressionRewardSummary = {
      eventId: input.eventId,
      dojoXpMilli: input.dojoRewardMilli,
      dojoLevelsGained: levelsBetween(input.profile.dojoLevel, nextDojo.level),
      characterId: primary?.characterId ?? input.profile.selectedCharacterId,
      affinityMilli: primary?.milli ?? 0,
      affinityLevelsGained: primary?.levelsGained ?? [],
      missionCompletions: [],
      grantedItemIds: [],
    };

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
      updatedAt: Math.max(input.profile.updatedAt, input.completedAt),
    });
    const candidates = this.repository.getMissingLevelRewardsInTransaction(input.profile.profileId);
    summary.grantedItemIds = candidates.map(candidate => candidate.itemId);
    const inserted = this.repository.insertProgressionEvent({
      idempotencyKey: input.eventId,
      profileId: input.profile.profileId,
      eventType: input.eventType,
      balanceVersion: input.profile.balanceVersion,
      summary: { ...summary },
      createdAt: input.completedAt,
    });
    const granted = this.repository.grantLevelRewardsInTransaction(
      input.profile.profileId, candidates,
      { reason: 'story', sourceEventId: input.eventId }, input.completedAt,
    );
    if (granted.length !== summary.grantedItemIds.length
        || granted.some((id, index) => id !== summary.grantedItemIds[index])) {
      throw new ProgressionPersistenceError('PROGRESSION_PERSISTENCE_INVALID');
    }
    return {
      summary: parseStoredSummary(inserted.event, input.eventId),
      affinityTransitions,
    };
  }

  reconcileLevelRewards(profileId: string, at = Date.now()): string[] {
    assertBoundedId(profileId);
    assertTimestamp(at);
    return this.database.transaction(() => {
      this.repository.assertProgressionProfileInTransaction(profileId);
      return this.repository.grantLevelRewardsInTransaction(
        profileId, this.repository.getMissingLevelRewardsInTransaction(profileId),
        { reason: 'reconcile-v34', sourceEventId: null }, at,
      );
    });
  }

  /** Called before listen; each profile commits independently so interrupted runs can resume. */
  reconcileAllLevelRewards(at = Date.now()): { profiles: number; granted: number } {
    assertTimestamp(at);
    let after = '';
    let profiles = 0;
    let granted = 0;
    for (;;) {
      const ids = this.repository.listProgressionProfileIdsAfter(after);
      if (ids.length === 0) return { profiles, granted };
      for (const profileId of ids) {
        granted += this.reconcileLevelRewards(profileId, at).length;
        profiles += 1;
        after = profileId;
      }
    }
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
      const receipts = (event.eventType === EVENT_TYPE_STORY_CHAPTER
        || event.eventType === EVENT_TYPE_STORY_DAILY_DRILLS
        ? this.repository.getLevelGrantItemIdsForEventInTransaction(
          event.profileId, event.idempotencyKey,
        )
        : this.repository.getPermanentGrantItemIdsForEventInTransaction(
          event.profileId,
          event.idempotencyKey,
        )).sort();
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

/**
 * 챕터 보상 멱등 키. `runId`를 생략하면 첫 완주(first) 키, 넘기면 재도전(run) 키.
 * 길이 접두 규약은 기존 이벤트 키와 동일 — 구분자 주입으로 키가 겹치지 않게 한다.
 */
export function buildStoryChapterEventId(
  profileId: string,
  chapterId: string,
  runId?: string,
): string {
  assertBoundedId(profileId);
  assertBoundedId(chapterId);
  if (runId !== undefined) assertBoundedId(runId);
  const eventId = runId === undefined
    ? `story-chapter:${lengthPrefixed(chapterId)}:first:` +
      lengthPrefixed(profileId)
    : `story-chapter:${lengthPrefixed(chapterId)}:run:` +
      `${lengthPrefixed(runId)}:${lengthPrefixed(profileId)}`;
  assertEventIdLength(eventId);
  return eventId;
}

export function buildStoryDailyDrillsEventId(
  profileId: string,
  kstDate: string,
): string {
  assertBoundedId(profileId);
  assertBoundedId(kstDate);
  const eventId = `story-daily-drills:${lengthPrefixed(kstDate)}:` +
    lengthPrefixed(profileId);
  assertEventIdLength(eventId);
  return eventId;
}

function lengthPrefixed(value: string): string {
  return `${value.length}:${value}`;
}

function validateStoryChapterCompleteInput(
  input: StoryChapterCompleteInput,
): ValidStoryChapterCompleteInput {
  let copy: StoryChapterCompleteInput;
  try {
    copy = {
      profileId: input.profileId,
      chapterId: input.chapterId,
      runId: input.runId,
      firstClear: input.firstClear,
      grade: input.grade,
      dojoXpMilli: input.dojoXpMilli,
      affinity: input.affinity,
      completedAt: input.completedAt,
    };
  } catch {
    throw new ProgressionServiceError('PROGRESSION_INPUT_INVALID');
  }
  assertBoundedId(copy.profileId);
  assertBoundedId(copy.chapterId);
  assertBoundedId(copy.runId);
  if (typeof copy.firstClear !== 'boolean') {
    throw new ProgressionServiceError('PROGRESSION_INPUT_INVALID');
  }
  if (!(STORY_GRADES as readonly string[]).includes(copy.grade)) {
    throw new ProgressionServiceError('PROGRESSION_INPUT_INVALID');
  }
  assertTimestamp(copy.completedAt);
  return {
    ...copy,
    dojoXpMilli: clampStoryReward(
      copy.dojoXpMilli,
      STORY_CHAPTER_MAX_DOJO_XP_MILLI,
    ),
    affinity: normalizeStoryAffinity(
      copy.affinity,
      STORY_CHAPTER_MAX_AFFINITY_MILLI,
    ),
  };
}

function validateStoryDailyDrillsInput(
  input: StoryDailyDrillsInput,
): StoryDailyDrillsInput {
  let copy: StoryDailyDrillsInput;
  try {
    copy = {
      profileId: input.profileId,
      kstDate: input.kstDate,
      teacherId: input.teacherId,
      completedAt: input.completedAt,
    };
  } catch {
    throw new ProgressionServiceError('PROGRESSION_INPUT_INVALID');
  }
  assertBoundedId(copy.profileId);
  assertBoundedId(copy.kstDate);
  const teacherId = assertCharacter(copy.teacherId);
  assertTimestamp(copy.completedAt);
  // 날짜는 서버 시계에서 파생된 값이어야 한다 — 임의 날짜를 받으면 하루 1회 상한이 무의미해진다.
  let derivedDate: string;
  try {
    derivedDate = getKstDateKey(copy.completedAt);
  } catch {
    throw new ProgressionServiceError('PROGRESSION_INPUT_INVALID');
  }
  if (copy.kstDate !== derivedDate) {
    throw new ProgressionServiceError('PROGRESSION_INPUT_INVALID');
  }
  return { ...copy, teacherId };
}

function clampStoryReward(value: number, maxMilli: number): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new ProgressionServiceError('PROGRESSION_INPUT_INVALID');
  }
  return Math.min(value, maxMilli);
}

/** 중복 characterId 합산 → 캐릭터당 상한 클램프. 순서는 최초 등장 순(결정론). */
function normalizeStoryAffinity(
  value: readonly StoryAffinityGrant[],
  maxPerCharacterMilli: number,
): StoryAffinityGrant[] {
  if (!Array.isArray(value) || value.length > STORY_MAX_AFFINITY_TARGETS) {
    throw new ProgressionServiceError('PROGRESSION_INPUT_INVALID');
  }
  const order: PlayableCharacterId[] = [];
  const totals = new Map<PlayableCharacterId, number>();
  for (const grant of value) {
    if (typeof grant !== 'object' || grant === null) {
      throw new ProgressionServiceError('PROGRESSION_INPUT_INVALID');
    }
    const characterId = assertCharacter(grant.characterId);
    const milli = clampStoryReward(grant.milli, maxPerCharacterMilli);
    const previous = totals.get(characterId);
    if (previous === undefined) order.push(characterId);
    totals.set(
      characterId,
      Math.min((previous ?? 0) + milli, maxPerCharacterMilli),
    );
  }
  return order.map(characterId => ({
    characterId,
    milli: totals.get(characterId) ?? 0,
  }));
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

/**
 * 진행도 시드/폴백 캐릭터 보정 — 프로필 아바타는 해금 캐릭터(마스코트 등)일 수 있지만
 * 인연/선택 캐릭터 DB는 스타터 6명 제약이라, 시드로만 쓰이는 값은 sakura로 강등한다.
 * (기존 진행도 프로필이 있으면 시드는 무시되므로 동작 변화 없음)
 */
function coerceSeedCharacter(value: string): PlayableCharacterId {
  if (
    typeof value === 'string'
    && (PLAYABLE_CHARACTER_IDS as readonly string[]).includes(value)
  ) {
    return value as PlayableCharacterId;
  }
  return 'sakura';
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
