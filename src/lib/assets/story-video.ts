/**
 * 컷신 영상 매니페스트 — CG id → 짧은 앰비언트 루프(약 4.4초·24fps·768×1152, 첫 프레임 = 끝 프레임 = CG라 이음새 없이 반복).
 * 생성은 RTX 5090 로컬 ComfyUI의 MiniMax H3 fl2va(first_frame=last_frame=CG, turbo 8-step LoRA) — 절차·프롬프트는
 * `scripts/art/story-video.md`. 파일: `public/assets/story/video/<cgId>.webm`(VP9 crf32) + `.mp4`(H.264 crf26) — 각 ≤2.5MB.
 * `VIDEO_AVAILABLE`에 없으면 null → 뷰어는 정지 CG. 등록 = 파일 2개 + id 한 줄.
 * id 규약: 보상 CG는 카탈로그 아이템 id(`story-cg-…`), 인연 씬은 `<character>-scene-lv<N>`.
 */
export interface StoryVideo {
  webm: string;
  mp4: string;
}

/** 실제로 배치된 클립 id — 2026-09-03 파일럿 3클립 + 2026-09-04 2차 배치(보상 CG·비비안 Lv5) */
const VIDEO_AVAILABLE: ReadonlySet<string> = new Set<string>([
  'story-cg-act1-belt-yellow',
  'story-cg-act1-draco-boss',
  'sakura-scene-lv5',
  'story-cg-act1-belt-white',
  'story-cg-act1-sakura-garden',
  'story-cg-act2-paeng-boss',
  'story-cg-act2-ara-victory',
  'story-cg-act2-belt-blue',
  'vivian-scene-lv5',
]);

export function hasStoryVideo(cgId: string | null | undefined): boolean {
  return !!cgId && VIDEO_AVAILABLE.has(cgId);
}

export function getStoryVideo(cgId: string | null | undefined): StoryVideo | null {
  if (!hasStoryVideo(cgId)) return null;
  return { webm: `/assets/story/video/${cgId}.webm`, mp4: `/assets/story/video/${cgId}.mp4` };
}
