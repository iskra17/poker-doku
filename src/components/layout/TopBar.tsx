'use client';

import { useGameStore } from '@/lib/store/game-store';
import { useSettingsStore } from '@/lib/store/settings-store';
import Button from '@/components/ui/Button';
import NeonText from '@/components/ui/NeonText';

const STREET_LABELS: Record<string, string> = {
  preflop: '프리플랍',
  flop: '플랍',
  turn: '턴',
  river: '리버',
  showdown: '쇼다운',
};

interface TopBarProps {
  onLeave: () => void;
}

export default function TopBar({ onLeave }: TopBarProps) {
  const { gameState, connected, playerName } = useGameStore();
  const { muted, toggleMuted } = useSettingsStore();

  return (
    <div className="flex items-center justify-between px-3 py-1.5 md:px-4 md:py-2 bg-panel/80 border-b border-mystic/20 z-30 pt-safe">
      <div className="flex items-center gap-2 md:gap-3">
        <Button variant="secondary" size="sm" onClick={onLeave}>
          ←
        </Button>
        <NeonText size="sm" color="#A78BFA">POKER DOKU</NeonText>
      </div>
      <div className="flex items-center gap-2 md:gap-3">
        {gameState && (
          <span className="text-ink-dim text-xs hidden md:inline">
            블라인드 <span className="text-gilded">{gameState.smallBlind}/{gameState.bigBlind}</span>
          </span>
        )}
        {gameState && (
          <span className="text-xs">
            <span className="text-mystic">{STREET_LABELS[gameState.street] ?? gameState.street}</span>
          </span>
        )}
        <button
          onClick={toggleMuted}
          aria-label={muted ? '소리 켜기' : '소리 끄기'}
          className="text-base md:text-lg opacity-70 hover:opacity-100 transition-opacity px-1"
        >
          {muted ? '🔇' : '🔊'}
        </button>
        <div className="flex items-center gap-1">
          <div className={`w-1.5 h-1.5 md:w-2 md:h-2 rounded-full ${connected ? 'bg-green-400' : 'bg-red-400'}`} />
          <span className="text-ink-dim/70 text-[10px] md:text-xs hidden md:inline">{playerName}</span>
        </div>
      </div>
    </div>
  );
}
