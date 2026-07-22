/**
 * 아이템 투척(Throwables) 카탈로그 — 클라이언트(발사 UI/연출)와 서버(throw-item 검증)가
 * 공유하는 단일 소스. computeValidActions와 같은 원칙: 규칙을 양쪽에 각각 구현하지 말 것.
 *
 * 서버는 클라이언트가 보낸 itemId 문자열을 신뢰하지 않고 THROWABLE_MAP으로 조회한다
 * (send-chat의 presetId→문구 원칙과 동일). 미지 id는 해금 판정에서도 항상 false.
 */

export type ThrowableItemId = 'tomato' | 'tissue';

/** 명중 스플랫 연출 스타일 — ThrowableLayer가 아이템별 이펙트를 분기하는 키 */
export type ThrowableSplatStyle = 'burst' | 'wrap';

/**
 * 해금 규칙.
 * - starter: 기본 제공 (MVP 2종)
 * - dojo-level: 도장 레벨 달성 시 해금 (characters/unlocks.ts와 같은 축)
 * - mission: 행동 미션 달성 → progression 인벤토리에 마커 아이템 보유로 판정
 *   (2차 확장: 핸드 종료 훅이 조건 감지 시 inventoryItemId를 grant)
 */
export type ThrowableUnlockRule =
  | { kind: 'starter' }
  | { kind: 'dojo-level'; level: number }
  | { kind: 'mission'; inventoryItemId: string; hint: string };

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
  // 2차 확장 예약 (기획 확정분 — 추가 시 ThrowableItemId union에도 함께):
  //   egg      🥚 crack   dojo-level 3
  //   balloon  💧 burst   dojo-level 6
  //   bouquet  💐 petals  dojo-level 9  (포지티브 — 축하용)
  //   snowball ❄️ burst   dojo-level 12
  //   goldTomato ✨🍅 burst mission 'throwable-mission-premium-loss' (AA/KK로 패배)
  //   fish     🐟 slap    mission 'throwable-mission-river-suckout' (리버 역전승)
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
    case 'dojo-level':
      return Number.isFinite(ctx.dojoLevel) && ctx.dojoLevel >= def.unlock.level;
    case 'mission':
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
    case 'dojo-level':
      return `도장 Lv.${def.unlock.level} 달성`;
    case 'mission':
      return def.unlock.hint;
  }
}
