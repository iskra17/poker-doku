import type { ProgressionCharacterId, ProgressionEquipmentSlot } from '@/lib/progression/types';

export type CollectionItemKind =
  | 'fragment'
  | 'title'
  | 'frame'
  | 'emote'
  | 'cutin'
  | 'dialogue-pack'
  | 'aura'
  | 'skin';

export type CollectionRewardSource =
  | { readonly kind: 'streak' }
  | { readonly kind: 'dojo-level'; readonly level: number }
  | {
      readonly kind: 'affinity-level';
      readonly characterId: ProgressionCharacterId;
      readonly level: number;
    };

export interface CollectionRendererVariant {
  readonly artSource: 'existing-character-art';
  readonly gradientToken: 'blossom' | 'cyber' | 'mystic' | 'gilded';
  readonly overlay: 'cherry-blossom' | 'starlight';
}

export interface CollectionItemDefinition {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly kind: CollectionItemKind;
  readonly equipSlot: ProgressionEquipmentSlot | null;
  readonly stackable: boolean;
  readonly source: CollectionRewardSource;
  readonly characterId?: ProgressionCharacterId;
  readonly renderer?: CollectionRendererVariant;
  readonly gameplayModifiers: readonly never[];
}

export type DojoRewardItem = CollectionItemDefinition & {
  readonly source: { readonly kind: 'dojo-level'; readonly level: number };
};

export type AffinityRewardItem = CollectionItemDefinition & {
  readonly source: {
    readonly kind: 'affinity-level';
    readonly characterId: ProgressionCharacterId;
    readonly level: number;
  };
};

const NO_GAMEPLAY_MODIFIERS = Object.freeze([]) as readonly never[];

function item(
  definition: Omit<CollectionItemDefinition, 'gameplayModifiers'>,
): CollectionItemDefinition {
  return Object.freeze({
    ...definition,
    source: Object.freeze({ ...definition.source }),
    ...(definition.renderer
      ? { renderer: Object.freeze({ ...definition.renderer }) }
      : {}),
    gameplayModifiers: NO_GAMEPLAY_MODIFIERS,
  });
}

export const STREAK_FRAGMENT_ITEM = item({
  id: 'streak-fragment',
  name: '연속 수련 조각',
  description: '연속 수련 7일마다 받는 수집용 조각입니다.',
  kind: 'fragment',
  equipSlot: null,
  stackable: true,
  source: { kind: 'streak' },
});

const DOJO_REWARDS = [
  item({ id: 'dojo-title-sprout-challenger', name: '새싹 도전자', description: '도장 레벨 2 칭호', kind: 'title', equipSlot: 'title', stackable: false, source: { kind: 'dojo-level', level: 2 } }),
  item({ id: 'dojo-frame-cherry-blossom', name: '벚꽃', description: '도장 레벨 5 프로필 테두리', kind: 'frame', equipSlot: 'frame', stackable: false, source: { kind: 'dojo-level', level: 5 } }),
  item({ id: 'dojo-emote-miyako-cheer', name: '미야코 응원', description: '도장 레벨 10 이모트', kind: 'emote', equipSlot: null, stackable: false, source: { kind: 'dojo-level', level: 10 } }),
  item({ id: 'dojo-title-steady-trainee', name: '꾸준한 수련생', description: '도장 레벨 15 칭호', kind: 'title', equipSlot: 'title', stackable: false, source: { kind: 'dojo-level', level: 15 } }),
  item({ id: 'dojo-frame-clear-sky', name: '청명', description: '도장 레벨 20 프로필 테두리', kind: 'frame', equipSlot: 'frame', stackable: false, source: { kind: 'dojo-level', level: 20 } }),
  item({ id: 'dojo-cutin-focus-lines', name: '집중선', description: '도장 레벨 25 컷인 효과', kind: 'cutin', equipSlot: 'cutin', stackable: false, source: { kind: 'dojo-level', level: 25 } }),
  item({ id: 'dojo-title-advanced-student', name: '도장 상급생', description: '도장 레벨 30 칭호', kind: 'title', equipSlot: 'title', stackable: false, source: { kind: 'dojo-level', level: 30 } }),
  item({ id: 'dojo-frame-golden', name: '금빛', description: '도장 레벨 35 프로필 테두리', kind: 'frame', equipSlot: 'frame', stackable: false, source: { kind: 'dojo-level', level: 35 } }),
  item({ id: 'dojo-cutin-match-moment', name: '승부의 순간', description: '도장 레벨 40 컷인 효과', kind: 'cutin', equipSlot: 'cutin', stackable: false, source: { kind: 'dojo-level', level: 40 } }),
  item({ id: 'dojo-title-battle-tested', name: '백전연마', description: '도장 레벨 45 칭호', kind: 'title', equipSlot: 'title', stackable: false, source: { kind: 'dojo-level', level: 45 } }),
  item({ id: 'dojo-frame-master', name: '도장 사범', description: '도장 레벨 50 프로필 테두리', kind: 'frame', equipSlot: 'frame', stackable: false, source: { kind: 'dojo-level', level: 50 } }),
] as readonly DojoRewardItem[];

const CHARACTER_META: Record<ProgressionCharacterId, {
  name: string;
  gradientToken: CollectionRendererVariant['gradientToken'];
  overlay: CollectionRendererVariant['overlay'];
}> = {
  sakura: { name: '사쿠라', gradientToken: 'blossom', overlay: 'cherry-blossom' },
  ara: { name: '아라', gradientToken: 'cyber', overlay: 'starlight' },
  hana: { name: '하나', gradientToken: 'mystic', overlay: 'cherry-blossom' },
  chloe: { name: '클로이', gradientToken: 'gilded', overlay: 'starlight' },
  vivian: { name: '비비안', gradientToken: 'blossom', overlay: 'starlight' },
  elena: { name: '엘레나', gradientToken: 'mystic', overlay: 'starlight' },
};

const AFFINITY_REWARDS = (Object.entries(CHARACTER_META) as Array<[
  ProgressionCharacterId,
  (typeof CHARACTER_META)[ProgressionCharacterId],
]>).flatMap(([characterId, meta]) => [
  item({ id: `affinity-${characterId}-dialogue-pack`, name: `${meta.name} 대화 꾸러미`, description: `${meta.name} 인연 레벨 5 대화 꾸러미`, kind: 'dialogue-pack', equipSlot: null, stackable: false, characterId, source: { kind: 'affinity-level', characterId, level: 5 } }),
  item({ id: `affinity-${characterId}-aura`, name: `${meta.name} 인연 오라`, description: `${meta.name} 인연 레벨 10 오라`, kind: 'aura', equipSlot: null, stackable: false, characterId, source: { kind: 'affinity-level', characterId, level: 10 } }),
  item({ id: `affinity-${characterId}-cutin`, name: `${meta.name} 인연 컷인`, description: `${meta.name} 인연 레벨 15 컷인`, kind: 'cutin', equipSlot: 'cutin', stackable: false, characterId, source: { kind: 'affinity-level', characterId, level: 15 } }),
  item({
    id: `affinity-${characterId}-skin`,
    name: `${meta.name} 인연 스킨`,
    description: `${meta.name} 인연 레벨 20 스킨`,
    kind: 'skin',
    equipSlot: 'skin',
    stackable: false,
    characterId,
    source: { kind: 'affinity-level', characterId, level: 20 },
    renderer: {
      artSource: 'existing-character-art',
      gradientToken: meta.gradientToken,
      overlay: meta.overlay,
    },
  }),
]) as AffinityRewardItem[];

export const DOJO_REWARD_LEVELS = Object.freeze(
  DOJO_REWARDS.map(reward => reward.source.kind === 'dojo-level'
    ? reward.source.level
    : 0),
);
export const AFFINITY_REWARD_LEVELS = Object.freeze([5, 10, 15, 20]);

export const COLLECTION_CATALOG: readonly CollectionItemDefinition[] =
  Object.freeze([STREAK_FRAGMENT_ITEM, ...DOJO_REWARDS, ...AFFINITY_REWARDS]);

const COLLECTION_ITEMS_BY_ID = new Map(
  COLLECTION_CATALOG.map(definition => [definition.id, definition] as const),
);

export function getCollectionItemDefinition(
  itemId: string,
): CollectionItemDefinition | null {
  return COLLECTION_ITEMS_BY_ID.get(itemId) ?? null;
}

export function getDojoRewardItems(
  previousLevel: number,
  nextLevel: number,
): DojoRewardItem[] {
  return DOJO_REWARDS.filter(reward => (
    reward.source.kind === 'dojo-level'
    && reward.source.level > previousLevel
    && reward.source.level <= nextLevel
  ));
}

export function getAffinityRewardItems(
  characterId: ProgressionCharacterId,
  previousLevel: number,
  nextLevel: number,
): AffinityRewardItem[] {
  return AFFINITY_REWARDS.filter(reward => (
    reward.source.kind === 'affinity-level'
    && reward.source.characterId === characterId
    && reward.source.level > previousLevel
    && reward.source.level <= nextLevel
  ));
}
