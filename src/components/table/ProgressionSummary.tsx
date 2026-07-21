'use client';

import { useEffect } from 'react';
import CharacterImage from '@/components/characters/CharacterImage';
import { getCollectionItemDefinition } from '@/lib/collection/catalog';
import { milliToUiUnits } from '@/lib/progression/balance';
import {
  selectDisplayReward,
  useProgressionStore,
} from '@/lib/store/progression-store';
import { isImportantProgressionItem } from '@/lib/progression/progression-summary';

export default function ProgressionSummary() {
  const summary = useProgressionStore(selectDisplayReward);
  const consumeReward = useProgressionStore(state => state.consumeReward);
  const important = summary?.grantedItemIds.some(isImportantProgressionItem) ?? false;
  useEffect(() => {
    if (!summary) return;
    const timer = setTimeout(() => consumeReward(summary.eventId), important ? 6_000 : 4_000);
    return () => clearTimeout(timer);
  }, [consumeReward, important, summary]);
  if (!summary) return null;

  const granted = summary.grantedItemIds.map(getCollectionItemDefinition).filter(item => item !== null);
  const skinId = granted.find(item => item.kind === 'skin')?.id ?? null;

  // 중요 보상(레벨 마일스톤 아이템)만 카드 연출 — 보드 중앙에 띄워 상단 좌석을 가리지 않는다
  if (important) {
    return (
      <aside aria-live="polite" className="pointer-events-none absolute left-1/2 top-[42%] z-40 w-[min(90%,340px)]" style={{ transform: 'translate(-50%, -50%)' }}>
        <div className="overflow-hidden rounded-xl border border-gilded/50 bg-panel/95 p-4 shadow-xl backdrop-blur-sm">
          <CharacterImage characterId={summary.characterId} expression="happy" round={false} skinId={skinId} className="mb-3 h-24 w-full text-4xl" />
          <p className="text-sm font-bold text-mystic">수련 XP +{milliToUiUnits(summary.dojoXpMilli)}</p>
          <p className="text-[11px] text-ink-dim">인연 XP +{milliToUiUnits(summary.affinityMilli)}</p>
          {summary.missionCompletions.length > 0 && <p className="mt-1 text-xs text-gilded">과제 {summary.missionCompletions.length}개 완료 · 자동 수령</p>}
          {summary.streak && <p className="mt-1 text-xs text-blossom">연속 수련 {summary.streak.currentStreak}일{summary.streak.restPassUsed ? ' · 휴식권 사용' : ''}</p>}
          {granted.length > 0 && <p className="mt-2 text-xs font-bold text-gilded">새 아이템: {granted.map(item => item.name).join(', ')}</p>}
        </div>
      </aside>
    );
  }

  // 일반 보상 — 슬림 1줄 필 (상단 좌석 가림 방지, HandEconomySummary와 같은 슬롯을 순차 사용)
  return (
    <aside aria-live="polite" className="pointer-events-none absolute left-1/2 top-1 z-40 max-w-[92%]" style={{ transform: 'translateX(-50%)' }}>
      <div className="flex items-baseline gap-2 whitespace-nowrap rounded-full border border-white/10 bg-panel/45 px-3.5 py-1 backdrop-blur-[2px]">
        <span className="text-xs font-bold text-mystic">수련 XP +{milliToUiUnits(summary.dojoXpMilli)}</span>
        <span className="text-[10px] text-ink-dim">
          인연 +{milliToUiUnits(summary.affinityMilli)}
          {summary.missionCompletions.length > 0 && ` · 과제 ${summary.missionCompletions.length}개`}
          {summary.streak && ` · 연속 ${summary.streak.currentStreak}일`}
          {granted.length > 0 && ` · ${granted.map(item => item.name).join(', ')}`}
        </span>
      </div>
    </aside>
  );
}
