'use client';

import { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useGameStore } from '@/lib/store/game-store';
import { getCharacterById } from '@/lib/characters';
import { getLayout, toDisplayIndex } from '../table/table-layout';

/**
 * 봇 좌석 말풍선 — 봇 채팅 메시지를 해당 좌석 옆에 3초간 표시.
 * 채팅 패널과 병행 (놓친 메시지는 채팅에서 확인 가능).
 */

interface Bubble {
  id: string;
  /** 회전 적용된 디스플레이 슬롯 인덱스 */
  displaySeatIndex: number;
  name: string;
  message: string;
  color: string;
}

interface SeatSpeechBubblesProps {
  isMobile: boolean;
}

export default function SeatSpeechBubbles({ isMobile }: SeatSpeechBubblesProps) {
  const [bubble, setBubble] = useState<Bubble | null>(null);
  const lastIdRef = useRef<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    // zustand 스토어 구독 (외부 시스템 콜백에서만 setState)
    const unsubscribe = useGameStore.subscribe(state => {
      const last = state.chatMessages[state.chatMessages.length - 1];
      if (!last || last.type !== 'bot' || last.id === lastIdRef.current) return;
      lastIdRef.current = last.id;

      const player = state.gameState?.players.find(p => p.id === last.playerId);
      if (!player) return; // 딜러 멘트는 DealerCorner 담당

      const character = getCharacterById(player.personalityId || '');
      const mySeat = state.gameState?.players.find(p => p.id === state.myPlayerId)?.seatIndex ?? -1;
      setBubble({
        id: last.id,
        displaySeatIndex: toDisplayIndex(player.seatIndex, mySeat),
        name: player.name,
        message: last.message,
        color: character?.color || '#A78BFA',
      });

      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => {
        setBubble(b => (b?.id === last.id ? null : b));
      }, 3000);
    });

    return () => {
      unsubscribe();
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  const layout = getLayout();
  const seatPos = bubble ? layout.seats[bubble.displaySeatIndex] : null;
  // 좌/우 가장자리 좌석은 말풍선이 화면 밖으로 잘리지 않게 정렬을 클램프
  const seatXPct = seatPos ? parseFloat(seatPos.x) : 50;
  const bubbleX = seatXPct < 25 ? '-12%' : seatXPct > 75 ? '-88%' : '-50%';
  const tailLeft = seatXPct < 25 ? '12%' : seatXPct > 75 ? '88%' : '50%';

  return (
    <div className="absolute inset-0 pointer-events-none z-30">
      <AnimatePresence>
        {bubble && seatPos && (
          <motion.div
            key={bubble.id}
            initial={{ opacity: 0, y: 8, scale: 0.85 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, scale: 0.9 }}
            className="absolute max-w-[160px] w-max"
            style={{
              left: seatPos.x,
              top: seatPos.y,
              x: bubbleX,
              y: isMobile ? '-135%' : '-145%',
            }}
          >
            <div
              className="relative bg-panel/95 backdrop-blur-sm rounded-xl px-2.5 py-1.5 border shadow-lg"
              style={{ borderColor: `${bubble.color}66` }}
            >
              <div className="text-[9px] font-bold mb-0.5" style={{ color: bubble.color }}>
                {bubble.name}
              </div>
              <p className="text-ink text-[11px] leading-snug">{bubble.message}</p>
              {/* 꼬리 — 좌석 앵커를 향하도록 클램프와 함께 이동 */}
              <div
                className="absolute -bottom-1.5 -translate-x-1/2 w-3 h-3 rotate-45 bg-panel/95 border-r border-b"
                style={{ borderColor: `${bubble.color}66`, left: tailLeft }}
              />
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
