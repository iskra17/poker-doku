import { describe, expect, it } from 'vitest';
import { getStoryVideo, hasStoryVideo } from './story-video';

describe('story-video 매니페스트', () => {
  it('미등록 id는 null — 뷰어는 정지 CG로 폴백', () => {
    expect(getStoryVideo('scene-act1-ch01-prologue')).toBeNull();
    expect(getStoryVideo(null)).toBeNull();
    expect(getStoryVideo(undefined)).toBeNull();
    expect(hasStoryVideo('nope')).toBe(false);
  });

  it('등록된 파일럿 클립은 webm/mp4 경로 쌍을 준다', () => {
    expect(getStoryVideo('story-cg-act1-belt-yellow')).toEqual({
      webm: '/assets/story/video/story-cg-act1-belt-yellow.webm',
      mp4: '/assets/story/video/story-cg-act1-belt-yellow.mp4',
    });
    expect(hasStoryVideo('story-cg-act1-draco-boss')).toBe(true);
    expect(hasStoryVideo('sakura-scene-lv5')).toBe(true);
  });

  it('2차 배치(2026-09-04) 클립도 등록돼 있다', () => {
    expect(hasStoryVideo('story-cg-act1-belt-white')).toBe(true);
    expect(hasStoryVideo('story-cg-act1-sakura-garden')).toBe(true);
    expect(hasStoryVideo('story-cg-act2-paeng-boss')).toBe(true);
    expect(hasStoryVideo('story-cg-act2-ara-victory')).toBe(true);
    expect(hasStoryVideo('story-cg-act2-belt-blue')).toBe(true);
    expect(hasStoryVideo('vivian-scene-lv5')).toBe(true);
  });
});
