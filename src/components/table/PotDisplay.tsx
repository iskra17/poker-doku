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

  // 팟 크기에 따라 칩 스택 개수 결정 (1~5개)
  const chipCount = Math.min(5, Math.max(1, Math.ceil(totalPot / 200)));
  const chipSize = compact ? 'w-5 h-5' : 'w-6 h-6';

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className="flex flex-col items-center gap-1"
    >
      {/* 칩 스택 시각화 */}
      <div className="flex items-end justify-center gap-0.5">
        {Array.from({ length: chipCount }).map((_, i) => (
          <motion.div
            key={i}
            initial={{ scale: 0, y: 10 }}
            animate={{ scale: 1, y: 0 }}
            transition={{ delay: i * 0.08, type: 'spring', stiffness: 300 }}
            className={`${chipSize} rounded-full bg-gradient-to-br from-yellow-400 to-yellow-600 border-2 border-yellow-300 shadow-md flex items-center justify-center`}
            style={{ marginBottom: i * 2 }}
          >
            <span className="text-yellow-900 font-bold text-[7px]">$</span>
          </motion.div>
        ))}
      </div>
      {/* 팟 금액 */}
      <div className={`bg-black/50 backdrop-blur-sm rounded-full border border-yellow-500/40 shadow-lg shadow-yellow-500/10
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
