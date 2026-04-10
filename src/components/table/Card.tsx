'use client';

import { motion } from 'framer-motion';
import { Card as CardType, Suit } from '@/lib/poker/types';

type CardSize = 'xs' | 'sm' | 'md' | 'lg';

interface CardProps {
  card: CardType;
  hidden?: boolean;
  highlight?: boolean;
  delay?: number;
  size?: CardSize;
  /** @deprecated Use size='sm' instead */
  small?: boolean;
}

const suitColors: Record<Suit, string> = {
  hearts: '#FF4757',
  diamonds: '#3B82F6',
  clubs: '#10B981',
  spades: '#1F2937',
};

const suitSymbols: Record<Suit, string> = {
  hearts: '♥',
  diamonds: '♦',
  clubs: '♣',
  spades: '♠',
};

const sizeConfig: Record<CardSize, { card: string; rank: string; suit: string; suitTop: string; symbol: string }> = {
  xs: { card: 'w-7 h-10', rank: 'text-sm', suit: 'text-[7px]', suitTop: 'text-[6px]', symbol: '✦' },
  sm: { card: 'w-10 h-14', rank: 'text-xl', suit: 'text-[9px]', suitTop: 'text-[8px]', symbol: '✦' },
  md: { card: 'w-14 h-20', rank: 'text-2xl', suit: 'text-xs', suitTop: 'text-[10px]', symbol: '✦' },
  lg: { card: 'w-[4.5rem] h-[6.2rem]', rank: 'text-3xl', suit: 'text-sm', suitTop: 'text-xs', symbol: '✦' },
};

export default function CardComponent({ card, hidden = false, highlight = false, delay = 0, size, small }: CardProps) {
  const resolvedSize: CardSize = size ?? (small ? 'sm' : 'md');
  const cfg = sizeConfig[resolvedSize];

  if (hidden) {
    return (
      <motion.div
        initial={{ rotateY: 180, opacity: 0 }}
        animate={{ rotateY: 0, opacity: 1 }}
        transition={{ duration: 0.4, delay }}
        className={`${cfg.card} rounded-lg bg-gradient-to-br from-purple-800 to-indigo-900 border-2 border-purple-500/50 shadow-lg shadow-purple-500/20 flex items-center justify-center`}
        style={{ backfaceVisibility: 'hidden' }}
      >
        <div className={`text-purple-300/30 ${cfg.suit}`}>{cfg.symbol}</div>
      </motion.div>
    );
  }

  const color = suitColors[card.suit];
  const isRed = card.suit === 'hearts' || card.suit === 'diamonds';

  return (
    <motion.div
      initial={{ rotateY: -180, opacity: 0, y: -20 }}
      animate={{ rotateY: 0, opacity: 1, y: 0 }}
      transition={{ duration: 0.5, delay }}
      className={`${cfg.card} rounded-lg shadow-lg relative overflow-hidden
        ${highlight ? 'ring-2 ring-yellow-400 shadow-yellow-400/50' : 'border border-gray-200'}
      `}
      style={{ background: isRed ? '#fff5f5' : '#f5f8ff' }}
    >
      {/* 좌상단 무늬 */}
      <div className={`absolute top-0.5 left-1 ${cfg.suitTop} leading-none`} style={{ color }}>
        {suitSymbols[card.suit]}
      </div>
      {/* 중앙 숫자 크게 */}
      <div className="absolute inset-0 flex items-center justify-center">
        <span className={`${cfg.rank} font-black leading-none`} style={{ color }}>
          {card.rank}
        </span>
      </div>
    </motion.div>
  );
}
