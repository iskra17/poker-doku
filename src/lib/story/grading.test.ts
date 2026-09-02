import { describe, expect, it } from 'vitest';
import { EXAM_PASS_SCORE, chapterPassed, examPassed, firstClearRewards, gradeChapter, replayRewards, scoreDrillSet } from './grading';
import { makeChapter } from './test-fixtures';

describe('grading', () => {
  it('scores first-try correct 1, hinted correct × penalty, retry correct 0.5, miss 0', () => {
    expect(scoreDrillSet([], 0.5)).toBe(0);
    expect(scoreDrillSet([
      { firstCorrect: true, finallyCorrect: true, hintUsed: false },
      { firstCorrect: true, finallyCorrect: true, hintUsed: true },
      { firstCorrect: false, finallyCorrect: true, hintUsed: false },
      { firstCorrect: false, finallyCorrect: false, hintUsed: true },
    ], 0.5)).toBe(0.5); // (1 + 0.5 + 0.5 + 0) / 4
  });

  it('grades S/A/B from score and hints, averaging with live score when present', () => {
    expect(gradeChapter({ drillScore: 0.95, hintsUsed: 1 })).toBe('S');
    expect(gradeChapter({ drillScore: 0.95, hintsUsed: 2 })).toBe('A');
    expect(gradeChapter({ drillScore: 0.8, hintsUsed: 0 })).toBe('A');
    expect(gradeChapter({ drillScore: 0.6, hintsUsed: 0 })).toBe('B');
    expect(gradeChapter({ drillScore: 1, hintsUsed: 0, liveScore: 0.5 })).toBe('A');
    expect(gradeChapter({ drillScore: 1, hintsUsed: 0, liveScore: null })).toBe('S');
  });

  it('exam(실력 확인) passes at 0.85 — retry credit alone cannot carry it', () => {
    // 6문: 첫 시도 5정답 + 재출제 1 = 5.5/6
    const five = Array.from({ length: 5 }, () => ({ firstCorrect: true, finallyCorrect: true, hintUsed: false }));
    const retry = { firstCorrect: false, finallyCorrect: true, hintUsed: false };
    expect(examPassed(scoreDrillSet([...five, retry], 0.5))).toBe(true);
    // 첫 시도 4정답 + 재출제 2 = 5/6
    expect(examPassed(scoreDrillSet([...five.slice(0, 4), retry, retry], 0.5))).toBe(false);
    expect(examPassed(EXAM_PASS_SCORE)).toBe(true);
  });

  it('passes on drill completion unless primary objectives are known to be unmet', () => {
    expect(chapterPassed({ drillCompleted: true, primaryObjectivesMet: null })).toBe(true);
    expect(chapterPassed({ drillCompleted: true, primaryObjectivesMet: true })).toBe(true);
    expect(chapterPassed({ drillCompleted: true, primaryObjectivesMet: false })).toBe(false);
    expect(chapterPassed({ drillCompleted: false, primaryObjectivesMet: true })).toBe(false);
  });

  it('resolves first-clear rewards (partner / all / heroine) and replay rewards', () => {
    const chapter = makeChapter();
    expect(firstClearRewards(chapter, 'B', 'sakura')).toEqual({
      dojoXpMilli: 100_000,
      affinity: [{ characterId: 'sakura', milli: 30_000 }],
      badgeId: 'white-belt',
    });
    expect(firstClearRewards(chapter, 'S', null)).toEqual({ dojoXpMilli: 150_000, affinity: [], badgeId: 'white-belt' });

    const graduation = makeChapter({
      rewards: {
        first: { dojoXpMilli: 500_000, affinity: [{ target: 'all', milli: 30_000 }, { target: 'hana', milli: 20_000 }] },
        replay: { dojoXpMilli: 50_000 },
        gradeBonusMilli: { A: 20_000 },
      },
    });
    const all = firstClearRewards(graduation, 'A', 'ara');
    expect(all.dojoXpMilli).toBe(520_000);
    expect(all.affinity).toHaveLength(6);
    expect(all.affinity.find(grant => grant.characterId === 'hana')?.milli).toBe(50_000);
    expect(replayRewards(chapter, 'A')).toEqual({ dojoXpMilli: 40_000, affinity: [], badgeId: null });
  });
});
