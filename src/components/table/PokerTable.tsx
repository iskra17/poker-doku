'use client';

import { useGameStore } from '@/lib/store/game-store';
import { useIsMobile } from '@/lib/hooks/use-mobile';
import PlayerSeat from './PlayerSeat';
import CommunityCards from './CommunityCards';
import PotDisplay from './PotDisplay';
import ActionBar from './ActionBar';
import ChipStack from './ChipStack';
import DealerCharacter from '../characters/DealerCharacter';
import HandStrengthBadge from './HandStrengthBadge';
import AnimationLayer from './AnimationLayer';
import WinnerSequence from './WinnerSequence';
import SeatSpeechBubbles from '../characters/SeatSpeechBubble';
import { ActionType } from '@/lib/poker/types';
import { getLayout } from './table-layout';

export default function PokerTable() {
  const { gameState, myPlayerId, sendAction } = useGameStore();
  const isMobile = useIsMobile();

  if (!gameState) return null;

  const myId = myPlayerId;
  const myPlayer = gameState.players.find(p => p.id === myId);
  const isMyTurn = myPlayer && gameState.players[gameState.activePlayerIndex]?.id === myId;
  const { seats, betPositions } = getLayout(isMobile);

  const seatPlayers = seats.map((_, seatIndex) => {
    return gameState.players.find(p => p.seatIndex === seatIndex) || null;
  });

  const handleAction = (action: ActionType, amount?: number) => {
    sendAction(action, amount);
  };

  return (
    <div className="relative w-full h-full flex items-center justify-center">
      {/* Table felt - responsive */}
      <div className="relative w-full h-full max-w-[850px] max-h-[500px] md:w-[850px] md:h-[500px]">
        {/* Outer glow */}
        <div
          className="absolute inset-0 rounded-[50%] opacity-30"
          style={{
            background: 'radial-gradient(ellipse, transparent 60%, rgba(139, 92, 246, 0.3) 100%)',
          }}
        />

        {/* Table shape — 네이비→바이올렛 펠트 + 핑크 림라이트 */}
        <div
          className="absolute inset-2 md:inset-4 rounded-[50%] border-2 md:border-4 border-gilded/25 shadow-inner"
          style={{
            background: 'radial-gradient(ellipse, var(--color-felt-hi) 0%, var(--color-felt-lo) 55%, #0c0925 100%)',
            boxShadow: 'inset 0 0 80px rgba(0,0,0,0.5), inset 0 0 30px rgba(255,126,182,0.07), 0 0 40px rgba(167,139,250,0.15)',
          }}
        >
          <div className="absolute inset-2 md:inset-3 rounded-[50%] border border-gilded/15" />
        </div>

        {/* Dealer character */}
        <div className="absolute left-1/2 top-[22%] md:top-[25%] -translate-x-1/2 -translate-y-1/2 z-10 scale-75 md:scale-100">
          <DealerCharacter />
        </div>

        {/* Community cards */}
        <div className="absolute left-1/2 top-[42%] md:top-[45%] -translate-x-1/2 -translate-y-1/2 z-10">
          <CommunityCards
            cards={gameState.communityCards}
            winningCards={gameState.winners?.[0]?.hand?.cards}
            compact={isMobile}
          />
        </div>

        {/* Pot display */}
        <div className="absolute left-1/2 top-[56%] md:top-[60%] -translate-x-1/2 -translate-y-1/2 z-10">
          <PotDisplay pots={gameState.pots} compact={isMobile} />
        </div>

        {/* Player seats */}
        {seats.map((pos, i) => {
          const isActiveHere = gameState.players[gameState.activePlayerIndex]?.seatIndex === i;
          return (
            <PlayerSeat
              key={i}
              player={seatPlayers[i]}
              isCurrentPlayer={seatPlayers[i]?.id === myId}
              isDealer={gameState.dealerIndex === i}
              isActive={isActiveHere}
              position={pos}
              seatIndex={i}
              compact={isMobile}
              turnDuration={isActiveHere ? (gameState.turnTimeRemaining ?? 0) : 0}
              turnTotalSeconds={gameState.turnTimer || 30}
              lastAction={gameState.lastAction}
            />
          );
        })}

        {/* Bet chips - 테이블 중앙 방향에 배치 */}
        {betPositions.map((pos, i) => {
          const player = seatPlayers[i];
          if (!player || player.currentBet <= 0) return null;
          return (
            <div
              key={`bet-${i}`}
              className="absolute -translate-x-1/2 -translate-y-1/2 z-10"
              style={{ left: pos.x, top: pos.y }}
            >
              <ChipStack amount={player.currentBet} size={isMobile ? 'sm' : 'md'} />
            </div>
          );
        })}

        {/* 내 핸드 강도 (상대 턴일 때 — 내 턴에는 ActionBar 안에 표시) */}
        {myPlayer && !isMyTurn && gameState.isHandInProgress &&
          myPlayer.holeCards.length === 2 && myPlayer.status !== 'folded' && (
          <div
            className="absolute z-20 -translate-x-1/2 -translate-y-1/2"
            style={isMobile ? { left: '70%', top: '64%' } : { left: '64%', top: '86%' }}
          >
            <HandStrengthBadge
              holeCards={myPlayer.holeCards}
              communityCards={gameState.communityCards}
              compact={isMobile}
            />
          </div>
        )}

        {/* 칩/카드 비행 오버레이 */}
        <AnimationLayer isMobile={isMobile} />

        {/* 봇 좌석 말풍선 */}
        <SeatSpeechBubbles isMobile={isMobile} />

        {/* 승리 연출 (스포트라이트/배너/컨페티) */}
        <WinnerSequence isMobile={isMobile} />
      </div>

      {/* Action bar */}
      {isMyTurn && myPlayer && gameState.isHandInProgress && (
        <ActionBar
          player={myPlayer}
          gameState={gameState}
          onAction={handleAction}
        />
      )}
    </div>
  );
}
