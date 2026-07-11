'use client';

import { useState } from 'react';
import { useGameStore } from '@/lib/store/game-store';
import { useSettingsStore } from '@/lib/store/settings-store';
import { useCountdownTo, formatCountdown } from '@/lib/hooks/use-countdown';
import { useInviteLink } from '@/lib/hooks/use-invite-link';
import { TournamentState } from '@/lib/poker/types';
import Button from '@/components/ui/Button';
import NeonText from '@/components/ui/NeonText';
import SettingsModal from './SettingsModal';

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
  const { gameState, connected, playerName, currentRoomId } = useGameStore();
  const { muted, toggleMuted } = useSettingsStore();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const { copied, copy } = useInviteLink(currentRoomId);

  return (
    <div className="flex items-center justify-between px-3 py-1.5 md:px-4 md:py-2 bg-panel/80 border-b border-mystic/20 z-30 pt-safe">
      <div className="flex items-center gap-2 md:gap-3">
        <Button variant="secondary" size="sm" onClick={onLeave}>
          ←
        </Button>
        <NeonText size="sm" color="#A78BFA">POKER DOKU</NeonText>
      </div>
      <div className="flex items-center gap-2 md:gap-3">
        {gameState?.tournament && gameState.tournament.entrants > 0 ? (
          <TournamentBadge tournament={gameState.tournament} />
        ) : (
          gameState && (
            <span className="text-ink-dim text-xs hidden md:inline">
              블라인드 <span className="text-gilded">{gameState.smallBlind}/{gameState.bigBlind}</span>
            </span>
          )
        )}
        {gameState && (
          <span className="text-xs">
            <span className="text-mystic">{STREET_LABELS[gameState.street] ?? gameState.street}</span>
          </span>
        )}
        <button
          onClick={copy}
          aria-label="초대 링크 복사"
          title="초대 링크 복사"
          className="p-1 text-ink-dim hover:text-ink transition-colors"
        >
          {copied ? <span className="text-green-400 text-xs font-bold">✓</span> : <LinkIcon />}
        </button>
        <button
          onClick={toggleMuted}
          aria-label={muted ? '소리 켜기' : '소리 끄기'}
          className="p-1 text-ink-dim hover:text-ink transition-colors"
        >
          <SpeakerIcon muted={muted} />
        </button>
        <button
          onClick={() => setSettingsOpen(true)}
          aria-label="설정"
          className="p-1 text-ink-dim hover:text-ink transition-colors"
        >
          <GearIcon />
        </button>
        <div className="flex items-center gap-1">
          <div className={`w-1.5 h-1.5 md:w-2 md:h-2 rounded-full ${connected ? 'bg-green-400' : 'bg-red-400'}`} />
          <span className="text-ink-dim/70 text-[10px] md:text-xs hidden md:inline">{playerName}</span>
        </div>
      </div>
      <SettingsModal isOpen={settingsOpen} onClose={() => setSettingsOpen(false)} />
    </div>
  );
}

/** 초대 링크 아이콘 */
function LinkIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
      <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
    </svg>
  );
}

/** 스피커 아이콘 — muted면 슬래시 표시 */
function SpeakerIcon({ muted }: { muted: boolean }) {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M11 5 6 9H3v6h3l5 4V5z" fill="currentColor" stroke="none" />
      {muted ? (
        <path d="M22 4 4 22" className="text-red-400" stroke="currentColor" />
      ) : (
        <>
          <path d="M15.5 8.5a5 5 0 0 1 0 7" />
          <path d="M18.5 5.5a9.5 9.5 0 0 1 0 13" />
        </>
      )}
    </svg>
  );
}

/** 톱니 아이콘 */
function GearIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.7 1.7 0 0 0 .34 1.87l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.7 1.7 0 0 0-1.87-.34 1.7 1.7 0 0 0-1.03 1.56V21a2 2 0 1 1-4 0v-.09a1.7 1.7 0 0 0-1.11-1.56 1.7 1.7 0 0 0-1.87.34l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.7 1.7 0 0 0 .34-1.87 1.7 1.7 0 0 0-1.56-1.03H3a2 2 0 1 1 0-4h.09a1.7 1.7 0 0 0 1.56-1.11 1.7 1.7 0 0 0-.34-1.87l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.7 1.7 0 0 0 1.87.34h.01a1.7 1.7 0 0 0 1.02-1.56V3a2 2 0 1 1 4 0v.09a1.7 1.7 0 0 0 1.03 1.56 1.7 1.7 0 0 0 1.87-.34l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.7 1.7 0 0 0-.34 1.87v.01a1.7 1.7 0 0 0 1.56 1.02H21a2 2 0 1 1 0 4h-.09a1.7 1.7 0 0 0-1.56 1.03z" />
    </svg>
  );
}

/** 시트앤고 레벨/블라인드/다음 인상 카운트다운 */
function TournamentBadge({ tournament }: { tournament: TournamentState }) {
  const seconds = useCountdownTo(tournament.finished ? 0 : tournament.levelEndsAt);

  return (
    <span className="text-xs flex items-center gap-1.5">
      <span className="text-gilded font-bold">Lv.{tournament.level}</span>
      <span className="text-ink-dim">
        <span className="text-gilded">{tournament.smallBlind}/{tournament.bigBlind}</span>
      </span>
      {seconds !== null && tournament.nextBigBlind !== null && (
        <span className="text-cyber tabular" title={`다음 ${tournament.nextSmallBlind}/${tournament.nextBigBlind}`}>
          ↑{formatCountdown(seconds)}
        </span>
      )}
    </span>
  );
}
