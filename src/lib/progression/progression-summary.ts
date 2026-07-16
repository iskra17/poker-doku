import { getCollectionItemDefinition } from '@/lib/collection/catalog';

export function isImportantProgressionItem(itemId: string): boolean {
  const item = getCollectionItemDefinition(itemId);
  return item !== null
    && !item.stackable
    && item.equipSlot !== null
    && (item.kind === 'title'
      || item.kind === 'frame'
      || item.kind === 'skin'
      || item.kind === 'cutin');
}
