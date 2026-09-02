/**
 * 결산 보상 연출 플랜 — 순수 함수. `RewardReveal` 컴포넌트는 이 플랜을 그리기만 한다.
 *
 * - 서버 보상 라인(`rewards.items/chips/cutscene/next`)이 있으면 그대로, 없으면(v32 전·구 서버) 카탈로그에서
 *   "이 결산으로 자격이 생겼을 보상"을 파생한다(`fallback: true`) — 연출이 서버를 기다리지 않게.
 * - 단계는 존재하는 것만: stamp → stats → items → cutscene → belt → next → done.
 */
import { STORY_CHAPTERS } from './chapters';
import { STORY_REWARD_CATALOG, nextStoryRewards, pickStoryCutscene, toStoryRewardItemView } from './rewards/catalog';
import type { Chapter, StoryBelt } from './types';
import type { ChapterResultView, StoryRewardCutsceneView, StoryRewardItemView, StoryRewardKind, StoryRewardPreview, StoryUnlockedSceneView } from './views';

export type RevealStage = 'stamp' | 'stats' | 'items' | 'cutscene' | 'belt' | 'next' | 'done';

export interface RewardRevealPlan {
  stages: RevealStage[];
  items: StoryRewardItemView[];
  chips: number;
  cutscene: StoryRewardCutsceneView | null;
  belt: StoryBelt | null;
  next: StoryRewardPreview[];
  unlockedScenes: StoryUnlockedSceneView[];
  /** 서버 보상 라인 없이 카탈로그에서 파생했는가 */
  fallback: boolean;
}

export const STAGE_TIMING_MS = Object.freeze({
  stamp: 900,
  stats: 500,
  itemFlipGap: 420,
  itemsSettle: 700,
  belt: 1400,
});

export const REWARD_KIND_LABEL: Readonly<Record<StoryRewardKind, string>> = Object.freeze({
  title: '칭호',
  'card-back': '카드백',
  felt: '펠트',
  outfit: '의상',
  cg: '이벤트 CG',
  throwable: '투척 아이템',
  chips: '연습 칩',
});

/** 서버 보상 라인이 없을 때 — 이 결산으로 자격이 생겼을 카탈로그 항목(칩 포함) */
export function deriveFallbackRewards(result: ChapterResultView, chapter: Chapter | undefined): { items: StoryRewardItemView[]; chips: number } {
  if (!result.passed || result.chapterId === 'daily') return { items: [], chips: 0 };
  const items: StoryRewardItemView[] = [];
  let chips = 0;
  for (const item of STORY_REWARD_CATALOG) {
    const trigger = item.trigger;
    const matches = (trigger.kind === 'chapter-first-clear' && trigger.chapterId === result.chapterId && result.rewards.firstClear)
      || (trigger.kind === 'chapter-grade' && trigger.chapterId === result.chapterId && result.grade === trigger.grade)
      || (trigger.kind === 'act-complete' && result.beltAwarded !== null && chapter?.act === trigger.act);
    if (!matches) continue;
    if (item.kind === 'chips') chips += item.chipAmount ?? 0;
    else items.push(toStoryRewardItemView(item));
  }
  return { items, chips };
}

export function buildRewardRevealPlan(result: ChapterResultView, chapters: readonly Chapter[] = STORY_CHAPTERS): RewardRevealPlan {
  const chapter = chapters.find(candidate => candidate.id === result.chapterId);
  const rewards = result.rewards;
  const fallback = rewards.items === undefined;
  const derived = fallback ? deriveFallbackRewards(result, chapter) : null;
  const items = rewards.items ?? derived?.items ?? [];
  const chips = rewards.chips ?? derived?.chips ?? 0;
  const cutscene = rewards.cutscene === undefined ? pickStoryCutscene(items) : rewards.cutscene;
  const belt = result.beltAwarded;
  const granted = new Set(items.map(item => item.id));
  const next = result.chapterId === 'daily'
    ? []
    : (rewards.next ?? nextStoryRewards(chapters, granted, result.chapterId));

  const stages: RevealStage[] = ['stamp', 'stats'];
  if (items.length > 0 || chips > 0) stages.push('items');
  if (cutscene) stages.push('cutscene');
  if (belt) stages.push('belt');
  if (next.length > 0) stages.push('next');
  stages.push('done');

  return { stages, items, chips, cutscene, belt, next, unlockedScenes: rewards.unlockedScenes ?? [], fallback };
}

/** 스테이지 자동 진행 지연 — 탭이 없을 때 다음 단계로 넘어가는 시간 (items는 카드 수에 비례) */
export function stageAutoAdvanceMs(stage: RevealStage, plan: RewardRevealPlan): number | null {
  switch (stage) {
    case 'stamp':
      return STAGE_TIMING_MS.stamp;
    case 'stats':
      return STAGE_TIMING_MS.stats;
    case 'items':
      return STAGE_TIMING_MS.itemFlipGap * Math.max(1, plan.items.length + (plan.chips > 0 ? 1 : 0)) + STAGE_TIMING_MS.itemsSettle;
    case 'belt':
      return STAGE_TIMING_MS.belt;
    case 'cutscene':
    case 'next':
    case 'done':
      return null; // 탭으로만
  }
}
