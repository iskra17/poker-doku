import { describe, expect, it } from 'vitest';
import { accuracyPercent, chapterCardState, chapterNumber, partnerCtaDecision, teacherArtId, teacherDisplayName } from './story-hub-rules';
import { makeChapterChain } from './test-fixtures';
import type { StoryProgressView } from './views';

function progress(overrides: Partial<StoryProgressView> = {}): StoryProgressView {
  return {
    chapters: [
      { chapterId: 'act1-ch01', attempts: 0, completions: 0, bestGrade: null, unlocked: true },
      { chapterId: 'act1-ch02', attempts: 0, completions: 0, bestGrade: null, unlocked: false },
    ],
    flags: {},
    belt: 'white',
    nextChapterId: 'act1-ch01',
    drillStats: { total: 0, correct: 0, byCategory: {} },
    reviewQueue: 0,
    daily: { date: '2026-09-02', done: 0, total: 3, available: false, teacherId: null },
    activeRun: null,
    ...overrides,
  };
}

const chain = makeChapterChain();
const order = (id: string) => chapterNumber(chain, id);

describe('story hub rules', () => {
  it('chapterCardState: in-progress beats completed, locked otherwise', () => {
    const row = progress().chapters[0];
    expect(chapterCardState(row, null)).toBe('available');
    expect(chapterCardState({ ...row, completions: 2 }, null)).toBe('completed');
    expect(chapterCardState({ ...row, completions: 2 }, { runId: 'r', chapterId: 'act1-ch01', stepIndex: 1 })).toBe('in-progress');
    expect(chapterCardState({ ...row, unlocked: false }, null)).toBe('locked');
  });

  it('partnerCtaDecision priority: room > active run > next chapter > practice', () => {
    expect(partnerCtaDecision({ hasPreservedRoom: true, progress: progress(), chapterOrder: order })).toEqual({ kind: 'resume-room', label: '게임 복귀' });
    expect(partnerCtaDecision({ hasPreservedRoom: false, progress: null, chapterOrder: order })).toEqual({ kind: 'practice', label: '수련 시작' });
    expect(partnerCtaDecision({ hasPreservedRoom: false, progress: progress(), chapterOrder: order }))
      .toEqual({ kind: 'story-start', label: '첫 수련 시작' });
    expect(partnerCtaDecision({
      hasPreservedRoom: false,
      progress: progress({
        chapters: [
          { chapterId: 'act1-ch01', attempts: 1, completions: 1, bestGrade: 'B', unlocked: true },
          { chapterId: 'act1-ch02', attempts: 0, completions: 0, bestGrade: null, unlocked: true },
        ],
        nextChapterId: 'act1-ch02',
      }),
      chapterOrder: order,
    })).toEqual({ kind: 'story-continue', label: '스토리 계속하기 · Ch2' });
    expect(partnerCtaDecision({
      hasPreservedRoom: false,
      progress: progress({ activeRun: { runId: 'r', chapterId: 'act1-ch01', stepIndex: 2 } }),
      chapterOrder: order,
    })).toEqual({ kind: 'story-continue', label: '스토리 이어하기 · Ch1' });
    // 졸업(다음 챕터 없음) → 자유 연습
    expect(partnerCtaDecision({ hasPreservedRoom: false, progress: progress({ nextChapterId: null }), chapterOrder: order }))
      .toEqual({ kind: 'practice', label: '수련 시작' });
  });

  it('teacher display name and art id map miyako to 미야코 / dealer art', () => {
    const names = (id: string) => ({ dealer: '딜러', sakura: '사쿠라' } as Record<string, string>)[id];
    expect(teacherDisplayName('miyako', names)).toBe('미야코');
    expect(teacherDisplayName('dealer', names)).toBe('미야코');
    expect(teacherDisplayName('sakura', names)).toBe('사쿠라');
    expect(teacherDisplayName('unknown', names)).toBe('unknown');
    expect(teacherArtId('miyako')).toBe('dealer');
    expect(teacherArtId('hana')).toBe('hana');
  });

  it('chapterNumber and accuracyPercent', () => {
    expect(order('act1-ch01')).toBe(1);
    expect(order('act2-ch04')).toBe(4);
    expect(order('nope')).toBeNull();
    expect(accuracyPercent(0, 0)).toBeNull();
    expect(accuracyPercent(8, 6)).toBe(75);
  });
});
