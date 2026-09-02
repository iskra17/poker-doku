import { describe, expect, it } from 'vitest';
import { getCharacterArt, hasOutfitArt, resolveCharacterArt } from './character-art';

const manifest = {
  available: { sakura: ['neutral', 'happy', 'sad', 'thinking', 'confident', 'surprised'] as const, mochi: ['neutral', 'happy', 'sad'] as const },
  outfits: { sakura: { dojo: ['neutral', 'happy', 'confident'] as const } },
};

describe('character art outfit axis', () => {
  it('prefers the outfit art, falls back expression → fallback expression → neutral within the outfit', () => {
    expect(resolveCharacterArt(manifest, 'sakura', 'happy', 'dojo')).toBe('/assets/characters/sakura/outfits/dojo/happy.webp');
    // surprised → fallback happy (의상에 있음)
    expect(resolveCharacterArt(manifest, 'sakura', 'surprised', 'dojo')).toBe('/assets/characters/sakura/outfits/dojo/happy.webp');
    // sad → fallback sad(없음) → neutral (의상 연속성 > 표정 정확성)
    expect(resolveCharacterArt(manifest, 'sakura', 'sad', 'dojo')).toBe('/assets/characters/sakura/outfits/dojo/neutral.webp');
  });

  it('unknown outfit or a character without outfits uses the default wardrobe unchanged', () => {
    expect(resolveCharacterArt(manifest, 'sakura', 'thinking', 'yukata')).toBe('/assets/characters/sakura/thinking.webp');
    expect(resolveCharacterArt(manifest, 'mochi', 'confident', 'dojo')).toBe('/assets/characters/mochi/happy.webp');
    expect(resolveCharacterArt(manifest, 'ghost', 'neutral', null)).toBeNull();
  });

  it('runtime manifest: outfitId=null keeps the legacy path and unshipped outfits fall back (seat rendering unaffected)', () => {
    expect(getCharacterArt('sakura', 'happy')).toBe('/assets/characters/sakura/happy.webp');
    expect(getCharacterArt('sakura', 'happy', null)).toBe('/assets/characters/sakura/happy.webp');
    expect(getCharacterArt('dealer', 'thinking')).toBe('/assets/characters/miyako/neutral.webp');
    // 아트 미배치 의상은 기본 의상 경로 — CharacterImage가 깨진 이미지를 가리키지 않는다
    expect(getCharacterArt('sakura', 'happy', 'dojo')).toBe('/assets/characters/sakura/happy.webp');
    expect(hasOutfitArt('sakura', 'dojo')).toBe(false);
    expect(hasOutfitArt('nobody', 'dojo')).toBe(false);
  });
});
