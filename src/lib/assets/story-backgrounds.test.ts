import { describe, expect, it } from 'vitest';
import { STORY_CHAPTERS } from '@/lib/story/chapters';
import { DEFAULT_STORY_GRADIENT, getStoryBackground, isStoryBackgroundId, listStoryBackgroundSources } from './story-backgrounds';

describe('story backgrounds', () => {
  it('maps every bg id used by chapter data (no silent default fallback for known scenes)', () => {
    const used = new Set<string>();
    for (const chapter of STORY_CHAPTERS) {
      for (const step of chapter.steps) {
        const scenes = step.kind === 'scene' ? [step.scene] : step.kind === 'sparring' ? step.interrupts.map(interrupt => interrupt.scene) : [];
        for (const scene of scenes) for (const line of scene.lines) if (line.kind === 'say' && line.bg) used.add(line.bg);
      }
    }
    expect(used.size).toBeGreaterThan(0);
    for (const id of used) {
      expect(isStoryBackgroundId(id)).toBe(true);
      expect(getStoryBackground(id).gradientClass).not.toBe(DEFAULT_STORY_GRADIENT);
    }
  });

  it('unknown or missing ids fall back to the default gradient with no image', () => {
    expect(getStoryBackground(undefined)).toEqual({ id: null, src: null, gradientClass: DEFAULT_STORY_GRADIENT });
    expect(getStoryBackground('nope')).toEqual({ id: 'nope', src: null, gradientClass: DEFAULT_STORY_GRADIENT });
    // 1막 배경 5장은 전부 배치됨 — 미지 id만 그라디언트(src null)
    expect(getStoryBackground('dojo-office').src).toBe('/assets/story/bg/dojo-office.webp');
    expect(getStoryBackground('dojo-study').src).toBe('/assets/story/bg/dojo-study.webp');
    expect(listStoryBackgroundSources([undefined, 'nope'])).toEqual([]);
    expect(listStoryBackgroundSources(['dojo-study', 'dojo-study', 'dojo-gate'])).toEqual([
      '/assets/story/bg/dojo-study.webp',
      '/assets/story/bg/dojo-gate.webp',
    ]);
  });
});
