/**
 * Sit & Go 구조 레지스트리 — **서버 전용**.
 *
 * 일반 SnG는 `standard`(1,500칩 · `SNG_LEVEL_DURATION_MS`)이고, 수련 스토리 Ch12 졸업 대결만
 * `graduation`(1,000칩 · 기본 2분)을 쓴다. 두 구조는 같은 블라인드 표(`SNG_BLIND_SCHEDULE`)를
 * 공유하고 시작 스택·레벨 길이만 다르다.
 *
 * 계약:
 * - `RoomConfig.sngStructureId`는 클라이언트가 넣을 수 없다 — `parseCreateRoomRequest`가 허용 필드만
 *   재구성하므로 요청에 실어도 값이 사라지고, `createRoom`은 스토리 방이 아닌데 'standard'가 아니면 throw한다.
 * - 레벨 시계·시작 공지·봇 스택·`applyBlindLevel`이 전부 같은 구조 객체를 읽는다(한 방에 두 구조가 섞이지 않는다).
 * - 레벨 길이 환경 단축(`SNG_LEVEL_MS`)은 테스트/개발용이며 두 구조에 함께 적용된다.
 */
import {
  SNG_BLIND_SCHEDULE,
  SNG_LEVEL_DURATION_MS,
  SNG_STARTING_STACK,
  type BlindLevel,
} from '../lib/poker/blind-schedule';
import type { RoomConfig } from '../lib/poker/types';

export type SngStructureId = NonNullable<RoomConfig['sngStructureId']>;

export interface SngStructure {
  id: SngStructureId;
  startingStack: number;
  levelMs: number;
  levels: readonly BlindLevel[];
}

/** 졸업 대결 시작 스택 (50BB @ 10/20) — 표준 SnG(1,500)보다 짧게 끝난다 */
export const GRADUATION_STARTING_STACK = 1_000;
/** 졸업 대결 기본 레벨 길이 (2분) */
export const GRADUATION_LEVEL_MS = 2 * 60_000;

const STRUCTURE_IDS: readonly SngStructureId[] = ['standard', 'graduation'];

export function isSngStructureId(value: unknown): value is SngStructureId {
  return typeof value === 'string' && (STRUCTURE_IDS as readonly string[]).includes(value);
}

/** 환경 단축(`SNG_LEVEL_MS`)은 호출 시점에 읽는다 — 테스트가 import 순서에 묶이지 않게 */
function graduationLevelMs(): number {
  const override = Number(process.env.SNG_LEVEL_MS);
  return Number.isFinite(override) && override > 0 ? override : GRADUATION_LEVEL_MS;
}

export function resolveSngStructure(id: SngStructureId = 'standard'): SngStructure {
  if (id === 'graduation') {
    return {
      id,
      startingStack: GRADUATION_STARTING_STACK,
      levelMs: graduationLevelMs(),
      levels: SNG_BLIND_SCHEDULE,
    };
  }
  return {
    id: 'standard',
    startingStack: SNG_STARTING_STACK,
    levelMs: SNG_LEVEL_DURATION_MS,
    levels: SNG_BLIND_SCHEDULE,
  };
}
