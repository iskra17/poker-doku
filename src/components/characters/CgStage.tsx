'use client';

import { useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import {
  AnimatePresence,
  motion,
  useMotionValue,
  useSpring,
  useTransform,
} from 'framer-motion';
import { useTypewriter } from '@/lib/hooks/use-typewriter';
import { usePrefersReducedMotion } from '@/lib/hooks/use-reduced-motion';

export interface CgStageScene {
  /** AnimatePresence 키 */
  id: string;
  art: string;
  alt: string;
  /** 캡션 화자 이름·색 */
  name: string;
  color: string;
  /** 'BOND MEMORY · Lv.5' 같은 작은 머리글 */
  kicker: string;
  title: string;
  caption: string;
  /** 상단 배너(방금 해금 등) — null이면 없음 */
  badge?: string | null;
  /** 캡션 아래 보조 문구 (기본 '화면을 탭하면 닫혀요') */
  hint?: string;
}

interface CgStageProps {
  /** null이면 닫힘 */
  scene: CgStageScene | null;
  onClose: () => void;
}

const noopSubscribe = () => () => {};

/**
 * 풀스크린 CG 무대 — 이벤트 CG를 "라이브2D풍"으로 재생하는 공용 뷰어(인연 씬·스토리 보상 컷신이 함께 쓴다).
 * ①포인터 패럴랙스(씬 전체 3D 틸트) ②숨쉬는 슬로우 줌 ③비네트 ④캡션 타자기.
 * 배경이 구워진 풀 씬이라 이미지 전체가 무대다. 탭 한 번으로 닫힘 — '스킵 불가 연출 금지' 원칙.
 * reduced-motion이면 틸트·줌 없이 정지 CG. z-[96] — StoryStage(95) 위, 로비 보상 필(97) 아래.
 * 영상 슬롯(P2 VideoCutscene)은 `art` 자리에 <video>를 끼우는 형태로 확장한다.
 */
export default function CgStage({ scene, onClose }: CgStageProps) {
  const mounted = useSyncExternalStore(noopSubscribe, () => true, () => false);
  const reduced = usePrefersReducedMotion();

  const pointerX = useMotionValue(0);
  const pointerY = useMotionValue(0);
  const springX = useSpring(pointerX, { stiffness: 50, damping: 16 });
  const springY = useSpring(pointerY, { stiffness: 50, damping: 16 });
  const rotateY = useTransform(springX, [-1, 1], [-4, 4]);
  const rotateX = useTransform(springY, [-1, 1], [3, -3]);
  const shiftX = useTransform(springX, [-1, 1], [-8, 8]);
  const shiftY = useTransform(springY, [-1, 1], [-5, 5]);

  if (!mounted || typeof document === 'undefined') return null;

  return createPortal(
    <AnimatePresence>
      {scene && (
        <motion.div
          key={scene.id}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[96] flex items-center justify-center bg-abyss/90 backdrop-blur-sm"
          onClick={onClose}
          onPointerMove={event => {
            if (reduced) return;
            pointerX.set(Math.max(-1, Math.min(1, (event.clientX / window.innerWidth) * 2 - 1)));
            pointerY.set(Math.max(-1, Math.min(1, (event.clientY / window.innerHeight) * 2 - 1)));
          }}
          role="dialog"
          aria-modal="true"
          aria-label={scene.title}
        >
          <motion.div
            className="relative flex max-h-full flex-col items-center px-4 py-6"
            style={{ perspective: 1000 }}
            initial={reduced ? false : { y: 40, opacity: 0, scale: 0.96 }}
            animate={{ y: 0, opacity: 1, scale: 1 }}
            exit={{ y: 24, opacity: 0, scale: 0.97 }}
            transition={{ type: 'spring', stiffness: 190, damping: 24 }}
          >
            {scene.badge && (
              <motion.p
                initial={reduced ? false : { opacity: 0, y: -10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.25 }}
                className="mb-2 rounded-full border border-gilded/50 bg-gilded/15 px-3 py-1 text-xs font-bold text-gilded"
              >
                {scene.badge}
              </motion.p>
            )}

            {/* CG — 틸트 + 숨쉬는 줌 */}
            <motion.div
              className="relative overflow-hidden rounded-2xl border shadow-2xl"
              style={{
                rotateX: reduced ? 0 : rotateX,
                rotateY: reduced ? 0 : rotateY,
                x: reduced ? 0 : shiftX,
                y: reduced ? 0 : shiftY,
                borderColor: `${scene.color}66`,
                boxShadow: `0 24px 60px rgba(0,0,0,0.6), 0 0 40px ${scene.color}30`,
              }}
            >
              <motion.img
                src={scene.art}
                alt={scene.alt}
                draggable={false}
                className="pointer-events-none block select-none object-cover"
                style={{ maxHeight: 'min(66dvh, 620px)', maxWidth: 'min(88vw, 420px)' }}
                animate={reduced ? undefined : { scale: [1.02, 1.055, 1.02] }}
                transition={{ duration: 9, repeat: Infinity, ease: 'easeInOut' }}
              />
              {/* 비네트 — CG 톤을 다크 UI에 안착 */}
              <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-abyss/45 via-transparent to-abyss/15" />
              <div className="pointer-events-none absolute inset-x-0 bottom-0 p-3 text-left">
                <p className="text-[10px] font-bold tracking-widest" style={{ color: scene.color }}>
                  {scene.kicker}
                </p>
                <p className="text-base font-bold text-white drop-shadow" style={{ fontFamily: 'var(--font-display)' }}>
                  {scene.title}
                </p>
              </div>
            </motion.div>

            <SceneCaption key={scene.id} name={scene.name} color={scene.color} caption={scene.caption} typewriter={!reduced} />
            <p className="mt-2 text-[10px] text-ink-dim/80">{scene.hint ?? '화면을 탭하면 닫혀요'}</p>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );
}

function SceneCaption({ name, color, caption, typewriter }: { name: string; color: string; caption: string; typewriter: boolean }) {
  const { display } = useTypewriter(typewriter ? caption : '', 30);
  const shown = typewriter ? display : caption;
  return (
    <div
      className="mt-3 w-[min(88vw,420px)] rounded-xl border bg-panel/90 px-3.5 py-2.5 backdrop-blur-sm"
      style={{ borderColor: `${color}55` }}
    >
      <p className="text-[10px] font-bold" style={{ color }}>{name}</p>
      <p className="mt-0.5 min-h-[2.2em] text-sm leading-relaxed text-ink">
        “{shown}”
      </p>
    </div>
  );
}
