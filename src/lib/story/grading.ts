/**
 * 챕터 채점 — 순수 함수. 서버 결산과 클라 미리보기가 같은 규칙을 쓴다.
 *
 * - 드릴 세트: 슬롯별 첫 시도 정답 1점(힌트 사용 시 hintPenalty 배), 재출제에서 맞히면 0.5점, 끝내 못 맞히면 0점.
 * - 등급: S = 점수 ≥ 0.9 & 힌트 ≤ 1 / A = ≥ 0.75 / B = 완료. (A6)
 * - 통과 = 드릴 세트 완료 + primary 행동 목표. 결과 조건은 등급·뱃지에만 (A5-2 통과 규약).
 * - 보상: 첫 완주는 chapter.rewards.first + 등급 가산, 재도전은 replay + 등급 가산(인연 없음).
 */
import type { Chapter, ChapterGrade, StoryHeroineId } from './types';
import { STORY_HEROINE_IDS } from './types';

export interface DrillSlotOutcome {
  firstCorrect: boolean;
  finallyCorrect: boolean;
  hintUsed: boolean;
}

export const RETRY_CREDIT = 0.5;

export function scoreDrillSet(outcomes: readonly DrillSlotOutcome[], hintPenalty: number): number {
  if (outcomes.length === 0) return 0;
  const total = outcomes.reduce((sum, outcome) => {
    if (outcome.firstCorrect) return sum + (outcome.hintUsed ? hintPenalty : 1);
    if (outcome.finallyCorrect) return sum + RETRY_CREDIT;
    return sum;
  }, 0);
  return Math.max(0, Math.min(1, total / outcomes.length));
}

/** 「퍼펙트」 — 세트의 모든 슬롯이 첫 시도 정답이고 힌트를 쓰지 않았다 (빈 세트는 아님) */
export function isPerfectSet(outcomes: readonly DrillSlotOutcome[]): boolean {
  return outcomes.length > 0 && outcomes.every(outcome => outcome.firstCorrect && !outcome.hintUsed);
}

export function gradeChapter(input: { drillScore: number; hintsUsed: number; liveScore?: number | null }): ChapterGrade {
  const live = input.liveScore ?? null;
  const score = live === null ? input.drillScore : (input.drillScore + live) / 2;
  if (score >= 0.9 && input.hintsUsed <= 1) return 'S';
  if (score >= 0.75) return 'A';
  return 'B';
}

export function chapterPassed(input: { drillCompleted: boolean; primaryObjectivesMet: boolean | null }): boolean {
  return input.drillCompleted && input.primaryObjectivesMet !== false;
}

/**
 * 실력 확인(드릴만) 통과 점수 — 힌트 없이 6문 기준 첫 시도 5정답 + 재출제 1(0.917)은 통과,
 * 4 + 2(0.833)는 미통과. "이미 안다"는 주장을 재출제 크레딧으로 채우지 못하게 하는 선이다.
 */
export const EXAM_PASS_SCORE = 0.85;

export function examPassed(drillScore: number): boolean {
  return drillScore >= EXAM_PASS_SCORE - 1e-9;
}

export interface RewardGrant {
  dojoXpMilli: number;
  affinity: Array<{ characterId: StoryHeroineId; milli: number }>;
  badgeId: string | null;
}

/** 첫 완주 보상 — 'partner'는 선택 파트너로, 'all'은 6명 전원으로 해석. 파트너가 없으면 partner 몫은 지급하지 않는다. */
export function firstClearRewards(chapter: Chapter, grade: ChapterGrade, partnerId: StoryHeroineId | null): RewardGrant {
  const byCharacter = new Map<StoryHeroineId, number>();
  for (const grant of chapter.rewards.first.affinity) {
    const targets: StoryHeroineId[] = grant.target === 'all'
      ? [...STORY_HEROINE_IDS]
      : grant.target === 'partner'
        ? (partnerId ? [partnerId] : [])
        : [grant.target];
    for (const target of targets) byCharacter.set(target, (byCharacter.get(target) ?? 0) + grant.milli);
  }
  return {
    dojoXpMilli: chapter.rewards.first.dojoXpMilli + (chapter.rewards.gradeBonusMilli[grade] ?? 0),
    affinity: [...byCharacter.entries()].map(([characterId, milli]) => ({ characterId, milli })),
    badgeId: chapter.rewards.first.badgeId ?? null,
  };
}

export function replayRewards(chapter: Chapter, grade: ChapterGrade): RewardGrant {
  return {
    dojoXpMilli: chapter.rewards.replay.dojoXpMilli + (chapter.rewards.gradeBonusMilli[grade] ?? 0),
    affinity: [],
    badgeId: null,
  };
}
