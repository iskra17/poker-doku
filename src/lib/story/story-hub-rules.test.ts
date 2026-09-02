import { describe, expect, it } from 'vitest';
import {
  accuracyPercent,
  chapterCardState,
  chapterNumber,
  chapterSkillCategories,
  chapterSkills,
  partnerCtaDecision,
  recommendChapter,
  recommendationCopy,
  teacherArtId,
  teacherDisplayName,
} from './story-hub-rules';
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
    expect(chapterCardState({ ...row, completions: 2 }, { runId: 'r', chapterId: 'act1-ch01', stepIndex: 1, mode: 'full' })).toBe('in-progress');
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
      progress: progress({ activeRun: { runId: 'r', chapterId: 'act1-ch01', stepIndex: 2, mode: 'full' } }),
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

  it('chapterSkills: 드릴 세트 템플릿에서 카테고리를 파생하고 내 정확도를 붙인다', () => {
    // 픽스처 드릴 세트 = rank-who-wins(hand-ranking) + pos-name(position)
    expect(chapterSkillCategories(chain[0])).toEqual(['hand-ranking', 'position']);
    const skills = chapterSkills(chain[0], { total: 5, correct: 3, byCategory: { 'hand-ranking': { total: 5, correct: 3 } } });
    expect(skills).toEqual([
      { category: 'hand-ranking', label: '핸드 랭킹', pct: 60, total: 5 },
      { category: 'position', label: '포지션', pct: null, total: 0 },
    ]);
  });

  it('recommendChapter: 진행 중 > 측정된 약점(≥3문·<70%) > 첫 방문 > 미완료 첫 순서 > 졸업 null', () => {
    const rows = (completed: string[] = []) => chain.map(chapter => ({
      chapterId: chapter.id, attempts: completed.includes(chapter.id) ? 1 : 0, completions: completed.includes(chapter.id) ? 1 : 0, bestGrade: null, unlocked: true,
    }));
    const untouched = progress({ chapters: rows() });
    expect(recommendChapter(chain, untouched)).toEqual({ chapterId: 'act1-ch01', reason: 'first', skill: null });
    expect(recommendationCopy(recommendChapter(chain, untouched)!)).toContain('처음이라면');

    const inProgress = progress({ chapters: rows(), activeRun: { runId: 'r', chapterId: 'act1-ch03', stepIndex: 2, mode: 'full' } });
    expect(recommendChapter(chain, inProgress)).toMatchObject({ chapterId: 'act1-ch03', reason: 'in-progress' });

    // Ch1 완료 + 포지션 정확도 50%(4문) → 포지션을 다루는 미완료 챕터(픽스처는 전 챕터 동일 드릴)를 약점으로 추천
    const weak = progress({
      chapters: rows(['act1-ch01']),
      drillStats: { total: 9, correct: 6, byCategory: { position: { total: 4, correct: 2 }, 'hand-ranking': { total: 5, correct: 4 } } },
    });
    const weakRec = recommendChapter(chain, weak)!;
    expect(weakRec).toMatchObject({ chapterId: 'act1-ch02', reason: 'weakness', skill: { category: 'position', pct: 50 } });
    expect(recommendationCopy(weakRec)).toBe('포지션 정확도 50% — 여기부터 보강해요');

    // 표본 2문(<3)이면 약점으로 치지 않는다 → 미완료 첫 순서
    const thin = progress({
      chapters: rows(['act1-ch01']),
      drillStats: { total: 2, correct: 0, byCategory: { position: { total: 2, correct: 0 } } },
    });
    expect(recommendChapter(chain, thin)).toEqual({ chapterId: 'act1-ch02', reason: 'next', skill: null });

    // 순서와 무관하게 남은 것 중 첫 순서: Ch2·Ch3만 끝냈으면 Ch1
    expect(recommendChapter(chain, progress({ chapters: rows(['act1-ch02', 'act1-ch03']) }))).toMatchObject({ chapterId: 'act1-ch01', reason: 'next' });
    expect(recommendChapter(chain, progress({ chapters: rows(chain.map(chapter => chapter.id)) }))).toBeNull();
  });

  it('chapterNumber and accuracyPercent', () => {
    expect(order('act1-ch01')).toBe(1);
    expect(order('act2-ch04')).toBe(4);
    expect(order('nope')).toBeNull();
    expect(accuracyPercent(0, 0)).toBeNull();
    expect(accuracyPercent(8, 6)).toBe(75);
  });
});
