'use client';

import { useState } from 'react';
import { motion } from 'framer-motion';
import { Player, GameState, ActionType } from '@/lib/poker/types';
import { useIsMobile } from '@/lib/hooks/use-mobile';
import Button from '../ui/Button';

interface ActionBarProps {
  player: Player;
  gameState: GameState;
  onAction: (action: ActionType, amount?: number) => void;
}

export default function ActionBar({ player, gameState, onAction }: ActionBarProps) {
  const [raiseAmount, setRaiseAmount] = useState(0);
  const isMobile = useIsMobile();

  const callAmount = Math.min(gameState.currentBet - player.currentBet, player.chips);
  const minRaise = gameState.currentBet + gameState.minRaise;
  const maxRaise = player.chips + player.currentBet;
  const potSize = gameState.pots.reduce((sum, p) => sum + p.amount, 0);

  const canCheck = player.currentBet >= gameState.currentBet;
  const canCall = !canCheck && callAmount > 0;
  const canRaise = maxRaise >= minRaise;

  const effectiveRaise = Math.max(raiseAmount, minRaise);

  const presets = [
    { label: '½ Pot', amount: Math.max(minRaise, Math.floor(gameState.currentBet + potSize * 0.5)) },
    { label: '¾ Pot', amount: Math.max(minRaise, Math.floor(gameState.currentBet + potSize * 0.75)) },
    { label: 'Pot', amount: Math.max(minRaise, gameState.currentBet + potSize) },
    { label: 'All In', amount: maxRaise },
  ];

  const btnSize = isMobile ? 'md' : 'lg';

  return (
    <motion.div
      initial={{ y: 50, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      className="fixed bottom-0 left-0 right-0 bg-[#0f0a1e]/95 backdrop-blur-md border-t border-purple-500/20 z-30 pb-safe"
    >
      <div className={`mx-auto ${isMobile ? 'px-3 py-2' : 'px-4 py-4 max-w-3xl'}`}>
        {/* Raise slider section */}
        {canRaise && (
          <div className={`flex items-center ${isMobile ? 'mb-2 gap-2' : 'mb-3 gap-3'}`}>
            <span className={`text-gray-400 min-w-[35px] ${isMobile ? 'text-xs' : 'text-sm'}`}>{minRaise}</span>
            <input
              type="range"
              min={minRaise}
              max={maxRaise}
              value={effectiveRaise}
              onChange={e => setRaiseAmount(Number(e.target.value))}
              className="flex-1 h-2 rounded-full appearance-none bg-gray-700 accent-purple-500"
            />
            <span className={`text-gray-400 min-w-[35px] text-right ${isMobile ? 'text-xs' : 'text-sm'}`}>{maxRaise}</span>
          </div>
        )}

        {/* Presets - horizontal scroll on mobile */}
        {canRaise && (
          <div className={`flex gap-1.5 ${isMobile ? 'mb-2 overflow-x-auto scrollbar-none' : 'mb-3 justify-center'}`}>
            {presets.map(p => (
              <button
                key={p.label}
                onClick={() => setRaiseAmount(Math.min(p.amount, maxRaise))}
                className={`rounded-lg bg-gray-700/50 hover:bg-purple-600/30 text-gray-300 hover:text-white border border-gray-600/30 transition-colors whitespace-nowrap
                  ${isMobile ? 'px-3 py-2 text-xs min-h-[36px]' : 'px-2.5 py-1 text-[11px]'}
                `}
              >
                {p.label}
              </button>
            ))}
          </div>
        )}

        {/* Action buttons */}
        <div className={`flex items-center justify-center ${isMobile ? 'gap-2' : 'gap-3'}`}>
          <Button variant="danger" size={btnSize} onClick={() => onAction('fold')}>
            FOLD
          </Button>

          {canCheck && (
            <Button variant="secondary" size={btnSize} onClick={() => onAction('check')}>
              CHECK
            </Button>
          )}

          {canCall && (
            <Button variant="success" size={btnSize} onClick={() => onAction('call')}>
              CALL {callAmount}
            </Button>
          )}

          {canRaise && (
            <Button variant="primary" size={btnSize} onClick={() => onAction('raise', effectiveRaise)}>
              RAISE {effectiveRaise}
            </Button>
          )}

          {player.chips > 0 && (
            <Button
              variant="danger"
              size={btnSize}
              onClick={() => onAction('all-in')}
              className="!bg-gradient-to-r !from-red-600 !to-orange-600 !shadow-orange-500/25"
            >
              ALL IN
            </Button>
          )}
        </div>
      </div>
    </motion.div>
  );
}
