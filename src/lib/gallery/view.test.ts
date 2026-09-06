import { describe, expect, it } from 'vitest';
import type { ProgressionSnapshot } from '@/lib/progression/types';
import { buildGallery } from './catalog';
import { selectGalleryView, shouldReloadOnOpen } from './view';

/** 보너스 CG 2장을 보유한 스냅샷 — 하나는 히로인(인연), 하나는 비히로인(도장) */
function snapshot(): ProgressionSnapshot {
  return {
    profile: { profileId: 'p1', selectedCharacterId: 'sakura', balanceVersion: 1 } as ProgressionSnapshot['profile'],
    // 인연 Lv.1 — 해금된 것이 보유 CG 3장뿐이라 NEW·기준선 단언이 정확해진다
    affinities: [{ characterId: 'sakura', level: 1, xpMilli: 0 } as ProgressionSnapshot['affinities'][number]],
    streak: {} as ProgressionSnapshot['streak'],
    inventory: [
      { itemId: 'story-cg-act1-belt-white', quantity: 1, updatedAt: 0 },
      { itemId: 'story-bonus-cg-sakura-casual', quantity: 1, updatedAt: 0 },
      { itemId: 'story-bonus-cg-miyako-casual', quantity: 1, updatedAt: 0 },
    ] as ProgressionSnapshot['inventory'],
    equipment: { title: null, frame: null, skin: null, cutin: null },
    cosmetics: { cardBack: null, felt: null, outfits: {} },
  };
}

function view(showBonusCg: boolean, seen: ReadonlySet<string> = new Set(), preview = false) {
  const real = buildGallery({ snapshot: snapshot(), progress: null });
  return selectGalleryView({
    real,
    previewEntries: preview ? buildGallery({ snapshot: snapshot(), progress: null, unlockAll: true }) : null,
    seen,
    showBonusCg,
  });
}

describe('selectGalleryView — 보너스 CG 표시 토글', () => {
  it('켜면 보너스 섹션이 목록·집계에 들어간다', () => {
    const on = view(true);
    expect(on.entries.filter(entry => entry.section === 'bonus')).toHaveLength(50);
    expect(on.summary.find(row => row.section === 'bonus')).toEqual({ section: 'bonus', unlocked: 2, total: 50 });
  });

  it('끄면 목록·집계·NEW에서 함께 빠지고 빈 탭도 만들지 않는다', () => {
    const off = view(false);
    expect(off.entries.some(entry => entry.section === 'bonus')).toBe(false);
    expect(off.summary.some(row => row.section === 'bonus')).toBe(false);
    expect([...off.newIds].some(id => id.startsWith('story-bonus-cg-'))).toBe(false);
    // 다른 섹션 집계는 그대로
    expect(off.summary.find(row => row.section === 'cg')).toEqual(view(true).summary.find(row => row.section === 'cg'));
  });

  it('NEW는 표시 중인 해금분만, 기준선은 숨긴 보너스까지 전부 담는다', () => {
    const on = view(true);
    expect([...on.newIds].sort()).toEqual([
      'story-bonus-cg-miyako-casual', 'story-bonus-cg-sakura-casual', 'story-cg-act1-belt-white',
    ]);
    const off = view(false);
    expect([...off.newIds]).toEqual(['story-cg-act1-belt-white']);
    // [모두 확인]이 쓰는 집합은 보이는 것만 — 숨긴 보너스를 조용히 "본 것"으로 만들지 않는다
    expect(off.unlockedIds).toEqual(['story-cg-act1-belt-white']);
    // 기준선은 표시 설정과 무관 — 토글을 껐다 켜도 NEW 기준이 흔들리지 않는다
    expect(off.baselineIds.sort()).toEqual(on.baselineIds.sort());
    expect(off.baselineIds).toContain('story-bonus-cg-sakura-casual');
  });

  it('본 항목은 NEW에서 빠진다', () => {
    const seen = new Set(['story-bonus-cg-sakura-casual', 'story-cg-act1-belt-white']);
    expect([...view(true, seen).newIds]).toEqual(['story-bonus-cg-miyako-casual']);
  });

  it('운영자 미리보기는 전부 해금 표시하되 NEW·[모두 확인]은 실제 해금만 본다', () => {
    const preview = view(true, new Set(), true);
    expect(preview.entries.every(entry => entry.unlocked)).toBe(true);
    expect(preview.summary.find(row => row.section === 'bonus')).toEqual({ section: 'bonus', unlocked: 50, total: 50 });
    expect(preview.unlockedIds.sort()).toEqual([
      'story-bonus-cg-miyako-casual', 'story-bonus-cg-sakura-casual', 'story-cg-act1-belt-white',
    ]);
    expect([...preview.newIds].sort()).toEqual(preview.unlockedIds.sort());
  });

  it('운영자 미리보기에서도 표시 설정은 그대로 적용된다', () => {
    const preview = view(false, new Set(), true);
    expect(preview.entries.some(entry => entry.section === 'bonus')).toBe(false);
    expect(preview.baselineIds).toContain('story-bonus-cg-miyako-casual');
  });
});

describe('shouldReloadOnOpen', () => {
  it('열릴 때마다 다시 부른다 — 이미 읽어 둔 ready 상태도 포함', () => {
    expect(shouldReloadOnOpen(true, 'idle')).toBe(true);
    expect(shouldReloadOnOpen(true, 'ready')).toBe(true);
    expect(shouldReloadOnOpen(true, 'error')).toBe(true);
  });

  it('닫혀 있거나 이미 요청 중이면 부르지 않는다', () => {
    expect(shouldReloadOnOpen(false, 'ready')).toBe(false);
    expect(shouldReloadOnOpen(true, 'loading')).toBe(false);
  });
});
