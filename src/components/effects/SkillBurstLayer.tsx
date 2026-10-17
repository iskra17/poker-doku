'use client';

import { useEffect, useRef, useState } from 'react';
import { AnimatePresence } from 'framer-motion';
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
import { FullBurst, LiteBanner, MiniBurst, type BurstView } from './SkillBurstScenes';

/**
 * 파트너 필살기 연출 — 내 핸드 승리 순간에 인연 파트너가 기술을 쓴다.
 *
 * **내 화면 전용**: game-events(스냅샷 diff)만 구독하고 서버로 아무것도 보내지 않는다. 다른 플레이어
 * 화면에는 존재하지 않으며, 테이블 진행(다음 핸드 6.5초 예약)도 기다리게 하지 않는다.
 * 입력을 막지 않도록 pointer-events-none이고, 새 핸드·내 턴이 시작되면 즉시 끊는다.
 *
 * 장면 선택: 라이트 설정·모션 감소 → LiteBanner, 풀 설정의 소 단계 → MiniBurst, 중·대 → FullBurst.
 * 기술마다 모티프(SkillBurstScenes)가 달라 같은 단계라도 모양이 다르다.
 */

type BurstKind = 'lite' | 'mini' | 'full';

interface Burst extends BurstView {
  key: number;
  kind: BurstKind;
}

const DURATION_MS: Record<SkillTier, number> = { small: 850, medium: 1100, big: 1400 };
const LITE_MS = 700;
const SHAKE_PX: Record<Exclude<SkillTier, 'small'>, number> = { medium: 5, big: 11 };
/** 착지형(dive)은 충격이 늦게 오므로 흔들림·진동도 착지 시점에 맞춘다 */
const DIVE_IMPACT_RATIO = 0.24;

const PREVIEW_REASON: Record<SkillTier, SkillReason> = {
  small: 'steal',
  medium: 'big-pot',
  big: 'river-comeback',
};
const PREVIEW_BB: Record<SkillTier, number> = { small: 8, medium: 42, big: 120 };

function formatBB(bb: number): string {
  return `+${bb >= 10 ? Math.round(bb) : Number(bb.toFixed(1))}BB`;
}

function shakeTable(tier: Exclude<SkillTier, 'small'>, delayMs: number): void {
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
    // 플래시가 멈춰 있는 히트스톱 구간 다음에 흔들린다
    { duration: tier === 'big' ? 360 : 260, delay: delayMs, easing: 'ease-out' },
  );
}

function vibrate(tier: SkillTier, delayMs: number): void {
  try {
    const pulse = tier === 'big' ? [18, 40, 70] : [30];
    navigator.vibrate?.(delayMs > 0 ? [0, delayMs, ...pulse] : pulse);
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
      const move = def.moves[reason];
      const kind: BurstKind = mode === 'lite' || reduced ? 'lite' : tier === 'small' ? 'mini' : 'full';
      const durationMs = kind === 'lite' ? LITE_MS : DURATION_MS[tier];
      keyRef.current += 1;
      if (timerRef.current) clearTimeout(timerRef.current);
      setBurst({
        key: keyRef.current,
        kind,
        characterId: def.characterId,
        tier,
        move,
        shout: def.shouts[tier],
        bbLabel: formatBB(bb),
        color: character.color,
        colorSecondary: character.colorSecondary,
        durationMs,
        reduced,
      });
      playEffect(kind === 'full' ? (tier === 'big' ? 'skill-big' : 'skill-burst') : 'skill-small');
      if (kind === 'full' && tier !== 'small') {
        const impactMs = move.motif === 'dive' ? Math.round(durationMs * DIVE_IMPACT_RATIO) : 70;
        shakeTable(tier, impactMs);
        vibrate(tier, move.motif === 'dive' ? impactMs : 0);
      }
      timerRef.current = setTimeout(() => setBurst(null), durationMs);
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

    const unsubscribePreview = onSkillPreview(({ tier, reason, bb }) => {
      const def = getSkillDef(useProgressionStore.getState().snapshot?.profile.selectedCharacterId)
        ?? getSkillDef('sakura');
      if (def) show(def, tier, reason ?? PREVIEW_REASON[tier], bb ?? PREVIEW_BB[tier]);
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
          {burst?.kind === 'lite' && <LiteBanner key={burst.key} view={burst} />}
          {burst?.kind === 'mini' && <MiniBurst key={burst.key} view={burst} />}
          {burst?.kind === 'full' && <FullBurst key={burst.key} view={burst} />}
        </AnimatePresence>
      </div>
      <span role="status" className="sr-only">
        {burst ? `${getCharacterById(burst.characterId)?.name ?? ''} 필살기 ${burst.move.name}` : ''}
      </span>
    </>
  );
}
