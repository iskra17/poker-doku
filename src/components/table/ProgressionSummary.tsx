'use client';

import { useEffect } from 'react';
import CharacterImage from '@/components/characters/CharacterImage';
import { getCollectionItemDefinition } from '@/lib/collection/catalog';
import { milliToUiUnits } from '@/lib/progression/balance';
import { useProgressionStore } from '@/lib/store/progression-store';

export default function ProgressionSummary() {
  const summary = useProgressionStore(state => state.activeReward);
  const consumeReward = useProgressionStore(state => state.consumeReward);
  useEffect(() => {
    if (!summary) return;
    const timer = setTimeout(() => consumeReward(summary.eventId), summary.grantedItemIds.length > 0 ? 6_000 : 4_000);
    return () => clearTimeout(timer);
  }, [consumeReward, summary]);
  if (!summary) return null;

  const granted = summary.grantedItemIds.map(getCollectionItemDefinition).filter(item => item !== null);
  const skinId = granted.find(item => item.kind === 'skin')?.id ?? null;
  const important = granted.length > 0;
  return (
    <aside aria-live="polite" className={`pointer-events-none absolute left-1/2 z-40 w-[min(90%,340px)] ${important ? 'top-28' : 'top-16'}`} style={{ transform: 'translateX(-50%)' }}>
      <div className={`overflow-hidden rounded-xl border bg-panel/95 shadow-xl backdrop-blur-sm ${important ? 'border-gilded/50 p-4' : 'border-mystic/30 px-3 py-2'}`}>
        {important && <CharacterImage characterId={summary.characterId} expression="happy" round={false} skinId={skinId} className="mb-3 h-24 w-full text-4xl" />}
        <p className="text-sm font-bold text-mystic">수련 XP +{milliToUiUnits(summary.dojoXpMilli)}</p>
        <p className="text-[11px] text-ink-dim">인연 XP +{milliToUiUnits(summary.affinityMilli)}</p>
        {summary.missionCompletions.length > 0 && <p className="mt-1 text-xs text-gilded">과제 {summary.missionCompletions.length}개 완료 · 자동 수령</p>}
        {summary.streak && <p className="mt-1 text-xs text-blossom">연속 수련 {summary.streak.currentStreak}일{summary.streak.restPassUsed ? ' · 휴식권 사용' : ''}</p>}
        {granted.length > 0 && <p className="mt-2 text-xs font-bold text-gilded">새 아이템: {granted.map(item => item.name).join(', ')}</p>}
      </div>
    </aside>
  );
}
