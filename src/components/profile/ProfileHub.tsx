'use client';

import { useState } from 'react';
import AffinityTab from './AffinityTab';
import InventoryTab from './InventoryTab';
import ProgressionTab from './ProgressionTab';
import RecordsTab from './RecordsTab';
import RecoveryPanel from './RecoveryPanel';
import { useProgressionStore } from '@/lib/store/progression-store';

const TABS = ['성장', '인연', '보관함', '기록', '복구'] as const;
type Tab = typeof TABS[number];

export default function ProfileHub() {
  const [tab, setTab] = useState<Tab>('성장');
  const action = useProgressionStore(state => state.action);
  const error = useProgressionStore(state => state.error);
  return (
    <section aria-label="프로필 허브">
      <div role="tablist" aria-label="프로필 메뉴" className="mb-4 grid grid-cols-5 gap-1">
        {TABS.map(value => (
          <button key={value} type="button" role="tab" aria-selected={tab === value} onClick={() => setTab(value)} className={`rounded-lg px-1 py-2 text-[11px] font-bold ${tab === value ? 'bg-blossom/15 text-blossom' : 'bg-elevated/50 text-ink-dim'}`}>{value}</button>
        ))}
      </div>
      <div role="tabpanel">
        {tab === '성장' ? <ProgressionTab /> : tab === '인연' ? <AffinityTab /> : tab === '보관함' ? <InventoryTab /> : tab === '기록' ? <RecordsTab /> : <RecoveryPanel />}
      </div>
      {action && <p role="status" className="mt-3 text-center text-xs text-mystic">성장 정보를 처리하는 중…</p>}
      {error && <p role="alert" className="mt-3 text-center text-xs text-blossom">{error}</p>}
    </section>
  );
}
