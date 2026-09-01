/**
 * 스토리 허브·파트너 카드 CTA의 표시 규칙 — 순수 함수 (컴포넌트는 그리기만).
 */
import type { Chapter, StoryAct, StoryBelt } from './types';
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

/** 드릴 정확도 % (0 문항이면 null) */
export function accuracyPercent(total: number, correct: number): number | null {
  if (total <= 0) return null;
  return Math.round((correct / total) * 100);
}
