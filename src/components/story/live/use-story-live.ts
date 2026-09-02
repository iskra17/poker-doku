'use client';

import { useGameStore } from '@/lib/store/game-store';
import { useStoryStore } from '@/lib/store/story-store';
import { getChapter } from '@/lib/story/chapters';
import { asLiveStep, isStoryLiveRoom, type LiveStep } from '@/lib/story/story-live-rules';
import type { StoryLiveView, StoryRunView } from '@/lib/story/views';

export interface StoryLiveContext {
  /** 지금 앉은 방이 이 런의 라이브 방인가 — 인룸 스토리 UI 전체의 게이트 */
  active: boolean;
  run: StoryRunView | null;
  live: StoryLiveView | null;
  /** 챕터 정적 데이터의 현재 라이브 스텝 (씬/드릴 스텝이면 null) */
  step: LiveStep | null;
  /** `${runId}:${stepIndex}` — 스텝당 1회성 연출(연습 안내·first-my-turn)의 키 */
  stepKey: string;
}

const IDLE: StoryLiveContext = { active: false, run: null, live: null, step: null, stepKey: '' };

/**
 * 인룸 스토리 컨텍스트 — StoryOverlay·ActionBar(코치)·GameRoomView(나가기)가 공유한다.
 * 스텝 본문은 서버가 보내지 않으므로(계약: 씬/레슨은 클라 챕터 데이터) 여기서 stepIndex로 찾는다.
 */
export function useStoryLive(): StoryLiveContext {
  const run = useStoryStore(state => state.run);
  const currentRoomId = useGameStore(state => state.currentRoomId);
  if (!run || !isStoryLiveRoom(run, currentRoomId)) return IDLE;
  return {
    active: true,
    run,
    live: run.live,
    step: asLiveStep(getChapter(run.chapterId)?.steps[run.stepIndex]),
    stepKey: `${run.runId}:${run.stepIndex}`,
  };
}
