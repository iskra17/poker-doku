import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { STORY_CHAPTERS } from '@/lib/story/chapters';
import type { Chapter, SceneSayLine } from '@/lib/story/types';
import { getSceneCg, isSceneCgId, listSceneCgSources, SCENE_CG_IDS, SCENE_CG_CHAPTER, sceneCgChapterId } from './story-cgs';

/** 챕터 데이터 안의 모든 say 라인(씬·인터럽트·선택 반응) */
function allSayLines(chapter: Chapter): SceneSayLine[] {
  const out: SceneSayLine[] = [];
  const visit = (value: unknown, depth: number): void => {
    if (!value || typeof value !== 'object' || depth > 8) return;
    if (Array.isArray(value)) { value.forEach(item => visit(item, depth + 1)); return; }
    const record = value as Record<string, unknown>;
    if (record.kind === 'say' && typeof record.text === 'string') out.push(record as unknown as SceneSayLine);
    Object.values(record).forEach(child => visit(child, depth + 1));
  };
  visit(chapter.steps, 0);
  return out;
}

describe('story-cgs 매니페스트', () => {
  it('챕터 데이터가 쓰는 cg id는 전부 등록된 유니온이고, 챕터 id와 맞는다', () => {
    for (const chapter of STORY_CHAPTERS) {
      for (const line of allSayLines(chapter)) {
        if (line.cg === undefined) continue;
        expect(isSceneCgId(line.cg)).toBe(true);
        expect(sceneCgChapterId(line.cg as never)).toBe(chapter.id);
      }
    }
  });

  it('1막 세 챕터는 프롤로그·에필로그에 cg 라인을 하나 이상 둔다 (2026-09-03 피드백 ④)', () => {
    for (const chapter of STORY_CHAPTERS.filter(entry => entry.act === 1)) {
      const ids = new Set(allSayLines(chapter).map(line => line.cg).filter(Boolean));
      expect(ids.has(`${chapter.id}-prologue`)).toBe(true);
      expect(ids.has(`${chapter.id}-epilogue`)).toBe(true);
    }
  });

  it('미배치 id는 null·프리로드 목록에서 제외 — 코드는 아트를 기다리지 않는다', () => {
    expect(SCENE_CG_IDS.length).toBe(26);
    expect(getSceneCg('nope')).toBeNull();
    expect(getSceneCg(undefined)).toBeNull();
    // 배치 여부와 무관하게 경로 규약은 고정
    for (const id of SCENE_CG_IDS) {
      const cg = getSceneCg(id);
      if (cg) expect(cg.src).toBe(`/assets/story/cg/scene-${id}.webp`);
    }
    expect(listSceneCgSources(['nope', undefined])).toEqual([]);
  });
  it('등록 ID·실제 파일·첫 공급 해시·명시 챕터 맵이 일치한다', () => {
    const files = readdirSync('public/assets/story/cg').filter(name => name.startsWith('scene-') && name.endsWith('.webp'));
    expect(files.sort()).toEqual(SCENE_CG_IDS.map(id => `scene-${id}.webp`).sort());
    expect(Object.keys(SCENE_CG_CHAPTER).sort()).toEqual([...SCENE_CG_IDS].sort());
    const supply = JSON.parse(readFileSync('scripts/art/library/recipes/first-supply-20260905.json', 'utf8')) as { exports: { scene_cg_id: string; target: string; output_sha256: string }[] };
    expect(supply.exports).toHaveLength(8);
    for (const asset of supply.exports) {
      expect(isSceneCgId(asset.scene_cg_id)).toBe(true);
      expect(getSceneCg(asset.scene_cg_id)?.src).toBe(asset.target.replace('public', ''));
      expect(createHash('sha256').update(readFileSync(asset.target)).digest('hex')).toBe(asset.output_sha256);
      expect(sceneCgChapterId(asset.scene_cg_id as never)).toBe(asset.scene_cg_id.startsWith('act1-') ? 'act1-ch02' : 'act3-ch09');
    }
  });
  it('Ch2 새 일상 씬은 기존 3개 CG를 보존하고 수련 뒤 장소 이동을 설명한다', () => {
    const chapter = STORY_CHAPTERS.find(entry => entry.id === 'act1-ch02')!;
    const index = chapter.steps.findIndex(step => step.id === 'act1-ch02:epilogue');
    expect(index).toBeGreaterThan(chapter.steps.findIndex(step => step.kind === 'sparring'));
    const lines = allSayLines(chapter);
    expect(lines.map(line => line.cg)).toEqual(expect.arrayContaining(['act1-ch02-prologue', 'act1-ch02-climax', 'act1-ch02-epilogue', 'act1-ch02-victory', 'act1-ch02-library', 'act1-ch02-garden-walk', 'act1-ch02-rain-veranda']));
    expect(lines.find(line => line.cg === 'act1-ch02-library')?.text).toContain('서재');
    expect(lines.find(line => line.cg === 'act1-ch02-garden-walk')?.text).toContain('정원');
    expect(lines.find(line => line.cg === 'act1-ch02-rain-veranda')?.text).toContain('비');
  });
});
