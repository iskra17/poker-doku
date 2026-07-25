/**
 * 토너먼트 개설 폼의 순수 정책 계산 — 필드 상·하한 정규화와 반복 회차 미리보기.
 *
 * 폼(React)과 서버 파서가 같은 숫자를 보게 하려고 계산을 전부 여기로 모은다.
 * KST는 DST가 없어 시/일/주 간격이 고정 밀리초라, 서버 스케줄러의 KST 산술과
 * 같은 결과를 브라우저에서도 의존성 없이 낼 수 있다.
 */

import { TEMPLATE_OCCURRENCE_LIMIT } from '@/lib/tournament/tournament-config';
import type { TournamentRecurrence } from '@/lib/tournament/tournament-config';

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;
const WEEK_MS = 7 * DAY_MS;
const KST_OFFSET_MS = 9 * HOUR_MS;

/**
 * `unlimitedMinimum`이 2인 이유: 포커는 혼자 시작할 수 없다. "제한 없음"은
 * 하한을 없앤다는 뜻이지 1인 개시를 뜻하지 않는다.
 * `serviceMaximum`은 현재 서비스 상한(밸런싱·페이아웃 밴드 검증 범위)이다.
 */
export const TOURNAMENT_FIELD_LIMITS = {
  unlimitedMinimum: 2,
  defaultMinimum: 6,
  serviceMaximum: 48,
} as const;

export type FieldBoundMode = 'unlimited' | 'custom';

export interface FieldPolicyInput {
  readonly minimumMode: FieldBoundMode;
  readonly minimumValue: number;
  readonly maximumMode: FieldBoundMode;
  readonly maximumValue: number;
}

export interface NormalizedFieldPolicy {
  readonly minEntrants: number;
  readonly maxEntrants: number;
}

function clampToServiceRange(value: number): number {
  return Math.min(
    TOURNAMENT_FIELD_LIMITS.serviceMaximum,
    Math.max(TOURNAMENT_FIELD_LIMITS.unlimitedMinimum, Math.round(value)),
  );
}

export function normalizeFieldPolicy(
  input: FieldPolicyInput,
): NormalizedFieldPolicy {
  return {
    minEntrants: input.minimumMode === 'unlimited'
      ? TOURNAMENT_FIELD_LIMITS.unlimitedMinimum
      : clampToServiceRange(input.minimumValue),
    maxEntrants: input.maximumMode === 'unlimited'
      ? TOURNAMENT_FIELD_LIMITS.serviceMaximum
      : clampToServiceRange(input.maximumValue),
  };
}

/** 최소와 최대가 같으면 정원이 고정된 토너먼트다. */
export function isFixedSizeField(policy: NormalizedFieldPolicy): boolean {
  return policy.minEntrants === policy.maxEntrants;
}

export function fieldPolicyError(input: FieldPolicyInput): string | null {
  const bounds: Array<[FieldBoundMode, number, string]> = [
    [input.minimumMode, input.minimumValue, '최소 인원'],
    [input.maximumMode, input.maximumValue, '최대 인원'],
  ];
  for (const [mode, value, label] of bounds) {
    if (mode !== 'custom') continue;
    if (!Number.isInteger(value)) {
      return `${label}은 정수로 입력해 주세요.`;
    }
    if (
      value < TOURNAMENT_FIELD_LIMITS.unlimitedMinimum
      || value > TOURNAMENT_FIELD_LIMITS.serviceMaximum
    ) {
      return `${label}은 ${TOURNAMENT_FIELD_LIMITS.unlimitedMinimum}명 이상 `
        + `${TOURNAMENT_FIELD_LIMITS.serviceMaximum}명 이하여야 합니다.`;
    }
  }
  const policy = normalizeFieldPolicy(input);
  if (policy.minEntrants > policy.maxEntrants) {
    return '최소 인원은 최대 인원보다 클 수 없습니다.';
  }
  return null;
}

export interface RecurrenceSummaryInput {
  readonly recurrence: TournamentRecurrence | null;
  readonly firstStartsAt: number;
  readonly recurrenceEndsAt: number | null;
}

export interface RecurrenceSummary {
  /** 처음 다섯 회차 (전체가 다섯 미만이면 그만큼만) */
  readonly previewStarts: number[];
  /** 마감 시각까지의 전체 회차 수 */
  readonly totalOccurrences: number;
  readonly lastStartsAt: number | null;
  /** 동시에 살아 있을 수 있는 회차 상한 */
  readonly materializedLimit: number;
}

function stepMsFor(recurrence: TournamentRecurrence): number {
  if (recurrence.kind === 'hourly') return HOUR_MS;
  if (recurrence.kind === 'daily') return DAY_MS;
  return WEEK_MS;
}

/** `from` 이상에서 반복 패턴에 처음 맞는 KST 시각 */
function firstAlignedOccurrence(
  recurrence: TournamentRecurrence,
  from: number,
): number {
  const kst = from + KST_OFFSET_MS;
  if (recurrence.kind === 'hourly') {
    const hourStart = Math.floor(kst / HOUR_MS) * HOUR_MS;
    let candidate = hourStart + recurrence.minute * MINUTE_MS;
    if (candidate < kst) candidate += HOUR_MS;
    return candidate - KST_OFFSET_MS;
  }
  const dayStart = Math.floor(kst / DAY_MS) * DAY_MS;
  const timeOfDay = recurrence.hour * HOUR_MS + recurrence.minute * MINUTE_MS;
  if (recurrence.kind === 'daily') {
    let candidate = dayStart + timeOfDay;
    if (candidate < kst) candidate += DAY_MS;
    return candidate - KST_OFFSET_MS;
  }
  const weekdayAtDayStart = new Date(dayStart).getUTCDay();
  const daysAhead = (recurrence.weekday - weekdayAtDayStart + 7) % 7;
  let candidate = dayStart + daysAhead * DAY_MS + timeOfDay;
  if (candidate < kst) candidate += WEEK_MS;
  return candidate - KST_OFFSET_MS;
}

export function recurrenceSummary(
  input: RecurrenceSummaryInput,
): RecurrenceSummary | null {
  const { recurrence, firstStartsAt, recurrenceEndsAt } = input;
  if (!recurrence) return null;
  if (
    !Number.isFinite(firstStartsAt)
    || recurrenceEndsAt === null
    || !Number.isFinite(recurrenceEndsAt)
  ) {
    return {
      previewStarts: [],
      totalOccurrences: 0,
      lastStartsAt: null,
      materializedLimit: TEMPLATE_OCCURRENCE_LIMIT,
    };
  }
  const step = stepMsFor(recurrence);
  const first = firstAlignedOccurrence(recurrence, firstStartsAt);
  if (first > recurrenceEndsAt) {
    return {
      previewStarts: [],
      totalOccurrences: 0,
      lastStartsAt: null,
      materializedLimit: TEMPLATE_OCCURRENCE_LIMIT,
    };
  }
  const totalOccurrences = Math.floor((recurrenceEndsAt - first) / step) + 1;
  const previewCount = Math.min(TEMPLATE_OCCURRENCE_LIMIT, totalOccurrences);
  return {
    previewStarts: Array.from(
      { length: previewCount },
      (_, index) => first + index * step,
    ),
    totalOccurrences,
    lastStartsAt: first + (totalOccurrences - 1) * step,
    materializedLimit: TEMPLATE_OCCURRENCE_LIMIT,
  };
}

/** 반복을 고른 경우에만 마감일이 필수다. */
export function recurrenceEndError(
  recurrence: TournamentRecurrence | null,
  firstStartsAt: number,
  recurrenceEndsAt: number | null,
): string | null {
  if (!recurrence) return null;
  if (recurrenceEndsAt === null || !Number.isFinite(recurrenceEndsAt)) {
    return '반복 토너먼트는 마지막 회차 시각을 반드시 지정해야 합니다.';
  }
  if (recurrenceEndsAt < firstStartsAt) {
    return '반복 마감은 첫 회차보다 빠를 수 없습니다.';
  }
  return null;
}

/** 시각이 아직 유효하지 않을 때 표시할 자리표시자 */
export const MISSING_TIME_LABEL = '—';

const KST_DATE_TIME_FORMATTER = new Intl.DateTimeFormat('ko-KR', {
  timeZone: 'Asia/Seoul',
  month: 'long',
  day: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});

/**
 * KST 날짜·시각 라벨. **유효하지 않은 입력에 절대 던지지 않는다** —
 * datetime-local을 다시 입력하는 동안 값이 잠깐 비면 Date.parse가 NaN을 내는데,
 * 그대로 Intl.DateTimeFormat.format에 넘기면 RangeError로 폼 전체가 죽는다
 * (2026-07-25 운영자 신고: "This page couldn't load").
 */
export function kstDateTimeLabel(epoch: number | null | undefined): string {
  return typeof epoch === 'number' && Number.isFinite(epoch)
    ? KST_DATE_TIME_FORMATTER.format(epoch)
    : MISSING_TIME_LABEL;
}

/**
 * epoch → datetime-local 입력값(KST). `new Date(NaN).toISOString()`도 같은
 * RangeError를 던지므로 유효하지 않으면 빈 문자열을 준다.
 */
export function kstInputValue(epoch: number | null | undefined): string {
  if (typeof epoch !== 'number' || !Number.isFinite(epoch)) return '';
  return new Date(epoch + KST_OFFSET_MS).toISOString().slice(0, 16);
}

export interface LeadTimeExample {
  readonly startsAtLabel: string;
  readonly visibleAtLabel: string;
  readonly registrationOpensAtLabel: string;
  readonly sentence: string;
}

function kstClockLabel(epoch: number): string {
  return new Date(epoch + KST_OFFSET_MS).toISOString().slice(11, 16);
}

export function leadTimeExample(
  startsAt: number,
  visibleLeadMs: number,
  registrationLeadMs: number,
): LeadTimeExample {
  const startsAtLabel = kstClockLabel(startsAt);
  const visibleAtLabel = kstClockLabel(startsAt - visibleLeadMs);
  const registrationOpensAtLabel = kstClockLabel(startsAt - registrationLeadMs);
  return {
    startsAtLabel,
    visibleAtLabel,
    registrationOpensAtLabel,
    sentence: `${startsAtLabel} 시작 · 로비 노출 리드 `
      + `${Math.round(visibleLeadMs / MINUTE_MS)}분 → ${visibleAtLabel}에 카드가 `
      + `보이고, 등록 시작 리드 ${Math.round(registrationLeadMs / MINUTE_MS)}분 → `
      + `${registrationOpensAtLabel}에 등록이 열립니다.`,
  };
}
