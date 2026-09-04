/**
 * 스토리 모드 소켓 payload 런타임 파서 — `ClientToServerEvents` 타입은 신뢰 경계가 아니므로
 * 모든 외부 입력을 여기서 정규화한 뒤에만 코디네이터에 넘긴다 (socket-payload.ts와 같은 규약:
 * 허용 키만, 문자열은 제어문자 제거·길이 상한, 숫자는 유한 정수, 카드는 표기 파서 화이트리스트).
 */
import { tryParseCards } from '../lib/poker/card-notation';
import type { ActionType } from '../lib/poker/types';
import type { DrillAnswer } from '../lib/story/drills/types';
import type {
  AbandonStoryRequest,
  StartStoryChapterRequest,
  StoryRunMode,
  StoryAdvanceRequest,
  StoryAdvanceTarget,
  StoryChoiceRequest,
  StoryDrillRequest,
  StoryQuizRequest,
} from '../lib/story/views';
import { isRecord, type ParseResult } from './socket-payload';

const INVALID_MESSAGE = '요청 형식이 올바르지 않아요.';
const CONTROL_CHARS = /[\u0000-\u001f\u007f]/g;
const ID_PATTERN = /^[A-Za-z0-9:_\-.]+$/;
const ACTIONS: readonly ActionType[] = ['fold', 'check', 'call', 'raise', 'all-in'];
const ADVANCE_TARGETS: readonly StoryAdvanceTarget[] = ['next', 'skip', 'resume'];
const ANSWER_KINDS = ['multiple-choice', 'numeric', 'card-pick', 'action-pick', 'multi-select'] as const;

export const STORY_ID_MAX = 64;
const MAX_INDEX = 10_000;
const MAX_ELAPSED_MS = 60 * 60_000;
const MAX_PICKS = 8;

function fail<T>(): ParseResult<T> {
  return { ok: false, message: INVALID_MESSAGE };
}

/** 식별자: 제어문자 제거 후 [A-Za-z0-9:_-.] 1..max */
function idText(value: unknown, max = STORY_ID_MAX): string | null {
  if (typeof value !== 'string') return null;
  const cleaned = value.replace(CONTROL_CHARS, '').trim();
  if (!cleaned || cleaned.length > max || !ID_PATTERN.test(cleaned)) return null;
  return cleaned;
}

function boundedInt(value: unknown, min: number, max: number): number | null {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max) return null;
  return value;
}

function finiteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function memberOf<T extends string>(value: unknown, values: readonly T[]): value is T {
  return typeof value === 'string' && values.includes(value as T);
}

function hasOnlyKeys(value: Record<string, unknown>, allowed: readonly string[]): boolean {
  return Object.keys(value).every(key => allowed.includes(key));
}

const RUN_MODES: readonly StoryRunMode[] = ['full', 'exam'];

export function parseStartStoryChapterRequest(input: unknown): ParseResult<StartStoryChapterRequest> {
  if (!isRecord(input) || !hasOnlyKeys(input, ['chapterId', 'mode'])) return fail();
  const chapterId = idText(input.chapterId);
  if (!chapterId) return fail();
  if (input.mode === undefined) return { ok: true, value: { chapterId } };
  if (!memberOf(input.mode, RUN_MODES)) return fail();
  return { ok: true, value: { chapterId, mode: input.mode } };
}

export function parseStoryAdvanceRequest(input: unknown): ParseResult<StoryAdvanceRequest> {
  if (!isRecord(input) || !hasOnlyKeys(input, ['runId', 'expectedStepIndex', 'target'])) return fail();
  const runId = idText(input.runId);
  const expectedStepIndex = boundedInt(input.expectedStepIndex, 0, MAX_INDEX);
  const target = input.target === undefined ? 'next' : input.target;
  if (!runId || expectedStepIndex === null || !memberOf(target, ADVANCE_TARGETS)) return fail();
  return { ok: true, value: { runId, expectedStepIndex, target } };
}

export function parseStoryChoiceRequest(input: unknown): ParseResult<StoryChoiceRequest> {
  if (!isRecord(input) || !hasOnlyKeys(input, ['runId', 'expectedStepIndex', 'choiceId', 'optionId'])) return fail();
  const runId = idText(input.runId);
  const expectedStepIndex = boundedInt(input.expectedStepIndex, 0, MAX_INDEX);
  const choiceId = idText(input.choiceId);
  const optionId = idText(input.optionId);
  if (!runId || expectedStepIndex === null || !choiceId || !optionId) return fail();
  return { ok: true, value: { runId, expectedStepIndex, choiceId, optionId } };
}

/** 드릴 답 — kind별 허용 키만 받고 카드는 'As' 표기 화이트리스트로만 통과 */
export function parseDrillAnswer(input: unknown): DrillAnswer | null {
  if (!isRecord(input) || !memberOf(input.kind, ANSWER_KINDS)) return null;
  switch (input.kind) {
    case 'multiple-choice': {
      if (!hasOnlyKeys(input, ['kind', 'index'])) return null;
      const index = boundedInt(input.index, 0, 15);
      return index === null ? null : { kind: 'multiple-choice', index };
    }
    case 'numeric': {
      if (!hasOnlyKeys(input, ['kind', 'value'])) return null;
      const value = finiteNumber(input.value);
      if (value === null || Math.abs(value) > 1_000_000_000) return null;
      return { kind: 'numeric', value };
    }
    case 'card-pick': {
      if (!hasOnlyKeys(input, ['kind', 'cards'])) return null;
      if (!Array.isArray(input.cards) || input.cards.length === 0 || input.cards.length > MAX_PICKS) return null;
      if (!input.cards.every(code => typeof code === 'string')) return null;
      const cards = tryParseCards((input.cards as string[]).join(' '));
      if (!cards || cards.length !== input.cards.length) return null;
      return { kind: 'card-pick', cards };
    }
    case 'action-pick': {
      if (!hasOnlyKeys(input, ['kind', 'action', 'sizingBB'])) return null;
      if (!memberOf(input.action, ACTIONS)) return null;
      if (input.sizingBB === undefined) return { kind: 'action-pick', action: input.action };
      const sizingBB = finiteNumber(input.sizingBB);
      if (sizingBB === null || sizingBB < 0 || sizingBB > 10_000) return null;
      return { kind: 'action-pick', action: input.action, sizingBB };
    }
    case 'multi-select': {
      if (!hasOnlyKeys(input, ['kind', 'indices'])) return null;
      if (!Array.isArray(input.indices) || input.indices.length > 16) return null;
      const indices: number[] = [];
      for (const raw of input.indices) {
        const index = boundedInt(raw, 0, 15);
        if (index === null || indices.includes(index)) return null;
        indices.push(index);
      }
      return { kind: 'multi-select', indices };
    }
  }
}

export function parseStoryDrillRequest(input: unknown): ParseResult<StoryDrillRequest> {
  if (!isRecord(input)) return fail();
  const runId = idText(input.runId);
  const setId = idText(input.setId);
  const index = boundedInt(input.index, 0, MAX_INDEX);
  if (!runId || !setId || index === null) return fail();

  if (input.action === 'hint' || input.action === 'retry' || input.action === 'skip-retry') {
    if (!hasOnlyKeys(input, ['runId', 'setId', 'index', 'action'])) return fail();
    return { ok: true, value: { runId, setId, index, action: input.action } };
  }
  if (input.action !== 'answer') return fail();
  if (!hasOnlyKeys(input, ['runId', 'setId', 'index', 'action', 'answer', 'elapsedMs'])) return fail();
  const answer = parseDrillAnswer(input.answer);
  const elapsedMs = input.elapsedMs === undefined ? 0 : boundedInt(input.elapsedMs, 0, MAX_ELAPSED_MS);
  if (!answer || elapsedMs === null) return fail();
  return { ok: true, value: { runId, setId, index, action: 'answer', answer, elapsedMs } };
}

export function parseStoryQuizRequest(input: unknown): ParseResult<StoryQuizRequest> {
  if (!isRecord(input) || !hasOnlyKeys(input, ['runId', 'quizId', 'optionIndex'])) return fail();
  const runId = idText(input.runId);
  const quizId = idText(input.quizId);
  const optionIndex = boundedInt(input.optionIndex, 0, 3);
  if (!runId || !quizId || optionIndex === null) return fail();
  return { ok: true, value: { runId, quizId, optionIndex } };
}

export function parseAbandonStoryRequest(input: unknown): ParseResult<AbandonStoryRequest> {
  if (!isRecord(input) || !hasOnlyKeys(input, ['runId'])) return fail();
  const runId = idText(input.runId);
  if (!runId) return fail();
  return { ok: true, value: { runId } };
}

export function parseRetryStorySparringRequest(input: unknown): ParseResult<{ failedRunId: string }> {
  if (!isRecord(input) || !hasOnlyKeys(input, ['failedRunId'])) return fail();
  const failedRunId = idText(input.failedRunId);
  return failedRunId ? { ok: true, value: { failedRunId } } : fail();
}
