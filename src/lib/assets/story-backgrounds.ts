/**
 * 스토리 배경 매니페스트 — 씬 `bg` id → 이미지(있으면) + CSS 그라디언트 폴백.
 * 이미지는 `public/assets/story/bg/<id>.webp`(1280×853). 코드는 아트를 기다리지 않는다:
 * `AVAILABLE`에 없는 id는 `src: null`로 그라디언트만 쓴다(챕터 데이터의 `dojo-study`·`dojo-gate`도 여기서 매핑).
 */
export type StoryBackgroundId = 'dojo-gate' | 'dojo-table' | 'dojo-garden-night' | 'dojo-study' | 'dojo-office';

/** 실제로 배치된 이미지 id — 아트 배치 후 여기에 추가한다 (2026-09-03 1막 4장, `dojo-office`는 아직 그라디언트) */
const AVAILABLE: ReadonlySet<string> = new Set<string>(['dojo-gate', 'dojo-table', 'dojo-garden-night', 'dojo-study']);

const GRADIENT: Readonly<Record<StoryBackgroundId, string>> = Object.freeze({
  'dojo-gate': 'from-abyss via-mystic/20 to-gilded/20',
  'dojo-table': 'from-abyss via-panel to-mystic/30',
  'dojo-garden-night': 'from-abyss via-mystic/30 to-blossom/20',
  'dojo-study': 'from-abyss via-panel to-cyber/20',
  'dojo-office': 'from-abyss via-panel to-gilded/20',
});

export const DEFAULT_STORY_GRADIENT = 'from-abyss via-panel to-mystic/20';

export interface StoryBackground {
  id: string | null;
  /** 이미지 경로 — 미배치면 null(그라디언트만) */
  src: string | null;
  gradientClass: string;
}

export function isStoryBackgroundId(value: unknown): value is StoryBackgroundId {
  return typeof value === 'string' && value in GRADIENT;
}

export function getStoryBackground(id: string | null | undefined): StoryBackground {
  if (!id || !isStoryBackgroundId(id)) return { id: id ?? null, src: null, gradientClass: DEFAULT_STORY_GRADIENT };
  return {
    id,
    src: AVAILABLE.has(id) ? `/assets/story/bg/${id}.webp` : null,
    gradientClass: GRADIENT[id],
  };
}

/** 챕터가 쓰는 배경 이미지 경로들 — 챕터 시작 시 프리로드용 */
export function listStoryBackgroundSources(ids: readonly (string | undefined)[]): string[] {
  const out = new Set<string>();
  for (const id of ids) {
    const bg = getStoryBackground(id);
    if (bg.src) out.add(bg.src);
  }
  return [...out];
}
