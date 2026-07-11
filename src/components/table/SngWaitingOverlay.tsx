'use client';

import { motion } from 'framer-motion';
import { useGameStore } from '@/lib/store/game-store';
import { useInviteLink } from '@/lib/hooks/use-invite-link';
import Button from '../ui/Button';

/**
 * Sit & Go 시작 전 대기 패널 — 참가 현황(n/6), 초대 링크, 방장의 '봇 채우고 시작'.
 * 토너먼트가 시작되면(entrants > 0) 사라진다.
 */
export default function SngWaitingOverlay() {
  const { gameState, myPlayerId, currentRoomId, sngFillBots } = useGameStore();
  const { copied, copy } = useInviteLink(currentRoomId);

  const tournament = gameState?.tournament;
  if (!gameState || !tournament || tournament.entrants > 0) return null;

  const seated = gameState.players.length;
  const max = 6;
  const hostSeated = gameState.players.some(p => p.id === gameState.hostId);
  const canFill = myPlayerId === gameState.hostId || !hostSeated;

  return (
    <div className="absolute inset-0 z-20 flex items-center justify-center pointer-events-none">
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        className="pointer-events-auto w-[min(88%,320px)] bg-panel/95 backdrop-blur-sm border border-mystic/30 rounded-2xl p-4 text-center shadow-xl"
      >
        <div className="text-2xl mb-1">🏆</div>
        <h3 className="text-white font-bold text-sm mb-0.5">Sit &amp; Go 대기 중</h3>
        <p className="text-gilded font-bold text-lg tabular mb-1">
          {seated}<span className="text-ink-dim text-sm"> / {max}명</span>
        </p>
        <p className="text-ink-dim text-[11px] mb-3">
          6명이 모이면 자동으로 시작돼요.
        </p>

        <div className="space-y-2">
          <Button variant="secondary" size="sm" className="w-full" onClick={copy}>
            {copied ? '✓ 복사됐어요!' : '🔗 친구 초대 링크 복사'}
          </Button>
          {canFill ? (
            <Button variant="primary" size="sm" className="w-full" onClick={sngFillBots}>
              🤖 남는 자리 봇으로 채우고 시작
            </Button>
          ) : (
            <p className="text-ink-dim/70 text-[10px]">방장이 봇을 채워 바로 시작할 수 있어요.</p>
          )}
        </div>
      </motion.div>
    </div>
  );
}
