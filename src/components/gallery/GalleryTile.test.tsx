import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { GalleryEntry } from '@/lib/gallery/catalog';
import GalleryTile from './GalleryTile';

const locked: GalleryEntry = {
  id: 'bond:ara-lv5', section: 'bond', name: '연습실', unlocked: false, hint: '인연 Lv.2',
  art: '/assets/characters/ara/scene-lv5.webp', characterId: 'ara', characterName: '아라', title: '연습실',
};

describe('GalleryTile 잠금 예고', () => {
  it('잠긴 인연 씬은 인물·제목·조건과 흐린 썸네일만 보여 주고 열 수 없다', () => {
    const markup = renderToStaticMarkup(<GalleryTile entry={locked} />);
    for (const copy of ['아라', '연습실', '인연 Lv.2', '🔒']) expect(markup).toContain(copy);
    expect(markup).toContain('blur-md');
    expect(markup).toContain('brightness-75');
    expect(markup).not.toContain('<button');
  });

  it('해금되면 선명한 썸네일 버튼이 되고, 잠긴 의상·칭호는 기존 🔒 칸을 유지한다', () => {
    const open = renderToStaticMarkup(<GalleryTile entry={{ ...locked, unlocked: true }} isNew />);
    expect(open).toContain('<button');
    expect(open).not.toContain('blur-md');
    expect(open).toContain('NEW');
    const outfit = renderToStaticMarkup(<GalleryTile entry={{ ...locked, id: 'o', section: 'outfit', name: '아라 · 저지', hint: 'S등급' }} />);
    expect(outfit).not.toContain('blur-md');
    expect(outfit).toContain('S등급');
  });
});
