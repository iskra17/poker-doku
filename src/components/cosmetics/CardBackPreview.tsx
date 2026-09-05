'use client';

/**
 * 카드백·펠트 코스메틱 미리보기 — SVG/CSS 전용(컨벤션: 이미지 생성은 캐릭터/배경/로고만).
 * 보상 카드 썸네일·갤러리·옷장이 함께 쓴다. id를 모르면 기본 무늬.
 */

const CARD_BACK_STYLE: Readonly<Record<string, { base: string; accent: string; glyph: 'crest' | 'band' }>> = Object.freeze({
  'story-cardback-dojo-crest': { base: '#1e1235', accent: '#ffd76a', glyph: 'crest' },
  'story-cardback-yellow-belt': { base: '#241c0c', accent: '#ffd76a', glyph: 'band' },
  'story-cardback-blue-belt': { base: '#0b1d38', accent: '#6be4ff', glyph: 'band' },
});

export function CardBackPreview({ id, className = '' }: { id: string; className?: string }) {
  const style = CARD_BACK_STYLE[id] ?? { base: '#1e1235', accent: '#a78bfa', glyph: 'crest' as const };
  return (
    <svg viewBox="0 0 60 84" className={className} role="img" aria-label="카드백 미리보기">
      <rect x="1" y="1" width="58" height="82" rx="6" fill={style.base} stroke={style.accent} strokeOpacity="0.7" strokeWidth="1.5" />
      <rect x="6" y="6" width="48" height="72" rx="4" fill="none" stroke={style.accent} strokeOpacity="0.35" strokeWidth="1" />
      {style.glyph === 'crest' ? (
        <g fill="none" stroke={style.accent} strokeWidth="1.5">
          <circle cx="30" cy="42" r="14" strokeOpacity="0.9" />
          <circle cx="30" cy="42" r="9" strokeOpacity="0.6" />
          <path d="M30 30 L36 42 L30 54 L24 42 Z" fill={style.accent} fillOpacity="0.8" stroke="none" />
        </g>
      ) : (
        <g>
          <path d="M6 60 L54 24 L54 34 L6 70 Z" fill={style.accent} fillOpacity="0.85" />
          <path d="M6 48 L54 12 L54 16 L6 52 Z" fill={style.accent} fillOpacity="0.35" />
        </g>
      )}
    </svg>
  );
}

const FELT_STYLE: Readonly<Record<string, { hi: string; lo: string; rail: string }>> = Object.freeze({
  'story-felt-yellow-belt': { hi: '#4a3d12', lo: '#221a06', rail: '#ffd76a' },
  'story-felt-brown-belt': { hi: '#553823', lo: '#281a10', rail: '#d4a373' },
  'story-felt-blue-belt': { hi: '#153a5e', lo: '#0a1f36', rail: '#6be4ff' },
});

export function FeltPreview({ id, className = '' }: { id: string; className?: string }) {
  const style = FELT_STYLE[id] ?? { hi: '#1d3f3c', lo: '#0f2628', rail: '#6be4ff' };
  const gradientId = `felt-${id.replace(/[^a-z0-9]/gi, '')}`;
  return (
    <svg viewBox="0 0 84 60" className={className} role="img" aria-label="펠트 미리보기">
      <defs>
        <radialGradient id={gradientId} cx="50%" cy="65%" r="70%">
          <stop offset="0%" stopColor={style.hi} />
          <stop offset="100%" stopColor={style.lo} />
        </radialGradient>
      </defs>
      <ellipse cx="42" cy="30" rx="38" ry="24" fill={style.rail} fillOpacity="0.35" />
      <ellipse cx="42" cy="30" rx="33" ry="20" fill={`url(#${gradientId})`} stroke={style.rail} strokeOpacity="0.6" strokeWidth="1.2" />
      <ellipse cx="42" cy="30" rx="24" ry="13" fill="none" stroke={style.rail} strokeOpacity="0.25" strokeWidth="0.8" />
    </svg>
  );
}
