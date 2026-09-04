import type { StoryCurriculum } from './curriculum';
/**
 * 챕터 해금·띠·다음 챕터 파생 — 순수 함수. 해금 상태는 저장하지 않고
 * `story_progress.completions > 0` 집합 + `Chapter.requires` 그래프에서 매번 계산한다.
 * 서버 검증(start 거절)과 클라 허브(잠금 표시)가 **같은 함수**를 쓴다.
 */
import type { Chapter, ChapterId, StoryAct, StoryBelt } from './types';
import { STORY_BELTS } from './types';

/** 검은띠 수여 플래그 키 — Ch12 졸업 SnG ITM 시 코디네이터가 세팅 */
export const BLACK_BELT_FLAG = 'belt:black';
/** 「퍼펙트」 — 드릴 세트 첫 패스 무오답·힌트 0 (보상 카탈로그 트리거, 2026-09-03) */
export const PERFECT_SET_FLAG = 'badge:perfect-set';
/** 「빈 노트」 — 복습 노트가 졸업으로 0개가 된 순간 */
export const EMPTY_NOTE_FLAG = 'badge:empty-note';

export function sortChapters(chapters: readonly Chapter[]): Chapter[] {
  return [...chapters].sort((a, b) => a.act - b.act || a.order - b.order);
}

export function isChapterUnlocked(chapter: Chapter, completed: ReadonlySet<ChapterId>): boolean {
  return chapter.requires.every(id => completed.has(id));
}

export function computeUnlockedChapters(
  chapters: readonly Chapter[],
  completed: ReadonlySet<ChapterId>,
): Set<ChapterId> {
  const unlocked = new Set<ChapterId>();
  for (const chapter of chapters) {
    if (isChapterUnlocked(chapter, completed)) unlocked.add(chapter.id);
  }
  return unlocked;
}

/** 해금됐지만 아직 완료하지 않은 첫 챕터 (막·순서 기준). 전부 완료면 null. */
export function nextChapter(chapters: readonly Chapter[], completed: ReadonlySet<ChapterId>): Chapter | null {
  for (const chapter of sortChapters(chapters)) {
    if (!completed.has(chapter.id) && isChapterUnlocked(chapter, completed)) return chapter;
  }
  return null;
}

/** 막 전체(해당 act의 모든 챕터)를 완료했는지 */
export function isActCompleted(chapters: readonly Chapter[], act: StoryAct, completed: ReadonlySet<ChapterId>, curriculum: StoryCurriculum): boolean {
  const inAct = chapters.filter(chapter => chapter.act === act);
  const registered = new Set(inAct.map(chapter => chapter.id));
  return curriculum[act].length > 0 && curriculum[act].every(id => registered.has(id) && completed.has(id));
}

/**
 * 띠 파생: 백(기본) → 1막 완료 노란 → 2막 파란 → 3막 갈색 → 검은띠는 4막 완료 + 졸업 SnG ITM 플래그.
 * 막이 비어 있으면(데이터 미작성) 그 막은 완료로 치지 않는다.
 */
export function deriveBelt(
  chapters: readonly Chapter[],
  completed: ReadonlySet<ChapterId>,
  flags: Readonly<Record<string, string>>,
  curriculum: StoryCurriculum,
): StoryBelt {
  let belt: StoryBelt = 'white';
  const ladder: Array<[StoryAct, StoryBelt]> = [[1, 'yellow'], [2, 'blue'], [3, 'brown']];
  for (const [act, next] of ladder) {
    if (!isActCompleted(chapters, act, completed, curriculum)) return belt;
    belt = next;
  }
  if (isActCompleted(chapters, 4, completed, curriculum) && flags[BLACK_BELT_FLAG] === '1') return 'black';
  return belt;
}

export function beltRank(belt: StoryBelt): number {
  return STORY_BELTS.indexOf(belt);
}
