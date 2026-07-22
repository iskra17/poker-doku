'use client';

import { useProgressionStore } from '@/lib/store/progression-store';
import {
  THROWABLES,
  getThrowableUnlockHint,
  isThrowableUnlocked,
} from '@/lib/throwables/catalog';

interface ThrowablePickerProps {
  selectedId: string;
  onSelect: (id: string) => void;
}

/**
 * 투척 아이템 선택 패널 — 발사대 아이콘 짧은 탭으로 토글.
 * 잠금 아이템은 회색 + 🔒 + 해금 힌트 (MVP 카탈로그는 전부 스타터라 잠금 없음,
 * 2차에서 도장 레벨/미션 아이템을 카탈로그에 추가하면 그대로 노출된다).
 */
export default function ThrowablePicker({ selectedId, onSelect }: ThrowablePickerProps) {
  const dojoLevel = useProgressionStore(state => state.snapshot?.profile.dojoLevel ?? 1);
  const ctx = { dojoLevel };

  return (
    <div className="rounded-xl border border-purple-500/30 bg-gray-900/95 p-2 shadow-xl backdrop-blur-sm">
      <div className="mb-1.5 px-1 text-[10px] font-bold text-gray-400">던질 아이템</div>
      <div className="grid grid-cols-2 gap-1.5">
        {THROWABLES.map(item => {
          const unlocked = isThrowableUnlocked(item.id, ctx);
          const hint = getThrowableUnlockHint(item.id, ctx);
          const selected = item.id === selectedId;
          return (
            <button
              key={item.id}
              disabled={!unlocked}
              onClick={() => unlocked && onSelect(item.id)}
              className={`flex items-center gap-1.5 rounded-lg border px-2 py-1.5 transition-all active:scale-95 ${
                selected
                  ? 'border-purple-400 bg-purple-600 text-white'
                  : unlocked
                    ? 'border-gray-700/30 bg-gray-800/50 text-gray-200 hover:border-purple-500/40'
                    : 'border-gray-800/40 bg-gray-800/30 text-gray-500'
              }`}
            >
              <span className={`text-lg leading-none ${unlocked ? '' : 'grayscale opacity-60'}`}>
                {item.emoji}
              </span>
              <span className="flex flex-col items-start leading-tight">
                <span className="text-[11px] font-bold">
                  {unlocked ? item.name : `🔒 ${item.name}`}
                </span>
                {hint && <span className="text-[9px] text-gray-500">{hint}</span>}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
