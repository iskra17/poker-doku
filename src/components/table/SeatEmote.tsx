'use client';

import { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { onGameEvent } from '@/lib/events/game-events';

/**
 * 좌석 이모트 버스트 — 승리/패배/올인 순간 아바타 위로 이모지가 떠오르는 짧은 연출.
 * (setState는 이벤트 콜백/타이머에서만 — react-hooks 순수성 규칙 준수)
 */

interface Emote {
  emoji: string;
  key: number;
}

let emoteKey = 1;

export default function SeatEmote({ playerId }: { playerId: string }) {
  const [emote, setEmote] = useState<Emote | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const show = (emoji: string, ms = 1800) => {
      if (timerRef.current) clearTimeout(timerRef.current);
      setEmote({ emoji, key: emoteKey++ });
      timerRef.current = setTimeout(() => setEmote(null), ms);
    };

    const unsubscribe = onGameEvent(event => {
      switch (event.type) {
        case 'action':
          if (event.playerId === playerId && event.actionType === 'all-in') {
            show('🔥', 2200);
          }
          break;
        case 'winners': {
          if (event.winners.some(w => w.playerId === playerId)) {
            show('🎉', 2600);
          } else {
            const p = event.players.find(pl => pl.id === playerId);
            if (p && (p.status === 'active' || p.status === 'all-in')) {
              show('💧', 2200); // 쇼다운 패배
            }
          }
          break;
        }
        case 'throwable-impact':
          if (event.targetPlayerId === playerId) {
            show('😵', 2000); // 투척물 명중 — 머리 위 별
          }
          break;
        case 'hand-start':
          if (timerRef.current) clearTimeout(timerRef.current);
          setEmote(null);
          break;
      }
    });

    return () => {
      unsubscribe();
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [playerId]);

  return (
    <AnimatePresence>
      {emote && (
        <motion.div
          key={emote.key}
          initial={{ opacity: 0, y: 4, scale: 0.5 }}
          animate={{ opacity: [0, 1, 1, 0], y: -26, scale: [0.5, 1.25, 1, 0.9] }}
          exit={{ opacity: 0 }}
          transition={{ duration: 1.6, ease: 'easeOut' }}
          className="absolute left-1/2 -top-5 z-40 text-xl pointer-events-none"
          style={{ x: '-50%' }}
        >
          {emote.emoji}
        </motion.div>
      )}
    </AnimatePresence>
  );
}
