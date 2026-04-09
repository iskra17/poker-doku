'use client';

import { motion } from 'framer-motion';
import { Player } from '@/lib/poker/types';
import CharacterAvatar from '../characters/CharacterAvatar';
import CardComponent from './Card';
import ChipStack from './ChipStack';

interface PlayerSeatProps {
  player: Player | null;
  isCurrentPlayer: boolean;
  isDealer: boolean;
  isActive: boolean;
  position: { x: string; y: string };
  seatIndex: number;
  compact?: boolean;
  turnDuration?: number;
  onSit?: (seatIndex: number) => void;
}

export default function PlayerSeat({
  player, isCurrentPlayer, isDealer, isActive, position, seatIndex, compact = false, turnDuration = 0, onSit,
}: PlayerSeatProps) {
  if (!player) {
    return (
      <div
        className="absolute -translate-x-1/2 -translate-y-1/2"
        style={{ left: position.x, top: position.y }}
      >
        <button
          onClick={() => onSit?.(seatIndex)}
          className={`rounded-full border-2 border-dashed border-white/20 hover:border-purple-400/50 hover:bg-purple-500/10 transition-all flex items-center justify-center text-white/30 hover:text-purple-300 cursor-pointer
            ${compact ? 'w-12 h-12 text-[10px]' : 'w-20 h-20 text-sm'}
          `}
        >
          Sit
        </button>
      </div>
    );
  }

  const isFolded = player.status === 'folded';
  const isAllIn = player.status === 'all-in';
  const avatarSize = compact ? 'sm' : 'md';

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.8 }}
      animate={{ opacity: isFolded ? 0.5 : 1, scale: 1 }}
      className="absolute -translate-x-1/2 -translate-y-1/2"
      style={{ left: position.x, top: position.y }}
    >
      <div className={`flex flex-col items-center gap-0.5 ${compact ? 'gap-0' : 'gap-1'} ${isFolded ? 'grayscale' : ''}`}>
        {/* Character avatar */}
        <CharacterAvatar
          characterId={player.type === 'bot' ? (player.personalityId || player.avatar) : 'player'}
          size={avatarSize}
          isActive={isActive}
          isDealer={isDealer}
          expression={isAllIn ? 'confident' : isActive ? 'thinking' : 'neutral'}
        />

        {/* Name & chips */}
        <div className={`bg-black/60 backdrop-blur-sm rounded-lg text-center border border-white/10
          ${compact ? 'px-2 py-0.5 min-w-[60px]' : 'px-3 py-1 min-w-[90px]'}
        `}>
          <div className={`text-white font-bold truncate ${compact ? 'text-[10px] max-w-[55px]' : 'text-xs max-w-[80px]'}`}>
            {player.name}
            {isCurrentPlayer && <span className="text-purple-400 ml-0.5">(You)</span>}
          </div>
          <div className={`text-yellow-300 font-semibold ${compact ? 'text-[9px]' : 'text-[11px]'}`}>
            {player.chips.toLocaleString()}
          </div>
        </div>

        {/* Status badges */}
        {isAllIn && (
          <motion.div
            animate={{ scale: [1, 1.1, 1] }}
            transition={{ duration: 0.8, repeat: Infinity }}
            className={`bg-red-500 text-white font-bold rounded-full ${compact ? 'text-[8px] px-1.5 py-0' : 'text-[10px] px-2 py-0.5'}`}
          >
            ALL IN
          </motion.div>
        )}
        {isFolded && (
          <div className={`text-gray-400 font-bold ${compact ? 'text-[8px]' : 'text-[10px]'}`}>FOLDED</div>
        )}

        {/* Hole cards */}
        {player.holeCards.length > 0 && !isFolded && (
          <div className={`flex mt-0.5 ${compact ? 'gap-0' : 'gap-0.5'}`}>
            {player.holeCards.map((card, i) => (
              <CardComponent
                key={i}
                card={card}
                hidden={!isCurrentPlayer && player.status !== 'all-in'}
                size={compact ? 'xs' : 'sm'}
                delay={i * 0.1}
              />
            ))}
          </div>
        )}

        {/* Current bet */}
        {player.currentBet > 0 && (
          <div className="mt-0.5">
            <ChipStack amount={player.currentBet} size={compact ? 'xs' : 'sm'} />
          </div>
        )}

        {/* Turn timer - 서버 기반 */}
        {isActive && turnDuration > 0 && (
          <motion.div
            className={`bg-gray-700 rounded-full mt-0.5 overflow-hidden ${compact ? 'w-12 h-0.5' : 'w-full h-1'}`}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
          >
            <motion.div
              className="h-full bg-gradient-to-r from-green-400 to-yellow-400 rounded-full"
              initial={{ width: '100%' }}
              animate={{ width: '0%' }}
              transition={{ duration: turnDuration / 1000, ease: 'linear' }}
            />
          </motion.div>
        )}
      </div>
    </motion.div>
  );
}
