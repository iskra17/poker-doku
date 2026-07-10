'use client';

import { motion, AnimatePresence } from 'framer-motion';
import { Player, PlayerAction } from '@/lib/poker/types';
import { useSeatExpression } from '@/lib/hooks/use-seat-expression';
import CharacterAvatar from '../characters/CharacterAvatar';
import CardComponent from './Card';
import TurnTimer from './TurnTimer';

interface PlayerSeatProps {
  player: Player | null;
  isCurrentPlayer: boolean;
  isDealer: boolean;
  isActive: boolean;
  position: { x: string; y: string };
  seatIndex: number;
  compact?: boolean;
  turnDuration?: number;
  turnTotalSeconds?: number;
  lastAction?: PlayerAction | null;
  onSit?: (seatIndex: number) => void;
}

const actionLabels: Record<string, { text: string; color: string }> = {
  fold: { text: 'FOLD', color: 'bg-gray-600' },
  check: { text: 'CHECK', color: 'bg-blue-600' },
  call: { text: 'CALL', color: 'bg-green-600' },
  raise: { text: 'RAISE', color: 'bg-yellow-600' },
  'all-in': { text: 'ALL IN', color: 'bg-red-600' },
};

export default function PlayerSeat({
  player, isCurrentPlayer, isDealer, isActive, position, seatIndex, compact = false,
  turnDuration = 0, turnTotalSeconds = 30, lastAction, onSit,
}: PlayerSeatProps) {
  // 훅은 early return 이전에 호출 (React 규칙)
  const expression = useSeatExpression(player?.id, isActive);

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
  const isSittingOut = player.status === 'sitting-out';
  const isBusted = player.chips <= 0 && !isAllIn;
  const isDimmed = isFolded || isSittingOut || isBusted;
  const avatarSize = compact ? 'sm' : 'md';

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.8 }}
      animate={{ opacity: isDimmed ? 0.4 : 1, scale: 1 }}
      className="absolute"
      // Tailwind -translate 클래스는 framer transform에 덮여 사라지므로 x/y로 센터링
      style={{ left: position.x, top: position.y, x: '-50%', y: '-50%' }}
    >
      <div className={`flex flex-col items-center gap-0.5 ${compact ? 'gap-0' : 'gap-1'} ${isDimmed ? 'grayscale' : ''}`}>
        {/* Character avatar + 턴 타이머 링 */}
        <div className="relative">
          <CharacterAvatar
            characterId={player.type === 'bot' ? (player.personalityId || player.avatar) : 'player'}
            size={avatarSize}
            isActive={isActive}
            isDealer={isDealer}
            expression={isBusted ? 'sad' : isAllIn ? 'confident' : expression}
          />
          {isActive && turnDuration > 0 && (
            <TurnTimer
              remainingMs={turnDuration}
              totalSeconds={turnTotalSeconds}
              sizePx={compact ? 40 : 56}
            />
          )}
        </div>

        {/* Name & chips */}
        <div className={`bg-black/60 backdrop-blur-sm rounded-lg text-center border
          ${isBusted ? 'border-red-500/30' : 'border-white/10'}
          ${compact ? 'px-2 py-0.5 min-w-[60px]' : 'px-3 py-1 min-w-[90px]'}
        `}>
          <div className={`text-white font-bold truncate ${compact ? 'text-[10px] max-w-[55px]' : 'text-xs max-w-[80px]'}`}>
            {player.name}
            {isCurrentPlayer && <span className="text-purple-400 ml-0.5">(You)</span>}
          </div>
          <div className={`font-semibold ${isBusted ? 'text-red-400' : 'text-yellow-300'} ${compact ? 'text-[9px]' : 'text-[11px]'}`}>
            {isBusted ? 'BUSTED' : player.chips.toLocaleString()}
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
        {isSittingOut && !isBusted && (
          <div className={`text-gray-500 font-bold ${compact ? 'text-[8px]' : 'text-[10px]'}`}>SITTING OUT</div>
        )}
        {player.isDisconnected && (
          <div className={`text-orange-400 font-bold ${compact ? 'text-[8px]' : 'text-[10px]'}`}>OFFLINE</div>
        )}

        {/* Hole cards - 히어로는 크게, 상대방은 작게 */}
        {player.holeCards.length > 0 && !isFolded && (
          <div className={`flex mt-0.5 ${isCurrentPlayer ? 'gap-1' : compact ? 'gap-0' : 'gap-0.5'}`}>
            {player.holeCards.map((card, i) => (
              <CardComponent
                key={i}
                card={card}
                hidden={!isCurrentPlayer && !player.revealed}
                size={isCurrentPlayer ? (compact ? 'lg' : 'lg') : (compact ? 'xs' : 'sm')}
                delay={i * 0.1}
              />
            ))}
          </div>
        )}

        {/* Action label */}
        <AnimatePresence>
          {lastAction && lastAction.playerId === player.id && (
            <motion.div
              initial={{ opacity: 0, scale: 0.5, y: -5 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.8 }}
              className={`${actionLabels[lastAction.type]?.color || 'bg-gray-600'} text-white font-bold rounded-full shadow-lg
                ${compact ? 'text-[9px] px-2 py-0.5' : 'text-[11px] px-3 py-0.5'}
              `}
            >
              {actionLabels[lastAction.type]?.text}
              {lastAction.amount > 0 && ` ${lastAction.amount.toLocaleString()}`}
            </motion.div>
          )}
        </AnimatePresence>

      </div>
    </motion.div>
  );
}
