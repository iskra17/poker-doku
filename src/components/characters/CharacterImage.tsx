'use client';

import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { getCharacterArt, Expression } from '@/lib/assets/character-art';
import { getCharacterById } from '@/lib/characters';
import { getCollectionItemDefinition } from '@/lib/collection/catalog';

interface CharacterImageProps {
  characterId: string;
  expression?: Expression;
  /** 원형 크롭 (좌석 아바타). false면 사각 버스트업 (컷인/로비) */
  round?: boolean;
  className?: string;
  skinId?: string | null;
}

/**
 * 캐릭터 일러스트 — 2중 안전망:
 * 매니페스트에 없으면 그라디언트+이모지, 이미지 로드 실패 시에도 이모지로 강등.
 * 표정 전환은 크로스페이드.
 */
export default function CharacterImage({
  characterId, expression = 'neutral', round = true, className = '', skinId = null,
}: CharacterImageProps) {
  const [errored, setErrored] = useState(false);
  const character = getCharacterById(characterId);
  const src = errored ? null : getCharacterArt(characterId, expression);
  const skin = skinId ? getCollectionItemDefinition(skinId) : null;
  const renderer = skin?.kind === 'skin' && skin.characterId === characterId
    ? skin.renderer : undefined;
  const skinGradient = renderer?.gradientToken === 'blossom' ? 'from-blossom/35 via-transparent to-blossom/10'
    : renderer?.gradientToken === 'cyber' ? 'from-cyber/35 via-transparent to-cyber/10'
      : renderer?.gradientToken === 'mystic' ? 'from-mystic/35 via-transparent to-mystic/10'
        : renderer?.gradientToken === 'gilded' ? 'from-gilded/35 via-transparent to-gilded/10' : '';

  const color = character?.color || '#6366F1';
  const colorSecondary = character?.colorSecondary || '#4F46E5';

  if (!src) {
    // 이모지 fallback (기존 그라디언트 원)
    return (
      <div
        className={`relative flex items-center justify-center font-bold text-white overflow-hidden ${round ? 'rounded-full' : 'rounded-xl'} ${className}`}
        style={{ background: `linear-gradient(135deg, ${color}, ${colorSecondary})` }}
      >
        <span>{character?.emoji || '🙂'}</span>
        {renderer && <span aria-hidden className={`pointer-events-none absolute inset-0 bg-gradient-to-br ${skinGradient}`} />}
      </div>
    );
  }

  return (
    <div
      className={`relative overflow-hidden ${round ? 'rounded-full' : 'rounded-xl'} ${className}`}
      style={{ background: `linear-gradient(135deg, ${color}33, ${colorSecondary}55)` }}
    >
      <AnimatePresence mode="popLayout" initial={false}>
        <motion.img
          key={src}
          src={src}
          alt={character?.name ?? characterId}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
          className="absolute inset-0 w-full h-full object-cover"
          // 버스트업 원본에서 얼굴 중심으로 줌 (원형 크롭용)
          style={round ? { transform: 'scale(1.5)', transformOrigin: '50% 24%' } : undefined}
          onError={() => setErrored(true)}
          draggable={false}
        />
      </AnimatePresence>
      {renderer && (
        <span aria-hidden className={`pointer-events-none absolute inset-0 bg-gradient-to-br ${skinGradient}`}>
          <span className="absolute inset-x-0 bottom-0 h-1/2 bg-gradient-to-t from-panel/35 to-transparent" />
          <span className="absolute right-2 top-2 text-gilded">{renderer.overlay === 'cherry-blossom' ? '✿' : '✦'}</span>
        </span>
      )}
    </div>
  );
}
