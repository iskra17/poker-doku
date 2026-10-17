'use client';

import { useEffect, useState, type CSSProperties } from 'react';
import { motion } from 'framer-motion';
import CharacterImage from '@/components/characters/CharacterImage';
import type { SkillMove } from '@/lib/skills/catalog';
import type { SkillTier } from '@/lib/skills/skill-trigger';

/**
 * 파트너 필살기 장면 — SkillBurstLayer가 고른 연출을 그린다 (상태·이벤트 구독은 Layer 담당).
 *
 * - LiteBanner: 라이트 설정·모션 감소. 어두운 패널 + 흰 글씨 한 줄, 움직임 최소.
 * - MiniBurst: 풀 설정의 소 단계. 기술 모티프(swipe/soundwave)를 작게 쓴 상단 컷인.
 * - FullBurst: 중·대 단계. 기술 모티프(band/wave/dive/storm)별로 배경·캐릭터 동작이 다르다.
 *
 * 캐릭터 동작은 정지 일러스트를 움직여 만든다: 잔상(afterimage), 착지 찌그러짐(squash),
 * 흔들기(tilt), 표정 연기(acting — 시작 표정에서 끝 표정으로 교체).
 */

export interface BurstView {
  characterId: string;
  tier: SkillTier;
  move: SkillMove;
  shout: string;
  bbLabel: string;
  color: string;
  colorSecondary: string;
  /** 기본 재생 길이 (슬로 모션 배율 적용 전) */
  durationMs: number;
  /** 시간 배율 — 1이 실제 속도, 4면 4배 느리게 (연출 검토용) */
  timeScale: number;
  reduced: boolean;
}

/** 배율을 적용한 재생 길이(초) */
function seconds(view: BurstView): number {
  return (view.durationMs / 1000) * view.timeScale;
}

/** 모듈 상수: 렌더 순수성을 위해 난수 없이 결정적으로 분포시킨다 */
const SPEED_LINES = Array.from({ length: 36 }, (_, i) => {
  const angle = (i / 36) * Math.PI * 2 + ((i * 7) % 5) * 0.02;
  const half = 0.012 + ((i * 13) % 7) * 0.003;
  const inner = 34 + ((i * 17) % 18);
  const outer = 160;
  const px = (r: number, a: number) => `${(Math.cos(a) * r).toFixed(1)} ${(Math.sin(a) * r).toFixed(1)}`;
  return `M${px(inner, angle)} L${px(outer, angle - half)} L${px(outer, angle + half)} Z`;
}).join(' ');

const PETALS = Array.from({ length: 36 }, (_, i) => {
  const angle = (i * 137.5 * Math.PI) / 180;
  const r = 130 + ((i * 53) % 150);
  return {
    x: Math.cos(angle) * r,
    y: Math.sin(angle) * r * 0.75,
    rotate: (i * 67) % 360,
    scale: 0.6 + ((i * 29) % 40) / 100,
    delay: (i % 6) * 0.015,
  };
});

/** 착지 지점에서 위로 튀는 칩 궤적 (중력 포물선 4점) */
const CHIPS = Array.from({ length: 14 }, (_, i) => {
  const spread = (i - 6.5) * 26 + ((i * 17) % 11) - 5;
  const height = 140 + ((i * 41) % 120);
  return { x: spread, height, delay: (i % 5) * 0.02 };
});

const NOTES = ['♪', '♫', '♪', '♬'];
const PETAL_PATH = 'M10 1 C15 5 17 11 10 19 C3 11 5 5 10 1 Z';

function outlineShadow(color: string): string {
  return `-1.5px -1.5px 0 ${color}, 1.5px -1.5px 0 ${color}, -1.5px 1.5px 0 ${color}, 1.5px 1.5px 0 ${color}, 0 2px 0 ${color}`;
}

/** 기술명 — 큰 글씨는 외곽선(stroke를 글자 뒤에 칠함), 작은 글씨는 그림자 외곽선으로 획이 뭉개지지 않게 한다 */
export function SkillName({ view, sizeClass, outline }: { view: BurstView; sizeClass: string; outline: 'stroke' | 'shadow' }) {
  const style: CSSProperties = outline === 'stroke'
    ? {
        WebkitTextStroke: `4px ${view.colorSecondary}`,
        paintOrder: 'stroke fill',
        textShadow: `0 5px 0 ${view.colorSecondary}, 0 0 30px ${view.color}`,
      }
    : { textShadow: `${outlineShadow(view.colorSecondary)}, 0 0 14px ${view.color}` };
  return (
    <span
      className={`block break-keep font-black leading-[0.95] text-white ${sizeClass}`}
      style={{ fontFamily: 'var(--font-display)', transform: 'skewX(-8deg)', ...style }}
    >
      {view.move.name}
    </span>
  );
}

function Amount({ view, className }: { view: BurstView; className: string }) {
  return (
    <span className={`font-black text-gilded tabular ${className}`} style={{ textShadow: outlineShadow('var(--color-abyss)') }}>
      {view.bbLabel}
    </span>
  );
}

/** 표정 연기 — swapMs 뒤 끝 표정으로 바뀐다 (타이머 콜백에서만 setState) */
function ActingPortrait({ view, swapMs, className, round = false }: {
  view: BurstView; swapMs: number; className: string; round?: boolean;
}) {
  const [expression, setExpression] = useState(view.move.acting[0]);
  useEffect(() => {
    const timer = setTimeout(() => setExpression(view.move.acting[1]), swapMs);
    return () => clearTimeout(timer);
  }, [swapMs, view.move.acting]);
  return (
    <CharacterImage
      characterId={view.characterId}
      expression={expression}
      round={round}
      frameless={!round}
      className={className}
    />
  );
}

const PORTRAIT_MASK: CSSProperties = {
  maskImage: 'linear-gradient(to bottom, black 62%, transparent 96%)',
  WebkitMaskImage: 'linear-gradient(to bottom, black 62%, transparent 96%)',
};

type Keyframes = Record<string, (number | string)[]>;

/**
 * 잔상이 붙는 캐릭터 — 같은 궤적을 시간차로 따라오는 흐린 복제 2개 + 본체.
 * ghostOpacity는 잔상이 보이는 구간(돌진 중)만 0보다 크게 준다.
 */
function TrailPortrait({ view, className, style, animate, times, ghostOpacity, swapMs, ease = 'easeOut' }: {
  view: BurstView;
  className: string;
  style?: CSSProperties;
  animate: Keyframes;
  times: number[];
  ghostOpacity: number[];
  swapMs: number;
  ease?: 'easeOut' | 'easeIn' | 'linear';
}) {
  const d = seconds(view);
  const initial = Object.fromEntries(Object.entries(animate).map(([key, frames]) => [key, frames[0]]));
  return (
    <>
      {[0.07, 0.035].map((lag, i) => (
        <motion.div
          key={lag}
          className={className}
          style={{ ...style, ...PORTRAIT_MASK, filter: `brightness(1.7) saturate(0.4) drop-shadow(0 0 12px ${view.color})` }}
          initial={{ ...initial, opacity: 0 }}
          animate={{ ...animate, opacity: ghostOpacity.map(o => o * (i === 0 ? 0.35 : 0.55)) }}
          transition={{ duration: d, times, ease, delay: lag * view.timeScale }}
        >
          <CharacterImage characterId={view.characterId} expression={view.move.acting[0]} round={false} frameless className="h-full w-full" />
        </motion.div>
      ))}
      <motion.div
        className={className}
        style={{ ...style, ...PORTRAIT_MASK }}
        initial={initial}
        animate={animate}
        transition={{ duration: d, times, ease }}
      >
        <ActingPortrait view={view} swapMs={swapMs * view.timeScale} className="h-full w-full text-7xl" />
      </motion.div>
    </>
  );
}

function Flash({ view, strength, delay = 0 }: { view: BurstView; strength: number; delay?: number }) {
  const s = view.timeScale;
  return (
    <motion.div
      className="absolute inset-0 bg-white mix-blend-screen"
      initial={{ opacity: delay > 0 ? 0 : strength }}
      animate={{ opacity: [strength, strength, 0] }}
      transition={{ duration: 0.26 * s, times: [0, 0.28, 1], ease: 'easeOut', delay: delay * s }}
    />
  );
}

function Vignette({ view, tint }: { view: BurstView; tint: string }) {
  const d = seconds(view);
  return (
    <motion.div
      className="absolute inset-0"
      style={{ background: `radial-gradient(ellipse at center, transparent 28%, ${tint} 68%, var(--color-abyss) 115%)` }}
      initial={{ opacity: 0 }}
      animate={{ opacity: [0, 1, 1, 0] }}
      transition={{ duration: d, times: [0, 0.1, 0.78, 1], ease: 'easeOut' }}
    />
  );
}

function SpeedLines({ view, spin = 0 }: { view: BurstView; spin?: number }) {
  const d = seconds(view);
  return (
    <motion.svg
      viewBox="-100 -100 200 200"
      preserveAspectRatio="xMidYMid slice"
      className="absolute inset-0 h-full w-full"
      initial={{ opacity: 0, scale: 1.5, rotate: 0 }}
      animate={{ opacity: [0, 0.95, 0.7, 0], scale: [1.5, 1, 1, 0.94], rotate: [0, spin * 0.6, spin * 0.9, spin] }}
      transition={{ duration: d, times: [0, 0.12, 0.72, 1], ease: 'easeOut' }}
    >
      <path d={SPEED_LINES} fill={view.color} opacity={0.5} />
      <path d={SPEED_LINES} fill="white" opacity={0.35} transform="rotate(4)" />
    </motion.svg>
  );
}

function Ring({ view, delay, scale, className = '' }: { view: BurstView; delay: number; scale: number; className?: string }) {
  const s = view.timeScale;
  return (
    <motion.div
      className={`absolute -ml-16 -mt-16 h-32 w-32 rounded-full border-4 border-gilded ${className}`}
      initial={{ scale: 0, opacity: 0 }}
      animate={{ scale: [0, scale], opacity: [1, 0] }}
      transition={{ duration: 0.55 * s, delay: delay * s, ease: 'easeOut' }}
    />
  );
}

function PetalBurst({ view, count, spread = 1, delay = 0.08, className = 'left-1/2 top-1/2' }: {
  view: BurstView; count: number; spread?: number; delay?: number; className?: string;
}) {
  const d = seconds(view);
  return (
    <>
      {PETALS.slice(0, count).map((p, i) => (
        <motion.svg
          key={i}
          viewBox="0 0 20 20"
          className={`absolute -ml-2.5 -mt-2.5 h-5 w-5 ${className}`}
          initial={{ x: 0, y: 0, opacity: 0, scale: 0.3 }}
          animate={{
            x: [0, p.x * spread * 0.75, p.x * spread, p.x * spread * 1.05],
            y: [0, p.y * spread * 0.75, p.y * spread + 20, p.y * spread + 60],
            rotate: [0, p.rotate * 0.5, p.rotate, p.rotate + 120],
            opacity: [0, 1, 1, 0],
            scale: [0.3, p.scale, p.scale, p.scale * 0.8],
          }}
          transition={{ duration: d * 0.95, delay: (delay + p.delay) * view.timeScale, times: [0, 0.18, 0.6, 1], ease: 'easeOut' }}
        >
          <path d={PETAL_PATH} fill={i % 3 === 0 ? 'white' : view.color} stroke={view.colorSecondary} strokeWidth={0.6} />
        </motion.svg>
      ))}
    </>
  );
}

/** 오른쪽(또는 아래 중앙) 기술명 스탬프 */
function Stamp({ view, placement, delay = 0 }: { view: BurstView; placement: 'right' | 'bottom'; delay?: number }) {
  const d = seconds(view);
  const big = view.tier === 'big';
  const position = placement === 'right'
    ? 'right-[3%] top-1/2 w-[64%] items-end text-right sm:right-[8%] sm:w-[52%]'
    : 'bottom-[12%] left-1/2 w-[92%] items-center text-center sm:w-[70%]';
  return (
    <motion.div
      className={`absolute flex flex-col ${position}`}
      style={placement === 'right' ? { y: '-50%' } : { x: '-50%' }}
      initial={{ opacity: 0, scale: 2.4 }}
      animate={{ opacity: [0, 1, 1, 1, 0], scale: [2.4, 0.94, 1, 1, 1.08] }}
      transition={{ duration: d - delay * view.timeScale, times: [0, 0.16, 0.24, 0.86, 1], ease: 'easeOut', delay: delay * view.timeScale }}
    >
      <span
        className="mb-1 text-sm font-bold text-white sm:text-base"
        style={{ fontFamily: 'var(--font-display)', textShadow: outlineShadow(view.colorSecondary) }}
      >
        {view.shout}
      </span>
      <SkillName
        view={view}
        outline="stroke"
        sizeClass={big ? 'text-[clamp(2.2rem,10vw,5rem)]' : 'text-[clamp(1.9rem,8.5vw,4rem)]'}
      />
      <Amount view={view} className="mt-2 text-xl sm:text-2xl" />
    </motion.div>
  );
}

// ───────────────────────────── 라이트 배너 ─────────────────────────────

/** 라이트·모션 감소: 어두운 패널에 흰 글씨 — 어떤 배경 위에서도 읽힌다 */
export function LiteBanner({ view }: { view: BurstView }) {
  const d = seconds(view);
  return (
    <motion.div
      className="absolute left-1/2 top-[22%] flex max-w-[92vw] items-center gap-2.5 rounded-full border-2 bg-abyss/90 py-1.5 pl-1.5 pr-5 shadow-2xl"
      style={{ x: '-50%', borderColor: view.color, boxShadow: `0 0 22px ${view.color}66` }}
      initial={view.reduced ? { opacity: 0 } : { opacity: 0, scale: 0.9 }}
      animate={view.reduced ? { opacity: [0, 1, 1, 0] } : { opacity: [0, 1, 1, 0], scale: [0.9, 1, 1, 1] }}
      exit={{ opacity: 0, transition: { duration: 0.12 } }}
      transition={{ duration: d, times: [0, 0.18, 0.82, 1], ease: 'easeOut' }}
    >
      <span className="block h-9 w-9 shrink-0 overflow-hidden rounded-full border-2" style={{ borderColor: view.color }}>
        <CharacterImage characterId={view.characterId} expression={view.move.acting[1]} className="h-full w-full text-lg" />
      </span>
      <span className="text-xl font-black text-white" style={{ fontFamily: 'var(--font-display)' }}>{view.move.name}</span>
      <Amount view={view} className="text-base" />
    </motion.div>
  );
}

// ───────────────────────────── 소 단계 (풀) ─────────────────────────────

/** 풀 설정의 소 단계: 상단 미니 컷인. swipe는 사선 스윕 + 돌진 잔상, soundwave는 음파 링 + 음표 */
export function MiniBurst({ view }: { view: BurstView }) {
  const d = seconds(view);
  const swipe = view.move.motif === 'swipe';
  return (
    <motion.div className="absolute inset-x-0 top-[14%] h-36" exit={{ opacity: 0, transition: { duration: 0.12 } }}>
      {swipe && (
        <motion.div
          className="absolute left-0 top-1/2 h-2 w-[70vw] rounded-full"
          style={{ rotate: -10, background: `linear-gradient(90deg, transparent, white, ${view.color}, transparent)` }}
          initial={{ x: '-80vw', opacity: 0 }}
          animate={{ x: ['-80vw', '110vw'], opacity: [0, 1, 1, 0] }}
          transition={{ duration: 0.3 * view.timeScale, ease: 'easeIn' }}
        />
      )}

      <div className="absolute left-1/2 top-1/2" style={{ transform: 'translate(-50%, -50%)' }}>
        {/* 음파 링 — 캐릭터 위치에서 퍼진다 */}
        {!swipe && [0, 0.12, 0.24].map(delay => (
          <motion.div
            key={delay}
            className="absolute -left-6 top-1/2 -ml-10 -mt-10 h-20 w-20 rounded-full border-2"
            style={{ borderColor: view.color }}
            initial={{ scale: 0.4, opacity: 0 }}
            animate={{ scale: [0.4, 2.4], opacity: [0.9, 0] }}
            transition={{ duration: 0.6 * view.timeScale, delay: (0.1 + delay) * view.timeScale, ease: 'easeOut' }}
          />
        ))}
        {!swipe && NOTES.map((note, i) => (
          <motion.span
            key={i}
            className="absolute -left-4 top-0 text-2xl font-black"
            style={{ color: i % 2 ? 'white' : view.color, textShadow: outlineShadow(view.colorSecondary) }}
            initial={{ x: 0, y: 0, opacity: 0 }}
            animate={{ x: [0, (i - 1.5) * 22, (i - 1.5) * 34], y: [0, -40, -78], opacity: [0, 1, 0], rotate: [0, (i - 1.5) * 12] }}
            transition={{ duration: d * 0.85, delay: (0.12 + i * 0.07) * view.timeScale, ease: 'easeOut' }}
          >
            {note}
          </motion.span>
        ))}

        <motion.div
          className="relative flex items-center gap-2 whitespace-nowrap rounded-full border-2 bg-abyss/90 py-1.5 pl-16 pr-5"
          style={{ borderColor: view.color, boxShadow: `0 0 26px ${view.color}88` }}
          initial={{ opacity: 0, scale: 1.4, rotate: -4 }}
          animate={{ opacity: [0, 1, 1, 0], scale: [1.4, 0.96, 1, 1], rotate: -4 }}
          transition={{ duration: d, times: [0, 0.2, 0.82, 1], ease: 'easeOut', delay: swipe ? 0.12 * view.timeScale : 0 }}
        >
          <SkillName view={view} outline="shadow" sizeClass="text-2xl sm:text-3xl" />
          <Amount view={view} className="text-base sm:text-lg" />
        </motion.div>

        {/* 배너 왼쪽 위로 튀어나오는 캐릭터 */}
        <TrailPortrait
          view={view}
          className="absolute -left-8 -top-16 h-28 w-24"
          animate={swipe
            ? { x: [-140, 6, 0, 0, -20], y: [10, -4, 0, 0, 0], rotate: [-14, 4, 0, 0, 0] }
            : { y: [40, -10, 0, -3, 0], rotate: [0, -6, 4, -2, 0], scale: [0.8, 1.08, 1, 1.02, 1] }}
          times={[0, 0.22, 0.32, 0.86, 1]}
          ghostOpacity={swipe ? [0, 1, 0, 0, 0] : [0, 0.6, 0, 0, 0]}
          swapMs={swipe ? 260 : 320}
        />
        <PetalBurst view={view} count={swipe ? 8 : 6} spread={0.45} delay={swipe ? 0.18 : 0.12} className="left-1/2 top-1/2" />
      </div>
    </motion.div>
  );
}

// ───────────────────────────── 중·대 단계 ─────────────────────────────

export function FullBurst({ view }: { view: BurstView }) {
  return (
    <motion.div className="absolute inset-0" exit={{ opacity: 0, transition: { duration: 0.12 } }}>
      {view.move.motif === 'wave' && <WaveScene view={view} />}
      {view.move.motif === 'dive' && <DiveScene view={view} />}
      {view.move.motif === 'storm' && <StormScene view={view} />}
      {(view.move.motif === 'band' || view.move.motif === 'swipe' || view.move.motif === 'soundwave') && <BandScene view={view} />}
    </motion.div>
  );
}

function DiagonalBand({ view, rotate, top = '50%', horizontalSweep = false }: {
  view: BurstView; rotate: number; top?: string; horizontalSweep?: boolean;
}) {
  const d = seconds(view);
  return (
    <motion.div
      className="absolute left-[-15%] right-[-15%] h-[32%] max-h-[280px] overflow-hidden"
      style={{
        top,
        y: '-50%',
        rotate,
        background: `linear-gradient(90deg, ${view.color}f2, ${view.colorSecondary}f2)`,
        boxShadow: `0 0 48px ${view.color}aa`,
        transformOrigin: horizontalSweep ? 'left center' : 'center',
      }}
      initial={horizontalSweep ? { scaleX: 0 } : { scaleY: 0 }}
      animate={horizontalSweep ? { scaleX: [0, 1, 1, 1] , scaleY: [1, 1, 1, 0] } : { scaleY: [0, 1.1, 1, 1, 0] }}
      transition={{ duration: d, times: horizontalSweep ? [0, 0.12, 0.84, 1] : [0, 0.1, 0.18, 0.84, 1], ease: 'easeOut' }}
    >
      <motion.div
        className="absolute inset-0 opacity-25"
        style={{ backgroundImage: 'repeating-linear-gradient(115deg, white 0 2px, transparent 2px 22px)' }}
        initial={{ x: 0 }}
        animate={{ x: -140 }}
        transition={{ duration: d, ease: 'linear' }}
      />
    </motion.div>
  );
}

/** band — 사선 띠를 가르며 왼쪽에서 돌진 (잔상) */
function BandScene({ view }: { view: BurstView }) {
  const big = view.tier === 'big';
  return (
    <>
      <Vignette view={view} tint={`${view.colorSecondary}40`} />
      <SpeedLines view={view} />
      <div className="absolute left-1/2 top-1/2"><Ring view={view} delay={0.07} scale={big ? 5 : 3.4} /></div>
      <DiagonalBand view={view} rotate={-7} />
      <PetalBurst view={view} count={18} />
      <TrailPortrait
        view={view}
        className="absolute bottom-[20%] left-[-4%] aspect-[3/4] w-[52%] max-w-[380px] sm:left-[6%]"
        animate={{ x: ['-70%', '6%', '0%', '0%', '-25%'], opacity: [0, 1, 1, 1, 0], scale: [1.15, 1, 1, 1.03, 1], rotate: [-8, 2, 0, 0, 0] }}
        times={[0, 0.14, 0.24, 0.86, 1]}
        ghostOpacity={[0, 1, 0.3, 0, 0]}
        swapMs={view.durationMs * 0.28}
      />
      <Stamp view={view} placement="right" />
      <Flash view={view} strength={big ? 0.95 : 0.8} />
    </>
  );
}

/** wave — 청록 물결(지고 있던 흐름)을 분홍 물결이 뒤덮는 역전 + 무대 스포트라이트 */
function WaveScene({ view }: { view: BurstView }) {
  const d = seconds(view);
  const wavePath = 'M0 26 Q 25 6 50 26 T 100 26 T 150 26 T 200 26 V100 H0 Z';
  return (
    <>
      <Vignette view={view} tint="color-mix(in srgb, var(--color-cyber) 30%, transparent)" />
      {/* 스포트라이트 두 줄기 — 앙코르 무대 */}
      {[-1, 1].map(side => (
        <motion.div
          key={side}
          className="absolute top-[-10%] h-[90%] w-[34%]"
          style={{
            left: side < 0 ? '8%' : 'auto',
            right: side > 0 ? '8%' : 'auto',
            background: 'linear-gradient(to bottom, rgb(255 255 255 / 0.55), transparent 85%)',
            clipPath: 'polygon(45% 0, 55% 0, 100% 100%, 0 100%)',
            transformOrigin: 'top center',
            mixBlendMode: 'screen',
          }}
          initial={{ opacity: 0, rotate: side * 18 }}
          animate={{ opacity: [0, 0, 0.8, 0.6, 0], rotate: [side * 18, side * 18, side * -6, side * 4, side * 4] }}
          transition={{ duration: d, times: [0, 0.3, 0.45, 0.85, 1], ease: 'easeOut' }}
        />
      ))}
      {/* 지고 있던 흐름 — 청록 물결이 먼저 차오른다 */}
      <motion.svg
        viewBox="0 0 200 100"
        preserveAspectRatio="none"
        className="absolute bottom-0 left-0 h-[48%] w-[200%]"
        initial={{ y: '100%', x: '0%' }}
        animate={{ y: ['100%', '8%', '8%', '100%'], x: ['0%', '-25%', '-40%', '-50%'] }}
        transition={{ duration: d, times: [0, 0.2, 0.5, 0.75], ease: 'easeOut' }}
      >
        <path d={wavePath} fill="var(--color-cyber)" opacity={0.7} />
      </motion.svg>
      {/* 역전 — 분홍 물결이 오른쪽에서 덮친다 */}
      <motion.svg
        viewBox="0 0 200 100"
        preserveAspectRatio="none"
        className="absolute bottom-0 left-0 h-[56%] w-[200%]"
        initial={{ x: '50%', y: '0%' }}
        animate={{ x: ['50%', '50%', '-20%', '-50%', '-50%'], y: ['0%', '0%', '0%', '0%', '100%'] }}
        transition={{ duration: d, times: [0, 0.26, 0.42, 0.85, 1], ease: 'easeOut' }}
      >
        <path d={wavePath} fill={view.color} opacity={0.88} />
        <path d={wavePath} fill="white" opacity={0.25} transform="translate(0 8)" />
      </motion.svg>
      {/* 아래에서 솟아오르며 놀람 → 자신감 */}
      <TrailPortrait
        view={view}
        className="absolute bottom-[14%] left-[4%] aspect-[3/4] w-[50%] max-w-[360px] sm:left-[10%]"
        animate={{ y: ['70%', '70%', '-6%', '0%', '0%', '10%'], opacity: [0, 0, 1, 1, 1, 0], rotate: [0, 0, -4, 2, 0, 0] }}
        times={[0, 0.26, 0.42, 0.52, 0.86, 1]}
        ghostOpacity={[0, 0, 0.8, 0, 0, 0]}
        swapMs={view.durationMs * 0.44}
      />
      <PetalBurst view={view} count={20} delay={0.4} />
      <Stamp view={view} placement="right" delay={0.38} />
      <Flash view={view} strength={0.6} />
      <Flash view={view} strength={0.9} delay={0.36} />
    </>
  );
}

/** dive — 위에서 떨어져 착지(찌그러짐) → 충격파·칩 분수 */
function DiveScene({ view }: { view: BurstView }) {
  const d = seconds(view);
  // 헬퍼(Ring·Stamp·Flash)는 배율 전 시간을 받으므로 착지 시점도 배율 전 기준으로 넘긴다
  const base = view.durationMs / 1000;
  const land = 0.24;
  return (
    <>
      <Vignette view={view} tint={`${view.colorSecondary}50`} />
      <SpeedLines view={view} spin={8} />
      <DiagonalBand view={view} rotate={0} top="62%" horizontalSweep />
      <div className="absolute left-[30%] top-[78%] sm:left-[28%]">
        <Ring view={view} delay={base * land} scale={4.4} />
        <Ring view={view} delay={base * land + 0.1} scale={2.6} className="border-white" />
        {CHIPS.map((chip, i) => (
          <motion.span
            key={i}
            className="absolute -ml-2 -mt-2 block h-4 w-4 rounded-full border-2 border-white/70 bg-gilded"
            initial={{ x: 0, y: 0, opacity: 0 }}
            animate={{
              x: [0, chip.x * 0.6, chip.x, chip.x * 1.2],
              y: [0, -chip.height, -chip.height * 0.7, 40],
              opacity: [0, 1, 1, 0],
              rotateX: [0, 180, 360, 540],
            }}
            transition={{ duration: d * 0.7, delay: (base * land + chip.delay) * view.timeScale, times: [0, 0.35, 0.65, 1], ease: 'easeOut' }}
          />
        ))}
      </div>
      <TrailPortrait
        view={view}
        className="absolute bottom-[20%] left-[6%] aspect-[3/4] w-[50%] max-w-[360px] sm:left-[10%]"
        style={{ transformOrigin: 'bottom center' }}
        animate={{
          y: ['-140%', '0%', '0%', '-4%', '0%', '0%'],
          scaleY: [1.12, 1.12, 0.82, 1.06, 1, 1],
          scaleX: [0.9, 0.9, 1.14, 0.97, 1, 1],
          opacity: [1, 1, 1, 1, 1, 0],
        }}
        times={[0, land, land + 0.05, land + 0.13, 0.86, 1]}
        ghostOpacity={[0.8, 0.8, 0, 0, 0, 0]}
        swapMs={view.durationMs * (land + 0.05)}
        ease="easeIn"
      />
      <Stamp view={view} placement="right" delay={base * land} />
      <Flash view={view} strength={0.95} delay={base * land} />
    </>
  );
}

/** storm — 꽃잎 소용돌이 한가운데서 커지는 캐릭터, 이중 플래시 */
function StormScene({ view }: { view: BurstView }) {
  const d = seconds(view);
  return (
    <>
      <Vignette view={view} tint={`${view.color}55`} />
      <SpeedLines view={view} spin={40} />
      {/* 소용돌이 — 꽃잎 고리가 회전하며 퍼진다 */}
      {[0, 1].map(ring => (
        <motion.div
          key={ring}
          className="absolute left-1/2 top-[45%] h-0 w-0"
          initial={{ rotate: 0, scale: 0.3, opacity: 0 }}
          animate={{ rotate: ring ? -420 : 520, scale: [0.3, 1, 1.25, 1.5], opacity: [0, 1, 1, 0] }}
          transition={{ duration: d, times: [0, 0.2, 0.75, 1], ease: 'easeOut' }}
        >
          {PETALS.slice(ring * 18, ring * 18 + 18).map((p, i) => {
            const angle = (i / 18) * Math.PI * 2;
            const r = 120 + ring * 70 + (i % 3) * 18;
            return (
              <svg
                key={i}
                viewBox="0 0 20 20"
                className="absolute -ml-3 -mt-3 h-6 w-6"
                style={{ transform: `translate(${Math.cos(angle) * r}px, ${Math.sin(angle) * r * 0.8}px) rotate(${p.rotate}deg) scale(${p.scale})` }}
              >
                <path d={PETAL_PATH} fill={i % 3 === 0 ? 'white' : view.color} stroke={view.colorSecondary} strokeWidth={0.6} />
              </svg>
            );
          })}
        </motion.div>
      ))}
      <div className="absolute left-1/2 top-[45%]">
        <Ring view={view} delay={0.05} scale={5.5} />
        <Ring view={view} delay={0.42} scale={4} className="border-white" />
      </div>
      <TrailPortrait
        view={view}
        className="absolute left-1/2 top-[8%] aspect-[3/4] w-[52%] max-w-[380px]"
        style={{ x: '-50%' }}
        animate={{ scale: [0.5, 1.12, 0.96, 1.02, 1, 1.04], rotate: [-10, 6, -3, 2, 0, 0], opacity: [0, 1, 1, 1, 1, 0] }}
        times={[0, 0.2, 0.32, 0.44, 0.86, 1]}
        ghostOpacity={[0, 0.9, 0.4, 0, 0, 0]}
        swapMs={view.durationMs * 0.36}
      />
      <Stamp view={view} placement="bottom" delay={0.1} />
      <Flash view={view} strength={0.95} />
      <Flash view={view} strength={0.7} delay={0.42} />
    </>
  );
}
