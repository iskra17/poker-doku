'use client';

import { create } from 'zustand';

/**
 * 연출 순서 게이트 — 화면을 덮는 연출(결산 보상 리빌·인연 씬 모달)이 겹치지 않게 "지금 무대가 비었는가"를 공유한다.
 * 규칙(2026-09-03 보상 체계): 결산 스탬프 → 보상 카드 → CG 컷신 → 띠 배너 → **그 뒤에** 인연 씬 → 도장 레벨업 필.
 * - `RewardReveal`은 마운트~완료 동안 'reward-reveal'을 잡고, `BondSceneUnlockWatcher`는 모달이 열린 동안 'bond-scene'을 잡는다.
 * - `ProgressionSummary`·인연 씬 큐는 `selectPresentationHeld`가 true면 대기한다(타이머도 걸지 않는다).
 * 순수 zustand 스토어 — 서버 상태 아님.
 */
export interface PresentationState {
  holds: Readonly<Record<string, true>>;
  hold(key: string): void;
  release(key: string): void;
  reset(): void;
}

export const usePresentationStore = create<PresentationState>(set => ({
  holds: {},
  hold: key => set(state => (state.holds[key] ? state : { holds: { ...state.holds, [key]: true } })),
  release: key => set(state => {
    if (!state.holds[key]) return state;
    const next = { ...state.holds };
    delete next[key];
    return { holds: next };
  }),
  reset: () => set({ holds: {} }),
}));

export function selectPresentationHeld(state: Pick<PresentationState, 'holds'>): boolean {
  return Object.keys(state.holds).length > 0;
}

/** 특정 키를 제외한 다른 hold가 있는가 — 자기 자신이 잡은 hold는 무시할 때 */
export function selectHeldByOthers(state: Pick<PresentationState, 'holds'>, self: string): boolean {
  return Object.keys(state.holds).some(key => key !== self);
}
