'use client';

import { motion } from 'framer-motion';
import { getCharacterById } from '@/lib/characters';
import { Expression } from '@/lib/assets/character-art';
import CharacterImage from './CharacterImage';

interface CharacterAvatarProps {
  characterId: string;
  size?: 'sm' | 'md' | 'lg' | 'xl';
  expression?: Expression;
  isActive?: boolean;
}

const sizeMap = {
  sm: 'w-10 h-10 text-lg',
  md: 'w-14 h-14 text-2xl',
  lg: 'w-20 h-20 text-3xl',
  xl: 'w-24 h-24 text-4xl',
};

// 표정 전환 시 1회 재생되는 리액션 모션 — 승리(happy)는 바운스, 패배(sad)는 흔들림
const REACTION_MOTION: Partial<Record<string, { animate: Record<string, number[]>; duration: number }>> = {
  happy: { animate: { y: [0, -9, 0, -5, 0], scale: [1, 1.08, 1, 1.04, 1] }, duration: 0.9 },
  confident: { animate: { y: [0, -6, 0], scale: [1, 1.06, 1] }, duration: 0.5 },
  sad: { animate: { x: [0, -3, 3, -3, 3, 0], rotate: [0, -3, 3, -2, 0] }, duration: 0.6 },
};

export default function CharacterAvatar({
  characterId,
  size = 'md',
  expression = 'neutral',
  isActive = false,
}: CharacterAvatarProps) {
  const character = getCharacterById(characterId);
  const color = character?.color || '#6366F1';
  const reaction = REACTION_MOTION[expression];

  return (
    <motion.div
      animate={isActive ? { scale: [1, 1.05, 1] } : {}}
      transition={isActive ? { duration: 1.5, repeat: Infinity } : {}}
      className="relative"
    >
      {/* 리액션 래퍼 — 표정이 바뀔 때 key가 바뀌어 모션이 1회 재생됨 */}
      <motion.div
        key={reaction ? expression : 'idle'}
        animate={reaction?.animate ?? {}}
        transition={reaction ? { duration: reaction.duration, ease: 'easeInOut' } : undefined}
      >
        <div
          className={`${sizeMap[size]} rounded-full relative
            ${isActive ? 'ring-2 ring-gilded ring-offset-2 ring-offset-[#0f0a1e]' : ''}
          `}
          style={{
            boxShadow: isActive ? `0 0 20px ${color}40` : `0 0 10px ${color}20`,
          }}
        >
          <CharacterImage
            characterId={characterId}
            expression={expression}
            round
            className="w-full h-full"
          />
        </div>
      </motion.div>
    </motion.div>
  );
}
