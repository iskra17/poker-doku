'use client';

import { useProgressionStore } from '@/lib/store/progression-store';

export default function RecordsTab() {
  const counters = useProgressionStore(state => state.snapshot?.profile ?? null);
  if (!counters) return null;
  const records = [
    ['완료한 전체 핸드', counters.completedHands],
    ['캐시 핸드', counters.cashHands],
    ['연습 핸드', counters.practiceHandsTotal],
    ['Sit & Go 완료', counters.sngCompletions],
    ['최고 연속 수련', `${counters.bestStreak}일`],
  ] as const;
  return <dl className="space-y-2">{records.map(([label, value]) => <div key={label} className="flex justify-between rounded-xl border border-mystic/20 bg-elevated/50 px-3 py-2"><dt className="text-xs text-ink-dim">{label}</dt><dd className="text-xs font-bold text-ink">{typeof value === 'number' ? value.toLocaleString('ko-KR') : value}</dd></div>)}</dl>;
}
