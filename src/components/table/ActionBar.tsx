'use client';

import { useState } from 'react';
import { useGameStore } from '@/lib/store/game-store';
import { useSettingsStore } from '@/lib/store/settings-store';
import { ActionType } from '@/lib/poker/types';
import { computeValidActions } from '@/lib/poker/engine';
import { computeBetPresets } from '@/lib/poker/bet-presets';
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

/**
 * 타임칩 아이콘 — 'TIME' 문구가 든 포커칩 모양 (규칙대로 에셋 없이 SVG, 색은 텍스트 색 상속).
 * "+30초 ×1"만으로는 타임칩인지 알 수 없다는 피드백으로 추가.
 */
function TimeChipIcon({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" className="shrink-0">
      <circle cx="12" cy="12" r="11" fill="currentColor" opacity="0.15" />
      {/* 칩 테두리의 6분할 에지 마크 */}
      <circle
        cx="12" cy="12" r="10.4" fill="none" stroke="currentColor" strokeWidth="2.4"
        strokeDasharray="4.35 6.54" strokeDashoffset="2.2"
      />
      <circle cx="12" cy="12" r="7.8" fill="none" stroke="currentColor" strokeWidth="0.8" opacity="0.6" />
      <text
        x="12" y="14.1" textAnchor="middle" fontSize="5.8" fontWeight="800"
        fill="currentColor" style={{ letterSpacing: '0.1px' }}
      >
        TIME
      </text>
    </svg>
  );
}

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
  const preflopPresets = useSettingsStore(s => s.preflopPresets);
  const postflopPresets = useSettingsStore(s => s.postflopPresets);
  // 좌석 칩 플레이트의 칩↔BB 토글과 같은 설정 — 금액 입력창의 주/보조 단위도 함께 뒤집는다
  const bbInputMode = useSettingsStore(s => s.chipDisplayMode) === 'bb';
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

  // 딜인된 상태(active/all-in)에서만 — 자리비움/대기 좌석은 직전 핸드 홀카드가 남아
  // 뱃지가 "지난 패"를 현재 패처럼 보여준다 (2026-07-22 QA)
  const showBadge = !!myPlayer && gameState.isHandInProgress
    && myPlayer.holeCards.length === 2
    && (myPlayer.status === 'active' || myPlayer.status === 'all-in');

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
  // 독 배경은 전체 폭, 내용물(자리비움 버튼 포함)은 게임 영역 중앙 컨테이너(1100px)에 정렬
  if (!isMyTurn || !myPlayer || pendingAction) {
    return (
      <div className={dockClass}>
        <div className="relative mx-auto w-full max-w-[1100px]">
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
  // 사이징이 내 전 스택에 도달하면 이 레이즈는 곧 올인 — 버튼 라벨/확인 절차가 올인으로 전환
  const isShove = canRaise && effectiveRaise >= maxRaise;

  // 금액 변경 공통 경로 — 올인 확인 대기 중 금액을 바꾸면 확인 상태를 해제한다
  // (안 그러면 올인 확정 대기 → 슬라이더 하향 → 다시 최대로 올릴 때 첫 탭에 올인이 나간다)
  const updateRaise = (amount: number) => {
    setRaiseAmount(amount);
    setConfirmAllIn(false);
  };

  // 금액 직접 입력: 입력 중엔 draft 그대로, 확정(blur/Enter) 시 파싱해 범위로 클램프.
  // 칩↔BB 표기 토글에 따라 입력 단위도 바뀐다 — BB 모드에선 소수 입력을 칩으로 환산.
  const draftUnitValue = (amount: number): string =>
    bbInputMode ? String(Math.round((amount / bb) * 10) / 10) : String(amount);
  const commitAmountDraft = () => {
    if (amountDraft === null) return;
    const n = Number(amountDraft);
    if (Number.isFinite(n) && n > 0) {
      updateRaise(bbInputMode ? Math.round(n * bb) : Math.floor(n));
    }
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

  // 프리셋 — 설정에서 편집 (프리플랍: 직전 베팅의 배수 / 포스트플랍: 팟 %).
  // 포커룸 표준(GG/스타즈)대로 '최대'(올인)는 액션 줄의 독립 버튼이 아니라 사이징 영역에 둔다 —
  // 금액이 스택 최대에 도달하면 아래 레이즈 버튼이 올인 확인(2탭)으로 전환된다.
  const presets = [
    ...computeBetPresets(
      {
        street: gameState.street,
        currentBet: gameState.currentBet,
        potSize,
        minRaiseTo: minRaise,
        maxRaiseTo: maxRaise,
      },
      preflopPresets,
      postflopPresets,
    ),
    { label: '최대', amount: maxRaise },
  ];

  return (
    <div className={dockClass}>
      <div className="relative mx-auto w-full max-w-[1100px]">
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
                className="flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-full border border-cyber/50 text-cyber hover:bg-cyber/10 transition-colors whitespace-nowrap"
                title="타임칩 사용 — 생각할 시간 +30초 (자동으로 쓰이지 않아요)"
              >
                <TimeChipIcon />
                <span>+30초</span>
                <span className="font-bold">×{myPlayer.timeBankChips}</span>
              </button>
            )}
            {canRaise && (
              <div className="ml-auto text-right leading-tight">
                {/* 금액 직접 입력 — 탭/클릭 후 타이핑. 칩↔BB 토글에 따라 주 단위가 바뀌고
                    (BB 모드: BB 소수 입력, 아래 보조줄이 칩), 반대면 기존처럼 칩 입력 + BB 보조 */}
                <div className="flex items-center justify-end gap-1">
                  <input
                    type="text"
                    inputMode={bbInputMode ? 'decimal' : 'numeric'}
                    pattern={bbInputMode ? '[0-9.]*' : '[0-9]*'}
                    value={amountDraft ?? draftUnitValue(effectiveRaise)}
                    onFocus={e => {
                      setAmountDraft(draftUnitValue(effectiveRaise));
                      e.target.select();
                    }}
                    onChange={e => setAmountDraft(
                      e.target.value.replace(bbInputMode ? /[^0-9.]/g : /[^0-9]/g, ''),
                    )}
                    onBlur={commitAmountDraft}
                    onKeyDown={e => {
                      if (e.key === 'Enter') {
                        commitAmountDraft();
                        (e.target as HTMLInputElement).blur();
                      }
                    }}
                    aria-label={`${aggroLabel} 금액 직접 입력 (${bbInputMode ? 'BB' : '칩'})`}
                    disabled={controlsDisabled}
                    className="w-[96px] text-right bg-black/40 border border-white/15 rounded-lg px-2 py-0.5 font-bold text-blossom tabular text-base focus:outline-none focus:border-blossom/70 focus:bg-black/60"
                  />
                  {bbInputMode && <span className="text-[11px] font-bold text-blossom/80">BB</span>}
                </div>
                <span className="block text-[10px] text-ink-dim tabular pr-1">
                  {bbInputMode
                    ? `${effectiveRaise.toLocaleString()} 칩`
                    : `${(effectiveRaise / bb).toFixed(1)} BB`}
                </span>
              </div>
            )}
          </div>

          {/* 2행: 프리셋 버튼 + −/+ 스테퍼 */}
          {canRaise && (
            <div className="flex items-center gap-1.5">
              <div className="flex gap-1 flex-1 min-w-0">
                {presets.map((p, i) => (
                  <button
                    key={`${p.label}-${i}`}
                    onClick={() => updateRaise(Math.min(p.amount, maxRaise))}
                    disabled={controlsDisabled}
                    className="flex-1 min-w-0 rounded-lg bg-elevated/80 hover:bg-blossom-hot/30 active:bg-blossom-hot/40 text-ink-dim hover:text-white border border-white/10 transition-colors whitespace-nowrap px-1 py-1.5 text-[11px] font-bold"
                  >
                    {p.label}
                  </button>
                ))}
              </div>
              <div className="flex gap-1 shrink-0">
                <button
                  onClick={() => updateRaise(Math.max(minRaise, effectiveRaise - step))}
                  disabled={controlsDisabled}
                  className="w-10 h-10 rounded-lg bg-elevated border border-white/10 text-ink font-bold text-lg active:scale-95 transition-transform"
                  aria-label={`${aggroLabel} 감소`}
                >
                  −
                </button>
                <button
                  onClick={() => updateRaise(Math.min(maxRaise, effectiveRaise + step))}
                  disabled={controlsDisabled}
                  className="w-10 h-10 rounded-lg bg-elevated border border-white/10 text-ink font-bold text-lg active:scale-95 transition-transform"
                  aria-label={`${aggroLabel} 증가`}
                >
                  +
                </button>
              </div>
            </div>
          )}

          {/* 3행: 액션 버튼 — 포커룸 표준 3버튼 문법 (GG/스타즈/코인포커):
              [폴드] [체크|콜] [벳|레이즈]. 올인은 독립 버튼이 아니라 사이징이 스택 최대에
              도달했을 때(또는 최소 레이즈를 못 채우는 숏스택 푸시일 때) 우측 버튼이 올인으로
              전환되는 방식 — 색상도 관행대로 구분(폴드 무채색/콜 녹색/공격 액션 강조색). */}
          <div className="flex items-center w-full gap-1.5">
            <Button variant="secondary" size="md" disabled={controlsDisabled} className="flex-1 min-w-0 !px-2 whitespace-nowrap text-sm" onClick={() => act('fold')}>
              폴드
            </Button>

            {canCheck && (
              <Button variant="success" size="md" disabled={controlsDisabled} className="flex-1 min-w-0 !px-2 whitespace-nowrap text-sm" onClick={() => act('check')}>
                체크
              </Button>
            )}

            {canCall && (
              <Button variant="success" size="md" disabled={controlsDisabled} className="flex-1 min-w-0 !px-2 whitespace-nowrap text-sm" onClick={() => act('call')}>
                콜 {formatChips(callAmount)}
                {/* 스택이 콜 금액 이하면 이 콜이 곧 올인 — 별도 올인 버튼은 없으므로 여기에 명시 */}
                {callAmount >= myPlayer.chips && <span className="text-[10px] opacity-80"> (올인)</span>}
              </Button>
            )}

            {canRaise && !isShove && (
              <Button variant="primary" size="md" disabled={controlsDisabled} className="flex-[1.3] min-w-0 !px-2 whitespace-nowrap text-sm" onClick={() => act('raise', effectiveRaise)}>
                {aggroLabel} {formatChips(effectiveRaise)}
              </Button>
            )}

            {/* 올인 실행 — ①사이징을 최대까지 올린 레이즈, ②최소 레이즈를 못 채우는 숏스택 푸시.
                오조작 방지: 첫 탭은 확인 상태로 전환, 두 번째 탭에서 실제 올인 */}
            {(isShove || (!canRaise && canAllIn)) && (
              <Button
                variant={confirmAllIn ? 'danger' : 'primary'}
                size="md"
                disabled={controlsDisabled}
                onClick={() => {
                  if (confirmAllIn) {
                    act('all-in');
                  } else {
                    playEffect('ui-click');
                    setConfirmAllIn(true);
                  }
                }}
                className="flex-[1.3] min-w-0 !px-2 whitespace-nowrap text-sm"
              >
                {confirmAllIn ? '올인 확정?' : `올인 ${formatChips(maxRaise)}`}
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
              onChange={updateRaise}
              height={ACTION_DOCK_HEIGHT - 32}
              disabled={controlsDisabled}
            />
          </div>
        )}
      </div>
      </div>
    </div>
  );
}
