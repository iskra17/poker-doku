import {
  applyAffinityXp,
  applyDojoXp,
  getBalance,
  scaleReward,
  type ProgressionBalance,
} from '@/lib/progression/balance';
import type { ProgressionRewardSummary } from '@/lib/progression/types';
import type { PokerDatabase } from './persistence/database';
import {
  PLAYABLE_CHARACTER_IDS,
  ProgressionPersistenceError,
  ProgressionRepository,
  type CharacterAffinity,
  type PlayableCharacterId,
  type ProgressionCounters,
  type ProgressionEvent,
  type ProgressionProfile,
} from './progression-repository';
import { getKstDateKey } from './economy-service';

const EVENT_TYPE_COMPLETED_HAND = 'completed-hand';
const EVENT_TYPE_SNG_FINISH = 'sng-finish';
const MAX_EVENT_ID_COMPONENT_LENGTH = 128;
const MAX_EVENT_ID_LENGTH = 384;
const INTERNAL_ID_PATTERN = /^[A-Za-z0-9_-]+$/;
const MISSION_ID_PATTERN = /^[A-Z][A-Z0-9_]{0,127}$/;
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
  | 'PROGRESSION_STORED_SUMMARY_INVALID';

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
  kstDate: string | null;
}

interface ValidSngFinishInput extends Omit<SngFinishInput, 'selectedCharacterId'> {
  selectedCharacterId: PlayableCharacterId;
}

export class ProgressionService {
  private readonly repository: ProgressionRepository;

  constructor(
    private readonly database: PokerDatabase,
    repository?: ProgressionRepository,
  ) {
    this.repository = repository ?? new ProgressionRepository(database);
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

      const snapshot = this.repository.getOrCreateInTransaction(
        safeInput.profileId,
        safeInput.selectedCharacterId,
        safeInput.completedAt,
      );
      assertAuthoritativeCharacter(
        snapshot.profile.selectedCharacterId,
        safeInput.selectedCharacterId,
      );
      const balance = getBalance(snapshot.profile.balanceVersion);
      const affinity = getSelectedAffinity(
        snapshot.affinities,
        snapshot.profile.selectedCharacterId,
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
      const dojoReward = scaleReward(
        balance.dojoXpPerCompletedHand,
        ratePermille,
      );
      const affinityReward = scaleReward(
        balance.affinityPerCompletedHand,
        ratePermille,
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
        bestStreak: snapshot.profile.bestStreak,
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

      const snapshot = this.repository.getOrCreateInTransaction(
        safeInput.profileId,
        safeInput.selectedCharacterId,
        safeInput.completedAt,
      );
      assertAuthoritativeCharacter(
        snapshot.profile.selectedCharacterId,
        safeInput.selectedCharacterId,
      );
      const balance = getBalance(snapshot.profile.balanceVersion);
      const affinity = getSelectedAffinity(
        snapshot.affinities,
        snapshot.profile.selectedCharacterId,
      );
      const placeIndex = safeInput.place - 1;
      const dojoReward = balance.dojoXpPerSngPlace[placeIndex];
      const affinityReward = balance.affinityPerSngPlace[placeIndex];
      if (dojoReward === undefined || affinityReward === undefined) {
        throw new ProgressionServiceError('PROGRESSION_INPUT_INVALID');
      }
      const nextCounters: ProgressionCounters = {
        practiceDate: snapshot.profile.practiceDate,
        practiceHands: snapshot.profile.practiceHands,
        completedHands: snapshot.profile.completedHands,
        cashHands: snapshot.profile.cashHands,
        practiceHandsTotal: snapshot.profile.practiceHandsTotal,
        sngCompletions: safeIncrement(snapshot.profile.sngCompletions),
        bestStreak: snapshot.profile.bestStreak,
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
        completedAt: safeInput.completedAt,
      });
    });
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
    return parseStoredSummary(duplicate.event, eventId);
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
      missionCompletions: [],
      grantedItemIds: [],
    };
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
  let kstDate: string | null = null;
  if (copy.mode === 'practice') {
    try {
      kstDate = getKstDateKey(copy.completedAt);
    } catch {
      throw new ProgressionServiceError('PROGRESSION_INPUT_INVALID');
    }
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
  return { ...copy, selectedCharacterId };
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
      || !isMissionCompletionArray(value.missionCompletions)
      || !isUniqueCatalogItemIdArray(value.grantedItemIds)
      || (hasOwn(value, 'streak') && !isStreakChange(value.streak))
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

function isMissionCompletionArray(value: unknown): boolean {
  if (!Array.isArray(value)) return false;
  const missionIds = new Set<string>();
  const slots = new Set<number>();
  return value.every(item => {
    if (!hasExactKeys(item, ['missionId', 'slot', 'dojoXpMilli'])) {
      return false;
    }
    const { missionId, slot, dojoXpMilli } = item;
    if (
      typeof missionId !== 'string'
      || !MISSION_ID_PATTERN.test(missionId)
      || missionIds.has(missionId)
      || typeof slot !== 'number'
      || !Number.isSafeInteger(slot)
      || slot < 0
      || slot > 2
      || slots.has(slot)
      || !isNonnegativeSafeInteger(dojoXpMilli)
    ) {
      return false;
    }
    missionIds.add(missionId);
    slots.add(slot);
    return true;
  });
}

function isStreakChange(value: unknown): boolean {
  if (!hasExactKeys(value, [
    'previousStreak',
    'currentStreak',
    'restPassUsed',
  ])) {
    return false;
  }
  return isNonnegativeSafeInteger(value.previousStreak)
    && isNonnegativeSafeInteger(value.currentStreak)
    && typeof value.restPassUsed === 'boolean';
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
