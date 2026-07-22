'use client';

import { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { onGameEvent } from '@/lib/events/game-events';
import { getCharacterById } from '@/lib/characters';
import { useTypewriter } from '@/lib/hooks/use-typewriter';
import { useChipFormatter } from '@/lib/hooks/use-chip-format';
import CharacterImage from './CharacterImage';

/**
 * 패배 리액션 컷인 — 쇼다운에서 진 봇 캐릭터가 왼쪽에서 슬라이드인 (sad 표정 + loseQuote).
 * WinnerCutIn(같은 왼쪽, top 38%)과 세로 스택(여긴 top 62%)으로 짝을 이루며 살짝 늦게 등장.
 */

interface CutInData {
  characterId: string;
  name: string;
  quote: string;
  color: string;
  amount: number; // 잃은 기여금
}

export default function LoserCutIn({ isMobile }: { isMobile: boolean }) {
  const [data, setData] = useState<CutInData | null>(null);
  const timersRef = useRef<ReturnType<typeof setTimeout>[]>([]);

  useEffect(() => {
    const unsubscribe = onGameEvent(event => {
      if (event.type === 'hand-start') {
        timersRef.current.forEach(clearTimeout);
        timersRef.current = [];
        setData(null);
        return;
      }
      if (event.type !== 'winners' || event.winners.length === 0) return;
      // 쇼다운까지 간 핸드만 (폴드 승리는 패자 연출 없음)
      if (!event.winners.some(w => w.hand)) return;

      const winnerIds = new Set(event.winners.map(w => w.playerId));
      // 쇼다운 생존자 중 승자가 아닌 봇 — 가장 많이 잃은(기여금 큰) 쪽이 주인공
      const losers = event.players.filter(
        p => !winnerIds.has(p.id)
          && (p.status === 'active' || p.status === 'all-in')
          && p.type === 'bot' && p.personalityId,
      );
      if (losers.length === 0) return;
      const loser = losers.reduce((a, b) => (b.totalContributed > a.totalContributed ? b : a));
      if (loser.totalContributed <= 0) return;

      const character = getCharacterById(loser.personalityId!);
      if (!character) return;

      const cutIn: CutInData = {
        characterId: character.id,
        name: character.name,
        quote: character.loseQuote,
        color: character.color,
        amount: loser.totalContributed,
      };

      timersRef.current.forEach(clearTimeout);
      timersRef.current = [
        setTimeout(() => setData(cutIn), 2400), // 승자 컷인(1.6s)보다 살짝 늦게
        setTimeout(() => setData(null), 5400),
      ];
    });

    return () => {
      unsubscribe();
      timersRef.current.forEach(clearTimeout);
    };
  }, []);

  return (
    <AnimatePresence>
      {data && (isMobile ? <MobileLoserChip data={data} /> : <DesktopLoserCutIn data={data} />)}
    </AnimatePresence>
  );
}

function loserBg(color: string): string {
  return `repeating-linear-gradient(245deg, ${color}14 0 14px, ${color}08 14px 28px), linear-gradient(245deg, rgba(18,12,30,0.97), rgba(12,9,24,0.92))`;
}

function DesktopLoserCutIn({ data }: { data: CutInData }) {
  const { display } = useTypewriter(data.quote, 28);
  const formatChips = useChipFormatter();
  return (
    <motion.div
      initial={{ x: '-110%', opacity: 0 }}
      animate={{ x: 0, opacity: 1 }}
      exit={{ x: '-110%', opacity: 0 }}
      transition={{ type: 'spring', stiffness: 240, damping: 26 }}
      className="absolute left-0 top-[62%] z-40 w-[300px] overflow-hidden rounded-r-2xl border-r-4 shadow-2xl pointer-events-none"
      style={{ borderColor: data.color, background: loserBg(data.color), y: '-50%' }}
    >
      <div className="flex items-center gap-3 p-3">
        <div className="w-20 h-20 shrink-0 grayscale-[35%]">
          <CharacterImage characterId={data.characterId} expression="sad" round={false} className="w-full h-full text-4xl" />
        </div>
        <div className="min-w-0">
          <div
            className="text-base font-bold opacity-90"
            style={{ color: data.color, fontFamily: 'var(--font-display)' }}
          >
            {data.name}
          </div>
          <div className="text-red-400/90 text-xs font-bold tabular">-{formatChips(data.amount)}</div>
          <p className="text-ink-dim text-xs mt-1 leading-snug">{display}</p>
        </div>
      </div>
    </motion.div>
  );
}

/** 모바일 — 좌상단 컴팩트 칩 (승자 컷인이 하단을 쓰므로 겹치지 않게) */
function MobileLoserChip({ data }: { data: CutInData }) {
  const formatChips = useChipFormatter();
  return (
    <motion.div
      initial={{ x: -80, opacity: 0 }}
      animate={{ x: 0, opacity: 1 }}
      exit={{ x: -80, opacity: 0 }}
      transition={{ type: 'spring', stiffness: 260, damping: 26 }}
      className="absolute left-2 top-12 z-40 flex items-center gap-2 rounded-full border pr-3 pl-1 py-1 shadow-lg pointer-events-none"
      style={{ borderColor: `${data.color}66`, background: 'rgba(14,10,26,0.92)' }}
    >
      <div className="w-8 h-8 shrink-0 rounded-full overflow-hidden grayscale-[35%]">
        <CharacterImage characterId={data.characterId} expression="sad" round className="w-full h-full text-base" />
      </div>
      <div className="leading-tight">
        <span className="block text-[10px] font-bold opacity-90" style={{ color: data.color }}>
          {data.name}
        </span>
        <span className="block text-[9px] text-red-400/90 font-bold tabular">
          -{formatChips(data.amount)}
        </span>
      </div>
    </motion.div>
  );
}
