'use client';

import { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Player } from '@/lib/poker/types';
import { SeatAction } from '@/lib/hooks/use-seat-actions';
import { useSeatExpression } from '@/lib/hooks/use-seat-expression';
import { useSettingsStore } from '@/lib/store/settings-store';
import { useChipFormatter } from '@/lib/hooks/use-chip-format';
import CharacterAvatar from '../characters/CharacterAvatar';
import CharacterShowcaseModal from '../characters/CharacterShowcaseModal';
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

/**
 * 오프라인 좌석 회수 카운트다운 — 서버가 준 절대 만료 시각(deadline)까지 줄어드는 빨간 타임바.
 * 전체 유예 길이는 첫 틱 시점의 남은 시간으로 앵커링해 서버 graceMs 설정과 자동으로 맞는다.
 * (렌더 중 Date.now() 금지 규칙 — 계산은 전부 인터벌 콜백에서만)
 */
function OfflineCountdown({ deadline, compact }: { deadline: number; compact: boolean }) {
  const [view, setView] = useState<{ frac: number; seconds: number } | null>(null);
  const totalRef = useRef<number | null>(null);

  useEffect(() => {
    totalRef.current = null;
    const tick = () => {
      const remaining = Math.max(0, deadline - Date.now());
      if (totalRef.current === null) totalRef.current = Math.max(1000, remaining);
      setView({
        frac: Math.min(1, remaining / totalRef.current),
        seconds: Math.ceil(remaining / 1000),
      });
    };
    tick();
    const interval = setInterval(tick, 250);
    return () => clearInterval(interval);
  }, [deadline]);

  if (!view) return null;
  return (
    <div className="flex items-center gap-1">
      <div className={`${compact ? 'w-10' : 'w-14'} h-1 rounded-full bg-white/15 overflow-hidden`}>
        <div
          className="h-full rounded-full bg-red-500 transition-[width] duration-200 ease-linear"
          style={{ width: `${view.frac * 100}%` }}
        />
      </div>
      <span className="text-[9px] font-bold tabular-nums text-red-400">{view.seconds}s</span>
    </div>
  );
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
 * 배지로 처리: 히어로 sm 팬 / 상대 카드백 2xs 팬 / 쇼다운 공개 시 sm(z-30).
 * cardSide로 좌우를 정한다 (우측 열 좌석은 왼쪽 — overflow-hidden 클리핑 방지).
 * 이름/칩 플레이트는 아바타 하단 겹침(z-20), 칩 부분 터치로 칩↔BB 표기 토글.
 * 폴드/탈락 디밍은 아바타·카드에만 — 이름/칩 플레이트는 가독 유지.
 * 히어로는 폴드해도 자기 카드를 계속 본다 (무엇을 접었는지 확인) — 이때는 수트 색이
 * 죽지 않게 grayscale 없이 투명도만 낮춘다. 상대 폴드 카드는 여전히 숨김.
 */
export default function PlayerSeat({
  player, isCurrentPlayer, isActive, position, seatIndex, compact = false,
  turnDuration = 0, turnTotalSeconds = 30, seatAction, cardSide = 'right', onSit,
}: PlayerSeatProps) {
  // 훅은 early return 이전에 호출 (React 규칙)
  const expression = useSeatExpression(player?.id, isActive);
  const toggleChipDisplayMode = useSettingsStore(s => s.toggleChipDisplayMode);
  const formatChips = useChipFormatter();
  // 아바타 탭 → 캐릭터 쇼케이스 (본인/봇 공통 — 캐릭터 일러스트 감상)
  const [showcaseOpen, setShowcaseOpen] = useState(false);

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
  // 히어로는 폴드해도 자기 카드를 계속 확인할 수 있어야 한다 — 상대 폴드 카드만 숨김
  const showCards = player.holeCards.length > 0 && (isCurrentPlayer || !isFolded);
  const revealed = !isCurrentPlayer && !!player.revealed;
  // 히어로 폴드 디밍은 grayscale 없이 — 수트 색이 죽으면 접은 카드를 읽을 수 없다
  const dimClass = isDimmed
    ? (isCurrentPlayer && isFolded && !isBusted ? 'opacity-60' : 'opacity-40 grayscale')
    : '';

  // 홀카드 앵커 — 아바타 가장자리에 살짝 겹치게 (히어로 sm > 공개 sm > 카드백 2xs 순으로 겹침량 조절)
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
        {/* 아바타 + 턴 타이머 링 + 홀카드(측면 배지) — 디밍은 여기(와 카드)에만.
            탭하면 캐릭터 쇼케이스(상반신 일러스트) 오픈 */}
        <div
          className={`relative z-10 rounded-full transition-opacity cursor-pointer ${frameClass} ${dimClass}`}
          onClick={() => setShowcaseOpen(true)}
          role="button"
          aria-label={`${player.name} 캐릭터 보기`}
        >
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

          {/* 홀카드 — 아바타 옆에 두 장 나란히 (기울임 없이 같은 높이): 히어로 sm / 상대 카드백 2xs / 쇼다운 공개 sm */}
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
                  // 히어로 확대(sm)는 데스크톱만 — 360px급(S24) 화면에선 xs 유지 (2026-07-22 유저 피드백: 모바일 짤림)
                  size={isCurrentPlayer ? (compact ? 'xs' : 'sm') : revealed ? 'sm' : '2xs'}
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
          <div className="z-20 mt-0.5 flex flex-col items-center gap-0.5">
            <div className={`text-orange-400 font-bold ${compact ? 'text-[10px]' : 'text-[11px]'}`}>오프라인</div>
            {/* 회수 예정 좌석만 카운트다운 표시 — SnG/자리비움 좌석은 서버가 deadline을 싣지 않는다 */}
            {player.disconnectGraceDeadline && (
              <OfflineCountdown deadline={player.disconnectGraceDeadline} compact={compact} />
            )}
          </div>
        )}
      </div>

      {/* 캐릭터 쇼케이스 — 포탈 렌더라 transform 조상(framer) 영향 없음 */}
      <CharacterShowcaseModal
        characterId={showcaseOpen
          ? (player.type === 'bot' ? (player.personalityId || player.avatar) : (player.avatar || 'player'))
          : null}
        onClose={() => setShowcaseOpen(false)}
      />
    </motion.div>
  );
}
