'use client';

import { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { onGameEvent } from '@/lib/events/game-events';
import { DEALER_CHARACTER } from '@/lib/characters';
import { useTypewriter } from '@/lib/hooks/use-typewriter';

/**
 * VN 스타일 딜러 대사창 — 테이블 상단 슬림 스트립.
 * 스트리트 진행/승자 발표에 맞춰 미야코의 멘트를 타이핑 효과로 표시. 4초 후 자동 퇴장.
 * pointer-events 없음 — 게임플레이를 가리지 않는다.
 */

export default function DialogueBox() {
  const [line, setLine] = useState<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const show = (text: string, ms = 4000) => {
      if (timerRef.current) clearTimeout(timerRef.current);
      setLine(text);
      timerRef.current = setTimeout(() => setLine(null), ms);
    };

    const unsubscribe = onGameEvent(event => {
      const lines = DEALER_CHARACTER.chatMessages;
      switch (event.type) {
        case 'hand-start':
          show(lines[0]);
          break;
        case 'street-dealt':
          if (event.street === 'flop') show(lines[1]);
          else if (event.street === 'turn') show(lines[2]);
          else if (event.street === 'river') show(lines[3]);
          break;
        case 'showdown-reveal':
          show(lines[4], 3000);
          break;
        case 'winners': {
          const name = event.players.find(p => p.id === event.winners[0]?.playerId)?.name;
          if (name) show(`${name}님, 축하드려요♪ 멋진 승부였어요.`, 5000);
          break;
        }
      }
    });

    return () => {
      unsubscribe();
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  return (
    <div className="absolute top-1 left-1/2 -translate-x-1/2 z-30 pointer-events-none w-[min(92%,480px)]">
      <AnimatePresence>
        {line && <DialogueLine key={line} text={line} />}
      </AnimatePresence>
    </div>
  );
}

function DialogueLine({ text }: { text: string }) {
  const { display } = useTypewriter(text, 24);

  return (
    <motion.div
      initial={{ opacity: 0, y: -12 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -12 }}
      className="flex items-center gap-0 drop-shadow-lg"
    >
      {/* 이름표 플레이트 */}
      <div
        className="shrink-0 px-2.5 py-1 rounded-l-lg text-[11px] font-bold text-black"
        style={{
          background: 'linear-gradient(135deg, #FFD76A, #E8B33A)',
          fontFamily: 'var(--font-display)',
        }}
      >
        {DEALER_CHARACTER.nameJp} {DEALER_CHARACTER.name}
      </div>
      {/* 본문 */}
      <div className="flex-1 bg-panel/90 backdrop-blur-sm border border-gilded/25 rounded-r-lg px-3 py-1 min-h-[26px]">
        <p className="text-ink text-xs leading-relaxed">
          {display}
          <span className="animate-pulse text-gilded">▏</span>
        </p>
      </div>
    </motion.div>
  );
}
