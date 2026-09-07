import type { StoryRunView } from './views';

/**
 * Ch1의 첫 두 핸드 랭킹 드릴을 닫은 뒤 보여 주는 짧은 이벤트 스텝.
 * 서버가 이 장면 스텝을 보냈다는 사실이 세트 완료의 경계이므로, 마지막 답변이나 로컬 점수로 추측하지 않는다.
 */
export const FIRST_DRILL_CLEAR_STEP_ID = 'act1-ch01:first-drills-clear';

export function isFirstDrillClearMilestone(
  run: Pick<StoryRunView, 'chapterId' | 'mode' | 'phase' | 'stepKind'> | null,
  stepId: string | undefined,
): boolean {
  return !!run
    && run.chapterId === 'act1-ch01'
    && run.mode === 'full'
    && run.phase === 'scene'
    && run.stepKind === 'scene'
    && stepId === FIRST_DRILL_CLEAR_STEP_ID;
}
