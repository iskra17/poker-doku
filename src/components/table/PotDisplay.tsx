'use client';

import { motion } from 'framer-motion';
import { Pot } from '@/lib/poker/types';
import { useSettingsStore } from '@/lib/store/settings-store';
import ChipSVG, { ChipDenom, decomposeChips } from './ChipSVG';
import { useCountUp } from '@/lib/hooks/use-count-up';

interface PotDisplayProps {
  pots: Pot[];
  compact?: boolean;
}

const MAX_CHIPS_PER_STACK = 8;

/** 같은 액면 칩끼리 묶기 (decomposeChips가 큰 액면 우선이라 순서 유지됨) */
function groupByDenom(chips: ChipDenom[]): { denom: ChipDenom; count: number }[] {
  const groups: { denom: ChipDenom; count: number }[] = [];
  for (const denom of chips) {
    const last = groups[groups.length - 1];
    if (last && last.denom.value === denom.value) last.count += 1;
    else groups.push({ denom, count: 1 });
  }
  return groups;
}

export default function PotDisplay({ pots, compact = false }: PotDisplayProps) {
  const stackedPot = useSettingsStore(s => s.stackedPot);
  const totalPot = pots.reduce((sum, p) => sum + p.amount, 0);
  const displayPot = useCountUp(totalPot);
  if (totalPot <= 0) return null;

  const chips = decomposeChips(totalPot, stackedPot ? 16 : 5);
  const chipPx = compact ? 20 : 26;
  const stackOverlap = compact ? 4 : 5; // 칩 1장의 측면 두께(px)

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className="flex flex-col items-center gap-1"
    >
      {/* 칩 시각화 — 권종별 세로 스택(옵션) 또는 낱개 나열 */}
      {stackedPot ? (
        <div className="flex items-end justify-center gap-1">
          {groupByDenom(chips).map((group, gi) => {
            const count = Math.min(group.count, MAX_CHIPS_PER_STACK);
            return (
              <motion.div
                key={gi}
                initial={{ scale: 0, y: 10 }}
                animate={{ scale: 1, y: 0 }}
                transition={{ delay: gi * 0.06, type: 'spring', stiffness: 300 }}
                className="relative"
                style={{ width: chipPx, height: chipPx + (count - 1) * stackOverlap }}
              >
                {Array.from({ length: count }).map((_, i) => (
                  <div key={i} className="absolute left-0" style={{ bottom: i * stackOverlap, zIndex: i }}>
                    <ChipSVG denom={group.denom} size={chipPx} />
                  </div>
                ))}
              </motion.div>
            );
          })}
        </div>
      ) : (
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
      )}
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
