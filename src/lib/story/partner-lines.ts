/**
 * 파트너별 씬 대사 해석 — 순수 함수 (회귀: `partner-lines.test.ts`).
 *
 * 챕터 데이터의 say 라인(선택지 반응 포함)은 `byPartner`로 히로인별 문장을 가질 수 있다(2026-10-24 파트너 중심 초반).
 * 렌더러(ScenePlayer — 챕터 씬·인터럽트·실패 씬 공용)는 재생 직전에 `resolveSceneForPartner`로 한 번 풀어 쓴다.
 * 선택지 id·플래그·라인 순서는 바꾸지 않는다(서버 `choose` 검증과 커서 인덱스가 그대로 맞는다).
 */
import type { Expression } from '@/lib/assets/character-art';
import type { PartnerLineVariant, Scene, SceneLine, SceneSayLine, StoryHeroineId } from './types';

export function resolveSayLine(line: SceneSayLine, partnerId: StoryHeroineId | null): SceneSayLine {
  if (!line.byPartner) return line;
  const { byPartner, ...base } = line;
  const variant = partnerId ? byPartner[partnerId] : undefined;
  if (!variant) return base;
  return {
    ...base,
    text: variant.text,
    ...(variant.expression ? { expression: variant.expression } : {}),
    ...(variant.speaker ? { speaker: variant.speaker } : {}),
  };
}

function hasVariants(scene: Scene): boolean {
  return scene.lines.some(line => (line.kind === 'say'
    ? !!line.byPartner
    : line.choice.options.some(option => option.reply?.some(reply => !!reply.byPartner))));
}

/** 씬 전체를 런타임 파트너로 해석한다 — 변주가 없으면 같은 객체를 돌려준다(메모 안정성) */
export function resolveSceneForPartner(scene: Scene, partnerId: StoryHeroineId | null): Scene {
  if (!hasVariants(scene)) return scene;
  const lines: SceneLine[] = scene.lines.map(line => {
    if (line.kind === 'say') return resolveSayLine(line, partnerId);
    return {
      kind: 'choice',
      choice: {
        ...line.choice,
        options: line.choice.options.map(option => (option.reply
          ? { ...option, reply: option.reply.map(reply => resolveSayLine(reply, partnerId)) }
          : option)),
      },
    };
  });
  return { ...scene, lines };
}

type VariantInput = string | PartnerLineVariant;

/**
 * 히로인 6명 전원의 변주를 한 번에 적는 도우미 — Record라서 한 명이라도 빠지면 타입 오류가 난다.
 * 문자열만 주면 라인의 기본 표정을 그대로 쓴다.
 */
export function partnerVariants(
  entries: Record<StoryHeroineId, VariantInput>,
  expression?: Expression,
): Record<StoryHeroineId, PartnerLineVariant> {
  const out = {} as Record<StoryHeroineId, PartnerLineVariant>;
  for (const [id, value] of Object.entries(entries) as Array<[StoryHeroineId, VariantInput]>) {
    out[id] = typeof value === 'string' ? { text: value, ...(expression ? { expression } : {}) } : value;
  }
  return out;
}
