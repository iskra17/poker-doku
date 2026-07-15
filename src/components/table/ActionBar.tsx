'use client';

import { useState } from 'react';
import { useGameStore } from '@/lib/store/game-store';
import { useSettingsStore } from '@/lib/store/settings-store';
import { ActionType } from '@/lib/poker/types';
import { computeValidActions } from '@/lib/poker/engine';
import { useIsMobile } from '@/lib/hooks/use-mobile';
import { useChipFormatter } from '@/lib/hooks/use-chip-format';
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
  const {
    gameState,
    myPlayerId,
    connected,
    pendingAction,
    sendAction,
    toggleSitOut,
    useTimeBank,
  } = useGameStore();
  const betStepUnit = useSettingsStore(s => s.betStepUnit);
  const [raiseAmount, setRaiseAmount] = useState(0);
  const [amountDraft, setAmountDraft] = useState<string | null>(null); // 금액 직접 입력 중 임시값
  const [confirmAllIn, setConfirmAllIn] = useState(false); // 올인 오조작 방지 — 한 번 더 눌러야 확정
  const [prevRoundKey, setPrevRoundKey] = useState('');
  const isMobile = useIsMobile();
  const formatChips = useChipFormatter();

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
  const controlsDisabled = !connected || !!pendingAction;

  const sitOutButton = myPlayer && (
    <button
      onClick={toggleSitOut}
      disabled={controlsDisabled}
      className={`absolute right-2 top-1.5 z-10 text-[10px] px-2 py-1 rounded-full border transition-colors
        ${sittingOut
          ? 'border-blossom/60 text-blossom bg-blossom/10'
          : 'border-white/15 text-ink-dim hover:text-ink hover:bg-white/5'}
        ${controlsDisabled ? 'opacity-40 cursor-not-allowed' : ''}`}
    >
      {sittingOut ? '게임 복귀' : '자리비움'}
    </button>
  );

  // ---- 대기 상태 ----
  if (!isMyTurn || !myPlayer || pendingAction) {
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
            {pendingAction
              ? '액션 확인 중…'
              : sittingOut
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

  // 버튼 노출은 서버와 같은 판정 함수를 쓴다 — 규칙을 여기 다시 구현하면 어긋나는 순간
  // 서버가 거부하는 먹통 버튼이 생긴다 (엔진 processAction이 getValidActions로 재검증한다).
  const valid = computeValidActions(gameState, myPlayer);
  const canCheck = valid.includes('check');
  const canCall = valid.includes('call') && callAmount > 0;
  const canRaise = valid.includes('raise');
  const canAllIn = valid.includes('all-in');
  // 포스트플랍에서 아직 아무 베팅이 없으면 '벳', 그 외(블라인드/베팅 위)는 '레이즈'
  const aggroLabel = gameState.street !== 'preflop' && gameState.currentBet === 0 ? '벳' : '레이즈';

  // 새 베팅 라운드마다 슬라이더 리셋 (렌더 중 상태 보정 패턴)
  const roundKey = `${gameState.handNumber}-${gameState.street}-${gameState.currentBet}`;
  if (roundKey !== prevRoundKey) {
    setPrevRoundKey(roundKey);
    setRaiseAmount(0);
    setAmountDraft(null);
    setConfirmAllIn(false);
  }

  const effectiveRaise = Math.min(maxRaise, Math.max(raiseAmount, minRaise));

  // 금액 직접 입력: 입력 중엔 draft 그대로, 확정(blur/Enter) 시 파싱해 범위로 클램프
  const commitAmountDraft = () => {
    if (amountDraft === null) return;
    const n = Math.floor(Number(amountDraft));
    if (Number.isFinite(n) && n > 0) setRaiseAmount(n);
    setAmountDraft(null);
  };

  const act = (action: ActionType, amount?: number) => {
    if (controlsDisabled) return;
    playEffect('ui-click');
    setConfirmAllIn(false);
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
                disabled={controlsDisabled}
                className="text-[10px] px-2 py-0.5 rounded-full border border-cyber/50 text-cyber hover:bg-cyber/10 transition-colors whitespace-nowrap"
                title="타임칩 사용 — 생각할 시간 +30초"
              >
                +30초 ×{myPlayer.timeBankChips}
              </button>
            )}
            {canRaise && (
              <div className="ml-auto text-right leading-tight">
                {/* 금액 직접 입력 — 탭/클릭 후 타이핑 (모바일 숫자 키패드) */}
                <input
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  value={amountDraft ?? String(effectiveRaise)}
                  onFocus={e => {
                    setAmountDraft(String(effectiveRaise));
                    e.target.select();
                  }}
                  onChange={e => setAmountDraft(e.target.value.replace(/[^0-9]/g, ''))}
                  onBlur={commitAmountDraft}
                  onKeyDown={e => {
                    if (e.key === 'Enter') {
                      commitAmountDraft();
                      (e.target as HTMLInputElement).blur();
                    }
                  }}
                  aria-label={`${aggroLabel} 금액 직접 입력`}
                  disabled={controlsDisabled}
                  className="w-[96px] text-right bg-black/40 border border-white/15 rounded-lg px-2 py-0.5 font-bold text-blossom tabular text-base focus:outline-none focus:border-blossom/70 focus:bg-black/60"
                />
                <span className="block text-[10px] text-ink-dim tabular pr-1">
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
                    disabled={controlsDisabled}
                    className="flex-1 min-w-0 rounded-lg bg-elevated/80 hover:bg-blossom-hot/30 active:bg-blossom-hot/40 text-ink-dim hover:text-white border border-white/10 transition-colors whitespace-nowrap px-1 py-1.5 text-[11px] font-bold"
                  >
                    {p.label}
                  </button>
                ))}
              </div>
              <div className="flex gap-1 shrink-0">
                <button
                  onClick={() => setRaiseAmount(Math.max(minRaise, effectiveRaise - step))}
                  disabled={controlsDisabled}
                  className="w-10 h-10 rounded-lg bg-elevated border border-white/10 text-ink font-bold text-lg active:scale-95 transition-transform"
                  aria-label={`${aggroLabel} 감소`}
                >
                  −
                </button>
                <button
                  onClick={() => setRaiseAmount(Math.min(maxRaise, effectiveRaise + step))}
                  disabled={controlsDisabled}
                  className="w-10 h-10 rounded-lg bg-elevated border border-white/10 text-ink font-bold text-lg active:scale-95 transition-transform"
                  aria-label={`${aggroLabel} 증가`}
                >
                  +
                </button>
              </div>
            </div>
          )}

          {/* 3행: 액션 버튼 — 동일 색상(primary)으로 통일, 좁은 화면에서 세로로 깨지지 않게 flex-1 + nowrap */}
          <div className="flex items-center w-full gap-1.5">
            <Button variant="primary" size="md" disabled={controlsDisabled} className="flex-1 min-w-0 !px-2 whitespace-nowrap text-sm" onClick={() => act('fold')}>
              폴드
            </Button>

            {canCheck && (
              <Button variant="primary" size="md" disabled={controlsDisabled} className="flex-1 min-w-0 !px-2 whitespace-nowrap text-sm" onClick={() => act('check')}>
                체크
              </Button>
            )}

            {canCall && (
              <Button variant="primary" size="md" disabled={controlsDisabled} className="flex-1 min-w-0 !px-2 whitespace-nowrap text-sm" onClick={() => act('call')}>
                콜 {formatChips(callAmount)}
                {/* 스택이 콜 금액 이하면 이 콜이 곧 올인 — 별도 올인 버튼은 뜨지 않으므로 여기에 명시 */}
                {callAmount >= myPlayer.chips && <span className="text-[10px] opacity-80"> (올인)</span>}
              </Button>
            )}

            {canRaise && (
              <Button variant="primary" size="md" disabled={controlsDisabled} className="flex-[1.3] min-w-0 !px-2 whitespace-nowrap text-sm" onClick={() => act('raise', effectiveRaise)}>
                {aggroLabel} {formatChips(effectiveRaise)}
              </Button>
            )}

            {canAllIn && (
              <Button
                variant={confirmAllIn ? 'danger' : 'primary'}
                size="md"
                disabled={controlsDisabled}
                onClick={() => {
                  // 오조작 방지: 첫 클릭은 확인 상태로 전환, 두 번째 클릭에서 실제 올인
                  if (confirmAllIn) {
                    act('all-in');
                  } else {
                    playEffect('ui-click');
                    setConfirmAllIn(true);
                  }
                }}
                className="flex-1 min-w-0 !px-2 whitespace-nowrap text-sm"
              >
                {confirmAllIn ? '올인 확정?' : '올인'}
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
              disabled={controlsDisabled}
            />
          </div>
        )}
      </div>
    </div>
  );
}
