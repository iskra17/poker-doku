'use client';

import { AnimatePresence, motion } from 'framer-motion';
import { useEffect, useRef, useState } from 'react';
import type { TournamentMilestone } from '@/lib/poker/types';
import { shouldShowItmCelebration } from './itm-celebration';

const CONFETTI = [
  { left: 4, color: '#f7c948', delay: 0.05, duration: 2.9, drift: 32, turn: 420 },
  { left: 9, color: '#ff7eb6', delay: 0.22, duration: 3.3, drift: -18, turn: -360 },
  { left: 14, color: '#7dd3fc', delay: 0.12, duration: 2.7, drift: 20, turn: 510 },
  { left: 19, color: '#fef08a', delay: 0.38, duration: 3.5, drift: -35, turn: 390 },
  { left: 24, color: '#fb7185', delay: 0.08, duration: 3.1, drift: 28, turn: -480 },
  { left: 29, color: '#c4b5fd', delay: 0.3, duration: 2.8, drift: -22, turn: 450 },
  { left: 34, color: '#fde68a', delay: 0.16, duration: 3.4, drift: 36, turn: -390 },
  { left: 39, color: '#f9a8d4', delay: 0.44, duration: 3, drift: -30, turn: 520 },
  { left: 44, color: '#67e8f9', delay: 0.04, duration: 2.6, drift: 24, turn: -420 },
  { left: 49, color: '#fbbf24', delay: 0.25, duration: 3.2, drift: -16, turn: 460 },
  { left: 54, color: '#fda4af', delay: 0.14, duration: 2.9, drift: 34, turn: -510 },
  { left: 59, color: '#a5b4fc', delay: 0.36, duration: 3.5, drift: -28, turn: 400 },
  { left: 64, color: '#fde047', delay: 0.1, duration: 2.8, drift: 18, turn: -440 },
  { left: 69, color: '#f0abfc', delay: 0.28, duration: 3.1, drift: -36, turn: 500 },
  { left: 74, color: '#7dd3fc', delay: 0.18, duration: 3.4, drift: 30, turn: -380 },
  { left: 79, color: '#facc15', delay: 0.42, duration: 2.7, drift: -24, turn: 470 },
  { left: 84, color: '#fb7185', delay: 0.06, duration: 3.3, drift: 22, turn: -530 },
  { left: 89, color: '#c4b5fd', delay: 0.32, duration: 2.9, drift: -32, turn: 410 },
  { left: 94, color: '#fef08a', delay: 0.2, duration: 3.2, drift: 16, turn: -460 },
] as const;

export default function ItmCelebration({
  milestone,
  reducedMotion,
  finishPlace,
}: {
  milestone?: TournamentMilestone;
  reducedMotion: boolean;
  finishPlace?: number;
}) {
  const [active, setActive] = useState<TournamentMilestone | null>(null);
  const seenSeq = useRef<number | null>(null);
  const seq = milestone?.seq ?? 0;
  const kind = milestone?.kind;
  const reachedAt = milestone?.reachedAt ?? 0;
  const expiresAt = milestone?.expiresAt ?? 0;
  const paidPlaces = milestone?.paidPlaces ?? 0;

  useEffect(() => {
    if (!seq || kind !== 'itm' || seenSeq.current === seq) return;
    const candidate: TournamentMilestone = {
      seq,
      kind,
      reachedAt,
      expiresAt,
      paidPlaces,
    };
    seenSeq.current = seq;
    const now = Date.now();
    if (!shouldShowItmCelebration(candidate, now, null, finishPlace)) return;

    const showTimer = setTimeout(() => setActive(candidate), 0);
    const hideTimer = setTimeout(
      () => setActive(current => current?.seq === seq ? null : current),
      Math.max(0, expiresAt - now),
    );
    return () => {
      clearTimeout(showTimer);
      clearTimeout(hideTimer);
    };
  }, [expiresAt, finishPlace, kind, paidPlaces, reachedAt, seq]);

  return (
    <AnimatePresence>
      {active && (
        <motion.div
          key={active.seq}
          role="status"
          aria-live="polite"
          className="pointer-events-none absolute inset-0 z-50 flex items-center justify-center overflow-hidden px-5 text-center"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: reducedMotion ? 0 : 0.3 }}
        >
          <div
            aria-hidden
            className="absolute inset-0 bg-[radial-gradient(circle_at_center,rgba(139,92,246,0.22),rgba(7,8,19,0.08)_48%,transparent_72%)]"
          />
          {!reducedMotion && CONFETTI.map((piece, index) => (
            <motion.span
              key={`${piece.left}-${index}`}
              aria-hidden
              className="absolute top-[-8%] h-3 w-1.5 rounded-[1px] shadow-sm"
              style={{ left: `${piece.left}%`, backgroundColor: piece.color }}
              animate={{
                y: ['0vh', '84vh'],
                x: [0, piece.drift, piece.drift / -2],
                rotate: [0, piece.turn],
                opacity: [0, 1, 1, 0.15],
              }}
              transition={{
                delay: piece.delay,
                duration: piece.duration,
                ease: 'linear',
                repeat: Infinity,
                repeatDelay: 0.2,
              }}
            />
          ))}
          <motion.div
            className="relative w-full max-w-md overflow-hidden rounded-3xl border border-gilded/55 bg-[linear-gradient(145deg,rgba(42,25,68,0.96),rgba(17,18,35,0.96))] px-6 py-7 shadow-[0_0_70px_rgba(247,201,72,0.28)] backdrop-blur-xl"
            initial={reducedMotion ? false : { opacity: 0, y: 18, scale: 0.9 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={reducedMotion ? { opacity: 0 } : { opacity: 0, y: -8, scale: 1.03 }}
            transition={reducedMotion ? { duration: 0 } : { type: 'spring', stiffness: 210, damping: 18 }}
          >
            <div
              aria-hidden
              className="absolute inset-x-10 top-0 h-px bg-gradient-to-r from-transparent via-gilded to-transparent"
            />
            <p className="text-[11px] font-black tracking-[0.38em] text-gilded">
              IN THE MONEY
            </p>
            <h2
              className="mt-2 text-4xl font-black text-white drop-shadow-[0_0_20px_rgba(251,191,36,0.35)] sm:text-5xl"
              style={{ fontFamily: 'var(--font-display)' }}
            >
              축하합니다!
            </h2>
            <p className="mt-1 text-xs font-bold text-blossom">
              딜러 미야코가 축하드려요
            </p>
            <p className="mt-3 text-sm font-semibold leading-relaxed text-white/85">
              버블이 종료되었습니다.
              <br />
              남은 선수 전원이 상금권에 진입했습니다.
            </p>
            <div className="mx-auto mt-4 inline-flex items-center rounded-full border border-gilded/35 bg-gilded/10 px-4 py-1.5 text-xs font-bold text-gilded">
              상금 지급 {active.paidPlaces}위까지
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
