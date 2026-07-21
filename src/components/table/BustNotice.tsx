'use client';

import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { useGameStore } from '@/lib/store/game-store';
import { useProfileStore } from '@/lib/store/profile-store';
import { useCountdownTo } from '@/lib/hooks/use-countdown';
import { useChipFormatter } from '@/lib/hooks/use-chip-format';
import Button from '../ui/Button';

/**
 * 캐시 게임 파산 안내 — 칩을 모두 잃은 직후(핸드 종료 시점) 1회 표시.
 * [바로 리바이]가 테이블에서 즉시 새 바이인을 예치한다 (join-room 멱등 리바이 경로 —
 * 다른 좌석의 핸드가 진행 중이어도 서버가 허용, 다음 핸드부터 딜인).
 * wallet 방은 지갑 잔액이 최소 바이인(40BB) 미만이면 리바이 불가 안내로 대체한다.
 * 서버가 리바이 유예(bustReclaimDeadline, 30초)를 걸므로 남은 시간을 카운트다운으로 보여준다.
 * Sit & Go 탈락은 EliminationNotice가 담당하므로 여기선 캐시 게임만 다룬다.
 */
export default function BustNotice({ onLeave }: { onLeave: () => void }) {
  const {
    gameState, myPlayerId, currentRoomId, pendingRoomId, joinError, joinRoom,
  } = useGameStore();
  const profile = useProfileStore(s => s.profile);
  const refreshProfile = useProfileStore(s => s.refresh);
  const [dismissed, setDismissed] = useState(false);
  const [attempted, setAttempted] = useState(false);
  const formatChips = useChipFormatter();

  const tournament = gameState?.tournament;
  const isCash = !tournament || tournament.entrants === 0;
  const me = gameState?.players.find(p => p.id === myPlayerId);
  const reclaimSeconds = useCountdownTo(me?.bustReclaimDeadline ?? 0);

  // 진행 중 핸드의 올인(chips 0, status 'active'/'all-in')은 팟 지분이 살아 있으므로 파산이 아니다.
  // 단, 핸드가 끝난 뒤에도 all-in status는 그대로 남는다(엔진은 파산 좌석을 리셋하지 않음) —
  // 이것이 올인 패배 확정 = 파산이므로 status만으로 걸러내면 안내가 영영 뜨지 않는다.
  const busted = !!gameState && isCash && !!me && me.chips <= 0
    && !(gameState.isHandInProgress && (me.status === 'active' || me.status === 'all-in'));

  // 파산 확인 시점에 지갑 잔액 새로고침 — 리바이 가능 여부/금액 판단용 (외부 시스템 호출)
  useEffect(() => {
    if (busted) void refreshProfile();
  }, [busted, refreshProfile]);

  if (!busted || dismissed) return null;

  // 서버가 캐시 방 바이인을 40~200BB로 강제하므로(create-room 재계산) BB에서 유도한다
  const minBuyIn = 40 * gameState.bigBlind;
  const defaultBuyIn = 100 * gameState.bigBlind;
  const isWallet = gameState.economyMode === 'wallet';
  const balance = profile?.wallet.balance ?? 0;
  const canRebuy = !isWallet || balance >= minBuyIn;
  const rebuyAmount = isWallet
    ? Math.max(minBuyIn, Math.min(defaultBuyIn, Math.floor(balance)))
    : defaultBuyIn;
  const rebuyPending = pendingRoomId !== null && pendingRoomId === currentRoomId;

  const handleRebuy = () => {
    if (!currentRoomId || rebuyPending) return;
    setAttempted(true);
    joinRoom(currentRoomId, rebuyAmount, 0);
  };

  return (
    <div className="absolute inset-0 z-30 flex items-center justify-center bg-black/60 backdrop-blur-[2px]">
      <motion.div
        initial={{ opacity: 0, scale: 0.9, y: 16 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        transition={{ type: 'spring', stiffness: 260, damping: 22 }}
        className="w-[min(88%,320px)] bg-elevated border border-blossom/40 rounded-2xl p-5 text-center shadow-2xl"
      >
        <div className="text-4xl mb-2">💸</div>
        <h3 className="text-white font-bold text-lg mb-1">칩을 모두 잃었어요</h3>
        <p className="text-ink-dim text-[11px] mb-3">
          {/* 서버 BUST_RECLAIM_MS(30초)와 동기 — 파산 좌석 자동 회수 안내 */}
          {reclaimSeconds !== null && reclaimSeconds > 0 ? (
            <span className="font-bold text-blossom">
              {reclaimSeconds}초 안에 리바이하지 않으면 자리가 자동으로 정리돼요.
            </span>
          ) : (
            '리바이 없이 30초가 지나면 자리는 자동으로 정리돼요.'
          )}
          {isWallet && (
            <>
              <br />지갑 보유 칩: <span className="text-gilded font-bold tabular">{formatChips(balance)}</span>
            </>
          )}
        </p>
        {attempted && joinError && (
          <p className="text-blossom text-[11px] mb-2">{joinError}</p>
        )}
        {!canRebuy && (
          <p className="text-ink-dim text-[11px] mb-2">
            지갑 칩이 최소 바이인({formatChips(minBuyIn)})보다 적어요 —
            로비에서 무료 칩을 받은 뒤 다시 앉아 주세요.
          </p>
        )}
        <div className="flex gap-2">
          <Button
            variant="secondary"
            size="md"
            className="flex-1"
            onClick={onLeave}
          >
            나가기
          </Button>
          {canRebuy && (
            <Button
              variant="primary"
              size="md"
              className="flex-1"
              disabled={rebuyPending}
              onClick={handleRebuy}
            >
              {rebuyPending ? '리바이 중…' : `♻️ 리바이 ${formatChips(rebuyAmount)}`}
            </Button>
          )}
        </div>
        <button
          type="button"
          onClick={() => setDismissed(true)}
          className="mt-2 w-full text-[11px] text-ink-dim hover:text-ink"
        >
          👀 잠시 관전하기 (자리는 30초 뒤 정리돼요)
        </button>
      </motion.div>
    </div>
  );
}
