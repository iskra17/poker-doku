import { describe, expect, it } from 'vitest';
import { getStoryVideo, hasStoryVideo, sceneCgVideoId } from './story-video';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';

describe('story-video 매니페스트', () => {
  it('검수된 일반 영상2개는 완료된 쌍 영수증 및 실제 파일 해시와 일치한다', () => {
    const supply = JSON.parse(readFileSync(resolve('scripts/art/library/recipes/first-video-supply-20260905.json'), 'utf8'));
    const jobs = ['sakura-victory-video-v1', 'elena-river-walk-video-v1'];
    for (const [index, id] of ['scene-act1-ch02-victory', 'scene-act3-ch09-river-walk'].entries()) {
      const pair = supply.pairs.find((entry: { job_id: string }) => entry.job_id === jobs[index]);
      expect(pair.state).toBe('complete');
      const media = getStoryVideo(id)!;
      for (const format of ['mp4', 'webm'] as const) {
        const path = resolve(`public${media[format]}`);
        expect(existsSync(path)).toBe(true);
        expect(statSync(path).size).toBeLessThanOrEqual(2_500_000);
        expect(createHash('sha256').update(readFileSync(path)).digest('hex')).toBe(pair.definition.parts[format].media.sha256);
        expect(pair.definition.parts[format].media.frames).toBe(106);
      }
    }
    expect(hasStoryVideo('scene-act1-ch02-rain-veranda')).toBe(false);
  });
  it('미등록 id는 null — 뷰어는 정지 CG로 폴백', () => {
    expect(getStoryVideo('scene-act9-ch99-prologue')).toBeNull();
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

  it('씬 CG 영상 id는 파일명 규약 scene-<SceneCgId>', () => {
    expect(sceneCgVideoId('act1-ch01-prologue')).toBe('scene-act1-ch01-prologue');
  });

  it('3차 배치(2026-09-04) — 인연 씬 6명×4레벨과 씬 CG 12장이 전부 등록돼 있다', () => {
    for (const character of ['sakura', 'ara', 'hana', 'chloe', 'vivian', 'elena']) {
      for (const level of [5, 10, 15, 20]) {
        expect(hasStoryVideo(`${character}-scene-lv${level}`), `${character} lv${level}`).toBe(true);
      }
    }
    for (const chapter of ['act1-ch01', 'act1-ch02', 'act1-ch03', 'act2-ch04', 'act2-ch05', 'act2-ch06']) {
      for (const part of ['prologue', 'epilogue']) {
        expect(getStoryVideo(sceneCgVideoId(`${chapter}-${part}`))).toEqual({
          webm: `/assets/story/video/scene-${chapter}-${part}.webm`,
          mp4: `/assets/story/video/scene-${chapter}-${part}.mp4`,
        });
      }
    }
  });
});
