import { getCollectionItemDefinition } from '@/lib/collection/catalog';

/**
 * 수련 스토리 소스 보상 요약인가 — 결산 화면이 XP·인연 숫자를 이미 보여주므로 로비 필은
 * 도장 레벨업·아이템이 있을 때만 띄우고 나머지는 즉시 소비한다(방 입장 시 낡은 카드가 튀는 문제 방지).
 */
export function isStoryRewardEvent(eventId: string): boolean {
  return eventId.startsWith('story-chapter:') || eventId.startsWith('story-daily-drills:');
}

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
