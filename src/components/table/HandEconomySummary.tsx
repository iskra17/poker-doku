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
import { useProgressionStore } from '@/lib/store/progression-store';

export default function HandEconomySummary() {
  const myPlayerId = useGameStore(state => state.myPlayerId);
  const [summary, setSummary] = useState<Summary | null>(null);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const unsubscribe = onGameEvent(event => {
      if (event.type === 'hand-start') {
        if (hideTimer.current) clearTimeout(hideTimer.current);
        hideTimer.current = null;
        setSummary(null);
        useProgressionStore.getState().setEconomySummaryActive(false);
        return;
      }
      if (event.type !== 'winners' || !myPlayerId) return;
      const nextSummary = buildHandEconomySummary(event, myPlayerId);
      if (!nextSummary || event.economyMode === 'practice') {
        useProgressionStore.getState().setEconomySummaryActive(false);
        return;
      }
      if (hideTimer.current) clearTimeout(hideTimer.current);
      useProgressionStore.getState().setEconomySummaryActive(true);
      setSummary(nextSummary);
      hideTimer.current = setTimeout(() => {
        hideTimer.current = null;
        setSummary(null);
        useProgressionStore.getState().setEconomySummaryActive(false);
      }, 5_000);
    });
    return () => {
      unsubscribe();
      if (hideTimer.current) clearTimeout(hideTimer.current);
      hideTimer.current = null;
      useProgressionStore.getState().setEconomySummaryActive(false);
    };
  }, [myPlayerId]);

  if (!summary || !isHandEconomySummaryForPlayer(summary, myPlayerId)) return null;
  // 슬림 1줄 필 — 상단 좌석(y 15%)을 가리지 않게 최상단에 얇고 투명하게 (2026-07-22 가림 개선)
  return (
    <div className="pointer-events-none absolute left-1/2 top-1 z-30 max-w-[92%]" style={{ transform: 'translateX(-50%)' }}>
      <div className="flex items-baseline gap-2 whitespace-nowrap rounded-full border border-white/10 bg-panel/45 px-3.5 py-1 backdrop-blur-[2px]">
        <span className={`text-sm font-bold ${summary.delta >= 0 ? 'text-gilded' : 'text-blossom'}`}>
          이번 핸드 {formatChipDelta(summary.delta)}칩
        </span>
        <span className="text-[10px] text-ink-dim">
          레이크 {summary.handRake.toLocaleString('ko-KR')} · 스택 {summary.endingStack.toLocaleString('ko-KR')}
        </span>
      </div>
    </div>
  );
}
