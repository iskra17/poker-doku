'use client';

import { useGameStore } from '@/lib/store/game-store';
import { useSettingsStore } from '@/lib/store/settings-store';
import { useProgressionStore } from '@/lib/store/progression-store';
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
import TableFelt from './TableFelt';

export default function PokerTable({ finalTable = false, storyTheme = false }: { finalTable?: boolean; storyTheme?: boolean }) {
  const { gameState, myPlayerId } = useGameStore();
  const showBlindButtons = useSettingsStore(s => s.showBlindButtons);
  const isMobile = useIsMobile();
  const seatActions = useSeatActions();
  // 장착 펠트 코스메틱(수련 스토리 보상) — 훅은 early return 앞에서 무조건 호출, 적용은 수련 테이블에만(아래 yellowFelt)
  const feltId = useProgressionStore(state => state.snapshot?.cosmetics?.felt ?? null);

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
      color: 'bg-gilded border-gilded shadow-sm',
      textSize: isMobile ? 'text-[11px]' : 'text-[13px]',
    },
    {
      label: 'SB',
      title: '스몰 블라인드',
      seatIndex: sbSeatIndex,
      show: showBlindButtons && sbSeatIndex >= 0 && sbSeatIndex !== dealerSeatIndex,
      color: 'bg-cyber border-cyber shadow-sm',
      textSize: isMobile ? 'text-[8px]' : 'text-[10px]',
    },
    {
      label: 'BB',
      title: '빅 블라인드',
      seatIndex: bbSeatIndex,
      show: showBlindButtons && bbSeatIndex >= 0 && bbSeatIndex !== dealerSeatIndex,
      color: 'bg-blossom border-blossom shadow-sm',
      textSize: isMobile ? 'text-[8px]' : 'text-[10px]',
    },
  ];

  // 수련 스토리 방은 펠트·레일을 시안 계열 「도장 테이블」로 바꾼다 — 외형 계산은 TableFelt가 소유 (파이널 테마 우선)
  const story = storyTheme && !finalTable;

  return (
    <div className="relative z-10 w-full h-full">
      {/* 세로 좌표 컨테이너 — 모든 % 좌표의 기준. 데스크탑에서도 중앙 세로 컬럼 하나 */}
      <div
        className="relative h-full w-full mx-auto"
        style={{ maxWidth: 'min(440px, 60dvh)' }}
      >
        <TableFelt finalTable={finalTable} story={story} feltId={feltId} />

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
                className={`rounded-full text-abyss font-bold flex items-center justify-center border-2
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
