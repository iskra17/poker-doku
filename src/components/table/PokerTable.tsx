'use client';

import { useGameStore } from '@/lib/store/game-store';
import { useIsMobile } from '@/lib/hooks/use-mobile';
import PlayerSeat from './PlayerSeat';
import CommunityCards from './CommunityCards';
import PotDisplay from './PotDisplay';
import ActionBar from './ActionBar';
import DealerCharacter from '../characters/DealerCharacter';
import { ActionType } from '@/lib/poker/types';

// Desktop: wide elliptical layout
const DESKTOP_SEATS = [
  { x: '50%', y: '88%' },   // 0: bottom center (hero)
  { x: '10%', y: '65%' },   // 1: left bottom
  { x: '10%', y: '30%' },   // 2: left top
  { x: '50%', y: '8%' },    // 3: top center
  { x: '90%', y: '30%' },   // 4: right top
  { x: '90%', y: '65%' },   // 5: right bottom
];

// Mobile: compact portrait layout
const MOBILE_SEATS = [
  { x: '50%', y: '82%' },   // 0: bottom center (hero)
  { x: '8%',  y: '62%' },   // 1: left middle
  { x: '8%',  y: '28%' },   // 2: left top
  { x: '50%', y: '8%' },    // 3: top center
  { x: '92%', y: '28%' },   // 4: right top
  { x: '92%', y: '62%' },   // 5: right middle
];

export default function PokerTable() {
  const { gameState, socket, sendAction } = useGameStore();
  const isMobile = useIsMobile();

  if (!gameState) return null;

  const myId = socket?.id;
  const myPlayer = gameState.players.find(p => p.id === myId);
  const isMyTurn = myPlayer && gameState.players[gameState.activePlayerIndex]?.id === myId;
  const seats = isMobile ? MOBILE_SEATS : DESKTOP_SEATS;

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

        {/* Table shape */}
        <div
          className="absolute inset-2 md:inset-4 rounded-[50%] border-2 md:border-4 border-yellow-700/40 shadow-inner"
          style={{
            background: 'radial-gradient(ellipse, #1a2744 0%, #0f1a2e 50%, #0a1020 100%)',
            boxShadow: 'inset 0 0 80px rgba(0,0,0,0.5), 0 0 40px rgba(139, 92, 246, 0.15)',
          }}
        >
          <div className="absolute inset-2 md:inset-3 rounded-[50%] border border-yellow-600/20" />
        </div>

        {/* Dealer character */}
        <div className="absolute left-1/2 top-[22%] md:top-[25%] -translate-x-1/2 -translate-y-1/2 z-10 scale-75 md:scale-100">
          <DealerCharacter street={gameState.street} />
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
        {seats.map((pos, i) => (
          <PlayerSeat
            key={i}
            player={seatPlayers[i]}
            isCurrentPlayer={seatPlayers[i]?.id === myId}
            isDealer={gameState.dealerIndex === i}
            isActive={gameState.players[gameState.activePlayerIndex]?.seatIndex === i}
            position={pos}
            seatIndex={i}
            compact={isMobile}
          />
        ))}

        {/* Winner announcement */}
        {gameState.winners && gameState.winners.length > 0 && (
          <div className="absolute left-1/2 top-[70%] md:top-[75%] -translate-x-1/2 -translate-y-1/2 z-20">
            <div className="bg-black/70 backdrop-blur-sm rounded-xl px-4 py-2 md:px-6 md:py-3 border border-yellow-500/40 text-center">
              {gameState.winners.map((w, i) => {
                const winner = gameState.players.find(p => p.id === w.playerId);
                return (
                  <div key={i} className="text-yellow-300 font-bold text-sm md:text-base">
                    {winner?.name} wins {w.amount}
                    {w.hand && <span className="text-yellow-100 font-normal ml-1 text-xs md:text-sm">({w.hand.description})</span>}
                  </div>
                );
              })}
            </div>
          </div>
        )}
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
