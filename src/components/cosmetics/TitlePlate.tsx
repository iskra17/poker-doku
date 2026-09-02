'use client';

import type { CSSProperties } from 'react';
import type { ResolvedTitle, TitleGlyph, TitleTier } from '@/lib/cosmetics/titles';
import type { StoryBelt } from '@/lib/story/types';

/**
 * 칭호 플레이트 — SVG/CSS 전용(컨벤션: 이미지 생성은 캐릭터/배경/로고만).
 * 노치 리본 바탕(등급 그라디언트 또는 띠 색) + 좌측 문양 + 이름. 이름은 HTML span이라 한글 말줄임이 CSS로 된다
 * (SVG <text>는 말줄임이 안 됨). 좌석(xs)·프로필/보관함/리더보드(sm)·보상 카드/기록실(lg) 공용.
 * 전설 등급만 `motion-safe:`로 shimmer — reduced-motion에서는 정지.
 */

type Size = 'xs' | 'sm' | 'lg';

const TIER_COLOR: Readonly<Record<TitleTier, string>> = Object.freeze({
  common: 'var(--color-rarity-common)',
  rare: 'var(--color-rarity-rare)',
  epic: 'var(--color-rarity-epic)',
  legend: 'var(--color-rarity-legend)',
});

/** 띠 색 변형 — 바탕/글자/테두리 */
const BELT_STYLE: Readonly<Record<StoryBelt, { fill: string; ink: string; stroke: string }>> = Object.freeze({
  white: { fill: '#f4edff', ink: '#2a2e3f', stroke: '#b9a8d9' },
  yellow: { fill: 'var(--color-gilded)', ink: '#2a2e3f', stroke: '#b8902a' },
  blue: { fill: 'var(--color-cyber)', ink: '#0a0614', stroke: '#2f8fb0' },
  brown: { fill: '#a0693a', ink: '#f4edff', stroke: '#6b4322' },
  black: { fill: '#2a2e3f', ink: 'var(--color-gilded)', stroke: 'var(--color-gilded)' },
});

const SIZE_CLASS: Readonly<Record<Size, string>> = Object.freeze({
  xs: 'h-[14px] max-w-[88px] px-1.5 text-[9px] gap-0.5',
  sm: 'h-5 max-w-[160px] px-2 text-[11px] gap-1',
  lg: 'h-8 max-w-[240px] px-3 text-sm gap-1.5',
});

function Glyph({ glyph }: { glyph: TitleGlyph }) {
  // 1em 정사각 — currentColor로 그려 등급/띠 잉크색을 따른다
  switch (glyph) {
    case 'sprout':
      return <path d="M12 21V11M12 11c0-4 3-6 7-6-0 4-3 6-7 6zm0 3c0-4-3-6-7-6 0 4 3 6 7 6z" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />;
    case 'laurel':
      return <path d="M5 4c1 8 3 12 7 15 4-3 6-7 7-15M8 9c2 1 3 3 4 6M16 9c-2 1-3 3-4 6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />;
    case 'crest':
      return <path d="M12 3l7 3v6c0 5-3 8-7 9-4-1-7-4-7-9V6l7-3zm0 5l-3 4 3 4 3-4-3-4z" fill="currentColor" fillRule="evenodd" />;
    case 'flame':
      return <path d="M12 3c1 4 5 5 5 10a5 5 0 01-10 0c0-2 1-3 2-4 0 2 1 3 2 3 0-3 1-6 1-9z" fill="currentColor" />;
    case 'belt':
      return <path d="M3 10h18v4H3zM9 8l3 2-3 2M15 8l-3 2 3 2" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />;
    case 'star':
      return <path d="M12 3l2.6 5.6 6.1.7-4.5 4.2 1.2 6L12 16.5 6.6 19.5l1.2-6L3.3 9.3l6.1-.7z" fill="currentColor" />;
    case 'note':
      return <path d="M6 3h9l4 4v14H6zM9 12h6M9 16h6M9 8h3" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />;
    case 'crown':
      return <path d="M4 18h16l1-10-5 4-4-6-4 6-5-4z" fill="currentColor" />;
  }
}

export default function TitlePlate({ title, size = 'sm', className = '' }: { title: ResolvedTitle; size?: Size; className?: string }) {
  const belt = title.belt ? BELT_STYLE[title.belt] : null;
  const accent = TIER_COLOR[title.tier];
  const ink = belt ? belt.ink : '#0a0614';
  const shimmer = title.tier === 'legend' && !belt;
  const plateStyle: CSSProperties = {
    color: ink,
    background: belt
      ? belt.fill
      : `linear-gradient(100deg, color-mix(in srgb, ${accent} 75%, white) 0%, ${accent} 45%, color-mix(in srgb, ${accent} 70%, black) 100%)`,
    boxShadow: `0 0 0 1px ${belt ? belt.stroke : `color-mix(in srgb, ${accent} 70%, black)`}, 0 1px 2px rgba(0,0,0,0.5)`,
    // 노치 리본 실루엣 — 양끝 화살 노치
    clipPath: 'polygon(0 0, 100% 0, calc(100% - 0.45em) 50%, 100% 100%, 0 100%, 0.45em 50%)',
  };
  return (
    <span
      role="img"
      aria-label={`칭호 ${title.name}`}
      data-title-tier={title.tier}
      className={`relative inline-flex shrink-0 items-center overflow-hidden whitespace-nowrap font-bold leading-none ${SIZE_CLASS[size]} ${shimmer ? 'motion-safe:animate-[title-shimmer_3s_linear_infinite]' : ''} ${className}`}
      style={plateStyle}
    >
      <svg viewBox="0 0 24 24" aria-hidden="true" className="h-[1em] w-[1em] shrink-0" style={{ marginLeft: '0.3em' }}>
        <Glyph glyph={title.glyph} />
      </svg>
      <span className="min-w-0 truncate" style={{ marginRight: '0.3em' }}>{title.name}</span>
    </span>
  );
}
