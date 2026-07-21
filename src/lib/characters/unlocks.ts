/**
 * 캐릭터 해금 규칙 — 클라이언트(온보딩/프로필)와 서버(profile-manager)가 공유하는 단일 소스.
 *
 * - 스타터 6명: 온보딩(프로필 생성)에서 바로 선택 가능.
 * - 신규 10명(2026-07 로스터 확장): 도장 레벨 달성으로 해금 — 프로필 아바타 변경으로 사용.
 *   (인연 파트너 시스템은 DB 제약상 스타터 6명 유지 — 아바타 해금과 별개 축)
 *
 * 주의: 캐릭터 로스터(characters/index.ts)에 캐릭터를 추가하면 여기 해금 규칙도 함께
 * 추가해야 한다 — unlocks.test.ts가 로스터 전체 커버리지를 검증한다.
 */

export const STARTER_CHARACTER_IDS = [
  'sakura',
  'ara',
  'hana',
  'chloe',
  'vivian',
  'elena',
] as const;

const STARTER_SET: ReadonlySet<string> = new Set(STARTER_CHARACTER_IDS);

/** 신규 캐릭터 id → 해금에 필요한 도장 레벨 (달성 시 아바타로 선택 가능) */
export const CHARACTER_UNLOCK_DOJO_LEVELS: Readonly<Record<string, number>> = Object.freeze({
  choco: 3,
  mochi: 5,
  kapi: 7,
  luna: 9,
  draco: 12,
  paeng: 15,
  gumi: 18,
  yuzuki: 22,
  lin: 26,
  ingrid: 30,
});

export function isStarterCharacter(characterId: string): boolean {
  return STARTER_SET.has(characterId);
}

/** 해금에 필요한 도장 레벨 — 스타터는 null(항상 해금), 미지 id는 undefined */
export function getCharacterUnlockLevel(characterId: string): number | null | undefined {
  if (STARTER_SET.has(characterId)) return null;
  return CHARACTER_UNLOCK_DOJO_LEVELS[characterId];
}

/** 이 도장 레벨에서 캐릭터를 아바타로 쓸 수 있는가 — 미지 id는 항상 false */
export function isCharacterUnlocked(characterId: string, dojoLevel: number): boolean {
  if (STARTER_SET.has(characterId)) return true;
  const required = CHARACTER_UNLOCK_DOJO_LEVELS[characterId];
  return required !== undefined && Number.isFinite(dojoLevel) && dojoLevel >= required;
}

/** 아바타로 선택 가능한(로스터에 존재하는) 캐릭터인가 — 해금 여부와 무관 */
export function isSelectableCharacter(characterId: string): boolean {
  return STARTER_SET.has(characterId)
    || CHARACTER_UNLOCK_DOJO_LEVELS[characterId] !== undefined;
}
