import type { ProgressionCharacterId, ProgressionEquipmentSlot } from '@/lib/progression/types';

export type CollectionItemKind =
  | 'fragment'
  | 'title'
  | 'frame'
  | 'emblem'
  | 'emote'
  | 'cutin'
  | 'dialogue-pack'
  | 'aura'
  | 'trophy'
  | 'skin';

export type ArenaSeasonRewardKey =
  | 'participation-emblem'
  | 'gold-frame'
  | 'diamond-featured-skin'
  | 'master-cutin'
  | 'top100-chroma'
  | 'top100-title'
  | `rank-${1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10}-title`
  | 'champion-trophy'
  | 'champion-aura';

export type CollectionRewardSource =
  | { readonly kind: 'streak' }
  | { readonly kind: 'dojo-level'; readonly level: number }
  | {
      readonly kind: 'affinity-level';
      readonly characterId: ProgressionCharacterId;
      readonly level: number;
    }
  | {
      readonly kind: 'arena-season';
      readonly seasonId: string;
      readonly rewardKey: ArenaSeasonRewardKey;
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

export type StaticCollectionItemDefinition = CollectionItemDefinition & {
  readonly source: Exclude<
    CollectionRewardSource,
    { readonly kind: 'arena-season' }
  >;
};

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

export type ArenaSeasonRewardItem = CollectionItemDefinition & {
  readonly source: {
    readonly kind: 'arena-season';
    readonly seasonId: string;
    readonly rewardKey: ArenaSeasonRewardKey;
  };
};

const NO_GAMEPLAY_MODIFIERS = Object.freeze([]) as readonly never[];
const ARENA_SEASON_ID_PATTERN = /^arena-v1-(0|[1-9]\d*)$/;
const ARENA_SEASON_ITEM_ID_PATTERN =
  /^(arena-v1-(?:0|[1-9]\d*))-(participation-emblem|gold-frame|diamond-featured-skin|master-cutin|top100-chroma|top100-title|rank-(?:[1-9]|10)-title|champion-trophy|champion-aura)$/;

function item<TSource extends CollectionRewardSource>(
  definition: Omit<
    CollectionItemDefinition,
    'source' | 'gameplayModifiers'
  > & { readonly source: TSource },
): CollectionItemDefinition & { readonly source: TSource } {
  return Object.freeze({
    ...definition,
    source: Object.freeze({ ...definition.source }),
    ...(definition.renderer
      ? { renderer: Object.freeze({ ...definition.renderer }) }
      : {}),
    gameplayModifiers: NO_GAMEPLAY_MODIFIERS,
  }) as CollectionItemDefinition & { readonly source: TSource };
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
  item({ id: `affinity-${characterId}-dialogue-pack`, name: `${meta.name} 대사 꾸러미`, description: `${meta.name} 인연 레벨 5 대사 꾸러미`, kind: 'dialogue-pack', equipSlot: null, stackable: false, characterId, source: { kind: 'affinity-level', characterId, level: 5 } }),
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

const ARENA_FEATURED_CHARACTERS =
  Object.freeze(Object.keys(CHARACTER_META) as ProgressionCharacterId[]);
const ARENA_SEASON_REWARDS = new Map<
  string,
  readonly ArenaSeasonRewardItem[]
>();

export const DOJO_REWARD_LEVELS = Object.freeze(
  DOJO_REWARDS.map(reward => reward.source.kind === 'dojo-level'
    ? reward.source.level
    : 0),
);
export const AFFINITY_REWARD_LEVELS = Object.freeze([5, 10, 15, 20]);

export const COLLECTION_CATALOG: readonly StaticCollectionItemDefinition[] =
  Object.freeze([STREAK_FRAGMENT_ITEM, ...DOJO_REWARDS, ...AFFINITY_REWARDS]);

const COLLECTION_ITEMS_BY_ID = new Map(
  COLLECTION_CATALOG.map(definition => [definition.id, definition] as const),
);

export function getCollectionItemDefinition(
  itemId: string,
): CollectionItemDefinition | null {
  const staticItem = COLLECTION_ITEMS_BY_ID.get(itemId);
  if (staticItem) return staticItem;
  const match = ARENA_SEASON_ITEM_ID_PATTERN.exec(itemId);
  if (!match) return null;
  return getArenaSeasonRewardItems(match[1])
    .find(definition => definition.id === itemId) ?? null;
}

export function getArenaSeasonRewardItems(
  seasonId: string,
): readonly ArenaSeasonRewardItem[] {
  const match = ARENA_SEASON_ID_PATTERN.exec(seasonId);
  if (!match) throw new Error('ARENA_SEASON_CATALOG_INVALID');
  const ordinal = Number(match[1]);
  if (!Number.isSafeInteger(ordinal)) {
    throw new Error('ARENA_SEASON_CATALOG_INVALID');
  }
  const cached = ARENA_SEASON_REWARDS.get(seasonId);
  if (cached) return cached;

  const characterId =
    ARENA_FEATURED_CHARACTERS[ordinal % ARENA_FEATURED_CHARACTERS.length];
  const meta = CHARACTER_META[characterId];
  const reward = (
    rewardKey: ArenaSeasonRewardKey,
    definition: Omit<
      CollectionItemDefinition,
      'id' | 'source' | 'gameplayModifiers'
    >,
  ): ArenaSeasonRewardItem => item({
    ...definition,
    id: `${seasonId}-${rewardKey}`,
    source: { kind: 'arena-season', seasonId, rewardKey },
  }) as ArenaSeasonRewardItem;
  const skinRenderer = {
    artSource: 'existing-character-art' as const,
    gradientToken: meta.gradientToken,
    overlay: meta.overlay,
  };
  const definitions: ArenaSeasonRewardItem[] = [
    reward('participation-emblem', {
      name: '시즌 참가 엠블럼',
      description: '공식 경기 10회 참가를 기념하는 시즌 엠블럼',
      kind: 'emblem',
      equipSlot: null,
      stackable: false,
    }),
    reward('gold-frame', {
      name: '골드 시즌 프레임',
      description: '골드 이상으로 시즌을 마친 플레이어의 프로필 프레임',
      kind: 'frame',
      equipSlot: 'frame',
      stackable: false,
    }),
    reward('diamond-featured-skin', {
      name: `${meta.name} 시즌 다이아 스킨`,
      description: '다이아 이상으로 시즌을 마친 플레이어의 대표 스킨',
      kind: 'skin',
      equipSlot: 'skin',
      stackable: false,
      characterId,
      renderer: skinRenderer,
    }),
    reward('master-cutin', {
      name: '마스터 시즌 컷인',
      description: '마스터로 시즌을 마친 플레이어의 전용 컷인',
      kind: 'cutin',
      equipSlot: 'cutin',
      stackable: false,
    }),
    reward('top100-chroma', {
      name: `${meta.name} TOP 100 크로마`,
      description: '시즌 글로벌 상위 100명의 희귀 색상 변형',
      kind: 'skin',
      equipSlot: 'skin',
      stackable: false,
      characterId,
      renderer: skinRenderer,
    }),
    reward('top100-title', {
      name: 'TOP 100',
      description: '시즌 글로벌 상위 100명 영구 칭호',
      kind: 'title',
      equipSlot: 'title',
      stackable: false,
    }),
    ...Array.from({ length: 10 }, (_, index) => {
      const rank = (index + 1) as 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10;
      return reward(`rank-${rank}-title`, {
        name: `시즌 ${rank}위`,
        description: `시즌 글로벌 최종 ${rank}위 영구 칭호`,
        kind: 'title',
        equipSlot: 'title',
        stackable: false,
      });
    }),
    reward('champion-trophy', {
      name: '시즌 챔피언 트로피',
      description: '시즌 글로벌 1위 영구 트로피',
      kind: 'trophy',
      equipSlot: null,
      stackable: false,
    }),
    reward('champion-aura', {
      name: '시즌 챔피언 오라',
      description: '시즌 글로벌 1위 전용 오라',
      kind: 'aura',
      equipSlot: null,
      stackable: false,
    }),
  ];
  const frozen = Object.freeze(definitions);
  ARENA_SEASON_REWARDS.set(seasonId, frozen);
  return frozen;
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
