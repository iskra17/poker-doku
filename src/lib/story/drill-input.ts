/**
 * 드릴 입력 보조 — 클라이언트 전용 순수 함수.
 * - 정답 채점은 서버(generator.gradeDrill)가 권위다. 여기의 `gradeLocally`는 점수 없는 '함께 풀기'
 *   단계(레슨 guided — 정답이 클라 챕터 데이터에 있음)에서만 쓴다.
 * - 입력 값 정규화(숫자 클램프·카드 집합 정리)는 서버 파서가 거절하지 않도록 사전 정리한다.
 */
import { formatCard, sameCard } from '@/lib/poker/card-notation';
import type { ActionType, Card } from '@/lib/poker/types';
import type { DrillAnswer, DrillAnswerSpec, DrillAnswerSpecPublic } from './drills/types';

export function isAnswerComplete(spec: DrillAnswerSpecPublic | DrillAnswerSpec, answer: DrillAnswer | null): boolean {
  if (!answer || answer.kind !== spec.kind) return false;
  switch (answer.kind) {
    case 'multiple-choice':
      return answer.index >= 0 && answer.index < (spec as { options: string[] }).options.length;
    case 'numeric':
      return Number.isFinite(answer.value);
    case 'card-pick':
      return answer.cards.length === (spec as { pickCount: number }).pickCount;
    case 'action-pick':
      return true;
    case 'multi-select':
      return answer.indices.length > 0;
  }
}

export function clampNumeric(value: number, spec: { min: number; max: number }): number {
  if (!Number.isFinite(value)) return spec.min;
  return Math.min(spec.max, Math.max(spec.min, value));
}

/** 카드 토글 — 이미 고른 카드면 제외, pickCount를 넘으면 가장 오래된 것을 밀어낸다 */
export function toggleCard(selected: readonly Card[], card: Card, pickCount: number): Card[] {
  if (selected.some(candidate => sameCard(candidate, card))) {
    return selected.filter(candidate => !sameCard(candidate, card));
  }
  const next = [...selected, card];
  return next.length > pickCount ? next.slice(next.length - pickCount) : next;
}

export function toggleIndex(selected: readonly number[], index: number): number[] {
  return selected.includes(index) ? selected.filter(value => value !== index) : [...selected, index].sort((a, b) => a - b);
}

/** '함께 풀기' 전용 로컬 채점 — generator.gradeDrill과 같은 규칙 */
export function gradeLocally(spec: DrillAnswerSpec, answer: DrillAnswer): boolean {
  if (answer.kind !== spec.kind) return false;
  switch (spec.kind) {
    case 'multiple-choice':
      return answer.kind === 'multiple-choice' && answer.index === spec.correctIndex;
    case 'numeric':
      return answer.kind === 'numeric' && Math.abs(answer.value - spec.correct) <= spec.tolerance;
    case 'card-pick': {
      if (answer.kind !== 'card-pick' || answer.cards.length !== spec.correct.length) return false;
      const want = new Set(spec.correct.map(formatCard));
      return answer.cards.every(card => want.has(formatCard(card)));
    }
    case 'action-pick': {
      if (answer.kind !== 'action-pick' || !spec.correct.includes(answer.action)) return false;
      if (!spec.sizingBB || answer.action === 'fold' || answer.action === 'check' || answer.action === 'call') return true;
      return answer.sizingBB !== undefined && answer.sizingBB >= spec.sizingBB.min && answer.sizingBB <= spec.sizingBB.max;
    }
    case 'multi-select': {
      if (answer.kind !== 'multi-select') return false;
      const want = [...spec.correctIndices].sort((a, b) => a - b);
      const got = [...answer.indices].sort((a, b) => a - b);
      return want.length === got.length && want.every((value, index) => value === got[index]);
    }
  }
}

/** 정답 사양을 사람이 읽는 문장으로 (결과 카드의 '정답' 줄) */
export function describeCorrectAnswer(spec: DrillAnswerSpec): string {
  switch (spec.kind) {
    case 'multiple-choice':
      return spec.options[spec.correctIndex] ?? '';
    case 'numeric':
      return spec.tolerance > 0 ? `${spec.correct}${spec.unit} (±${spec.tolerance})` : `${spec.correct}${spec.unit}`;
    case 'card-pick':
      return spec.correct.map(formatCard).join(' ');
    case 'action-pick': {
      const actions = spec.correct.map(actionLabel).join(' / ');
      return spec.sizingBB ? `${actions} (${spec.sizingBB.min}~${spec.sizingBB.max}BB)` : actions;
    }
    case 'multi-select':
      return spec.correctIndices.map(index => spec.options[index] ?? '').join(', ');
  }
}

export function actionLabel(action: ActionType): string {
  switch (action) {
    case 'fold': return '폴드';
    case 'check': return '체크';
    case 'call': return '콜';
    case 'raise': return '레이즈';
    case 'all-in': return '올인';
  }
}
