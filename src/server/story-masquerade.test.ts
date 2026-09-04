import { describe, expect, it } from 'vitest';
import { MasqueradeQuiz } from './story-masquerade';

describe('masked quiz answers remain server-owned', () => {
  const identities = ['mochi', 'choco', 'gumi', 'chloe'].map((personalityId, i) => ({ seatIndex: i + 1, personalityId }));
  it('locks all four answers before revealing feedback; duplicate answers preserve first receipt', () => {
    const quiz = new MasqueradeQuiz(identities, () => 'q-' + Math.random());
    for (let i = 0; i < 4; i++) {
      const question = quiz.issue(1000 + i)!;
      expect(Object.keys(question).sort()).toEqual(['expiresAt','number','options','prompt','quizId','required','seatIndex'].sort());
      expect(quiz.feedback()).toBeNull();
      const receipt = quiz.answer(question.quizId, i, 1001 + i);
      expect(receipt).toEqual({ quizId: question.quizId, accepted: true });
      expect(quiz.answer(question.quizId, (i + 1) % 4, 1002 + i)).toEqual(receipt);
    }
    expect(quiz.counts()).toEqual({ issued: 4, answered: 4, correct: 4, required: 4 });
    expect(quiz.feedback()).toHaveLength(4);
    expect(quiz.issue(9999)).toBeNull();
  });
  it('deadline wins over a late answer and does not issue another question itself', () => {
    const quiz = new MasqueradeQuiz(identities, () => 'opaque');
    const question = quiz.issue(100)!;
    expect(question.expiresAt).toBe(30100);
    quiz.answer(question.quizId, 0, 30100);
    expect(quiz.counts()).toEqual({ issued: 1, answered: 1, correct: 0, required: 4 });
    expect(quiz.pending()).toBeNull();
    expect(quiz.feedback()).toBeNull();
    expect(quiz.answer('unknown', 0, 30200)).toBeNull();
  });
});
