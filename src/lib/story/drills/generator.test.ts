import { describe, expect, it, vi } from 'vitest';
import { evaluateHand } from '@/lib/poker/evaluator';
import { computePotOdds } from '@/lib/poker/learning';
import {
  DRILL_REROLL_LIMIT,
  DRILL_TEMPLATES,
  DRILL_TEMPLATE_IDS,
  DrillGenerationError,
  generateDrill,
  generateFromDefinition,
  getDrillTemplate,
  gradeDrill,
  instantiateAuthoredDrill,
} from './generator';
import { toPublicDrillInstance } from './public';
import { AUTHORED_DRILL_TEMPLATES } from './templates/authored';
import type { GeneratedDrillDefinition } from './templates/kit';
import type { DrillAnswer, DrillInstance, DrillTemplate } from './types';

const CTX = { teacher: 'miyako' } as const;
const SEEDS = Array.from({ length: 100 }, (_, index) => index);

/** 챕터 데이터가 이 id로 문항을 지목한다 — 이름을 바꾸면 콘텐츠가 깨진다. */
const EXPECTED_IDS = [
  'rank-who-wins',
  'rank-best-hand',
  'rank-nuts',
  'pos-name',
  'pos-first-to-act',
  'range-open-decision',
  'range-percentile',
  'outs-count',
  'odds-required-equity',
  'odds-ratio-choice',
  'equity-estimate',
  'call-decision',
  // 2막
  'breakeven-fold-pct',
  'breakeven-choice',
  'size-cbet-texture',
  'size-river-value',
  'type-from-hud',
  'type-exploit',
  'range-3bet-decision',
  'range-vs-3bet',
] as const;

function correctAnswer(instance: DrillInstance): DrillAnswer {
  const spec = instance.answerSpec;
  switch (spec.kind) {
    case 'multiple-choice':
      return { kind: 'multiple-choice', index: spec.correctIndex };
    case 'numeric':
      return { kind: 'numeric', value: spec.correct };
    case 'card-pick':
      return { kind: 'card-pick', cards: spec.correct };
    case 'action-pick':
      return {
        kind: 'action-pick',
        action: spec.correct[0],
        ...(spec.sizingBB ? { sizingBB: spec.sizingBB.min } : {}),
      };
    case 'multi-select':
      return { kind: 'multi-select', indices: spec.correctIndices };
  }
}

function wrongAnswer(instance: DrillInstance): DrillAnswer {
  const spec = instance.answerSpec;
  switch (spec.kind) {
    case 'multiple-choice':
      return { kind: 'multiple-choice', index: (spec.correctIndex + 1) % spec.options.length };
    case 'numeric':
      return { kind: 'numeric', value: spec.correct + spec.tolerance + 1 };
    case 'card-pick':
      return { kind: 'card-pick', cards: spec.candidates.filter(card => !spec.correct.includes(card)) };
    case 'action-pick':
      return { kind: 'action-pick', action: spec.options.find(a => !spec.correct.includes(a)) ?? 'fold' };
    case 'multi-select':
      return { kind: 'multi-select', indices: [] };
  }
}

function factNumber(instance: DrillInstance, key: string): number {
  const value = instance.explanation.facts[key];
  expect(typeof value, `${instance.templateId}.${key}`).toBe('number');
  return value as number;
}

describe('drill template registry', () => {
  it('exposes the 20 generated templates by their fixed ids', () => {
    for (const id of EXPECTED_IDS) {
      expect(DRILL_TEMPLATE_IDS.has(id), id).toBe(true);
      expect(getDrillTemplate(id)?.id).toBe(id);
    }
    expect(DRILL_TEMPLATES.length).toBeGreaterThanOrEqual(EXPECTED_IDS.length);
  });

  it('rejects unknown template ids with DrillGenerationError', () => {
    expect(() => generateDrill('nope', 1, CTX)).toThrow(DrillGenerationError);
  });
});

describe('generateDrill', () => {
  it('produces a gradable instance for every template across 100 seeds', () => {
    for (const id of EXPECTED_IDS) {
      for (const seed of SEEDS) {
        const instance = generateDrill(id, seed, CTX);
        expect(instance.templateId).toBe(id);
        // 인스턴스의 seed는 리롤로 채택된 내부 seed가 아니라 "호출 seed"다.
        expect(instance.seed).toBe(seed);
        expect(instance.question.length).toBeGreaterThan(0);
        expect(instance.explanation.speaker).toBe(CTX.teacher);
        expect(instance.explanation.text.length).toBeGreaterThan(0);

        expect(gradeDrill(instance, correctAnswer(instance)), `${id}#${seed} correct`).toBe(true);
        expect(gradeDrill(instance, wrongAnswer(instance)), `${id}#${seed} wrong`).toBe(false);
      }
    }
    // equity-estimate는 플랍 런아웃 990가지를 완전 열거한다 — 시드 100개면 기본 5초를 넘긴다.
  }, 60_000);

  it('is deterministic — same (templateId, seed, ctx) gives a deep-equal instance', () => {
    for (const id of EXPECTED_IDS) {
      for (const seed of [0, 7, 41, 99]) {
        expect(generateDrill(id, seed, CTX)).toEqual(generateDrill(id, seed, CTX));
      }
    }
  });

  it('honours the teacher and big blind from the context', () => {
    const instance = generateDrill('odds-required-equity', 3, { teacher: 'hana', bigBlind: 40 });
    expect(instance.explanation.speaker).toBe('hana');
    expect(instance.situation.bigBlind).toBe(40);
  });

  it('never touches Math.random (seeded RNG only)', () => {
    const spy = vi.spyOn(Math, 'random');
    try {
      for (const id of EXPECTED_IDS) {
        for (const seed of [1, 2, 3, 4, 5]) generateDrill(id, seed, CTX);
      }
      expect(spy).not.toHaveBeenCalled();
    } finally {
      spy.mockRestore();
    }
  });

  it('gives up with DrillGenerationError after the reroll limit', () => {
    let attempts = 0;
    const alwaysAmbiguous: GeneratedDrillDefinition = {
      template: {
        id: 'test-always-ambiguous',
        category: 'pot-odds',
        title: '항상 모호한 문항',
        difficulty: 1,
        hints: [],
        source: { kind: 'generated', params: {} },
      },
      build: () => {
        attempts++;
        return null;
      },
    };

    expect(() => generateFromDefinition(alwaysAmbiguous, 11, CTX)).toThrow(DrillGenerationError);
    // seed, seed+1 … seed+32
    expect(attempts).toBe(DRILL_REROLL_LIMIT + 1);

    try {
      generateFromDefinition(alwaysAmbiguous, 11, CTX);
    } catch (error) {
      expect((error as DrillGenerationError).templateId).toBe('test-always-ambiguous');
    }
  });
});

describe('authored templates', () => {
  it('registers the Act 1·2·3 authored drills (ids unique, all instantiable)', () => {
    const ids = AUTHORED_DRILL_TEMPLATES.map(template => template.id);
    expect(ids).toEqual([
      'act-ch02-fold-utg', 'act-ch02-open-btn',
      'act-ch04-steal-btn', 'act-ch04-cbet-dry', 'act-ch04-iso-sb',
      'act-ch05-river-value', 'act-ch05-river-air-check',
      'act-ch06-3bet-aa', 'act-ch06-fold-vs-3bet', 'act-ch06-call-3bet-tt',
      'act-ch09-checkraise-fold',
    ]);
    expect(new Set(ids).size).toBe(ids.length);
    for (const template of AUTHORED_DRILL_TEMPLATES) {
      expect(DRILL_TEMPLATE_IDS.has(template.id)).toBe(true);
      const instance = generateDrill(template.id, 0, { teacher: 'sakura' });
      expect(instance.explanation.speaker).toBe('sakura');
      const spec = instance.answerSpec as { kind: 'action-pick'; correct: readonly ('fold'|'raise'|'call'|'check'|'all-in')[]; sizingBB?: { min: number; max: number } };
      expect(gradeDrill(instance, { kind: 'action-pick', action: spec.correct[0], sizingBB: spec.sizingBB?.min ?? 2.5 })).toBe(true);
    }
  });

  it('clones the stored instance and only swaps the speaker', () => {
    const authored: DrillTemplate = {
      id: 'authored-sample',
      category: 'action-judgment',
      title: '수기 문항 샘플',
      difficulty: 2,
      hints: ['이 힌트는 그대로 나가요.'],
      source: {
        kind: 'authored',
        instance: {
          category: 'action-judgment',
          situation: {
            hero: [{ rank: 'A', suit: 'spades' }, { rank: 'K', suit: 'spades' }],
            board: [],
            potChips: 30,
            toCallChips: 20,
            bigBlind: 20,
            heroStackChips: 2000,
            heroPosition: 'CO',
            street: 'preflop',
            villains: [],
          },
          question: '어떻게 할까요?',
          answerSpec: { kind: 'action-pick', options: ['fold', 'raise'], correct: ['raise'] },
          hint: '이 힌트는 그대로 나가요.',
          explanation: { text: '수기 해설이에요.', speaker: 'miyako', facts: { pct: 3 } },
        },
      },
    };

    const instance = instantiateAuthoredDrill(authored, 77, { teacher: 'hana' });
    expect(instance.templateId).toBe('authored-sample');
    expect(instance.seed).toBe(77);
    expect(instance.question).toBe('어떻게 할까요?');
    expect(instance.hint).toBe('이 힌트는 그대로 나가요.');
    expect(instance.explanation.text).toBe('수기 해설이에요.');
    // 화자만 실행 시점 교사로 바뀐다.
    expect(instance.explanation.speaker).toBe('hana');
    expect(gradeDrill(instance, { kind: 'action-pick', action: 'raise' })).toBe(true);
    expect(gradeDrill(instance, { kind: 'action-pick', action: 'fold' })).toBe(false);

    // 저장본과 인스턴스가 객체를 공유하면 한 번 푼 문항이 다음 실행에 오염된다.
    instance.situation.hero.push({ rank: '2', suit: 'clubs' });
    if (authored.source.kind !== 'authored') throw new Error('unreachable');
    expect(authored.source.instance.situation.hero.length).toBe(2);
  });
});

describe('public projection', () => {
  it('strips answers, explanations and hint bodies', () => {
    for (const id of EXPECTED_IDS) {
      for (const seed of [0, 13, 55]) {
        const instance = generateDrill(id, seed, CTX);
        const json = JSON.stringify(toPublicDrillInstance(instance));
        expect(json, id).not.toMatch(/correct/i);
        expect(json, id).not.toContain('explanation');
        if (instance.hint) expect(json, id).not.toContain(instance.hint);
      }
    }
  });

  it('reports hint availability without leaking it', () => {
    const instance = generateDrill('outs-count', 5, CTX);
    expect(instance.hint).toBeTruthy();
    expect(toPublicDrillInstance(instance).hasHint).toBe(true);
  });
});

describe('template-specific invariants', () => {
  it('rank-who-wins always has exactly one winner and names them correctly', () => {
    for (const seed of SEEDS) {
      const instance = generateDrill('rank-who-wins', seed, CTX);
      const { hero, board, villains } = instance.situation;
      const values = [
        evaluateHand(hero, board).value,
        ...villains.map(villain => evaluateHand(villain.holeCards ?? [], board).value),
      ];
      const best = Math.max(...values);
      expect(values.filter(value => value === best).length, `seed ${seed}`).toBe(1);

      const spec = instance.answerSpec;
      expect(spec.kind).toBe('multiple-choice');
      if (spec.kind !== 'multiple-choice') throw new Error('unreachable');
      expect(spec.correctIndex).toBe(values.indexOf(best));
      expect(spec.options[0]).toBe('나');
    }
  });

  it('range-open-decision never lands on the ±3%p border', () => {
    for (const seed of SEEDS) {
      const instance = generateDrill('range-open-decision', seed, CTX);
      const pct = factNumber(instance, 'pct');
      const threshold = factNumber(instance, 'threshold');
      expect(Math.abs(pct - threshold), `seed ${seed}`).toBeGreaterThan(3);
    }
  });

  it('outs-count at difficulty 1 stays within 9 outs and answers exactly', () => {
    expect(getDrillTemplate('outs-count')?.difficulty).toBe(1);
    for (const seed of SEEDS) {
      const instance = generateDrill('outs-count', seed, CTX);
      const outs = factNumber(instance, 'outs');
      expect(outs, `seed ${seed}`).toBeGreaterThanOrEqual(1);
      expect(outs, `seed ${seed}`).toBeLessThanOrEqual(9);

      const spec = instance.answerSpec;
      if (spec.kind !== 'numeric') throw new Error('outs-count must be numeric');
      expect(spec.correct).toBe(outs);
      expect(spec.tolerance).toBe(0);
      // 히어로 시점의 미확인 카드 수 (플랍 47 · 턴 46)
      expect(factNumber(instance, 'unseen')).toBe(52 - 2 - instance.situation.board.length);
    }
  });

  it('pot-odds templates treat potChips as including the villain bet', () => {
    for (const id of ['odds-required-equity', 'odds-ratio-choice'] as const) {
      for (const seed of SEEDS) {
        const instance = generateDrill(id, seed, CTX);
        const { potChips, toCallChips } = instance.situation;
        expect(factNumber(instance, 'potChips')).toBe(potChips);
        expect(factNumber(instance, 'toCallChips')).toBe(toCallChips);
        // 팟에 이미 상대 벳이 들어 있다는 뜻 — 벳을 다시 더하지 않는다.
        expect(factNumber(instance, 'villainBet')).toBe(toCallChips);
        expect(potChips).toBeGreaterThan(toCallChips);
        expect(factNumber(instance, 'potAfterCall')).toBe(potChips + toCallChips);
        expect(factNumber(instance, 'requiredEquity')).toBe(
          Math.round((toCallChips / (potChips + toCallChips)) * 100),
        );
        expect(factNumber(instance, 'requiredEquity')).toBe(
          Math.round(computePotOdds(toCallChips, potChips).pct),
        );
      }
    }
  });

  it('odds-ratio-choice keeps every wrong option at least 4%p away', () => {
    for (const seed of SEEDS) {
      const instance = generateDrill('odds-ratio-choice', seed, CTX);
      const spec = instance.answerSpec;
      if (spec.kind !== 'multiple-choice') throw new Error('odds-ratio-choice must be multiple-choice');
      const correct = factNumber(instance, 'requiredEquity');
      expect(spec.options.length).toBe(4);
      spec.options.forEach((option, index) => {
        const value = Number.parseInt(option, 10);
        if (index === spec.correctIndex) expect(value).toBe(correct);
        else expect(Math.abs(value - correct), `seed ${seed} option ${option}`).toBeGreaterThanOrEqual(4);
      });
    }
  });

  it('call-decision keeps equity and required equity 4%p apart and picks the reason option', () => {
    for (const seed of SEEDS) {
      const instance = generateDrill('call-decision', seed, CTX);
      const equity = factNumber(instance, 'equity');
      const required = factNumber(instance, 'requiredEquity');
      expect(Math.abs(equity - required), `seed ${seed}`).toBeGreaterThanOrEqual(3.9);

      const spec = instance.answerSpec;
      if (spec.kind !== 'multiple-choice') throw new Error('call-decision must be multiple-choice');
      expect(spec.correctIndex).toBe(equity >= required ? 0 : 2);
      // 리버 한 장만 남은 상황으로 단순화한다.
      expect(instance.situation.board.length).toBe(4);
    }
  });

  it('equity-estimate reports both the 2·4 estimate and the enumerated value', () => {
    for (const seed of SEEDS) {
      const instance = generateDrill('equity-estimate', seed, CTX);
      const cardsToCome = factNumber(instance, 'cardsToCome');
      expect([1, 2]).toContain(cardsToCome);
      expect(factNumber(instance, 'ruleMultiplier')).toBe(cardsToCome === 2 ? 4 : 2);
      const spec = instance.answerSpec;
      if (spec.kind !== 'numeric') throw new Error('equity-estimate must be numeric');
      expect(spec.tolerance).toBe(5);
      expect(Math.abs(factNumber(instance, 'rule24') - factNumber(instance, 'exact'))).toBeLessThan(12);
    }
  }, 60_000);

  it('pos-name hides the position it is asking about', () => {
    for (const seed of SEEDS) {
      const instance = generateDrill('pos-name', seed, CTX);
      expect(instance.situation.heroPosition).toBe('?');
      for (const villain of instance.situation.villains) expect(villain.position).toBe('?');
      expect(instance.situation.villains.length).toBe(5);
      expect(instance.situation.note).toContain('딜러 버튼');
    }
  });

  it('pos-first-to-act answers UTG preflop and SB postflop', () => {
    for (const seed of SEEDS) {
      const instance = generateDrill('pos-first-to-act', seed, CTX);
      const spec = instance.answerSpec;
      if (spec.kind !== 'multiple-choice') throw new Error('pos-first-to-act must be multiple-choice');
      expect(spec.options.length).toBe(3);
      const expected = instance.situation.street === 'preflop' ? 'UTG' : 'SB';
      expect(spec.options[spec.correctIndex]).toBe(expected);
      expect(instance.question).toContain('전원이 참여');
    }
  });

  it('range-percentile clamps the answer into 1~100', () => {
    for (const seed of SEEDS) {
      const instance = generateDrill('range-percentile', seed, CTX);
      const spec = instance.answerSpec;
      if (spec.kind !== 'numeric') throw new Error('range-percentile must be numeric');
      expect(spec.correct).toBeGreaterThanOrEqual(1);
      expect(spec.correct).toBeLessThanOrEqual(100);
      expect(spec.tolerance).toBe(10);
      expect(spec.unit).toBe('%');
    }
  });

  it('draws every villain from the support pool without duplicates', () => {
    // 조연 6 + D-TYPE(실제 HUD)에만 나오는 비히로인 봇 3 — 히로인 6명은 어떤 문항에도 상대로 나오지 않는다
    const pool = new Set(['kapi', 'choco', 'mochi', 'draco', 'luna', 'gumi', 'paeng', 'lin', 'ingrid']);
    for (const id of EXPECTED_IDS) {
      for (const seed of [0, 21, 64]) {
        const villains = generateDrill(id, seed, CTX).situation.villains;
        const ids = villains.map(villain => villain.characterId);
        expect(new Set(ids).size, `${id}#${seed}`).toBe(ids.length);
        for (const characterId of ids) expect(pool.has(characterId), characterId).toBe(true);
      }
    }
  });
});

describe('gradeDrill', () => {
  it('rejects an answer of the wrong kind', () => {
    const instance = generateDrill('pos-name', 1, CTX);
    expect(gradeDrill(instance, { kind: 'numeric', value: 1 })).toBe(false);
  });

  it('accepts numeric answers inside the tolerance band', () => {
    const instance = generateDrill('odds-required-equity', 2, CTX);
    const spec = instance.answerSpec;
    if (spec.kind !== 'numeric') throw new Error('expected numeric');
    expect(gradeDrill(instance, { kind: 'numeric', value: spec.correct + spec.tolerance })).toBe(true);
    expect(gradeDrill(instance, { kind: 'numeric', value: spec.correct - spec.tolerance })).toBe(true);
    expect(gradeDrill(instance, { kind: 'numeric', value: spec.correct + spec.tolerance + 0.5 })).toBe(false);
    expect(gradeDrill(instance, { kind: 'numeric', value: Number.NaN })).toBe(false);
  });

  it('compares card-pick and multi-select answers as sets', () => {
    const base = generateDrill('pos-name', 1, CTX);
    const cardPick: DrillInstance = {
      ...base,
      answerSpec: {
        kind: 'card-pick',
        candidates: [
          { rank: 'A', suit: 'spades' },
          { rank: 'K', suit: 'hearts' },
          { rank: '2', suit: 'clubs' },
        ],
        correct: [
          { rank: 'A', suit: 'spades' },
          { rank: 'K', suit: 'hearts' },
        ],
        pickCount: 2,
      },
    };
    expect(
      gradeDrill(cardPick, {
        kind: 'card-pick',
        cards: [
          { rank: 'K', suit: 'hearts' },
          { rank: 'A', suit: 'spades' },
        ],
      }),
    ).toBe(true);
    expect(
      gradeDrill(cardPick, {
        kind: 'card-pick',
        cards: [
          { rank: 'A', suit: 'spades' },
          { rank: 'A', suit: 'spades' },
        ],
      }),
    ).toBe(false);

    const multi: DrillInstance = {
      ...base,
      answerSpec: { kind: 'multi-select', options: ['가', '나', '다'], correctIndices: [0, 2] },
    };
    expect(gradeDrill(multi, { kind: 'multi-select', indices: [2, 0] })).toBe(true);
    expect(gradeDrill(multi, { kind: 'multi-select', indices: [0] })).toBe(false);
  });

  it('checks action-pick membership and the sizing band', () => {
    const base = generateDrill('pos-name', 1, CTX);
    const withSizing: DrillInstance = {
      ...base,
      answerSpec: {
        kind: 'action-pick',
        options: ['fold', 'call', 'raise'],
        correct: ['raise'],
        sizingBB: { min: 2, max: 3 },
      },
    };
    expect(gradeDrill(withSizing, { kind: 'action-pick', action: 'raise', sizingBB: 2.5 })).toBe(true);
    expect(gradeDrill(withSizing, { kind: 'action-pick', action: 'raise', sizingBB: 5 })).toBe(false);
    expect(gradeDrill(withSizing, { kind: 'action-pick', action: 'raise' })).toBe(false);
    expect(gradeDrill(withSizing, { kind: 'action-pick', action: 'call', sizingBB: 2.5 })).toBe(false);

    const noSizing: DrillInstance = {
      ...base,
      answerSpec: { kind: 'action-pick', options: ['fold', 'call'], correct: ['fold'] },
    };
    expect(gradeDrill(noSizing, { kind: 'action-pick', action: 'fold' })).toBe(true);
  });
});
