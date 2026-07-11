'use client';

import { useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Card, HandRank } from '@/lib/poker/types';
import { evaluateHand } from '@/lib/poker/evaluator';
import { rankValue } from '@/lib/poker/deck';

export const HAND_RANK_KO: Record<HandRank, string> = {
  'high-card': '하이카드',
  'one-pair': '원페어',
  'two-pair': '투페어',
  'three-of-a-kind': '트리플',
  straight: '스트레이트',
  flush: '플러시',
  'full-house': '풀하우스',
  'four-of-a-kind': '포카드',
  'straight-flush': '스트레이트 플러시',
  'royal-flush': '로열 플러시',
};

const RANK_TIER: Record<HandRank, number> = {
  'high-card': 1,
  'one-pair': 2,
  'two-pair': 3,
  'three-of-a-kind': 4,
  straight: 5,
  flush: 6,
  'full-house': 7,
  'four-of-a-kind': 8,
  'straight-flush': 9,
  'royal-flush': 10,
};

function tierStyle(tier: number): { border: string; text: string; glow: string } {
  if (tier >= 7) return { border: 'border-gilded/70', text: 'text-gilded', glow: 'shadow-gilded/30' };
  if (tier >= 5) return { border: 'border-blossom/70', text: 'text-blossom', glow: 'shadow-blossom/30' };
  if (tier >= 3) return { border: 'border-cyber/60', text: 'text-cyber', glow: 'shadow-cyber/20' };
  return { border: 'border-white/20', text: 'text-ink-dim', glow: 'shadow-black/20' };
}

interface HandStrengthBadgeProps {
  holeCards: Card[];
  communityCards: Card[];
  compact?: boolean;
}

/** 내 홀카드 + 보드로 현재 메이드 핸드를 실시간 표시 (내 카드만 사용하므로 치팅 아님) */
export default function HandStrengthBadge({ holeCards, communityCards, compact = false }: HandStrengthBadgeProps) {
  const info = useMemo(() => {
    if (holeCards.length < 2) return null;

    // 프리플랍: evaluateHand는 5장 미만에서 크래시하므로 자체 라벨
    if (communityCards.length < 3) {
      const [a, b] = holeCards;
      // 포커 표준 표기: 10은 T (예: AT 오프수트, 포켓 TT)
      const short = (r: Card['rank']) => (r === '10' ? 'T' : r);
      if (a.rank === b.rank) {
        return { label: `포켓 ${short(a.rank)}${short(a.rank)}`, tier: 2 };
      }
      const high = rankValue(a.rank) >= rankValue(b.rank) ? a : b;
      const low = high === a ? b : a;
      const suited = a.suit === b.suit ? '수딧' : '오프수트';
      return { label: `${short(high.rank)}${short(low.rank)} ${suited}`, tier: 1 };
    }

    const hand = evaluateHand(holeCards, communityCards);
    return { label: HAND_RANK_KO[hand.rank], tier: RANK_TIER[hand.rank] };
  }, [holeCards, communityCards]);

  if (!info) return null;
  const style = tierStyle(info.tier);

  return (
    <AnimatePresence mode="popLayout">
      <motion.div
        key={info.label}
        initial={{ opacity: 0, scale: 0.7, y: 6 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.9 }}
        transition={{ type: 'spring', stiffness: 500, damping: 28 }}
        className={`inline-flex items-center gap-1 bg-black/70 backdrop-blur-sm rounded-full border shadow-lg
          ${style.border} ${style.glow}
          ${compact ? 'px-2 py-0.5' : 'px-3 py-1'}
        `}
      >
        <span className={`font-bold ${style.text} ${compact ? 'text-[10px]' : 'text-xs'}`}>
          {info.label}
        </span>
      </motion.div>
    </AnimatePresence>
  );
}
