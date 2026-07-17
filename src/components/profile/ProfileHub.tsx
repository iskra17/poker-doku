'use client';

import { useId, useRef, useState, type KeyboardEvent } from 'react';
import AffinityTab from './AffinityTab';
import InventoryTab from './InventoryTab';
import ProgressionTab from './ProgressionTab';
import RecordsTab from './RecordsTab';
import RecoveryPanel from './RecoveryPanel';
import { useProgressionStore } from '@/lib/store/progression-store';
import {
  isProfileTabNavigationKey,
  nextProfileTabIndex,
  PROFILE_TABS,
  type ProfileTab,
} from './profile-tabs';

export default function ProfileHub() {
  const [tab, setTab] = useState<ProfileTab>('성장');
  const tabGroupId = useId();
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const action = useProgressionStore(state => state.action);
  const error = useProgressionStore(state => state.error);
  return (
    <section aria-label="프로필 허브">
      <div role="tablist" aria-label="프로필 메뉴" className="mb-4 grid grid-cols-5 gap-1">
        {PROFILE_TABS.map((value, index) => (
          <button
            key={value}
            ref={element => { tabRefs.current[index] = element; }}
            id={`${tabGroupId}-tab-${index}`}
            type="button"
            role="tab"
            aria-selected={tab === value}
            aria-controls={`${tabGroupId}-panel-${index}`}
            tabIndex={tab === value ? 0 : -1}
            onClick={() => setTab(value)}
            onKeyDown={(event: KeyboardEvent<HTMLButtonElement>) => {
              if (!isProfileTabNavigationKey(event.key)) return;
              event.preventDefault();
              const nextIndex = nextProfileTabIndex(index, event.key);
              setTab(PROFILE_TABS[nextIndex]);
              tabRefs.current[nextIndex]?.focus();
            }}
            className={`rounded-lg px-1 py-2 text-[11px] font-bold ${tab === value ? 'bg-blossom/15 text-blossom' : 'bg-elevated/50 text-ink-dim'}`}
          >
            {value}
          </button>
        ))}
      </div>
      <div
        id={`${tabGroupId}-panel-${PROFILE_TABS.indexOf(tab)}`}
        role="tabpanel"
        aria-labelledby={`${tabGroupId}-tab-${PROFILE_TABS.indexOf(tab)}`}
        tabIndex={0}
      >
        {tab === '성장' ? <ProgressionTab /> : tab === '인연' ? <AffinityTab /> : tab === '보관함' ? <InventoryTab /> : tab === '기록' ? <RecordsTab /> : <RecoveryPanel />}
      </div>
      {action && <p role="status" className="mt-3 text-center text-xs text-mystic">성장 정보를 처리하는 중…</p>}
      {error && <p role="alert" className="mt-3 text-center text-xs text-blossom">{error}</p>}
    </section>
  );
}
