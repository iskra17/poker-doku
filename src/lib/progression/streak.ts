import type { ProgressionBalance } from './balance';

const KST_OFFSET_MS = 9 * 60 * 60 * 1_000;
const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const WEEK_PATTERN = /^(\d{4})-W(\d{2})$/;

export interface WeeklyRestPassState {
  readonly restPasses: number;
  readonly lastWeekKey: string | null;
}

export interface StreakDayState {
  readonly currentStreak: number;
  readonly restPasses: number;
  readonly lastQualifiedDate: string | null;
}

export interface StreakDayResult extends StreakDayState {
  readonly changed: boolean;
  readonly previousStreak: number;
  readonly restPassUsed: boolean;
  readonly fragmentDue: boolean;
}

export function getKstWeekKey(at: number): string {
  assertTimestamp(at);
  const kst = new Date(at + KST_OFFSET_MS);
  const year = kst.getUTCFullYear();
  const month = kst.getUTCMonth() + 1;
  const day = kst.getUTCDate();
  const ordinal = dateOrdinal(year, month, day);
  const isoWeekday = ((kst.getUTCDay() + 6) % 7) + 1;
  const thursday = ordinal + (4 - isoWeekday);
  const thursdayDate = new Date(thursday * 86_400_000);
  const isoYear = thursdayDate.getUTCFullYear();
  const januaryFourth = dateOrdinal(isoYear, 1, 4);
  const januaryFourthWeekday = (
    (new Date(januaryFourth * 86_400_000).getUTCDay() + 6) % 7
  ) + 1;
  const firstThursday = januaryFourth + (4 - januaryFourthWeekday);
  const week = Math.floor((thursday - firstThursday) / 7) + 1;
  return `${padYear(isoYear)}-W${String(week).padStart(2, '0')}`;
}

export function reconcileWeeklyRestPass(
  state: WeeklyRestPassState,
  at: number,
  balance: ProgressionBalance,
): WeeklyRestPassState {
  assertWeeklyState(state, balance);
  const currentWeekKey = getKstWeekKey(at);
  if (
    state.lastWeekKey !== null
    && compareWeekKeys(currentWeekKey, state.lastWeekKey) <= 0
  ) {
    return Object.freeze({ ...state });
  }
  return Object.freeze({
    restPasses: Math.min(
      balance.restPassCap,
      state.restPasses + balance.weeklyRestPassGrant,
    ),
    lastWeekKey: currentWeekKey,
  });
}

export function advanceStreakDay(
  state: StreakDayState,
  qualifiedDate: string,
  balance: ProgressionBalance,
): StreakDayResult {
  assertStreakState(state, balance);
  const todayOrdinal = parseDateOrdinal(qualifiedDate);
  const previousStreak = state.currentStreak;
  if (state.lastQualifiedDate !== null) {
    const previousOrdinal = parseDateOrdinal(state.lastQualifiedDate);
    if (todayOrdinal <= previousOrdinal) {
      return Object.freeze({
        ...state,
        changed: false,
        previousStreak,
        restPassUsed: false,
        fragmentDue: false,
      });
    }
  }

  const gap = state.lastQualifiedDate === null
    ? null
    : todayOrdinal - parseDateOrdinal(state.lastQualifiedDate);
  const restPassUsed = gap === 2 && state.restPasses > 0;
  const currentStreak = gap === null
    ? 1
    : gap === 1 || restPassUsed
      ? safeIncrement(state.currentStreak)
      : 1;
  return Object.freeze({
    currentStreak,
    restPasses: restPassUsed ? state.restPasses - 1 : state.restPasses,
    lastQualifiedDate: qualifiedDate,
    changed: true,
    previousStreak,
    restPassUsed,
    fragmentDue: currentStreak % balance.streakFragmentEveryDays === 0,
  });
}

function assertWeeklyState(
  state: WeeklyRestPassState,
  balance: ProgressionBalance,
): void {
  if (
    !Number.isSafeInteger(state.restPasses)
    || state.restPasses < 0
    || state.restPasses > balance.restPassCap
    || (state.lastWeekKey !== null && !isCanonicalWeekKey(state.lastWeekKey))
  ) {
    throw new Error('STREAK_STATE_INVALID');
  }
}

function assertStreakState(
  state: StreakDayState,
  balance: ProgressionBalance,
): void {
  if (
    !Number.isSafeInteger(state.currentStreak)
    || state.currentStreak < 0
    || !Number.isSafeInteger(state.restPasses)
    || state.restPasses < 0
    || state.restPasses > balance.restPassCap
    || (state.lastQualifiedDate === null) !== (state.currentStreak === 0)
  ) {
    throw new Error('STREAK_STATE_INVALID');
  }
  if (state.lastQualifiedDate !== null) parseDateOrdinal(state.lastQualifiedDate);
}

function compareWeekKeys(left: string, right: string): number {
  if (!isCanonicalWeekKey(left) || !isCanonicalWeekKey(right)) {
    throw new Error('STREAK_STATE_INVALID');
  }
  return left < right ? -1 : left === right ? 0 : 1;
}

function isCanonicalWeekKey(value: string): boolean {
  const match = WEEK_PATTERN.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const week = Number(match[2]);
  if (year < 1 || year > 9_999 || week < 1 || week > 53) return false;
  const weekOne = isoWeekOneMonday(year);
  const monday = weekOne + (week - 1) * 7;
  const probe = new Date(monday * 86_400_000);
  const probeAtKstNoon = dateToTimestamp(
    probe.getUTCFullYear(),
    probe.getUTCMonth() + 1,
    probe.getUTCDate(),
  ) - KST_OFFSET_MS + 12 * 60 * 60 * 1_000;
  return getKstWeekKey(probeAtKstNoon) === value;
}

function isoWeekOneMonday(year: number): number {
  const januaryFourth = dateOrdinal(year, 1, 4);
  const weekday = ((new Date(januaryFourth * 86_400_000).getUTCDay() + 6) % 7) + 1;
  return januaryFourth - (weekday - 1);
}

function parseDateOrdinal(value: string): number {
  const match = DATE_PATTERN.exec(value);
  if (!match) throw new Error('STREAK_DATE_INVALID');
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (year < 1 || year > 9_999 || month < 1 || month > 12) {
    throw new Error('STREAK_DATE_INVALID');
  }
  const ordinal = dateOrdinal(year, month, day);
  const date = new Date(ordinal * 86_400_000);
  if (
    date.getUTCFullYear() !== year
    || date.getUTCMonth() + 1 !== month
    || date.getUTCDate() !== day
  ) {
    throw new Error('STREAK_DATE_INVALID');
  }
  return ordinal;
}

function dateOrdinal(year: number, month: number, day: number): number {
  return Math.floor(dateToTimestamp(year, month, day) / 86_400_000);
}

function dateToTimestamp(year: number, month: number, day: number): number {
  const date = new Date(0);
  date.setUTCFullYear(year, month - 1, day);
  date.setUTCHours(0, 0, 0, 0);
  return date.getTime();
}

function padYear(year: number): string {
  return String(year).padStart(4, '0');
}

function assertTimestamp(value: number): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error('STREAK_TIME_INVALID');
  }
  const date = new Date(value);
  if (
    !Number.isFinite(date.getTime())
    || date.getUTCFullYear() < 1
    || date.getUTCFullYear() > 9_999
  ) {
    throw new Error('STREAK_TIME_INVALID');
  }
}

function safeIncrement(value: number): number {
  if (value === Number.MAX_SAFE_INTEGER) throw new Error('STREAK_OVERFLOW');
  return value + 1;
}
