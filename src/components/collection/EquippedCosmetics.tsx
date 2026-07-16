import { getCollectionItemDefinition } from '@/lib/collection/catalog';
import type { ProgressionEquipmentSlot } from '@/lib/progression/types';

interface EquippedCosmeticsProps {
  slot: ProgressionEquipmentSlot;
  itemId: string | null;
  className?: string;
}

export default function EquippedCosmetics({
  slot, itemId, className = '',
}: EquippedCosmeticsProps) {
  if (!itemId) return null;
  const item = getCollectionItemDefinition(itemId);
  if (!item || item.equipSlot !== slot) return null;
  return (
    <span className={className} data-cosmetic-slot={slot}>
      {item.name}
    </span>
  );
}
