import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { ChapterResultView } from '@/lib/story/views';
import { getBondScenes } from '@/lib/characters/bond-scenes';
import { partnerResultLine } from '@/lib/story/result-lines';
import RewardReveal from './RewardReveal';

const input = vi.hoisted(() => ({ reduced: true, partnerId: 'ara' as string | null }));
vi.mock('@/lib/hooks/use-reduced-motion', () => ({ usePrefersReducedMotion: () => input.reduced }));
vi.mock('@/lib/hooks/use-outfit', () => ({ useOutfitId: () => null }));
vi.mock('@/lib/store/story-store', () => ({
  useStoryStore: (select: (state: { run: { context: { partnerId: string | null } } }) => unknown) => select({ run: { context: { partnerId: input.partnerId } } }),
}));
vi.mock('@/lib/store/progression-store', () => ({
  useProgressionStore: (select: (state: { snapshot: { affinities: { characterId: string; level: number; xpMilli: number }[] } }) => unknown) => select({ snapshot: { affinities: [{ characterId: 'ara', level: 2, xpMilli: 10_000 }] } }),
}));

function result(overrides: Partial<ChapterResultView> = {}): ChapterResultView {
  return {
    chapterId: 'act1-ch01', mode: 'full', passed: true, grade: 'A',
    drill: { answered: 2, correct: 2, bestStreak: 2, hintsUsed: 0, score: 1, slots: 2, finalCorrect: 2, perfect: true, retrySkipped: false },
    live: null,
    rewards: { firstClear: true, dojoXpMilli: 100_000, affinity: [{ characterId: 'ara', milli: 50_000, levelBefore: 1, levelAfter: 2 }], badgeId: null, items: [], chips: 0, cutscene: null, next: [] },
    reviewNotesAdded: 0, nextChapterId: 'act1-ch02', beltAwarded: null,
    ...overrides,
  };
}

beforeEach(() => { input.reduced = true; input.partnerId = 'ara'; });

describe('RewardReveal', () => {
  it('빠른 진행은 배지와 일반 수련의 통과·보상 문구를 보여 준다', () => {
    const markup = renderToStaticMarkup(<RewardReveal result={result({ mode: 'fast' })} onDone={() => {}} />);
    expect(markup).toContain('빠른 진행');
    expect(markup).toContain('첫 완주 보상');
    expect(markup).toContain('통과');
    expect(markup).not.toContain('실력 확인 통과');
    expect(renderToStaticMarkup(<RewardReveal result={result()} onDone={() => {}} />)).not.toContain('빠른 진행');
  });
  it('모션 감소 시 통계 뒤 실제 파트너 초상화와 한마디를 즉시 보여 준다', () => {
    const markup = renderToStaticMarkup(<RewardReveal result={result()} onDone={() => {}} />);
    expect(markup).toContain(partnerResultLine('ara', 'pass'));
    expect(markup).toContain('alt="아라"');
    expect(markup.indexOf('파트너 한마디')).toBeGreaterThan(markup.indexOf('드릴 정확도'));
    expect(markup).toContain('다음 인연 씬 「승리의 하이파이브」 · Lv.4까지 115 XP');
    expect(markup).toContain('role="progressbar"');
    expect(markup).not.toContain(getBondScenes('ara')[1].caption);
  });
  it('보통 모션의 첫 스탬프 단계에서는 파트너 대사가 아직 안 나온다', () => {
    input.reduced = false;
    const markup = renderToStaticMarkup(<RewardReveal result={result()} onDone={() => {}} />);
    expect(markup).not.toContain('파트너 한마디');
  });
  it('미통과는 격려, S 통과는 S 대사를 고른다', () => {
    const fail = renderToStaticMarkup(<RewardReveal result={result({ passed: false, grade: 'B' })} onDone={() => {}} />);
    const s = renderToStaticMarkup(<RewardReveal result={result({ grade: 'S' })} onDone={() => {}} />);
    expect(fail).toContain(partnerResultLine('ara', 'fail'));
    expect(s).toContain(partnerResultLine('ara', 'sGrade'));
  });
  it('파트너가 없으면 중립 대사를 쓰며 졸업 대결만 재도전에는 대사를 추가하지 않는다', () => {
    input.partnerId = null;
    const fallback = renderToStaticMarkup(<RewardReveal result={result()} onDone={() => {}} />);
    const graduation = renderToStaticMarkup(<RewardReveal result={result({ mode: 'graduation' })} onDone={() => {}} />);
    expect(fallback).toContain(partnerResultLine(null, 'pass'));
    expect(graduation).not.toContain('파트너 한마디');
  });
});
