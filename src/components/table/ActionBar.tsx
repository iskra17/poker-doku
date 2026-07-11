'use client';

import { useState } from 'react';
import { useGameStore } from '@/lib/store/game-store';
import { useSettingsStore } from '@/lib/store/settings-store';
import { ActionType } from '@/lib/poker/types';
import { useIsMobile } from '@/lib/hooks/use-mobile';
import { playEffect } from '@/lib/sound/effects';
import Button from '../ui/Button';
import VerticalSlider from '../ui/VerticalSlider';
import HandStrengthBadge from './HandStrengthBadge';

/**
 * 하단 액션 독 — GameRoomView flex 컬럼의 flex-none 자식.
 * 턴 여부와 무관하게 높이가 고정이라 테이블 % 좌표가 흔들리지 않는다.
 * 내 턴: 좌측 [금액 표시 / 프리셋+스테퍼 / 액션 버튼] 3행 + 우측 세로 벳 슬라이더
 * (포커룸 표준 원핸드 문법: GGPoker/파티포커식 — 프리셋으로 미스클릭 방지, 슬라이더는 엄지/휠 미세조정).
 * 대기: 핸드 강도 + 진행 상황 텍스트.
 */
export const ACTION_DOCK_HEIGHT = 176;

export default function ActionBar() {
  const { gameState, myPlayerId, sendAction, toggleSitOut, useTimeBank } = useGameStore();
  const betStepUnit = useSettingsStore(s => s.betStepUnit);
  const [raiseAmount, setRaiseAmount] = useState(0);
  const [prevRoundKey, setPrevRoundKey] = useState('');
  const isMobile = useIsMobile();

  if (!gameState) return null;

  const myPlayer = gameState.players.find(p => p.id === myPlayerId);
  const activePlayer = gameState.isHandInProgress
    ? gameState.players[gameState.activePlayerIndex] ?? null
    : null;
  const isMyTurn = !!myPlayer && activePlayer?.id === myPlayerId;

  const showBadge = !!myPlayer && gameState.isHandInProgress
    && myPlayer.holeCards.length === 2 && myPlayer.status !== 'folded';

  const dockClass = 'flex-none relative bg-panel/95 backdrop-blur-md border-t border-mystic/20 z-30 pb-safe';
  const sittingOut = !!myPlayer && (myPlayer.sitOutNext || myPlayer.status === 'sitting-out');

  const sitOutButton = myPlayer && (
    <button
      onClick={toggleSitOut}
      className={`absolute right-2 top-1.5 z-10 text-[10px] px-2 py-1 rounded-full border transition-colors
        ${sittingOut
          ? 'border-blossom/60 text-blossom bg-blossom/10'
          : 'border-white/15 text-ink-dim hover:text-ink hover:bg-white/5'}`}
    >
      {sittingOut ? '게임 복귀' : '자리비움'}
    </button>
  );

  // ---- 대기 상태 ----
  if (!isMyTurn || !myPlayer) {
    return (
      <div className={dockClass}>
        {sitOutButton}
        <div
          className="flex flex-col items-center justify-center gap-2 px-3"
          style={{ height: ACTION_DOCK_HEIGHT }}
        >
          {showBadge && myPlayer && (
            <HandStrengthBadge
              holeCards={myPlayer.holeCards}
              communityCards={gameState.communityCards}
              compact={isMobile}
            />
          )}
          <p className="text-ink-dim text-xs">
            {sittingOut
              ? '자리 비움 중 — 복귀를 누르면 다음 핸드부터 참여해요.'
              : activePlayer
                ? `${activePlayer.name}님이 생각 중...`
                : '다음 핸드를 기다리는 중...'}
          </p>
        </div>
      </div>
    );
  }

  // ---- 내 턴 ----
  const callAmount = Math.min(gameState.currentBet - myPlayer.currentBet, myPlayer.chips);
  const minRaise = gameState.currentBet + gameState.minRaise;
  const maxRaise = myPlayer.chips + myPlayer.currentBet;
  const potSize = gameState.pots.reduce((sum, p) => sum + p.amount, 0);
  const bb = gameState.bigBlind || 1;

  const canCheck = myPlayer.currentBet >= gameState.currentBet;
  const canCall = !canCheck && callAmount > 0;
  const canRaise = maxRaise >= minRaise;
  // 포스트플랍에서 아직 아무 베팅이 없으면 '벳', 그 외(블라인드/베팅 위)는 '레이즈'
  const aggroLabel = gameState.street !== 'preflop' && gameState.currentBet === 0 ? '벳' : '레이즈';

  // 새 베팅 라운드마다 슬라이더 리셋 (렌더 중 상태 보정 패턴)
  const roundKey = `${gameState.handNumber}-${gameState.street}-${gameState.currentBet}`;
  if (roundKey !== prevRoundKey) {
    setPrevRoundKey(roundKey);
    setRaiseAmount(0);
  }

  const effectiveRaise = Math.min(maxRaise, Math.max(raiseAmount, minRaise));

  const act = (action: ActionType, amount?: number) => {
    playEffect('ui-click');
    sendAction(action, amount);
  };

  // 슬라이더/스테퍼 증감 단위 — 설정에서 SB/BB 선택
  const sb = gameState.smallBlind || Math.max(1, Math.floor(bb / 2));
  const step = betStepUnit === 'sb' ? sb : bb;

  // 프리셋 — 프리플랍: 직전 베팅의 배수(오픈이면 BB 기준) / 포스트플랍: 팟 비율
  const presets = gameState.street === 'preflop'
    ? [
        { label: '2x', amount: Math.max(minRaise, gameState.currentBet * 2) },
        { label: '2.2x', amount: Math.max(minRaise, Math.round(gameState.currentBet * 2.2)) },
        { label: '2.5x', amount: Math.max(minRaise, Math.round(gameState.currentBet * 2.5)) },
        { label: '올인', amount: maxRaise },
      ]
    : [
        { label: '33%', amount: Math.max(minRaise, Math.floor(gameState.currentBet + potSize * 0.33)) },
        { label: '50%', amount: Math.max(minRaise, Math.floor(gameState.currentBet + potSize * 0.5)) },
        { label: '75%', amount: Math.max(minRaise, Math.floor(gameState.currentBet + potSize * 0.75)) },
        { label: '100%', amount: Math.max(minRaise, gameState.currentBet + potSize) },
      ];

  return (
    <div className={dockClass}>
      {sitOutButton}
      <div
        className="flex items-stretch gap-2.5 px-3 w-full max-w-md mx-auto"
        style={{ height: ACTION_DOCK_HEIGHT }}
      >
        {/* 좌측 컨트롤 컬럼 */}
        <div className="flex-1 min-w-0 flex flex-col justify-evenly gap-1 py-1.5">
          {/* 1행: 핸드 강도 + 타임칩 + 현재 벳 금액 */}
          <div className="flex items-center gap-2">
            <HandStrengthBadge
              holeCards={myPlayer.holeCards}
              communityCards={gameState.communityCards}
              compact
            />
            {(myPlayer.timeBankChips ?? 0) > 0 && (
              <button
                onClick={useTimeBank}
                className="text-[10px] px-2 py-0.5 rounded-full border border-cyber/50 text-cyber hover:bg-cyber/10 transition-colors whitespace-nowrap"
                title="타임칩 사용 — 생각할 시간 +30초"
              >
                +30초 ×{myPlayer.timeBankChips}
              </button>
            )}
            {canRaise && (
              <div className="ml-auto text-right leading-tight">
                <span className="font-bold text-blossom tabular text-lg">
                  {effectiveRaise.toLocaleString()}
                </span>
                <span className="block text-[10px] text-ink-dim tabular">
                  {(effectiveRaise / bb).toFixed(1)} BB
                </span>
              </div>
            )}
          </div>

          {/* 2행: 프리셋 버튼 + −/+ 스테퍼 */}
          {canRaise && (
            <div className="flex items-center gap-1.5">
              <div className="flex gap-1 flex-1 min-w-0">
                {presets.map(p => (
                  <button
                    key={p.label}
                    onClick={() => setRaiseAmount(Math.min(p.amount, maxRaise))}
                    className="flex-1 min-w-0 rounded-lg bg-elevated/80 hover:bg-blossom-hot/30 active:bg-blossom-hot/40 text-ink-dim hover:text-white border border-white/10 transition-colors whitespace-nowrap px-1 py-1.5 text-[11px] font-bold"
                  >
                    {p.label}
                  </button>
                ))}
              </div>
              <div className="flex gap-1 shrink-0">
                <button
                  onClick={() => setRaiseAmount(Math.max(minRaise, effectiveRaise - step))}
                  className="w-8 h-8 rounded-lg bg-elevated border border-white/10 text-ink font-bold text-base active:scale-95 transition-transform"
                  aria-label={`${aggroLabel} 감소`}
                >
                  −
                </button>
                <button
                  onClick={() => setRaiseAmount(Math.min(maxRaise, effectiveRaise + step))}
                  className="w-8 h-8 rounded-lg bg-elevated border border-white/10 text-ink font-bold text-base active:scale-95 transition-transform"
                  aria-label={`${aggroLabel} 증가`}
                >
                  +
                </button>
              </div>
            </div>
          )}

          {/* 3행: 액션 버튼 — 좁은 화면에서 세로로 깨지지 않게 flex-1 + nowrap */}
          <div className="flex items-center w-full gap-1.5">
            <Button variant="danger" size="md" className="flex-1 min-w-0 !px-2 whitespace-nowrap text-sm" onClick={() => act('fold')}>
              폴드
            </Button>

            {canCheck && (
              <Button variant="secondary" size="md" className="flex-1 min-w-0 !px-2 whitespace-nowrap text-sm" onClick={() => act('check')}>
                체크
              </Button>
            )}

            {canCall && (
              <Button variant="success" size="md" className="flex-1 min-w-0 !px-2 whitespace-nowrap text-sm" onClick={() => act('call')}>
                콜 {callAmount.toLocaleString()}
              </Button>
            )}

            {canRaise && (
              <Button variant="primary" size="md" className="flex-[1.3] min-w-0 !px-2 whitespace-nowrap text-sm" onClick={() => act('raise', effectiveRaise)}>
                {aggroLabel} {effectiveRaise.toLocaleString()}
              </Button>
            )}

            {myPlayer.chips > 0 && (
              <Button
                variant="danger"
                size="md"
                onClick={() => act('all-in')}
                className="flex-1 min-w-0 !px-2 whitespace-nowrap text-sm !bg-gradient-to-r !from-red-600 !to-orange-600 !shadow-orange-500/25"
              >
                올인
              </Button>
            )}
          </div>
        </div>

        {/* 우측: 세로 벳 슬라이더 (아래=최소 → 위=최대, 휠/터치 드래그) */}
        {canRaise && (
          <div className="flex items-center py-2">
            <VerticalSlider
              min={minRaise}
              max={maxRaise}
              step={step}
              value={effectiveRaise}
              onChange={setRaiseAmount}
              height={ACTION_DOCK_HEIGHT - 32}
            />
          </div>
        )}
      </div>
    </div>
  );
}
