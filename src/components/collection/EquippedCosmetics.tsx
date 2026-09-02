import { getCollectionItemDefinition } from '@/lib/collection/catalog';
import { resolveTitle } from '@/lib/cosmetics/titles';
import type { ProgressionEquipmentSlot } from '@/lib/progression/types';
import TitlePlate from '@/components/cosmetics/TitlePlate';

interface EquippedCosmeticsProps {
  slot: ProgressionEquipmentSlot;
  itemId: string | null;
  className?: string;
}

/**
 * 장착 코스메틱 렌더 — 좌석 등 "남에게 보이는" 자리.
 * 칭호는 `resolveTitle`(컬렉션 + 수련 스토리 카탈로그)로 해석해 SVG 플레이트를 그린다 — 컬렉션만 보던 시절엔
 * 장착한 스토리 칭호(백띠 수련생)가 좌석에서 통째로 사라졌다(2026-09-03). 그 외 슬롯은 이름 텍스트.
 */
export default function EquippedCosmetics({
  slot, itemId, className = '',
}: EquippedCosmeticsProps) {
  if (!itemId) return null;
  if (slot === 'title') {
    const title = resolveTitle(itemId);
    if (!title) return null;
    return (
      <span className={`flex justify-center ${className}`} data-cosmetic-slot={slot}>
        <TitlePlate title={title} size="xs" />
      </span>
    );
  }
  const item = getCollectionItemDefinition(itemId);
  if (!item || item.equipSlot !== slot) return null;
  return (
    <span className={className} data-cosmetic-slot={slot}>
      {item.name}
    </span>
  );
}
