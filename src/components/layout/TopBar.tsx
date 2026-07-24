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
import HelpModal from '../help/HelpModal';
import HandHistoryModal from '../history/HandHistoryModal';
import TournamentDetailModal from '../lobby/TournamentDetailModal';
import TournamentStatusBanner from '../table/TournamentStatusBanner';

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
  // 스피커 버튼은 마스터 토글 — 효과음만 끄면 BGM이 계속 나와 "안 꺼진다"로 느껴진다 (로비 헤더와 동일 동작)
  const { muted, musicMuted, toggleAllMuted } = useSettingsStore();
  const allMuted = muted && musicMuted;
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  // MTT 게임 중 토너 상세(내 순위/순위표/구조) — 배지 탭으로 진입 (2026-07-24 모바일 QA)
  const [tournamentOpen, setTournamentOpen] = useState(false);
  const mttTournamentId = gameState?.tournament?.tournamentId;
  const { copied, copy } = useInviteLink(currentRoomId);

  return (
    // 바 배경은 전체 폭, 내용물은 게임 영역 중앙 컨테이너(1100px — GameRoomView와 동일)에 정렬:
    // 광폭 화면에서 로고/블라인드/아이콘이 화면 양끝까지 벌어지지 않게 (2026-07-22 유저 피드백)
    <div className="bg-panel/80 border-b border-mystic/20 z-30 pt-safe">
      <div className="mx-auto flex w-full max-w-[1100px] items-center justify-between gap-2 px-3 py-1.5 md:px-4 md:py-2">
      <div className="flex shrink-0 items-center gap-2 md:gap-3">
        <Button variant="secondary" size="sm" onClick={onLeave}>
          ←
        </Button>
        <span className="hidden sm:inline">
          <NeonText size="sm" color="#A78BFA">POKER DOKU</NeonText>
        </span>
      </div>
      <div className="flex min-w-0 flex-1 items-center justify-end gap-1.5 md:gap-3">
        {gameState?.tournament && gameState.tournament.entrants > 0 ? (
          mttTournamentId ? (
            // MTT: 배지 탭 → 토너 상세 (순위표·구조·내 순위 — 게임을 떠나지 않고 확인)
            <button
              type="button"
              onClick={() => setTournamentOpen(true)}
              aria-label="토너먼트 상세 보기"
              className="min-w-0 rounded-lg px-1 py-0.5 hover:bg-white/5 active:bg-white/10 transition-colors"
            >
              <TournamentBadge tournament={gameState.tournament} showInfoHint />
            </button>
          ) : (
            <TournamentBadge tournament={gameState.tournament} />
          )
        ) : (
          gameState && (
            <span className="text-ink-dim text-xs hidden md:inline">
              블라인드 <span className="text-gilded">{gameState.smallBlind}/{gameState.bigBlind}</span>
            </span>
          )
        )}
        {gameState && (
          <span className={`text-xs ${mttTournamentId ? 'hidden md:inline' : ''}`}>
            <span className="text-mystic">{STREET_LABELS[gameState.street] ?? gameState.street}</span>
          </span>
        )}
        <button
          onClick={copy}
          aria-label="초대 링크 복사"
          title="초대 링크 복사"
          className="hidden p-1 text-ink-dim hover:text-ink transition-colors sm:inline-flex"
        >
          {copied ? <span className="text-green-400 text-xs font-bold">✓</span> : <LinkIcon />}
        </button>
        <button
          onClick={toggleAllMuted}
          aria-label={allMuted ? '사운드 켜기' : '사운드 끄기'}
          title={allMuted ? '사운드 켜기 (효과음+음악)' : '사운드 끄기 (효과음+음악)'}
          className="p-1 text-ink-dim hover:text-ink transition-colors"
        >
          <SpeakerIcon muted={allMuted} />
        </button>
        <button
          onClick={() => setHistoryOpen(true)}
          aria-label="핸드 히스토리"
          title="핸드 히스토리"
          className="p-1 text-ink-dim hover:text-ink transition-colors"
        >
          <HistoryIcon />
        </button>
        <button
          onClick={() => setHelpOpen(true)}
          aria-label="게임 도움말"
          title="핸드 랭킹 · 용어"
          className="hidden p-1 text-ink-dim hover:text-ink transition-colors sm:inline-flex"
        >
          <HelpIcon />
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
      </div>
      <SettingsModal isOpen={settingsOpen} onClose={() => setSettingsOpen(false)} />
      <HelpModal isOpen={helpOpen} onClose={() => setHelpOpen(false)} />
      <HandHistoryModal isOpen={historyOpen} onClose={() => setHistoryOpen(false)} />
      {tournamentOpen && mttTournamentId && (
        <TournamentDetailModal
          tournamentId={mttTournamentId}
          onClose={() => setTournamentOpen(false)}
        />
      )}
    </div>
  );
}

/** 히스토리(시계 되감기) 아이콘 — 핸드 히스토리 */
function HistoryIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M3 3v5h5" />
      <path d="M3.05 13A9 9 0 1 0 6 5.3L3 8" />
      <path d="M12 7v5l4 2" />
    </svg>
  );
}

/** 물음표 아이콘 — 도움말 */
function HelpIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <circle cx="12" cy="12" r="10" />
      <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" />
      <line x1="12" y1="17" x2="12.01" y2="17" />
    </svg>
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

/** 시트앤고/MTT 레벨/블라인드/다음 인상 카운트다운 (+MTT: 앤티·전체 잔존 인원) */
function TournamentBadge({
  tournament,
  showInfoHint = false,
}: {
  tournament: TournamentState;
  /** MTT 배지가 탭 가능함을 알리는 ⓘ 힌트 (TopBar 상세 진입점) */
  showInfoHint?: boolean;
}) {
  const seconds = useCountdownTo(tournament.finished ? 0 : tournament.levelEndsAt);

  return (
    <span className="flex min-w-0 items-center gap-1 text-[11px] sm:gap-1.5 sm:text-xs">
      <span className="shrink-0 font-bold text-gilded">Lv.{tournament.level}</span>
      <span className="shrink-0 text-ink-dim">
        <span className="text-gilded">
          {tournament.smallBlind}/{tournament.bigBlind}
          {(tournament.ante ?? 0) > 0 && ` A${tournament.ante}`}
        </span>
      </span>
      {tournament.fieldRemaining !== undefined && tournament.fieldRemaining > 0 && (
        <span className="shrink-0 text-ink-dim" title="전체 잔존 인원">
          👥{tournament.fieldRemaining}/{tournament.entrants}
        </span>
      )}
      <span className="min-w-0 md:hidden">
        <TournamentStatusBanner
          reasons={tournament.holdReasons}
          stageEndsAt={tournament.stageEndsAt}
          compact
        />
      </span>
      {seconds !== null && tournament.nextBigBlind !== null && (
        <span
          className="hidden shrink-0 text-cyber tabular md:inline"
          title={`다음 ${tournament.nextSmallBlind}/${tournament.nextBigBlind}`}
        >
          ↑{formatCountdown(seconds)}
        </span>
      )}
      {showInfoHint && <span className="hidden text-ink-dim sm:inline" aria-hidden>ⓘ</span>}
    </span>
  );
}
