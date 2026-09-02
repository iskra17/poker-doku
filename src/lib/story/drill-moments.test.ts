import { describe, expect, it } from 'vitest';
import { allDrillMomentLines, drillMomentLine, expressionForResult, pickDrillMoment } from './drill-moments';

describe('drill moments', () => {
  it('escalates the teacher expression with the streak and sours on retry misses', () => {
    expect(expressionForResult(true, 1, false)).toBe('happy');
    expect(expressionForResult(true, 3, false)).toBe('confident');
    expect(expressionForResult(true, 5, false)).toBe('surprised');
    expect(expressionForResult(false, 0, false)).toBe('thinking');
    expect(expressionForResult(false, 0, true)).toBe('sad');
  });

  it('picks perfect > combo-5 > combo-3 > wrong-again, else nothing', () => {
    expect(pickDrillMoment({ correct: true, streak: 6, isRetry: false, perfectSet: true })).toMatchObject({ moment: 'drill-perfect', stamp: '퍼펙트', burst: true });
    expect(pickDrillMoment({ correct: true, streak: 5, isRetry: false, perfectSet: false })).toMatchObject({ moment: 'drill-combo-5', burst: true });
    expect(pickDrillMoment({ correct: true, streak: 3, isRetry: false, perfectSet: false })).toMatchObject({ moment: 'drill-combo-3', burst: false, expression: 'confident' });
    expect(pickDrillMoment({ correct: true, streak: 4, isRetry: false, perfectSet: false })).toBeNull();
    expect(pickDrillMoment({ correct: false, streak: 0, isRetry: true, perfectSet: false })).toMatchObject({ moment: 'drill-wrong-again', expression: 'sad', stamp: null });
    expect(pickDrillMoment({ correct: false, streak: 0, isRetry: false, perfectSet: false })).toBeNull();
  });

  it('serves teacher lines deterministically and falls back to miyako', () => {
    expect(drillMomentLine('sakura', 'drill-combo-3')).toContain('당신');
    expect(drillMomentLine('miyako', 'drill-combo-3', 0)).not.toBe(drillMomentLine('miyako', 'drill-combo-3', 1));
    expect(drillMomentLine('elena', 'belt')).toBe(drillMomentLine('miyako', 'belt'));
    expect(drillMomentLine('hana', 'drill-wrong-again')).toContain('노트');
  });

  it('every line follows the 원어 terminology rule (no 접다/손/판 for fold/hand)', () => {
    const banned = /접[다는어었을]|여는 손|손을|손이|판을|판이/;
    for (const line of allDrillMomentLines()) expect(line).not.toMatch(banned);
    expect(allDrillMomentLines().length).toBeGreaterThan(20);
  });
});
