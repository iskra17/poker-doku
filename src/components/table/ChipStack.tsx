'use client';

import { motion } from 'framer-motion';

type ChipSize = 'xs' | 'sm' | 'md';

interface ChipStackProps {
  amount: number;
  size?: ChipSize;
}

function formatChips(amount: number): string {
  if (amount >= 1000000) return `${(amount / 1000000).toFixed(1)}M`;
  if (amount >= 1000) return `${(amount / 1000).toFixed(1)}K`;
  return amount.toString();
}

const chipSizeConfig: Record<ChipSize, { chip: string; text: string }> = {
  xs: { chip: 'w-4 h-4 text-[8px]', text: 'text-[9px]' },
  sm: { chip: 'w-5 h-5 text-[10px]', text: 'text-xs' },
  md: { chip: 'w-7 h-7 text-xs', text: 'text-sm' },
};

export default function ChipStack({ amount, size = 'md' }: ChipStackProps) {
  if (amount <= 0) return null;
  const cfg = chipSizeConfig[size];

  return (
    <motion.div
      initial={{ scale: 0 }}
      animate={{ scale: 1 }}
      className="flex items-center gap-0.5"
    >
      <div
        className={`${cfg.chip} rounded-full bg-gradient-to-br from-yellow-400 to-yellow-600 border-2 border-yellow-300 flex items-center justify-center font-bold text-yellow-900 shadow-md`}
      >
        $
      </div>
      <span className={`font-bold text-yellow-300 ${cfg.text}`}>
        {formatChips(amount)}
      </span>
    </motion.div>
  );
}
