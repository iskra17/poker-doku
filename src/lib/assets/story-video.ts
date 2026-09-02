/**
 * 컷신 영상 매니페스트 — CG id → 짧은 앰비언트 루프(3~4초, RTX 5090 로컬 Wan 2.2 I2V로 생성, 첫 프레임 = CG).
 * 파일: `public/assets/story/video/<cgId>.webm`(VP9) + `.mp4`(H.264) — 각 ≤2.5MB.
 * `VIDEO_AVAILABLE`에 없으면 null → 뷰어는 정지 CG. 등록 = 파일 2개 + id 한 줄.
 */
export interface StoryVideo {
  webm: string;
  mp4: string;
}

/** 실제로 배치된 클립 id — 파일럿 후 추가 */
const VIDEO_AVAILABLE: ReadonlySet<string> = new Set<string>([]);

export function hasStoryVideo(cgId: string | null | undefined): boolean {
  return !!cgId && VIDEO_AVAILABLE.has(cgId);
}

export function getStoryVideo(cgId: string | null | undefined): StoryVideo | null {
  if (!hasStoryVideo(cgId)) return null;
  return { webm: `/assets/story/video/${cgId}.webm`, mp4: `/assets/story/video/${cgId}.mp4` };
}
