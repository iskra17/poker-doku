'use client';

import { useState } from 'react';
import { motion } from 'framer-motion';
import { useGameStore } from '@/lib/store/game-store';
import Button from '../ui/Button';

/**
 * Sit & Go 중도 탈락 안내 — 내 순위가 확정되면 1회 표시.
 * 리바이는 없으며, 닫으면 관전 모드(좌석 유지, 수신 전용)로 계속 지켜볼 수 있다.
 * 토너먼트가 끝나면 TournamentResultOverlay(z-40)가 대신 표시된다.
 */
export default function EliminationNotice() {
  const { gameState, myPlayerId } = useGameStore();
  const [dismissedPlace, setDismissedPlace] = useState<number | null>(null);

  const tournament = gameState?.tournament;
  const me = gameState?.players.find(p => p.id === myPlayerId);
  if (!tournament || tournament.entrants === 0 || tournament.finished) return null;
  if (!me?.finishPlace || me.finishPlace === 1) return null;
  if (dismissedPlace === me.finishPlace) return null;

  const result = tournament.results.find(r => r.playerId === myPlayerId);
  const prize = result?.prize ?? 0;

  return (
    <div className="absolute inset-0 z-30 flex items-center justify-center bg-black/60 backdrop-blur-[2px]">
      <motion.div
        initial={{ opacity: 0, scale: 0.9, y: 16 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        transition={{ type: 'spring', stiffness: 260, damping: 22 }}
        className="w-[min(88%,320px)] bg-elevated border border-blossom/40 rounded-2xl p-5 text-center shadow-2xl"
      >
        <div className="text-4xl mb-2">😢</div>
        <h3 className="text-white font-bold text-lg mb-1">
          {me.finishPlace}위로 탈락했어요
        </h3>
        {prize > 0 ? (
          <p className="text-gilded font-bold text-sm mb-1">상금 +{prize.toLocaleString()}</p>
        ) : (
          <p className="text-ink-dim text-xs mb-1">아쉽지만 시상 순위엔 들지 못했어요.</p>
        )}
        <p className="text-ink-dim text-[11px] mb-4">
          Sit &amp; Go는 리바이가 없어요 — 남은 승부를 관전으로 지켜볼 수 있어요.
        </p>
        <Button
          variant="primary"
          size="md"
          className="w-full"
          onClick={() => setDismissedPlace(me.finishPlace ?? null)}
        >
          👀 관전하기
        </Button>
      </motion.div>
    </div>
  );
}
