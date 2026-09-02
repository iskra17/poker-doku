import { describe, expect, it } from 'vitest';
import { STINGER_FALLBACK, STINGER_FILE, stingerFallbackEffect } from './stingers';

describe('stingers', () => {
  it('징글 4종은 파일 경로 규약과 합성 폴백을 모두 가진다', () => {
    const names = Object.keys(STINGER_FILE);
    expect(names.sort()).toEqual(['belt-up', 'chapter-clear', 'level-up', 'perfect']);
    for (const name of names as Array<keyof typeof STINGER_FILE>) {
      expect(STINGER_FILE[name]).toBe(`/assets/music/stinger-${name}.mp3`);
      expect(STINGER_FALLBACK[name]).toBeTruthy();
      expect(stingerFallbackEffect(name)).toBe(STINGER_FALLBACK[name]);
    }
  });
});
