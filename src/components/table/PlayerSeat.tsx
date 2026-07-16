'use client';

import { motion, AnimatePresence } from 'framer-motion';
import { Player } from '@/lib/poker/types';
import { SeatAction } from '@/lib/hooks/use-seat-actions';
import { useSeatExpression } from '@/lib/hooks/use-seat-expression';
import { useSettingsStore } from '@/lib/store/settings-store';
import { useChipFormatter } from '@/lib/hooks/use-chip-format';
import CharacterAvatar from '../characters/CharacterAvatar';
import CardComponent from './Card';
import TurnTimer from './TurnTimer';
import SeatEmote from './SeatEmote';
import EquippedCosmetics from '@/components/collection/EquippedCosmetics';

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
  /** 홀카드를 붙일 쪽 — 우측 열 좌석은 화면 클리핑 방지를 위해 왼쪽(테이블 중앙 방향) */
  cardSide?: 'left' | 'right';
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
 * 좌석 — 프로필(캐릭터) 중심 레이아웃.
 * 아바타를 크게(모바일 64px/데스크탑 80px) 두고, 홀카드는 아바타 옆에 살짝 겹치는
 * 작은 배지로 처리: 히어로 xs 팬 / 상대 카드백 2xs 팬 / 쇼다운 공개 시 sm(z-30).
 * cardSide로 좌우를 정한다 (우측 열 좌석은 왼쪽 — overflow-hidden 클리핑 방지).
 * 이름/칩 플레이트는 아바타 하단 겹침(z-20), 칩 부분 터치로 칩↔BB 표기 토글.
 * 폴드/탈락 디밍은 아바타·카드에만 — 이름/칩 플레이트는 가독 유지.
 */
export default function PlayerSeat({
  player, isCurrentPlayer, isActive, position, seatIndex, compact = false,
  turnDuration = 0, turnTotalSeconds = 30, seatAction, cardSide = 'right', onSit,
}: PlayerSeatProps) {
  // 훅은 early return 이전에 호출 (React 규칙)
  const expression = useSeatExpression(player?.id, isActive);
  const toggleChipDisplayMode = useSettingsStore(s => s.toggleChipDisplayMode);
  const formatChips = useChipFormatter();

  if (!player) {
    return (
      <div
        className="absolute -translate-x-1/2 -translate-y-1/2"
        style={{ left: position.x, top: position.y }}
      >
        <button
          onClick={() => onSit?.(seatIndex)}
          className={`rounded-full border-2 border-dashed border-white/20 hover:border-purple-400/50 hover:bg-purple-500/10 transition-all flex items-center justify-center text-white/30 hover:text-purple-300 cursor-pointer
            ${compact ? 'w-16 h-16 text-xs' : 'w-20 h-20 text-sm'}
          `}
        >
          앉기
        </button>
      </div>
    );
  }

  const isFolded = player.status === 'folded';
  const isAllIn = player.status === 'all-in';
  // SnG away는 딜인 유지(status는 active) 상태로 자동 폴드되므로 sitOutNext 플래그로도 표시
  const isSittingOut = player.status === 'sitting-out' || !!player.sitOutNext;
  const isBusted = player.chips <= 0 && !isAllIn;
  const isDimmed = isFolded || isSittingOut || isBusted;
  const avatarSize = compact ? 'lg' : 'xl';
  const showCards = player.holeCards.length > 0 && !isFolded;
  const revealed = !isCurrentPlayer && !!player.revealed;

  // 홀카드 앵커 — 아바타 가장자리에 살짝 겹치게 (히어로 xs > 공개 sm > 카드백 2xs 순으로 겹침량 조절)
  const cardOverlapPx = isCurrentPlayer ? 14 : revealed ? 12 : 10;
  const cardAnchorStyle = cardSide === 'left'
    ? { right: `calc(100% - ${cardOverlapPx}px)` }
    : { left: `calc(100% - ${cardOverlapPx}px)` };

  // 칩 표기 — 칩/BB 토글은 공용 포매터(useChipFormatter)가 팟·베팅액과 함께 일괄 처리
  const chipsText = formatChips(player.chips);

  const badge = isAllIn
    ? actionLabels['all-in']
    : seatAction
      ? seatAction.type === 'raise' && seatAction.isBet
        ? { text: '벳', color: 'bg-yellow-600' } // 포스트플랍 첫 베팅은 레이즈가 아니라 벳
        : actionLabels[seatAction.type]
      : null;
  const badgeAmount = !isAllIn && seatAction && seatAction.amount > 0
    ? ` ${formatChips(seatAction.amount)}`
    : '';
  const frameId = player.publicCosmetics?.frameId ?? null;
  const frameClass = frameId === 'dojo-frame-cherry-blossom' ? 'ring-2 ring-blossom/70'
    : frameId === 'dojo-frame-golden' || frameId === 'dojo-frame-master' ? 'ring-2 ring-gilded/70'
      : frameId ? 'ring-2 ring-mystic/70' : '';

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.8 }}
      animate={{ opacity: 1, scale: 1 }}
      className="absolute z-10"
      // Tailwind -translate 클래스는 framer transform에 덮여 사라지므로 x/y로 센터링
      style={{ left: position.x, top: position.y, x: '-50%', y: '-50%' }}
    >
      <div className="relative flex flex-col items-center">
        {/* 아바타 + 턴 타이머 링 + 홀카드(측면 배지) — 디밍은 여기(와 카드)에만 */}
        <div className={`relative z-10 rounded-full transition-opacity ${frameClass} ${isDimmed ? 'opacity-40 grayscale' : ''}`}>
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
              sizePx={compact ? 64 : 80}
            />
          )}

          {/* 홀카드 — 아바타 옆에 두 장 나란히 (기울임 없이 같은 높이): 히어로 xs / 상대 카드백 2xs / 쇼다운 공개 sm */}
          {showCards && (
            <div
              className={`absolute top-1/2 -translate-y-1/2 flex gap-0.5 pointer-events-none ${revealed ? 'z-30' : 'z-20'}`}
              style={cardAnchorStyle}
            >
              {player.holeCards.map((card, i) => (
                <CardComponent
                  key={i}
                  card={card}
                  hidden={!isCurrentPlayer && !player.revealed}
                  size={isCurrentPlayer ? 'xs' : revealed ? 'sm' : '2xs'}
                  delay={i * 0.1}
                />
              ))}
            </div>
          )}
        </div>

        {/* 이름/칩 플레이트 — 아바타 하단에 겹침, 폴드여도 가독 유지 */}
        <div className={`relative z-20 -mt-3 ${isDimmed ? 'opacity-80' : ''}`}>
          {/* BOT 뱃지 — 봇 플레이어 상시 표기 (플레이트 좌상단, 액션 배지와 대칭) */}
          {player.type === 'bot' && (
            <div className={`absolute -top-2 -left-2 z-30 bg-black/80 border border-cyber/60 text-cyber font-bold rounded-full tracking-wider
              ${compact ? 'text-[8px] px-1.5 py-px' : 'text-[9px] px-2 py-px'}
            `}>
              BOT
            </div>
          )}
          <div className={`bg-black/70 backdrop-blur-sm rounded-lg text-center border
            ${isBusted ? 'border-red-500/30' : 'border-white/10'}
            ${compact ? 'px-2 py-0.5 min-w-[74px]' : 'px-3 py-1 min-w-[92px]'}
          `}>
            <div className={`text-white font-bold truncate mx-auto ${compact ? 'text-[12px] max-w-[72px]' : 'text-[14px] max-w-[88px]'}`}>
              {player.name}
              {isCurrentPlayer && <span className="text-blossom ml-0.5">(나)</span>}
            </div>
            <EquippedCosmetics
              slot="title"
              itemId={player.publicCosmetics?.titleId ?? null}
              className="block max-w-[88px] truncate text-[9px] font-bold text-gilded"
            />
            {/* 칩 — 터치/클릭으로 칩↔BB 표기 전환 (소수 첫째 자리 반올림) */}
            <button
              type="button"
              onClick={toggleChipDisplayMode}
              title="칩 ↔ BB 표기 전환"
              className={`block w-full font-semibold cursor-pointer select-none tabular-nums
                ${isBusted ? 'text-red-400' : 'text-yellow-300'} ${compact ? 'text-[11px]' : 'text-xs'}`}
            >
              {isBusted
                ? (player.finishPlace ? `${player.finishPlace}위 탈락` : '탈락')
                : chipsText}
            </button>
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
                  ${compact ? 'text-[10px] px-1.5 py-0.5' : 'text-[11px] px-2 py-0.5'}
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
          <div className={`z-20 mt-0.5 text-gray-500 font-bold ${compact ? 'text-[10px]' : 'text-[11px]'}`}>자리 비움</div>
        )}
        {player.isDisconnected && (
          <div className={`z-20 mt-0.5 text-orange-400 font-bold ${compact ? 'text-[10px]' : 'text-[11px]'}`}>오프라인</div>
        )}
      </div>
    </motion.div>
  );
}
