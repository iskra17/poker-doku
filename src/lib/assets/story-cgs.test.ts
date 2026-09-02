import { describe, expect, it } from 'vitest';
import { STORY_CHAPTERS } from '@/lib/story/chapters';
import type { Chapter, SceneSayLine } from '@/lib/story/types';
import { getSceneCg, isSceneCgId, listSceneCgSources, SCENE_CG_IDS, sceneCgChapterId } from './story-cgs';

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
    expect(SCENE_CG_IDS.length).toBe(12);
    expect(getSceneCg('nope')).toBeNull();
    expect(getSceneCg(undefined)).toBeNull();
    // 배치 여부와 무관하게 경로 규약은 고정
    for (const id of SCENE_CG_IDS) {
      const cg = getSceneCg(id);
      if (cg) expect(cg.src).toBe(`/assets/story/cg/scene-${id}.webp`);
    }
    expect(listSceneCgSources(['nope', undefined])).toEqual([]);
  });
});
