'use client';

import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { DeckStyleId, DeckColorId } from '@/components/table/card-theme';
import {
  PREFLOP_PRESET_DEFAULT,
  POSTFLOP_PRESET_DEFAULT,
  sanitizePreflopPresets,
  sanitizePostflopPresets,
} from '@/lib/poker/bet-presets';

/** 베팅 슬라이더/스테퍼 증감 단위 기준 */
export type BetStepUnit = 'sb' | 'bb';

/** 좌석 칩 스택 표기 — 칩 수 / 빅블라인드 환산 */
export type ChipDisplayMode = 'chips' | 'bb';

interface SettingsStore {
  muted: boolean;
  toggleMuted: () => void;
  setMuted: (muted: boolean) => void;
  /** 배경음악(BGM) 음소거 — 효과음과 별개 */
  musicMuted: boolean;
  toggleMusicMuted: () => void;
  /** 카드 앞면 스타일 — 클래식(코너 인덱스) / 빅랭크(GG풍) / 솔리드(수트색 배경+흰 글자) */
  deckStyle: DeckStyleId;
  setDeckStyle: (style: DeckStyleId) => void;
  /** 수트 배색 — 2컬러(♠♣검정 ♥♦빨강) / 4컬러(Caro 표준) */
  deckColor: DeckColorId;
  setDeckColor: (color: DeckColorId) => void;
  /** 딜러 미야코 코너 아바타 표시 */
  showDealerAvatar: boolean;
  toggleDealerAvatar: () => void;
  /** 딜러 미야코 말풍선(게임 진행 멘트) 표시 */
  showDealerBubble: boolean;
  toggleDealerBubble: () => void;
  /** 내 프로필 캐릭터 (좌석 아바타) — 캐릭터 id */
  profileCharacter: string;
  setProfileCharacter: (id: string) => void;
  /** 베팅 슬라이더/스테퍼 증감 단위 (SB/BB) */
  betStepUnit: BetStepUnit;
  setBetStepUnit: (unit: BetStepUnit) => void;
  /** 프리플랍 베팅 프리셋 — 직전 베팅의 배수 (최대 4슬롯, 포커룸 표준 커스텀 버튼) */
  preflopPresets: number[];
  setPreflopPresets: (values: number[]) => void;
  /** 포스트플랍 베팅 프리셋 — 팟 대비 % (최대 4슬롯) */
  postflopPresets: number[];
  setPostflopPresets: (values: number[]) => void;
  /** 팟 칩을 권종별로 쌓아 올리는 연출 */
  stackedPot: boolean;
  toggleStackedPot: () => void;
  /** 좌석 칩 스택 표기 (칩 부분 터치로 토글) */
  chipDisplayMode: ChipDisplayMode;
  toggleChipDisplayMode: () => void;
  /** 핸드 히스토리 금액 표기 — 칩 / BB 환산 (GGPoker 방식) */
  historyBBView: boolean;
  toggleHistoryBBView: () => void;
  /** 핸드 히스토리에서 닉네임을 지우고 포지션만 표시 (GGPoker 방식) */
  historyHideNames: boolean;
  toggleHistoryHideNames: () => void;
}

export const useSettingsStore = create<SettingsStore>()(
  persist(
    (set) => ({
      muted: false,
      toggleMuted: () => set(s => ({ muted: !s.muted })),
      setMuted: (muted) => set({ muted }),
      musicMuted: false,
      toggleMusicMuted: () => set(s => ({ musicMuted: !s.musicMuted })),
      deckStyle: 'classic',
      setDeckStyle: (deckStyle) => set({ deckStyle }),
      deckColor: 'four',
      setDeckColor: (deckColor) => set({ deckColor }),
      showDealerAvatar: true,
      toggleDealerAvatar: () => set(s => ({ showDealerAvatar: !s.showDealerAvatar })),
      showDealerBubble: true,
      toggleDealerBubble: () => set(s => ({ showDealerBubble: !s.showDealerBubble })),
      profileCharacter: 'sakura',
      setProfileCharacter: (profileCharacter) => set({ profileCharacter }),
      betStepUnit: 'bb',
      setBetStepUnit: (betStepUnit) => set({ betStepUnit }),
      preflopPresets: [...PREFLOP_PRESET_DEFAULT],
      setPreflopPresets: (values) => set({ preflopPresets: sanitizePreflopPresets(values) }),
      postflopPresets: [...POSTFLOP_PRESET_DEFAULT],
      setPostflopPresets: (values) => set({ postflopPresets: sanitizePostflopPresets(values) }),
      stackedPot: true,
      toggleStackedPot: () => set(s => ({ stackedPot: !s.stackedPot })),
      chipDisplayMode: 'chips',
      toggleChipDisplayMode: () => set(s => ({ chipDisplayMode: s.chipDisplayMode === 'chips' ? 'bb' : 'chips' })),
      historyBBView: false,
      toggleHistoryBBView: () => set(s => ({ historyBBView: !s.historyBBView })),
      historyHideNames: false,
      toggleHistoryHideNames: () => set(s => ({ historyHideNames: !s.historyHideNames })),
    }),
    {
      name: 'poker-doku-settings',
      version: 2,
      // v2: 캐릭터 로스터 개편 (ryuka→ara, yuki→chloe, akira→vivian, reika→elena)
      migrate: (persisted) => {
        const s = persisted as Partial<SettingsStore> | undefined;
        if (!s) return persisted as SettingsStore;
        const idMap: Record<string, string> = { ryuka: 'ara', yuki: 'chloe', akira: 'vivian', reika: 'elena' };
        if (s.profileCharacter && idMap[s.profileCharacter]) {
          s.profileCharacter = idMap[s.profileCharacter];
        }
        return s as SettingsStore;
      },
    },
  ),
);
