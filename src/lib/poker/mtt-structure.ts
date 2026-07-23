/**
 * MTT 블라인드 구조 — 프리셋(스탠다드/터보/하이퍼) + 단일 토너먼트 시계 계산.
 *
 * 규칙 근거 (docs/research-mtt-2026-07-23.md §2):
 * - 시작 스택 10,000 (100BB), 관용 수열(실효 1.25~1.5x)
 * - BB 앤티 = 1BB, 스탠다드/터보는 레벨 4부터, 하이퍼는 레벨 1부터
 * - 레벨은 단일 시계에서 흐르고 "각 테이블의 다음 핸드부터" 적용 (TDA Rule 23)
 * - 브레이크는 N레벨마다 시계에 삽입 — 브레이크 동안 레벨은 흐르지 않는다
 *
 * 이 모듈은 순수 계산만 담당한다. 일시정지 누적(pauseAccum)·핸드 경계 적용은
 * TournamentManager 책임 — elapsedPlayMs = (now - startedAt - pauseAccum)을 넘길 것.
 */

export interface MttBlindLevel {
  level: number; // 1-based
  smallBlind: number;
  bigBlind: number;
  ante: number; // BB 앤티 (0 = 없음)
}

export type MttSpeed = 'standard' | 'turbo' | 'hyper';

export interface MttStructure {
  speed: MttSpeed;
  name: string; // UI 라벨 (한국어)
  startingStack: number;
  levelDurationMs: number;
  breakEveryLevels: number; // N레벨마다 브레이크 (0 = 없음)
  breakDurationMs: number;
  levels: MttBlindLevel[];
}

/** 관용 수열 — 실무 표준 칩 단위 (마지막 레벨 이후엔 마지막 레벨 고정) */
const BLIND_SEQUENCE: ReadonlyArray<readonly [number, number]> = [
  [50, 100], [75, 150], [100, 200], [150, 300], [200, 400], [250, 500],
  [300, 600], [400, 800], [500, 1000], [600, 1200], [800, 1600], [1000, 2000],
  [1200, 2400], [1500, 3000], [2000, 4000], [2500, 5000], [3000, 6000],
  [4000, 8000], [5000, 10000], [6000, 12000], [8000, 16000], [10000, 20000],
  [12500, 25000], [15000, 30000],
];

function buildLevels(anteStartLevel: number): MttBlindLevel[] {
  return BLIND_SEQUENCE.map(([smallBlind, bigBlind], i) => ({
    level: i + 1,
    smallBlind,
    bigBlind,
    ante: i + 1 >= anteStartLevel ? bigBlind : 0,
  }));
}

/** 테스트용 레벨 시간 단축 (SNG_LEVEL_MS와 같은 패턴) */
const LEVEL_MS_OVERRIDE =
  (typeof process !== 'undefined' && Number(process.env.MTT_LEVEL_MS)) || 0;

export const MTT_STRUCTURES: Record<MttSpeed, MttStructure> = {
  standard: {
    speed: 'standard',
    name: '스탠다드',
    startingStack: 10000,
    levelDurationMs: LEVEL_MS_OVERRIDE || 8 * 60_000,
    breakEveryLevels: 6,
    breakDurationMs: 5 * 60_000,
    levels: buildLevels(4),
  },
  turbo: {
    speed: 'turbo',
    name: '터보',
    startingStack: 10000,
    levelDurationMs: LEVEL_MS_OVERRIDE || 5 * 60_000,
    breakEveryLevels: 6,
    breakDurationMs: 3 * 60_000,
    levels: buildLevels(4),
  },
  hyper: {
    speed: 'hyper',
    name: '하이퍼',
    startingStack: 5000,
    levelDurationMs: LEVEL_MS_OVERRIDE || 3 * 60_000,
    breakEveryLevels: 8,
    breakDurationMs: 3 * 60_000,
    levels: buildLevels(1),
  },
};

export interface MttClockPosition {
  /** 0-based 레벨 인덱스 (스케줄 끝에서 고정) */
  levelIndex: number;
  /** 현재 브레이크 중인지 — 브레이크는 breakEveryLevels 배수 레벨 "종료 후" 삽입 */
  onBreak: boolean;
  /**
   * 현재 세그먼트(레벨 또는 브레이크)가 끝나기까지 남은 ms.
   * 마지막 레벨에 도달하면 Infinity (더 오를 레벨이 없음 — 카운트다운 없음).
   */
  segmentRemainingMs: number;
}

/**
 * 경과 플레이 시간 → 시계 위치. 세그먼트 나열:
 * L1 … L{N} [break] L{N+1} … L{2N} [break] … (마지막 레벨 이후 고정, 브레이크 없음)
 */
export function mttClockAt(structure: MttStructure, elapsedPlayMs: number): MttClockPosition {
  const { levelDurationMs, breakEveryLevels, breakDurationMs, levels } = structure;
  let remaining = Math.max(0, elapsedPlayMs);
  for (let i = 0; i < levels.length; i++) {
    const isLast = i === levels.length - 1;
    if (!isLast && remaining < levelDurationMs) {
      return { levelIndex: i, onBreak: false, segmentRemainingMs: levelDurationMs - remaining };
    }
    if (isLast) {
      return { levelIndex: i, onBreak: false, segmentRemainingMs: Infinity };
    }
    remaining -= levelDurationMs;
    const breakFollows = breakEveryLevels > 0 && (i + 1) % breakEveryLevels === 0;
    if (breakFollows) {
      if (remaining < breakDurationMs) {
        // 브레이크 중 — 레벨은 다음 레벨로 이미 인상된 상태로 표기 (재개 즉시 적용)
        return { levelIndex: i + 1, onBreak: true, segmentRemainingMs: breakDurationMs - remaining };
      }
      remaining -= breakDurationMs;
    }
  }
  // levels가 비어 있는 비정상 구조 방어
  return { levelIndex: 0, onBreak: false, segmentRemainingMs: Infinity };
}

/** 구조의 레벨 (스케줄 끝에서 고정) */
export function mttLevelAt(structure: MttStructure, levelIndex: number): MttBlindLevel {
  return structure.levels[Math.min(levelIndex, structure.levels.length - 1)];
}
