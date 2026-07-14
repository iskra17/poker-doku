/**
 * 캐릭터 일러스트 에셋 매니페스트.
 * 이미지가 없어도 이모지 fallback으로 동작한다 — 아트를 추가하면 여기만 갱신하면 됨.
 * 서빙 포맷은 WebP (Codex 생성 원본 PNG를 640px/q82로 변환 — 장당 ~350KB→~40KB).
 */

export type Expression = 'neutral' | 'happy' | 'sad' | 'thinking' | 'confident' | 'surprised';

// 캐릭터 id → 아트 폴더 (딜러는 miyako 폴더 사용)
const ART_FOLDERS: Record<string, string> = {
  dealer: 'miyako',
  sakura: 'sakura',
  ryuka: 'ryuka',
  hana: 'hana',
  yuki: 'yuki',
  akira: 'akira',
  // reika: 아트 미생성 — 이모지 fallback 사용 중. 일러스트 생성 후 'reika' 폴더 추가할 것
  // (2026-07-14 기준 Codex gpt-image 403 / Gemini 무료티어 이미지 쿼터 0으로 생성 보류)
};

// 보유 중인 표정 (MVP 3종 — thinking/confident/surprised는 확장 시 추가)
const AVAILABLE: Record<string, Expression[]> = {
  miyako: ['neutral', 'happy', 'sad'],
  sakura: ['neutral', 'happy', 'sad'],
  ryuka: ['neutral', 'happy', 'sad'],
  hana: ['neutral', 'happy', 'sad'],
  yuki: ['neutral', 'happy', 'sad'],
  akira: ['neutral', 'happy', 'sad'],
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
