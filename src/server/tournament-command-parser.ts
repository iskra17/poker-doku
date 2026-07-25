import {
  MTT_WALLET_BUY_IN,
  MTT_WALLET_ENTRY_FEE,
} from '../lib/economy/mtt-entry';
import { MTT_STRUCTURES } from '../lib/poker/mtt-structure';
import type {
  CreateTournamentCommand,
  LateRegistrationPolicy,
  PrizePoolPolicy,
  TournamentConfigSnapshotV2,
  TournamentEconomyPolicy,
  TournamentPayoutPolicy,
  TournamentRecurrence,
  TournamentSchedule,
  TournamentStructure,
  TournamentStructureSegment,
} from '../lib/tournament/tournament-config';
import type { RegisterTournamentCommand } from '../lib/realtime/protocol';

const MINUTE_MS = 60_000;
const DAY_MS = 24 * 60 * MINUTE_MS;
const WALLET_REGISTRATION_WINDOW_MS = 20 * MINUTE_MS;
const FREEROLL_MANUAL_WINDOW_MS = 6 * 60 * MINUTE_MS;
const MAX_PROMOTION_PRIZE = 2_000_000_000;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type UnknownRecord = Record<string, unknown>;

function fail(code: string): never {
  throw new Error(code);
}

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isSafeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value);
}

function isEpochMs(value: unknown): value is number {
  return isSafeInteger(value) && value >= 0;
}

function safeIntegerIn(
  value: unknown,
  minimum: number,
  maximum: number,
  code: string,
): number {
  if (!isSafeInteger(value) || value < minimum || value > maximum) fail(code);
  return value;
}

export function isUuidRequestId(value: unknown): value is string {
  return typeof value === 'string' && UUID_PATTERN.test(value);
}

function parseUuid(value: unknown, code: string): string {
  if (!isUuidRequestId(value)) fail(code);
  return value;
}

function parseName(value: unknown): string {
  if (value === undefined) return '토너먼트';
  if (typeof value !== 'string') fail('name');
  const name = value.trim();
  if (name.length === 0 || name.length > 30) fail('name');
  return name;
}

function parseEconomy(value: unknown): TournamentEconomyPolicy {
  if (value === 'freeroll' || value === 'practice') {
    return { mode: 'freeroll', promotionAccountId: 'global' };
  }
  if (value === 'wallet') {
    return {
      mode: 'wallet',
      productVersion: 1,
      buyIn: MTT_WALLET_BUY_IN,
      fee: MTT_WALLET_ENTRY_FEE,
    };
  }
  return fail('economy-mode');
}

function parsePrizePool(
  value: unknown,
  economyMode: TournamentEconomyPolicy['mode'],
): PrizePoolPolicy {
  if (!isRecord(value) || typeof value.kind !== 'string') {
    return fail('economy-prize');
  }
  if (economyMode === 'freeroll') {
    if (value.kind !== 'promotion-funded') fail('economy-prize');
    const totalPrize = safeIntegerIn(
      value.totalPrize,
      1,
      MAX_PROMOTION_PRIZE,
      'economy-prize',
    );
    return { kind: 'promotion-funded', totalPrize };
  }
  if (value.kind !== 'entry-pool') fail('economy-prize');
  return { kind: 'entry-pool' };
}

function parseSchedule(
  raw: UnknownRecord,
  now: number,
  economyMode: TournamentEconomyPolicy['mode'],
): TournamentSchedule {
  const scheduleValue = raw.schedule;
  let schedule: TournamentSchedule;
  if (scheduleValue === undefined) {
    const startAt = raw.startAt;
    if (startAt !== undefined && startAt !== null) {
      if (!isEpochMs(startAt)) fail('schedule');
      schedule = {
        visibleAt: now,
        registrationOpensAt: now,
        startsAt: startAt,
        manualStartExpiresAt: null,
      };
    } else {
      schedule = {
        visibleAt: now,
        registrationOpensAt: now,
        startsAt: null,
        manualStartExpiresAt:
          now + (economyMode === 'wallet'
            ? WALLET_REGISTRATION_WINDOW_MS
            : FREEROLL_MANUAL_WINDOW_MS),
      };
    }
  } else {
    if (!isRecord(scheduleValue)) fail('schedule');
    const {
      visibleAt,
      registrationOpensAt,
      startsAt,
      manualStartExpiresAt,
    } = scheduleValue;
    if (
      !isEpochMs(visibleAt)
      || !isEpochMs(registrationOpensAt)
      || !(startsAt === null || isEpochMs(startsAt))
      || !(manualStartExpiresAt === null || isEpochMs(manualStartExpiresAt))
    ) {
      fail('schedule');
    }
    schedule = {
      visibleAt,
      registrationOpensAt,
      startsAt,
      manualStartExpiresAt,
    };
  }

  if (schedule.visibleAt > schedule.registrationOpensAt) fail('schedule');
  if (schedule.startsAt !== null) {
    if (
      schedule.manualStartExpiresAt !== null
      || schedule.registrationOpensAt > schedule.startsAt
    ) {
      fail('schedule');
    }
    if (
      economyMode === 'wallet'
      && schedule.startsAt - schedule.registrationOpensAt
        > WALLET_REGISTRATION_WINDOW_MS
    ) {
      fail('wallet-registration-window');
    }
  } else if (
    schedule.manualStartExpiresAt === null
    || schedule.registrationOpensAt >= schedule.manualStartExpiresAt
  ) {
    fail('schedule');
  } else if (
    economyMode === 'wallet'
    && schedule.manualStartExpiresAt - schedule.registrationOpensAt
      > WALLET_REGISTRATION_WINDOW_MS
  ) {
    fail('wallet-registration-window');
  }
  return schedule;
}

function parseRecurrence(value: unknown): TournamentRecurrence {
  if (!isRecord(value)) fail('recurrence');
  const minute = safeIntegerIn(value.minute, 0, 59, 'recurrence');
  if (value.kind === 'hourly') return { kind: 'hourly', minute };
  const hour = safeIntegerIn(value.hour, 0, 23, 'recurrence');
  if (value.kind === 'daily') return { kind: 'daily', hour, minute };
  if (value.kind === 'weekly') {
    const weekday = safeIntegerIn(value.weekday, 0, 6, 'recurrence');
    return {
      kind: 'weekly',
      weekday: weekday as 0 | 1 | 2 | 3 | 4 | 5 | 6,
      hour,
      minute,
    };
  }
  return fail('recurrence');
}

function parseRecurrenceSettings(
  raw: UnknownRecord,
  schedule: TournamentSchedule,
  economyMode: TournamentEconomyPolicy['mode'],
): Pick<
  CreateTournamentCommand,
  | 'recurrence'
  | 'firstStartsAt'
  | 'recurrenceEndsAt'
  | 'visibleLeadMs'
  | 'registrationLeadMs'
> {
  if (raw.recurrence === undefined || raw.recurrence === null) {
    if (
      (raw.visibleLeadMs !== undefined && raw.visibleLeadMs !== null)
      || (
        raw.registrationLeadMs !== undefined
        && raw.registrationLeadMs !== null
      )
      || (raw.firstStartsAt !== undefined && raw.firstStartsAt !== null)
      || (raw.recurrenceEndsAt !== undefined && raw.recurrenceEndsAt !== null)
    ) {
      fail('recurrence-boundary');
    }
    return {
      recurrence: null,
      firstStartsAt: null,
      recurrenceEndsAt: null,
      visibleLeadMs: null,
      registrationLeadMs: null,
    };
  }
  if (schedule.startsAt === null || schedule.manualStartExpiresAt !== null) {
    fail('recurrence-schedule');
  }
  const recurrence = parseRecurrence(raw.recurrence);
  if (
    !isEpochMs(raw.firstStartsAt)
    || !isEpochMs(raw.recurrenceEndsAt)
    || raw.firstStartsAt !== schedule.startsAt
    || raw.recurrenceEndsAt < raw.firstStartsAt
  ) {
    fail('recurrence-boundary');
  }
  const firstStartsAt = raw.firstStartsAt;
  const recurrenceEndsAt = raw.recurrenceEndsAt;
  const visibleLeadMs = safeIntegerIn(
    raw.visibleLeadMs,
    0,
    30 * DAY_MS,
    'recurrence-lead',
  );
  const registrationLeadMaximum =
    economyMode === 'wallet' ? WALLET_REGISTRATION_WINDOW_MS : 7 * DAY_MS;
  const registrationLeadMs = safeIntegerIn(
    raw.registrationLeadMs,
    0,
    registrationLeadMaximum,
    economyMode === 'wallet'
      ? 'wallet-registration-window'
      : 'recurrence-lead',
  );
  if (visibleLeadMs < registrationLeadMs) fail('recurrence-lead');
  return {
    recurrence,
    firstStartsAt,
    recurrenceEndsAt,
    visibleLeadMs,
    registrationLeadMs,
  };
}

function materializePresetStructure(
  presetId: 'standard' | 'turbo' | 'hyper',
): TournamentStructure {
  const preset = MTT_STRUCTURES[presetId];
  const canonicalLevelDurationMs = {
    standard: 8 * MINUTE_MS,
    turbo: 5 * MINUTE_MS,
    hyper: 3 * MINUTE_MS,
  }[presetId];
  const segments: TournamentStructureSegment[] = [];
  for (const [index, level] of preset.levels.entries()) {
    segments.push({
      kind: 'level',
      durationMs: canonicalLevelDurationMs,
      smallBlind: level.smallBlind,
      bigBlind: level.bigBlind,
      bigBlindAnte: level.ante,
    });
    if (
      preset.breakEveryLevels > 0
      && (index + 1) % preset.breakEveryLevels === 0
      && index < preset.levels.length - 1
    ) {
      segments.push({ kind: 'break', durationMs: preset.breakDurationMs });
    }
  }
  return {
    sourcePresetId: presetId,
    startingStack: preset.startingStack,
    segments,
  };
}

function parseStructure(value: unknown): TournamentStructure {
  if (value === undefined) return materializePresetStructure('standard');
  if (!isRecord(value)) fail('structure');
  const sourcePresetId = value.sourcePresetId;
  if (
    sourcePresetId !== null
    && sourcePresetId !== 'standard'
    && sourcePresetId !== 'turbo'
    && sourcePresetId !== 'hyper'
  ) {
    fail('structure');
  }
  const startingStack = safeIntegerIn(
    value.startingStack,
    1_000,
    1_000_000,
    'structure',
  );
  if (!Array.isArray(value.segments)) fail('structure');

  const segments: TournamentStructureSegment[] = [];
  let levelCount = 0;
  let breakCount = 0;
  let previousLevel: Extract<TournamentStructureSegment, { kind: 'level' }>
    | undefined;
  let previousKind: TournamentStructureSegment['kind'] | undefined;

  for (const valueSegment of value.segments) {
    if (!isRecord(valueSegment)) fail('structure');
    if (valueSegment.kind === 'break') {
      if (previousKind !== 'level') fail('structure');
      breakCount += 1;
      if (breakCount > 8) fail('structure');
      segments.push({
        kind: 'break',
        durationMs: safeIntegerIn(
          valueSegment.durationMs,
          MINUTE_MS,
          20 * MINUTE_MS,
          'structure',
        ),
      });
      previousKind = 'break';
      continue;
    }
    if (valueSegment.kind !== 'level') fail('structure');
    levelCount += 1;
    if (levelCount > 30) fail('structure');
    const level = {
      kind: 'level' as const,
      durationMs: safeIntegerIn(
        valueSegment.durationMs,
        MINUTE_MS,
        60 * MINUTE_MS,
        'structure',
      ),
      smallBlind: safeIntegerIn(
        valueSegment.smallBlind,
        1,
        Number.MAX_SAFE_INTEGER,
        'structure',
      ),
      bigBlind: safeIntegerIn(
        valueSegment.bigBlind,
        2,
        Number.MAX_SAFE_INTEGER,
        'structure',
      ),
      bigBlindAnte: safeIntegerIn(
        valueSegment.bigBlindAnte,
        0,
        Number.MAX_SAFE_INTEGER,
        'structure',
      ),
    };
    if (level.bigBlind <= level.smallBlind || level.bigBlindAnte > level.bigBlind) {
      fail('structure');
    }
    if (
      previousLevel
      && (
        level.smallBlind < previousLevel.smallBlind
        || level.bigBlind < previousLevel.bigBlind
      )
    ) {
      fail('structure-order');
    }
    segments.push(level);
    previousLevel = level;
    previousKind = 'level';
  }
  if (levelCount < 3 || previousKind !== 'level') fail('structure');
  return {
    sourcePresetId,
    startingStack,
    segments,
  };
}

function parseLateRegistration(value: unknown): LateRegistrationPolicy {
  if (value === undefined) {
    return {
      enabled: false,
      durationLevels: 0,
      minStartingStackBb: 20,
    };
  }
  if (
    !isRecord(value)
    || typeof value.enabled !== 'boolean'
    || value.minStartingStackBb !== 20
  ) {
    fail('late-registration');
  }
  if (!value.enabled) {
    if (value.durationLevels !== 0) fail('late-registration');
    return {
      enabled: false,
      durationLevels: 0,
      minStartingStackBb: 20,
    };
  }
  if (
    value.durationLevels !== 1
    && value.durationLevels !== 2
    && value.durationLevels !== 3
  ) {
    fail('late-registration');
  }
  return {
    enabled: true,
    durationLevels: value.durationLevels,
    minStartingStackBb: 20,
  };
}

function parsePayout(value: unknown): TournamentPayoutPolicy {
  if (value === undefined) {
    return {
      tableVersion: 2,
      presetId: 'standard',
      paidFieldPercent: 15,
    };
  }
  if (!isRecord(value) || value.tableVersion !== 2) fail('payout');
  if (value.presetId === 'top-heavy' && value.paidFieldPercent === 10) {
    return { tableVersion: 2, presetId: 'top-heavy', paidFieldPercent: 10 };
  }
  if (value.presetId === 'standard' && value.paidFieldPercent === 15) {
    return { tableVersion: 2, presetId: 'standard', paidFieldPercent: 15 };
  }
  if (value.presetId === 'flat' && value.paidFieldPercent === 20) {
    return { tableVersion: 2, presetId: 'flat', paidFieldPercent: 20 };
  }
  return fail('payout');
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const nested of Object.values(value)) deepFreeze(nested);
  }
  return value;
}

export function parseCreateTournamentCommand(
  raw: unknown,
  now: number,
): CreateTournamentCommand {
  if (!isRecord(raw)) fail('create-command');
  if (!isEpochMs(now)) fail('server-time');
  const requestId = parseUuid(raw.requestId, 'request-id');
  const economy = parseEconomy(raw.economyMode);
  const minEntrants = safeIntegerIn(raw.minEntrants, 2, 48, 'field-policy');
  const maxEntrants = safeIntegerIn(raw.maxEntrants, 2, 48, 'field-policy');
  if (maxEntrants < minEntrants || typeof raw.botFillToMinimum !== 'boolean') {
    fail('field-policy');
  }
  if (economy.mode === 'wallet' && raw.botFillToMinimum) {
    fail('wallet-bot-fill');
  }
  const schedule = parseSchedule(raw, now, economy.mode);
  const recurrenceSettings = parseRecurrenceSettings(raw, schedule, economy.mode);
  const turnTime = raw.turnTimeSeconds ?? raw.turnTime ?? 15;
  if (turnTime !== 8 && turnTime !== 15 && turnTime !== 30) fail('turn-time');

  const config: TournamentConfigSnapshotV2 = {
    version: 2,
    name: parseName(raw.name),
    economy,
    tableSize: 6,
    field: {
      minEntrants,
      maxEntrants,
      botFillToMinimum: raw.botFillToMinimum,
    },
    turnTimeSeconds: turnTime,
    structure: parseStructure(raw.structure),
    prizePool: parsePrizePool(raw.prizePool, economy.mode),
    payout: parsePayout(raw.payout),
    lateRegistration: parseLateRegistration(raw.lateRegistration),
  };

  return deepFreeze({
    requestId,
    schedule,
    ...recurrenceSettings,
    config,
  });
}

export function parseRegisterTournamentCommand(
  raw: unknown,
): RegisterTournamentCommand {
  if (!isRecord(raw) || typeof raw.tournamentId !== 'string') {
    fail('register-command');
  }
  if (/[\u0000-\u001f\u007f-\u009f]/.test(raw.tournamentId)) {
    fail('register-command');
  }
  const tournamentId = raw.tournamentId.trim();
  if (
    tournamentId.length === 0
    || tournamentId.length > 128
  ) {
    fail('register-command');
  }
  let requestId: string;
  try {
    requestId = parseUuid(raw.requestId, 'register-command');
  } catch {
    return fail('register-command');
  }
  return deepFreeze({ tournamentId, requestId });
}
