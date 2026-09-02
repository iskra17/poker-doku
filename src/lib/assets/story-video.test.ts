import { describe, expect, it } from 'vitest';
import { getStoryVideo, hasStoryVideo } from './story-video';

describe('story-video 매니페스트', () => {
  it('미등록 id는 null — 뷰어는 정지 CG로 폴백', () => {
    expect(getStoryVideo('story-cg-act1-belt-white')).toBeNull();
    expect(getStoryVideo(null)).toBeNull();
    expect(getStoryVideo(undefined)).toBeNull();
    expect(hasStoryVideo('nope')).toBe(false);
  });
});
