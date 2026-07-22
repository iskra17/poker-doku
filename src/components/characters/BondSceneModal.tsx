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
import { getCharacterById } from '@/lib/characters';
import { getBondSceneArt, type BondScene } from '@/lib/characters/bond-scenes';
import { useTypewriter } from '@/lib/hooks/use-typewriter';

interface BondSceneModalProps {
  /** null이면 닫힘 */
  scene: BondScene | null;
  /** 방금 해금된 순간의 연출(헤더 배너)인지, 갤러리 다시보기인지 */
  justUnlocked?: boolean;
  onClose: () => void;
}

const noopSubscribe = () => () => {};

/**
 * 인연 씬 뷰어 — 이벤트 CG를 라이브2D풍 모션으로 재생.
 * ①포인터 패럴랙스(씬 전체 3D 틸트) ②숨쉬는 슬로우 줌 ③캡션 타자기 연출.
 * 배경이 구워진 풀 씬이라 쇼케이스(투명 캐릭터)와 달리 이미지 전체가 무대다.
 * 탭 한 번으로 닫힘 — '스킵 불가 연출 금지' 원칙.
 */
export default function BondSceneModal({ scene, justUnlocked = false, onClose }: BondSceneModalProps) {
  const mounted = useSyncExternalStore(noopSubscribe, () => true, () => false);

  const pointerX = useMotionValue(0);
  const pointerY = useMotionValue(0);
  const springX = useSpring(pointerX, { stiffness: 50, damping: 16 });
  const springY = useSpring(pointerY, { stiffness: 50, damping: 16 });
  const rotateY = useTransform(springX, [-1, 1], [-4, 4]);
  const rotateX = useTransform(springY, [-1, 1], [3, -3]);
  const shiftX = useTransform(springX, [-1, 1], [-8, 8]);
  const shiftY = useTransform(springY, [-1, 1], [-5, 5]);

  if (!mounted || typeof document === 'undefined') return null;
  const character = scene ? getCharacterById(scene.characterId) : null;

  return createPortal(
    <AnimatePresence>
      {scene && character && (
        <motion.div
          key={scene.id}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[95] flex items-center justify-center bg-abyss/90 backdrop-blur-sm"
          onClick={onClose}
          onPointerMove={event => {
            pointerX.set(Math.max(-1, Math.min(1, (event.clientX / window.innerWidth) * 2 - 1)));
            pointerY.set(Math.max(-1, Math.min(1, (event.clientY / window.innerHeight) * 2 - 1)));
          }}
        >
          <motion.div
            className="relative flex max-h-full flex-col items-center px-4 py-6"
            style={{ perspective: 1000 }}
            initial={{ y: 40, opacity: 0, scale: 0.96 }}
            animate={{ y: 0, opacity: 1, scale: 1 }}
            exit={{ y: 24, opacity: 0, scale: 0.97 }}
            transition={{ type: 'spring', stiffness: 190, damping: 24 }}
          >
            {justUnlocked && (
              <motion.p
                initial={{ opacity: 0, y: -10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.25 }}
                className="mb-2 rounded-full border border-gilded/50 bg-gilded/15 px-3 py-1 text-xs font-bold text-gilded"
              >
                ✦ 새로운 인연 씬 해금 — 인연 Lv.{scene.level}
              </motion.p>
            )}

            {/* 씬 CG — 틸트 + 숨쉬는 줌 */}
            <motion.div
              className="relative overflow-hidden rounded-2xl border shadow-2xl"
              style={{
                rotateX, rotateY, x: shiftX, y: shiftY,
                borderColor: `${character.color}66`,
                boxShadow: `0 24px 60px rgba(0,0,0,0.6), 0 0 40px ${character.color}30`,
              }}
            >
              <motion.img
                src={getBondSceneArt(scene)}
                alt={`${character.name} — ${scene.title}`}
                draggable={false}
                className="pointer-events-none block select-none object-cover"
                style={{ maxHeight: 'min(66dvh, 620px)', maxWidth: 'min(88vw, 420px)' }}
                animate={{ scale: [1.02, 1.055, 1.02] }}
                transition={{ duration: 9, repeat: Infinity, ease: 'easeInOut' }}
              />
              {/* 비네트 — CG 톤을 다크 UI에 안착 */}
              <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-abyss/45 via-transparent to-abyss/15" />
              <div className="pointer-events-none absolute inset-x-0 bottom-0 p-3 text-left">
                <p className="text-[10px] font-bold tracking-widest" style={{ color: character.color }}>
                  BOND MEMORY · Lv.{scene.level}
                </p>
                <p className="text-base font-bold text-white drop-shadow" style={{ fontFamily: 'var(--font-display)' }}>
                  {scene.title}
                </p>
              </div>
            </motion.div>

            {/* 캡션 — 타자기 대사 */}
            <SceneCaption key={scene.id} name={character.name} color={character.color} caption={scene.caption} />
            <p className="mt-2 text-[10px] text-ink-dim/80">화면을 탭하면 닫혀요</p>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );
}

function SceneCaption({ name, color, caption }: { name: string; color: string; caption: string }) {
  const { display } = useTypewriter(caption, 30);
  return (
    <div
      className="mt-3 w-[min(88vw,420px)] rounded-xl border bg-panel/90 px-3.5 py-2.5 backdrop-blur-sm"
      style={{ borderColor: `${color}55` }}
    >
      <p className="text-[10px] font-bold" style={{ color }}>{name}</p>
      <p className="mt-0.5 min-h-[2.2em] text-sm leading-relaxed text-ink">
        “{display}”
      </p>
    </div>
  );
}
