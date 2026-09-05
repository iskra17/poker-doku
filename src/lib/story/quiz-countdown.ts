import type { HandReadQuizView } from './views';

export interface QuizCountdown {
  runId: string;
  quizId: string;
  sampledAt: number;
  remainingMs: number;
  receivedAt: number;
}

/** Display only. Answer acceptance and expiry always belong to the server. */
export function quizRemainingMs(clock: QuizCountdown | null, monotonicNow: number): number {
  return clock ? Math.max(0, Math.min(30_000, clock.remainingMs - Math.max(0, monotonicNow - clock.receivedAt))) : 0;
}

export function receiveQuizCountdown(
  previous: QuizCountdown | null,
  runId: string,
  sample: Pick<HandReadQuizView, 'quizId' | 'sampledAt' | 'remainingMs'> | null,
  monotonicNow: number,
): QuizCountdown | null {
  if (!sample) return null;
  const sameQuestion = previous?.runId === runId && previous.quizId === sample.quizId;
  if (sameQuestion && previous.sampledAt >= sample.sampledAt) return previous;
  const remainingMs = Math.max(0, Math.min(30_000, sample.remainingMs,
    sameQuestion ? quizRemainingMs(previous, monotonicNow) : 30_000));
  return { runId, quizId: sample.quizId, sampledAt: sample.sampledAt, remainingMs, receivedAt: monotonicNow };
}
