'use client';

import { create } from 'zustand';

/**
 * 파트너 훈수의 세션 메모리 — 저장하지 않는다(새로고침하면 0부터).
 * - bubbleVisible: 훈수/반응 말풍선이 떠 있는 동안 PartnerReactions가 같은 자리(좌하단)에 겹치지 않게 숨는다.
 * - followCount: "오늘 사쿠라 말대로 N번" 표시용. 인연 XP 같은 보상은 서버 검증이 붙는 다음 단계에서 다룬다.
 */
interface PartnerCoachStore {
  bubbleVisible: boolean;
  setBubbleVisible: (visible: boolean) => void;
  followCount: number;
  recordFollow: () => void;
}

export const usePartnerCoachStore = create<PartnerCoachStore>()(set => ({
  bubbleVisible: false,
  setBubbleVisible: bubbleVisible => set(state => (state.bubbleVisible === bubbleVisible ? state : { bubbleVisible })),
  followCount: 0,
  recordFollow: () => set(state => ({ followCount: state.followCount + 1 })),
}));
