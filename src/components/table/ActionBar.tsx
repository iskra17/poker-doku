'use client';

import { useState } from 'react';
import { motion } from 'framer-motion';
import { Player, GameState, ActionType } from '@/lib/poker/types';
import { useIsMobile } from '@/lib/hooks/use-mobile';
import { playEffect } from '@/lib/sound/effects';
import Button from '../ui/Button';
import HandStrengthBadge from './HandStrengthBadge';

interface ActionBarProps {
  player: Player;
  gameState: GameState;
  onAction: (action: ActionType, amount?: number) => void;
}

export default function ActionBar({ player, gameState, onAction }: ActionBarProps) {
  const [raiseAmount, setRaiseAmount] = useState(0);
  const [prevRoundKey, setPrevRoundKey] = useState('');
  const isMobile = useIsMobile();

  const callAmount = Math.min(gameState.currentBet - player.currentBet, player.chips);
  const minRaise = gameState.currentBet + gameState.minRaise;
  const maxRaise = player.chips + player.currentBet;
  const potSize = gameState.pots.reduce((sum, p) => sum + p.amount, 0);
  const bb = gameState.bigBlind || 1;

  const canCheck = player.currentBet >= gameState.currentBet;
  const canCall = !canCheck && callAmount > 0;
  const canRaise = maxRaise >= minRaise;

  // 새 베팅 라운드마다 슬라이더 리셋 (렌더 중 상태 보정 패턴)
  const roundKey = `${gameState.handNumber}-${gameState.street}-${gameState.currentBet}`;
  if (roundKey !== prevRoundKey) {
    setPrevRoundKey(roundKey);
    setRaiseAmount(0);
  }

  const effectiveRaise = Math.min(maxRaise, Math.max(raiseAmount, minRaise));

  const act = (action: ActionType, amount?: number) => {
    playEffect('ui-click');
    onAction(action, amount);
  };

  const step = bb; // 스테퍼 단위 = 빅블라인드

  const presets = [
    { label: '½팟', amount: Math.max(minRaise, Math.floor(gameState.currentBet + potSize * 0.5)) },
    { label: '¾팟', amount: Math.max(minRaise, Math.floor(gameState.currentBet + potSize * 0.75)) },
    { label: '팟', amount: Math.max(minRaise, gameState.currentBet + potSize) },
    { label: '최대', amount: maxRaise },
  ];

  const btnSize = isMobile ? 'md' : 'lg';

  return (
    <motion.div
      initial={{ y: 50, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      className="fixed bottom-0 left-0 right-0 bg-panel/95 backdrop-blur-md border-t border-mystic/20 z-30 pb-safe"
    >
      <div className={`mx-auto ${isMobile ? 'px-3 py-2' : 'px-4 py-3 max-w-3xl'}`}>
        {/* 핸드 강도 + 레이즈 금액 조절 */}
        <div className={`flex items-center gap-2 ${canRaise ? (isMobile ? 'mb-2' : 'mb-3') : 'mb-0'}`}>
          <HandStrengthBadge
            holeCards={player.holeCards}
            communityCards={gameState.communityCards}
            compact={isMobile}
          />

          {canRaise && (
            <>
              {/* 스테퍼 + 대형 금액 표시 */}
              <div className="flex items-center gap-1 ml-auto">
                <button
                  onClick={() => setRaiseAmount(Math.max(minRaise, effectiveRaise - step))}
                  className="w-8 h-8 rounded-lg bg-elevated border border-white/10 text-ink font-bold text-base active:scale-95 transition-transform"
                  aria-label="레이즈 감소"
                >
                  −
                </button>
                <div className={`text-center font-bold text-blossom tabular ${isMobile ? 'text-base min-w-[70px]' : 'text-lg min-w-[90px]'}`}>
                  {effectiveRaise.toLocaleString()}
                  <div className="text-[9px] text-ink-dim font-normal leading-none">
                    {(effectiveRaise / bb).toFixed(1)} BB
                  </div>
                </div>
                <button
                  onClick={() => setRaiseAmount(Math.min(maxRaise, effectiveRaise + step))}
                  className="w-8 h-8 rounded-lg bg-elevated border border-white/10 text-ink font-bold text-base active:scale-95 transition-transform"
                  aria-label="레이즈 증가"
                >
                  +
                </button>
              </div>
            </>
          )}
        </div>

        {/* 슬라이더 + 프리셋 한 줄 */}
        {canRaise && (
          <div className={`flex items-center gap-2 ${isMobile ? 'mb-2' : 'mb-3'}`}>
            <input
              type="range"
              min={minRaise}
              max={maxRaise}
              value={effectiveRaise}
              onChange={e => setRaiseAmount(Number(e.target.value))}
              className="flex-1 h-2 rounded-full appearance-none bg-gray-700"
            />
            <div className="flex gap-1">
              {presets.map(p => (
                <button
                  key={p.label}
                  onClick={() => setRaiseAmount(Math.min(p.amount, maxRaise))}
                  className={`rounded-lg bg-elevated/80 hover:bg-blossom-hot/30 text-ink-dim hover:text-white border border-white/10 transition-colors whitespace-nowrap
                    ${isMobile ? 'px-2 py-1.5 text-[11px]' : 'px-2.5 py-1 text-[11px]'}
                  `}
                >
                  {p.label}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* 액션 버튼 */}
        <div className={`flex items-center justify-center ${isMobile ? 'gap-2' : 'gap-3'}`}>
          <Button variant="danger" size={btnSize} onClick={() => act('fold')}>
            폴드
          </Button>

          {canCheck && (
            <Button variant="secondary" size={btnSize} onClick={() => act('check')}>
              체크
            </Button>
          )}

          {canCall && (
            <Button variant="success" size={btnSize} onClick={() => act('call')}>
              콜 {callAmount.toLocaleString()}
            </Button>
          )}

          {canRaise && (
            <Button variant="primary" size={btnSize} onClick={() => act('raise', effectiveRaise)}>
              레이즈 {effectiveRaise.toLocaleString()}
            </Button>
          )}

          {player.chips > 0 && (
            <Button
              variant="danger"
              size={btnSize}
              onClick={() => act('all-in')}
              className="!bg-gradient-to-r !from-red-600 !to-orange-600 !shadow-orange-500/25"
            >
              올인
            </Button>
          )}
        </div>
      </div>
    </motion.div>
  );
}
