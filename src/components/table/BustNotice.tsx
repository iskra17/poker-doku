'use client';

import { useState } from 'react';
import { motion } from 'framer-motion';
import { useGameStore } from '@/lib/store/game-store';
import { useCountdownTo } from '@/lib/hooks/use-countdown';
import Button from '../ui/Button';

/**
 * 캐시 게임 파산 안내 — 칩을 모두 잃은 직후(핸드 종료 시점) 1회 표시.
 * 리바이 자체는 미구현이라, "나가서 다시 앉으면 새로 바이인" 경로를 명시적으로 안내한다.
 * 서버가 리바이 유예(bustReclaimDeadline, 30초)를 걸므로 남은 시간을 카운트다운으로 보여준다.
 * Sit & Go 탈락은 EliminationNotice가 담당하므로 여기선 캐시 게임만 다룬다.
 */
export default function BustNotice({ onLeave }: { onLeave: () => void }) {
  const { gameState, myPlayerId } = useGameStore();
  const [dismissed, setDismissed] = useState(false);

  const tournament = gameState?.tournament;
  const isCash = !tournament || tournament.entrants === 0;
  const me = gameState?.players.find(p => p.id === myPlayerId);
  const reclaimSeconds = useCountdownTo(me?.bustReclaimDeadline ?? 0);

  if (!gameState || !isCash || !me) return null;
  if (me.chips > 0) return null; // 아직 칩이 있으면 파산 아님
  // 진행 중 핸드의 올인(chips 0, status 'active'/'all-in')은 팟 지분이 살아 있으므로 파산이 아니다.
  // 단, 핸드가 끝난 뒤에도 all-in status는 그대로 남는다(엔진은 파산 좌석을 리셋하지 않음) —
  // 이것이 올인 패배 확정 = 파산이므로 status만으로 걸러내면 안내가 영영 뜨지 않는다
  // (헤즈업에서 다음 핸드가 시작될 수 없으면 status가 갱신될 기회 자체가 없다).
  if (gameState.isHandInProgress && (me.status === 'active' || me.status === 'all-in')) return null;
  if (dismissed) return null;

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
        <p className="text-ink-dim text-[11px] mb-4">
          나가서 다시 앉으면 새 칩으로 바이인할 수 있어요.
          {/* 서버 BUST_RECLAIM_MS(30초)와 동기 — 파산 좌석 자동 회수 안내 */}
          <br />
          {reclaimSeconds !== null && reclaimSeconds > 0 ? (
            <span className="font-bold text-blossom">
              {reclaimSeconds}초 안에 리바이하지 않으면 자리가 자동으로 정리돼요.
            </span>
          ) : (
            '리바이 없이 30초가 지나면 자리는 자동으로 정리돼요.'
          )}
        </p>
        <div className="flex gap-2">
          <Button
            variant="secondary"
            size="md"
            className="flex-1"
            onClick={() => setDismissed(true)}
          >
            👀 관전
          </Button>
          <Button
            variant="primary"
            size="md"
            className="flex-1"
            onClick={onLeave}
          >
            나가서 다시 앉기
          </Button>
        </div>
      </motion.div>
    </div>
  );
}
