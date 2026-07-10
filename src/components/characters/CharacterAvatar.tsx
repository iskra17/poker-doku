'use client';

import { motion } from 'framer-motion';
import { getCharacterById } from '@/lib/characters';
import { Expression } from '@/lib/assets/character-art';
import CharacterImage from './CharacterImage';

interface CharacterAvatarProps {
  characterId: string;
  size?: 'sm' | 'md' | 'lg';
  expression?: Expression;
  isActive?: boolean;
  isDealer?: boolean;
}

const sizeMap = {
  sm: 'w-10 h-10 text-lg',
  md: 'w-14 h-14 text-2xl',
  lg: 'w-20 h-20 text-3xl',
};

export default function CharacterAvatar({
  characterId,
  size = 'md',
  expression = 'neutral',
  isActive = false,
  isDealer = false,
}: CharacterAvatarProps) {
  const character = getCharacterById(characterId);
  const color = character?.color || '#6366F1';

  return (
    <motion.div
      animate={isActive ? { scale: [1, 1.05, 1] } : {}}
      transition={isActive ? { duration: 1.5, repeat: Infinity } : {}}
      className="relative"
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
      {isDealer && (
        <div className="absolute -bottom-1 -right-1 w-5 h-5 rounded-full bg-gilded text-black text-[10px] font-bold flex items-center justify-center border border-yellow-200 shadow-md z-30">
          D
        </div>
      )}
    </motion.div>
  );
}
