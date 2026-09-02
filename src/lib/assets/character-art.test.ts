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
    // 미야코 thinking/confident/surprised는 2026-09-03 아트 배치로 실물 — 폴백은 없는 표정(sad→sad 그대로)만
    expect(getCharacterArt('dealer', 'thinking')).toBe('/assets/characters/miyako/thinking.webp');
    expect(getCharacterArt('mochi', 'thinking')).toBe('/assets/characters/mochi/neutral.webp');
    // 아트 미배치 의상은 기본 의상 경로 — CharacterImage가 깨진 이미지를 가리키지 않는다
    // 배치된 의상(사쿠라 도복·하나 가운)은 의상 경로, 미배치 의상 id는 기본 의상으로 폴백
    expect(getCharacterArt('sakura', 'happy', 'dojo')).toBe('/assets/characters/sakura/outfits/dojo/happy.webp');
    expect(getCharacterArt('sakura', 'happy', 'nope')).toBe('/assets/characters/sakura/happy.webp');
    expect(hasOutfitArt('sakura', 'dojo')).toBe(true);
    expect(hasOutfitArt('hana', 'lab')).toBe(true);
    expect(hasOutfitArt('sakura', 'lab')).toBe(false);
    expect(hasOutfitArt('nobody', 'dojo')).toBe(false);
  });
});
