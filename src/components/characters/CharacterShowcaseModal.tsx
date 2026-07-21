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
import { getCharacterArt, getCharacterShowcaseArt } from '@/lib/assets/character-art';
import CharacterImage from './CharacterImage';

interface CharacterShowcaseModalProps {
  /** null이면 닫힘 */
  characterId: string | null;
  onClose: () => void;
}

/**
 * 캐릭터 쇼케이스 — 프로필/좌석 아바타 클릭 시 상반신 일러스트를 라이브2D풍으로 연출.
 * 실제 리깅 없이 CSS/framer 모션 3종으로 "살아있는" 느낌을 낸다:
 * ①숨쉬기(느린 스케일), ②둥실 부유(수직 왕복), ③포인터 패럴랙스(3D 틸트).
 * 쇼케이스 일러스트가 없는 캐릭터는 버스트업(neutral)으로 폴백.
 */
const noopSubscribe = () => () => {};

export default function CharacterShowcaseModal({ characterId, onClose }: CharacterShowcaseModalProps) {
  // SSR 가드 — 서버 스냅샷 false, 클라이언트 true (effect 없이 하이드레이션 안전)
  const mounted = useSyncExternalStore(noopSubscribe, () => true, () => false);

  // 포인터 패럴랙스 — -1..1 정규화 좌표를 스프링으로 부드럽게 추종
  const pointerX = useMotionValue(0);
  const pointerY = useMotionValue(0);
  const springX = useSpring(pointerX, { stiffness: 60, damping: 14 });
  const springY = useSpring(pointerY, { stiffness: 60, damping: 14 });
  const rotateY = useTransform(springX, [-1, 1], [-7, 7]);
  const rotateX = useTransform(springY, [-1, 1], [5, -5]);
  const shiftX = useTransform(springX, [-1, 1], [-12, 12]);

  if (!mounted || typeof document === 'undefined') return null;

  const character = characterId ? getCharacterById(characterId) : null;
  const showcaseSrc = characterId ? getCharacterShowcaseArt(characterId) : null;
  const bustSrc = characterId ? getCharacterArt(characterId, 'neutral') : null;
  const src = showcaseSrc ?? bustSrc;

  return createPortal(
    <AnimatePresence>
      {characterId && character && (
        <motion.div
          key={characterId}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[90] flex items-center justify-center overflow-hidden"
          onClick={onClose}
          onPointerMove={event => {
            const nx = (event.clientX / window.innerWidth) * 2 - 1;
            const ny = (event.clientY / window.innerHeight) * 2 - 1;
            pointerX.set(Math.max(-1, Math.min(1, nx)));
            pointerY.set(Math.max(-1, Math.min(1, ny)));
          }}
        >
          {/* 배경 — 캐릭터 컬러 글로우 + 딤 */}
          <div className="absolute inset-0 bg-abyss/85 backdrop-blur-sm" />
          <div
            className="absolute inset-0"
            style={{
              background: `radial-gradient(ellipse 60% 50% at 50% 42%, ${character.color}2e 0%, transparent 70%)`,
            }}
          />
          {/* 스포트라이트 링 */}
          <motion.div
            aria-hidden
            className="absolute rounded-full border"
            style={{
              width: 'min(78vw, 420px)', height: 'min(78vw, 420px)',
              borderColor: `${character.color}40`,
              boxShadow: `0 0 80px ${character.color}30, inset 0 0 60px ${character.color}1a`,
            }}
            animate={{ scale: [1, 1.04, 1], opacity: [0.7, 1, 0.7] }}
            transition={{ duration: 4, repeat: Infinity, ease: 'easeInOut' }}
          />
          {/* 떠다니는 파티클 */}
          {[...Array(8)].map((_, i) => (
            <motion.span
              key={i}
              aria-hidden
              className="absolute select-none text-lg"
              style={{
                left: `${12 + (i * 10.5) % 76}%`,
                top: `${18 + (i * 23) % 60}%`,
                color: i % 2 ? character.color : character.colorSecondary,
              }}
              animate={{ y: [0, -26, 0], opacity: [0.15, 0.75, 0.15], rotate: [0, i % 2 ? 24 : -24, 0] }}
              transition={{ duration: 3.4 + (i % 4) * 0.9, repeat: Infinity, ease: 'easeInOut', delay: i * 0.45 }}
            >
              {i % 3 === 0 ? '✦' : i % 3 === 1 ? '✿' : '♠'}
            </motion.span>
          ))}

          {/* 캐릭터 — 3D 틸트 컨테이너 */}
          <motion.div
            className="relative z-10 flex flex-col items-center px-4"
            style={{ perspective: 900 }}
            initial={{ y: 60, opacity: 0, scale: 0.92 }}
            animate={{ y: 0, opacity: 1, scale: 1 }}
            exit={{ y: 40, opacity: 0, scale: 0.95 }}
            transition={{ type: 'spring', stiffness: 210, damping: 22 }}
          >
            <motion.div style={{ rotateX, rotateY, x: shiftX, transformStyle: 'preserve-3d' }}>
              {/* 둥실 부유 + 숨쉬기 (주기를 다르게 겹쳐 기계적 반복감 제거) */}
              <motion.div
                animate={{ y: [0, -10, 0] }}
                transition={{ duration: 4.6, repeat: Infinity, ease: 'easeInOut' }}
              >
                <motion.div
                  animate={{ scaleY: [1, 1.015, 1], scaleX: [1, 1.006, 1] }}
                  transition={{ duration: 3.1, repeat: Infinity, ease: 'easeInOut' }}
                  style={{ transformOrigin: '50% 100%' }}
                >
                  {src ? (
                    /* eslint-disable-next-line @next/next/no-img-element */
                    <img
                      src={src}
                      alt={character.name}
                      draggable={false}
                      className="pointer-events-none select-none drop-shadow-[0_18px_40px_rgba(0,0,0,0.55)]"
                      style={{
                        maxHeight: 'min(62dvh, 560px)',
                        maxWidth: 'min(84vw, 400px)',
                        filter: `drop-shadow(0 0 26px ${character.color}38)`,
                      }}
                    />
                  ) : (
                    <CharacterImage characterId={character.id} round={false} className="h-64 w-64 text-7xl" />
                  )}
                </motion.div>
              </motion.div>
            </motion.div>

            {/* 이름표 + 소개 */}
            <motion.div
              className="pointer-events-none -mt-4 w-[min(88vw,380px)] rounded-2xl border bg-panel/85 px-4 py-3 text-center backdrop-blur-sm"
              style={{ borderColor: `${character.color}55` }}
              initial={{ y: 24, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              transition={{ delay: 0.16, type: 'spring', stiffness: 200, damping: 24 }}
            >
              <p className="text-lg font-bold text-ink" style={{ fontFamily: 'var(--font-display)' }}>
                {character.name}
                <span className="ml-1.5 text-xs font-normal text-ink-dim">{character.nameNative}</span>
              </p>
              <p className="mt-0.5 text-[11px] text-ink-dim">{character.nationality} · {character.age}세</p>
              <p className="mt-1.5 text-xs leading-relaxed" style={{ color: character.color }}>
                {character.styleSummary}
              </p>
              <p className="mt-1.5 text-[11px] italic leading-relaxed text-ink-dim">“{character.greeting}”</p>
            </motion.div>
            <p className="mt-2 text-[10px] text-ink-dim/70">화면을 탭하면 닫혀요</p>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );
}
