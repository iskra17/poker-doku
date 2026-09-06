import { describe, expect, it } from 'vitest';
import type { ProgressionSnapshot } from '@/lib/progression/types';
import type { StoryProgressView } from '@/lib/story/views';
import { buildGallery, collectChapterBackgroundIds, summarizeGallery } from './catalog';
import { newEntries } from './seen';
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
    // dojo-office는 2막 Ch5 에필로그가 쓴다 — 배치됐고 그 챕터 완주 전엔 잠김
    const office = locked.find(entry => entry.id === 'bg:dojo-office');
    expect(office?.unlocked).toBe(false);
    expect(office?.hint).toContain('완주');
    const done = buildGallery({ snapshot: snapshot(), progress: progress(['act1-ch03']) });
    expect(done.find(entry => entry.id === 'bg:dojo-study')?.unlocked).toBe(true);
    expect(collectChapterBackgroundIds(STORY_CHAPTERS[0])).toEqual(expect.arrayContaining(['dojo-gate', 'dojo-table', 'dojo-garden-night']));
  });

  it('칭호 섹션은 도장 4종 + 스토리 10종을 항상 보여 주고 보유 아레나 칭호를 덧붙인다', () => {
    const entries = buildGallery({
      snapshot: snapshot({ inventory: [{ itemId: 'story-title-white-belt', quantity: 1, updatedAt: 0 }, { itemId: 'dojo-title-sprout-challenger', quantity: 1, updatedAt: 0 }] as ProgressionSnapshot['inventory'] }),
      progress: null,
    });
    const titles = entries.filter(entry => entry.section === 'title');
    expect(titles).toHaveLength(16);
    expect(titles.find(entry => entry.id === 'story-title-unmasker')?.unlocked).toBe(false);
    expect(titles.filter(entry => entry.unlocked).map(entry => entry.id).sort()).toEqual(['dojo-title-sprout-challenger', 'story-title-white-belt']);
    expect(titles.find(entry => entry.id === 'dojo-title-steady-trainee')?.hint).toBe('도장 Lv.15');
  });

  it('스냅샷·진행도가 없어도 빈 목록이 아니라 전부 잠김으로 만든다', () => {
    const entries = buildGallery({ snapshot: null, progress: null });
    expect(entries.length).toBeGreaterThan(30);
    expect(entries.every(entry => !entry.unlocked)).toBe(true);
    const summary = summarizeGallery(entries);
    expect(summary.find(row => row.section === 'bond')).toEqual({ section: 'bond', unlocked: 0, total: 24 });
    // 보상 CG 9 + 기존 씬 CG 18 + 첫 공급 씬 CG 8(챕터 완주 해금)
    expect(summary.find(row => row.section === 'cg')?.total).toBe(35);
    expect(entries.filter(entry => entry.sceneCg)).toHaveLength(26);
  });
  it('새 일반 CG는 해당 챕터 완주로만 해금하며 미완료 Ch9도 잠긴 채 노출한다', () => {
    const before = buildGallery({ snapshot: snapshot(), progress: progress(['act1-ch02']) });
    expect(before.find(entry => entry.id === 'scene-cg:act1-ch02-garden-walk')?.unlocked).toBe(true);
    expect(before.find(entry => entry.id === 'scene-cg:act3-ch09-river-walk')?.unlocked).toBe(false);
    const completed = progress();
    completed.chapters = [...completed.chapters.filter(ch => ch.chapterId !== 'act3-ch09'), { chapterId: 'act3-ch09', attempts: 1, completions: 1, bestGrade: null, unlocked: true }];
    const after = buildGallery({ snapshot: snapshot(), progress: completed });
    expect(after.find(entry => entry.id === 'scene-cg:act3-ch09-river-walk')?.unlocked).toBe(true);
    expect(after.find(entry => entry.id === 'scene-cg:act1-ch02-garden-walk')?.unlocked).toBe(false);
  });
});

describe('buildGallery — 보너스 CG 섹션', () => {
  it('보너스 CG 50장은 별도 섹션이고 기존 이벤트 CG 집계를 건드리지 않는다', () => {
    const entries = buildGallery({ snapshot: snapshot(), progress: progress() });
    const bonus = entries.filter(entry => entry.section === 'bonus');
    expect(bonus).toHaveLength(50);
    expect(summarizeGallery(entries).find(row => row.section === 'cg')?.total).toBe(35);
    expect(bonus.every(entry => entry.id.startsWith('story-bonus-cg-'))).toBe(true);
    // 타일은 잠긴 상태에서도 컷신 payload를 들고 있어 해금 즉시 재생된다
    const sakuraCasual = bonus.find(entry => entry.id === 'story-bonus-cg-sakura-casual')!;
    expect(sakuraCasual.unlocked).toBe(false);
    expect(sakuraCasual.hint).toBe('사쿠라 인연 Lv.4');
    expect(sakuraCasual.cutscene?.kind).toBe('event-cg');
    expect(sakuraCasual.art).toBe('/assets/story/cg/bonus-sakura-casual.webp');
    // 비히로인도 subjectId로 그룹핑된다
    expect(bonus.find(entry => entry.id === 'story-bonus-cg-yuzuki-beach')).toMatchObject({
      characterId: 'yuzuki', hint: '도장 Lv.50',
    });
  });

  it('보유하면 해금 + NEW 후보가 된다', () => {
    const owned = snapshot({
      inventory: [{ itemId: 'story-bonus-cg-lin-casual', quantity: 1, updatedAt: 0 }] as ProgressionSnapshot['inventory'],
    });
    const entries = buildGallery({ snapshot: owned, progress: progress() });
    expect(entries.find(entry => entry.id === 'story-bonus-cg-lin-casual')?.unlocked).toBe(true);
    expect(newEntries(entries, new Set()).map(entry => entry.id)).toContain('story-bonus-cg-lin-casual');
    expect(newEntries(entries, new Set(['story-bonus-cg-lin-casual'])).map(entry => entry.id))
      .not.toContain('story-bonus-cg-lin-casual');
  });

  it('운영자 unlockAll은 보너스 섹션도 함께 연다', () => {
    const all = buildGallery({ snapshot: snapshot(), progress: progress(), unlockAll: true });
    expect(all.filter(entry => entry.section === 'bonus').every(entry => entry.unlocked)).toBe(true);
    expect(summarizeGallery(all).find(row => row.section === 'bonus')).toEqual({ section: 'bonus', unlocked: 50, total: 50 });
  });
});

describe('buildGallery unlockAll (운영자 미리보기)', () => {
  it('모든 항목을 해금 상태로 돌려주되 조건 문구·id·섹션은 그대로다', () => {
    const real = buildGallery({ snapshot: snapshot(), progress: progress() });
    const all = buildGallery({ snapshot: snapshot(), progress: progress(), unlockAll: true });
    expect(all).toHaveLength(real.length);
    expect(all.every(entry => entry.unlocked)).toBe(true);
    expect(all.map(entry => entry.id)).toEqual(real.map(entry => entry.id));
    const lockedBefore = real.find(entry => !entry.unlocked)!;
    const same = all.find(entry => entry.id === lockedBefore.id)!;
    expect(same.hint).toBe(lockedBefore.hint);
    expect(same.section).toBe(lockedBefore.section);
    expect(summarizeGallery(all).every(row => row.unlocked === row.total)).toBe(true);
  });
});
