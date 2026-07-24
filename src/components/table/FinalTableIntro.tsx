'use client';

import { motion } from 'framer-motion';
import { formatCountdown, useCountdownTo } from '@/lib/hooks/use-countdown';
import type { FinalTableThemePreset } from '@/lib/tournament/final-table-themes';

export default function FinalTableIntro({
  tournamentName,
  remaining,
  firstPrize,
  stageEndsAt,
  theme,
  reducedMotion,
}: {
  tournamentName?: string;
  remaining: number;
  firstPrize?: number;
  stageEndsAt: number;
  theme: FinalTableThemePreset;
  reducedMotion: boolean;
}) {
  const seconds = useCountdownTo(stageEndsAt);

  return (
    <motion.div
      role="status"
      aria-live="polite"
      className="absolute inset-0 z-40 flex items-center justify-center overflow-hidden bg-[color-mix(in_srgb,var(--final-stage)_88%,transparent)] px-5 text-center backdrop-blur-md"
      initial={reducedMotion ? { opacity: 1 } : { opacity: 0, scale: 1.04 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={reducedMotion ? { duration: 0 } : { duration: 0.55, ease: 'easeOut' }}
    >
      {!reducedMotion && (
        <motion.div
          aria-hidden
          className="absolute -inset-y-1/2 left-[-30%] w-1/2 rotate-12"
          style={{
            background: 'linear-gradient(90deg, transparent, color-mix(in srgb, var(--final-highlight) 24%, transparent), transparent)',
            filter: 'blur(26px)',
          }}
          animate={{ x: ['0vw', '170vw'] }}
          transition={{ duration: 2.8, ease: 'easeInOut' }}
        />
      )}
      <div className="relative w-full max-w-lg">
        <motion.p
          className="text-xs font-bold uppercase tracking-[0.45em] text-[var(--final-accent)] md:text-sm"
          initial={reducedMotion ? false : { opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: reducedMotion ? 0 : 0.18, duration: reducedMotion ? 0 : 0.35 }}
        >
          챔피언십 스테이지
        </motion.p>
        <motion.h2
          className="mt-2 text-5xl font-black tracking-tight text-[var(--final-highlight)] drop-shadow-[0_0_28px_color-mix(in_srgb,var(--final-accent)_70%,transparent)] sm:text-6xl md:text-7xl"
          style={{ fontFamily: 'var(--font-display)' }}
          initial={reducedMotion ? false : { opacity: 0, scale: 0.78 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={reducedMotion ? { duration: 0 } : { delay: 0.3, type: 'spring', stiffness: 180, damping: 16 }}
        >
          FINAL TABLE
        </motion.h2>
        {tournamentName && (
          <p className="mt-2 truncate text-base font-bold text-white/90 md:text-lg">
            {tournamentName}
          </p>
        )}
        <div className="mx-auto mt-5 grid max-w-sm grid-cols-2 overflow-hidden rounded-2xl border border-[var(--final-accent)]/35 bg-black/30 shadow-2xl">
          <div className="border-r border-white/10 px-3 py-3">
            <p className="text-[10px] tracking-widest text-white/55">남은 참가자</p>
            <p className="mt-1 text-lg font-black text-white">{remaining}명</p>
          </div>
          <div className="px-3 py-3">
            <p className="text-[10px] uppercase tracking-widest text-white/55">1위 상금</p>
            <p className="mt-1 text-lg font-black text-[var(--final-highlight)]">
              {(firstPrize ?? 0).toLocaleString()}
            </p>
          </div>
        </div>
        <p className="mt-4 text-xs font-bold text-white/70">
          {theme.label}
          <span className="mx-2 text-white/30">·</span>
          <span aria-hidden>
            {seconds === null ? '무대 준비 중…' : `${formatCountdown(seconds)} 후 시작`}
          </span>
          <span className="sr-only">잠시 후 파이널 테이블이 시작됩니다.</span>
        </p>
      </div>
    </motion.div>
  );
}
