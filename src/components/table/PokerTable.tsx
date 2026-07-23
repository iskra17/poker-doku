'use client';

import { useGameStore } from '@/lib/store/game-store';
import { useSettingsStore } from '@/lib/store/settings-store';
import { useIsMobile } from '@/lib/hooks/use-mobile';
import { useSeatActions } from '@/lib/hooks/use-seat-actions';
import { motion } from 'framer-motion';
import PlayerSeat from './PlayerSeat';
import CommunityCards from './CommunityCards';
import PotDisplay from './PotDisplay';
import ChipStack from './ChipStack';
import AnimationLayer from './AnimationLayer';
import ThrowableLayer from './ThrowableLayer';
import ThrowLauncher from './ThrowLauncher';
import WinnerSequence from './WinnerSequence';
import SeatSpeechBubbles from '../characters/SeatSpeechBubble';
import DealerCorner from '../characters/DealerCorner';
import { getLayout, toDisplayIndex } from './table-layout';

export default function PokerTable() {
  const { gameState, myPlayerId } = useGameStore();
  const showBlindButtons = useSettingsStore(s => s.showBlindButtons);
  const isMobile = useIsMobile();
  const seatActions = useSeatActions();

  if (!gameState) return null;

  const myId = myPlayerId;
  const { seats, betPositions, dealerBtnPositions } = getLayout();
  const mySeatIndex = gameState.players.find(p => p.id === myId)?.seatIndex ?? -1;

  const seatPlayers = seats.map((_, seatIndex) => {
    return gameState.players.find(p => p.seatIndex === seatIndex) || null;
  });

  // dealerIndex는 players 배열 인덱스 — 좌석 번호로 변환해서 사용해야 한다
  const dealerSeatIndex = gameState.players[gameState.dealerIndex]?.seatIndex ?? -1;
  // SB/BB는 엔진이 postBlinds에서 기록한 플레이어 id 기준 (핸드 사이 좌석 변동에 안전)
  const seatIndexOf = (playerId?: string | null) =>
    playerId ? gameState.players.find(p => p.id === playerId)?.seatIndex ?? -1 : -1;
  const sbSeatIndex = seatIndexOf(gameState.smallBlindId);
  const bbSeatIndex = seatIndexOf(gameState.bigBlindId);
  // 포지션 버튼 3종 — 크기/모양 동일, 색만 구분 (업계 관행: D 골드/화이트, SB 블루, BB 레드 계열).
  // 헤즈업(딜러=SB)은 표준대로 D만 표시. SB/BB는 설정(showBlindButtons)으로 숨김 가능.
  const positionButtons = [
    {
      label: 'D',
      title: '딜러 버튼',
      seatIndex: dealerSeatIndex,
      show: dealerSeatIndex >= 0 && gameState.players.length >= 2,
      color: 'from-yellow-100 to-gilded border-yellow-500/80 shadow-[0_2px_8px_rgba(0,0,0,0.6),0_0_12px_rgba(255,215,106,0.45)]',
      textSize: isMobile ? 'text-[11px]' : 'text-[13px]',
    },
    {
      label: 'SB',
      title: '스몰 블라인드',
      seatIndex: sbSeatIndex,
      show: showBlindButtons && sbSeatIndex >= 0 && sbSeatIndex !== dealerSeatIndex,
      color: 'from-cyan-100 to-cyber border-cyan-500/80 shadow-[0_2px_8px_rgba(0,0,0,0.6),0_0_12px_rgba(107,228,255,0.45)]',
      textSize: isMobile ? 'text-[8px]' : 'text-[10px]',
    },
    {
      label: 'BB',
      title: '빅 블라인드',
      seatIndex: bbSeatIndex,
      show: showBlindButtons && bbSeatIndex >= 0 && bbSeatIndex !== dealerSeatIndex,
      color: 'from-pink-100 to-blossom border-pink-500/80 shadow-[0_2px_8px_rgba(0,0,0,0.6),0_0_12px_rgba(255,126,182,0.45)]',
      textSize: isMobile ? 'text-[8px]' : 'text-[10px]',
    },
  ];

  return (
    <div className="relative w-full h-full">
      {/* 세로 좌표 컨테이너 — 모든 % 좌표의 기준. 데스크탑에서도 중앙 세로 컬럼 하나 */}
      <div
        className="relative h-full w-full mx-auto"
        style={{ maxWidth: 'min(440px, 60dvh)' }}
      >
        {/* Outer glow */}
        <div
          className="absolute rounded-[9999px] opacity-30"
          style={{
            left: '4%', right: '4%', top: '11%', bottom: '5%',
            background: 'radial-gradient(ellipse, transparent 60%, rgba(139, 92, 246, 0.3) 100%)',
          }}
        />

        {/* 테이블 두께 — 레일과 같은 레이스트랙을 아래로 밀어 측면(근경 가장자리)을 노출 */}
        <div
          className="absolute rounded-[9999px] border-b-2 border-gilded/20"
          style={{
            left: '4%', right: '4%', top: 'calc(11% + 14px)', bottom: 'calc(5% - 14px)',
            background: 'linear-gradient(180deg, var(--color-elevated) 0%, #0c0925 70%)',
            boxShadow: '0 10px 26px rgba(0,0,0,0.6)',
          }}
        />

        {/* 레일(쿠션) — 실제 홀덤 테이블의 패딩 레일. 상단에 하이라이트, 골드 트림 */}
        <div
          className="absolute rounded-[9999px] border-2 border-gilded/30"
          style={{
            left: '4%', right: '4%', top: '11%', bottom: '5%',
            background: `linear-gradient(180deg,
              color-mix(in srgb, var(--color-mystic) 26%, var(--color-elevated)) 0%,
              var(--color-elevated) 30%,
              color-mix(in srgb, black 28%, var(--color-elevated)) 100%)`,
            boxShadow: 'inset 0 2px 4px rgba(255,255,255,0.14), inset 0 -6px 12px rgba(0,0,0,0.5), 0 0 40px rgba(167,139,250,0.15)',
          }}
        />

        {/* 펠트 — 레일 안쪽, 하단(플레이어 쪽)이 가깝게 보이도록 광원을 아래로 */}
        <div
          className="absolute rounded-[9999px] border border-black/50"
          style={{
            left: 'calc(4% + 12px)', right: 'calc(4% + 12px)',
            top: 'calc(11% + 12px)', bottom: 'calc(5% + 12px)',
            background: 'radial-gradient(ellipse at 50% 68%, var(--color-felt-hi) 0%, var(--color-felt-lo) 58%, #0c0925 100%)',
            boxShadow: 'inset 0 12px 30px rgba(0,0,0,0.5), inset 0 0 30px rgba(255,126,182,0.07)',
          }}
        >
          {/* 베팅 라인 */}
          <div className="absolute inset-5 md:inset-7 rounded-[9999px] border border-gilded/15" />
        </div>

        {/* 딜러 미야코 코너 (아바타 + 진행 말풍선) */}
        <DealerCorner />

        {/* Pot display — 보드 위 (table-layout POT_POS와 동기) */}
        <div className="absolute left-1/2 top-[39%] -translate-x-1/2 -translate-y-1/2 z-10">
          <PotDisplay pots={gameState.pots} compact={isMobile} />
        </div>

        {/* Community cards (table-layout BOARD_POS와 동기) */}
        <div className="absolute left-1/2 top-[48%] -translate-x-1/2 -translate-y-1/2 z-10">
          <CommunityCards
            cards={gameState.communityCards}
            winningCards={gameState.winners?.[0]?.hand?.cards}
            compact={isMobile}
          />
        </div>

        {/* Player seats — 내 좌석이 하단 중앙에 오도록 디스플레이 슬롯 회전 */}
        {seats.map((_, i) => {
          const isActiveHere = gameState.players[gameState.activePlayerIndex]?.seatIndex === i;
          const displaySlot = toDisplayIndex(i, mySeatIndex);
          return (
            <PlayerSeat
              key={i}
              player={seatPlayers[i]}
              isCurrentPlayer={seatPlayers[i]?.id === myId}
              isActive={isActiveHere}
              position={seats[displaySlot]}
              seatIndex={i}
              compact={isMobile}
              turnDuration={isActiveHere ? (gameState.turnTimeRemaining ?? 0) : 0}
              turnTotalSeconds={gameState.turnTimer || 30}
              seatAction={seatActions[i] ?? null}
              // 우측 열(슬롯 4·5)은 카드가 화면 밖으로 잘리지 않게 왼쪽(중앙 방향)에 부착
              cardSide={displaySlot === 4 || displaySlot === 5 ? 'left' : 'right'}
            />
          );
        })}

        {/* 포지션 버튼 (D/SB/BB) — 좌석 옆 펠트 위에 크게. 핸드마다 이동 애니메이션 */}
        {positionButtons.map(btn => {
          if (!btn.show) return null;
          const pos = dealerBtnPositions[toDisplayIndex(btn.seatIndex, mySeatIndex)];
          return (
            <motion.div
              key={`pos-btn-${btn.label}`}
              className="absolute z-20 pointer-events-none"
              style={{ x: '-50%', y: '-50%' }}
              initial={false}
              animate={{ left: pos.x, top: pos.y }}
              transition={{ type: 'spring', stiffness: 300, damping: 26 }}
            >
              <div
                className={`rounded-full bg-gradient-to-b text-black font-black flex items-center justify-center border-2
                  ${btn.color} ${isMobile ? 'w-6 h-6' : 'w-7 h-7'} ${btn.textSize}`}
                title={btn.title}
              >
                {btn.label}
              </div>
            </motion.div>
          );
        })}

        {/* Bet chips - 테이블 중앙 방향에 배치 (좌석과 같은 회전 적용) */}
        {betPositions.map((_, i) => {
          const player = seatPlayers[i];
          if (!player || player.currentBet <= 0) return null;
          const pos = betPositions[toDisplayIndex(i, mySeatIndex)];
          return (
            <div
              key={`bet-${i}`}
              className="absolute -translate-x-1/2 -translate-y-1/2 z-10"
              style={{ left: pos.x, top: pos.y }}
            >
              <ChipStack amount={player.currentBet} size={isMobile ? 'xs' : 'sm'} />
            </div>
          );
        })}

        {/* 칩/카드 비행 오버레이 */}
        <AnimationLayer isMobile={isMobile} />
        <ThrowableLayer isMobile={isMobile} />
        <ThrowLauncher />

        {/* 봇 좌석 말풍선 */}
        <SeatSpeechBubbles isMobile={isMobile} />

        {/* 승리 연출 (스포트라이트/배너/컨페티) */}
        <WinnerSequence isMobile={isMobile} />
      </div>
    </div>
  );
}
