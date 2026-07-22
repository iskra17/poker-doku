'use client';

import { useState } from 'react';
import Modal from '@/components/ui/Modal';
import { useProgressionStore } from '@/lib/store/progression-store';
import {
  THROWABLES,
  getThrowableUnlockHint,
  isThrowableUnlocked,
  type ThrowableDefinition,
} from '@/lib/throwables/catalog';

interface ThrowablePickerProps {
  selectedId: string;
  onSelect: (id: string) => void;
  /** 헤더 ❓ — 사용법 가이드 재열람 */
  onShowGuide: () => void;
}

function ItemIcon({ item, locked, size }: { item: ThrowableDefinition; locked: boolean; size: string }) {
  if (item.sprite) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={item.sprite}
        alt={item.name}
        draggable={false}
        className={`${size} shrink-0 ${locked ? 'grayscale opacity-60' : ''}`}
      />
    );
  }
  return (
    <span className={`text-lg leading-none ${locked ? 'grayscale opacity-60' : ''}`}>
      {item.emoji}
    </span>
  );
}

/**
 * 투척 아이템 선택 패널 — 발사대 아이콘 짧은 탭으로 토글.
 * 잠금 아이템은 🔒+이름만 컴팩트하게 노출하고, 탭하면 해금 방법 안내 모달을 띄운다
 * (힌트를 그리드에 상시 노출하면 화면이 답답해진다는 2026-07-22 유저 피드백).
 */
export default function ThrowablePicker({ selectedId, onSelect, onShowGuide }: ThrowablePickerProps) {
  const dojoLevel = useProgressionStore(state => state.snapshot?.profile.dojoLevel ?? 1);
  const [infoItem, setInfoItem] = useState<ThrowableDefinition | null>(null);
  const ctx = { dojoLevel };

  const infoHint = infoItem ? getThrowableUnlockHint(infoItem.id, ctx) : null;

  return (
    <div className="rounded-xl border border-purple-500/30 bg-gray-900/95 p-2 shadow-xl backdrop-blur-sm">
      <div className="mb-1.5 flex items-center justify-between px-1">
        <span className="text-[10px] font-bold text-gray-400">던질 아이템</span>
        <button
          type="button"
          onClick={onShowGuide}
          aria-label="투척 사용법 보기"
          className="rounded-full border border-gray-700/40 px-1.5 text-[10px] font-bold text-gray-400 hover:border-purple-500/40 hover:text-gray-200"
        >
          ❓ 사용법
        </button>
      </div>
      <div className="grid grid-cols-2 gap-1.5">
        {THROWABLES.map(item => {
          const unlocked = isThrowableUnlocked(item.id, ctx);
          const selected = item.id === selectedId;
          return (
            <button
              key={item.id}
              onClick={() => (unlocked ? onSelect(item.id) : setInfoItem(item))}
              className={`flex items-center gap-1.5 rounded-lg border px-2 py-1.5 transition-all active:scale-95 ${
                selected
                  ? 'border-purple-400 bg-purple-600 text-white'
                  : unlocked
                    ? 'border-gray-700/30 bg-gray-800/50 text-gray-200 hover:border-purple-500/40'
                    : 'border-gray-800/40 bg-gray-800/30 text-gray-500 hover:border-gray-600/50'
              }`}
            >
              <ItemIcon item={item} locked={!unlocked} size="h-6 w-6" />
              <span className="text-[11px] font-bold leading-tight">
                {unlocked ? item.name : `🔒 ${item.name}`}
              </span>
            </button>
          );
        })}
      </div>

      {/* 잠금 아이템 해금 안내 */}
      <Modal
        isOpen={infoItem !== null}
        onClose={() => setInfoItem(null)}
        title={infoItem?.name ?? ''}
        maxWidthClass="max-w-xs"
      >
        {infoItem && (
          <div className="flex flex-col items-center gap-3 pb-1 text-center">
            <span className="grayscale-[35%]">
              <ItemIcon item={infoItem} locked={false} size="h-20 w-20" />
            </span>
            <div className="rounded-xl border border-white/10 bg-white/5 px-3 py-2">
              <p className="text-[11px] font-bold text-blossom">해금 방법</p>
              <p className="mt-0.5 text-sm text-ink">{infoHint}</p>
            </div>
            <p className="text-[11px] leading-snug text-ink-dim">
              {infoItem.unlock.kind === 'coin-shop'
                ? '도장 코인은 게임을 즐기다 보면 모이는 보상이에요. 상점과 함께 곧 열릴 예정!'
                : '조건을 달성하면 자동으로 해금될 예정이에요. 조금만 기다려 주세요!'}
            </p>
          </div>
        )}
      </Modal>
    </div>
  );
}
