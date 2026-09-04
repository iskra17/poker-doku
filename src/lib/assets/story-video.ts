/**
 * 컷신 영상 매니페스트 — CG id → 짧은 앰비언트 루프(약 4.4초·24fps·768×1152, 첫 프레임 = 끝 프레임 = CG라 이음새 없이 반복).
 * 생성은 RTX 5090 로컬 ComfyUI의 MiniMax H3 fl2va(first_frame=last_frame=CG, turbo 8-step LoRA) — 절차·프롬프트는
 * `scripts/art/story-video.md`. 파일: `public/assets/story/video/<cgId>.webm`(VP9 crf32) + `.mp4`(H.264 crf26) — 각 ≤2.5MB.
 * `VIDEO_AVAILABLE`에 없으면 null → 뷰어는 정지 CG. 등록 = 파일 2개 + id 한 줄.
 * id 규약: 보상 CG는 카탈로그 아이템 id(`story-cg-…`), 인연 씬은 `<character>-scene-lv<N>`,
 * 챕터 씬 CG는 `scene-<SceneCgId>`(= `public/assets/story/cg/scene-<id>.webp` 파일명, `sceneCgVideoId`).
 */
export interface StoryVideo {
  webm: string;
  mp4: string;
}

/** 씬 CG(`story-cgs.ts` id) → 영상 id. ScenePlayer 라인 CG와 기록실 SCENE CG 뷰어가 같은 규약을 쓴다. */
export function sceneCgVideoId(sceneCgId: string): string {
  return `scene-${sceneCgId}`;
}

/**
 * 실제로 배치된 클립 id — 2026-09-03 파일럿 3클립 + 2026-09-04 2~4차 배치(보상 CG·인연 씬·씬 CG 18).
 * 49클립 = 보상 CG 7종 · 인연 씬 6명×4레벨 · 챕터 프롤로그/클라이맥스/에필로그 씬 CG 18장 전부.
 */
const VIDEO_AVAILABLE: ReadonlySet<string> = new Set<string>([
  // 보상 CG (카탈로그 아이템 id)
  'story-cg-act1-belt-white',
  'story-cg-act1-belt-yellow',
  'story-cg-act1-draco-boss',
  'story-cg-act1-sakura-garden',
  'story-cg-act2-paeng-boss',
  'story-cg-act2-ara-victory',
  'story-cg-act2-belt-blue',
  // 인연 씬 (<character>-scene-lv<N>)
  'sakura-scene-lv5', 'sakura-scene-lv10', 'sakura-scene-lv15', 'sakura-scene-lv20',
  'ara-scene-lv5', 'ara-scene-lv10', 'ara-scene-lv15', 'ara-scene-lv20',
  'hana-scene-lv5', 'hana-scene-lv10', 'hana-scene-lv15', 'hana-scene-lv20',
  'chloe-scene-lv5', 'chloe-scene-lv10', 'chloe-scene-lv15', 'chloe-scene-lv20',
  'vivian-scene-lv5', 'vivian-scene-lv10', 'vivian-scene-lv15', 'vivian-scene-lv20',
  'elena-scene-lv5', 'elena-scene-lv10', 'elena-scene-lv15', 'elena-scene-lv20',
  // 챕터 씬 CG (scene-<SceneCgId>)
  'scene-act1-ch01-prologue', 'scene-act1-ch01-climax', 'scene-act1-ch01-epilogue',
  'scene-act1-ch02-prologue', 'scene-act1-ch02-climax', 'scene-act1-ch02-epilogue',
  'scene-act1-ch03-prologue', 'scene-act1-ch03-climax', 'scene-act1-ch03-epilogue',
  'scene-act2-ch04-prologue', 'scene-act2-ch04-climax', 'scene-act2-ch04-epilogue',
  'scene-act2-ch05-prologue', 'scene-act2-ch05-climax', 'scene-act2-ch05-epilogue',
  'scene-act2-ch06-prologue', 'scene-act2-ch06-climax', 'scene-act2-ch06-epilogue',
]);

export function hasStoryVideo(cgId: string | null | undefined): boolean {
  return !!cgId && VIDEO_AVAILABLE.has(cgId);
}

export function getStoryVideo(cgId: string | null | undefined): StoryVideo | null {
  if (!hasStoryVideo(cgId)) return null;
  return { webm: `/assets/story/video/${cgId}.webm`, mp4: `/assets/story/video/${cgId}.mp4` };
}
