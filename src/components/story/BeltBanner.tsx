'use client';

import { motion } from 'framer-motion';
import { BELT_LABEL } from '@/lib/story/story-hub-rules';
import type { StoryBelt } from '@/lib/story/types';

const BELT_COLOR: Readonly<Record<StoryBelt, string>> = Object.freeze({
  white: '#f4edff',
  yellow: '#ffd76a',
  blue: '#6be4ff',
  brown: '#b5773f',
  black: '#2a2e3f',
});

interface BeltBannerProps {
  belt: StoryBelt;
  /** 연출이 끝나 상단 필로 축소된 상태 */
  settled: boolean;
  reducedMotion: boolean;
}

/** 띠 승급 배너 — 띠 색 가로 띠가 슬라이드 인 → 잠시 뒤 결산 상단의 작은 필로 남는다 */
export default function BeltBanner({ belt, settled, reducedMotion }: BeltBannerProps) {
  const color = BELT_COLOR[belt];
  const textDark = belt === 'white' || belt === 'yellow';
  return (
    <motion.div
      layout={!reducedMotion}
      initial={reducedMotion || settled ? false : { x: '-110%', opacity: 0 }}
      animate={{ x: 0, opacity: 1, scale: settled ? 0.92 : 1 }}
      transition={{ type: 'spring', stiffness: 220, damping: 22 }}
      className={`mx-auto flex items-center justify-center gap-2 rounded-xl border px-4 ${settled ? 'py-1' : 'py-3'}`}
      style={{ x: 0, backgroundColor: `${color}${settled ? '22' : '33'}`, borderColor: `${color}99` }}
      aria-label={`${BELT_LABEL[belt]} 승급`}
    >
      <span className={settled ? 'text-base' : 'text-2xl'} aria-hidden>🥋</span>
      <span className={`font-black ${settled ? 'text-sm' : 'text-lg'}`} style={{ color: textDark ? color : '#f4edff' }}>
        {BELT_LABEL[belt]} 승급!
      </span>
      {!settled && <span className="text-[11px] text-ink-dim">후후, 잘 어울리는걸요♪</span>}
    </motion.div>
  );
}
