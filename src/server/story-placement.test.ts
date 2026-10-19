import { describe, expect, it } from 'vitest';
import { generateDrill } from '../lib/story/drills/generator';
import type { DrillAnswer, DrillAnswerSpec } from '../lib/story/drills/types';
import { PLACEMENT_TEMPLATE_IDS, PLACEMENT_TIER_FLAG } from '../lib/story/placement';
import { StoryPlacementService } from './story-placement';

function correctAnswer(spec: DrillAnswerSpec): DrillAnswer {
  switch (spec.kind) {
    case 'multiple-choice': return { kind: 'multiple-choice', index: spec.correctIndex };
    case 'numeric': return { kind: 'numeric', value: spec.correct };
    case 'card-pick': return { kind: 'card-pick', cards: spec.correct };
    case 'action-pick': return { kind: 'action-pick', action: spec.correct[0] };
    case 'multi-select': return { kind: 'multi-select', indices: spec.correctIndices };
  }
}

function wrongAnswer(spec: DrillAnswerSpec): DrillAnswer {
  switch (spec.kind) {
    case 'multiple-choice': return { kind: 'multiple-choice', index: (spec.correctIndex + 1) % spec.options.length };
    case 'numeric': return { kind: 'numeric', value: spec.correct + spec.tolerance + 1_000 };
    case 'card-pick': return { kind: 'card-pick', cards: [] };
    case 'action-pick': return { kind: 'action-pick', action: spec.options.find(option => !spec.correct.includes(option)) ?? 'fold' };
    case 'multi-select': return { kind: 'multi-select', indices: [] };
  }
}

function setup(options: { ttlMs?: number; maxEntries?: number; failSetFlags?: boolean } = {}) {
  let clock = 1_000_000;
  let nextSeed = 100;
  const flags = new Map<string, Record<string, string>>();
  const calls: Array<{ profileId: string; flags: Record<string, string> }> = [];
  const service = new StoryPlacementService({
    repository: {
      setFlags: (profileId, values) => {
        if (options.failSetFlags) throw new Error('db down');
        calls.push({ profileId, flags: { ...values } });
        flags.set(profileId, { ...(flags.get(profileId) ?? {}), ...values });
      },
    },
    now: () => clock,
    seed: () => nextSeed++,
    ttlMs: options.ttlMs,
    maxEntries: options.maxEntries,
  });
  return {
    service,
    flags,
    calls,
    advance: (ms: number) => { clock += ms; },
    /** 서버와 같은 컨텍스트로 재생성한 정답 키 (테스트 전용 — 실제 클라엔 없다) */
    answersFor: (questions: Array<{ templateId: string; seed: number }>, pattern: boolean[]) =>
      questions.map((question, index) => {
        const spec = generateDrill(question.templateId, question.seed, { teacher: 'miyako' }).answerSpec;
        return pattern[index] ? correctAnswer(spec) : wrongAnswer(spec);
      }),
  };
}

describe('StoryPlacementService', () => {
  it('questions: 템플릿마다 서버 seed로 1문씩, 정답·해설·힌트는 싣지 않는다', () => {
    const { service } = setup();
    const issued = service.issue('p1');
    expect(issued.ok).toBe(true);
    if (!issued.ok) return;
    expect(issued.value.questions.map(question => question.templateId)).toEqual([...PLACEMENT_TEMPLATE_IDS]);
    for (const question of issued.value.questions) {
      // answerSpec은 보기만 남은 공개 투영(정답 키 없음)
      expect(Object.keys(question.answerSpec).some(key => /correct/i.test(key))).toBe(false);
      expect(question).not.toHaveProperty('explanation');
      expect(question).not.toHaveProperty('hint');
      expect(JSON.stringify(question)).not.toMatch(/correct/i);
    }
    // seed는 서버가 골랐다 (주입한 시퀀스)
    expect(issued.value.questions.map(question => question.seed)).toEqual([100, 101, 102, 103]);
  });

  it.each([
    [[true, true, true, true], 'advanced', 4],
    [[true, true, true, false], 'advanced', 3],
    [[true, false, true, false], 'novice', 2],
    [[false, false, false, false], 'beginner', 0],
  ] as const)('submit: 발급 seed로 재생성해 채점하고 등급 flag를 저장한다 %j', (pattern, tier, correct) => {
    const { service, flags, answersFor } = setup();
    const issued = service.issue('p1');
    if (!issued.ok) throw new Error('issue failed');
    const result = service.submit('p1', 'regular', answersFor(issued.value.questions, [...pattern]));
    expect(result).toEqual({ ok: true, value: { tier, correct, total: 4 } });
    expect(flags.get('p1')).toEqual({ [PLACEMENT_TIER_FLAG]: tier });
  });

  it('submit: 빠진 답·null은 오답, 발급 1회당 제출 1회', () => {
    const { service, answersFor } = setup();
    const issued = service.issue('p1');
    if (!issued.ok) throw new Error('issue failed');
    const answers = answersFor(issued.value.questions, [true, true, true, true]);
    const result = service.submit('p1', 'rules', [answers[0], null, answers[2]]);
    expect(result).toEqual({ ok: true, value: { tier: 'novice', correct: 2, total: 4 } });
    // 같은 발급으로 다시 제출(정답 바꿔치기) 불가
    expect(service.submit('p1', 'rules', answers)).toMatchObject({ ok: false, code: 'stale-state' });
  });

  it('submit: 발급 없음·만료·다른 프로필의 발급은 거절', () => {
    const { service, advance, answersFor, calls } = setup({ ttlMs: 60_000 });
    expect(service.submit('p1', 'regular', [])).toMatchObject({ ok: false, code: 'stale-state' });
    const issued = service.issue('p2');
    if (!issued.ok) throw new Error('issue failed');
    const answers = answersFor(issued.value.questions, [true, true, true, true]);
    expect(service.submit('p1', 'regular', answers)).toMatchObject({ ok: false, code: 'stale-state' });
    advance(60_000);
    expect(service.submit('p2', 'regular', answers)).toMatchObject({ ok: false, code: 'stale-state' });
    expect(service.stats().issued).toBe(0);
    expect(calls).toEqual([]);
  });

  it('submit: 발급 문항보다 긴 답은 invalid-payload', () => {
    const { service } = setup();
    service.issue('p1');
    expect(service.submit('p1', 'regular', Array.from({ length: 5 }, () => null))).toMatchObject({ ok: false, code: 'invalid-payload' });
  });

  it("submit 'new': 문제 없이 beginner, 받아 둔 발급도 버린다", () => {
    const { service, flags } = setup();
    expect(service.submit('p1', 'new', [])).toEqual({ ok: true, value: { tier: 'beginner', correct: 0, total: 0 } });
    expect(flags.get('p1')).toEqual({ [PLACEMENT_TIER_FLAG]: 'beginner' });
    service.issue('p2');
    expect(service.submit('p2', 'new', [{ kind: 'multiple-choice', index: 0 }])).toMatchObject({ ok: true, value: { tier: 'beginner' } });
    expect(service.stats().issued).toBe(0);
  });

  it('재발급은 교체 — 이전 seed로 맞힌 답은 새 문항 기준으로 채점된다', () => {
    const { service, answersFor } = setup();
    const first = service.issue('p1');
    const second = service.issue('p1');
    if (!first.ok || !second.ok) throw new Error('issue failed');
    expect(second.value.questions.map(question => question.seed)).not.toEqual(first.value.questions.map(question => question.seed));
    expect(service.stats().issued).toBe(1);
    const result = service.submit('p1', 'regular', answersFor(second.value.questions, [true, true, true, true]));
    expect(result).toMatchObject({ ok: true, value: { correct: 4 } });
  });

  it('보관 크기 상한 — 가장 오래된 발급부터 버린다', () => {
    const { service } = setup({ maxEntries: 2 });
    service.issue('a');
    service.issue('b');
    service.issue('c');
    expect(service.stats().issued).toBe(2);
    expect(service.submit('a', 'rules', [])).toMatchObject({ ok: false, code: 'stale-state' });
    expect(service.submit('c', 'rules', [])).toMatchObject({ ok: true });
  });

  it('set: 등급을 직접 저장', () => {
    const { service, flags } = setup();
    expect(service.set('p1', 'advanced')).toEqual({ ok: true, value: { tier: 'advanced' } });
    expect(flags.get('p1')).toEqual({ [PLACEMENT_TIER_FLAG]: 'advanced' });
  });

  it('저장 실패는 server-error — 발급 세트는 남아 같은 답으로 재시도할 수 있다', () => {
    const { service } = setup({ failSetFlags: true });
    service.issue('p1');
    expect(service.submit('p1', 'regular', [])).toMatchObject({ ok: false, code: 'server-error' });
    expect(service.stats().issued).toBe(1);
    expect(service.set('p1', 'novice')).toMatchObject({ ok: false, code: 'server-error' });
  });
});
