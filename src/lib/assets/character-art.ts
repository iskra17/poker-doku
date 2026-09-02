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

// 보유 중인 표정 — 스타터 6명은 6종 풀세트(2026-07-22 확장), 나머지는 3종
// (thinking/confident/surprised 미보유 캐릭터는 EXPRESSION_FALLBACK으로 강등)
const AVAILABLE: Record<string, Expression[]> = {
  miyako: ['neutral', 'happy', 'sad', 'thinking', 'confident', 'surprised'],
  sakura: ['neutral', 'happy', 'sad', 'thinking', 'confident', 'surprised'],
  ara: ['neutral', 'happy', 'sad', 'thinking', 'confident', 'surprised'],
  hana: ['neutral', 'happy', 'sad', 'thinking', 'confident', 'surprised'],
  chloe: ['neutral', 'happy', 'sad', 'thinking', 'confident', 'surprised'],
  vivian: ['neutral', 'happy', 'sad', 'thinking', 'confident', 'surprised'],
  elena: ['neutral', 'happy', 'sad', 'thinking', 'confident', 'surprised'],
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

/**
 * 의상(코스튬) 축 — 폴더별 `의상 id → 보유 표정`. 파일은 `<folder>/outfits/<outfitId>/<expr>.webp`(512²).
 * **아트가 실제로 배치된 의상만** 여기 올린다(없는 파일을 가리키면 CharacterImage가 이모지로 강등된다).
 * 보상 카탈로그(`story/rewards/catalog.ts`)의 outfit 항목은 이 매니페스트 없이도 지급·장착되며, 아트가 오기 전엔 기본 의상으로 보인다.
 */
export type OutfitManifest = Record<string, Record<string, readonly Expression[]>>;

const OUTFITS: OutfitManifest = {
  sakura: { dojo: ['neutral', 'happy', 'confident'] },
  hana: { lab: ['neutral', 'happy', 'confident'] },
  ara: { jersey: ['neutral', 'happy', 'confident'] },
  chloe: { stream: ['neutral', 'happy', 'confident'] },
};

interface ArtManifest {
  available: Record<string, readonly Expression[]>;
  outfits: OutfitManifest;
}

/**
 * 아트 경로 해석 — 의상+표정 → 의상+표정폴백 → 의상 neutral → 기본 의상 체인(의상 연속성 > 표정 정확성).
 * 매니페스트 주입은 테스트용; 런타임은 `getCharacterArt`가 모듈 매니페스트로 호출한다.
 */
export function resolveCharacterArt(
  manifest: ArtManifest,
  folder: string,
  expression: Expression,
  outfitId: string | null,
): string | null {
  if (outfitId) {
    const expressions = manifest.outfits[folder]?.[outfitId];
    if (expressions && expressions.length > 0) {
      const candidates: Expression[] = [expression, EXPRESSION_FALLBACK[expression], 'neutral'];
      const hit = candidates.find(candidate => expressions.includes(candidate));
      if (hit) return `/assets/characters/${folder}/outfits/${outfitId}/${hit}.webp`;
    }
  }
  const available = manifest.available[folder];
  if (!available || available.length === 0) return null;
  const resolved = available.includes(expression) ? expression : EXPRESSION_FALLBACK[expression];
  if (!available.includes(resolved)) return null;
  return `/assets/characters/${folder}/${resolved}.webp`;
}

export function getCharacterArt(characterId: string, expression: Expression = 'neutral', outfitId: string | null = null): string | null {
  const folder = ART_FOLDERS[characterId];
  if (!folder) return null;
  return resolveCharacterArt({ available: AVAILABLE, outfits: OUTFITS }, folder, expression, outfitId);
}

/** 이 캐릭터의 의상 아트가 배치되어 있는가 (없으면 기본 의상으로 보인다 — 장착 자체는 가능) */
export function hasOutfitArt(characterId: string, outfitId: string): boolean {
  const folder = ART_FOLDERS[characterId];
  return !!folder && (OUTFITS[folder]?.[outfitId]?.length ?? 0) > 0;
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
