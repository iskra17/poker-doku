import { RIVER_RANGE_TEMPLATES } from './templates/river-range';
/**
 * 드릴 생성기·채점기 — 스토리 코디네이터(Phase 1.3)와 데일리 수련의 단일 진입점.
 *
 * 계약(기획 A7 ⓪):
 * - **결정론**: 같은 `(templateId, seed, ctx)`면 항상 deep-equal한 인스턴스가 나온다.
 *   서버는 채점할 때 같은 seed로 다시 생성하므로, 이 성질이 깨지면 정답이 흔들린다.
 * - **모호 문항 리롤**: 정답이 유일하지 않거나(동점 쇼다운) 경계(백분위 임계 ±3%p)거나
 *   아우츠가 0이면 템플릿이 `null`을 돌려주고, seed+1 … +32로 다시 시도한다.
 *   32번을 넘기면 `DrillGenerationError` — 조용히 이상한 문제를 내보내지 않는다.
 * - **인스턴스에 기록되는 seed는 "호출 seed"**다(리롤로 채택된 내부 seed가 아니다).
 *   리롤 절차 자체가 결정론이므로 호출 seed만 있으면 같은 문제가 복원된다.
 * - 무작위는 주입된 `mulberry32`만 쓴다 — `Math.random` 금지(테스트가 spy로 감시).
 */
import { formatCard } from '@/lib/poker/card-notation';
import { mulberry32 } from '@/lib/poker/seeded-rng';
import type { Card } from '@/lib/poker/types';
import type { StoryTeacherId } from '../types';
import { buildExplanation, fillFacts } from './explain';
import { AUTHORED_DRILL_TEMPLATES } from './templates/authored';
import { BREAKEVEN_TEMPLATES } from './templates/breakeven';
import { COMBO_TEMPLATES } from './templates/combos';
import { HAND_READING_TEMPLATES } from './templates/hand-reading';
import { NUTS_TEMPLATES } from './templates/nuts';
import { CALL_DECISION_TEMPLATES } from './templates/call-decision';
import { EQUITY_TEMPLATES } from './templates/equity';
import { HAND_RANKING_TEMPLATES } from './templates/hand-ranking';
import { OPPONENT_TYPE_TEMPLATES } from './templates/opponent-type';
import { OUTS_TEMPLATES } from './templates/outs';
import { POSITION_TEMPLATES } from './templates/position';
import { POT_ODDS_TEMPLATES } from './templates/pot-odds';
import { RANGE_TEMPLATES } from './templates/range';
import { SIZING_TEMPLATES } from './templates/sizing';
import type { DrillBuilder, DrillDraft, DrillFacts, GeneratedDrillDefinition } from './templates/kit';
import type {
  DrillAnswer,
  DrillAnswerSpec,
  DrillInstance,
  DrillSituation,
  DrillTemplate,
  DrillVillain,
} from './types';

export type { DrillBuilder, DrillDraft, DrillFacts, GeneratedDrillDefinition };

/** 시드 리롤 상한 (기획 A7 ⓪). 초과하면 생성 실패로 올린다. */
export const DRILL_REROLL_LIMIT = 32;
/** 문항 기본 블라인드 — 상황 카드의 칩 금액이 여기에 비례한다. */
export const DEFAULT_DRILL_BIG_BLIND = 20;

export interface DrillGenerationContext {
  teacher: StoryTeacherId;
  /** 기본 20. 양의 정수가 아니면 기본값으로 되돌린다. */
  bigBlind?: number;
}

export class DrillGenerationError extends Error {
  readonly templateId: string;

  constructor(templateId: string, message: string) {
    super(message);
    this.name = 'DrillGenerationError';
    this.templateId = templateId;
  }
}

// ---------------------------------------------------------------------------
// 레지스트리

const GENERATED_DEFINITIONS: readonly GeneratedDrillDefinition[] = [
  ...HAND_RANKING_TEMPLATES,
  ...POSITION_TEMPLATES,
  ...RANGE_TEMPLATES,
  ...OUTS_TEMPLATES,
  ...POT_ODDS_TEMPLATES,
  ...EQUITY_TEMPLATES,
  ...CALL_DECISION_TEMPLATES,
  ...RIVER_RANGE_TEMPLATES,
  // 2막 (Ch4~6): 손익분기·사이징·상대 유형
  ...BREAKEVEN_TEMPLATES,
  ...SIZING_TEMPLATES,
  ...OPPONENT_TYPE_TEMPLATES,
  ...COMBO_TEMPLATES,
  ...HAND_READING_TEMPLATES,
  ...NUTS_TEMPLATES,
];

const TEMPLATE_BY_ID = new Map<string, DrillTemplate>();
const DEFINITION_BY_ID = new Map<string, GeneratedDrillDefinition>();

function register(template: DrillTemplate): void {
  // 챕터 데이터가 templateId로 문항을 지목하므로 중복 id는 조용히 넘기면 안 된다.
  if (TEMPLATE_BY_ID.has(template.id)) {
    throw new Error(`duplicate drill template id: ${template.id}`);
  }
  TEMPLATE_BY_ID.set(template.id, template);
}

for (const definition of GENERATED_DEFINITIONS) {
  register(definition.template);
  DEFINITION_BY_ID.set(definition.template.id, definition);
}
for (const template of AUTHORED_DRILL_TEMPLATES) {
  register(template);
}

/** 생성 템플릿 정의(템플릿 + 빌더) — 리롤 통계·회귀 테스트용. 운영 경로는 `generateDrill`. */
export const GENERATED_DRILL_DEFINITIONS: readonly GeneratedDrillDefinition[] = GENERATED_DEFINITIONS;

export const DRILL_TEMPLATES: readonly DrillTemplate[] = [
  ...GENERATED_DEFINITIONS.map(definition => definition.template),
  ...AUTHORED_DRILL_TEMPLATES,
];

export const DRILL_TEMPLATE_IDS: ReadonlySet<string> = new Set(DRILL_TEMPLATES.map(template => template.id));

export function getDrillTemplate(id: string): DrillTemplate | undefined {
  return TEMPLATE_BY_ID.get(id);
}

// ---------------------------------------------------------------------------
// 복제 (인스턴스는 호출자에게 넘어간 뒤 변형될 수 있으므로 항상 새 객체로)

function cloneCards(cards: readonly Card[]): Card[] {
  return cards.map(card => ({ ...card }));
}

function cloneVillain(villain: DrillVillain): DrillVillain {
  const out: DrillVillain = {
    seatIndex: villain.seatIndex,
    characterId: villain.characterId,
    position: villain.position,
    stackChips: villain.stackChips,
  };
  if (villain.rangeTag !== undefined) out.rangeTag = villain.rangeTag;
  if (villain.range !== undefined) out.range = villain.range;
  if (villain.holeCards) out.holeCards = cloneCards(villain.holeCards);
  return out;
}

function cloneSituation(situation: DrillSituation): DrillSituation {
  const out: DrillSituation = {
    hero: cloneCards(situation.hero),
    board: cloneCards(situation.board),
    potChips: situation.potChips,
    toCallChips: situation.toCallChips,
    bigBlind: situation.bigBlind,
    heroStackChips: situation.heroStackChips,
    heroPosition: situation.heroPosition,
    street: situation.street,
    villains: situation.villains.map(cloneVillain),
  };
  if (situation.note !== undefined) out.note = situation.note;
  return out;
}

function cloneAnswerSpec(spec: DrillAnswerSpec): DrillAnswerSpec {
  switch (spec.kind) {
    case 'multiple-choice':
      return { kind: 'multiple-choice', options: [...spec.options], correctIndex: spec.correctIndex };
    case 'numeric':
      return { ...spec };
    case 'card-pick':
      return {
        kind: 'card-pick',
        candidates: cloneCards(spec.candidates),
        correct: cloneCards(spec.correct),
        pickCount: spec.pickCount,
      };
    case 'action-pick':
      return spec.sizingBB
        ? { kind: 'action-pick', options: [...spec.options], correct: [...spec.correct], sizingBB: { ...spec.sizingBB } }
        : { kind: 'action-pick', options: [...spec.options], correct: [...spec.correct] };
    case 'multi-select':
      return { kind: 'multi-select', options: [...spec.options], correctIndices: [...spec.correctIndices] };
  }
}

// ---------------------------------------------------------------------------
// 생성

function normalizeBigBlind(bigBlind: number | undefined): number {
  return typeof bigBlind === 'number' && Number.isInteger(bigBlind) && bigBlind > 0
    ? bigBlind
    : DEFAULT_DRILL_BIG_BLIND;
}

function finalize(
  template: DrillTemplate,
  seed: number,
  teacher: StoryTeacherId,
  draft: DrillDraft,
): DrillInstance {
  const facts: DrillFacts = { ...draft.facts };
  const hintSource = template.hints[0];
  return {
    templateId: template.id,
    seed,
    category: template.category,
    situation: cloneSituation(draft.situation),
    question: draft.question,
    answerSpec: cloneAnswerSpec(draft.answerSpec),
    hint: hintSource ? fillFacts(hintSource, facts) : null,
    explanation: buildExplanation(template.id, facts, teacher),
  };
}

/**
 * 레지스트리를 거치지 않고 정의 하나로 생성한다 — 리롤 절차는 `generateDrill`과 동일.
 * (프로토타입·테스트용. 운영 경로는 항상 `generateDrill`을 쓴다.)
 */
export function generateFromDefinition(
  definition: GeneratedDrillDefinition,
  seed: number,
  ctx: DrillGenerationContext,
): DrillInstance {
  const { template, build } = definition;
  const bigBlind = normalizeBigBlind(ctx.bigBlind);
  const params = template.source.kind === 'generated' ? template.source.params : {};

  for (let attempt = 0; attempt <= DRILL_REROLL_LIMIT; attempt++) {
    const attemptSeed = (seed + attempt) >>> 0;
    const draft = build({ rng: mulberry32(attemptSeed), teacher: ctx.teacher, bigBlind, params });
    if (draft) return finalize(template, seed, ctx.teacher, draft);
  }
  throw new DrillGenerationError(
    template.id,
    `drill generation gave up after ${DRILL_REROLL_LIMIT + 1} attempts (seed ${seed})`,
  );
}

/**
 * 수기 문항 인스턴스화 — 시드를 쓰지 않고 저장된 인스턴스를 복제한다.
 * (`generateDrill`이 authored 템플릿에 대해 호출하는 경로. 레지스트리 밖 템플릿 검증용으로도 쓴다.)
 */
export function instantiateAuthoredDrill(
  template: DrillTemplate,
  seed: number,
  ctx: DrillGenerationContext,
): DrillInstance {
  if (template.source.kind !== 'authored') {
    throw new DrillGenerationError(template.id, `template ${template.id} is not authored`);
  }
  // 저장된 인스턴스를 복제하고 화자만 실행 시점 교사로 바꾼다 (카테고리는 템플릿이 정본).
  const base = template.source.instance;
  return {
    templateId: template.id,
    seed,
    category: template.category,
    situation: cloneSituation(base.situation),
    question: base.question,
    answerSpec: cloneAnswerSpec(base.answerSpec),
    hint: base.hint,
    explanation: {
      text: base.explanation.text,
      speaker: ctx.teacher,
      facts: { ...base.explanation.facts },
    },
  };
}

export function generateDrill(
  templateId: string,
  seed: number,
  ctx: DrillGenerationContext,
): DrillInstance {
  const template = TEMPLATE_BY_ID.get(templateId);
  if (!template) throw new DrillGenerationError(templateId, `unknown drill template: ${templateId}`);
  if (template.source.kind === 'authored') return instantiateAuthoredDrill(template, seed, ctx);

  const definition = DEFINITION_BY_ID.get(templateId);
  if (!definition) {
    throw new DrillGenerationError(templateId, `generated template has no builder: ${templateId}`);
  }
  return generateFromDefinition(definition, seed, ctx);
}

// ---------------------------------------------------------------------------
// 채점

function sameCardSet(a: readonly Card[], b: readonly Card[]): boolean {
  if (a.length !== b.length) return false;
  const left = new Set(a.map(formatCard));
  const right = new Set(b.map(formatCard));
  if (left.size !== a.length || right.size !== b.length) return false;
  for (const key of left) {
    if (!right.has(key)) return false;
  }
  return true;
}

function sameIndexSet(a: readonly number[], b: readonly number[]): boolean {
  const left = new Set(a);
  const right = new Set(b);
  if (left.size !== right.size) return false;
  for (const value of left) {
    if (!right.has(value)) return false;
  }
  return true;
}

export function gradeDrill(instance: DrillInstance, answer: DrillAnswer): boolean {
  const spec = instance.answerSpec;
  switch (spec.kind) {
    case 'multiple-choice':
      return answer.kind === 'multiple-choice' && answer.index === spec.correctIndex;

    case 'numeric':
      return (
        answer.kind === 'numeric' &&
        Number.isFinite(answer.value) &&
        Math.abs(answer.value - spec.correct) <= spec.tolerance
      );

    case 'card-pick':
      return answer.kind === 'card-pick' && sameCardSet(answer.cards, spec.correct);

    case 'action-pick': {
      if (answer.kind !== 'action-pick') return false;
      if (!spec.correct.includes(answer.action)) return false;
      if (!spec.sizingBB) return true;
      const sizing = answer.sizingBB;
      return (
        typeof sizing === 'number' &&
        Number.isFinite(sizing) &&
        sizing >= spec.sizingBB.min &&
        sizing <= spec.sizingBB.max
      );
    }

    case 'multi-select':
      return answer.kind === 'multi-select' && sameIndexSet(answer.indices, spec.correctIndices);
  }
}
