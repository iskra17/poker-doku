'use client';

import { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import Confetti from '@/components/effects/Confetti';
import { usePrefersReducedMotion } from '@/lib/hooks/use-reduced-motion';
import type { DrillMomentPick } from '@/lib/story/drill-moments';

interface DrillMomentLayerProps {
  /** 문항 키 — 바뀌면 연출 리셋 */
  momentKey: string;
  pick: DrillMomentPick | null;
  /** 교사 한마디 (moment 대사) */
  line: string;
  teacherName: string;
  teacherColor: string | null;
}

const LINE_VISIBLE_MS = 4_500;

/**
 * 드릴 순간 연출 — 콤보/퍼펙트 스탬프 + 파티클 버스트 + 교사 한마디 말풍선.
 * DrillCard의 relative 래퍼 안에 absolute로 얹힌다(pointer-events none). 문항당 1회.
 */
export default function DrillMomentLayer({ momentKey, pick, line, teacherName, teacherColor }: DrillMomentLayerProps) {
  const reduced = usePrefersReducedMotion();
  const [lineVisible, setLineVisible] = useState(true);
  // 문항이 바뀌면 말풍선을 다시 켠다 (렌더 중 보정 패턴)
  const [trackedKey, setTrackedKey] = useState(momentKey);
  if (trackedKey !== momentKey) {
    setTrackedKey(momentKey);
    setLineVisible(true);
  }
  useEffect(() => {
    if (!pick || !line) return;
    const timer = setTimeout(() => setLineVisible(false), LINE_VISIBLE_MS);
    return () => clearTimeout(timer);
  }, [momentKey, pick, line]);

  if (!pick) return null;

  return (
    <div className="pointer-events-none absolute inset-0 z-10" aria-hidden>
      {pick.burst && !reduced && (
        <div className="absolute inset-0 overflow-hidden">
          <Confetti key={momentKey} particleCount={pick.moment === 'drill-perfect' ? 60 : 28} durationMs={pick.moment === 'drill-perfect' ? 1_500 : 900} />
        </div>
      )}
      <AnimatePresence>
        {pick.stamp && (
          <motion.div
            key={`${momentKey}:stamp`}
            initial={reduced ? false : { scale: 0.6, opacity: 0, rotate: -8 }}
            animate={{ scale: [0.6, 1.2, 1], opacity: 1, rotate: -8 }}
            exit={{ opacity: 0 }}
            transition={{ duration: reduced ? 0 : 0.45 }}
            className={`absolute left-1/2 top-3 rounded-xl border-2 px-4 py-1.5 font-black shadow-lg ${
              pick.moment === 'drill-perfect' ? 'border-gilded bg-gilded/15 text-2xl text-gilded' : 'border-blossom bg-blossom/15 text-lg text-blossom'
            }`}
            style={{ x: '-50%' }}
          >
            {pick.stamp}
          </motion.div>
        )}
      </AnimatePresence>
      <AnimatePresence>
        {line && lineVisible && (
          <motion.div
            key={`${momentKey}:line`}
            initial={reduced ? false : { opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            className="absolute bottom-2 right-2 max-w-[78%] rounded-2xl rounded-br-sm border bg-panel/95 px-3 py-2 text-[11px] text-ink shadow-lg backdrop-blur-sm"
            style={{ borderColor: teacherColor ? `${teacherColor}88` : undefined }}
          >
            <span className="mr-1 font-bold" style={{ color: teacherColor ?? undefined }}>{teacherName}</span>
            {line}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
