import { describe, expect, it } from 'vitest';
import type { ProgressionSnapshot } from '@/lib/progression/types';
import type { StoryProgressView } from '@/lib/story/views';
import { buildGallery, collectChapterBackgroundIds, summarizeGallery } from './catalog';
import { STORY_CHAPTERS } from '@/lib/story/chapters';

function snapshot(overrides: Partial<ProgressionSnapshot> = {}): ProgressionSnapshot {
  return {
    profile: { profileId: 'p1', selectedCharacterId: 'sakura', balanceVersion: 1 } as ProgressionSnapshot['profile'],
    affinities: [{ characterId: 'sakura', level: 5, xpMilli: 0 } as ProgressionSnapshot['affinities'][number]],
    streak: {} as ProgressionSnapshot['streak'],
    inventory: [{ itemId: 'story-cg-act1-belt-white', quantity: 1, updatedAt: 0 } as ProgressionSnapshot['inventory'][number]],
    equipment: { title: null, frame: null, skin: null, cutin: null },
    cosmetics: { cardBack: null, felt: null, outfits: {} },
    ...overrides,
  };
}

function progress(completed: string[] = []): StoryProgressView {
  return {
    chapters: STORY_CHAPTERS.map(chapter => ({ chapterId: chapter.id, attempts: 1, completions: completed.includes(chapter.id) ? 1 : 0, bestGrade: null, unlocked: true })),
    flags: {},
    belt: 'white',
    nextChapterId: null,
    drillStats: { total: 0, correct: 0, byCategory: {} },
    reviewQueue: 0,
    daily: { date: '2026-09-03', done: 0, total: 3 } as StoryProgressView['daily'],
    activeRun: null,
  };
}

describe('buildGallery', () => {
  it('보유 CG와 인연 Lv5 씬만 해금되고, 나머지는 잠김 + 조건 문구', () => {
    const entries = buildGallery({ snapshot: snapshot(), progress: progress() });
    const unlocked = entries.filter(entry => entry.unlocked).map(entry => entry.id);
    expect(unlocked).toContain('story-cg-act1-belt-white');
    expect(unlocked).toContain('bond:sakura-lv5');
    expect(unlocked.filter(id => id.startsWith('bond:'))).toHaveLength(1);
    expect(unlocked.some(id => id.startsWith('bg:'))).toBe(false);
    for (const entry of entries.filter(entry => !entry.unlocked)) expect(entry.hint.length).toBeGreaterThan(0);
    // 잠긴 CG는 컷신 payload를 그대로 들고 있어 해금 즉시 재생 가능
    expect(entries.find(entry => entry.id === 'story-cg-act1-draco-boss')?.cutscene?.kind).toBe('boss-win');
  });

  it('서버 미리보기 granted도 보유로 친다 — 인벤토리 반영 전 결산 직후 상태', () => {
    const view = { ...progress(), rewards: [{ id: 'story-outfit-sakura-dojo', kind: 'outfit', name: '사쿠라 · 도복', description: '', granted: true, requirement: '', trigger: { kind: 'chapter-first-clear', chapterId: 'act1-ch02' } }] } as StoryProgressView;
    const entries = buildGallery({ snapshot: snapshot(), progress: view });
    const outfit = entries.find(entry => entry.id === 'story-outfit-sakura-dojo');
    expect(outfit?.unlocked).toBe(true);
    expect(outfit?.art).toBe('/assets/characters/sakura/outfits/dojo/happy.webp');
  });

  it('배경은 그 배경을 쓰는 챕터를 완주해야 해금되고, 아트 미배치 id는 목록에 없다', () => {
    const locked = buildGallery({ snapshot: snapshot(), progress: progress() });
    const study = locked.find(entry => entry.id === 'bg:dojo-study');
    expect(study?.unlocked).toBe(false);
    expect(study?.hint).toContain('완주');
    expect(locked.some(entry => entry.id === 'bg:dojo-office')).toBe(false);
    const done = buildGallery({ snapshot: snapshot(), progress: progress(['act1-ch03']) });
    expect(done.find(entry => entry.id === 'bg:dojo-study')?.unlocked).toBe(true);
    expect(collectChapterBackgroundIds(STORY_CHAPTERS[0])).toEqual(expect.arrayContaining(['dojo-gate', 'dojo-table', 'dojo-garden-night']));
  });

  it('칭호 섹션은 도장 4종 + 스토리 3종을 항상 보여 주고 보유 아레나 칭호를 덧붙인다', () => {
    const entries = buildGallery({
      snapshot: snapshot({ inventory: [{ itemId: 'story-title-white-belt', quantity: 1, updatedAt: 0 }, { itemId: 'dojo-title-sprout-challenger', quantity: 1, updatedAt: 0 }] as ProgressionSnapshot['inventory'] }),
      progress: null,
    });
    const titles = entries.filter(entry => entry.section === 'title');
    expect(titles).toHaveLength(7);
    expect(titles.filter(entry => entry.unlocked).map(entry => entry.id).sort()).toEqual(['dojo-title-sprout-challenger', 'story-title-white-belt']);
    expect(titles.find(entry => entry.id === 'dojo-title-steady-trainee')?.hint).toBe('도장 Lv.15');
  });

  it('스냅샷·진행도가 없어도 빈 목록이 아니라 전부 잠김으로 만든다', () => {
    const entries = buildGallery({ snapshot: null, progress: null });
    expect(entries.length).toBeGreaterThan(30);
    expect(entries.every(entry => !entry.unlocked)).toBe(true);
    const summary = summarizeGallery(entries);
    expect(summary.find(row => row.section === 'bond')).toEqual({ section: 'bond', unlocked: 0, total: 24 });
    // 보상 CG 4 + 배치된 씬 CG 6(챕터 완주 해금)
    expect(summary.find(row => row.section === 'cg')?.total).toBe(10);
    expect(entries.filter(entry => entry.sceneCg)).toHaveLength(6);
  });
});
