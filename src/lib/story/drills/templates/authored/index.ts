/**
 * 수기(authored) 드릴 템플릿 레지스트리 — `source.kind: 'authored'`.
 *
 * 생성 템플릿과 달리 시드를 무시하고 저장된 인스턴스를 그대로 복제한다
 * (`generator.ts`의 authored 분기 — speaker만 실행 시점의 교사로 바꾼다).
 * 막별 파일(`act1.ts` 등)을 여기 배열에 이어 붙인다.
 */
import type { DrillTemplate } from '../../types';

import { ACT1_AUTHORED_DRILLS } from './act1';
import { ACT2_AUTHORED_DRILLS } from './act2';

export const AUTHORED_DRILL_TEMPLATES: readonly DrillTemplate[] = [...ACT1_AUTHORED_DRILLS, ...ACT2_AUTHORED_DRILLS];
