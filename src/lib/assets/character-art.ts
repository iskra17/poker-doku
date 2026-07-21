/**
 * 캐릭터 일러스트 에셋 매니페스트.
 * 이미지가 없어도 이모지 fallback으로 동작한다 — 아트를 추가하면 여기만 갱신하면 됨.
 * 서빙 포맷은 WebP (Codex 생성 원본 PNG를 512px/q82로 변환 — 장당 ~350KB→~40KB).
 */

export type Expression = 'neutral' | 'happy' | 'sad' | 'thinking' | 'confident' | 'surprised';

// 캐릭터 id → 아트 폴더 (딜러는 miyako 폴더 사용)
// 2026-07 로스터 개편: 기존 일러스트를 새 정체성에 재사용 (ryuka→ara, yuki→chloe, akira→vivian, reika→elena)
const ART_FOLDERS: Record<string, string> = {
  dealer: 'miyako',
  sakura: 'sakura',
  ara: 'ara',
  hana: 'hana',
  chloe: 'chloe',
  vivian: 'vivian',
  elena: 'elena',
  // 2026-07 로스터 확장 (마스코트 7 + 인간 3)
  mochi: 'mochi',
  choco: 'choco',
  luna: 'luna',
  gumi: 'gumi',
  paeng: 'paeng',
  draco: 'draco',
  kapi: 'kapi',
  yuzuki: 'yuzuki',
  lin: 'lin',
  ingrid: 'ingrid',
};

// 보유 중인 표정 (MVP 3종 — thinking/confident/surprised는 확장 시 추가)
const AVAILABLE: Record<string, Expression[]> = {
  miyako: ['neutral', 'happy', 'sad'],
  sakura: ['neutral', 'happy', 'sad'],
  ara: ['neutral', 'happy', 'sad'],
  hana: ['neutral', 'happy', 'sad'],
  chloe: ['neutral', 'happy', 'sad'],
  vivian: ['neutral', 'happy', 'sad'],
  elena: ['neutral', 'happy', 'sad'],
  mochi: ['neutral', 'happy', 'sad'],
  choco: ['neutral', 'happy', 'sad'],
  luna: ['neutral', 'happy', 'sad'],
  gumi: ['neutral', 'happy', 'sad'],
  paeng: ['neutral', 'happy', 'sad'],
  draco: ['neutral', 'happy', 'sad'],
  kapi: ['neutral', 'happy', 'sad'],
  yuzuki: ['neutral', 'happy', 'sad'],
  lin: ['neutral', 'happy', 'sad'],
  ingrid: ['neutral', 'happy', 'sad'],
};

// 미보유 표정 → 유사 표정 강등
const EXPRESSION_FALLBACK: Record<Expression, Expression> = {
  neutral: 'neutral',
  happy: 'happy',
  sad: 'sad',
  thinking: 'neutral',
  confident: 'happy',
  surprised: 'happy',
};

export function getCharacterArt(characterId: string, expression: Expression = 'neutral'): string | null {
  const folder = ART_FOLDERS[characterId];
  if (!folder) return null;
  const available = AVAILABLE[folder];
  if (!available || available.length === 0) return null;
  const resolved = available.includes(expression) ? expression : EXPRESSION_FALLBACK[expression];
  if (!available.includes(resolved)) return null;
  return `/assets/characters/${folder}/${resolved}.webp`;
}

// 쇼케이스(상반신 포즈, 640x960 투명 webp) 보유 캐릭터 — 프로필 클릭 연출용.
// 전 캐릭터 보유 (2026-07-22 생성). 새 캐릭터 추가 시 showcase.webp도 함께 생성할 것.
const SHOWCASE_AVAILABLE: ReadonlySet<string> = new Set(Object.keys(AVAILABLE));

/** 쇼케이스 일러스트 — 없으면 null (호출부는 버스트업 폴백) */
export function getCharacterShowcaseArt(characterId: string): string | null {
  const folder = ART_FOLDERS[characterId];
  if (!folder || !SHOWCASE_AVAILABLE.has(folder)) return null;
  return `/assets/characters/${folder}/showcase.webp`;
}
