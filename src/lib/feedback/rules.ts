export const FEEDBACK_CATEGORIES = [
  { id: 'bug', label: '버그 신고' },
  { id: 'idea', label: '개선 제안' },
  { id: 'other', label: '기타 문의' },
] as const;

export type FeedbackCategory = typeof FEEDBACK_CATEGORIES[number]['id'];

export const FEEDBACK_MESSAGE_MIN = 5;
export const FEEDBACK_MESSAGE_MAX = 500;

export function isFeedbackCategory(value: unknown): value is FeedbackCategory {
  return FEEDBACK_CATEGORIES.some(category => category.id === value);
}

/** 서버 수용 기준과 동일한 정규화 — 클라 검증과 서버 검증의 단일 소스. */
export function normalizeFeedbackMessage(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (
    trimmed.length < FEEDBACK_MESSAGE_MIN
    || trimmed.length > FEEDBACK_MESSAGE_MAX
  ) return null;
  return trimmed;
}
