'use client';

import { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { onGameEvent } from '@/lib/events/game-events';
import { getCharacterById } from '@/lib/characters';
import { useTypewriter } from '@/lib/hooks/use-typewriter';
import { useChipFormatter } from '@/lib/hooks/use-chip-format';
import CharacterImage from './CharacterImage';
import { useGameStore } from '@/lib/store/game-store';
import { useProgressionStore } from '@/lib/store/progression-store';

/**
 * 갸루게식 승리 컷인 — winners 이벤트 1.6초 후 슬라이드인, ~3.4초에 아웃.
 * 봇 승자: 해당 캐릭터 버스트업 + winQuote / 휴먼 승자: 미야코의 축하.
 * 데스크탑은 왼쪽(액션 로그 아래) 슬라이드인 — LoserCutIn과 세로 스택 (38%/62%).
 */

interface CutInData {
  characterId: string;
  name: string;
  quote: string;
  color: string;
  amount: number;
  cutinId: string | null;
}

interface WinnerCutInProps {
  isMobile: boolean;
}

export default function WinnerCutIn({ isMobile }: WinnerCutInProps) {
  const [data, setData] = useState<CutInData | null>(null);
  const timersRef = useRef<ReturnType<typeof setTimeout>[]>([]);
  const myPlayerId = useGameStore(state => state.myPlayerId);
  const equippedCutin = useProgressionStore(state => state.snapshot?.equipment.cutin ?? null);

  useEffect(() => {
    const unsubscribe = onGameEvent(event => {
      if (event.type === 'hand-start') {
        timersRef.current.forEach(clearTimeout);
        timersRef.current = [];
        setData(null);
        return;
      }
      if (event.type !== 'winners' || event.winners.length === 0) return;

      const top = event.winners.reduce((a, b) => (b.amount > a.amount ? b : a));
      const player = event.players.find(p => p.id === top.playerId);
      if (!player) return;

      let cutIn: CutInData;
      if (player.type === 'bot' && player.personalityId) {
        const character = getCharacterById(player.personalityId);
        if (!character) return;
        cutIn = {
          characterId: character.id,
          name: character.name,
          quote: character.winQuote,
          color: character.color,
          amount: top.amount,
          cutinId: null,
        };
      } else {
        // 휴먼 승자 → 미야코가 축하
        cutIn = {
          characterId: 'dealer',
          name: player.name,
          quote: `${player.name}님의 승리예요! 정말 대단해요♪`,
          color: '#FFD700',
          amount: top.amount,
          cutinId: player.id === myPlayerId ? equippedCutin : null,
        };
      }

      timersRef.current.forEach(clearTimeout);
      timersRef.current = [
        setTimeout(() => setData(cutIn), 1600),
        setTimeout(() => setData(null), 5000),
      ];
    });

    return () => {
      unsubscribe();
      timersRef.current.forEach(clearTimeout);
    };
  }, [equippedCutin, myPlayerId]);

  return (
    <AnimatePresence>
      {data && (isMobile ? <MobileCutIn data={data} /> : <DesktopCutIn data={data} />)}
    </AnimatePresence>
  );
}

/** 사선 스트라이프 배경 */
function stripeBg(color: string): string {
  return `repeating-linear-gradient(115deg, ${color}22 0 14px, ${color}0d 14px 28px), linear-gradient(115deg, rgba(21,12,38,0.97), rgba(30,18,53,0.92))`;
}

function DesktopCutIn({ data }: { data: CutInData }) {
  const { display } = useTypewriter(data.quote, 28);
  const formatChips = useChipFormatter();
  // 왼쪽(액션 로그 아래)에서 슬라이드인 — 패배 컷인(top-[62%])과 세로 스택으로 짝을 이룬다
  return (
    <motion.div
      initial={{ x: '-110%', opacity: 0 }}
      animate={{ x: 0, opacity: 1 }}
      exit={{ x: '-110%', opacity: 0 }}
      transition={{ type: 'spring', stiffness: 240, damping: 26 }}
      className={`absolute left-0 top-[38%] z-40 w-[320px] overflow-hidden rounded-r-2xl border-r-4 shadow-2xl pointer-events-none ${data.cutinId ? 'ring-2 ring-gilded/60' : ''}`}
      style={{ borderColor: data.color, background: stripeBg(data.color), y: '-50%' }}
    >
      <div className="flex items-center gap-3 p-3">
        <div className="w-24 h-24 shrink-0">
          <CharacterImage characterId={data.characterId} expression="happy" round={false} className="w-full h-full text-5xl" />
        </div>
        <div className="min-w-0">
          <div
            className="text-lg font-bold"
            style={{ color: data.color, fontFamily: 'var(--font-display)' }}
          >
            {data.name}
          </div>
          <div className="text-gilded text-xs font-bold tabular">+{formatChips(data.amount)}</div>
          <p className="text-ink text-xs mt-1 leading-snug">{display}</p>
        </div>
      </div>
    </motion.div>
  );
}

function MobileCutIn({ data }: { data: CutInData }) {
  const { display } = useTypewriter(data.quote, 28);
  const formatChips = useChipFormatter();
  return (
    <motion.div
      initial={{ y: '120%', opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      exit={{ y: '120%', opacity: 0 }}
      transition={{ type: 'spring', stiffness: 260, damping: 28 }}
      className={`absolute left-2 right-2 bottom-2 z-40 overflow-hidden rounded-xl border-l-4 shadow-2xl pointer-events-none ${data.cutinId ? 'ring-2 ring-gilded/60' : ''}`}
      style={{ borderColor: data.color, background: stripeBg(data.color) }}
    >
      <div className="flex items-center gap-2.5 p-2">
        <div className="w-14 h-14 shrink-0 rounded-full overflow-hidden">
          <CharacterImage characterId={data.characterId} expression="happy" round className="w-full h-full text-2xl" />
        </div>
        <div className="min-w-0">
          <div className="flex items-baseline gap-2">
            <span className="text-sm font-bold" style={{ color: data.color, fontFamily: 'var(--font-display)' }}>
              {data.name}
            </span>
            <span className="text-gilded text-[11px] font-bold tabular">+{formatChips(data.amount)}</span>
          </div>
          <p className="text-ink text-[11px] leading-snug truncate">{display}</p>
        </div>
      </div>
    </motion.div>
  );
}
