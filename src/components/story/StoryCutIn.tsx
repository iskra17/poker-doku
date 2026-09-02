'use client';

import { useEffect } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import CharacterImage from '@/components/characters/CharacterImage';
import { stripeBg } from '@/components/characters/cut-in-shell';
import { useOutfitId } from '@/lib/hooks/use-outfit';
import { usePrefersReducedMotion } from '@/lib/hooks/use-reduced-motion';
import { useTypewriter } from '@/lib/hooks/use-typewriter';
import type { StoryCutInData } from '@/lib/story/story-cut-ins';

interface StoryCutInProps {
  data: StoryCutInData | null;
  isMobile: boolean;
  /** 표시 시간이 끝나면 부모가 data를 null로 */
  onDone: () => void;
  durationMs?: number;
}

/**
 * 스토리 컷인 — 퍼펙트·미션 클리어·보스 격파. prop 구동(게임 이벤트 구독 없음).
 * 데스크탑은 **우측**에서 슬라이드인, 모바일은 **상단** 시트 — 승자 컷인(좌측/하단)과 동시에 떠도 겹치지 않는다.
 * reduced-motion이면 페이드만. 컨테이너는 부모의 positioned 요소(StoryStage 루트 / 인룸 중앙 컨테이너).
 */
export default function StoryCutIn({ data, isMobile, onDone, durationMs = 3_400 }: StoryCutInProps) {
  const reduced = usePrefersReducedMotion();
  useEffect(() => {
    if (!data) return;
    const timer = setTimeout(onDone, durationMs);
    return () => clearTimeout(timer);
  }, [data, durationMs, onDone]);
  return (
    <AnimatePresence>
      {data && (isMobile ? <MobileShell key={data.id} data={data} reduced={reduced} /> : <DesktopShell key={data.id} data={data} reduced={reduced} />)}
    </AnimatePresence>
  );
}

function Portrait({ data, className }: { data: StoryCutInData; className: string }) {
  const outfitId = useOutfitId(data.artId);
  return <CharacterImage characterId={data.artId} expression={data.expression} round={false} outfitId={outfitId} className={className} />;
}

function DesktopShell({ data, reduced }: { data: StoryCutInData; reduced: boolean }) {
  const { display } = useTypewriter(data.quote, 28);
  return (
    <motion.div
      initial={reduced ? { opacity: 0 } : { x: '110%', opacity: 0 }}
      animate={{ x: 0, opacity: 1 }}
      exit={reduced ? { opacity: 0 } : { x: '110%', opacity: 0 }}
      transition={{ type: 'spring', stiffness: 240, damping: 26 }}
      className="pointer-events-none absolute right-0 top-[38%] z-40 w-[320px] overflow-hidden rounded-l-2xl border-l-4 shadow-2xl"
      style={{ borderColor: data.color, background: stripeBg(data.color), y: '-50%' }}
      role="status"
      aria-label={`${data.kicker} — ${data.name}`}
    >
      <div className="flex items-center gap-3 p-3">
        <div className="h-24 w-24 shrink-0 overflow-hidden rounded-xl">
          <Portrait data={data} className="h-full w-full text-5xl" />
        </div>
        <div className="min-w-0">
          <div className="text-[10px] font-black tracking-[0.2em] text-gilded">{data.kicker}</div>
          <div className="text-lg font-bold" style={{ color: data.color, fontFamily: 'var(--font-display)' }}>{data.name}</div>
          <p className="mt-1 text-xs leading-snug text-ink">{display}</p>
        </div>
      </div>
    </motion.div>
  );
}

function MobileShell({ data, reduced }: { data: StoryCutInData; reduced: boolean }) {
  const { display } = useTypewriter(data.quote, 28);
  return (
    <motion.div
      initial={reduced ? { opacity: 0 } : { y: '-120%', opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      exit={reduced ? { opacity: 0 } : { y: '-120%', opacity: 0 }}
      transition={{ type: 'spring', stiffness: 260, damping: 28 }}
      className="pointer-events-none absolute left-2 right-2 top-2 z-40 overflow-hidden rounded-xl border-l-4 shadow-2xl"
      style={{ borderColor: data.color, background: stripeBg(data.color) }}
      role="status"
      aria-label={`${data.kicker} — ${data.name}`}
    >
      <div className="flex items-center gap-2.5 p-2">
        <div className="h-14 w-14 shrink-0 overflow-hidden rounded-full">
          <Portrait data={data} className="h-full w-full text-2xl" />
        </div>
        <div className="min-w-0">
          <div className="flex items-baseline gap-2">
            <span className="text-[9px] font-black tracking-[0.2em] text-gilded">{data.kicker}</span>
            <span className="text-sm font-bold" style={{ color: data.color, fontFamily: 'var(--font-display)' }}>{data.name}</span>
          </div>
          <p className="truncate text-[11px] leading-snug text-ink">{display}</p>
        </div>
      </div>
    </motion.div>
  );
}
