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

// overlap = 칩 1장의 측면 두께(px) — 아이소메트릭 칩(두께 7/40)에 맞춘 수직 적층 간격
const chipSizeConfig: Record<ChipSize, { px: number; text: string; overlap: number }> = {
  xs: { px: 16, text: 'text-[10px]', overlap: 3 },
  sm: { px: 20, text: 'text-xs', overlap: 4 },
  md: { px: 26, text: 'text-sm', overlap: 5 },
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
