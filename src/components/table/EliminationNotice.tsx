'use client';

import { useState } from 'react';
import { motion } from 'framer-motion';
import { useGameStore } from '@/lib/store/game-store';
import Button from '../ui/Button';

/** 토너먼트 중도 탈락 안내 — 내 순위가 확정되면 1회 표시. */
export default function EliminationNotice({ onLeave }: { onLeave: () => void }) {
  const { gameState, myPlayerId } = useGameStore();
  const [dismissedPlace, setDismissedPlace] = useState<number | null>(null);

  const tournament = gameState?.tournament;
  const me = gameState?.players.find(p => p.id === myPlayerId);
  if (!tournament || tournament.entrants === 0 || tournament.finished) return null;
  if (!me?.finishPlace || me.finishPlace === 1) return null;
  if (dismissedPlace === me.finishPlace) return null;

  const result = tournament.results.find(r => r.playerId === myPlayerId);
  const prize = result?.prize ?? 0;
  const isMtt = !!tournament.tournamentId;

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
          {isMtt
            ? '토너먼트는 프리즈아웃 방식이에요. 로비로 돌아간 뒤 최종 결과는 토너먼트 상세에서 확인할 수 있어요.'
            : 'Sit & Go는 리바이가 없어요 — 남은 승부를 관전으로 지켜볼 수 있어요.'}
        </p>
        <Button
          variant="primary"
          size="md"
          className="w-full"
          onClick={() => {
            if (isMtt) onLeave();
            else setDismissedPlace(me.finishPlace ?? null);
          }}
        >
          {isMtt ? '로비로 돌아가기' : '👀 관전하기'}
        </Button>
      </motion.div>
    </div>
  );
}
