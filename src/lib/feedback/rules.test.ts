import { describe, expect, it } from 'vitest';
import {
  FEEDBACK_CATEGORIES,
  FEEDBACK_MESSAGE_MAX,
  isFeedbackCategory,
  normalizeFeedbackMessage,
} from './rules';

describe('feedback rules', () => {
  it('accepts only the three known categories', () => {
    expect(FEEDBACK_CATEGORIES.map(category => category.id))
      .toEqual(['bug', 'idea', 'other']);
    expect(isFeedbackCategory('bug')).toBe(true);
    expect(isFeedbackCategory('spam')).toBe(false);
    expect(isFeedbackCategory(undefined)).toBe(false);
  });

  it('trims and bounds the message between 5 and 500 characters', () => {
    expect(normalizeFeedbackMessage('  다섯글자요  ')).toBe('다섯글자요');
    expect(normalizeFeedbackMessage('네자임')).toBeNull();
    expect(normalizeFeedbackMessage('   ')).toBeNull();
    expect(normalizeFeedbackMessage(42)).toBeNull();
    expect(normalizeFeedbackMessage('a'.repeat(FEEDBACK_MESSAGE_MAX))).toHaveLength(500);
    expect(normalizeFeedbackMessage('a'.repeat(FEEDBACK_MESSAGE_MAX + 1))).toBeNull();
  });
});
