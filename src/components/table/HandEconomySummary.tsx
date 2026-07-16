'use client';

import { useEffect, useRef, useState } from 'react';
import { onGameEvent } from '@/lib/events/game-events';
import {
  buildHandEconomySummary,
  formatChipDelta,
  isHandEconomySummaryForPlayer,
  type HandEconomySummary as Summary,
} from '@/lib/events/hand-economy-summary';
import { useGameStore } from '@/lib/store/game-store';

export default function HandEconomySummary() {
  const myPlayerId = useGameStore(state => state.myPlayerId);
  const [summary, setSummary] = useState<Summary | null>(null);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const unsubscribe = onGameEvent(event => {
      if (event.type !== 'winners' || !myPlayerId) return;
      const nextSummary = buildHandEconomySummary(event, myPlayerId);
      if (!nextSummary) return;
      if (hideTimer.current) clearTimeout(hideTimer.current);
      setSummary(nextSummary);
      hideTimer.current = setTimeout(() => {
        hideTimer.current = null;
        setSummary(null);
      }, 5_000);
    });
    return () => {
      unsubscribe();
      if (hideTimer.current) clearTimeout(hideTimer.current);
      hideTimer.current = null;
    };
  }, [myPlayerId]);

  if (!summary || !isHandEconomySummaryForPlayer(summary, myPlayerId)) return null;
  return (
    <div className="pointer-events-none absolute left-1/2 top-16 z-30 w-[min(90%,340px)]" style={{ transform: 'translateX(-50%)' }}>
      <div className="rounded-xl border border-mystic/30 bg-panel/95 px-4 py-3 text-center shadow-xl backdrop-blur-sm">
        {summary.economyMode === 'practice' ? (
          <p className="text-sm font-bold text-mystic">연습 게임 · 레이크 없음</p>
        ) : (
          <p className="text-xs text-ink-dim">레이크 {summary.handRake.toLocaleString('ko-KR')}</p>
        )}
        <p className={`mt-1 text-lg font-bold ${summary.delta >= 0 ? 'text-gilded' : 'text-blossom'}`}>
          이번 핸드 {formatChipDelta(summary.delta)}칩
        </p>
        <p className="text-[11px] text-ink-dim">종료 스택 {summary.endingStack.toLocaleString('ko-KR')}</p>
      </div>
    </div>
  );
}
