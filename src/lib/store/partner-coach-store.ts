'use client';

import { create } from 'zustand';

/**
 * 파트너 훈수의 세션 메모리 — 저장하지 않는다(새로고침하면 0부터).
 * - bubbleVisible: 훈수/반응 말풍선이 떠 있는 동안 PartnerReactions가 같은 자리(좌하단)에 겹치지 않게 숨는다.
 * - followCount: "오늘 사쿠라 말대로 N번" 표시용. 인연 XP 같은 보상은 서버 검증이 붙는 다음 단계에서 다룬다.
 * - followedHandKey: 마지막으로 훈수를 따른 핸드 `${roomId}:${handNumber}`. 그 핸드를 내가 이기면 승리 컷인(WinnerCutIn)이
 *   파트너의 "같이 이겼다" 반응을 대신 띄운다 — 좌하단 반응 말풍선과 하단 컷인이 겹치지 않게(2026-10-24).
 *   방마다 handNumber가 1부터 다시 시작하므로 방 id까지 묶는다(다른 방의 같은 번호 핸드에서 오인 금지).
 */
interface PartnerCoachStore {
  bubbleVisible: boolean;
  setBubbleVisible: (visible: boolean) => void;
  followCount: number;
  recordFollow: (handKey?: string) => void;
  followedHandKey: string | null;
}

export const usePartnerCoachStore = create<PartnerCoachStore>()(set => ({
  bubbleVisible: false,
  setBubbleVisible: bubbleVisible => set(state => (state.bubbleVisible === bubbleVisible ? state : { bubbleVisible })),
  followCount: 0,
  followedHandKey: null,
  recordFollow: handKey => set(state => ({
    followCount: state.followCount + 1,
    followedHandKey: handKey ?? state.followedHandKey,
  })),
}));

/** 훈수 따름 기록·승리 컷인 비교가 공유하는 핸드 키 */
export function coachHandKey(roomId: string | null | undefined, handNumber: number): string {
  return `${roomId ?? '-'}:${handNumber}`;
}
