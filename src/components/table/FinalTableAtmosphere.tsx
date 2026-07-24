'use client';

import { motion } from 'framer-motion';
import type { FinalTableThemePreset } from '@/lib/tournament/final-table-themes';

const PARTICLES = [
  { left: '7%', top: '8%', size: 8, driftX: 22, driftY: 88, rotate: 140, duration: 8.2, delay: 0.2 },
  { left: '16%', top: '29%', size: 6, driftX: -15, driftY: 72, rotate: -110, duration: 7.1, delay: 1.4 },
  { left: '27%', top: '5%', size: 10, driftX: 19, driftY: 104, rotate: 180, duration: 9.4, delay: 2.1 },
  { left: '39%', top: '20%', size: 7, driftX: -20, driftY: 84, rotate: -150, duration: 7.8, delay: 0.7 },
  { left: '53%', top: '4%', size: 9, driftX: 14, driftY: 96, rotate: 130, duration: 8.8, delay: 3.0 },
  { left: '64%', top: '25%', size: 6, driftX: -17, driftY: 78, rotate: -125, duration: 7.4, delay: 1.8 },
  { left: '74%', top: '9%', size: 9, driftX: 21, driftY: 92, rotate: 160, duration: 9.1, delay: 0.4 },
  { left: '86%', top: '31%', size: 7, driftX: -13, driftY: 70, rotate: -100, duration: 7.6, delay: 2.7 },
  { left: '93%', top: '6%', size: 8, driftX: -23, driftY: 99, rotate: 145, duration: 8.5, delay: 1.1 },
] as const;

export default function FinalTableAtmosphere({
  theme,
  reducedMotion,
}: {
  theme: FinalTableThemePreset;
  reducedMotion: boolean;
}) {
  return (
    <div
      aria-hidden="true"
      data-final-table-theme={theme.label}
      className="pointer-events-none absolute inset-0 z-0 overflow-hidden bg-[var(--final-stage)]"
    >
      <div
        className="absolute inset-0 opacity-80"
        style={{
          background: `
            radial-gradient(ellipse at 50% 22%, color-mix(in srgb, var(--final-highlight) 22%, transparent) 0%, transparent 42%),
            radial-gradient(circle at 12% 45%, color-mix(in srgb, var(--final-accent) 18%, transparent) 0%, transparent 35%),
            radial-gradient(circle at 88% 55%, color-mix(in srgb, var(--final-accent) 16%, transparent) 0%, transparent 34%)
          `,
        }}
      />
      <motion.div
        className="absolute -left-[20%] -top-[55%] h-[135%] w-[62%] origin-top rotate-[18deg]"
        style={{
          background: 'linear-gradient(90deg, transparent, color-mix(in srgb, var(--final-highlight) 11%, transparent), transparent)',
          filter: 'blur(20px)',
        }}
        initial={false}
        animate={reducedMotion ? undefined : { x: ['-10%', '38%', '-10%'], opacity: [0.35, 0.7, 0.35] }}
        transition={{ duration: 9, repeat: Infinity, ease: 'easeInOut' }}
      />
      <motion.div
        className="absolute -right-[20%] -top-[45%] h-[125%] w-[58%] origin-top -rotate-[18deg]"
        style={{
          background: 'linear-gradient(90deg, transparent, color-mix(in srgb, var(--final-accent) 12%, transparent), transparent)',
          filter: 'blur(22px)',
        }}
        initial={false}
        animate={reducedMotion ? undefined : { x: ['8%', '-34%', '8%'], opacity: [0.3, 0.65, 0.3] }}
        transition={{ duration: 10, repeat: Infinity, ease: 'easeInOut' }}
      />
      {PARTICLES.map((particle, index) => (
        <motion.span
          key={index}
          className="absolute block bg-[var(--final-particle)] shadow-[0_0_10px_color-mix(in_srgb,var(--final-accent)_55%,transparent)]"
          style={{
            left: particle.left,
            top: particle.top,
            width: particle.size,
            height: particle.size * 0.68,
            borderRadius: 'var(--final-particle-radius)',
          }}
          initial={false}
          animate={reducedMotion ? undefined : {
            x: [0, particle.driftX, 0],
            y: [0, particle.driftY, 0],
            rotate: [0, particle.rotate, particle.rotate * 2],
            opacity: [0.2, 0.85, 0.2],
          }}
          transition={{
            duration: particle.duration,
            delay: particle.delay,
            repeat: Infinity,
            ease: 'easeInOut',
          }}
        />
      ))}
      <div
        className="absolute inset-0"
        style={{
          background: 'radial-gradient(ellipse at center, transparent 40%, color-mix(in srgb, var(--final-stage) 84%, transparent) 100%)',
        }}
      />
    </div>
  );
}
