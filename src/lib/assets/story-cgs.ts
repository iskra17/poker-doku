/**
 * 씬 CG 매니페스트 — 스토리 씬 라인 `cg` id → 풀스크린 이미지(`public/assets/story/cg/scene-<id>.webp`, 768×1152).
 * `story-backgrounds.ts`와 같은 규약: id 유니온은 검증용, `AVAILABLE`에 있는 것만 경로를 준다(미배치는 null →
 * ScenePlayer가 스프라이트로 폴백). 기록실 「이벤트 CG」 섹션은 해당 챕터 완주로 해금한다.
 */
export type SceneCgId =
  | 'act1-ch01-prologue'
  | 'act1-ch01-climax'
  | 'act1-ch01-epilogue'
  | 'act1-ch02-prologue'
  | 'act1-ch02-climax'
  | 'act1-ch02-epilogue'
  | 'act1-ch03-prologue'
  | 'act1-ch03-climax'
  | 'act1-ch03-epilogue'
  | 'act2-ch04-prologue'
  | 'act2-ch04-climax'
  | 'act2-ch04-epilogue'
  | 'act2-ch05-prologue'
  | 'act2-ch05-climax'
  | 'act2-ch05-epilogue'
  | 'act2-ch06-prologue'
  | 'act2-ch06-climax'
  | 'act2-ch06-epilogue'
  | 'act1-ch02-garden-walk'
  | 'act1-ch02-victory'
  | 'act1-ch02-rain-veranda'
  | 'act1-ch02-library'
  | 'act3-ch09-lesson'
  | 'act3-ch09-river-walk'
  | 'act3-ch09-snow-window'
  | 'act3-ch09-analysis';

export const SCENE_CG_IDS: readonly SceneCgId[] = [
  'act1-ch01-prologue',
  'act1-ch01-climax',
  'act1-ch01-epilogue',
  'act1-ch02-prologue',
  'act1-ch02-climax',
  'act1-ch02-epilogue',
  'act1-ch03-prologue',
  'act1-ch03-climax',
  'act1-ch03-epilogue',
  'act2-ch04-prologue',
  'act2-ch04-climax',
  'act2-ch04-epilogue',
  'act2-ch05-prologue',
  'act2-ch05-climax',
  'act2-ch05-epilogue',
  'act2-ch06-prologue',
  'act2-ch06-climax',
  'act2-ch06-epilogue',
  'act1-ch02-garden-walk',
  'act1-ch02-victory',
  'act1-ch02-rain-veranda',
  'act1-ch02-library',
  'act3-ch09-lesson',
  'act3-ch09-river-walk',
  'act3-ch09-snow-window',
  'act3-ch09-analysis',
];

export const SCENE_CG_TITLE: Readonly<Record<SceneCgId, string>> = Object.freeze({
  'act1-ch01-prologue': '도장의 아침',
  'act1-ch01-climax': '첫 쇼다운',
  'act1-ch01-epilogue': '첫날 밤의 툇마루',
  'act1-ch02-prologue': '테이블 앞의 사쿠라',
  'act1-ch02-climax': '기다림의 반환점',
  'act1-ch02-epilogue': '밤 정원의 사쿠라',
  'act1-ch03-prologue': '화이트보드와 드라코',
  'act1-ch03-climax': '팟 두 배의 인사',
  'act1-ch03-epilogue': '석양의 사범실',
  'act2-ch04-prologue': '칩을 튕기는 아라',
  'act2-ch04-climax': '선제 타격',
  'act2-ch04-epilogue': '옥상의 주먹 인사',
  'act2-ch05-prologue': '방송 준비 완료',
  'act2-ch05-climax': '스테이션의 쇼다운',
  'act2-ch05-epilogue': '칩 탑과 클로이',
  'act2-ch06-prologue': '남극에서 온 손님',
  'act2-ch06-climax': '빙점의 선전포고',
  'act2-ch06-epilogue': '문 앞의 아라',
  'act1-ch02-garden-walk': '책과 벚꽃길',
  'act1-ch02-victory': '작은 승리',
  'act1-ch02-rain-veranda': '빗소리와 기다림',
  'act1-ch02-library': '책장에서 꺼낸 질문',
  'act3-ch09-lesson': '그림자 읽기',
  'act3-ch09-river-walk': '강변의 생각',
  'act3-ch09-snow-window': '창밖의 흰 여백',
  'act3-ch09-analysis': '칩 앞의 침묵',
});

/** 실제로 배치된 이미지 id — 기존 18장 + 일반 아트 첫 공급 8장. */
const AVAILABLE: ReadonlySet<string> = new Set<string>(SCENE_CG_IDS);

/** 장면 이름과 독립적인 챕터 소유권. 기록실 해금도 이 맵을 사용한다. */
export const SCENE_CG_CHAPTER: Readonly<Record<SceneCgId, string>> = Object.freeze({
  'act1-ch01-prologue': 'act1-ch01',
  'act1-ch01-climax': 'act1-ch01',
  'act1-ch01-epilogue': 'act1-ch01',
  'act1-ch02-prologue': 'act1-ch02',
  'act1-ch02-climax': 'act1-ch02',
  'act1-ch02-epilogue': 'act1-ch02',
  'act1-ch03-prologue': 'act1-ch03',
  'act1-ch03-climax': 'act1-ch03',
  'act1-ch03-epilogue': 'act1-ch03',
  'act2-ch04-prologue': 'act2-ch04',
  'act2-ch04-climax': 'act2-ch04',
  'act2-ch04-epilogue': 'act2-ch04',
  'act2-ch05-prologue': 'act2-ch05',
  'act2-ch05-climax': 'act2-ch05',
  'act2-ch05-epilogue': 'act2-ch05',
  'act2-ch06-prologue': 'act2-ch06',
  'act2-ch06-climax': 'act2-ch06',
  'act2-ch06-epilogue': 'act2-ch06',
  'act1-ch02-garden-walk': 'act1-ch02',
  'act1-ch02-victory': 'act1-ch02',
  'act1-ch02-rain-veranda': 'act1-ch02',
  'act1-ch02-library': 'act1-ch02',
  'act3-ch09-lesson': 'act3-ch09',
  'act3-ch09-river-walk': 'act3-ch09',
  'act3-ch09-snow-window': 'act3-ch09',
  'act3-ch09-analysis': 'act3-ch09',
});

export function isSceneCgId(value: unknown): value is SceneCgId {
  return typeof value === 'string' && (SCENE_CG_IDS as readonly string[]).includes(value);
}

/** 씬 CG가 속한 챕터 id ('act1-ch01-climax' → 'act1-ch01') */
export function sceneCgChapterId(id: SceneCgId): string {
  return SCENE_CG_CHAPTER[id];
}

/** Logical IDs remain stable; replacement artwork and its video pair share a versioned stem. */
export const EVENT_CG_V2_IDS: readonly SceneCgId[] = [
  'act1-ch02-garden-walk', 'act1-ch02-victory', 'act1-ch02-rain-veranda', 'act1-ch02-library',
  'act3-ch09-lesson', 'act3-ch09-river-walk', 'act3-ch09-snow-window', 'act3-ch09-analysis',
];

export function sceneCgAssetStem(id: SceneCgId): string {
  return `scene-${id}${EVENT_CG_V2_IDS.includes(id) ? '-v2' : ''}`;
}

export interface SceneCg {
  id: SceneCgId;
  src: string;
  title: string;
}

/** 배치된 CG만 — 미등록·미배치면 null */
export function getSceneCg(id: string | null | undefined): SceneCg | null {
  if (!isSceneCgId(id) || !AVAILABLE.has(id)) return null;
  return { id, src: `/assets/story/cg/${sceneCgAssetStem(id)}.webp`, title: SCENE_CG_TITLE[id] };
}

/** 챕터 시작 프리로드용 */
export function listSceneCgSources(ids: readonly (string | undefined)[]): string[] {
  const out = new Set<string>();
  for (const id of ids) {
    const cg = getSceneCg(id);
    if (cg) out.add(cg.src);
  }
  return [...out];
}
