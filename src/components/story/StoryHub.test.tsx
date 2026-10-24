import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { StoryProgressView } from '@/lib/story/views';
import StoryHub from './StoryHub';

const input = vi.hoisted(() => ({
  progress: null as StoryProgressView | null,
  startChapter: vi.fn(),
  starts: new Map<string, () => void>(),
  exams: new Map<string, () => void>(),
  graduations: new Map<string, () => void>(),
}));
vi.mock('@/lib/store/story-store', () => ({
  useStoryStore: (select: (state: unknown) => unknown) => select({
    progress: input.progress, progressStatus: 'ready', error: null, pending: false,
    startChapter: input.startChapter, startDaily: vi.fn(), load: vi.fn(), setPlacementTier: vi.fn(), declinePlacementCheck: vi.fn(),
  }),
}));
vi.mock('@/lib/store/progression-store', () => ({ useProgressionStore: (select: (state: unknown) => unknown) => select({ snapshot: null }) }));
vi.mock('@/lib/store/operator-store', () => ({ useOperatorMode: () => false }));
vi.mock('./ChapterCard', () => ({
  default: ({ chapter, onStart, onExam, onGraduation }: { chapter: { id: string }; onStart: () => void; onExam: () => void; onGraduation?: () => void }) => {
    input.starts.set(chapter.id, onStart);
    input.exams.set(chapter.id, onExam);
    if (onGraduation) input.graduations.set(chapter.id, onGraduation);
    return null;
  },
}));
vi.mock('./DailyDrillsCard', () => ({ default: () => null }));
vi.mock('./ReviewNotePanel', () => ({ default: () => null }));
vi.mock('./PlacementSheet', () => ({ default: () => null }));

beforeEach(() => {
  input.startChapter.mockClear();
  input.starts.clear();
  input.exams.clear();
  input.graduations.clear();
  input.progress = {
    chapters: ['act1-ch01', 'act4-ch12'].map(chapterId => ({ chapterId, attempts: 0, completions: 0, bestGrade: null, unlocked: true })),
    flags: {}, belt: 'white', nextChapterId: 'act1-ch01', drillStats: { total: 0, correct: 0, byCategory: {} }, reviewQueue: 0,
    daily: { date: '2026-10-20', done: 0, total: 3, available: false, teacherId: null }, activeRun: null,
  };
});

describe('StoryHub placement', () => {
  it('배치 전에는 측정 진입점을 보여 주고 기존 full 수련을 시작한다', () => {
    const markup = renderToStaticMarkup(<StoryHub />);
    expect(markup).toContain('실력 측정하기');
    input.starts.get('act1-ch01')!();
    expect(input.startChapter).toHaveBeenCalledWith('act1-ch01', 'full');
  });

  it.each([
    ['beginner', '입문', 'full'], ['novice', '초급', 'full'], ['advanced', '숙련 · 빠른 진행', 'fast'],
  ])('%s 단계를 표시하고 단계에 맞는 모드를 보낸다', (tier, label, mode) => {
    input.progress!.flags = { 'placement:tier': tier };
    const markup = renderToStaticMarkup(<StoryHub />);
    expect(markup).toContain(`내 수련 단계: ${label}`);
    expect(markup).toContain('바꾸기');
    expect(markup).toContain('다시 측정');
    input.starts.get('act1-ch01')!();
    expect(input.startChapter).toHaveBeenCalledWith('act1-ch01', mode);
  });

  it('숙련이어도 졸업 수업은 full, 문제만 풀기와 졸업 재도전은 지정 모드를 유지한다', () => {
    input.progress!.flags = { 'placement:tier': 'advanced' };
    renderToStaticMarkup(<StoryHub />);
    input.starts.get('act4-ch12')!();
    input.exams.get('act1-ch01')!();
    input.graduations.get('act4-ch12')!();
    expect(input.startChapter.mock.calls).toEqual([
      ['act4-ch12', 'full'], ['act1-ch01', 'exam'], ['act4-ch12', 'graduation'],
    ]);
  });

  it.each([
    [{ 'placement:tier': 'novice', 'placement:check': 'pending' }, 1, true],
    [{ 'placement:tier': 'beginner', 'placement:check': 'pending' }, 1, true],
    [{ 'placement:tier': 'novice', 'placement:check': 'pending' }, 0, false],
    [{ 'placement:tier': 'advanced', 'placement:check': 'pending' }, 1, false],
    [{ 'placement:tier': 'novice', 'placement:check': 'declined' }, 1, false],
    [{ 'placement:tier': 'novice' }, 1, false],
  ])('Ch1 뒤 빠르게 가기 초대 %j (Ch1 완료 %i) → %s', (flags, completions, shown) => {
    input.progress!.flags = flags;
    input.progress!.chapters[0].completions = completions;
    const markup = renderToStaticMarkup(<StoryHub />);
    expect(markup.includes('규칙을 이미 아신다면 4문만 풀고 다음 수업부터 빠르게 가요.')).toBe(shown);
    // 다시 측정(전체 측정) 진입점은 그대로 남는다
    expect(markup).toContain('다시 측정');
  });
});
