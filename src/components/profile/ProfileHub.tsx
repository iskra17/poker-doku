'use client';

import { useId, useRef, useState, type KeyboardEvent } from 'react';
import AffinityTab from './AffinityTab';
import CharacterTab from './CharacterTab';
import InventoryTab from './InventoryTab';
import ProgressionTab from './ProgressionTab';
import RecordsTab from './RecordsTab';
import RecoveryPanel from './RecoveryPanel';
import { useProgressionStore } from '@/lib/store/progression-store';
import { resolveTitle, TITLE_TIER_LABEL } from '@/lib/cosmetics/titles';
import TitlePlate from '@/components/cosmetics/TitlePlate';
import {
  isProfileTabNavigationKey,
  nextProfileTabIndex,
  PROFILE_TABS,
  type ProfileTab,
} from './profile-tabs';

/** 내 칭호 한 줄 — 장착 플레이트 + [칭호 바꾸기](보관함 탭). 어디에도 "내 칭호"가 안 보이던 공백을 메운다(2026-09-03). */
function ProfileTitleBar({ onChange }: { onChange: () => void }) {
  const titleId = useProgressionStore(state => state.snapshot?.equipment.title ?? null);
  const title = resolveTitle(titleId);
  return (
    <div className="mb-3 flex items-center justify-between gap-2 rounded-xl border border-mystic/20 bg-elevated/40 px-3 py-2" aria-label="내 칭호">
      <div className="flex min-w-0 items-center gap-2">
        <span className="text-[10px] font-bold tracking-wider text-ink-dim">내 칭호</span>
        {title
          ? <><TitlePlate title={title} size="sm" /><span className="text-[10px] text-ink-dim">{TITLE_TIER_LABEL[title.tier]}</span></>
          : <span className="text-[11px] text-ink-dim">칭호 없음 — 수련·도장 레벨로 얻어요</span>}
      </div>
      <button type="button" onClick={onChange} className="shrink-0 rounded-lg border border-blossom/30 px-2 py-1 text-[10px] font-bold text-blossom">
        칭호 바꾸기
      </button>
    </div>
  );
}

export default function ProfileHub() {
  const [tab, setTab] = useState<ProfileTab>('성장');
  const tabGroupId = useId();
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const action = useProgressionStore(state => state.action);
  const error = useProgressionStore(state => state.error);
  return (
    <section aria-label="프로필 허브">
      <ProfileTitleBar onChange={() => setTab('보관함')} />
      <div role="tablist" aria-label="프로필 메뉴" className="mb-4 grid grid-cols-6 gap-1">
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
        {tab === '성장' ? <ProgressionTab /> : tab === '아바타' ? <CharacterTab /> : tab === '인연' ? <AffinityTab /> : tab === '보관함' ? <InventoryTab /> : tab === '기록' ? <RecordsTab /> : <RecoveryPanel />}
      </div>
      {action && <p role="status" className="mt-3 text-center text-xs text-mystic">성장 정보를 처리하는 중…</p>}
      {error && <p role="alert" className="mt-3 text-center text-xs text-blossom">{error}</p>}
    </section>
  );
}
