'use client';

import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { useGameStore } from './game-store';

/**
 * 운영자 모드(클라 토글) — 로비 로고 비밀 연타로 켜고 끈다. 서버 capability `operator`가 없는 프로필에선
 * 토글이 켜져 있어도 `useOperatorMode()`가 false다(권한은 서버가 접속마다 판정, 이 스토어는 UI 스위치일 뿐).
 *
 * 켜지면: 기록실·인연 탭이 모든 CG/영상/씬/의상을 해금 상태로 보여 주고(뷰 오버라이드 — DB 지급 아님),
 * 수련 허브는 잠긴 챕터를 열어 두며, 스테이지/테이블에 [⏭ 스킵] 버튼이 붙는다(서버 `story-advance target:'skip'`).
 * `outfitPreview`는 미보유 의상을 로비·스토리 화면에서 입혀 보는 로컬 미리보기(서버 장착 아님).
 */
interface OperatorStore {
  enabled: boolean;
  /** 히로인 id → 카탈로그 의상 item id (운영자 미리보기, 장착 아님) */
  outfitPreview: Record<string, string>;
  setEnabled: (enabled: boolean) => void;
  toggle: () => boolean;
  setOutfitPreview: (characterId: string, itemId: string | null) => void;
}

export const useOperatorStore = create<OperatorStore>()(
  persist(
    (set, get) => ({
      enabled: false,
      outfitPreview: {},
      setEnabled: enabled => set({ enabled }),
      toggle: () => {
        const enabled = !get().enabled;
        set({ enabled });
        return enabled;
      },
      setOutfitPreview: (characterId, itemId) => set(state => {
        const outfitPreview = { ...state.outfitPreview };
        if (itemId) outfitPreview[characterId] = itemId;
        else delete outfitPreview[characterId];
        return { outfitPreview };
      }),
    }),
    { name: 'poker-doku-operator', version: 1 },
  ),
);

/** 운영자 모드 활성 = 서버 권한(operator capability) && 로컬 토글 */
export function useOperatorMode(): boolean {
  const isOperator = useGameStore(state => state.isOperator);
  const enabled = useOperatorStore(state => state.enabled);
  return isOperator && enabled;
}
