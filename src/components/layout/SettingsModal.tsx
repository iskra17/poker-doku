'use client';

import { useState } from 'react';
import Modal from '@/components/ui/Modal';
import CardComponent from '@/components/table/Card';
import ProfileHub from '@/components/profile/ProfileHub';
import { useSettingsStore, BetStepUnit } from '@/lib/store/settings-store';
import {
  PREFLOP_PRESET_DEFAULT, POSTFLOP_PRESET_DEFAULT,
} from '@/lib/poker/bet-presets';
import {
  DeckStyleId, DeckColorId, DECK_STYLE_LABELS, DECK_COLOR_LABELS,
  SUIT_SYMBOLS, getSuitColor,
} from '@/components/table/card-theme';
import type { Card as CardType, Suit } from '@/lib/poker/types';

const BET_STEP_LABELS: Record<BetStepUnit, string> = {
  sb: 'SB 단위',
  bb: 'BB 단위',
};

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const PREVIEW_CARDS: CardType[] = [
  { rank: 'A', suit: 'spades' },
  { rank: '10', suit: 'hearts' },
];

const SUIT_ORDER: Suit[] = ['spades', 'hearts', 'diamonds', 'clubs'];

/** 온라인 포커룸 표준 설정 분류 — 프로필 / 게임 / 화면 / 사운드 */
const SETTINGS_TABS = [
  { id: 'profile', label: '프로필', icon: '👤' },
  { id: 'game', label: '게임', icon: '🎮' },
  { id: 'display', label: '화면', icon: '🎴' },
  { id: 'sound', label: '사운드', icon: '🔊' },
] as const;
type SettingsTab = typeof SETTINGS_TABS[number]['id'];

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <h3 className="text-xs font-bold text-blossom mb-2">{children}</h3>;
}

/**
 * 베팅 프리셋 편집기 — 포커룸 표준 커스텀 버튼 (PokerStars 'Bet Slider Shortcuts' 대응).
 * 프리플랍은 직전 베팅의 배수(x), 포스트플랍은 팟 %. 슬롯을 탭해 직접 수정하고
 * blur/Enter로 확정하면 store가 범위를 정리(sanitize)한다.
 * 입력 중 임시값은 단일 draft로 관리 — effect 없이 focus/blur 라이프사이클로만 동기화.
 */
function BetPresetEditor() {
  const { preflopPresets, setPreflopPresets, postflopPresets, setPostflopPresets } = useSettingsStore();
  const [draft, setDraft] = useState<{ kind: 'pre' | 'post'; index: number; text: string } | null>(null);

  const rows = [
    {
      kind: 'pre' as const,
      label: '프리플랍',
      hint: '직전 베팅의 배수',
      suffix: 'x',
      values: preflopPresets,
      commit: setPreflopPresets,
    },
    {
      kind: 'post' as const,
      label: '포스트플랍',
      hint: '팟 대비 %',
      suffix: '%',
      values: postflopPresets,
      commit: setPostflopPresets,
    },
  ];

  const commitDraft = () => {
    if (!draft) return;
    const row = rows.find(r => r.kind === draft.kind)!;
    const n = Number(draft.text);
    if (Number.isFinite(n) && n > 0) {
      const next = [...row.values];
      next[draft.index] = n;
      row.commit(next); // 범위 클램프/반올림은 store sanitize가 담당
    }
    setDraft(null);
  };

  return (
    <div className="mt-2 space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-sm text-ink">베팅 프리셋 버튼</span>
        <button
          type="button"
          onClick={() => {
            setDraft(null);
            setPreflopPresets([...PREFLOP_PRESET_DEFAULT]);
            setPostflopPresets([...POSTFLOP_PRESET_DEFAULT]);
          }}
          className="text-[11px] px-2 py-1 rounded-lg border border-white/10 bg-white/5 text-ink-dim hover:bg-white/10 transition-colors"
        >
          기본값 복원
        </button>
      </div>
      {rows.map(row => (
        <div key={row.kind} className="flex items-center gap-2">
          <div className="w-[86px] shrink-0 leading-tight">
            <span className="block text-xs text-ink">{row.label}</span>
            <span className="block text-[10px] text-ink-dim">{row.hint}</span>
          </div>
          <div className="flex gap-1 flex-1 min-w-0">
            {row.values.map((value, index) => {
              const editing = draft !== null && draft.kind === row.kind && draft.index === index;
              return (
                <div
                  key={`${row.kind}-${index}`}
                  className="flex-1 min-w-0 flex items-center rounded-lg border border-white/10 bg-white/5 focus-within:border-blossom/70 px-1.5 py-1"
                >
                  <input
                    type="text"
                    inputMode="decimal"
                    value={editing && draft ? draft.text : String(value)}
                    onFocus={e => {
                      setDraft({ kind: row.kind, index, text: String(value) });
                      e.target.select();
                    }}
                    onChange={e => setDraft({ kind: row.kind, index, text: e.target.value.replace(/[^0-9.]/g, '') })}
                    onBlur={commitDraft}
                    onKeyDown={e => {
                      if (e.key === 'Enter') {
                        commitDraft();
                        (e.target as HTMLInputElement).blur();
                      }
                    }}
                    aria-label={`${row.label} 프리셋 ${index + 1}`}
                    className="w-full min-w-0 bg-transparent text-right text-xs font-bold text-ink tabular focus:outline-none"
                  />
                  <span className="text-[10px] text-ink-dim pl-0.5 shrink-0">{row.suffix}</span>
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

function Toggle({ checked, onToggle, label }: { checked: boolean; onToggle: () => void; label: string }) {
  return (
    <button
      role="switch"
      aria-checked={checked}
      onClick={onToggle}
      className="flex items-center justify-between w-full py-1.5"
    >
      <span className="text-sm text-ink">{label}</span>
      <span className={`relative w-10 h-6 rounded-full transition-colors ${checked ? 'bg-blossom' : 'bg-white/15'}`}>
        <span
          className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform
            ${checked ? 'translate-x-4' : 'translate-x-0'}`}
        />
      </span>
    </button>
  );
}

export default function SettingsModal({ isOpen, onClose }: SettingsModalProps) {
  const [tab, setTab] = useState<SettingsTab>('game');
  const {
    deckStyle, setDeckStyle, deckColor, setDeckColor,
    showDealerAvatar, toggleDealerAvatar, showDealerBubble, toggleDealerBubble,
    betStepUnit, setBetStepUnit,
    stackedPot, toggleStackedPot,
    throwablesEnabled, toggleThrowables,
    muted, toggleMuted,
    musicMuted, toggleMusicMuted,
  } = useSettingsStore();

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="설정">
      {/* 상단 카테고리 탭 — 항목이 종류 무관하게 나열되지 않도록 분류 */}
      <div role="tablist" aria-label="설정 분류" className="mb-4 grid grid-cols-4 gap-1">
        {SETTINGS_TABS.map(({ id, label, icon }) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={tab === id}
            onClick={() => setTab(id)}
            className={`rounded-lg px-1 py-2 text-[11px] font-bold transition-colors
              ${tab === id ? 'bg-blossom/15 text-blossom' : 'bg-elevated/50 text-ink-dim hover:bg-white/10'}`}
          >
            <span className="block text-sm leading-none mb-0.5">{icon}</span>
            {label}
          </button>
        ))}
      </div>

      <div className="space-y-5 max-h-[58dvh] overflow-y-auto scrollbar-thin pr-1">
        {tab === 'profile' && <ProfileHub />}

        {tab === 'game' && (
          <>
            <section>
              <SectionTitle>베팅</SectionTitle>
              <div className="flex items-center justify-between py-1.5">
                <span className="text-sm text-ink">베팅 슬라이더 증감 단위</span>
                <div className="flex gap-1">
                  {(Object.keys(BET_STEP_LABELS) as BetStepUnit[]).map(unit => (
                    <button
                      key={unit}
                      onClick={() => setBetStepUnit(unit)}
                      className={`rounded-lg border px-2.5 py-1 text-xs transition-colors
                        ${betStepUnit === unit
                          ? 'border-blossom bg-blossom/10 text-blossom font-bold'
                          : 'border-white/10 bg-white/5 text-ink-dim hover:bg-white/10'}`}
                    >
                      {BET_STEP_LABELS[unit]}
                    </button>
                  ))}
                </div>
              </div>
              <BetPresetEditor />
            </section>
            <section>
              <SectionTitle>테이블</SectionTitle>
              <Toggle checked={stackedPot} onToggle={toggleStackedPot} label="팟 칩 권종별 쌓기" />
              <Toggle checked={throwablesEnabled} onToggle={toggleThrowables} label="아이템 투척 표시" />
              <p className="text-[11px] text-ink-dim leading-snug">
                끄면 다른 플레이어가 던진 아이템 연출이 보이지 않고, 내 투척 버튼도 숨겨요.
              </p>
            </section>
          </>
        )}

        {tab === 'display' && (
          <>
            <section>
              <SectionTitle>카드 스타일</SectionTitle>
              <div className="flex gap-2">
                {(Object.keys(DECK_STYLE_LABELS) as DeckStyleId[]).map(styleId => (
                  <button
                    key={styleId}
                    onClick={() => setDeckStyle(styleId)}
                    className={`flex-1 rounded-xl border p-3 flex flex-col items-center gap-2 transition-colors
                      ${deckStyle === styleId
                        ? 'border-blossom bg-blossom/10'
                        : 'border-white/10 bg-white/5 hover:bg-white/10'}`}
                  >
                    <div className="flex gap-1.5">
                      {PREVIEW_CARDS.map(card => (
                        <CardComponent
                          key={`${styleId}-${card.rank}${card.suit}`}
                          card={card}
                          size="sm"
                          deckStyle={styleId}
                          deckColor={deckColor}
                        />
                      ))}
                    </div>
                    <span className={`text-xs ${deckStyle === styleId ? 'text-blossom font-bold' : 'text-ink-dim'}`}>
                      {DECK_STYLE_LABELS[styleId]}
                    </span>
                  </button>
                ))}
              </div>
              <div className="flex gap-2 mt-2">
                {(Object.keys(DECK_COLOR_LABELS) as DeckColorId[]).map(colorId => (
                  <button
                    key={colorId}
                    onClick={() => setDeckColor(colorId)}
                    className={`flex-1 rounded-xl border px-3 py-2 flex items-center justify-center gap-2 transition-colors
                      ${deckColor === colorId
                        ? 'border-blossom bg-blossom/10'
                        : 'border-white/10 bg-white/5 hover:bg-white/10'}`}
                  >
                    <span className="flex gap-0.5 text-base leading-none bg-white rounded px-1.5 py-1">
                      {SUIT_ORDER.map(suit => (
                        <span key={suit} style={{ color: getSuitColor(suit, colorId) }}>{SUIT_SYMBOLS[suit]}</span>
                      ))}
                    </span>
                    <span className={`text-xs ${deckColor === colorId ? 'text-blossom font-bold' : 'text-ink-dim'}`}>
                      {DECK_COLOR_LABELS[colorId]}
                    </span>
                  </button>
                ))}
              </div>
            </section>
            <section>
              <SectionTitle>딜러 (미야코)</SectionTitle>
              <Toggle checked={showDealerAvatar} onToggle={toggleDealerAvatar} label="아바타 표시" />
              <Toggle checked={showDealerBubble} onToggle={toggleDealerBubble} label="말풍선 표시" />
            </section>
          </>
        )}

        {tab === 'sound' && (
          <section>
            <SectionTitle>사운드</SectionTitle>
            <Toggle checked={!muted} onToggle={toggleMuted} label="효과음" />
            <Toggle checked={!musicMuted} onToggle={toggleMusicMuted} label="배경음악" />
          </section>
        )}
      </div>
    </Modal>
  );
}
