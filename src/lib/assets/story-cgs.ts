/**
 * 씬 CG 매니페스트 — 스토리 씬 라인 `cg` id → 풀스크린 이미지(`public/assets/story/cg/scene-<id>.webp`, 768×1152).
 * `story-backgrounds.ts`와 같은 규약: id 유니온은 검증용, `AVAILABLE`에 있는 것만 경로를 준다(미배치는 null →
 * ScenePlayer가 스프라이트로 폴백). 기록실 「이벤트 CG」 섹션은 해당 챕터 완주로 해금한다.
 */
export type SceneCgId =
  | 'act1-ch01-prologue'
  | 'act1-ch01-epilogue'
  | 'act1-ch02-prologue'
  | 'act1-ch02-epilogue'
  | 'act1-ch03-prologue'
  | 'act1-ch03-epilogue';

export const SCENE_CG_IDS: readonly SceneCgId[] = [
  'act1-ch01-prologue',
  'act1-ch01-epilogue',
  'act1-ch02-prologue',
  'act1-ch02-epilogue',
  'act1-ch03-prologue',
  'act1-ch03-epilogue',
];

export const SCENE_CG_TITLE: Readonly<Record<SceneCgId, string>> = Object.freeze({
  'act1-ch01-prologue': '도장의 아침',
  'act1-ch01-epilogue': '첫날 밤의 툇마루',
  'act1-ch02-prologue': '테이블 앞의 사쿠라',
  'act1-ch02-epilogue': '밤 정원의 사쿠라',
  'act1-ch03-prologue': '화이트보드와 드라코',
  'act1-ch03-epilogue': '석양의 사범실',
});

/** 실제로 배치된 이미지 id — 아트 배치 후 여기에 추가한다 (2026-09-03 1막 6장) */
const AVAILABLE: ReadonlySet<string> = new Set<string>(SCENE_CG_IDS);

export function isSceneCgId(value: unknown): value is SceneCgId {
  return typeof value === 'string' && (SCENE_CG_IDS as readonly string[]).includes(value);
}

/** 씬 CG가 속한 챕터 id ('act1-ch01-prologue' → 'act1-ch01') */
export function sceneCgChapterId(id: SceneCgId): string {
  return id.replace(/-(prologue|epilogue)$/, '');
}

export interface SceneCg {
  id: SceneCgId;
  src: string;
  title: string;
}

/** 배치된 CG만 — 미등록·미배치면 null */
export function getSceneCg(id: string | null | undefined): SceneCg | null {
  if (!isSceneCgId(id) || !AVAILABLE.has(id)) return null;
  return { id, src: `/assets/story/cg/scene-${id}.webp`, title: SCENE_CG_TITLE[id] };
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
