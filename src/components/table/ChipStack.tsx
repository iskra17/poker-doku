'use client';

import { motion } from 'framer-motion';
import ChipSVG, { decomposeChips } from './ChipSVG';

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

const chipSizeConfig: Record<ChipSize, { px: number; text: string; overlap: number }> = {
  xs: { px: 16, text: 'text-[10px]', overlap: 5 },
  sm: { px: 20, text: 'text-xs', overlap: 6 },
  md: { px: 26, text: 'text-sm', overlap: 8 },
};

/** 베팅 금액 칩 스택 — 액면 분해 후 겹쳐 쌓기 + 금액 라벨 */
export default function ChipStack({ amount, size = 'md' }: ChipStackProps) {
  if (amount <= 0) return null;
  const cfg = chipSizeConfig[size];
  const chips = decomposeChips(amount, 4);

  return (
    <motion.div
      initial={{ scale: 0 }}
      animate={{ scale: 1 }}
      transition={{ type: 'spring', stiffness: 400, damping: 22 }}
      className="flex items-center gap-1"
    >
      <div
        className="relative"
        style={{ width: cfg.px, height: cfg.px + (chips.length - 1) * cfg.overlap }}
      >
        {chips.map((denom, i) => (
          <div
            key={i}
            className="absolute left-0"
            style={{ bottom: i * cfg.overlap, zIndex: i }}
          >
            <ChipSVG denom={denom} size={cfg.px} />
          </div>
        ))}
      </div>
      <span className={`font-bold text-gilded tabular drop-shadow ${cfg.text}`}>
        {formatChips(amount)}
      </span>
    </motion.div>
  );
}
