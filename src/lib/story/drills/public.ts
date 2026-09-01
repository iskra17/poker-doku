/**
 * 드릴 인스턴스의 클라이언트 투영 — 정답·해설·힌트 본문을 구조적으로 제거한다.
 * `DrillInstancePublic` 타입만으로는 런타임 누출을 막지 못하므로 이 함수가 유일한 변환 경로다
 * (public.test.ts가 'correct' 계열 키가 직렬화 결과에 없음을 검증한다).
 */
import type { DrillAnswerSpec, DrillAnswerSpecPublic, DrillInstance, DrillInstancePublic } from './types';

export function toPublicAnswerSpec(spec: DrillAnswerSpec): DrillAnswerSpecPublic {
  switch (spec.kind) {
    case 'multiple-choice':
      return { kind: 'multiple-choice', options: [...spec.options] };
    case 'numeric':
      return { kind: 'numeric', unit: spec.unit, min: spec.min, max: spec.max };
    case 'card-pick':
      return { kind: 'card-pick', candidates: spec.candidates.map(card => ({ ...card })), pickCount: spec.pickCount };
    case 'action-pick':
      return spec.sizingBB
        ? { kind: 'action-pick', options: [...spec.options], sizingBB: { ...spec.sizingBB } }
        : { kind: 'action-pick', options: [...spec.options] };
    case 'multi-select':
      return { kind: 'multi-select', options: [...spec.options] };
  }
}

export function toPublicDrillInstance(instance: DrillInstance): DrillInstancePublic {
  return {
    templateId: instance.templateId,
    seed: instance.seed,
    category: instance.category,
    situation: {
      ...instance.situation,
      hero: instance.situation.hero.map(card => ({ ...card })),
      board: instance.situation.board.map(card => ({ ...card })),
      villains: instance.situation.villains.map(villain => ({
        ...villain,
        holeCards: villain.holeCards?.map(card => ({ ...card })),
      })),
    },
    question: instance.question,
    answerSpec: toPublicAnswerSpec(instance.answerSpec),
    hasHint: instance.hint !== null && instance.hint.length > 0,
  };
}
