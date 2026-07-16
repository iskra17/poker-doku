'use client';

import { getCollectionItemDefinition } from '@/lib/collection/catalog';
import type { ProgressionEquipmentSlot } from '@/lib/progression/types';
import { useProgressionStore } from '@/lib/store/progression-store';

export default function InventoryTab() {
  const snapshot = useProgressionStore(state => state.snapshot);
  const action = useProgressionStore(state => state.action);
  const setEquipment = useProgressionStore(state => state.setEquipment);
  if (!snapshot) return null;
  if (snapshot.inventory.length === 0) return <p className="text-xs text-ink-dim">아직 보관한 꾸미기 아이템이 없어요.</p>;
  return (
    <div className="space-y-2">
      {snapshot.inventory.map(owned => {
        const item = getCollectionItemDefinition(owned.itemId);
        if (!item) return null;
        const slot = item.equipSlot;
        const equipped = slot !== null && snapshot.equipment[slot] === item.id;
        const wrongSkin = item.kind === 'skin' && item.characterId !== snapshot.profile.selectedCharacterId;
        return (
          <article key={item.id} className="flex items-center justify-between gap-3 rounded-xl border border-mystic/20 bg-elevated/50 p-3">
            <div className="min-w-0">
              <h3 className="truncate text-xs font-bold text-ink">{item.name}{owned.quantity > 1 ? ` ×${owned.quantity}` : ''}</h3>
              <p className="text-[10px] text-ink-dim">{item.description}</p>
            </div>
            {slot && (
              <button
                type="button"
                disabled={action !== null || wrongSkin}
                aria-pressed={equipped}
                onClick={() => void setEquipment(slot as ProgressionEquipmentSlot, equipped ? null : item.id)}
                className="shrink-0 rounded-lg border border-blossom/30 px-2 py-1 text-[10px] font-bold text-blossom disabled:opacity-40"
              >
                {wrongSkin ? '캐릭터 전용' : equipped ? '해제' : '장착'}
              </button>
            )}
          </article>
        );
      })}
    </div>
  );
}
