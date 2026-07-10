'use client';

import { motion } from 'framer-motion';
import { Card as CardType, Suit } from '@/lib/poker/types';

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
}

// 4색덱: 하트 빨강 / 다이아 파랑 / 클럽 초록 / 스페이드 잉크
const suitColors: Record<Suit, string> = {
  hearts: '#FF4F6E',
  diamonds: '#4FA3FF',
  clubs: '#2FBE85',
  spades: '#2A2E3F',
};

const suitTints: Record<Suit, string> = {
  hearts: 'rgba(255, 79, 110, 0.05)',
  diamonds: 'rgba(79, 163, 255, 0.05)',
  clubs: 'rgba(47, 190, 133, 0.05)',
  spades: 'rgba(42, 46, 63, 0.04)',
};

const suitSymbols: Record<Suit, string> = {
  hearts: '♥',
  diamonds: '♦',
  clubs: '♣',
  spades: '♠',
};

const sizeConfig: Record<CardSize, {
  card: string; rank: string; corner: string; cornerSuit: string; watermark: string; showWatermark: boolean;
}> = {
  xs: { card: 'w-7 h-10', rank: 'text-sm', corner: 'text-[7px]', cornerSuit: 'text-[6px]', watermark: 'text-lg', showWatermark: false },
  sm: { card: 'w-10 h-14', rank: 'text-xl', corner: 'text-[9px]', cornerSuit: 'text-[8px]', watermark: 'text-2xl', showWatermark: false },
  md: { card: 'w-14 h-20', rank: 'text-2xl', corner: 'text-[11px]', cornerSuit: 'text-[10px]', watermark: 'text-4xl', showWatermark: true },
  lg: { card: 'w-[4.5rem] h-[6.2rem]', rank: 'text-3xl', corner: 'text-xs', cornerSuit: 'text-[11px]', watermark: 'text-5xl', showWatermark: true },
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
}: CardProps) {
  const resolvedSize: CardSize = size ?? (small ? 'sm' : 'md');
  const cfg = sizeConfig[resolvedSize];
  const color = suitColors[card.suit];
  const symbol = suitSymbols[card.suit];

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
            ${highlight ? 'ring-2 ring-gilded shadow-gilded/50' : 'border border-gray-300/80'}
          `}
          style={{
            backfaceVisibility: 'hidden',
            background: `linear-gradient(150deg, #ffffff 0%, ${suitTints[card.suit]} 100%), #ffffff`,
          }}
        >
          {/* 좌상단 코너 인덱스 */}
          <div className="absolute top-0.5 left-1 flex flex-col items-center leading-none" style={{ color }}>
            <span className={`${cfg.corner} font-bold leading-none`}>{card.rank}</span>
            <span className={`${cfg.cornerSuit} leading-none`}>{symbol}</span>
          </div>
          {/* 우하단 코너 인덱스 (180° 회전) */}
          <div className="absolute bottom-0.5 right-1 flex flex-col items-center leading-none rotate-180" style={{ color }}>
            <span className={`${cfg.corner} font-bold leading-none`}>{card.rank}</span>
            <span className={`${cfg.cornerSuit} leading-none`}>{symbol}</span>
          </div>
          {/* 무늬 워터마크 */}
          {cfg.showWatermark && (
            <div
              className={`absolute inset-0 flex items-center justify-center ${cfg.watermark}`}
              style={{ color, opacity: 0.13 }}
            >
              {symbol}
            </div>
          )}
          {/* 중앙 랭크 */}
          <div className="absolute inset-0 flex items-center justify-center">
            <span className={`${cfg.rank} font-black leading-none`} style={{ color }}>
              {card.rank}
            </span>
          </div>
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
