/**
 * 실력 배치(placement)와 숙련자 빠른 진행 — 서버·클라 공용 순수 규칙 (2026-10-20 사용자 결정: 2단계).
 *
 * - 배치: 자기 평가 1문 + 서버 채점 4문 → `SkillTier` 3단계. 결과는 story flag `placement:tier`에 문자열로 저장한다
 *   (마이그레이션 없이 `StoryProgressView.flags`로 클라에 보인다). 다시 측정하거나 직접 바꿀 수 있다.
 * - 첫 수련(2026-10-24 사용자 결정 — 배치 1번 문항과 Ch1 드릴이 겹쳐 보였다): 자기 평가만 묻고 바로 Ch1로 간다
 *   (`tierFromSelfReport` — 'new'→beginner, 그 밖→novice, **자기 평가만으로 advanced는 절대 없다**). 4문 체크는 Ch1을 끝낸 뒤
 *   「다음 수업부터 빠르게 가기」 초대로 선택해서 푼다(`placement:check` 'pending' → 'taken'|'declined').
 * - 빠른 진행(`StoryRunMode 'fast'`): 씬·드릴 세트·스파링·결산은 그대로 두고 레슨과 프리셋 '연습' 테이블을 건너뛴다.
 *   드릴은 쉬운 슬롯을 덜어 내고, 스파링 봇은 한 단계 강하게 한다. 통과 규칙·보상은 'full'과 같다
 *   (드릴 세트 완료 + 스파링 primary 목표) — 완료 기록을 거저 주지 않는다.
 * - 'beginner'만 Ch1 초보 안내(beginnerGuide)를 본다. 'novice'는 일반 흐름에서 안내만 끈다.
 */
import type { RoomDifficulty } from '../poker/types';
import type { DrillSlot } from './types';

export type SkillTier = 'beginner' | 'novice' | 'advanced';
export const SKILL_TIERS: readonly SkillTier[] = ['beginner', 'novice', 'advanced'];

/** 자기 평가 — 'new'(처음이에요)는 문제를 내지 않고 바로 'beginner' */
export type PlacementSelfReport = 'new' | 'rules' | 'regular';
export const PLACEMENT_SELF_REPORTS: readonly PlacementSelfReport[] = ['new', 'rules', 'regular'];

/** story flag 키 — `belt:*`·`badge:*`·`choice:*`와 겹치지 않는 네임스페이스 */
export const PLACEMENT_TIER_FLAG = 'placement:tier';

/**
 * Ch1 뒤 4문 체크 초대 상태 — 자기 평가만으로 첫 수련을 시작하면 'pending'. 4문을 채점받으면 'taken',
 * 초대를 거절하면 'declined'. flag가 없으면(2026-10-24 이전 배치 사용자) 초대하지 않는다.
 */
export const PLACEMENT_CHECK_FLAG = 'placement:check';
export type PlacementCheckState = 'pending' | 'taken' | 'declined';
const PLACEMENT_CHECK_STATES: readonly PlacementCheckState[] = ['pending', 'taken', 'declined'];

/** 4문 체크 초대가 열리는 챕터 — 이 챕터를 한 번 끝낸 뒤에만 초대한다 */
export const PLACEMENT_CHECK_AFTER_CHAPTER_ID = 'act1-ch01';

/**
 * 배치 문제 템플릿 — 전부 보기 하나 고르기(탭 즉시 다음 문제). 규칙 → 계산 → 프리플랍 → 판단 순.
 * 서버가 문항마다 새 seed로 생성하고, 채점은 서버가 발급한 seed로 재생성해서 한다(정답은 클라에 나가지 않는다).
 * Ch1 드릴 유형(`rank-who-wins`·`pos-name` 등)은 넣지 않는다 — 체크가 Ch1 뒤에 나오므로 같은 문제를 반복하게 된다
 * (placement.test가 Ch1 드릴 슬롯과 겹치지 않음을 고정). 규칙 문항은 액션 순서(`pos-first-to-act`, Ch2).
 */
export const PLACEMENT_TEMPLATE_IDS = ['pos-first-to-act', 'odds-ratio-choice', 'range-open-decision', 'call-decision'] as const;

export function isSkillTier(value: unknown): value is SkillTier {
  return typeof value === 'string' && (SKILL_TIERS as readonly string[]).includes(value);
}

export function isPlacementSelfReport(value: unknown): value is PlacementSelfReport {
  return typeof value === 'string' && (PLACEMENT_SELF_REPORTS as readonly string[]).includes(value);
}

/**
 * 판정 — 'new'는 무조건 beginner. 그 밖에는 실제 정답 수로만 정한다(자기 평가가 높아도 문제를 못 풀면 올리지 않는다).
 * 4문 기준: 3문 이상 advanced · 1~2문 novice · 0문 beginner.
 */
export function decidePlacementTier(selfReport: PlacementSelfReport, correct: number, total: number): SkillTier {
  if (selfReport === 'new' || total <= 0) return 'beginner';
  const ratio = correct / total;
  if (ratio >= 0.75) return 'advanced';
  if (correct >= 1) return 'novice';
  return 'beginner';
}

/**
 * 첫 수련의 자기 평가만으로 정하는 등급 — 'new'는 beginner(초보 안내), 그 밖은 novice(안내 없이 일반 흐름).
 * 채점 없이 advanced(빠른 진행)를 주지 않는다.
 */
export function tierFromSelfReport(selfReport: PlacementSelfReport): Exclude<SkillTier, 'advanced'> {
  return selfReport === 'new' ? 'beginner' : 'novice';
}

export function placementCheckFromFlags(flags: Readonly<Record<string, string>> | null | undefined): PlacementCheckState | null {
  const value = flags?.[PLACEMENT_CHECK_FLAG];
  return typeof value === 'string' && (PLACEMENT_CHECK_STATES as readonly string[]).includes(value) ? value as PlacementCheckState : null;
}

/**
 * Ch1 뒤 「다음 수업부터 빠르게 가기」 초대 노출 — 자기 평가로 시작했고('pending'), 아직 숙련이 아니며,
 * Ch1을 한 번 끝냈을 때만. 이미 체크를 풀었거나 거절했으면, 또는 옛 배치 사용자(flag 없음)면 띄우지 않는다.
 */
export function shouldOfferPlacementCheck(progress: {
  flags: Readonly<Record<string, string>>;
  chapters: readonly { chapterId: string; completions: number }[];
} | null | undefined): boolean {
  if (!progress) return false;
  if (placementCheckFromFlags(progress.flags) !== 'pending') return false;
  if (placementTierFromFlags(progress.flags) === 'advanced') return false;
  return progress.chapters.some(row => row.chapterId === PLACEMENT_CHECK_AFTER_CHAPTER_ID && row.completions > 0);
}

/** 4문 체크 결과 — 숙련(빠른 진행) 기준을 넘으면 advanced로 올리고, 아니면 지금 단계를 그대로 둔다(null) */
export function placementCheckPromotion(correct: number, total: number): 'advanced' | null {
  return decidePlacementTier('rules', correct, total) === 'advanced' ? 'advanced' : null;
}

export function placementTierFromFlags(flags: Readonly<Record<string, string>> | null | undefined): SkillTier | null {
  const value = flags?.[PLACEMENT_TIER_FLAG];
  return isSkillTier(value) ? value : null;
}

/** 빠른 진행을 쓸 수 없는 챕터 — 졸업 챕터(토너먼트 스파링 하나로 이루어진 마지막 수업) */
export function chapterAllowsFastMode(chapter: { graduation?: true }): boolean {
  return !chapter.graduation;
}

/** 챕터를 '시작'할 때의 기본 모드 — 숙련자는 빠른 진행, 나머지는 기존 'full' */
export function defaultRunModeForTier(tier: SkillTier | null, chapter: { graduation?: true }): 'full' | 'fast' {
  return tier === 'advanced' && chapterAllowsFastMode(chapter) ? 'fast' : 'full';
}

/** Ch1 초보 안내 노출 — 배치 전(null)과 beginner만 */
export function tierShowsBeginnerGuide(tier: SkillTier | null): boolean {
  return tier === null || tier === 'beginner';
}

/** 빠른 진행에서 건너뛰는 스텝 종류 */
export const FAST_MODE_SKIPPED_STEP_KINDS = ['lesson', 'practice-table'] as const;

/** 빠른 진행 드릴 세트의 최소 문항 수 — 쉬운 슬롯을 덜어 내도 이보다 줄이지 않는다 */
export const FAST_MODE_MIN_DRILLS = 3;

/**
 * 빠른 진행 드릴 슬롯 — 난이도 1 슬롯을 덜어 낸다. 남은 슬롯이 최소치보다 적으면 덜어 낸 슬롯 중
 * 원래 순서 앞쪽부터 되돌려 채운다. `*review` 슬롯(난이도 미상, `difficultyOf`가 null)은 항상 남긴다.
 * 결과는 원래 순서를 유지한다(서버 slot index ↔ 클라 진행 표시 일치).
 */
export function fastModeDrillSlots(
  slots: readonly DrillSlot[],
  difficultyOf: (templateId: string) => number | null,
  minDrills: number = FAST_MODE_MIN_DRILLS,
): DrillSlot[] {
  const keep = slots.map(slot => {
    const difficulty = difficultyOf(slot.templateId);
    return difficulty === null || difficulty >= 2;
  });
  let kept = keep.filter(Boolean).length;
  const target = Math.min(minDrills, slots.length);
  for (let i = 0; i < slots.length && kept < target; i++) {
    if (!keep[i]) {
      keep[i] = true;
      kept++;
    }
  }
  return slots.filter((_, i) => keep[i]);
}

/** 빠른 진행 스파링 봇 강도 — 한 단계 올린다 */
export function fastModeTableDifficulty(difficulty: RoomDifficulty): RoomDifficulty {
  return difficulty === 'easy' ? 'normal' : 'hard';
}
