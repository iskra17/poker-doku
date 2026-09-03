/**
 * 운영자 프로필 판정 — 세션 capability `operator`의 단일 소스.
 *
 * - `OPERATOR_PROFILE_IDS`(쉼표 구분) ∪ `TOURNAMENT_OPERATOR_PROFILE_IDS`(토너먼트 운영자는 자동 포함).
 * - production이 아니고 둘 다 비어 있으면 **모든 프로필**을 운영자로 본다(로컬 QA 편의).
 *   production에서 비어 있으면 아무도 운영자가 아니다.
 *
 * 운영자 권한이 서버에서 허용하는 것: 잠긴 챕터 시작, 스토리 스텝 건너뛰기(`story-advance target:'skip'`).
 * 클라이언트의 "운영자 모드" 토글(로고 연타)은 이 권한이 있을 때만 켜지는 UI 스위치일 뿐이다.
 */
export interface OperatorAccess {
  readonly mode: 'list' | 'all' | 'none';
  has(profileId: string): boolean;
}

function parseIdList(raw: string | undefined): string[] {
  return (raw ?? '')
    .split(',')
    .map(value => value.trim())
    .filter(Boolean);
}

export function operatorAccessFromSet(ids: ReadonlySet<string>): OperatorAccess {
  return {
    mode: ids.size > 0 ? 'list' : 'none',
    has: profileId => ids.has(profileId),
  };
}

const ALL: OperatorAccess = { mode: 'all', has: () => true };
const NONE: OperatorAccess = { mode: 'none', has: () => false };

export function resolveOperatorAccess(env: Readonly<Record<string, string | undefined>>): OperatorAccess {
  const ids = new Set([
    ...parseIdList(env.OPERATOR_PROFILE_IDS),
    ...parseIdList(env.TOURNAMENT_OPERATOR_PROFILE_IDS),
  ]);
  if (ids.size > 0) return operatorAccessFromSet(ids);
  return env.NODE_ENV === 'production' ? NONE : ALL;
}
