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
  /** 마스터 음소거 — 효과음+BGM 동시 토글 (로비 헤더 스피커 버튼) */
  toggleAllMuted: () => void;
  /** 카드 앞면 스타일 — 솔리드(수트색 배경+흰 글자, 기본) / 빅랭크(GG풍) */
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
  /**
   * 아이템 투척 표시 — 로컬 필터 (포커스타즈/하스스톤 등 업계 다수 방식, 2026-07-22 확정).
   * 끄면 수신 연출(비행/스플랫/표정/사운드) 전부와 내 발사대 UI가 함께 꺼진다.
   * 서버는 관여하지 않는다: 상대는 여전히 나를 조준할 수 있고 다른 사람 화면에선 내가
   * 맞는 연출이 보이며, 내 설정은 상대에게 노출되지 않는다.
   */
  throwablesEnabled: boolean;
  toggleThrowables: () => void;
  /** 발사대에 장전된 투척 아이템 (throwables/catalog.ts id) */
  selectedThrowableId: string;
  setSelectedThrowable: (id: string) => void;
  /** 투척 사용법 가이드를 본 적 있는지 — 첫 발사대 탭에서 1회 노출 (피커 ❓로 재열람 가능) */
  throwablesGuideSeen: boolean;
  markThrowablesGuideSeen: () => void;
}

export const useSettingsStore = create<SettingsStore>()(
  persist(
    (set) => ({
      muted: false,
      toggleMuted: () => set(s => ({ muted: !s.muted })),
      setMuted: (muted) => set({ muted }),
      musicMuted: false,
      toggleMusicMuted: () => set(s => ({ musicMuted: !s.musicMuted })),
      // 하나라도 켜져 있으면 전체 음소거, 둘 다 꺼져 있으면 전체 해제
      toggleAllMuted: () => set(s => {
        const mute = !(s.muted && s.musicMuted);
        return { muted: mute, musicMuted: mute };
      }),
      deckStyle: 'solid',
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
      throwablesEnabled: true,
      toggleThrowables: () => set(s => ({ throwablesEnabled: !s.throwablesEnabled })),
      selectedThrowableId: 'tomato',
      setSelectedThrowable: (selectedThrowableId) => set({ selectedThrowableId }),
      throwablesGuideSeen: false,
      markThrowablesGuideSeen: () => set({ throwablesGuideSeen: true }),
    }),
    {
      name: 'poker-doku-settings',
      version: 3,
      // v2: 캐릭터 로스터 개편 (ryuka→ara, yuki→chloe, akira→vivian, reika→elena)
      // v3: 카드 스타일 '클래식' 삭제 — 저장돼 있던 classic(및 미지 값)은 solid로
      migrate: (persisted) => {
        const s = persisted as Partial<SettingsStore> | undefined;
        if (!s) return persisted as SettingsStore;
        const idMap: Record<string, string> = { ryuka: 'ara', yuki: 'chloe', akira: 'vivian', reika: 'elena' };
        if (s.profileCharacter && idMap[s.profileCharacter]) {
          s.profileCharacter = idMap[s.profileCharacter];
        }
        if (s.deckStyle && !['solid', 'big-rank'].includes(s.deckStyle)) {
          s.deckStyle = 'solid';
        }
        return s as SettingsStore;
      },
    },
  ),
);
