export interface CollectionItemDefinition {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly kind: 'fragment';
  readonly stackable: boolean;
  readonly gameplayModifiers: readonly never[];
}

const NO_GAMEPLAY_MODIFIERS = Object.freeze([]) as readonly never[];

export const STREAK_FRAGMENT_ITEM: CollectionItemDefinition = Object.freeze({
  id: 'streak-fragment',
  name: '연속 수련 조각',
  description: '연속 수련 7일마다 받는 수집용 조각입니다.',
  kind: 'fragment',
  stackable: true,
  gameplayModifiers: NO_GAMEPLAY_MODIFIERS,
});

export const COLLECTION_CATALOG: readonly CollectionItemDefinition[] =
  Object.freeze([STREAK_FRAGMENT_ITEM]);
