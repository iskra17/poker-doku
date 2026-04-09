'use client';

import { motion } from 'framer-motion';
import { Pot } from '@/lib/poker/types';

interface PotDisplayProps {
  pots: Pot[];
  compact?: boolean;
}

export default function PotDisplay({ pots, compact = false }: PotDisplayProps) {
  const totalPot = pots.reduce((sum, p) => sum + p.amount, 0);
  if (totalPot <= 0) return null;

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className="flex flex-col items-center gap-0.5"
    >
      <div className={`bg-black/40 backdrop-blur-sm rounded-full border border-yellow-500/30
        ${compact ? 'px-3 py-1' : 'px-4 py-1.5'}
      `}>
        <span className={`text-yellow-400 font-bold ${compact ? 'text-sm' : 'text-lg'}`}>
          POT: {totalPot.toLocaleString()}
        </span>
      </div>
      {pots.length > 1 && (
        <div className="flex gap-2">
          {pots.map((pot, i) => (
            <span key={i} className={`text-yellow-300/60 ${compact ? 'text-[10px]' : 'text-xs'}`}>
              {i === 0 ? 'Main' : `Side ${i}`}: {pot.amount.toLocaleString()}
            </span>
          ))}
        </div>
      )}
    </motion.div>
  );
}
