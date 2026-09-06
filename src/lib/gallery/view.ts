/**
 * 기록실 표시 계층 — 순수 함수. `use-gallery` 훅과 `GalleryModal`이 여기서 파생 상태를 얻는다.
 *
 * 훅에 인라인으로 두면 검증할 방법이 없어서 분리했다(2026-09-06 Astra 구현 검토 — 테스트 공백).
 * 세 축이 서로 다른 집합을 쓴다는 게 이 모듈의 요점이다:
 *  - 목록·집계·NEW = 표시 설정으로 거른 것
 *  - [모두 확인] = 거른 것 중 **실제로 해금된** 것(운영자 미리보기 제외)
 *  - NEW 기준선 = 표시 설정과 무관한 실제 해금 전체
 */
import { summarizeGallery, type GalleryEntry, type GallerySectionSummary } from './catalog';
import { newEntries } from './seen';

export interface GalleryViewInput {
  /** 실제 해금 상태로 만든 항목 */
  real: readonly GalleryEntry[];
  /** 운영자 미리보기(unlockAll)로 만든 항목 — 없으면 real을 그대로 쓴다 */
  previewEntries?: readonly GalleryEntry[] | null;
  seen: ReadonlySet<string>;
  /** 보너스 CG 표시 설정 */
  showBonusCg: boolean;
}

export interface GalleryView {
  entries: GalleryEntry[];
  summary: GallerySectionSummary[];
  newIds: Set<string>;
  unlockedIds: string[];
  baselineIds: string[];
}

function visible(entries: readonly GalleryEntry[], showBonusCg: boolean): GalleryEntry[] {
  return showBonusCg ? [...entries] : entries.filter(entry => entry.section !== 'bonus');
}

export function selectGalleryView({ real, previewEntries, seen, showBonusCg }: GalleryViewInput): GalleryView {
  const realVisible = visible(real, showBonusCg);
  const entries = previewEntries ? visible(previewEntries, showBonusCg) : realVisible;
  return {
    entries,
    // 표시 설정으로 통째로 숨긴 섹션은 탭도 만들지 않는다(0/0 빈 탭 방지)
    summary: summarizeGallery(entries).filter(row => row.total > 0),
    newIds: new Set(newEntries(realVisible, seen).map(entry => entry.id)),
    unlockedIds: realVisible.filter(entry => entry.unlocked).map(entry => entry.id),
    baselineIds: real.filter(entry => entry.unlocked).map(entry => entry.id),
  };
}

/**
 * 기록실을 열 때 스토리 진행도를 다시 부를지 — 서버 `getProgress`가 조회 전에 보상 reconcile로
 * 자기 치유하므로, 방금 오른 인연·도장 레벨의 보너스 CG가 바로 보인다. 이미 요청 중이면 건너뛴다.
 */
export function shouldReloadOnOpen(isOpen: boolean, progressStatus: string): boolean {
  return isOpen && progressStatus !== 'loading';
}
