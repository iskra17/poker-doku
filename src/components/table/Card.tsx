'use client';

import { motion } from 'framer-motion';
import { Card as CardType, Suit } from '@/lib/poker/types';

type CardSize = 'xs' | 'sm' | 'md';

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

const sizeConfig: Record<CardSize, { card: string; text: string; suit: string; symbol: string }> = {
  xs: { card: 'w-7 h-10', text: 'text-[8px]', suit: 'text-xs', symbol: '✦' },
  sm: { card: 'w-10 h-14', text: 'text-xs', suit: 'text-lg', symbol: '✦' },
  md: { card: 'w-14 h-20', text: 'text-sm', suit: 'text-2xl', symbol: '✦' },
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

  return (
    <motion.div
      initial={{ rotateY: -180, opacity: 0, y: -20 }}
      animate={{ rotateY: 0, opacity: 1, y: 0 }}
      transition={{ duration: 0.5, delay }}
      className={`${cfg.card} rounded-lg bg-white shadow-lg flex flex-col items-center justify-between p-0.5 md:p-1 relative
        ${highlight ? 'ring-2 ring-yellow-400 shadow-yellow-400/50' : 'border border-gray-300'}
      `}
    >
      <div className={`self-start ${cfg.text} font-bold leading-tight`} style={{ color }}>
        <div>{card.rank}</div>
        <div className="-mt-0.5">{suitSymbols[card.suit]}</div>
      </div>
      <div className={cfg.suit} style={{ color }}>
        {suitSymbols[card.suit]}
      </div>
      <div className={`self-end ${cfg.text} font-bold leading-tight rotate-180`} style={{ color }}>
        <div>{card.rank}</div>
        <div className="-mt-0.5">{suitSymbols[card.suit]}</div>
      </div>
    </motion.div>
  );
}
