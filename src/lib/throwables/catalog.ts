/**
 * 아이템 투척(Throwables) 카탈로그 — 클라이언트(발사 UI/연출)와 서버(throw-item 검증)가
 * 공유하는 단일 소스. computeValidActions와 같은 원칙: 규칙을 양쪽에 각각 구현하지 말 것.
 *
 * 서버는 클라이언트가 보낸 itemId 문자열을 신뢰하지 않고 THROWABLE_MAP으로 조회한다
 * (send-chat의 presetId→문구 원칙과 동일). 미지 id는 해금 판정에서도 항상 false.
 */

export type ThrowableItemId =
  | 'tomato' | 'tissue'
  | 'egg' | 'balloon' | 'bouquet' | 'snowball'
  | 'gold-tomato' | 'fish';

/** 명중 스플랫 연출 스타일 — ThrowableLayer가 아이템별 이펙트를 분기하는 키 */
export type ThrowableSplatStyle = 'burst' | 'wrap';

/**
 * 해금 규칙 (2026-07-22 유저 확정: 미션 2종 + 나머지는 도장 코인 구매).
 * - starter: 기본 제공 2종
 * - mission: 행동 미션 달성 → progression 인벤토리 마커 보유로 판정
 *   (해금 파이프라인 구현 전까지는 잠금 노출만 — 핸드 종료 훅이 조건 감지 시 grant 예정)
 * - coin-shop: 도장 코인으로 구매 → 구매 시 인벤토리 마커 grant로 해금
 *   (도장 코인 재화·상점은 미구현 — 플레이·인연 레벨 보상으로 적립, 추후 캐시 구매 확장 기획)
 */
export type ThrowableUnlockRule =
  | { kind: 'starter' }
  | { kind: 'mission'; inventoryItemId: string; hint: string }
  | { kind: 'coin-shop'; price: number; inventoryItemId: string };

export interface ThrowableDefinition {
  id: ThrowableItemId;
  /** 한국어 표기 이름 — 피커/봇 피격 대사에 사용 */
  name: string;
  /** 발사체 폴백 렌더 (sprite가 null이면 이걸로 그린다) */
  emoji: string;
  /** 투명 스프라이트 경로 (public 기준) — null이면 이모지 폴백 */
  sprite: string | null;
  splat: ThrowableSplatStyle;
  /** 스플랫 파티클 이모지 (burst 조각/wrap 장식) */
  splatEmoji: string;
  unlock: ThrowableUnlockRule;
}

/** 순서 = 피커 노출 순서 */
export const THROWABLES: readonly ThrowableDefinition[] = [
  {
    id: 'tomato',
    name: '토마토',
    emoji: '🍅',
    sprite: '/assets/throwables/tomato.webp',
    splat: 'burst',
    splatEmoji: '🍅',
    unlock: { kind: 'starter' },
  },
  {
    id: 'tissue',
    name: '휴지',
    emoji: '🧻',
    sprite: '/assets/throwables/tissue.webp',
    splat: 'wrap',
    splatEmoji: '🧻',
    unlock: { kind: 'starter' },
  },
  // ── 이하 잠금 아이템 — 해금 파이프라인(미션 감지·도장 코인 상점) 구현 전까지 피커에
  //    잠금+힌트로만 노출된다. 서버 throw-item도 starter 외 거부라 던질 수 없음.
  //    스플랫은 해금 시점에 아이템별 전용 스타일(crack/petals/slap 등)로 확장 예정.
  {
    id: 'egg',
    name: '날계란',
    emoji: '🥚',
    sprite: '/assets/throwables/egg.webp',
    splat: 'burst',
    splatEmoji: '🍳',
    unlock: { kind: 'coin-shop', price: 300, inventoryItemId: 'throwable-egg' },
  },
  {
    id: 'balloon',
    name: '물풍선',
    emoji: '💧',
    sprite: '/assets/throwables/balloon.webp',
    splat: 'burst',
    splatEmoji: '💦',
    unlock: { kind: 'coin-shop', price: 300, inventoryItemId: 'throwable-balloon' },
  },
  {
    id: 'snowball',
    name: '눈뭉치',
    emoji: '❄️',
    sprite: '/assets/throwables/snowball.webp',
    splat: 'burst',
    splatEmoji: '❄️',
    unlock: { kind: 'coin-shop', price: 300, inventoryItemId: 'throwable-snowball' },
  },
  {
    id: 'bouquet',
    name: '꽃다발',
    emoji: '💐',
    sprite: '/assets/throwables/bouquet.webp',
    splat: 'burst',
    splatEmoji: '🌸',
    unlock: { kind: 'coin-shop', price: 500, inventoryItemId: 'throwable-bouquet' },
  },
  {
    id: 'gold-tomato',
    name: '황금 토마토',
    emoji: '🍅',
    sprite: '/assets/throwables/gold-tomato.webp',
    splat: 'burst',
    splatEmoji: '✨',
    unlock: {
      kind: 'mission',
      inventoryItemId: 'throwable-gold-tomato',
      hint: '미션: 프리미엄 핸드(AA/KK)로 패배',
    },
  },
  {
    id: 'fish',
    name: '물고기',
    emoji: '🐟',
    sprite: '/assets/throwables/fish.webp',
    splat: 'burst',
    splatEmoji: '💦',
    unlock: {
      kind: 'mission',
      inventoryItemId: 'throwable-fish',
      hint: '미션: 리버 역전승',
    },
  },
];

/** 서버 검증·수신 방어용 id → 정의 조회. 미지 id는 undefined. */
export const THROWABLE_MAP: Readonly<Record<string, ThrowableDefinition>> = Object.freeze(
  Object.fromEntries(THROWABLES.map(item => [item.id, item])),
);

/** 개인 투척 쿨다운 — 서버가 playerId 단위로 강제, 클라는 카운트다운 표시에 사용 */
export const THROW_COOLDOWN_MS = 10_000;

/** 발사 → 명중까지 비행 시간 (클라 연출·봇 리액션 지연의 동기 상수) */
export const THROW_FLIGHT_MS = 650;

export interface ThrowableUnlockContext {
  dojoLevel: number;
  /** progression 인벤토리 itemId 집합 — 미션 해금 판정용 (미제공 시 미션 아이템은 잠김) */
  inventoryItemIds?: ReadonlySet<string>;
}

/** 이 아이템을 던질 수 있는가 — 미지 id는 항상 false (서버 검증 겸용) */
export function isThrowableUnlocked(itemId: string, ctx: ThrowableUnlockContext): boolean {
  const def = THROWABLE_MAP[itemId];
  if (!def) return false;
  switch (def.unlock.kind) {
    case 'starter':
      return true;
    case 'mission':
    case 'coin-shop':
      // 미션 달성/상점 구매 모두 인벤토리 마커 grant로 해금된다
      return ctx.inventoryItemIds?.has(def.unlock.inventoryItemId) ?? false;
  }
}

/** 피커 잠금 힌트 문구 — 해금된 아이템은 null */
export function getThrowableUnlockHint(itemId: string, ctx: ThrowableUnlockContext): string | null {
  const def = THROWABLE_MAP[itemId];
  if (!def || isThrowableUnlocked(itemId, ctx)) return null;
  switch (def.unlock.kind) {
    case 'starter':
      return null;
    case 'mission':
      return def.unlock.hint;
    case 'coin-shop':
      return `🪙 도장 코인 ${def.unlock.price} (상점 준비 중)`;
  }
}
