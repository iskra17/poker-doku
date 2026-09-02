/**
 * 스토리 허브·파트너 카드 CTA의 표시 규칙 — 순수 함수 (컴포넌트는 그리기만).
 */
import { getDrillTemplate } from './drills/generator';
import type { DrillCategory } from './drills/types';
import type { Chapter, StoryAct, StoryBelt } from './types';
import { sortChapters } from './unlocks';
import type { StoryChapterProgressView, StoryProgressView } from './views';

export const BELT_LABEL: Readonly<Record<StoryBelt, string>> = Object.freeze({
  white: '백띠',
  yellow: '노란띠',
  blue: '파란띠',
  brown: '갈색띠',
  black: '검은띠',
});

export const ACT_TITLE: Readonly<Record<StoryAct, string>> = Object.freeze({
  1: '1막 · 입문',
  2: '2막 · 공격의 기본',
  3: '3막 · 읽기',
  4: '4막 · 종합',
});

/** 막 완주 시 도달하는 띠 (허브 헤더의 "다음 승급" 안내) */
export const ACT_BELT: Readonly<Record<StoryAct, StoryBelt>> = Object.freeze({
  1: 'yellow',
  2: 'blue',
  3: 'brown',
  4: 'black',
});

export type ChapterCardState = 'locked' | 'available' | 'in-progress' | 'completed';

export function chapterCardState(
  progress: StoryChapterProgressView,
  activeRun: StoryProgressView['activeRun'],
): ChapterCardState {
  if (activeRun?.chapterId === progress.chapterId) return 'in-progress';
  if (progress.completions > 0) return 'completed';
  return progress.unlocked ? 'available' : 'locked';
}

export interface PartnerCtaDecision {
  kind: 'resume-room' | 'story-continue' | 'story-start' | 'practice';
  label: string;
}

/**
 * 파트너 카드 CTA 우선순위: 보존 좌석 복귀 > 진행 중 챕터 이어하기 > 다음 챕터 시작 > 자유 연습.
 * 졸업(다음 챕터 없음)이면 자유 연습으로 돌아간다.
 */
export function partnerCtaDecision(input: {
  hasPreservedRoom: boolean;
  progress: StoryProgressView | null;
  chapterOrder: (chapterId: string) => number | null;
}): PartnerCtaDecision {
  if (input.hasPreservedRoom) return { kind: 'resume-room', label: '게임 복귀' };
  const progress = input.progress;
  if (progress?.activeRun) {
    const order = input.chapterOrder(progress.activeRun.chapterId);
    return { kind: 'story-continue', label: order ? `스토리 이어하기 · Ch${order}` : '스토리 이어하기' };
  }
  if (progress?.nextChapterId) {
    const order = input.chapterOrder(progress.nextChapterId);
    const first = progress.chapters.every(chapter => chapter.completions === 0 && chapter.attempts === 0);
    if (first) return { kind: 'story-start', label: '첫 수련 시작' };
    return { kind: 'story-continue', label: order ? `스토리 계속하기 · Ch${order}` : '스토리 계속하기' };
  }
  return { kind: 'practice', label: '수련 시작' };
}

/** 전역 챕터 번호 (막 순서 무관, 레지스트리 정렬 기준 1부터) */
export function chapterNumber(chapters: readonly Chapter[], chapterId: string): number | null {
  const index = chapters.findIndex(chapter => chapter.id === chapterId);
  return index >= 0 ? index + 1 : null;
}

/** 교사 표시 이름 — 미야코는 캐릭터 프로필 id가 'dealer'(이름 '딜러')라 스토리에선 이름을 고정한다 */
export function teacherDisplayName(teacherId: string, characterName: (artId: string) => string | undefined): string {
  if (teacherId === 'miyako' || teacherId === 'dealer') return '미야코';
  return characterName(teacherId) ?? teacherId;
}

/** 캐릭터 아트 id — 미야코의 일러스트는 'dealer' 폴더 */
export function teacherArtId(teacherId: string): string {
  return teacherId === 'miyako' ? 'dealer' : teacherId;
}

/** 드릴 정확도 % (0 문항이면 null) */
export function accuracyPercent(total: number, correct: number): number | null {
  if (total <= 0) return null;
  return Math.round((correct / total) * 100);
}

// ---------------------------------------------------------------------------
// 비선형 수련 목록 (2026-09-03 피드백 ②) — 스킬 칩 · 약점 기반 추천

/** 드릴 카테고리 한국어 라벨 — 허브 스킬 칩·복습 노트·추천 사유가 함께 쓴다 */
export const DRILL_CATEGORY_LABEL: Readonly<Record<string, string>> = Object.freeze({
  'pot-odds': '팟오즈',
  outs: '아우츠',
  equity: '에퀴티',
  combos: '콤보',
  'hand-ranking': '핸드 랭킹',
  position: '포지션',
  range: '레인지',
  'call-decision': '콜 결정',
  breakeven: '손익분기',
  mdf: 'MDF',
  'opponent-type': '상대 유형',
  sizing: '사이징',
  'action-judgment': '액션 판단',
  'hand-reading': '핸드 리딩',
  'sng-math': 'SnG 산술',
});

/** 챕터가 다루는 드릴 카테고리 — 드릴 세트 슬롯의 템플릿에서 파생(중복 제거, 등장 순). 별도 데이터 없음. */
export function chapterSkillCategories(chapter: Chapter): DrillCategory[] {
  const seen = new Set<DrillCategory>();
  const out: DrillCategory[] = [];
  for (const step of chapter.steps) {
    if (step.kind !== 'drill-set') continue;
    for (const slot of step.drills) {
      const category = getDrillTemplate(slot.templateId)?.category;
      if (category && !seen.has(category)) {
        seen.add(category);
        out.push(category);
      }
    }
  }
  return out;
}

export interface ChapterSkill {
  category: DrillCategory;
  label: string;
  /** 이 유형의 내 정확도 % (기록 없으면 null) */
  pct: number | null;
  total: number;
}

/** 챕터 스킬 칩 — 카테고리 + 내 정확도(기록실 통계에서) */
export function chapterSkills(chapter: Chapter, drillStats: StoryProgressView['drillStats']): ChapterSkill[] {
  return chapterSkillCategories(chapter).map(category => {
    const stats = drillStats.byCategory[category];
    return {
      category,
      label: DRILL_CATEGORY_LABEL[category] ?? category,
      pct: stats ? accuracyPercent(stats.total, stats.correct) : null,
      total: stats?.total ?? 0,
    };
  });
}

/** 약점 판정 — 이 횟수 이상 풀었고 정확도가 이 아래면 '보강 추천' */
export const WEAKNESS_MIN_ATTEMPTS = 3;
export const WEAKNESS_MAX_PCT = 70;

export type RecommendReason = 'in-progress' | 'first' | 'weakness' | 'next';

export interface ChapterRecommendation {
  chapterId: string;
  reason: RecommendReason;
  /** reason 'weakness'일 때 근거가 된 스킬 */
  skill: ChapterSkill | null;
}

/**
 * 추천 수련 — 순서 강제가 아니라 "고르기 어려울 때의 제안".
 * 진행 중 런 > 측정된 약점(≥3문·<70%)이 있는 미완료 챕터 중 정확도 최저 > 첫 방문이면 첫 챕터 > 미완료 첫 순서.
 * 전부 완료면 null(졸업).
 */
export function recommendChapter(chapters: readonly Chapter[], progress: StoryProgressView): ChapterRecommendation | null {
  if (progress.activeRun) return { chapterId: progress.activeRun.chapterId, reason: 'in-progress', skill: null };
  const rows = new Map(progress.chapters.map(chapter => [chapter.chapterId, chapter]));
  const candidates = sortChapters(chapters).filter(chapter => {
    const row = rows.get(chapter.id);
    return !!row && row.unlocked && row.completions === 0;
  });
  if (candidates.length === 0) return null;

  let weakest: { chapter: Chapter; skill: ChapterSkill } | null = null;
  for (const chapter of candidates) {
    for (const skill of chapterSkills(chapter, progress.drillStats)) {
      if (skill.total < WEAKNESS_MIN_ATTEMPTS || skill.pct === null || skill.pct >= WEAKNESS_MAX_PCT) continue;
      if (!weakest || skill.pct < (weakest.skill.pct ?? 101)) weakest = { chapter, skill };
    }
  }
  if (weakest) return { chapterId: weakest.chapter.id, reason: 'weakness', skill: weakest.skill };

  const untouched = progress.drillStats.total === 0
    && progress.chapters.every(chapter => chapter.attempts === 0 && chapter.completions === 0);
  return { chapterId: candidates[0].id, reason: untouched ? 'first' : 'next', skill: null };
}

/** 추천 사유 한 줄 */
export function recommendationCopy(recommendation: ChapterRecommendation): string {
  switch (recommendation.reason) {
    case 'in-progress':
      return '진행 중인 수업 — 이어서 해요';
    case 'first':
      return '처음이라면 여기부터 — 순서는 자유예요';
    case 'weakness':
      return `${recommendation.skill?.label ?? '이 유형'} 정확도 ${recommendation.skill?.pct ?? 0}% — 여기부터 보강해요`;
    case 'next':
      return '아직 안 한 수업 중 첫 순서 — 다른 걸 먼저 골라도 돼요';
  }
}
