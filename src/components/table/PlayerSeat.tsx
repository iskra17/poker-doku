'use client';

import { motion, AnimatePresence } from 'framer-motion';
import { Player } from '@/lib/poker/types';
import { SeatAction } from '@/lib/hooks/use-seat-actions';
import { useSeatExpression } from '@/lib/hooks/use-seat-expression';
import CharacterAvatar from '../characters/CharacterAvatar';
import CardComponent from './Card';
import TurnTimer from './TurnTimer';
import SeatEmote from './SeatEmote';

interface PlayerSeatProps {
  player: Player | null;
  isCurrentPlayer: boolean;
  isActive: boolean;
  position: { x: string; y: string };
  seatIndex: number;
  compact?: boolean;
  turnDuration?: number;
  turnTotalSeconds?: number;
  seatAction?: SeatAction | null;
  onSit?: (seatIndex: number) => void;
}

const actionLabels: Record<string, { text: string; color: string }> = {
  fold: { text: '폴드', color: 'bg-gray-600' },
  check: { text: '체크', color: 'bg-blue-600' },
  call: { text: '콜', color: 'bg-green-600' },
  raise: { text: '레이즈', color: 'bg-yellow-600' },
  'all-in': { text: '올인', color: 'bg-red-600' },
};

/**
 * 좌석 — absolute 레이어 합성.
 * 상대: 카드백이 아바타 뒤 상단에 피크(z-0) → 아바타(z-10) → 플레이트(z-20, 아바타 하단 겹침)
 *       → 액션 배지(z-30, 플레이트 모서리). 쇼다운 시 카드가 전면(z-30)으로 공개.
 * 히어로: 홀카드 lg가 아바타 위/뒤에 팬 배치 (하단 독이 상시 예약되어 가림 없음).
 * 폴드/탈락 디밍은 아바타·카드에만 — 이름/칩 플레이트는 가독 유지.
 */
export default function PlayerSeat({
  player, isCurrentPlayer, isActive, position, seatIndex, compact = false,
  turnDuration = 0, turnTotalSeconds = 30, seatAction, onSit,
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
            ${compact ? 'w-12 h-12 text-[10px]' : 'w-16 h-16 text-xs'}
          `}
        >
          앉기
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
  const showCards = player.holeCards.length > 0 && !isFolded;
  const revealed = !isCurrentPlayer && !!player.revealed;

  const badge = isAllIn
    ? actionLabels['all-in']
    : seatAction
      ? seatAction.type === 'raise' && seatAction.isBet
        ? { text: '벳', color: 'bg-yellow-600' } // 포스트플랍 첫 베팅은 레이즈가 아니라 벳
        : actionLabels[seatAction.type]
      : null;
  const badgeAmount = !isAllIn && seatAction && seatAction.amount > 0
    ? ` ${seatAction.amount.toLocaleString()}`
    : '';

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.8 }}
      animate={{ opacity: 1, scale: 1 }}
      className="absolute z-10"
      // Tailwind -translate 클래스는 framer transform에 덮여 사라지므로 x/y로 센터링
      style={{ left: position.x, top: position.y, x: '-50%', y: '-50%' }}
    >
      <div className="relative flex flex-col items-center">
        {/* 홀카드 — 히어로: 아바타 위 수평 정렬(시인성 최우선) / 상대: 아바타 뒤 피크 → 쇼다운 시 전면 공개 */}
        {showCards && (
          isCurrentPlayer ? (
            <div className="absolute left-1/2 -translate-x-1/2 -top-14 z-0 flex gap-1 pointer-events-none">
              {player.holeCards.map((card, i) => (
                <CardComponent key={i} card={card} size="md" delay={i * 0.1} />
              ))}
            </div>
          ) : (
            <div
              className={`absolute left-1/2 -translate-x-1/2 flex pointer-events-none
                ${revealed ? 'z-30 -top-7 gap-0.5' : 'z-0 -top-4'}`}
            >
              {player.holeCards.map((card, i) => (
                <div
                  key={i}
                  className={
                    revealed
                      ? ''
                      : i === 0 ? 'rotate-[-8deg] translate-y-0.5' : 'rotate-[8deg] -ml-2'
                  }
                >
                  <CardComponent
                    card={card}
                    hidden={!player.revealed}
                    size={revealed ? 'sm' : 'xs'}
                    delay={i * 0.1}
                  />
                </div>
              ))}
            </div>
          )
        )}

        {/* 아바타 + 턴 타이머 링 — 디밍은 여기(와 카드)에만 */}
        <div className={`relative z-10 transition-opacity ${isDimmed ? 'opacity-40 grayscale' : ''}`}>
          <SeatEmote playerId={player.id} />
          <CharacterAvatar
            characterId={player.type === 'bot' ? (player.personalityId || player.avatar) : (player.avatar || 'player')}
            size={avatarSize}
            isActive={isActive}
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

        {/* 이름/칩 플레이트 — 아바타 하단에 겹침, 폴드여도 가독 유지 */}
        <div className={`relative z-20 -mt-2 ${isDimmed ? 'opacity-80' : ''}`}>
          <div className={`bg-black/70 backdrop-blur-sm rounded-lg text-center border
            ${isBusted ? 'border-red-500/30' : 'border-white/10'}
            ${compact ? 'px-2 py-0.5 min-w-[60px]' : 'px-3 py-1 min-w-[90px]'}
          `}>
            <div className={`text-white font-bold truncate ${compact ? 'text-[10px] max-w-[55px]' : 'text-xs max-w-[80px]'}`}>
              {player.name}
              {isCurrentPlayer && <span className="text-blossom ml-0.5">(나)</span>}
            </div>
            <div className={`font-semibold ${isBusted ? 'text-red-400' : 'text-yellow-300'} ${compact ? 'text-[9px]' : 'text-[11px]'}`}>
              {isBusted
                ? (player.finishPlace ? `${player.finishPlace}위 탈락` : '탈락')
                : player.chips.toLocaleString()}
            </div>
          </div>

          {/* 액션 배지 — 플레이트 우상단 모서리 겹침 */}
          <AnimatePresence>
            {badge && (
              <motion.div
                key={`${badge.text}${badgeAmount}`}
                initial={{ opacity: 0, scale: 0.5 }}
                animate={isAllIn ? { opacity: 1, scale: [1, 1.1, 1] } : { opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.8 }}
                transition={isAllIn ? { scale: { duration: 0.8, repeat: Infinity } } : undefined}
                className={`absolute -top-2.5 -right-2 z-30 ${badge.color} text-white font-bold rounded-full shadow-lg whitespace-nowrap
                  ${compact ? 'text-[8px] px-1.5 py-0.5' : 'text-[10px] px-2 py-0.5'}
                `}
              >
                {badge.text}
                {badgeAmount}
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* 상태 표시 */}
        {isSittingOut && !isBusted && (
          <div className={`z-20 mt-0.5 text-gray-500 font-bold ${compact ? 'text-[8px]' : 'text-[10px]'}`}>자리 비움</div>
        )}
        {player.isDisconnected && (
          <div className={`z-20 mt-0.5 text-orange-400 font-bold ${compact ? 'text-[8px]' : 'text-[10px]'}`}>오프라인</div>
        )}
      </div>
    </motion.div>
  );
}
