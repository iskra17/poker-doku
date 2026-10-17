'use client';

import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import CharacterImage from '@/components/characters/CharacterImage';
import { getCharacterById } from '@/lib/characters';
import { onGameEvent } from '@/lib/events/game-events';
import { usePrefersReducedMotion } from '@/lib/hooks/use-reduced-motion';
import { getSkillDef, onSkillPreview, type SkillDef } from '@/lib/skills/catalog';
import {
  applyBigCooldown,
  detectSkillTrigger,
  type SkillReason,
  type SkillTier,
} from '@/lib/skills/skill-trigger';
import { playEffect } from '@/lib/sound/effects';
import { useGameStore } from '@/lib/store/game-store';
import { useProgressionStore } from '@/lib/store/progression-store';
import { useSettingsStore } from '@/lib/store/settings-store';

/**
 * 파트너 필살기 연출 — 내 핸드 승리 순간에 인연 파트너가 기술을 쓴다.
 *
 * **내 화면 전용**: game-events(스냅샷 diff)만 구독하고 서버로 아무것도 보내지 않는다. 다른 플레이어
 * 화면에는 존재하지 않으며, 테이블 진행(다음 핸드 6.5초 예약)도 기다리게 하지 않는다.
 * 입력을 막지 않도록 pointer-events-none이고, 새 핸드·내 턴이 시작되면 즉시 끊는다.
 *
 * 리듬은 "짧고 세게": 히트스톱 플래시 → 슬래시 인 → 기술명 스탬프 → 1초 안팎에 퇴장.
 * 강도는 skill-trigger의 3단계, 설정 skillBurst(full/lite/off)와 모션 감소 설정을 따른다.
 */

interface Burst {
  key: number;
  def: SkillDef;
  tier: SkillTier;
  name: string;
  shout: string;
  bbLabel: string;
  color: string;
  colorSecondary: string;
  /** 모션 감소 — 투명도 변화만 남긴다 */
  reduced: boolean;
}

const DURATION_MS: Record<SkillTier, number> = { small: 700, medium: 1100, big: 1400 };
const SOUND: Record<SkillTier, 'skill-small' | 'skill-burst' | 'skill-big'> = {
  small: 'skill-small',
  medium: 'skill-burst',
  big: 'skill-big',
};
const SHAKE_PX: Record<Exclude<SkillTier, 'small'>, number> = { medium: 5, big: 11 };

const PREVIEW_REASON: Record<SkillTier, SkillReason> = {
  small: 'steal',
  medium: 'big-pot',
  big: 'river-comeback',
};
const PREVIEW_BB: Record<SkillTier, number> = { small: 8, medium: 42, big: 120 };

/** 집중선 — 화면 중앙에서 뻗는 가는 삼각형 (모듈 상수: 렌더 순수성 유지) */
const SPEED_LINES = Array.from({ length: 36 }, (_, i) => {
  const angle = (i / 36) * Math.PI * 2 + ((i * 7) % 5) * 0.02;
  const half = 0.012 + ((i * 13) % 7) * 0.003;
  const inner = 34 + ((i * 17) % 18);
  const outer = 160;
  const px = (r: number, a: number) => `${(Math.cos(a) * r).toFixed(1)} ${(Math.sin(a) * r).toFixed(1)}`;
  return `M${px(inner, angle)} L${px(outer, angle - half)} L${px(outer, angle + half)} Z`;
}).join(' ');

/** 꽃잎 버스트 궤적 — 황금각 분포로 고르게 퍼진다 */
const PETALS = Array.from({ length: 18 }, (_, i) => {
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

function formatBB(bb: number): string {
  return `+${bb >= 10 ? Math.round(bb) : bb.toFixed(1)}BB`;
}

function shakeTable(tier: Exclude<SkillTier, 'small'>): void {
  const el = document.querySelector<HTMLElement>('[data-skill-shake]');
  if (!el || typeof el.animate !== 'function') return;
  const a = SHAKE_PX[tier];
  el.animate(
    [
      { transform: 'translate(0, 0)' },
      { transform: `translate(${-a}px, ${a * 0.6}px)` },
      { transform: `translate(${a}px, ${-a * 0.4}px)` },
      { transform: `translate(${-a * 0.6}px, ${-a * 0.6}px)` },
      { transform: `translate(${a * 0.4}px, ${a * 0.3}px)` },
      { transform: 'translate(0, 0)' },
    ],
    // 70ms 뒤 시작 — 플래시가 멈춰 있는 히트스톱 구간 다음에 흔들린다
    { duration: tier === 'big' ? 360 : 260, delay: 70, easing: 'ease-out' },
  );
}

function vibrate(tier: SkillTier): void {
  try {
    navigator.vibrate?.(tier === 'big' ? [18, 40, 70] : [30]);
  } catch {
    // 진동 미지원·권한 없음은 무시
  }
}

export default function SkillBurstLayer() {
  const [burst, setBurst] = useState<Burst | null>(null);
  const reducedMotion = usePrefersReducedMotion();
  const reducedRef = useRef(reducedMotion);
  const keyRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastBigHandRef = useRef<number | null>(null);

  useEffect(() => {
    reducedRef.current = reducedMotion;
  }, [reducedMotion]);

  useEffect(() => {
    const clear = () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = null;
      setBurst(null);
    };

    const show = (def: SkillDef, tier: SkillTier, reason: SkillReason, bb: number) => {
      const mode = useSettingsStore.getState().skillBurst;
      if (mode === 'off') return;
      const character = getCharacterById(def.characterId);
      if (!character) return;
      const reduced = reducedRef.current;
      // lite·모션 감소는 단계와 무관하게 짧은 배너 하나로 줄인다 (기술명은 유지)
      const shownTier: SkillTier = mode === 'full' && !reduced ? tier : 'small';
      keyRef.current += 1;
      if (timerRef.current) clearTimeout(timerRef.current);
      setBurst({
        key: keyRef.current,
        def,
        tier: shownTier,
        name: def.names[reason],
        shout: def.shouts[tier],
        bbLabel: formatBB(bb),
        color: character.color,
        colorSecondary: character.colorSecondary,
        reduced,
      });
      playEffect(SOUND[shownTier]);
      if (shownTier !== 'small') {
        shakeTable(shownTier);
        vibrate(shownTier);
      }
      timerRef.current = setTimeout(() => setBurst(null), DURATION_MS[shownTier]);
    };

    const unsubscribeGame = onGameEvent(event => {
      if (event.type === 'hand-start' || event.type === 'my-turn-start') {
        clear();
        return;
      }
      if (event.type !== 'winners') return;
      const heroId = useGameStore.getState().myPlayerId;
      const def = getSkillDef(useProgressionStore.getState().snapshot?.profile.selectedCharacterId);
      if (!heroId || !def) return;
      const detected = detectSkillTrigger({
        heroId,
        winners: event.winners,
        players: event.players,
        communityCards: event.communityCards,
        bigBlind: event.bigBlind,
      });
      if (!detected) return;
      const trigger = applyBigCooldown(detected, event.handNumber, lastBigHandRef.current);
      if (trigger.tier === 'big') lastBigHandRef.current = event.handNumber;
      show(def, trigger.tier, trigger.reason, trigger.bb);
    });

    const unsubscribePreview = onSkillPreview(tier => {
      const def = getSkillDef(useProgressionStore.getState().snapshot?.profile.selectedCharacterId)
        ?? getSkillDef('sakura');
      if (def) show(def, tier, PREVIEW_REASON[tier], PREVIEW_BB[tier]);
    });

    return () => {
      unsubscribeGame();
      unsubscribePreview();
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  return (
    <>
      <div aria-hidden className="pointer-events-none fixed inset-0 z-[90] overflow-hidden">
        <AnimatePresence>
          {burst && (burst.tier === 'small'
            ? <SmallBurst key={burst.key} burst={burst} />
            : <FullBurst key={burst.key} burst={burst} />)}
        </AnimatePresence>
      </div>
      <span role="status" className="sr-only">
        {burst ? `${getCharacterById(burst.def.characterId)?.name ?? ''} 필살기 ${burst.name}` : ''}
      </span>
    </>
  );
}

function SkillName({ burst, sizeClass }: { burst: Burst; sizeClass: string }) {
  return (
    <span
      className={`block break-keep font-black leading-[0.95] text-white ${sizeClass}`}
      style={{
        fontFamily: 'var(--font-display)',
        WebkitTextStroke: `2px ${burst.colorSecondary}`,
        textShadow: `0 4px 0 ${burst.colorSecondary}, 0 0 28px ${burst.color}`,
        transform: 'skewX(-8deg)',
      }}
    >
      {burst.name}
    </span>
  );
}

function FullBurst({ burst }: { burst: Burst }) {
  const big = burst.tier === 'big';
  const d = DURATION_MS[burst.tier] / 1000;
  const hold = { duration: d, ease: 'easeOut' as const };

  return (
    <motion.div className="absolute inset-0" exit={{ opacity: 0, transition: { duration: 0.12 } }}>
      {/* 비네트 — 시선을 중앙으로 모은다 (테이블은 비쳐 보이게 옅게) */}
      <motion.div
        className="absolute inset-0"
        style={{
          background: `radial-gradient(ellipse at center, transparent 28%, ${burst.colorSecondary}40 68%, var(--color-abyss) 115%)`,
        }}
        initial={{ opacity: 0 }}
        animate={{ opacity: [0, 1, 1, 0] }}
        transition={{ ...hold, times: [0, 0.1, 0.78, 1] }}
      />

      {/* 집중선 */}
      <motion.svg
        viewBox="-100 -100 200 200"
        preserveAspectRatio="xMidYMid slice"
        className="absolute inset-0 h-full w-full"
        initial={{ opacity: 0, scale: 1.5 }}
        animate={{ opacity: [0, 0.95, 0.7, 0], scale: [1.5, 1, 1, 0.94] }}
        transition={{ ...hold, times: [0, 0.12, 0.72, 1] }}
      >
        <path d={SPEED_LINES} fill={burst.color} opacity={0.5} />
        <path d={SPEED_LINES} fill="white" opacity={0.35} transform="rotate(4)" />
      </motion.svg>

      {/* 충격파 링 */}
      <motion.div
        className="absolute left-1/2 top-1/2 -ml-16 -mt-16 h-32 w-32 rounded-full border-4 border-gilded"
        initial={{ scale: 0, opacity: 1 }}
        animate={{ scale: big ? 5 : 3.4, opacity: 0 }}
        transition={{ duration: big ? 0.6 : 0.45, delay: 0.07, ease: 'easeOut' }}
      />

      {/* 대각선 띠 */}
      <motion.div
        className="absolute left-[-15%] right-[-15%] top-1/2 h-[32%] max-h-[280px] overflow-hidden"
        style={{
          y: '-50%',
          rotate: -7,
          background: `linear-gradient(90deg, ${burst.color}f2, ${burst.colorSecondary}f2)`,
          boxShadow: `0 0 48px ${burst.color}aa`,
        }}
        initial={{ scaleY: 0 }}
        animate={{ scaleY: [0, 1.1, 1, 1, 0] }}
        transition={{ ...hold, times: [0, 0.1, 0.18, 0.84, 1] }}
      >
        <motion.div
          className="absolute inset-0 opacity-25"
          style={{ backgroundImage: 'repeating-linear-gradient(115deg, white 0 2px, transparent 2px 22px)' }}
          initial={{ x: 0 }}
          animate={{ x: big ? -160 : -110 }}
          transition={{ duration: d, ease: 'linear' }}
        />
      </motion.div>

      {/* 꽃잎 버스트 */}
      {PETALS.map((p, i) => (
        <motion.svg
          key={i}
          viewBox="0 0 20 20"
          className="absolute left-1/2 top-1/2 -ml-2.5 -mt-2.5 h-5 w-5"
          initial={{ x: 0, y: 0, opacity: 0, scale: 0.3 }}
          animate={{
            x: [0, p.x * 0.75, p.x, p.x * 1.05],
            y: [0, p.y * 0.75, p.y + 20, p.y + 60],
            rotate: [0, p.rotate * 0.5, p.rotate, p.rotate + 120],
            opacity: [0, 1, 1, 0],
            scale: [0.3, p.scale, p.scale, p.scale * 0.8],
          }}
          transition={{ duration: d * 0.95, delay: 0.08 + p.delay, times: [0, 0.18, 0.6, 1], ease: 'easeOut' }}
        >
          <path
            d="M10 1 C15 5 17 11 10 19 C3 11 5 5 10 1 Z M10 1 L10 4"
            fill={i % 3 === 0 ? 'white' : burst.color}
            stroke={burst.colorSecondary}
            strokeWidth={0.6}
          />
        </motion.svg>
      ))}

      {/* 파트너 슬래시 인 */}
      <motion.div
        className="absolute bottom-[20%] left-[-4%] aspect-[3/4] w-[52%] max-w-[380px] sm:left-[6%]"
        // 버스트업 하단이 화면 중간에서 직선으로 잘려 보이지 않게 아래쪽을 띠 안으로 녹인다
        style={{
          maskImage: 'linear-gradient(to bottom, black 62%, transparent 96%)',
          WebkitMaskImage: 'linear-gradient(to bottom, black 62%, transparent 96%)',
        }}
        initial={{ x: '-70%', opacity: 0, scale: 1.15 }}
        animate={{ x: ['-70%', '6%', '0%', '0%', '-25%'], opacity: [0, 1, 1, 1, 0], scale: [1.15, 1, 1, 1, 1] }}
        transition={{ ...hold, times: [0, 0.14, 0.24, 0.86, 1] }}
      >
        <CharacterImage
          characterId={burst.def.characterId}
          expression={burst.def.expressions[burst.tier]}
          round={false}
          frameless
          className="h-full w-full text-7xl"
        />
      </motion.div>

      {/* 기술명 스탬프 */}
      <motion.div
        className="absolute right-[3%] top-1/2 flex w-[64%] flex-col items-end text-right sm:right-[8%] sm:w-[52%]"
        style={{ y: '-50%' }}
        initial={{ opacity: 0, scale: 2.4 }}
        animate={{ opacity: [0, 1, 1, 1, 0], scale: [2.4, 0.94, 1, 1, 1.08] }}
        transition={{ ...hold, times: [0, 0.16, 0.24, 0.86, 1] }}
      >
        <span
          className="mb-1 text-sm font-bold text-white sm:text-base"
          style={{ fontFamily: 'var(--font-display)', textShadow: `0 2px 0 ${burst.colorSecondary}` }}
        >
          {burst.shout}
        </span>
        <SkillName
          burst={burst}
          sizeClass={big ? 'text-[clamp(2.2rem,10vw,5rem)]' : 'text-[clamp(1.9rem,8.5vw,4rem)]'}
        />
        <span
          className="mt-2 text-xl font-black text-gilded tabular sm:text-2xl"
          style={{ textShadow: `0 2px 0 ${burst.colorSecondary}` }}
        >
          {burst.bbLabel}
        </span>
      </motion.div>

      {/* 히트스톱 플래시 — 맨 위에서 70ms 멈췄다가 빠진다 */}
      <motion.div
        className="absolute inset-0 bg-white mix-blend-screen"
        initial={{ opacity: big ? 0.95 : 0.8 }}
        animate={{ opacity: [big ? 0.95 : 0.8, big ? 0.95 : 0.8, 0] }}
        transition={{ duration: 0.26, times: [0, 0.28, 1], ease: 'easeOut' }}
      />
    </motion.div>
  );
}

function SmallBurst({ burst }: { burst: Burst }) {
  const d = DURATION_MS.small / 1000;
  return (
    <motion.div
      className="absolute left-1/2 top-[22%] flex max-w-[92vw] items-center gap-2.5 rounded-full py-1.5 pl-1.5 pr-5"
      style={{
        x: '-50%',
        background: `linear-gradient(90deg, ${burst.color}f0, ${burst.colorSecondary}f0)`,
        boxShadow: `0 0 28px ${burst.color}99`,
      }}
      initial={burst.reduced ? { opacity: 0 } : { opacity: 0, scale: 1.6, rotate: -4 }}
      animate={burst.reduced
        ? { opacity: [0, 1, 1, 0] }
        : { opacity: [0, 1, 1, 0], scale: [1.6, 0.96, 1, 1], rotate: -4 }}
      exit={{ opacity: 0, transition: { duration: 0.12 } }}
      transition={{ duration: d, times: [0, 0.2, 0.8, 1], ease: 'easeOut' }}
    >
      <span className="block h-10 w-10 shrink-0 overflow-hidden rounded-full border-2 border-white/80">
        <CharacterImage
          characterId={burst.def.characterId}
          expression={burst.def.expressions.small}
          className="h-full w-full text-xl"
        />
      </span>
      <SkillName burst={burst} sizeClass="text-2xl" />
      <span className="text-base font-black text-gilded tabular" style={{ textShadow: `0 1px 0 ${burst.colorSecondary}` }}>
        {burst.bbLabel}
      </span>
    </motion.div>
  );
}
