/**
 * 칭호 해석기 — 컬렉션 카탈로그(도장 레벨·아레나 시즌)와 수련 스토리 보상 카탈로그의 칭호를
 * 하나의 `ResolvedTitle`(등급·문양·띠 색)로 합친다. 좌석·프로필·보상 카드·기록실이 모두 이 함수를 쓴다.
 *
 * 2026-09-03: 좌석 렌더러가 컬렉션 카탈로그만 봐서 장착한 스토리 칭호(백띠 수련생)가 안 보이던 버그의
 * 단일 해결점. 새 칭호는 카탈로그에 추가하고 여기 `STYLE`에 등급/문양 한 줄만 더하면 된다(미지정은 common/crest).
 */
import { getCollectionItemDefinition } from '@/lib/collection/catalog';
import { getStoryRewardDefinition } from '@/lib/story/rewards/catalog';
import type { StoryBelt } from '@/lib/story/types';

export type TitleTier = 'common' | 'rare' | 'epic' | 'legend';
export type TitleGlyph = 'sprout' | 'laurel' | 'crest' | 'flame' | 'belt' | 'star' | 'note' | 'crown';

export interface ResolvedTitle {
  id: string;
  name: string;
  tier: TitleTier;
  glyph: TitleGlyph;
  /** 띠 칭호는 띠 색 변형(플레이트 바탕이 띠 색) — 그 외 null */
  belt: StoryBelt | null;
  source: 'collection' | 'story';
}

interface TitleStyle { tier: TitleTier; glyph: TitleGlyph; belt?: StoryBelt }

const STYLE: Readonly<Record<string, TitleStyle>> = Object.freeze({
  'dojo-title-sprout-challenger': { tier: 'common', glyph: 'sprout' },
  'dojo-title-steady-trainee': { tier: 'rare', glyph: 'laurel' },
  'dojo-title-advanced-student': { tier: 'epic', glyph: 'crest' },
  'dojo-title-battle-tested': { tier: 'legend', glyph: 'flame' },
  'story-title-white-belt': { tier: 'common', glyph: 'belt', belt: 'white' },
  'story-title-yellow-belt': { tier: 'rare', glyph: 'belt', belt: 'yellow' },
  'story-title-blue-belt': { tier: 'epic', glyph: 'belt', belt: 'blue' },
  'story-title-brown-belt': { tier: 'epic', glyph: 'belt', belt: 'brown' },
  'story-title-black-belt': { tier: 'legend', glyph: 'belt', belt: 'black' },
  'story-title-perfect': { tier: 'epic', glyph: 'star' },
  'story-title-empty-note': { tier: 'rare', glyph: 'note' },
});

const DEFAULT_STYLE: TitleStyle = { tier: 'common', glyph: 'crest' };

/** 아레나 시즌 칭호는 시즌 접두가 붙는다(`<season>-top100-title`, `<season>-rank-N-title`) — 접미로 판정 */
function arenaStyle(id: string): TitleStyle | null {
  if (/(?:^|-)top100-title$/.test(id)) return { tier: 'epic', glyph: 'laurel' };
  const rank = /(?:^|-)rank-(\d+)-title$/.exec(id);
  if (rank) return { tier: Number(rank[1]) <= 3 ? 'legend' : 'epic', glyph: 'crown' };
  return null;
}

export function resolveTitle(id: string | null | undefined): ResolvedTitle | null {
  if (!id) return null;
  const collection = getCollectionItemDefinition(id);
  if (collection) {
    if (collection.kind !== 'title' || collection.equipSlot !== 'title') return null;
    const style = STYLE[id] ?? arenaStyle(id) ?? DEFAULT_STYLE;
    return { id, name: collection.name, tier: style.tier, glyph: style.glyph, belt: style.belt ?? null, source: 'collection' };
  }
  const story = getStoryRewardDefinition(id);
  if (story && story.kind === 'title' && story.equipSlot === 'title') {
    const style = STYLE[id] ?? DEFAULT_STYLE;
    return { id, name: story.name, tier: style.tier, glyph: style.glyph, belt: style.belt ?? null, source: 'story' };
  }
  return null;
}

export const TITLE_TIER_LABEL: Readonly<Record<TitleTier, string>> = Object.freeze({
  common: '일반',
  rare: '희귀',
  epic: '영웅',
  legend: '전설',
});
