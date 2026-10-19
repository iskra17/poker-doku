import { describe, expect, it } from 'vitest';
import {
  parseAbandonStoryRequest,
  parseRetryStorySparringRequest,
  parseDrillAnswer,
  parseStartStoryChapterRequest,
  parseStoryAdvanceRequest,
  parseStoryChoiceRequest,
  parseStoryDrillRequest,
  parseStoryPlacementRequest,
  parseStoryQuizRequest,
  PLACEMENT_ANSWERS_MAX,
} from './story-payload';

const BAD_INPUTS = [null, undefined, [], 'bad', 17, () => undefined];

describe('story socket payload parsing', () => {
  it.each(BAD_INPUTS)('객체가 아니면 전부 거절한다: %j', input => {
    expect(parseStartStoryChapterRequest(input).ok).toBe(false);
    expect(parseStoryAdvanceRequest(input).ok).toBe(false);
    expect(parseStoryChoiceRequest(input).ok).toBe(false);
    expect(parseStoryDrillRequest(input).ok).toBe(false);
    expect(parseStoryQuizRequest(input).ok).toBe(false);
    expect(parseAbandonStoryRequest(input).ok).toBe(false);
    expect(parseDrillAnswer(input)).toBeNull();
  });

  it('start-story-chapter: 식별자 형식만 통과, 여분 키·제어문자·긴 id 거절', () => {
    expect(parseStartStoryChapterRequest({ chapterId: ' act1-ch01 ' })).toEqual({ ok: true, value: { chapterId: 'act1-ch01' } });
    expect(parseStartStoryChapterRequest({ chapterId: 'act1-ch01', extra: 1 }).ok).toBe(false);
    expect(parseStartStoryChapterRequest({ chapterId: 'act1 ch01' }).ok).toBe(false);
    expect(parseStartStoryChapterRequest({ chapterId: 'act1' + String.fromCharCode(0) + '-ch01' })).toEqual({ ok: true, value: { chapterId: 'act1-ch01' } });
    expect(parseStartStoryChapterRequest({ chapterId: 'x'.repeat(65) }).ok).toBe(false);
    expect(parseStartStoryChapterRequest({ chapterId: '' }).ok).toBe(false);
    expect(parseStartStoryChapterRequest({ chapterId: 12 }).ok).toBe(false);
    // mode는 선택 — 'full' | 'exam'만, 그 밖은 거절
    expect(parseStartStoryChapterRequest({ chapterId: 'act1-ch01', mode: 'exam' })).toEqual({ ok: true, value: { chapterId: 'act1-ch01', mode: 'exam' } });
    expect(parseStartStoryChapterRequest({ chapterId: 'act1-ch01', mode: 'full' })).toEqual({ ok: true, value: { chapterId: 'act1-ch01', mode: 'full' } });
    expect(parseStartStoryChapterRequest({ chapterId: 'act1-ch01', mode: 'fast' })).toEqual({ ok: true, value: { chapterId: 'act1-ch01', mode: 'fast' } });
    expect(parseStartStoryChapterRequest({ chapterId: 'act1-ch01', mode: 'cheat' }).ok).toBe(false);
    expect(parseStartStoryChapterRequest({ chapterId: 'act1-ch01', mode: 1 }).ok).toBe(false);
  });

  it('story-advance: target 기본값 next, 정수 stepIndex, 상한', () => {
    expect(parseStoryAdvanceRequest({ runId: 'run_1', expectedStepIndex: 3 })).toEqual({
      ok: true,
      value: { runId: 'run_1', expectedStepIndex: 3, target: 'next' },
    });
    expect(parseStoryAdvanceRequest({ runId: 'run_1', expectedStepIndex: 0, target: 'resume' }).ok).toBe(true);
    expect(parseStoryAdvanceRequest({ runId: 'run_1', expectedStepIndex: 0, target: 'exam' }).ok).toBe(true);
    expect(parseStoryAdvanceRequest({ runId: 'run_1', expectedStepIndex: 1.5 }).ok).toBe(false);
    expect(parseStoryAdvanceRequest({ runId: 'run_1', expectedStepIndex: -1 }).ok).toBe(false);
    expect(parseStoryAdvanceRequest({ runId: 'run_1', expectedStepIndex: 10_001 }).ok).toBe(false);
    expect(parseStoryAdvanceRequest({ runId: 'run_1', expectedStepIndex: 1, target: 'jump' }).ok).toBe(false);
    expect(parseStoryAdvanceRequest({ runId: 'run_1', expectedStepIndex: '1' }).ok).toBe(false);
  });

  it('story-choice: 네 필드 모두 식별자', () => {
    expect(parseStoryChoiceRequest({ runId: 'r', expectedStepIndex: 2, choiceId: 'c1', optionId: 'warm' })).toEqual({
      ok: true,
      value: { runId: 'r', expectedStepIndex: 2, choiceId: 'c1', optionId: 'warm' },
    });
    expect(parseStoryChoiceRequest({ runId: 'r', expectedStepIndex: 2, choiceId: 'c1' }).ok).toBe(false);
    expect(parseStoryChoiceRequest({ runId: 'r', expectedStepIndex: 2, choiceId: 'c1', optionId: 'a b' }).ok).toBe(false);
  });

  describe('parseDrillAnswer', () => {
    it('kind별 허용 키만 받는다', () => {
      expect(parseDrillAnswer({ kind: 'multiple-choice', index: 2 })).toEqual({ kind: 'multiple-choice', index: 2 });
      expect(parseDrillAnswer({ kind: 'multiple-choice', index: 2, value: 3 })).toBeNull();
      expect(parseDrillAnswer({ kind: 'multiple-choice', index: 16 })).toBeNull();
      expect(parseDrillAnswer({ kind: 'numeric', value: 25.5 })).toEqual({ kind: 'numeric', value: 25.5 });
      expect(parseDrillAnswer({ kind: 'numeric', value: Number.NaN })).toBeNull();
      expect(parseDrillAnswer({ kind: 'numeric', value: '25' })).toBeNull();
      expect(parseDrillAnswer({ kind: 'bogus', value: 1 })).toBeNull();
    });

    it('card-pick은 표기 화이트리스트를 통과한 카드 객체로 바꾼다', () => {
      expect(parseDrillAnswer({ kind: 'card-pick', cards: ['Ah', 'Th'] })).toEqual({
        kind: 'card-pick',
        cards: [{ rank: 'A', suit: 'hearts' }, { rank: '10', suit: 'hearts' }],
      });
      expect(parseDrillAnswer({ kind: 'card-pick', cards: ['Ah', 'Ah'] })).toBeNull();
      expect(parseDrillAnswer({ kind: 'card-pick', cards: ['Zz'] })).toBeNull();
      expect(parseDrillAnswer({ kind: 'card-pick', cards: [] })).toBeNull();
      expect(parseDrillAnswer({ kind: 'card-pick', cards: [{ rank: 'A', suit: 'hearts' }] })).toBeNull();
      expect(parseDrillAnswer({ kind: 'card-pick', cards: Array(9).fill('Ah') })).toBeNull();
      // 'As Kd' 한 토큰에 두 장을 숨겨도 개수 불일치로 거절
      expect(parseDrillAnswer({ kind: 'card-pick', cards: ['As Kd'] })).toBeNull();
    });

    it('action-pick과 multi-select', () => {
      expect(parseDrillAnswer({ kind: 'action-pick', action: 'raise', sizingBB: 2.5 })).toEqual({ kind: 'action-pick', action: 'raise', sizingBB: 2.5 });
      expect(parseDrillAnswer({ kind: 'action-pick', action: 'fold' })).toEqual({ kind: 'action-pick', action: 'fold' });
      expect(parseDrillAnswer({ kind: 'action-pick', action: 'bet' })).toBeNull();
      expect(parseDrillAnswer({ kind: 'action-pick', action: 'raise', sizingBB: -1 })).toBeNull();
      expect(parseDrillAnswer({ kind: 'multi-select', indices: [0, 2] })).toEqual({ kind: 'multi-select', indices: [0, 2] });
      expect(parseDrillAnswer({ kind: 'multi-select', indices: [] })).toEqual({ kind: 'multi-select', indices: [] });
      expect(parseDrillAnswer({ kind: 'multi-select', indices: [0, 0] })).toBeNull();
      expect(parseDrillAnswer({ kind: 'multi-select', indices: [0, 'x'] })).toBeNull();
    });
  });

  it('story-drill: answer/hint 두 형태만, elapsedMs 기본 0', () => {
    // 재출제 오퍼 응답 2종 — 4키만 허용
    expect(parseStoryDrillRequest({ runId: 'r', setId: 's', index: 3, action: 'retry' })).toEqual({ ok: true, value: { runId: 'r', setId: 's', index: 3, action: 'retry' } });
    expect(parseStoryDrillRequest({ runId: 'r', setId: 's', index: 3, action: 'skip-retry' })).toEqual({ ok: true, value: { runId: 'r', setId: 's', index: 3, action: 'skip-retry' } });
    expect(parseStoryDrillRequest({ runId: 'r', setId: 's', index: 3, action: 'retry', answer: { kind: 'numeric', value: 1 } }).ok).toBe(false);
    expect(parseStoryDrillRequest({ runId: 'r', setId: 's', index: 3, action: 'again' }).ok).toBe(false);
    expect(parseStoryDrillRequest({ runId: 'r', setId: 'act1-ch01:drills', index: 0, action: 'hint' })).toEqual({
      ok: true,
      value: { runId: 'r', setId: 'act1-ch01:drills', index: 0, action: 'hint' },
    });
    expect(parseStoryDrillRequest({
      runId: 'r', setId: 's', index: 1, action: 'answer', answer: { kind: 'numeric', value: 25 }, elapsedMs: 4200,
    })).toEqual({
      ok: true,
      value: { runId: 'r', setId: 's', index: 1, action: 'answer', answer: { kind: 'numeric', value: 25 }, elapsedMs: 4200 },
    });
    expect(parseStoryDrillRequest({ runId: 'r', setId: 's', index: 1, action: 'answer', answer: { kind: 'numeric', value: 25 } })).toMatchObject({
      ok: true,
      value: { elapsedMs: 0 },
    });
    expect(parseStoryDrillRequest({ runId: 'r', setId: 's', index: 1, action: 'answer' }).ok).toBe(false);
    expect(parseStoryDrillRequest({ runId: 'r', setId: 's', index: 1, action: 'hint', answer: { kind: 'numeric', value: 1 } }).ok).toBe(false);
    expect(parseStoryDrillRequest({ runId: 'r', setId: 's', index: 1, action: 'answer', answer: { kind: 'numeric', value: 1 }, elapsedMs: -5 }).ok).toBe(false);
    expect(parseStoryDrillRequest({ runId: 'r', setId: 's', index: 1, action: 'answer', answer: { kind: 'numeric', value: 1 }, elapsedMs: 3_600_001 }).ok).toBe(false);
    expect(parseStoryDrillRequest({ runId: 'r', setId: 's', index: 1, action: 'reveal' }).ok).toBe(false);
  });

  it('story-quiz / abandon-story', () => {
    expect(parseStoryQuizRequest({ runId: 'r', quizId: 'q1', optionIndex: 2 })).toEqual({ ok: true, value: { runId: 'r', quizId: 'q1', optionIndex: 2 } });
    expect(parseStoryQuizRequest({ runId: 'r', quizId: 'q1', optionIndex: 99 }).ok).toBe(false);
    expect(parseAbandonStoryRequest({ runId: 'run-7' })).toEqual({ ok: true, value: { runId: 'run-7' } });
    expect(parseAbandonStoryRequest({ runId: 'run-7', force: true }).ok).toBe(false);
  });
});

it('retry accepts only the failed run identifier', () => {
  expect(parseRetryStorySparringRequest({ failedRunId: 'run-1' })).toEqual({ ok: true, value: { failedRunId: 'run-1' } });
  for (const value of [null, {}, { failedRunId: 1 }, { failedRunId: 'run-1', stepIndex: 4 }, { failedRunId: 'run-1', profileId: 'other' }]) {
    expect(parseRetryStorySparringRequest(value).ok).toBe(false);
  }
});

describe('parseStoryPlacementRequest', () => {
  it.each(BAD_INPUTS)('객체가 아니면 거절: %j', input => {
    expect(parseStoryPlacementRequest(input).ok).toBe(false);
  });

  it('questions/set: 허용 키·값만 통과', () => {
    expect(parseStoryPlacementRequest({ action: 'questions' })).toEqual({ ok: true, value: { action: 'questions' } });
    expect(parseStoryPlacementRequest({ action: 'questions', seed: 1 }).ok).toBe(false);
    expect(parseStoryPlacementRequest({ action: 'set', tier: 'advanced' })).toEqual({ ok: true, value: { action: 'set', tier: 'advanced' } });
    expect(parseStoryPlacementRequest({ action: 'set', tier: 'pro' }).ok).toBe(false);
    expect(parseStoryPlacementRequest({ action: 'set' }).ok).toBe(false);
    expect(parseStoryPlacementRequest({ action: 'set', tier: 'novice', extra: true }).ok).toBe(false);
    expect(parseStoryPlacementRequest({ action: 'grade' }).ok).toBe(false);
    expect(parseStoryPlacementRequest({}).ok).toBe(false);
  });

  it('submit: 자기 평가 화이트리스트 + 드릴 답 파서 재사용 + null 허용 + 길이 상한', () => {
    expect(parseStoryPlacementRequest({ action: 'submit', selfReport: 'new', answers: [] }))
      .toEqual({ ok: true, value: { action: 'submit', selfReport: 'new', answers: [] } });
    expect(parseStoryPlacementRequest({
      action: 'submit',
      selfReport: 'regular',
      answers: [{ kind: 'multiple-choice', index: 1 }, null, { kind: 'action-pick', action: 'call' }],
    })).toEqual({
      ok: true,
      value: { action: 'submit', selfReport: 'regular', answers: [{ kind: 'multiple-choice', index: 1 }, null, { kind: 'action-pick', action: 'call' }] },
    });
    expect(parseStoryPlacementRequest({ action: 'submit', selfReport: 'expert', answers: [] }).ok).toBe(false);
    expect(parseStoryPlacementRequest({ action: 'submit', selfReport: 'rules' }).ok).toBe(false);
    expect(parseStoryPlacementRequest({ action: 'submit', selfReport: 'rules', answers: 'x' }).ok).toBe(false);
    // 형식이 틀린 답이 하나라도 있으면 전체 거절 (부분 채점 금지)
    expect(parseStoryPlacementRequest({ action: 'submit', selfReport: 'rules', answers: [{ kind: 'multiple-choice', index: 99 }] }).ok).toBe(false);
    expect(parseStoryPlacementRequest({ action: 'submit', selfReport: 'rules', answers: [{ kind: 'multiple-choice', index: 0, correct: true }] }).ok).toBe(false);
    expect(parseStoryPlacementRequest({ action: 'submit', selfReport: 'rules', answers: [undefined] }).ok).toBe(false);
    expect(parseStoryPlacementRequest({ action: 'submit', selfReport: 'rules', answers: [], tier: 'advanced' }).ok).toBe(false);
    const tooMany = Array.from({ length: PLACEMENT_ANSWERS_MAX + 1 }, () => null);
    expect(parseStoryPlacementRequest({ action: 'submit', selfReport: 'rules', answers: tooMany }).ok).toBe(false);
    expect(parseStoryPlacementRequest({ action: 'submit', selfReport: 'rules', answers: tooMany.slice(1) }).ok).toBe(true);
  });
});
