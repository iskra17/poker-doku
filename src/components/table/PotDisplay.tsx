'use client';

import { motion } from 'framer-motion';
import { Pot } from '@/lib/poker/types';
import ChipSVG, { decomposeChips } from './ChipSVG';
import { useCountUp } from '@/lib/hooks/use-count-up';

interface PotDisplayProps {
  pots: Pot[];
  compact?: boolean;
}

export default function PotDisplay({ pots, compact = false }: PotDisplayProps) {
  const totalPot = pots.reduce((sum, p) => sum + p.amount, 0);
  const displayPot = useCountUp(totalPot);
  if (totalPot <= 0) return null;

  const chips = decomposeChips(totalPot, 5);
  const chipPx = compact ? 20 : 26;

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className="flex flex-col items-center gap-1"
    >
      {/* 칩 스택 시각화 — 액면 분해 */}
      <div className="flex items-end justify-center gap-0.5">
        {chips.map((denom, i) => (
          <motion.div
            key={i}
            initial={{ scale: 0, y: 10 }}
            animate={{ scale: 1, y: 0 }}
            transition={{ delay: i * 0.06, type: 'spring', stiffness: 300 }}
            style={{ marginBottom: (i % 3) * 2 }}
          >
            <ChipSVG denom={denom} size={chipPx} />
          </motion.div>
        ))}
      </div>
      {/* 팟 금액 (카운트업) */}
      <div className={`bg-black/50 backdrop-blur-sm rounded-full border border-gilded/40 shadow-lg shadow-gilded/10
        ${compact ? 'px-3 py-1' : 'px-4 py-1.5'}
      `}>
        <span className={`text-gilded font-bold tabular ${compact ? 'text-sm' : 'text-lg'}`}>
          POT {displayPot.toLocaleString()}
        </span>
      </div>
      {pots.length > 1 && (
        <div className="flex gap-2">
          {pots.map((pot, i) => (
            <span key={i} className={`text-gilded/60 tabular ${compact ? 'text-[10px]' : 'text-xs'}`}>
              {i === 0 ? '메인' : `사이드 ${i}`} {pot.amount.toLocaleString()}
            </span>
          ))}
        </div>
      )}
    </motion.div>
  );
}
