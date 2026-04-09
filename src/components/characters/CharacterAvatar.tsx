'use client';

import { motion } from 'framer-motion';
import { getCharacterById } from '@/lib/characters';

interface CharacterAvatarProps {
  characterId: string;
  size?: 'sm' | 'md' | 'lg';
  expression?: 'neutral' | 'happy' | 'surprised' | 'thinking' | 'sad' | 'confident';
  isActive?: boolean;
  isDealer?: boolean;
}

const sizeMap = {
  sm: 'w-10 h-10 text-lg',
  md: 'w-14 h-14 text-2xl',
  lg: 'w-20 h-20 text-3xl',
};

const expressionEmojis: Record<string, string> = {
  neutral: '',
  happy: '😊',
  surprised: '😲',
  thinking: '🤔',
  sad: '😢',
  confident: '😏',
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
  const colorSecondary = character?.colorSecondary || '#4F46E5';
  const initial = character?.name?.[0] || '?';

  return (
    <motion.div
      animate={isActive ? { scale: [1, 1.05, 1] } : {}}
      transition={isActive ? { duration: 1.5, repeat: Infinity } : {}}
      className="relative"
    >
      <div
        className={`${sizeMap[size]} rounded-full flex items-center justify-center font-bold text-white relative overflow-hidden
          ${isActive ? 'ring-2 ring-yellow-400 ring-offset-2 ring-offset-[#0f0a1e]' : ''}
        `}
        style={{
          background: `linear-gradient(135deg, ${color}, ${colorSecondary})`,
          boxShadow: isActive ? `0 0 20px ${color}40` : `0 0 10px ${color}20`,
        }}
      >
        <span className="relative z-10">{character?.emoji || initial}</span>
        {expression !== 'neutral' && (
          <span className="absolute -bottom-1 -right-1 text-sm z-20">
            {expressionEmojis[expression]}
          </span>
        )}
      </div>
      {isDealer && (
        <div className="absolute -bottom-1 -right-1 w-5 h-5 rounded-full bg-yellow-400 text-black text-[10px] font-bold flex items-center justify-center border border-yellow-300 shadow-md z-30">
          D
        </div>
      )}
    </motion.div>
  );
}
