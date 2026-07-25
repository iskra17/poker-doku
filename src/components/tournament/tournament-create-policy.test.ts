import { describe, it, expect } from 'vitest';
import {
  TOURNAMENT_FIELD_LIMITS,
  fieldPolicyError,
  isFixedSizeField,
  leadTimeExample,
  normalizeFieldPolicy,
  recurrenceEndError,
  recurrenceSummary,
} from './tournament-create-policy';

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const WEEK = 7 * DAY;
/** 2026-07-27 (월) 20:00 KST */
const FIRST = Date.parse('2026-07-27T20:00:00+09:00');

describe('tournament create policy', () => {
  describe('normalizeFieldPolicy', () => {
    it('maps unlimited bounds onto the persisted integers', () => {
      expect(normalizeFieldPolicy({
        minimumMode: 'unlimited',
        minimumValue: 6,
        maximumMode: 'unlimited',
        maximumValue: 24,
      })).toEqual({ minEntrants: 2, maxEntrants: 48 });
    });

    it('keeps custom bounds as entered', () => {
      expect(normalizeFieldPolicy({
        minimumMode: 'custom',
        minimumValue: 6,
        maximumMode: 'custom',
        maximumValue: 12,
      })).toEqual({ minEntrants: 6, maxEntrants: 12 });
    });

    it('clamps custom bounds into the service range', () => {
      expect(normalizeFieldPolicy({
        minimumMode: 'custom',
        minimumValue: 1,
        maximumMode: 'custom',
        maximumValue: 900,
      })).toEqual({ minEntrants: 2, maxEntrants: 48 });
    });

    it('exposes the approved policy numbers', () => {
      // 포커는 혼자 시작할 수 없으므로 "제한 없음"도 하한 2로 저장된다.
      expect(TOURNAMENT_FIELD_LIMITS.unlimitedMinimum).toBe(2);
      expect(TOURNAMENT_FIELD_LIMITS.defaultMinimum).toBe(6);
      expect(TOURNAMENT_FIELD_LIMITS.serviceMaximum).toBe(48);
    });
  });

  describe('fieldPolicyError', () => {
    it('accepts an equal minimum and maximum as a fixed-size field', () => {
      const input = {
        minimumMode: 'custom',
        minimumValue: 9,
        maximumMode: 'custom',
        maximumValue: 9,
      } as const;
      expect(fieldPolicyError(input)).toBeNull();
      expect(isFixedSizeField(normalizeFieldPolicy(input))).toBe(true);
    });

    it('rejects an inverted field order', () => {
      expect(fieldPolicyError({
        minimumMode: 'custom',
        minimumValue: 20,
        maximumMode: 'custom',
        maximumValue: 12,
      })).toContain('최소 인원');
    });

    it('rejects a non-integer bound', () => {
      expect(fieldPolicyError({
        minimumMode: 'custom',
        minimumValue: 6.5,
        maximumMode: 'custom',
        maximumValue: 12,
      })).not.toBeNull();
    });

    it('does not call an unlimited pair fixed-size', () => {
      expect(isFixedSizeField(normalizeFieldPolicy({
        minimumMode: 'unlimited',
        minimumValue: 6,
        maximumMode: 'unlimited',
        maximumValue: 48,
      }))).toBe(false);
    });
  });

  describe('recurrenceSummary', () => {
    it('counts an inclusive hourly window and previews five starts', () => {
      const summary = recurrenceSummary({
        recurrence: { kind: 'hourly', minute: 0 },
        firstStartsAt: FIRST,
        recurrenceEndsAt: FIRST + 4 * HOUR,
      });
      expect(summary).toMatchObject({
        totalOccurrences: 5,
        lastStartsAt: FIRST + 4 * HOUR,
      });
      expect(summary?.previewStarts).toEqual([
        FIRST,
        FIRST + HOUR,
        FIRST + 2 * HOUR,
        FIRST + 3 * HOUR,
        FIRST + 4 * HOUR,
      ]);
    });

    it('previews only five starts but counts the whole window', () => {
      const summary = recurrenceSummary({
        recurrence: { kind: 'hourly', minute: 0 },
        firstStartsAt: FIRST,
        recurrenceEndsAt: FIRST + 30 * HOUR,
      });
      expect(summary?.totalOccurrences).toBe(31);
      expect(summary?.previewStarts).toHaveLength(5);
      expect(summary?.lastStartsAt).toBe(FIRST + 30 * HOUR);
      // 동시에 살아 있는 회차는 다섯 개를 넘지 않는다.
      expect(summary?.materializedLimit).toBe(5);
    });

    it('steps daily and weekly recurrences on the KST wall clock', () => {
      expect(recurrenceSummary({
        recurrence: { kind: 'daily', hour: 20, minute: 0 },
        firstStartsAt: FIRST,
        recurrenceEndsAt: FIRST + 3 * DAY,
      })).toMatchObject({
        totalOccurrences: 4,
        lastStartsAt: FIRST + 3 * DAY,
      });
      expect(recurrenceSummary({
        // 2026-07-27은 월요일
        recurrence: { kind: 'weekly', weekday: 1, hour: 20, minute: 0 },
        firstStartsAt: FIRST,
        recurrenceEndsAt: FIRST + 3 * WEEK,
      })).toMatchObject({
        totalOccurrences: 4,
        lastStartsAt: FIRST + 3 * WEEK,
      });
    });

    it('aligns a first start that misses the recurrence slot', () => {
      const summary = recurrenceSummary({
        recurrence: { kind: 'daily', hour: 21, minute: 30 },
        firstStartsAt: FIRST,
        recurrenceEndsAt: FIRST + DAY,
      });
      expect(summary?.previewStarts[0]).toBe(FIRST + 90 * MINUTE);
      expect(summary?.totalOccurrences).toBe(1);
    });

    it('counts a window that ends before the first start as empty', () => {
      expect(recurrenceSummary({
        recurrence: { kind: 'hourly', minute: 0 },
        firstStartsAt: FIRST,
        recurrenceEndsAt: FIRST - HOUR,
      })).toMatchObject({ totalOccurrences: 0, lastStartsAt: null });
    });

    it('returns null without a recurrence', () => {
      expect(recurrenceSummary({
        recurrence: null,
        firstStartsAt: FIRST,
        recurrenceEndsAt: FIRST + HOUR,
      })).toBeNull();
    });
  });

  describe('recurrenceEndError', () => {
    it('requires an end only when a recurrence is selected', () => {
      expect(recurrenceEndError(null, FIRST, null)).toBeNull();
      expect(recurrenceEndError(
        { kind: 'daily', hour: 20, minute: 0 },
        FIRST,
        null,
      )).not.toBeNull();
    });

    it('rejects an end before the first start', () => {
      expect(recurrenceEndError(
        { kind: 'daily', hour: 20, minute: 0 },
        FIRST,
        FIRST - 1,
      )).not.toBeNull();
      expect(recurrenceEndError(
        { kind: 'daily', hour: 20, minute: 0 },
        FIRST,
        FIRST,
      )).toBeNull();
    });
  });

  describe('leadTimeExample', () => {
    it('formats the approved KST example', () => {
      const example = leadTimeExample(FIRST, 60 * MINUTE, 20 * MINUTE);
      expect(example).toMatchObject({
        startsAtLabel: '20:00',
        visibleAtLabel: '19:00',
        registrationOpensAtLabel: '19:40',
      });
      expect(example.sentence).toContain('19:00');
      expect(example.sentence).toContain('19:40');
      expect(example.sentence).toContain('20:00');
    });

    it('crosses midnight without losing the KST wall clock', () => {
      const midnight = Date.parse('2026-07-28T00:30:00+09:00');
      expect(leadTimeExample(midnight, 60 * MINUTE, 20 * MINUTE))
        .toMatchObject({
          startsAtLabel: '00:30',
          visibleAtLabel: '23:30',
          registrationOpensAtLabel: '00:10',
        });
    });
  });
});
