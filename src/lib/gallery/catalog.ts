/**
 * 기록실(갤러리) 항목 빌더 — 순수 함수. 인연 씬·이벤트 CG·의상·칭호·배경을 한 목록으로 만든다.
 *
 * 해금 소스: 인연 씬 = 스냅샷 인연 레벨, 카탈로그 보상(CG·의상·칭호) = 인벤토리 보유 ∪ 서버 미리보기 granted,
 * 도장 칭호 = 인벤토리 보유, 배경 = 그 배경을 쓰는 챕터를 하나라도 완주. 잠긴 항목도 목록에 남기고 조건 문구를 단다
 * (진행도 API가 없으면 배경·미획득 표시만 잠김 — 숨기지 않는다).
 */
import { getCharacterArt } from '@/lib/assets/character-art';
import { getStoryBackground } from '@/lib/assets/story-backgrounds';
import { getSceneCg, SCENE_CG_IDS, sceneCgChapterId } from '@/lib/assets/story-cgs';
import { getBondSceneArt, getBondScenes, isBondSceneUnlocked, type BondScene } from '@/lib/characters/bond-scenes';
import { COLLECTION_CATALOG } from '@/lib/collection/catalog';
import { resolveTitle } from '@/lib/cosmetics/titles';
import { PROGRESSION_CHARACTER_IDS, type ProgressionSnapshot } from '@/lib/progression/types';
import { STORY_CHAPTERS } from '@/lib/story/chapters';
import { STORY_REWARD_CATALOG, storyRewardRequirement, toStoryRewardCutscene } from '@/lib/story/rewards/catalog';
import type { Chapter } from '@/lib/story/types';
import type { StoryProgressView, StoryRewardCutsceneView } from '@/lib/story/views';

export type GallerySection = 'bond' | 'cg' | 'outfit' | 'title' | 'bg';

export const GALLERY_SECTIONS: readonly GallerySection[] = ['bond', 'cg', 'outfit', 'title', 'bg'];

export const GALLERY_SECTION_LABEL: Readonly<Record<GallerySection, string>> = Object.freeze({
  bond: '인연 씬',
  cg: '이벤트 CG',
  outfit: '의상',
  title: '칭호',
  bg: '배경',
});

export interface GalleryEntry {
  id: string;
  section: GallerySection;
  name: string;
  unlocked: boolean;
  /** 잠김 조건 문구 */
  hint: string;
  /** 타일 이미지 — 칭호는 null(플레이트로 그림) */
  art: string | null;
  characterId?: string;
  level?: number;
  outfitId?: string;
  /** 뷰어 payload — 인연 씬 */
  bond?: BondScene;
  /** 뷰어 payload — 스토리 CG 컷신 */
  cutscene?: StoryRewardCutsceneView;
  /** 씬 CG(챕터 완주 해금) — 뷰어는 CgStage 'SCENE CG' */
  sceneCg?: boolean;
  caption?: string;
}

export interface BuildGalleryInput {
  snapshot: ProgressionSnapshot | null;
  progress: StoryProgressView | null;
  chapters?: readonly Chapter[];
}

interface SayLike { kind?: unknown; bg?: unknown }

/** 챕터 데이터 안의 모든 say 라인 bg id — 씬 스텝·인터럽트·failScene 어디에 있든 재귀로 모은다 */
export function collectChapterBackgroundIds(chapter: Chapter): string[] {
  const out = new Set<string>();
  const visit = (value: unknown, depth: number): void => {
    if (!value || typeof value !== 'object' || depth > 8) return;
    if (Array.isArray(value)) {
      for (const item of value) visit(item, depth + 1);
      return;
    }
    const record = value as SayLike & Record<string, unknown>;
    if (record.kind === 'say' && typeof record.bg === 'string') out.add(record.bg);
    for (const child of Object.values(record)) visit(child, depth + 1);
  };
  visit(chapter.steps, 0);
  return [...out];
}

export function buildGallery({ snapshot, progress, chapters = STORY_CHAPTERS }: BuildGalleryInput): GalleryEntry[] {
  const owned = new Set<string>(snapshot?.inventory.map(item => item.itemId) ?? []);
  for (const reward of progress?.rewards ?? []) if (reward.granted) owned.add(reward.id);
  const completed = new Set(progress?.chapters.filter(chapter => chapter.completions > 0).map(chapter => chapter.chapterId) ?? []);
  const affinityLevel = new Map(snapshot?.affinities.map(affinity => [affinity.characterId, affinity.level]) ?? []);
  const entries: GalleryEntry[] = [];

  // 인연 씬 — 히로인 6명 × Lv5/10/15/20
  for (const characterId of PROGRESSION_CHARACTER_IDS) {
    const level = affinityLevel.get(characterId) ?? 1;
    for (const scene of getBondScenes(characterId)) {
      entries.push({
        id: `bond:${scene.id}`,
        section: 'bond',
        name: scene.title,
        unlocked: isBondSceneUnlocked(scene, level),
        hint: `인연 Lv.${scene.level}`,
        art: getBondSceneArt(scene),
        characterId,
        level: scene.level,
        bond: scene,
        caption: scene.caption,
      });
    }
  }

  // 스토리 보상 카탈로그 — CG·의상·칭호
  for (const item of STORY_REWARD_CATALOG) {
    const unlocked = owned.has(item.id);
    const hint = storyRewardRequirement(item, chapters);
    if (item.kind === 'cg') {
      const cutscene = toStoryRewardCutscene(item) ?? undefined;
      entries.push({ id: item.id, section: 'cg', name: item.name, unlocked, hint, art: item.art ?? null, characterId: item.characterId, cutscene, caption: cutscene?.caption });
    } else if (item.kind === 'outfit' && item.characterId) {
      const art = getCharacterArt(item.characterId, 'happy', item.outfitId ?? null) ?? getCharacterArt(item.characterId, 'happy');
      entries.push({ id: item.id, section: 'outfit', name: item.name, unlocked, hint, art, characterId: item.characterId, outfitId: item.outfitId, caption: item.description });
    } else if (item.kind === 'title') {
      entries.push({ id: item.id, section: 'title', name: item.name, unlocked, hint, art: null, caption: item.description });
    }
  }

  // 씬 CG(배치된 것만) — 그 챕터를 완주하면 다시 볼 수 있다
  for (const id of SCENE_CG_IDS) {
    const cg = getSceneCg(id);
    if (!cg) continue;
    const chapterId = sceneCgChapterId(id);
    const chapter = chapters.find(entry => entry.id === chapterId);
    entries.push({
      id: `scene-cg:${id}`,
      section: 'cg',
      name: cg.title,
      unlocked: completed.has(chapterId),
      hint: `「${chapter?.title ?? chapterId}」 완주`,
      art: cg.src,
      sceneCg: true,
      caption: chapter?.title ?? '',
    });
  }

  // 도장 레벨 칭호(항상 표시) + 보유한 그 외 칭호(아레나 시즌 등)
  for (const item of COLLECTION_CATALOG) {
    if (item.kind !== 'title' || item.equipSlot !== 'title') continue;
    if (item.source.kind !== 'dojo-level') continue;
    entries.push({ id: item.id, section: 'title', name: item.name, unlocked: owned.has(item.id), hint: `도장 Lv.${item.source.level}`, art: null, caption: item.description });
  }
  const listed = new Set(entries.map(entry => entry.id));
  for (const id of owned) {
    if (listed.has(id)) continue;
    const title = resolveTitle(id);
    if (!title) continue;
    entries.push({ id, section: 'title', name: title.name, unlocked: true, hint: '', art: null, caption: '아레나 시즌 보상' });
    listed.add(id);
  }

  // 배경 — 챕터가 쓰는 bg, 그 챕터를 완주하면 해금 (아트 미배치 id는 목록에서 제외)
  const bgUsers = new Map<string, Chapter[]>();
  for (const chapter of chapters) {
    for (const bg of collectChapterBackgroundIds(chapter)) bgUsers.set(bg, [...(bgUsers.get(bg) ?? []), chapter]);
  }
  for (const [bg, users] of bgUsers) {
    const background = getStoryBackground(bg);
    if (!background.src) continue;
    const unlocked = users.some(chapter => completed.has(chapter.id));
    entries.push({
      id: `bg:${bg}`,
      section: 'bg',
      name: BACKGROUND_NAME[bg] ?? bg,
      unlocked,
      hint: `「${users[0].title}」 완주`,
      art: background.src,
    });
  }

  return entries;
}

const BACKGROUND_NAME: Readonly<Record<string, string>> = Object.freeze({
  'dojo-gate': '도장 정문',
  'dojo-table': '수련 테이블',
  'dojo-garden-night': '밤의 정원',
  'dojo-study': '사범실',
  'dojo-office': '도장 사무실',
});

export interface GallerySectionSummary { section: GallerySection; unlocked: number; total: number }

export function summarizeGallery(entries: readonly GalleryEntry[]): GallerySectionSummary[] {
  return GALLERY_SECTIONS.map(section => {
    const items = entries.filter(entry => entry.section === section);
    return { section, unlocked: items.filter(entry => entry.unlocked).length, total: items.length };
  });
}
