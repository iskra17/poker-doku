'use client';

import Modal from '@/components/ui/Modal';
import CardComponent from '@/components/table/Card';
import RecoveryPanel from '@/components/profile/RecoveryPanel';
import { useSettingsStore, BetStepUnit } from '@/lib/store/settings-store';
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

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <h3 className="text-xs font-bold text-blossom mb-2">{children}</h3>;
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
  const {
    deckStyle, setDeckStyle, deckColor, setDeckColor,
    showDealerAvatar, toggleDealerAvatar, showDealerBubble, toggleDealerBubble,
    betStepUnit, setBetStepUnit,
    stackedPot, toggleStackedPot,
    muted, toggleMuted,
    musicMuted, toggleMusicMuted,
  } = useSettingsStore();

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="설정">
      <div className="space-y-5 max-h-[65dvh] overflow-y-auto scrollbar-thin pr-1">
        {/* 카드 덱 */}
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

        <RecoveryPanel />

        {/* 게임 */}
        <section>
          <SectionTitle>게임</SectionTitle>
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
          <Toggle checked={stackedPot} onToggle={toggleStackedPot} label="팟 칩 권종별 쌓기" />
        </section>

        {/* 딜러 (미야코) */}
        <section>
          <SectionTitle>딜러 (미야코)</SectionTitle>
          <Toggle checked={showDealerAvatar} onToggle={toggleDealerAvatar} label="아바타 표시" />
          <Toggle checked={showDealerBubble} onToggle={toggleDealerBubble} label="말풍선 표시" />
        </section>

        {/* 사운드 */}
        <section>
          <SectionTitle>사운드</SectionTitle>
          <Toggle checked={!muted} onToggle={toggleMuted} label="효과음" />
          <Toggle checked={!musicMuted} onToggle={toggleMusicMuted} label="배경음악" />
        </section>
      </div>
    </Modal>
  );
}
