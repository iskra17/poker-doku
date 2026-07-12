'use client';

import { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { onGameEvent } from '@/lib/events/game-events';
import { DEALER_CHARACTER } from '@/lib/characters';
import { useTypewriter } from '@/lib/hooks/use-typewriter';
import { useSettingsStore } from '@/lib/store/settings-store';
import CharacterImage from './CharacterImage';

/**
 * 우상단 딜러 코너 — 미야코 아바타 + 게임 진행 말풍선 한 덩어리.
 * 테이블 컬럼 우상단에 상주하고, 말풍선은 아바타 왼쪽으로 전개된다.
 * 설정에서 아바타/말풍선을 개별 숨김 가능. pointer-events 없음.
 */
export default function DealerCorner() {
  const showAvatar = useSettingsStore(s => s.showDealerAvatar);
  const showBubble = useSettingsStore(s => s.showDealerBubble);
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

  if (!showAvatar && !showBubble) return null;

  const dealer = DEALER_CHARACTER;

  return (
    <div className="absolute top-1 right-1 z-30 pointer-events-none flex items-start justify-end gap-1.5">
      {/* 말풍선 — 아바타 왼쪽으로 전개 */}
      {showBubble && (
        <AnimatePresence>
          {line && <DealerBubble key={line} text={line} />}
        </AnimatePresence>
      )}

      {/* 아바타 + 이름표 */}
      {showAvatar && (
        <motion.div
          animate={{ y: [0, -3, 0] }}
          transition={{ duration: 3, repeat: Infinity, ease: 'easeInOut' }}
          className="relative shrink-0"
        >
          <div
            className="w-12 h-12 rounded-full border-2 shadow-lg"
            style={{
              borderColor: `${dealer.color}80`,
              boxShadow: `0 0 20px ${dealer.color}30`,
            }}
          >
            <CharacterImage characterId="dealer" round className="w-full h-full text-2xl" />
          </div>
          <div className="absolute -bottom-1 left-1/2 -translate-x-1/2 text-[9px] font-bold text-gilded whitespace-nowrap bg-black/60 px-1.5 py-0.5 rounded-full">
            {dealer.name}
          </div>
        </motion.div>
      )}
    </div>
  );
}

function DealerBubble({ text }: { text: string }) {
  const { display } = useTypewriter(text, 24);

  return (
    <motion.div
      initial={{ opacity: 0, x: 8, scale: 0.9 }}
      animate={{ opacity: 1, x: 0, scale: 1 }}
      exit={{ opacity: 0, scale: 0.9 }}
      className="max-w-[240px] mt-1"
    >
      <div className="bg-panel/95 backdrop-blur-sm rounded-xl rounded-tr-sm px-2.5 py-1.5 border border-gilded/40 shadow-lg">
        <div className="text-[9px] font-bold mb-0.5 text-gilded" style={{ fontFamily: 'var(--font-display)' }}>
          딜러 (미야코)
        </div>
        <p className="text-ink text-[11px] leading-snug">
          {display}
          <span className="animate-pulse text-gilded">▏</span>
        </p>
      </div>
    </motion.div>
  );
}
