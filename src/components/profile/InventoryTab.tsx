'use client';

import { getCollectionItemDefinition } from '@/lib/collection/catalog';
import type { ProgressionEquipmentSlot } from '@/lib/progression/types';
import { getStoryRewardDefinition, type StoryRewardDefinition } from '@/lib/story/rewards/catalog';
import { getCharacterById } from '@/lib/characters';
import { useProgressionStore } from '@/lib/store/progression-store';

const STORY_KIND_LABEL: Record<StoryRewardDefinition['kind'], string> = {
  title: '칭호',
  'card-back': '카드백',
  felt: '펠트',
  outfit: '의상',
  cg: '이벤트 CG',
  throwable: '투척',
  chips: '칩',
};

/**
 * 보관함 — 컬렉션 아이템(기존 장착 슬롯) + 수련 스토리 보상(카드백·펠트는 여기서 장착,
 * 의상·CG는 인연 탭 옷장/갤러리로 안내). 소유 판정은 progression 인벤토리가 소스.
 */
export default function InventoryTab() {
  const snapshot = useProgressionStore(state => state.snapshot);
  const action = useProgressionStore(state => state.action);
  const setEquipment = useProgressionStore(state => state.setEquipment);
  const setCosmetic = useProgressionStore(state => state.setCosmetic);
  if (!snapshot) return null;
  if (snapshot.inventory.length === 0) return <p className="text-xs text-ink-dim">아직 보관한 꾸미기 아이템이 없어요.</p>;
  const { cosmetics } = snapshot;
  return (
    <div className="space-y-2">
      {snapshot.inventory.map(owned => {
        const item = getCollectionItemDefinition(owned.itemId);
        if (item) {
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
        }

        const story = getStoryRewardDefinition(owned.itemId);
        if (!story) return null;
        let control: React.ReactNode = null;
        if (story.kind === 'card-back' || story.kind === 'felt') {
          const slot = story.kind;
          const equipped = (slot === 'card-back' ? cosmetics.cardBack : cosmetics.felt) === story.id;
          control = (
            <button
              type="button"
              disabled={action !== null}
              aria-pressed={equipped}
              onClick={() => void setCosmetic(slot, equipped ? null : story.id)}
              className="shrink-0 rounded-lg border border-blossom/30 px-2 py-1 text-[10px] font-bold text-blossom disabled:opacity-40"
            >
              {equipped ? '해제' : '장착'}
            </button>
          );
        } else if (story.kind === 'title') {
          const equipped = snapshot.equipment.title === story.id;
          control = (
            <button
              type="button"
              disabled={action !== null}
              aria-pressed={equipped}
              onClick={() => void setEquipment('title', equipped ? null : story.id)}
              className="shrink-0 rounded-lg border border-blossom/30 px-2 py-1 text-[10px] font-bold text-blossom disabled:opacity-40"
            >
              {equipped ? '해제' : '장착'}
            </button>
          );
        } else if (story.kind === 'outfit') {
          const heroine = story.characterId ? getCharacterById(story.characterId)?.name ?? story.characterId : '';
          control = <span className="shrink-0 text-[10px] text-ink-dim">인연 탭 · {heroine} 옷장</span>;
        } else if (story.kind === 'cg') {
          control = <span className="shrink-0 text-[10px] text-ink-dim">인연 탭 갤러리</span>;
        }
        return (
          <article key={story.id} className="flex items-center justify-between gap-3 rounded-xl border border-gilded/25 bg-elevated/50 p-3">
            <div className="min-w-0">
              <h3 className="truncate text-xs font-bold text-ink">
                <span className="mr-1 rounded bg-gilded/15 px-1 py-0.5 text-[9px] text-gilded">수련 · {STORY_KIND_LABEL[story.kind]}</span>
                {story.name}
              </h3>
              <p className="text-[10px] text-ink-dim">{story.description}</p>
            </div>
            {control}
          </article>
        );
      })}
    </div>
  );
}
