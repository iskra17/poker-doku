import { afterEach, expect, it, vi } from 'vitest';
import { quizRemainingMs, receiveQuizCountdown } from './quiz-countdown';

const sample = { quizId: 'q1', sampledAt: 1_000_000, remainingMs: 30_000 };
afterEach(() => vi.restoreAllMocks());

it.each([-300_000, 300_000])('ignores a device wall clock skew of %d ms', skew => {
  vi.spyOn(Date, 'now').mockReturnValue(sample.sampledAt + skew);
  const clock = receiveQuizCountdown(null, 'run1', sample, 100);
  expect(quizRemainingMs(clock, 5_100)).toBe(25_000);
  vi.mocked(Date.now).mockReturnValue(sample.sampledAt - skew);
  expect(quizRemainingMs(clock, 10_100)).toBe(20_000);
  expect(quizRemainingMs(clock, 40_100)).toBe(0);
});

it('never restarts on duplicate/stale samples or delayed reconnect updates', () => {
  const clock = receiveQuizCountdown(null, 'run1', sample, 100);
  expect(receiveQuizCountdown(clock, 'run1', sample, 5_100)).toBe(clock);
  const newer = receiveQuizCountdown(clock, 'run1', { ...sample, sampledAt: 1_005_000, remainingMs: 25_000 }, 6_100);
  expect(quizRemainingMs(newer, 6_100)).toBe(24_000);
  expect(receiveQuizCountdown(newer, 'run1', sample, 7_100)).toBe(newer);
  expect(quizRemainingMs(newer, 31_100)).toBe(0);
});

it('reload uses the latest server remainder; a new question/run gets its own sample', () => {
  const reload = receiveQuizCountdown(null, 'run1', { ...sample, sampledAt: 1_020_000, remainingMs: 10_000 }, 20);
  expect(quizRemainingMs(reload, 20)).toBe(10_000);
  const next = receiveQuizCountdown(reload, 'run1', { ...sample, quizId: 'q2' }, 500);
  expect(quizRemainingMs(next, 500)).toBe(30_000);
  expect(receiveQuizCountdown(next, 'run1', null, 500)).toBeNull();
  expect(quizRemainingMs(receiveQuizCountdown(reload, 'run2', sample, 500), 500)).toBe(30_000);
});
