import { describe, expect, it } from 'vitest';
import {
  getMusicTrack,
  isMusicMood,
  moodFallbackChain,
  MUSIC_MOODS,
  MUSIC_TRACKS,
  normalizeMood,
  pickTrack,
  ROTATING_MOODS,
  tracksForMood,
} from './music-library';

describe('music-library 매니페스트', () => {
  it('id는 유일하고 파일 경로는 /assets/music/ 아래 mp3, mood는 유니온 안', () => {
    const ids = MUSIC_TRACKS.map(track => track.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const track of MUSIC_TRACKS) {
      expect(track.file).toMatch(/^\/assets\/music\/[a-z0-9-]+\.mp3$/);
      expect(isMusicMood(track.mood)).toBe(true);
      if (track.loopStart !== undefined || track.loopEnd !== undefined) {
        expect(track.loopEnd ?? Infinity).toBeGreaterThan(track.loopStart ?? 0);
      }
    }
  });

  it('모든 mood에 트랙이 최소 1개, 로비·테이블은 3곡(순환 대상)', () => {
    for (const mood of MUSIC_MOODS) expect(tracksForMood(mood).length).toBeGreaterThanOrEqual(1);
    expect(tracksForMood('lobby')).toHaveLength(3);
    expect(tracksForMood('table')).toHaveLength(3);
    expect(ROTATING_MOODS.has('lobby')).toBe(true);
    expect(ROTATING_MOODS.has('story-calm')).toBe(false);
    // 기존 4파일은 그대로 참조 — 배포된 세션이 새 파일 없이도 깨지지 않는다
    expect(getMusicTrack('lobby-sakura-morning')?.file).toBe('/assets/music/lobby.mp3');
    expect(getMusicTrack('victory-fanfare')?.loop).toBe(false);
  });

  it("예전 장면 키 'story'는 story-calm으로, 모르는 값은 lobby", () => {
    expect(normalizeMood('story')).toBe('story-calm');
    expect(normalizeMood('story-tense')).toBe('story-tense');
    expect(normalizeMood('nope')).toBe('lobby');
  });
});

describe('pickTrack', () => {
  const none = new Set<string>();

  it('지정 트랙이 살아 있으면 그 트랙, 불가면 auto처럼', () => {
    expect(pickTrack('lobby', 'lobby-rainy-piano', null, none, () => 0)?.id).toBe('lobby-rainy-piano');
    expect(pickTrack('lobby', 'lobby-rainy-piano', null, new Set(['lobby-rainy-piano']), () => 0)?.id).toBe('lobby-sakura-morning');
    expect(pickTrack('lobby', 'not-a-track', null, none, () => 0)?.id).toBe('lobby-sakura-morning');
  });

  it('auto는 직전 곡을 제외하고 고른다 — 곡이 하나뿐이면 같은 곡', () => {
    for (let i = 0; i < 20; i++) {
      expect(pickTrack('lobby', 'auto', 'lobby-sakura-morning', none)?.id).not.toBe('lobby-sakura-morning');
    }
    expect(pickTrack('victory', 'auto', 'victory-fanfare', none)?.id).toBe('victory-fanfare');
    expect(pickTrack('lobby', 'auto', null, none, () => 0.99)?.id).toBe('lobby-rainy-piano');
  });

  it('후보가 전부 불가면 null → mood 폴백 체인은 lobby로 끝난다', () => {
    expect(pickTrack('tension', 'auto', null, new Set(['tension-allin', 'tension-allin-drums']))).toBeNull();
    expect(moodFallbackChain('story-warm')).toEqual(['story-warm', 'story-calm', 'lobby']);
    expect(moodFallbackChain('story-triumph')).toEqual(['story-triumph', 'victory', 'lobby']);
    expect(moodFallbackChain('tension')).toEqual(['tension', 'table', 'lobby']);
    expect(moodFallbackChain('lobby')).toEqual(['lobby']);
  });
});
