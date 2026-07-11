'use client';

import { motion } from 'framer-motion';
import { Card as CardType } from '@/lib/poker/types';
import { useSettingsStore } from '@/lib/store/settings-store';
import {
  DeckStyleId, DeckColorId, SUIT_SYMBOLS, getSuitColor, getSuitTint,
} from './card-theme';

type CardSize = 'xs' | 'sm' | 'md' | 'lg';

interface CardProps {
  card: CardType;
  hidden?: boolean;
  highlight?: boolean;
  /** 쇼다운 시 승리 조합이 아닌 카드 디밍 */
  dimmed?: boolean;
  delay?: number;
  size?: CardSize;
  /** @deprecated Use size='sm' instead */
  small?: boolean;
  /** 설정 미리보기용 스타일 강제 (기본: 설정 스토어 값) */
  deckStyle?: DeckStyleId;
  /** 설정 미리보기용 배색 강제 (기본: 설정 스토어 값) */
  deckColor?: DeckColorId;
}

const sizeConfig: Record<CardSize, {
  card: string; corner: string; cornerSuit: string; centerSuit: string; bigRank: string; bigSuit: string;
}> = {
  xs: { card: 'w-7 h-10', corner: 'text-[7px]', cornerSuit: 'text-[6px]', centerSuit: 'text-base', bigRank: 'text-base', bigSuit: 'text-[10px]' },
  sm: { card: 'w-10 h-14', corner: 'text-[9px]', cornerSuit: 'text-[8px]', centerSuit: 'text-2xl', bigRank: 'text-2xl', bigSuit: 'text-sm' },
  md: { card: 'w-14 h-20', corner: 'text-[11px]', cornerSuit: 'text-[10px]', centerSuit: 'text-4xl', bigRank: 'text-4xl', bigSuit: 'text-xl' },
  lg: { card: 'w-[4.5rem] h-[6.2rem]', corner: 'text-xs', cornerSuit: 'text-[11px]', centerSuit: 'text-5xl', bigRank: 'text-5xl', bigSuit: 'text-2xl' },
};

/** 카드 뒷면 — 핑크→퍼플 그라디언트 + 사선 격자 + 다이아 모노그램 */
function CardBack() {
  return (
    <svg viewBox="0 0 56 80" className="w-full h-full" preserveAspectRatio="none" aria-hidden>
      <defs>
        <linearGradient id="card-back-grad" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#c2477f" />
          <stop offset="55%" stopColor="#7d3ba8" />
          <stop offset="100%" stopColor="#4a2580" />
        </linearGradient>
        <pattern id="card-back-lattice" width="8" height="8" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <path d="M0 0H8" stroke="rgba(255,255,255,0.12)" strokeWidth="0.7" />
          <path d="M0 4H8" stroke="rgba(255,255,255,0.06)" strokeWidth="0.5" />
        </pattern>
      </defs>
      <rect x="0" y="0" width="56" height="80" rx="5" fill="url(#card-back-grad)" />
      <rect x="0" y="0" width="56" height="80" rx="5" fill="url(#card-back-lattice)" />
      <rect x="2" y="2" width="52" height="76" rx="4" fill="none" stroke="rgba(107,228,255,0.45)" strokeWidth="0.8" />
      <g transform="translate(28, 40)">
        <path d="M0 -9 L7 0 L0 9 L-7 0 Z" fill="rgba(255,255,255,0.22)" />
        <path d="M0 -5.5 L4.2 0 L0 5.5 L-4.2 0 Z" fill="rgba(255,215,106,0.55)" />
      </g>
    </svg>
  );
}

export default function CardComponent({
  card, hidden = false, highlight = false, dimmed = false, delay = 0, size, small,
  deckStyle, deckColor,
}: CardProps) {
  const storeStyle = useSettingsStore(s => s.deckStyle);
  const storeColor = useSettingsStore(s => s.deckColor);
  const style = deckStyle ?? storeStyle;
  const colorway = deckColor ?? storeColor;

  const resolvedSize: CardSize = size ?? (small ? 'sm' : 'md');
  const cfg = sizeConfig[resolvedSize];
  const suitColor = getSuitColor(card.suit, colorway);
  const symbol = SUIT_SYMBOLS[card.suit];
  const isTen = card.rank === '10';
  const isSolid = style === 'solid';
  // 솔리드: 수트색이 카드 배경, 글자는 흰색 (테두리 없음 — 시인성 최우선)
  const glyphColor = isSolid ? '#ffffff' : suitColor;
  const faceBackground = isSolid
    ? suitColor
    : style === 'classic'
      ? `linear-gradient(150deg, #ffffff 0%, ${getSuitTint(card.suit, colorway)} 100%), #ffffff`
      : '#ffffff';

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.7 }}
      animate={{ opacity: dimmed ? 0.4 : 1, scale: 1 }}
      transition={{ duration: 0.25, delay }}
      className={`${cfg.card} relative`}
      style={{ perspective: 600 }}
    >
      <motion.div
        className="relative w-full h-full"
        style={{ transformStyle: 'preserve-3d' }}
        initial={{ rotateY: 180 }}
        animate={{ rotateY: hidden ? 180 : 0 }}
        transition={{ duration: 0.45, delay: hidden ? 0 : delay, ease: 'easeOut' }}
      >
        {/* 앞면 */}
        <div
          className={`absolute inset-0 rounded-lg overflow-hidden shadow-lg
            ${highlight ? 'ring-2 ring-gilded shadow-gilded/50' : isSolid ? '' : 'border border-gray-300/80'}
          `}
          style={{
            backfaceVisibility: 'hidden',
            background: faceBackground,
          }}
        >
          {style === 'classic' ? (
            <>
              {/* 좌상단 코너 인덱스 */}
              <div className="absolute top-0.5 left-1 flex flex-col items-center leading-none" style={{ color: glyphColor }}>
                <span className={`${cfg.corner} font-bold leading-none ${isTen ? 'tracking-tighter' : ''}`}>{card.rank}</span>
                <span className={`${cfg.cornerSuit} leading-none`}>{symbol}</span>
              </div>
              {/* 우하단 코너 인덱스 (180° 회전) */}
              <div className="absolute bottom-0.5 right-1 flex flex-col items-center leading-none rotate-180" style={{ color: glyphColor }}>
                <span className={`${cfg.corner} font-bold leading-none ${isTen ? 'tracking-tighter' : ''}`}>{card.rank}</span>
                <span className={`${cfg.cornerSuit} leading-none`}>{symbol}</span>
              </div>
              {/* 중앙 대형 수트 */}
              <div className="absolute inset-0 flex items-center justify-center" style={{ color: glyphColor }}>
                <span className={`${cfg.centerSuit} leading-none`}>{symbol}</span>
              </div>
            </>
          ) : (
            /* 빅랭크(흰 배경) / 솔리드(수트색 배경): 초대형 랭크 + 그 아래 수트 */
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-[4%]" style={{ color: glyphColor }}>
              <span className={`${cfg.bigRank} font-black leading-none ${isTen ? 'tracking-tighter scale-x-90' : ''}`}>
                {card.rank}
              </span>
              <span className={`${cfg.bigSuit} leading-none`}>{symbol}</span>
            </div>
          )}
        </div>

        {/* 뒷면 */}
        <div
          className="absolute inset-0 rounded-lg overflow-hidden shadow-lg shadow-purple-900/30"
          style={{ backfaceVisibility: 'hidden', transform: 'rotateY(180deg)' }}
        >
          <CardBack />
        </div>
      </motion.div>
    </motion.div>
  );
}
